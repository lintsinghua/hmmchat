import type { JSONValue } from 'ai'
import type { ReasoningLevel } from '@/chat/types'
import type { ReasoningParam, ThinkingControl } from './capabilities'
import { t } from '@/i18n/core'
import { providers } from '@/i18n'

/**
 * Maps one abstract depth setting onto each provider's own parameter.
 *
 * The levels the UI exposes are deliberately coarse. Providers disagree
 * about both the parameter and whether reasoning can be turned off at all, so:
 *
 * - Anthropic's newest models **cannot disable thinking**. `off` therefore
 *   means the lowest available effort rather than no thinking. Sending
 *   `{type: 'disabled'}` there is a 400, which is why it is never emitted.
 * - Reasoning text is **omitted by default** on current Anthropic models, so
 *   `display: 'summarized'` is set explicitly. Without it the reasoning panel
 *   streams empty strings and looks broken.
 * - Gemini's `thinkingBudget: 0` is only valid on Flash-class models; Pro
 *   requires a minimum, so `off` uses `minimal` level semantics instead.
 *
 * The return types are expressed in the AI SDK's JSON vocabulary so the result
 * can be handed to `streamText`'s `providerOptions` without a cast.
 */

/** One provider's option bag. */
type ProviderOptionBag = Record<string, JSONValue>

/** The whole `providerOptions` argument: keyed by provider name. */
export type ProviderOptions = Record<string, ProviderOptionBag>

export type ProviderKind = 'anthropic' | 'openai' | 'google' | 'openrouter' | 'openai-compatible'

/** Anthropic effort levels, in the order the API accepts them. */
const ANTHROPIC_EFFORT = ['low', 'medium', 'high', 'xhigh', 'max'] as const
type AnthropicEffort = (typeof ANTHROPIC_EFFORT)[number]

/**
 * Anthropic effort for one level, within the values the model accepts.
 *
 * `off` collapses to `low`: it is the cheapest setting that still succeeds on
 * models where thinking is mandatory. On a model that *can* be switched off,
 * `anthropicOptionsFor` sends `disabled` instead. `xhigh` and `max` exist only
 * on the newest models; elsewhere they clamp to the deepest value listed.
 */
function anthropicEffort(level: ReasoningLevel, values: string[]): AnthropicEffort {
  if (level === 'off') return 'low'
  const known = values.filter((value): value is AnthropicEffort =>
    (ANTHROPIC_EFFORT as readonly string[]).includes(value),
  )
  if (!known.length) return level === 'xhigh' || level === 'max' ? 'high' : level
  return vendorValue(level, known, 'high') as AnthropicEffort
}

/** Gemini 2.5 token budgets, kept inside the range the API accepts. */
const GEMINI_BUDGETS: Record<ReasoningLevel, number> = {
  off: 0,
  low: 2048,
  medium: 8192,
  high: 24576,
  xhigh: 24576,
  max: 24576,
}

/**
 * Anthropic provider options for one depth level.
 *
 * Returns a `providerOptions` fragment to spread into the SDK call.
 */
export function anthropicOptionsFor(
  level: ReasoningLevel,
  control: ThinkingControl,
  params?: ReasoningParam[],
): ProviderOptionBag {
  // A model that genuinely supports switching thinking off should do so: it is
  // cheaper and faster than the lowest effort level.
  if (level === 'off' && control === 'budget') {
    return { thinking: { type: 'disabled' } }
  }

  if (control === 'budget') {
    // Pre-4.6 models take an explicit token budget. The minimum is 1024 and it
    // must stay below max_tokens, so the values here are deliberately modest.
    const budget = level === 'low' ? 2048 : level === 'medium' ? 8192 : 24576
    return { thinking: { type: 'enabled', budgetTokens: budget } }
  }

  // Current models: adaptive thinking with an effort level. `display` must be
  // set explicitly — the API's default omits reasoning text entirely.
  return {
    thinking: { type: 'adaptive', display: 'summarized' },
    effort: anthropicEffort(level, effortValues(params)),
  }
}

/**
 * Picks the vendor value nearest to a requested depth.
 *
 * The control offers up to six levels; the vendor may offer any set — `high` only,
 * `minimal|low|high`, `none|low|medium|high|xhigh|max`. Sending a level the
 * model does not list is a 400, so the requested depth is mapped onto the
 * nearest value the model actually accepts. Extremes clamp rather than wrap:
 * asking for the deepest setting on a `high`-only model gives `high`, not an
 * error and not something shallower.
 */
export function vendorValue(level: ReasoningLevel, values: string[], fallback: string): string {
  if (level === 'off') {
    if (values.includes('none')) return 'none'
    if (values.includes('minimal')) return 'minimal'
    return fallback
  }
  if (values.includes(level)) return level

  // Off the ladder: take the nearest rung by position.
  const ladder = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max']
  const wanted = ladder.indexOf(level)
  let best = fallback
  let bestDistance = Number.POSITIVE_INFINITY
  for (const value of values) {
    const at = ladder.indexOf(value)
    if (at === -1) continue
    const distance = Math.abs(at - wanted)
    // Ties go to the shallower rung: an unexpected bill is a worse surprise
    // than an answer that thought slightly less.
    if (distance < bestDistance) {
      bestDistance = distance
      best = value
    }
  }
  return best
}

