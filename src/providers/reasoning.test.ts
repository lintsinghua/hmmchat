import { describe, expect, it } from 'vitest'
import { inferCapabilities } from './capabilities'
import {
  anthropicOptionsFor,
  availableLevels,
  googleOptionsFor,
  openaiOptionsFor,
  openrouterOptionsFor,
  providerOptionsFor,
  effectiveLevel,
} from './reasoning'

/**
 * These assertions encode hard API facts that are easy to get wrong and only
 * surface as a 400 from the provider — `budget_tokens` on a current Anthropic
 * model, or forgetting `display` and getting an empty reasoning stream.
 */

describe('inferCapabilities', () => {
  /**
   * The facts now come from the models.dev snapshot rather than a hand-written
   * table, so these assert what the catalog actually says. Where a value looks
   * surprising it is because the vendor's own documentation is surprising —
   * `gemini-3-pro` publishes no depth options at all, for instance.
   */

  it('reads Claude effort levels straight from the catalog', () => {
    const capabilities = inferCapabilities('claude-opus-5-5')
    expect(capabilities.thinking).toBe('effort')
    expect(capabilities.reasoning).toEqual([
      { kind: 'effort', values: ['low', 'medium', 'high', 'xhigh', 'max'] },
    ])
    // The two extremes are offered as levels of their own, not folded into high.
    expect(availableLevels(capabilities.thinking, capabilities.reasoning)).toEqual([
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ])
  })

  it('reports a budget model as budget-controlled', () => {
    expect(inferCapabilities('claude-haiku-4-5').thinking).toBe('budget')
    expect(inferCapabilities('gemini-2.5-pro').thinking).toBe('budget')
  })

  it('falls back to the family when the catalog publishes no options', () => {
    // The catalog lists this model as reasoning but says nothing about how to
    // steer it, so the family rule supplies the control.
    expect(inferCapabilities('gemini-3-pro').thinking).not.toBe('none')
  })

  it('treats a Gemini newer than the catalog as reasoning by level', () => {
    expect(inferCapabilities('gemini-4-argon').thinking).toBe('level')
    expect(inferCapabilities('google/gemini-4-argon').thinking).toBe('level')
  })

  it('takes a no-reasoning row at its word', () => {
    expect(inferCapabilities('gpt-4o').thinking).toBe('none')
  })

  it('assumes nothing about an unknown model except tool support', () => {
    const capabilities = inferCapabilities('mystery-model-9000')
    expect(capabilities.thinking).toBe('none')
    expect(capabilities.reasoning).toEqual([])
    expect(capabilities.tools).toBe(true)
    expect(capabilities.nativeSearch).toBe(false)
  })

  it('strips the OpenRouter tilde prefix', () => {
    expect(inferCapabilities('~anthropic/claude-opus-5-5').thinking).toBe('effort')
  })

  it('classifies vendor-namespaced ids from OpenRouter', () => {
    // Without stripping the vendor segment nothing would match, and every
    // OpenRouter model would lose its reasoning control and its vision.
    const claude = inferCapabilities('anthropic/claude-sonnet-5-5')
    expect(claude.thinking).toBe('effort')
    expect(claude.vision).toBe(true)

    expect(inferCapabilities('openai/gpt-5').thinking).toBe('effort')
    expect(inferCapabilities('google/gemini-2.5-pro').vision).toBe(true)
  })

  it('carries the file kinds a model accepts', () => {
    // Both read the model's own modality list, and they are not the same flag:
    // the catalog has models that take a PDF and not a picture.
    const claude = inferCapabilities('claude-opus-5-5')
    expect(claude.vision).toBe(true)
    expect(claude.pdf).toBe(true)

    const textOnly = inferCapabilities('deepseek-chat')
    expect(textOnly.vision).toBe(false)
    expect(textOnly.pdf).toBe(true)
  })
})

describe('availableLevels', () => {
  it('hides "off" when the model has no way to stop thinking', () => {
    // Offering 关闭 where thinking is mandatory would be a lie in the UI.
    const capabilities = inferCapabilities('claude-opus-5-5')
    expect(availableLevels(capabilities.thinking, capabilities.reasoning)).not.toContain('off')
  })

  it('offers "off" when the model accepts none', () => {
    const capabilities = inferCapabilities('gpt-5')
    expect(availableLevels(capabilities.thinking, capabilities.reasoning)).toContain('off')
  })

  it('offers the extremes and sends them as the vendor names them', () => {
    // Selecting the deepest level must reach the vendor's deepest value; mapping
    // it to `high` would silently cap the model below what the user asked for.
    const astra = inferCapabilities('gpt-6-astra')
    const levels = availableLevels(astra.thinking, astra.reasoning)
    expect(levels).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
    expect(openaiOptionsFor('xhigh', astra.reasoning).reasoningEffort).toBe('xhigh')
    expect(openaiOptionsFor('max', astra.reasoning).reasoningEffort).toBe('max')

    const opus = inferCapabilities('claude-opus-5-5')
    expect(anthropicOptionsFor('max', opus.thinking, opus.reasoning)).toMatchObject({ effort: 'max' })
  })

  it('clamps an extreme the model does not accept to its deepest value', () => {
    // The composer's level is shared across lanes, so a model without `max`
    // still receives it and must not get a 400.
    expect(openaiOptionsFor('max', [{ kind: 'effort', values: ['low', 'medium', 'high'] }])).toMatchObject({
      reasoningEffort: 'high',
    })
    expect(openaiOptionsFor('max', [{ kind: 'effort', values: ['low', 'high', 'xhigh'] }])).toMatchObject({
      reasoningEffort: 'xhigh',
    })
    const opus45 = inferCapabilities('claude-opus-4-5')
    expect(anthropicOptionsFor('max', opus45.thinking, opus45.reasoning)).toMatchObject({ effort: 'high' })
    // No published vocabulary: never guess a value beyond `high`.
    expect(openaiOptionsFor('max')).toMatchObject({ reasoningEffort: 'high' })
  })

  it('offers only on and off for a toggle model', () => {
    expect(availableLevels('toggle', [{ kind: 'toggle' }])).toEqual(['off', 'high'])
  })

  it('offers nothing for a model that does not reason', () => {
    expect(availableLevels('none')).toEqual([])
  })

  it('falls back to the full range when the parameters are unknown', () => {
    // A model the catalog says reasons but whose options are unpublished.
    expect(availableLevels('effort', [])).toEqual(['off', 'low', 'medium', 'high'])
  })
})

