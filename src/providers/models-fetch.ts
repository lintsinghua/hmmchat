import type { ProviderKind } from './reasoning'
import { CATALOG } from './catalog.data'
import { secretNameForProvider, secretPlaceholder } from '@/lib/secrets'
import { tauriFetch } from '@/lib/transport'

/**
 * Model discovery.
 *
 * Each vendor exposes its catalogue at a slightly different path and with a
 * slightly different auth header, so this is the one place that has to know.
 * The requests carry the `{{secret:...}}` placeholder rather than a key, like
 * every other call — the Rust proxy substitutes it, which also means discovery
 * works without the webview ever holding a credential.
 */

interface DiscoveryResult {
  id: string
  name?: string
}

function headersFor(kind: ProviderKind, apiKey: string): Record<string, string> {
  switch (kind) {
    case 'anthropic':
      return { 'anthropic-version': '2023-06-01', 'x-api-key': apiKey }
    case 'google':
      return { 'x-goog-api-key': apiKey }
    default:
      return { authorization: `Bearer ${apiKey}` }
  }
}

function modelsUrl(kind: ProviderKind, baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, '')
  switch (kind) {
    case 'google':
      // Gemini's catalogue lives under the versioned path with no extra segment.
      return `${base.replace(/\/v\d+beta$/, '')}/v1beta/models`
    default:
      return `${base}/models`
  }
}

/** Extracts the model list from whichever envelope the vendor uses. */
function parseModels(kind: ProviderKind, payload: unknown): DiscoveryResult[] {
  const data = payload as {
    data?: Array<{ id?: string; name?: string; display_name?: string }>
    models?: Array<{ name?: string; displayName?: string }>
  }

  if (kind === 'google') {
    return (data.models ?? [])
      .map((entry) => {
        const raw = entry.name ?? ''
        // Google returns "models/gemini-3-pro"; the SDK wants just the id.
        const id = raw.replace(/^models\//, '')
        return { id, name: entry.displayName }
      })
      .filter((entry) => entry.id)
  }

  return (data.data ?? [])
    .map((entry) => ({ id: entry.id ?? '', name: entry.display_name ?? entry.name }))
    .filter((entry) => entry.id)
}

/**
 * Fetches the model catalogue for a provider.
 *
 * `providerId` is used only to derive the secret name, so the request carries
 * the same placeholder the chat calls do.
 */
export async function fetchModels(
  providerId: string,
  kind: ProviderKind,
  baseUrl: string,
): Promise<DiscoveryResult[]> {
  const apiKey = secretPlaceholder(secretNameForProvider(providerId))
  const response = await tauriFetch(modelsUrl(kind, baseUrl), {
    headers: headersFor(kind, apiKey),
  })

  const text = await response.text()
  if (!response.ok) {
    throw new Error(`${response.status} ${text.slice(0, 240)}`)
  }

  return parseModels(kind, JSON.parse(text))
}

/**
 * Models worth pre-selecting for a new provider.
 *
 * Discovery returns a hundred ids including embedding, image and audio models;
 * showing all of them ticked would bury the three the user actually wants.
 *
 * Two passes. The catalog is asked first — a model it credits with tool calling
 * is a conversational model, and that one question cleanly excludes embeddings,
 * speech synthesis and image generators across every vendor, including the ones
 * with naming schemes nobody anticipated. The vendor regexes then order the
 * result so a flagship leads the list rather than whichever id sorted first.
 */
export function preferredModels(kind: ProviderKind, discovered: DiscoveryResult[]): string[] {
  const conversational = discovered.map((entry) => entry.id).filter(isConversational)

  const matchers: Record<ProviderKind, RegExp[]> = {
    anthropic: [/^claude-(opus|sonnet|haiku)-/, /^claude-(fable|mythos)-/],
    openai: [/^gpt-[5-9]/, /^o[3-9]/, /^gpt-4o/],
    google: [/^gemini-[23]/, /^gemini-2\.5/],
    openrouter: [/^anthropic\/claude-/, /^openai\/gpt-/, /^google\/gemini-/],
    'openai-compatible': [],
  }

  // Vendor order first, then catalog order, then as discovered.
  const ranked = [
    ...conversational.filter((id) => matchers[kind].some((pattern) => pattern.test(id))),
    ...conversational.filter((id) => !matchers[kind].some((pattern) => pattern.test(id))),
  ]

  // Capped so the list stays usable. There is deliberately no "fall back to
  // everything" branch: an id the catalog has never seen already passed the
  // benefit of the doubt, so it is in `ranked`, and an id that was filtered out
  // was filtered out on purpose.
  return ranked.slice(0, 12)
}

/**
 * Names that never denote a chat model.
 *
 * Only consulted for ids the catalog does not know, which in practice means
 * retired models and a vendor's own naming for a non-text endpoint. It is a
 * safety net, not the rule: the catalog answers for everything it covers, and
 * this catches the long tail of ids that predate it or were never listed.
 *
 * Deliberately narrow: only names that settle the question, never a guess about
 * a family. A false negative here hides a real model from the pre-selected list,
 * which is the worse error — the user can always tick a box that was unticked,
 * but will not miss a model they never saw.
 */
const NOT_CONVERSATIONAL = new RegExp(
  [
    'embedding',
    'embed',
    // Embedding families, by their own names. A local endpoint's discovery
    // returns these beside the chat models, and none of them is a chat model.
    'bge-',
    'minilm',
    'gte-',
    'e5-',
    'jina',
    'nomic',
    'voyage',
    'whisper',
    'tts',
    'audio',
    'speech',
    'moderation',
    'rerank',
    'dall-e',
    'sora',
    'stable-diffusion',
    // OpenAI's pre-chat completion models: completions only, no messages.
    'babbage',
    'davinci',
    'curie',
    'ada-',
    'codex-mini',
  ].join('|'),
  'i',
)

/**
 * Whether a model id looks like something you can hold a conversation with.
 *
 * Tool calling is the discriminator the catalog actually publishes, and it
 * separates chat models from embeddings, transcription and image generation
 * without a naming convention per vendor. An id the catalog does not know is
 * given the benefit of the doubt unless its name gives it away — refusing to
 * pre-select a user's own model would be worse than pre-selecting one that
 * turns out not to chat.
 */
function isConversational(modelId: string): boolean {
  // The name veto comes first, and applies even to a model the catalog knows.
  // The catalog is not infallible about this one field — it lists video and
  // image endpoints with tool calling set — and a name like `sora` or
  // `whisper` settles the question on its own.
  if (NOT_CONVERSATIONAL.test(modelId)) return false

  const entry = CATALOG[normalizeCatalogId(modelId)]
  if (entry) return entry[1].includes('t')
  return true
}

/** The same id reduction the capability lookup uses. */
function normalizeCatalogId(modelId: string): string {
  const lower = modelId.toLowerCase().trim().replace(/^~/, '')
  const slash = lower.indexOf('/')
  if (slash > 0) {
    const rest = lower.slice(slash + 1)
    if (rest && !rest.includes('/')) return rest
  }
  return lower
}