/** The values a model publishes for effort, if any. */
function effortValues(params: ReasoningParam[] | undefined): string[] {
  const effort = params?.find((param) => param.kind === 'effort')
  return effort && effort.kind === 'effort' ? effort.values : []
}

/**
 * The level as a vendor value when the model publishes no vocabulary.
 *
 * `xhigh` and `max` are not universal, so an unknown model gets `high` at most
 * rather than a value it may reject.
 */
function plainEffort(level: ReasoningLevel, off: string): string {
  if (level === 'off') return off
  return level === 'xhigh' || level === 'max' ? 'high' : level
}

/** OpenAI provider options for one depth level. */
export function openaiOptionsFor(
  level: ReasoningLevel,
  params?: ReasoningParam[],
): ProviderOptionBag {
  // Once the catalog's vocabulary is known, send a value from it: the o-series
  // has no `none`, and pre-5.1 gpt-5 has no `none` either — its floor is
  // `minimal`. Sending `none` to either is a 400 on every message.
  const values = effortValues(params)
  const effort = values.length ? vendorValue(level, values, values[0]) : plainEffort(level, 'none')
  return {
    reasoningEffort: effort,
    // Ask for a human-readable summary; without it the reasoning stream is empty.
    reasoningSummary: 'auto',
  }
}

/** Google provider options for one depth level. */
export function googleOptionsFor(
  level: ReasoningLevel,
  control: ThinkingControl,
  params?: ReasoningParam[],
): ProviderOptionBag {
  if (control === 'level' || control === 'effort') {
    // Gemini accepts a named level and rejects a numeric budget on these
    // models. The level names come from the model's own list where published,
    // because they are not the same set across generations.
    const values = effortValues(params)
    const thinkingLevel = values.length ? vendorValue(level, values, 'high') : plainEffort(level, 'minimal')
    return { thinkingConfig: { thinkingLevel, includeThoughts: true } }
  }

  // A numeric budget, clamped into the range the model accepts: below the floor
  // is a 400, above the ceiling is a 400.
  const budget = params?.find((param) => param.kind === 'budget')
  const wanted = GEMINI_BUDGETS[level]
  const clamped =
    budget && budget.kind === 'budget'
      ? Math.min(budget.max ?? wanted, Math.max(budget.min, wanted))
      : wanted

  return {
    thinkingConfig: { thinkingBudget: clamped, includeThoughts: true },
  }
}

/** OpenRouter normalises effort across whatever model sits behind it. */
export function openrouterOptionsFor(
  level: ReasoningLevel,
  params?: ReasoningParam[],
): ProviderOptionBag {
  const values = effortValues(params)
  const effort = values.length ? vendorValue(level, values, values[0]) : plainEffort(level, 'none')
  return {
    reasoning: { effort },
    // OpenRouter only returns usage accounting when asked.
    usage: { include: true },
  }
}

/**
 * Builds the `providerOptions` object for a call.
 *
 * `reasoning: 'off'` on a provider whose models cannot stop thinking still
 * produces a valid request — the lowest level is used instead of an error.
 */
export function providerOptionsFor(
  kind: ProviderKind,
  level: ReasoningLevel,
  control: ThinkingControl,
  params?: ReasoningParam[],
): ProviderOptions | undefined {
  if (control === 'none') return undefined

  switch (kind) {
    case 'anthropic':
      return { anthropic: anthropicOptionsFor(level, control, params) }
    case 'openai':
      return { openai: openaiOptionsFor(level, params) }
    case 'google':
      return { google: googleOptionsFor(level, control, params) }
    case 'openrouter':
      return { openrouter: openrouterOptionsFor(level, params) }
    case 'openai-compatible':
      // Built by `compatibleOptionsFor` instead: this provider names its options
      // bag after the configured provider's own id, so the key is not knowable
      // from the kind alone.
      return undefined
  }
}

/**
 * Options for an OpenAI-compatible endpoint.
 *
 * `reasoningEffort` is the field this provider reads, and it writes it to the
 * wire as `reasoning_effort` — the name almost every compatible server already
 * follows for reasoning models, including the ones relaying Claude and GPT.
 * `off` maps to `none`, which strict OpenAI endpoints accept; a server that
 * rejects unknown fields is configured with `reasoningWire: 'none'` instead, so
 * this is never called for it.
 */
