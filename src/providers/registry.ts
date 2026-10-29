import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import type { LanguageModel, ToolSet } from 'ai'

import { secretNameForProvider, secretPlaceholder } from '@/lib/secrets'
import { tauriFetch } from '@/lib/transport'
import { t } from '@/i18n/core'
import { providers } from '@/i18n'
import {
  inferCapabilities,
  inferForProvider,
  type Capabilities,
  type ThinkingControl,
} from './capabilities'
import type { ProviderKind } from './reasoning'

/**
 * Provider registry.
 *
 * Every provider is constructed with the Rust-proxied `fetch` (vendor APIs
 * reject browser-originated calls) and with a **placeholder** as its API key
 * rather than the real value. The SDK faithfully writes that placeholder into
 * `Authorization` / `x-api-key`, and src-tauri substitutes the real secret on
 * the way out — only for the origin it was bound to. So the API key never
 * enters the webview's JavaScript heap at all.
 *
 * Model construction is the only place that has to know about per-vendor
 * differences; everything above it (the engine, the store, the UI) sees a
 * `LanguageModel`.
 */

export interface ModelEntry {
  id: string
  enabled: boolean
}

/**
 * What an OpenAI-compatible endpoint accepts for reasoning depth.
 *
 * `auto` infers it from the model id, which is right for the majority of
 * endpoints — they follow the convention of whatever vendor they relay. The
 * others exist because a self-hosted server does not have to: some take a
 * numeric budget, some take nothing at all, and sending an unrecognised field
 * to a strict server is a 400 on every message.
 */
export type ReasoningWire = 'auto' | 'effort' | 'budget' | 'none'

export interface ProviderConfig {
  id: string
  kind: ProviderKind
  name: string
  baseUrl: string
  enabled: boolean
  /** Models discovered from the provider, with the user's enable flags. */
  models?: ModelEntry[]
  /** Compatible endpoints only: how to send reasoning depth. Defaults to auto. */
  reasoningWire?: ReasoningWire
}

export interface ProviderPreset {
  kind: ProviderKind
  name: string
  baseUrl: string
  /** Shown in the "add provider" list, in this order. */
  hint: string
}

/**
 * The provider list shown in settings.
 *
 * Ordered by how much the app knows about the vendor, not by how popular it is.
 * The first four speak their own protocol, which is what gives them hosted
 * search and a real reasoning control. Everything after them is reached over
 * the OpenAI-compatible protocol, which the app supports just as genuinely —
 * DeepSeek and Moonshot are first-class entries here rather than something to
 * be assembled out of a "custom endpoint" form with a URL typed into it.
 *
 * A vendor already reached over that protocol gets a preset of its own
 * (`kind: 'openai-compatible'` plus a base URL), so choosing DeepSeek and
 * choosing Anthropic are the same gesture.
 */
export const PROVIDER_PRESETS: ProviderPreset[] = [
  // --- Vendor protocols ----------------------------------------------------
  {
    kind: 'anthropic',
    name: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    get hint() { return t(providers.hintAnthropic) },
  },
  {
    kind: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    get hint() { return t(providers.hintOpenai) },
  },
  {
    kind: 'google',
    name: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    get hint() { return t(providers.hintGoogle) },
  },
  {
    kind: 'openrouter',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    get hint() { return t(providers.hintOpenrouter) },
  },

  // --- OpenAI-compatible vendors ------------------------------------------
  {
    kind: 'openai-compatible',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    get hint() { return t(providers.hintDeepseek) },
  },
  {
    kind: 'openai-compatible',
    name: 'xAI Grok',
    baseUrl: 'https://api.x.ai/v1',
    get hint() { return t(providers.hintXai) },
  },
  {
    kind: 'openai-compatible',
    get name() { return t(providers.nameMoonshot) },
    baseUrl: 'https://api.moonshot.cn/v1',
    get hint() { return t(providers.hintMoonshot) },
  },
  {
    kind: 'openai-compatible',
    get name() { return t(providers.nameZhipu) },
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    get hint() { return t(providers.hintZhipu) },
  },
  {
    kind: 'openai-compatible',
    name: 'Ollama',
    baseUrl: 'http://127.0.0.1:11434/v1',
    get hint() { return t(providers.hintLocal) },
  },
  {
    kind: 'openai-compatible',
    name: 'LM Studio',
    baseUrl: 'http://127.0.0.1:1234/v1',
    get hint() { return t(providers.hintLocal) },
  },

  // --- Anything else -------------------------------------------------------
  {
    kind: 'openai-compatible',
    get name() { return t(providers.nameCustom) },
    baseUrl: '',
    get hint() { return t(providers.hintCustom) },
  },
]

/** Presets reached over the OpenAI-compatible protocol. */
export function isCompatiblePreset(preset: ProviderPreset): boolean {
  return preset.kind === 'openai-compatible'
}

/**
 * A provider preset with an id, for the draft that has not been saved yet.
 *
 * The id is derived from the preset name rather than its kind: two
 * openai-compatible presets would otherwise collide on `openai-compatible` and
 * the second would overwrite the first.
 */