describe('effectiveLevel', () => {
  it('snaps a depth the model does not offer to the nearest it does', () => {
    // A column inheriting 最高 from another model, or switched to one without
    // it, must highlight what will actually be sent.
    expect(effectiveLevel('max', ['low', 'medium', 'high'])).toBe('high')
    expect(effectiveLevel('medium', ['off', 'high'])).toBe('high')
    expect(effectiveLevel('off', ['low', 'medium', 'high'])).toBe('low')
    // Equidistant: the shallower one.
    expect(effectiveLevel('medium', ['low', 'high'])).toBe('low')
    expect(effectiveLevel('high', ['low', 'medium', 'high'])).toBe('high')
  })
})

describe('anthropicOptionsFor', () => {
  it('never sends budget_tokens on an effort-controlled model', () => {
    // budget_tokens is a hard 400 on current models, including for "off".
    for (const level of ['off', 'low', 'medium', 'high'] as const) {
      const options = anthropicOptionsFor(level, 'effort')
      expect(JSON.stringify(options)).not.toContain('budgetTokens')
      expect(options).toHaveProperty('effort')
    }
  })

  it('always requests a reasoning summary', () => {
    // The API default is `omitted`, which streams empty thinking text.
    const options = anthropicOptionsFor('medium', 'effort') as {
      thinking: { type: string; display?: string }
    }
    expect(options.thinking.type).toBe('adaptive')
    expect(options.thinking.display).toBe('summarized')
  })

  it('collapses "off" to the lowest effort when thinking cannot be disabled', () => {
    expect(anthropicOptionsFor('off', 'effort')).toMatchObject({ effort: 'low' })
  })

  it('actually disables thinking on a budget-controlled model', () => {
    expect(anthropicOptionsFor('off', 'budget')).toEqual({ thinking: { type: 'disabled' } })
  })

  it('uses a token budget on older models', () => {
    expect(anthropicOptionsFor('high', 'budget')).toEqual({
      thinking: { type: 'enabled', budgetTokens: 24576 },
    })
  })
})

describe('openaiOptionsFor', () => {
  it('maps off to none and asks for a summary', () => {
    expect(openaiOptionsFor('off')).toMatchObject({ reasoningEffort: 'none' })
    expect(openaiOptionsFor('medium')).toMatchObject({
      reasoningEffort: 'medium',
      reasoningSummary: 'auto',
    })
  })
})

describe('googleOptionsFor', () => {
  it('uses a named level on Gemini 3 and never a budget', () => {
    const options = googleOptionsFor('high', 'level') as {
      thinkingConfig: { thinkingLevel: string; thinkingBudget?: number }
    }
    expect(options.thinkingConfig.thinkingLevel).toBe('high')
    expect(options.thinkingConfig).not.toHaveProperty('thinkingBudget')
  })

  it('uses a numeric budget on Gemini 2.5', () => {
    const options = googleOptionsFor('low', 'budget') as {
      thinkingConfig: { thinkingBudget?: number }
    }
    expect(options.thinkingConfig.thinkingBudget).toBe(2048)
  })

  it('always asks for thoughts to be included', () => {
    const options = googleOptionsFor('medium', 'level') as {
      thinkingConfig: { includeThoughts?: boolean }
    }
    expect(options.thinkingConfig.includeThoughts).toBe(true)
  })
})

describe('openrouterOptionsFor', () => {
  it('normalises the level and requests usage accounting', () => {
    expect(openrouterOptionsFor('low')).toMatchObject({
      reasoning: { effort: 'low' },
      usage: { include: true },
    })
  })
})

describe('providerOptionsFor', () => {
  it('returns nothing for a model that does not reason', () => {
    expect(providerOptionsFor('openai', 'high', 'none')).toBeUndefined()
  })

  it('keys the options by provider name', () => {
    expect(providerOptionsFor('anthropic', 'high', 'effort')).toHaveProperty('anthropic')
    expect(providerOptionsFor('openrouter', 'high', 'budget')).toHaveProperty('openrouter')
  })

  it('sends nothing for a custom endpoint, which may reject unknown fields', () => {
    expect(providerOptionsFor('openai-compatible', 'high', 'effort')).toBeUndefined()
  })
})
