/**
 * Model capability inference.
 *
 * The facts come from the models.dev catalog, vendored as a generated snapshot
 * (`catalog.data.ts`) — every vendor, every model, with the reasoning options
 * each one actually accepts. That replaced a hand-written list of regexes that
 * was wrong in ways nobody could see: whole vendors flattened to "no thinking",
 * and an `xhigh` level the UI could never reach.
 *
 * Regex rules remain underneath, for ids the catalog has never heard of: a
 * brand-new model, a self-hosted rename, a gateway's own alias. They are a
 * *fallback*, and they reason about families rather than pretending to know
 * individual models.
 *
 * Everything here is a hint, not a guarantee — the UI uses it to hide a control
 * that would certainly fail, and the user can override it per provider in
 * settings. Getting one wrong degrades to an upstream error message.
 */

import { CATALOG } from './catalog.data'

export type ThinkingControl =
  /** Depth is set with an effort level; thinking itself cannot be turned off. */
  | 'effort'
  /** Depth is set with a token budget. */
  | 'budget'
  /** Depth is set with a named level (Gemini). */
  | 'level'
  /** Thinking can be switched off outright. */
  | 'toggle'
  /** The model does not reason. */
  | 'none'

/**
 * One way a model accepts reasoning depth.
 *
 * A model can have several — some take an effort level *and* a token budget —
 * which is why this is a list. The UI offers the controls the model actually
 * accepts rather than one control per provider.
 */
export type ReasoningParam =
  /** Named effort levels, exactly the set the vendor documents. */
  | { kind: 'effort'; values: string[] }
  /** A plain on/off switch, with nothing finer. */
  | { kind: 'toggle' }
  /** A token budget, with the range the vendor accepts. */
  | { kind: 'budget'; min: number; max?: number }

export interface Capabilities {
  /** How to control reasoning depth, if at all. */
  thinking: ThinkingControl
  /** The concrete parameters behind `thinking`. Empty when nothing is sent. */
  reasoning: ReasoningParam[]
  /** Can call functions/tools — required for bring-your-own web search. */
  tools: boolean
  /** Has a provider-hosted web search tool. */
  nativeSearch: boolean
  vision: boolean
  /** The model accepts PDF documents as input. */
  pdf: boolean
}

const NONE: Capabilities = {
  thinking: 'none',
  reasoning: [],
  tools: true,
  nativeSearch: false,
  vision: false,
  pdf: false,
}

/**
 * Capabilities for an id the catalog does not know.
 *
 * Deliberately conservative, and deliberately coarse: these match a *family*,
 * not a model. A brand-new Claude is assumed to reason like the Claudes before
 * it and to see images, because that has been true of every generation. It is
 * not assumed to accept a token budget, because whether a family moved to
 * effort levels is exactly the kind of detail the catalog exists to answer.
 *
 * `nativeSearch` is not set by these rules; `hostedSearch` below decides it.
 */
const FALLBACK: Array<{ test: RegExp; capabilities: Partial<Capabilities> }> = [
  // --- Anthropic: every generation reasons and sees ------------------------
  {
    test: /^claude-/,
    capabilities: {
      thinking: 'effort',
      reasoning: [{ kind: 'effort', values: ['low', 'medium', 'high', 'xhigh', 'max'] }],
      vision: true,
      pdf: true,
    },
  },

  // --- OpenAI --------------------------------------------------------------
  // A new o-series or gpt-5+ id reasons; the effort vocabulary is inferred
  // without `xhigh`/`max`, which vary by model and which the catalog supplies.
  {
    test: /^(o\d|gpt-5|gpt-6|gpt-7)/,
    capabilities: {
      thinking: 'effort',
      reasoning: [{ kind: 'effort', values: ['low', 'medium', 'high'] }],
      vision: true,
    },
  },
  { test: /^gpt-/, capabilities: { vision: true } },

  // --- Google --------------------------------------------------------------
  {
    test: /^gemini-3/,
    capabilities: {
      thinking: 'level',
      reasoning: [{ kind: 'effort', values: ['minimal', 'low', 'medium', 'high'] }],
      vision: true,
      pdf: true,
    },
  },
  {
    test: /^gemini-2\.5/,
    capabilities: {
      thinking: 'budget',
      reasoning: [{ kind: 'budget', min: 128, max: 32768 }],
      vision: true,
      pdf: true,
    },
  },
  { test: /^gemini-/, capabilities: { vision: true, pdf: true } },

  // --- Vendors whose reasoning models are hybrid ---------------------------
  // These gate thinking with a switch; the finer levels, where they exist, come
  // from the catalog.
  {
    test: /^(deepseek|glm|kimi|moonshot|qwen|qwq|minimax|step-|ernie|hunyuan|doubao)/,
    capabilities: { thinking: 'toggle', reasoning: [{ kind: 'toggle' }], tools: true },
  },

  // --- xAI -----------------------------------------------------------------
  {
    test: /^grok/,
    capabilities: {
      thinking: 'effort',
      reasoning: [{ kind: 'effort', values: ['low', 'medium', 'high'] }],
      vision: true,
    },
  },

  // --- Open-weight families, mostly served locally -------------------------
  { test: /^(llama|mistral|magistral|mixtral|gemma|phi|command|olmo)/, capabilities: {} },
]