export function providerIdFor(preset: ProviderPreset): string {
  const slug = preset.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return `${slug || preset.kind}-${Date.now().toString(36)}`
}

/**
 * Builds a model handle for one provider/model pair.
 *
 * The `fetch` override plus the placeholder key mean the resulting model can be
 * passed straight to `streamText` with no further per-provider special-casing.
 */
export function createModel(config: ProviderConfig, modelId: string): LanguageModel {
  const apiKey = secretPlaceholder(secretNameForProvider(config.id))
  const baseURL = config.baseUrl || undefined
  const fetch = tauriFetch

  switch (config.kind) {
    case 'anthropic': {
      const provider = createAnthropic({ apiKey, baseURL, fetch })
      return provider(modelId)
    }

    case 'openai': {
      const provider = createOpenAI({ apiKey, baseURL, fetch })
      // The Responses API is OpenAI's current surface and the one that exposes
      // the hosted web_search tool; the older chat-completions shape does not
      // carry it in the same way.
      return provider.responses(modelId)
    }

    case 'google': {
      const provider = createGoogleGenerativeAI({ apiKey, baseURL, fetch })
      return provider(modelId)
    }

    case 'openrouter': {
      const provider = createOpenRouter({ apiKey, baseURL, fetch })
      return provider.chat(modelId)
    }

    case 'openai-compatible': {
      const provider = createOpenAICompatible({
        name: config.id,
        apiKey,
        // Required (not optional) on this provider, so it cannot be `undefined`.
        baseURL: config.baseUrl,
        fetch,
      })
      return provider.chatModel(modelId)
    }
  }
}

/**
 * The wire protocol that carries hosted search for a provider/model pair.
 *
 * First-party providers search over their own protocol. OpenRouter's search is
 * its own server tool, so it serves any model that takes tool calls rather than
 * only the vendors that host one. An OpenAI-compatible
 * endpoint is the interesting case: chat-completions has no hosted-search tool,
 * so on that protocol "model's own search" can never work — which is why the
 * option used to be permanently greyed out. But the gateways people actually
 * point this at (one-api, new-api, OpenRouter-likes, vendor relays) almost
 * always also expose the vendor's native surface at the same base URL:
 * `/v1/messages` for Claude and `/v1/responses` for GPT. So for those two
 * families a native-search request is routed over the native protocol instead.
 * An endpoint that turns out not to serve it fails with an ordinary upstream
 * error, which is the same contract every other capability guess here has.
 */
export type SearchRoute = 'anthropic' | 'openai' | 'google' | 'openrouter'

