import { stepCountIs, streamText, type LanguageModel, type ToolSet } from 'ai'

import { buildMessages, coalesceRoles, systemPrompt } from './context'
import type {
  ConversationGraph,
  Lane,
  Reply,
  ReplyOptions,
  SearchStep,
  Source,
  TokenUsage,
} from './types'
import {
  capabilitiesFor,
  createModel,
  createNativeSearch,
  type ProviderConfig,
} from '@/providers/registry'
import type { Capabilities } from '@/providers/capabilities'
import { compatibleOptionsFor, providerOptionsFor } from '@/providers/reasoning'
import type { ProviderKind } from '@/providers/reasoning'
import { createSearchTool, searchAdapter } from '@/search/adapters'
import { t } from '@/i18n/core'
import { chat } from '@/i18n'

/**
 * The streaming engine.
 *
 * One turn fans out to N lanes. Each lane runs its own `streamText` call with
 * its own AbortController, so a slow column never blocks a fast one and each
 * column can be stopped on its own. When N is 1 this is an ordinary chat; there
 * is no separate single-column code path.
 */

export interface EngineContext {
  providers: ProviderConfig[]
  /** Global custom instructions; every system prompt carries them after the date (see `systemPrompt`). */
  systemPrompt?: string
  /** How many agent steps a bring-your-own-search turn may take. */
  maxSearchSteps?: number
  onReplyUpdate: (replyId: string, patch: Partial<Reply>) => void
  onReplyDone: (replyId: string) => void
  onError: (replyId: string, message: string) => void
}

/** Coalesces stream updates to at most one per animation frame. */
class FrameBuffer {
  private text = ''
  private reasoning = ''
  private dirty = false
  private frame: number | null = null
  private disposed = false

  constructor(private readonly flush: (text: string, reasoning: string) => void) {}

  push(chunk: { text?: string; reasoning?: string }) {
    if (chunk.text) this.text += chunk.text
    if (chunk.reasoning) this.reasoning += chunk.reasoning
    this.dirty = true
    this.schedule()
  }

  private schedule() {
    if (this.frame !== null || this.disposed) return
    // rAF rather than a timer: updates land on a paint boundary, so a reply
    // arriving in a burst still produces exactly one render per frame.
    this.frame = requestAnimationFrame(() => {
      this.frame = null
      if (!this.dirty) return
      this.dirty = false
      this.flush(this.text, this.reasoning)
    })
  }

  /** Emits any pending text immediately — used when the stream ends. */
  settle() {
    if (this.frame !== null) {
      cancelAnimationFrame(this.frame)
      this.frame = null
    }
    if (this.dirty) {
      this.dirty = false
      this.flush(this.text, this.reasoning)
    }
  }

  dispose() {
    this.disposed = true
    if (this.frame !== null) cancelAnimationFrame(this.frame)
    this.frame = null
  }
}

/** Providers we can construct a model for at all. */
function findProvider(
  providers: ProviderConfig[],
  providerId: string,
): ProviderConfig | undefined {
  return providers.find((provider) => provider.id === providerId)
}

/**
 * Builds the tools for a lane.
 *
 * Native search is preferred: it costs one request, needs no extra key, and
 * comes back with structured citations. A bring-your-own adapter is used when
 * the model has no hosted search, which is what makes the toggle behave the
 * same way across every provider.
 */
