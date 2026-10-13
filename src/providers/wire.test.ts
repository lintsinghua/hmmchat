import { describe, expect, it } from 'vitest'
import { capabilitiesFor, reasoningNoteFor, type ProviderConfig } from './registry'
import { compatibleOptionsFor } from './reasoning'

const compatible = (patch: Partial<ProviderConfig> = {}): ProviderConfig => ({
  id: 'gateway',
  kind: 'openai-compatible',
  name: 'Gateway',
  baseUrl: 'https://gateway.example/v1',
  enabled: true,
  ...patch,
})

/**
 * Reasoning depth on an OpenAI-compatible endpoint.
 *
 * This is the case that has no single right answer: the endpoint's `kind` says
 * nothing about the model behind it, and "send nothing" — the safe default —
 * silently removes a control from every gateway serving Claude or GPT. The
 * inference is by model id, with the provider able to override it.
 */
describe('reasoning depth on a compatible endpoint', () => {
  it('infers the control from the model id, like vision and search', () => {
    expect(capabilitiesFor(compatible(), 'claude-opus-5-5').thinking).toBe('effort')
    expect(capabilitiesFor(compatible(), 'gpt-5.5').thinking).toBe('effort')
    expect(capabilitiesFor(compatible(), 'deepseek-chat').thinking).toBe('none')
    expect(capabilitiesFor(compatible(), 'llama-3-70b').thinking).toBe('none')
  })

  it('reads a namespaced id through its vendor prefix', () => {
    expect(capabilitiesFor(compatible(), 'anthropic/claude-opus-5-5').thinking).toBe('effort')
  })

  it('lets the provider override the inference', () => {
    // A self-hosted box that takes no depth parameter.
    expect(capabilitiesFor(compatible({ reasoningWire: 'none' }), 'claude-opus-5-5').thinking).toBe(
      'none',
    )
    // One that exposes Anthropic's budget field instead.
    expect(capabilitiesFor(compatible({ reasoningWire: 'budget' }), 'llama-3-70b').thinking).toBe(
      'budget',
    )
    expect(capabilitiesFor(compatible({ reasoningWire: 'effort' }), 'deepseek-chat').thinking).toBe(
      'effort',
    )
  })

  it('explains an absent control only when the model would have had one', () => {
    // A reasoning model on an endpoint that sends nothing: worth saying.
    expect(reasoningNoteFor(compatible({ reasoningWire: 'none' }), 'claude-opus-5-5')).toBeTruthy()
    // A model that does not reason: the control was never going to be there.
    expect(reasoningNoteFor(compatible({ reasoningWire: 'none' }), 'llama-3')).toBeNull()
    // A first-party provider is never explained this way.
    expect(reasoningNoteFor(compatible(), 'claude-opus-5-5')).toBeNull()
  })

  it('sends effort as reasoning_effort, which the provider writes to the wire', () => {
    expect(compatibleOptionsFor('high', 'effort')).toEqual({ reasoningEffort: 'high' })
    // `none` rather than an omission: an endpoint that supports the field should
    // be told to skip thinking.
    expect(compatibleOptionsFor('off', 'effort')).toEqual({ reasoningEffort: 'none' })
  })

  it('sends a token budget only for a budget-style endpoint', () => {
    expect(compatibleOptionsFor('medium', 'budget')).toEqual({
      thinking: { type: 'enabled', budgetTokens: 8192 },
    })
    expect(compatibleOptionsFor('high', 'budget')).toEqual({
      thinking: { type: 'enabled', budgetTokens: 24576 },
    })
    // Off means no thinking, so there is nothing to send.
    expect(compatibleOptionsFor('off', 'budget')).toBeUndefined()
    // A model that does not reason is never given a depth at all.
    expect(compatibleOptionsFor('high', 'none')).toBeUndefined()
  })
})

/**
 * Whether "model's own search" is offered. Every first-party provider used to
 * report none at all, because the catalog carries no search flag and the
 * capability was left false for every model.
 */
describe('hosted search availability', () => {
  const provider = (kind: ProviderConfig['kind']) => compatible({ id: kind, kind })

  it('offers each vendor its own hosted search on current models', () => {
    expect(capabilitiesFor(provider('anthropic'), 'claude-opus-5-5').nativeSearch).toBe(true)
    expect(capabilitiesFor(provider('openai'), 'gpt-6-astra').nativeSearch).toBe(true)
    expect(capabilitiesFor(provider('openai'), 'o3').nativeSearch).toBe(true)
    expect(capabilitiesFor(provider('google'), 'gemini-2.5-pro').nativeSearch).toBe(true)
  })

  it('withholds it from models in those families that cannot take the tool', () => {
    // Old generations, and non-chat variants the catalog marks as tool-less.
    expect(capabilitiesFor(provider('openai'), 'gpt-3.5-turbo').nativeSearch).toBe(false)
    expect(capabilitiesFor(provider('openai'), 'gpt-image-1').nativeSearch).toBe(false)
    expect(capabilitiesFor(provider('google'), 'gemini-3-pro-image').nativeSearch).toBe(false)
  })

  it('lets OpenRouter search for any model that takes tool calls', () => {
    // OpenRouter runs the search itself, so the vendor behind it does not matter.
    expect(capabilitiesFor(provider('openrouter'), 'deepseek/deepseek-v4-pro').nativeSearch).toBe(true)
    expect(capabilitiesFor(provider('openrouter'), 'perplexity/sonar-deep-research').nativeSearch).toBe(false)
  })

  it('routes a gateway only for the families with a native protocol to borrow', () => {
    expect(capabilitiesFor(compatible(), 'claude-opus-5-5').nativeSearch).toBe(true)
    expect(capabilitiesFor(compatible(), 'gpt-6-astra').nativeSearch).toBe(true)
    expect(capabilitiesFor(compatible(), 'deepseek-v4-pro').nativeSearch).toBe(false)
  })
})