export function nativeSearchRoute(config: ProviderConfig, modelId: string): SearchRoute | null {
  if (config.kind === 'openrouter') return inferCapabilities(modelId).tools ? 'openrouter' : null
  if (config.kind !== 'openai-compatible') {
    return inferCapabilities(modelId).nativeSearch ? config.kind : null
  }
  if (!config.baseUrl) return null
  const bare = modelId.toLowerCase().replace(/^~/, '').replace(/^[a-z0-9-]+\//, '')
  if (!inferCapabilities(bare).nativeSearch) return null
  if (bare.startsWith('claude-')) return 'anthropic'
  if (/^(gpt-|o\d)/.test(bare)) return 'openai'
  return null
}

/**
 * A model handle plus its hosted search tool, over whichever protocol carries
 * the search (see `nativeSearchRoute`). Null when the pair has no hosted search.
 */
export function createNativeSearch(
  config: ProviderConfig,
  modelId: string,
): { model: LanguageModel; tools: ToolSet; route: SearchRoute } | null {
  const route = nativeSearchRoute(config, modelId)
  if (!route) return null

  const apiKey = secretPlaceholder(secretNameForProvider(config.id))
  const baseURL = config.baseUrl || undefined
  const fetch = tauriFetch

  switch (route) {
    case 'anthropic': {
      const anthropic = createAnthropic({ apiKey, baseURL, fetch })
      return {
        route,
        model: anthropic(modelId),
        // The 2025-03-05 tool, not 2026-02-09: the newer one filters results in
        // Anthropic's code-execution sandbox and adds that beta to the request,
        // which session and gateway tokens are refused ("not allowed to use tool
        // bash_code_execution_20250825"). The plain search needs no sandbox.
        tools: { web_search: anthropic.tools.webSearch_20250305({ maxUses: 3 }) },
      }
    }
    case 'openai': {
      const openai = createOpenAI({ apiKey, baseURL, fetch })
      return { route, model: openai.responses(modelId), tools: { web_search: openai.tools.webSearch({}) } }
    }
    case 'google': {
      const google = createGoogleGenerativeAI({ apiKey, baseURL, fetch })
      return { route, model: google(modelId), tools: { google_search: google.tools.googleSearch({}) } }
    }
    case 'openrouter': {
      const openrouter = createOpenRouter({ apiKey, baseURL, fetch })
      return { route, model: openrouter.chat(modelId), tools: { web_search: openrouter.tools.webSearch({}) } }
    }
  }
}

/**
 * Capabilities for a provider/model pair, used to gate UI controls.
 *
 * A custom endpoint is the special case. Its `kind` says nothing about the model
 * behind it, so the conservative default would hide vision from every gateway —
 * including the ones serving Claude and GPT, which is most of them. The model id
 * is a better guide than the provider kind, so the family rules are used for
 * what a model can do, and only the two things a gateway really does change are
 * overridden: reasoning depth is left alone (endpoints disagree about the
 * parameter), and hosted search follows the native-protocol route.
 */
export function capabilitiesFor(config: ProviderConfig, modelId: string): Capabilities {
  if (config.kind !== 'openai-compatible') {
    const inferred = inferForProvider(config.kind, modelId)
    return {
      ...inferred,
      nativeSearch: nativeSearchRoute(config, modelId) !== null,
      // Only the native Gemini protocol carries an audio file part.
      audio: inferred.audio && config.kind === 'google',
    }
  }

  const known = inferCapabilities(modelId)
  return {
    ...known,
    audio: false,
    // Depth is inferred from the model id, like vision and search, and the
    // provider's own setting overrides it. Flattening this to 'none' was wrong
    // for the case that matters most: a gateway relaying Claude and GPT does
    // accept a depth parameter, and hiding the control hides a real feature.
    thinking: reasoningControlFor(config, modelId, known.thinking),
    nativeSearch: nativeSearchRoute(config, modelId) !== null,
  }
}

/**
 * Which depth control a compatible endpoint gets.
 *
 * `auto` keeps the model-id inference. The explicit settings exist for servers
 * that disagree with the convention: one that takes a token budget, or a strict
 * one where the right answer is to send nothing at all rather than risk a 400.
 */
export function reasoningControlFor(
  config: ProviderConfig,
  _modelId: string,
  inferred: ThinkingControl,
): ThinkingControl {
  switch (config.reasoningWire ?? 'auto') {
    case 'effort':
      return 'effort'
    case 'budget':
      return 'budget'
    case 'none':
      return 'none'
    default:
      return inferred
  }
}

/**
 * Why a reasoning model has no depth control on this endpoint.
 *
 * A model that necessarily reasons, behind an endpoint configured to send no
 * depth parameter: the composer has nothing to offer, and saying so in a tooltip
 * is better than an absent control the user cannot account for.
 */
export function reasoningNoteFor(config: ProviderConfig, modelId: string): string | null {
  if (config.kind !== 'openai-compatible') return null
  if (inferCapabilities(modelId).thinking === 'none') return null
  return reasoningControlFor(config, modelId, inferCapabilities(modelId).thinking) === 'none'
    ? t(providers.reasoningParamDisabled)
    : null
}

/**
 * Human-readable label for a model.
 *
 * Model ids are lowercase and hyphenated (`claude-opus-5-5`), which reads badly
 * in a chip. This restores the vendor's own capitalisation for the families we
 * know, and folds a trailing `-5-5` into `5.5` — the ids encode a version as
 * hyphen-separated digits, so `claude-opus-5-5` should display as
 * "Claude Opus 5.5", exactly as the vendor writes it.
 *
 * Unknown ids fall back to title-cased words rather than being shown raw, so a
 * self-hosted model still looks intentional.
 */
const FAMILY_CASE: Record<string, string> = {
  gpt: 'GPT',
  claude: 'Claude',
  gemini: 'Gemini',
  llama: 'Llama',
  mistral: 'Mistral',
  mixtral: 'Mixtral',
  qwen: 'Qwen',
  deepseek: 'DeepSeek',
  grok: 'Grok',
  command: 'Command',
  o: 'o',
}

export function displayName(modelId: string): string {
  // Strip OpenRouter's traffic prefix and vendor namespace, plus any date
  // snapshot suffix (`-20260401`), none of which help identify the model.
  const bare = modelId
    .replace(/^~/, '')
    .replace(/^[a-z0-9-]+\//, '')
    .replace(/-\d{8}$/, '')

  const parts = bare.split('-').filter(Boolean)
  if (!parts.length) return modelId

  const head = FAMILY_CASE[parts[0].toLowerCase()] ?? capitalize(parts[0])
  const rest = parts.slice(1)

  // Fold a trailing pair of version digits: `5`,`5` -> `5.5`.
  const words: string[] = []
  for (let i = 0; i < rest.length; i += 1) {
    const current = rest[i]
    const next = rest[i + 1]
    if (/^\d+$/.test(current) && next !== undefined && /^\d+$/.test(next)) {
      words.push(`${current}.${next}`)
      i += 1
      continue
    }
    words.push(/^\d+$/.test(current) ? current : capitalize(current))
  }

  // `gpt-5` reads better as "GPT-5" than "GPT 5".
  const separator = head === 'GPT' && /^\d/.test(words[0] ?? '') ? '-' : ' '
  return [head, ...words].join(separator)
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1)
}