function buildTools(
  provider: ProviderConfig,
  lane: Lane,
  opts: ReplyOptions,
  onStep: (step: SearchStep, sources: Source[]) => void,
): ToolSet | undefined {
  if (opts.search === 'none') return undefined

  const capabilities = capabilitiesFor(provider, lane.model.modelId)

  // Native search is handled by the caller, which also swaps the model for
  // the one on the search-carrying protocol (see `createNativeSearch`).
  if (opts.search === 'native') return undefined

  // Bring-your-own search requires tool calling, so refuse rather than sending
  // a tool to a model that will ignore or mishandle it.
  if (!capabilities.tools) return undefined

  const adapter = searchAdapter(opts.search)
  if (!adapter) return undefined

  return {
    web_search: createSearchTool(adapter, ({ query, sources }) => {
      onStep(
        {
          id: `step-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          query,
          status: 'done',
          sourceCount: sources.length,
        },
        sources,
      )
    }),
  }
}

/**
 * The `providerOptions` for one call.
 *
 * Split out because the OpenAI-compatible provider keys its options bag by the
 * *configured provider's id* rather than by a vendor name — two endpoints would
 * otherwise share one bag — so that case cannot be built from the kind alone.
 */
function optionsForWire(
  wireKind: string,
  provider: ProviderConfig,
  level: ReplyOptions['reasoning'],
  capabilities: Capabilities,
) {
  // The model's own accepted values travel with the request, so a level the
  // vendor does not list is mapped onto the nearest one it does rather than
  // being sent as-is and rejected.
  const params = capabilities.reasoning
  if (wireKind === 'openai-compatible') {
    const bag = compatibleOptionsFor(level, capabilities.thinking, params)
    return bag ? { [provider.id]: bag } : undefined
  }
  return providerOptionsFor(wireKind as ProviderKind, level, capabilities.thinking, params)
}

/**
 * Reads one lane's stream into a reply.
 *
 * Resolves when the stream ends, is stopped, or errors. Never throws: a failure
 * is reported through `onError` so one bad column does not take down the others.
 */
async function runLane(
  graph: ConversationGraph,
  lane: Lane,
  turnId: string,
  reply: Reply,
  context: EngineContext,
  signal: AbortSignal,
): Promise<void> {
  const provider = findProvider(context.providers, lane.model.providerId)
  if (!provider) {
    context.onError(reply.id, t(chat.providerMissing, { providerId: lane.model.providerId }))
    return
  }

  const capabilities = capabilitiesFor(provider, lane.model.modelId)

  // Accumulated state for this reply. Kept local rather than read back from the
  // store so a render cannot interleave with the stream reading it.
  const steps: SearchStep[] = []
  const sources: Source[] = []
  let usage: TokenUsage | undefined
  let reasoningStartedAt: number | null = null
  let reasoningMs: number | undefined
  let latestText = ''
  let streamError: string | null = null

  const buffer = new FrameBuffer((text, reasoning) => {
    latestText = text
    context.onReplyUpdate(reply.id, {
      text,
      reasoning: reasoning || undefined,
      steps: [...steps],
      sources: [...sources],
    })
  })

  const byoTools = buildTools(provider, lane, reply.opts, (step, newSources) => {
    steps.push(step)
    // De-duplicate by URL: a model often searches twice over similar ground.
    for (const source of newSources) {
      if (!sources.some((existing) => existing.url === source.url)) sources.push(source)
    }
    context.onReplyUpdate(reply.id, { steps: [...steps], sources: [...sources] })
  })

  let model: LanguageModel
  let tools: ToolSet | undefined = byoTools
  // Which provider's option bag applies. Usually the provider's own kind, but a
  // native-search request on a gateway may travel over another vendor's wire.
  let wireKind = provider.kind
  try {
    const native = reply.opts.search === 'native' ? createNativeSearch(provider, lane.model.modelId) : null
    if (native) {
      model = native.model
      tools = native.tools
      wireKind = native.route
    } else {
      model = createModel(provider, lane.model.modelId)
    }
  } catch (error) {
    context.onError(reply.id, error instanceof Error ? error.message : String(error))
    return
  }

  try {
    const result = streamText({
      model,
      system: systemPrompt(context.systemPrompt),
      messages: coalesceRoles(
        buildMessages(graph, lane, {
          excludeTurnId: turnId,
          // A model that can see an image or a PDF gets the file itself; the
          // text budget can then be small. One that cannot needs the extracted
          // text to be the whole document.
          maxAttachmentChars: capabilities.vision ? 40_000 : 200_000,
          vision: capabilities.vision,
          audio: capabilities.audio,
        }),
      ),
      tools,
      // Bound the agent loop: a model that keeps searching forever would keep
      // billing. Three searches inside a five-step budget is plenty for the
      // comparison use case this app exists for.
      stopWhen: tools ? stepCountIs(context.maxSearchSteps ?? 5) : undefined,
      abortSignal: signal,
      providerOptions: optionsForWire(wireKind, provider, reply.opts.reasoning, capabilities),
    })

    for await (const part of result.fullStream) {
      if (signal.aborted) break

      switch (part.type) {
        case 'text-delta':
          buffer.push({ text: part.text })
          break

        case 'reasoning-delta':
          if (reasoningStartedAt === null) reasoningStartedAt = Date.now()
          buffer.push({ reasoning: part.text })
          break

        case 'reasoning-end':
          if (reasoningStartedAt !== null) {
            reasoningMs = Date.now() - reasoningStartedAt
            // Published now, not at the end: the panel folds as soon as the
            // answer starts and its label needs the duration at that moment.
            context.onReplyUpdate(reply.id, { reasoningMs })
          }
          break

        case 'source': {
          // Provider-native grounding arrives as source parts.
          const url = 'url' in part ? String(part.url ?? '') : ''
          if (url && !sources.some((existing) => existing.url === url)) {
            const title = 'title' in part && typeof part.title === 'string' ? part.title : undefined
            sources.push({ id: `src-${sources.length}-${url}`, url, title })
            context.onReplyUpdate(reply.id, { sources: [...sources] })
          }
          break
        }

        case 'tool-call': {
          // Hosted search reports its query here; bring-your-own reports it via
          // the adapter callback above, which already pushed a step.
          if (part.toolName !== 'web_search' && part.toolName !== 'google_search') break
          const input = part.input as { query?: string; queries?: string[] } | undefined
          const query = input?.query ?? input?.queries?.[0]
          if (query && !steps.some((step) => step.query === query)) {
            steps.push({
              id: `step-${Date.now()}-${steps.length}`,
              query,
              status: 'done',
              sourceCount: 0,
            })
            context.onReplyUpdate(reply.id, { steps: [...steps] })
          }
          break
        }

        case 'finish-step':
          if (reasoningStartedAt !== null && reasoningMs === undefined) {
            reasoningMs = Date.now() - reasoningStartedAt
          }
          break

        case 'finish':
          usage = {
            inputTokens: part.totalUsage?.inputTokens,
            outputTokens: part.totalUsage?.outputTokens,
            // Reasoning tokens are nested under outputTokenDetails, not top-level.
            reasoningTokens: part.totalUsage?.outputTokenDetails?.reasoningTokens,
            totalTokens: part.totalUsage?.totalTokens,
          }
          break

        case 'error': {
          // Not every error part is fatal. Hosted search in particular emits
          // blocks the SDK's schema does not know (Anthropic's
          // `max_uses_exceeded` result is one) and the stream carries on to a
          // complete answer. So remember the error and keep reading; it only
          // becomes the reply's outcome if no answer arrives at all.
          streamError =
            part.error instanceof Error ? part.error.message : String(part.error)
          break
        }

        case 'abort':
          // Falling out of the loop records the partial text as `stopped`.
          break

        default:
          break
      }
    }

    buffer.settle()

    if (streamError && !latestText.trim() && !signal.aborted) {
      context.onError(reply.id, streamError)
      return
    }

    if (signal.aborted) {
      context.onReplyUpdate(reply.id, { text: latestText, status: 'stopped' })
    } else {
      context.onReplyUpdate(reply.id, {
        status: 'done',
        reasoningMs,
        usage,
      })
    }

    context.onReplyDone(reply.id)
  } catch (error) {
    buffer.dispose()

    // An abort lands here as a DOMException; that is a normal stop, not a fault.
    if (signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
      context.onReplyUpdate(reply.id, { status: 'stopped' })
      context.onReplyDone(reply.id)
      return
    }

    context.onError(reply.id, error instanceof Error ? error.message : String(error))
  }
}

/** Handle for a running turn, so the UI can stop individual columns. */
export interface TurnHandle {
  stopLane(laneId: string): void
  stopAll(): void
  /** Resolves when every lane has finished or been stopped. */
  done: Promise<void>
}

/**
 * Starts one turn across every visible lane.
 *
 * `replies` must already exist in the store (in `pending` state) so the UI can
 * render placeholders in every column before the first token arrives.
 */
export function startTurn(
  graph: ConversationGraph,
  replies: Reply[],
  context: EngineContext,
): TurnHandle {
  const controllers = new Map<string, AbortController>()

  const lanes = new Map(graph.conversation.lanes.map((lane) => [lane.id, lane]))

  const tasks = replies.map((reply) => {
    const lane = lanes.get(reply.laneId)
    if (!lane) return Promise.resolve()

    const controller = new AbortController()
    controllers.set(reply.laneId, controller)

    return runLane(graph, lane, reply.turnId, reply, context, controller.signal)
  })

  return {
    stopLane(laneId) {
      controllers.get(laneId)?.abort()
    },
    stopAll() {
      for (const controller of controllers.values()) controller.abort()
    },
    done: Promise.allSettled(tasks).then(() => undefined),
  }
}
