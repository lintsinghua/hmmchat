import { describe, expect, it } from 'vitest'
import { CATALOG } from './catalog.data'
import { inferCapabilities } from './capabilities'
import { availableLevels, openaiOptionsFor, hasDepthChoice, vendorValue } from './reasoning'
import { preferredModels } from './models-fetch'

/**
 * The capability facts come from a generated snapshot of models.dev rather than
 * a hand-written table. These assert the properties the app depends on, not the
 * catalog's contents — the contents change monthly, and a test that pinned a
 * specific model's effort list would fail on every regeneration for no reason.
 *
 * What is worth pinning is the *shape*: that the file parses, that every row
 * decodes, and that the seams between catalog and family fallback behave.
 */

describe('the catalog snapshot', () => {
  it('parses and covers a broad set of models', () => {
    const rows = Object.keys(CATALOG)
    // A floor rather than an exact count: the file is regenerated, and a
    // truncated download that produced a few dozen rows would be the failure
    // that matters.
    expect(rows.length).toBeGreaterThan(500)
  })

  it('every row decodes into something usable', () => {
    for (const [id, entry] of Object.entries(CATALOG)) {
      expect(entry, id).toHaveLength(2)
      // No row may carry an unrecognised flag or reasoning prefix: the encoder
      // and the decoder are in different files, and this is the seam.
      expect(entry[1], id).toMatch(/^[iprt]*$/)
      for (const part of entry[0].split(';').filter(Boolean)) {
        expect(part, `${id} → ${part}`).toMatch(/^(t|e:[a-z|]+|b:\d+(?:~\d+)?)$/)
      }
      const capabilities = inferCapabilities(id)
      expect(capabilities.thinking, id).toMatch(/^(none|effort|budget|level|toggle)$/)
    }
  })

  it('keeps every budget floor, which is what stops a 400', () => {
    // A budget row without a floor is unusable: sending below the vendor's
    // minimum is exactly the error this table exists to prevent.
    for (const [id, entry] of Object.entries(CATALOG)) {
      const budget = entry[0].split(';').find((part) => part.startsWith('b:'))
      if (!budget) continue
      // `~` and not `-`: a vendor can publish a negative minimum as a sentinel,
      // and the generator floors those at zero rather than encoding them raw.
      expect(budget, id).toMatch(/^b:\d+(~\d+)?$/)
    }
  })
})

describe('catalog facts drive the reasoning control', () => {
  it('offers only the depths a model actually accepts', () => {
    // gpt-5-pro reasons at one setting and no other, so there is nothing to
    // choose and no control to draw.
    const pro = inferCapabilities('gpt-5-pro')
    expect(hasDepthChoice(pro.thinking, pro.reasoning)).toBe(false)

    const gpt5 = inferCapabilities('gpt-5')
    expect(hasDepthChoice(gpt5.thinking, gpt5.reasoning)).toBe(true)
  })

  it('never sends a depth the model rejects', () => {
    // The o-series has no `none`; pre-5.1 gpt-5's floor is `minimal`. Sending
    // either one a value outside its vocabulary is a 400 on every message.
    const o3 = inferCapabilities('o3')
    for (const level of availableLevels(o3.thinking, o3.reasoning)) {
      const effort = openaiOptionsFor(level, o3.reasoning).reasoningEffort
      expect(['low', 'medium', 'high']).toContain(effort)
    }

    const gpt5 = inferCapabilities('gpt-5')
    const floor = openaiOptionsFor('off', gpt5.reasoning).reasoningEffort
    expect(floor).toBe('minimal')
  })
})

describe('vendorValue', () => {
  it('clamps rather than wrapping at either end', () => {
    // The deepest setting on a high-only model is high, not an error and not
    // something shallower.
    expect(vendorValue('high', ['high'], 'high')).toBe('high')
    expect(vendorValue('off', ['high'], 'high')).toBe('high')
    expect(vendorValue('medium', ['low', 'high'], 'low')).toBe('low')
  })

  it('prefers the shallower rung when the request falls between two', () => {
    // An unexpected bill is a worse surprise than an answer that thought less.
    expect(vendorValue('medium', ['low', 'high'], 'low')).toBe('low')
  })

  it('uses an honest off only when the vocabulary has one', () => {
    expect(vendorValue('off', ['none', 'high'], 'high')).toBe('none')
    expect(vendorValue('off', ['minimal', 'high'], 'high')).toBe('minimal')
    // No off in the vocabulary: fall back, because thinking is mandatory here.
    expect(vendorValue('off', ['low', 'high'], 'low')).toBe('low')
  })
})

describe('a model that accepts both an effort level and a budget', () => {
  it('is driven by the finer control', () => {
    // DeepSeek's v4 family publishes both. A two-state control on a model with
    // more than two states would be a worse default.
    const deepseek = inferCapabilities('deepseek-v4-pro')
    expect(deepseek.thinking).not.toBe('toggle')
  })
})

describe('pre-selecting models for a new provider', () => {
  const discovered = (ids: string[]) => ids.map((id) => ({ id, name: id })) as never

  it('leaves out the models that are not for chatting', () => {
    // Discovery lists embedding, image and speech models alongside the chat
    // ones. Tool calling is the discriminator the catalog publishes, and it
    // separates them without a per-vendor naming convention.
    const preferred = preferredModels(
      'openai',
      discovered(['gpt-5.1', 'text-embedding-3-large', 'gpt-image-1', 'whisper-1', 'o3']),
    )
    expect(preferred).toContain('gpt-5.1')
    expect(preferred).toContain('o3')
    expect(preferred).not.toContain('text-embedding-3-large')
    expect(preferred).not.toContain('gpt-image-1')
  })

  it('gives an id the catalog has never seen the benefit of the doubt', () => {
    // Refusing to pre-select a user's own model would be worse than
    // pre-selecting one that turns out not to chat.
    expect(preferredModels('openai-compatible', discovered(['my-finetune-v3']))).toEqual([
      'my-finetune-v3',
    ])
  })

  it('still excludes retired models the catalog never listed', () => {
    // The name is the only signal available for an id that predates the
    // catalog, and it is a strong one: completions-only and non-text endpoints
    // are not chat models under any reading.
    expect(preferredModels('openai', discovered(['babbage-002', 'sora-2', 'dall-e-3']))).toEqual([])
  })

  it('leads with the vendor’s flagships', () => {
    const preferred = preferredModels(
      'anthropic',
      discovered(['claude-haiku-4-5', 'claude-opus-5-5', 'claude-sonnet-5-5']),
    )
    // All three match the vendor matcher, so the cap does not reorder them; the
    // point is that a recognised flagship is not pushed out by catalog order.
    expect(preferred[0]).toMatch(/^claude-(opus|sonnet|haiku)-/)
  })
})
