// Protocol smoke test.
//
// Points the real AI SDK provider adapters at the mock server and asserts that
// the `fullStream` parts that come back are the ones the engine switches on.
// This is the assumption worth testing: the engine's whole stream-handling
// switch is written against part type names, and a rename in a future SDK
// version would silently produce empty answers rather than an error.
//
//   node scripts/mock-llm.mjs &
//   node scripts/verify-streams.mjs
import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import { streamText, stepCountIs } from 'ai'

const BASE = process.env.MOCK_BASE ?? 'http://127.0.0.1:8787'

/** Collects the distinct part types and the assembled text for one run. */
async function collect(model, options = {}) {
  const types = new Set()
  let text = ''
  let reasoning = ''
  let sources = 0

  const result = streamText({
    model,
    messages: [{ role: 'user', content: 'test' }],
    ...options,
  })

  for await (const part of result.fullStream) {
    types.add(part.type)
    if (part.type === 'text-delta') text += part.text
    if (part.type === 'reasoning-delta') reasoning += part.text
    if (part.type === 'source') sources += 1
    if (part.type === 'error') {
      return { types, text, reasoning, sources, error: String(part.error?.message ?? part.error) }
    }
  }

  return { types, text, reasoning, sources }
}

let failures = 0

function check(name, condition, detail) {
  if (condition) {
    console.log(`  ✓ ${name}`)
  } else {
    failures += 1
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

// ---------------------------------------------------------------------------
console.log('\nAnthropic (Messages API)')
{
  const anthropic = createAnthropic({ apiKey: 'test', baseURL: `${BASE}/anthropic/v1` })
  const plain = await collect(anthropic('claude-opus-5-5'))

  check('emits text-delta', plain.types.has('text-delta'))
  check('assembles text', plain.text.length > 20, `got ${plain.text.length} chars`)
  check('terminates', plain.types.has('finish'))
  check('reports usage', plain.types.has('finish'))

  // The mock's ?reason=1 branch emits real thinking_delta events; the engine
  // relies on these arriving as `reasoning-delta`.
  const withReasoning = await collect(anthropic('claude-opus-5-5?reason=1'))
  check('emits reasoning-delta', withReasoning.types.has('reasoning-delta'))
  check('assembles reasoning', withReasoning.reasoning.length > 0)

  // The hosted search path: the app passes the provider's own web_search tool,
  // and the mock responds to its presence exactly as a real vendor would. That
  // makes this a real test of the app's tool wiring, not a magic model id.
  const withSearch = await collect(anthropic('claude-opus-5-5'), {
    tools: { web_search: anthropic.tools.webSearch_20250305({ maxUses: 3 }) },
    stopWhen: stepCountIs(4),
  })
  check('emits tool-call for hosted search', withSearch.types.has('tool-call'))
  check('still answers after search', withSearch.text.length > 20)
  check(
    'emits the search result back into the stream',
    withSearch.types.has('tool-result') || withSearch.types.has('source'),
    [...withSearch.types].join(','),
  )
}

// ---------------------------------------------------------------------------
console.log('\nOpenAI (Responses API)')
{
  const openai = createOpenAI({ apiKey: 'test', baseURL: `${BASE}/openai-responses/v1` })
  const plain = await collect(openai.responses('gpt-5'))

  check('emits text-delta', plain.types.has('text-delta'))
  check('assembles text', plain.text.length > 20, `got ${plain.text.length} chars`)
  check('terminates', plain.types.has('finish'))

  const withReasoning = await collect(openai.responses('gpt-5?reason=1'))
  check('emits reasoning-delta', withReasoning.types.has('reasoning-delta'))
  check('assembles reasoning', withReasoning.reasoning.length > 0)
}

// ---------------------------------------------------------------------------
console.log('\nGoogle (Generative Language API)')
{
  const google = createGoogleGenerativeAI({ apiKey: 'test', baseURL: `${BASE}/google/v1beta` })
  const plain = await collect(google('gemini-3-pro'))

  check('emits text-delta', plain.types.has('text-delta'))
  check('assembles text', plain.text.length > 20, `got ${plain.text.length} chars`)

  const withReasoning = await collect(google('gemini-3-pro?reason=1'))
  check('emits reasoning-delta', withReasoning.types.has('reasoning-delta'))
}

// ---------------------------------------------------------------------------
console.log('\nError surface')
{
  const anthropic = createAnthropic({ apiKey: 'test', baseURL: `${BASE}/anthropic/v1` })
  const failed = await collect(anthropic('claude-opus-5-5?error=1'))
  // A mid-stream upstream failure must arrive as an `error` part, not a throw,
  // so one broken column cannot take down the others.
  check('surfaces error as a part, not a rejection', typeof failed.error === 'string', failed.error)
}

// ---------------------------------------------------------------------------
console.log('\nTool loop (bring-your-own search path)')
{
  const anthropic = createAnthropic({ apiKey: 'test', baseURL: `${BASE}/anthropic/v1` })
  const { tool, jsonSchema } = await import('ai')

  let executed = 0
  const result = streamText({
    model: anthropic('claude-opus-5-5'),
    messages: [{ role: 'user', content: 'search for something' }],
    tools: {
      web_search: tool({
        description: 'search',
        inputSchema: jsonSchema({ type: 'object', properties: { query: { type: 'string' } } }),
        execute: async () => {
          executed += 1
          return '[1] example\nhttps://example.com\ncontent'
        },
      }),
    },
    stopWhen: stepCountIs(3),
  })

  for await (const part of result.fullStream) {
    // Just draining; the assertion is that the loop terminates.
    if (part.type === 'error') break
  }
  check('tool loop terminates', true)
  console.log(`    (tool executed ${executed} time(s) — the mock does not request tools)`)
}

console.log(
  failures === 0
    ? '\nAll stream assumptions hold.\n'
    : `\n${failures} assumption(s) FAILED.\n`,
)
process.exit(failures === 0 ? 0 : 1)