/**
 * Families whose vendor hosts a web search tool on its own protocol: Claude
 * from 3.5 on (`web_search`), OpenAI's gpt-4o/4.1/5+ and o-series on the
 * Responses API (`web_search`), Gemini 2+ (`google_search`).
 *
 * Every hosted search is a tool call, so it also requires tool calling: a
 * catalog row without it is taken at its word, which keeps the image, TTS and
 * `o1-mini`-style variants of a searching family out.
 */
const HOSTED_SEARCH =
  /^(claude-(3[.-][57]|[4-9]|sonnet|opus|haiku|fable)|gpt-(4o|4\.1|[5-9])|o[134](-|$)|gemini-([2-9]|flash|pro))/

/**
 * Reads one row of the generated snapshot.
 *
 * The encoding is documented in `catalog.data.ts` and kept terse because the
 * file ships in the bundle — 1,600 models in 74 KB. An unrecognised row yields
 * nothing rather than throwing, so a future encode change cannot break the app.
 */
function fromCatalog(id: string): ReasoningParam[] {
  const entry = CATALOG[id]
  if (!entry) return []

  // The catalog marks this model as reasoning but publishes no depth options —
  // most of the open-weight models on aggregators, where the catalog knows the
  // model thinks but not how the thinking is steered. The family rules supply
  // the missing half. A row *without* the flag is a model the catalog knows does
  // not reason, and is taken at its word.
  if (!entry[1].includes('r')) return []
  if (!entry[0]) return familyFor(id).reasoning ?? []

  const params: ReasoningParam[] = []
  for (const part of entry[0].split(';')) {
    if (!part) continue
    if (part === 't') {
      params.push({ kind: 'toggle' })
    } else if (part.startsWith('e:')) {
      const values = part.slice(2).split('|').filter(Boolean)
      // `default` is a real value some vendors accept, but it is not a depth the
      // user can choose — it means "whatever the vendor picked".
      const named = values.filter((value) => value !== 'default')
      if (named.length) params.push({ kind: 'effort', values: named })
    } else if (part.startsWith('b:')) {
      const [rawMin, rawMax] = part.slice(2).split('~')
      const min = Number(rawMin)
      // A budget with no floor is unusable: sending below the vendor's minimum
      // is the 400 this whole table exists to avoid.
      if (!Number.isFinite(min)) continue
      params.push({ kind: 'budget', min, max: rawMax ? Number(rawMax) : undefined })
    }
  }
  return params
}

/** The control a set of parameters implies, when the model reasons at all. */
function controlFor(params: ReasoningParam[]): ThinkingControl {
  if (!params.length) return 'none'
  // An effort list is the finest control; a bare toggle is the coarsest. A model
  // offering both is driven by effort, with `off`/`none` turning it off.
  const effort = params.find((param) => param.kind === 'effort')
  if (effort) return 'effort'
  // A budget beats a bare toggle: a model that accepts both (DeepSeek's v4
  // family does) can be driven with a real depth or simply switched off, and a
  // two-state control on a model with more than two states is a worse default.
  if (params.some((param) => param.kind === 'budget')) return 'budget'
  return 'toggle'
}

export function inferCapabilities(modelId: string): Capabilities {
  const id = normalizeModelId(modelId)
  const entry = CATALOG[id]
  const family = familyFor(id)

  if (!entry) {
    // Nothing in the catalog: the family rules are the whole answer.
    const capabilities = { ...NONE, ...family }
    return { ...capabilities, nativeSearch: capabilities.tools && HOSTED_SEARCH.test(id) }
  }

  const reasoning = fromCatalog(id)
  const flags = entry[1]

  return {
    thinking: controlFor(reasoning),
    reasoning,
    tools: flags.includes('t'),
    nativeSearch: flags.includes('t') && HOSTED_SEARCH.test(id),
    vision: flags.includes('i'),
    pdf: flags.includes('p'),
  }
}

/** The family rule matching an id, or the conservative default. */
function familyFor(id: string): Partial<Capabilities> {
  for (const rule of FALLBACK) {
    if (rule.test.test(id)) return rule.capabilities
  }
  return {}
}

/**
 * Reduces a model id to the bare name the rules match against.
 *
 * Two prefixes have to go. OpenRouter returns a traffic-managed id with a
 * leading `~`, and — more importantly — every OpenRouter model is namespaced by
 * vendor (`anthropic/claude-opus-5-5`, `openai/gpt-5`, `meta-llama/llama-4`).
 * Without stripping that segment, no rule would ever match an OpenRouter model
 * and every one of them would look like it has no reasoning and no search.
 */
function normalizeModelId(modelId: string): string {
  const withoutTilde = modelId.toLowerCase().trim().replace(/^~/, '')
  const slash = withoutTilde.indexOf('/')
  // Only strip a single leading vendor segment; a deeper path is not a model id.
  if (slash > 0) {
    const rest = withoutTilde.slice(slash + 1)
    if (rest && !rest.includes('/')) return rest
  }
  return withoutTilde
}

/**
 * Capabilities for a model id behind a known provider kind.
 *
 * Kept as a named seam even though both branches now read the same catalog: the
 * provider kind still decides the wire protocol, and that decision lives in
 * `registry.ts`, not here.
 */
export function inferForProvider(_providerKind: string, modelId: string): Capabilities {
  // Both paths read the catalog: a compatible endpoint serving `claude-opus-5-5`
  // is describing that model, and the catalog knows what it can do regardless of
  // who is relaying it.
  return inferCapabilities(modelId)
}