export function compatibleOptionsFor(
  level: ReasoningLevel,
  control: ThinkingControl,
  params?: ReasoningParam[],
): ProviderOptionBag | undefined {
  if (control === 'none') return undefined

  // A hybrid model with an on/off switch. `reasoning_effort: "none"` is the
  // convention the compatible servers follow for switching a thinking model's
  // reasoning off (vLLM, SGLang, llama.cpp and the relays of them all accept
  // it); there is nothing meaningful to send to turn it back on, so the request
  // is left alone.
  if (control === 'toggle') {
    return level === 'off' ? { reasoningEffort: 'none' } : undefined
  }

  // A server that exposes Anthropic's budget field instead. The values match
  // the ones `anthropicOptionsFor` sends, so the two controls behave alike.
  if (control === 'budget') {
    const budget = level === 'off' ? 0 : level === 'low' ? 2048 : level === 'medium' ? 8192 : 24576
    return budget ? { thinking: { type: 'enabled', budgetTokens: budget } } : undefined
  }

  const values = effortValues(params)
  const effort = values.length ? vendorValue(level, values, values[0]) : plainEffort(level, 'none')
  return { reasoningEffort: effort }
}

/**
 * The depth levels this model's own parameters can actually honour.
 *
 * Read from the model's accepted values rather than from its provider, which is
 * the whole point of carrying the catalog: a model whose vocabulary excludes
 * `medium` gets a control without it, and one that accepts `none` gets a real
 * off switch while a model that cannot stop thinking does not — an `off` that
 * silently did nothing would be a lie in the UI.
 *
 * A `toggle` model has no depth to speak of: off, or on.
 */
export function availableLevels(
  control: ThinkingControl,
  params: ReasoningParam[] = [],
): ReasoningLevel[] {
  if (control === 'none') return []

  if (control === 'toggle') return ['off', 'high']

  if (control === 'effort' || control === 'level') {
    const effort = params.find((param) => param.kind === 'effort')
    if (!effort || effort.kind !== 'effort') return ['off', 'low', 'medium', 'high']

    const levels: ReasoningLevel[] = []
    for (const value of effort.values) {
      if (value === 'none') levels.push('off')
      else if (
        value === 'low' ||
        value === 'medium' ||
        value === 'high' ||
        value === 'xhigh' ||
        value === 'max'
      ) {
        levels.push(value)
      }
    }
    // `minimal` has no level of its own; it is the shallowest the model goes,
    // so it stands in for off when the vocabulary has no `none`.
    if (effort.values.includes('minimal') && !levels.includes('off')) levels.unshift('off')
    return levels.length ? [...new Set(levels)].sort(orderLevels) : ['off', 'low', 'medium', 'high']
  }

  // A budget model: off means no thinking, which is only true when the vendor
  // allows a zero budget.
  const budget = params.find((param) => param.kind === 'budget')
  const canDisable = !budget || budget.kind !== 'budget' || budget.min === 0
  return canDisable ? ['off', 'low', 'medium', 'high'] : ['low', 'medium', 'high']
}

/**
 * Whether a depth is worth offering at all.
 *
 * A model with one possible value has nothing to choose — `gpt-5-pro` reasons
 * at `high` and at no other depth. Rendering a one-option control would give the
 * user a switch that cannot move; the app sends the model's own value either
 * way, so hiding it costs nothing and says less.
 */
export function hasDepthChoice(control: ThinkingControl, params: ReasoningParam[] = []): boolean {
  return availableLevels(control, params).length > 1
}

/** Every level in increasing depth, with `off` first. */
const LEVEL_ORDER: ReasoningLevel[] = ['off', 'low', 'medium', 'high', 'xhigh', 'max']

function orderLevels(a: ReasoningLevel, b: ReasoningLevel): number {
  return LEVEL_ORDER.indexOf(a) - LEVEL_ORDER.indexOf(b)
}

/**
 * The level a model actually runs at when `wanted` is not one it offers.
 *
 * A column's chosen depth can outlive the model it was chosen for — the lane
 * switches to a model without `max`, or never had its own choice and inherits
 * the single-column one. The control has to highlight what will be sent, so it
 * takes the nearest offered level; ties go shallower, as `vendorValue` does.
 */
export function effectiveLevel(wanted: ReasoningLevel, levels: ReasoningLevel[]): ReasoningLevel {
  if (!levels.length || levels.includes(wanted)) return wanted
  const at = LEVEL_ORDER.indexOf(wanted)
  let best = levels[0]
  for (const level of levels) {
    if (Math.abs(LEVEL_ORDER.indexOf(level) - at) < Math.abs(LEVEL_ORDER.indexOf(best) - at)) best = level
  }
  return best
}

/** Read at access time so the label follows the interface language. */
export const REASONING_LABELS: Record<ReasoningLevel, string> = {
  get off() { return t(providers.reasoningOff) },
  get low() { return t(providers.reasoningLow) },
  get medium() { return t(providers.reasoningMedium) },
  get high() { return t(providers.reasoningHigh) },
  get xhigh() { return t(providers.reasoningXhigh) },
  get max() { return t(providers.reasoningMax) },
}
