// A fake provider that speaks all three wire protocols, so the entire
// streaming path (Rust proxy -> custom fetch -> AI SDK adapters -> UI) can be
// exercised without spending money or needing a key.
//
//   node scripts/mock-llm.mjs
//
// Point a provider's base URL at one of the routes below with any non-empty API
// key. Because a chat request carries its model id in the *body* rather than the
// URL, the feature flags are encoded in the model id itself:
//
//   mock-claude-opus-5-5?reason=1&search=1
//
// understood flags: reason, search, slow, and error=http|malformed|1. Unknown
// or real model ids work
// too — they just stream plain text with no reasoning or search.
//
// Scripted replies: `MOCK_SCRIPT=path/to/script.json node scripts/mock-llm.mjs`
// answers streaming requests whose last user message matches an entry with that
// entry's text — per model, paced at its `cps`, with optional reasoning and
// search sources — instead of the built-in words. Used for recording footage
// (see promo/capture/script.json for the schema). Unmatched requests behave
// exactly as without it, as do non-streaming ones apart from an optional
// `probeMs: [min, max]` delay that gives the health check realistic latency.
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const PORT = Number(process.env.MOCK_PORT ?? 8787)

const WORDS = (
  '好的。这个问题的核心在于取舍：把复杂度放在数据模型里，界面就能保持简单；' +
  '反过来，如果让每条消息都自带一堆状态分支，UI 迟早会被这些分支撑爆。 ' +
  'Here is a code sample to exercise the markdown renderer:\n\n' +
  '```ts\nfunction greet(name: string) {\n  return `Hello, ${name}!`\n}\n```\n\n' +
  '最后一点：动效的作用是解释状态变化，而不是装饰。'
).split(' ')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const SCRIPT = process.env.MOCK_SCRIPT
  ? JSON.parse(readFileSync(resolve(process.env.MOCK_SCRIPT), 'utf8'))
  : null

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/** The built-in chunks, one per `delay`, as the unscripted mock streams them. */
async function* words(list, delay) {
  for (const word of list) {
    yield word
    await sleep(delay)
  }
}

/**
 * Streams `text` at roughly `cps` characters per second in chunks of one to
 * three graphemes with a little jitter, the way a real model's tokens arrive.
 * Chunks are cut on grapheme boundaries, so a surrogate pair or a combining
 * mark is never split across two deltas.
 */
async function* paced(text, cps) {
  const units = Array.from(graphemes.segment(text), (entry) => entry.segment)
  const perUnit = 1000 / cps
  for (let index = 0; index < units.length; ) {
    const size = 1 + Math.floor(Math.random() * 3)
    yield units.slice(index, index + size).join('')
    index += size
    await sleep(perUnit * size * (0.7 + Math.random() * 0.6))
  }
}

/** The text of the last user message, in any of the four request shapes. */
function lastUserText(body) {
  const turns = body.messages ?? (Array.isArray(body.input) ? body.input : null) ?? body.contents ?? []
  const user = [...turns].reverse().find((turn) => turn?.role === 'user')
  if (!user) return typeof body.input === 'string' ? body.input : ''
  const content = user.content ?? user.parts ?? ''
  if (typeof content === 'string') return content
  return content.map((part) => (typeof part?.text === 'string' ? part.text : '')).join('')
}

/**
 * The scripted reply for a streaming request, or null to fall back to the
 * built-in behaviour. The first entry whose `match` occurs in the last user
 * message wins (an empty match is a catch-all), then the reply for the model's
 * base id, else `*`.
 */
function scriptedPlan(body, base) {
  if (!SCRIPT) return null
  const asked = lastUserText(body)
  const entry = SCRIPT.entries.find((candidate) => asked.includes(candidate.match ?? ''))
  const reply = entry?.replies?.[base] ?? entry?.replies?.['*']
  if (!reply) return null
  return {
    ...reply,
    cps: reply.cps ?? 60,
    reasoningCps: reply.reasoningCps ?? 90,
    ttftMs: reply.ttftMs ?? 350,
    sources: entry.sources ?? null,
    query: entry.query ?? asked.trim().slice(0, 60),
    searchMs: entry.searchMs ?? 1400,
  }
}

/**
 * Splits a model id into its base name and feature flags.
 *
 * Flags ride in the model id because that is the only field the mock sees that
 * is guaranteed to survive the SDK's request shaping.
 */
function parseModel(raw) {
  const [base, query = ''] = String(raw ?? 'mock').split('?')
  const params = new URLSearchParams(query)
  return {
    base,
    reason: params.has('reason'),
    search: params.has('search'),
    slow: params.has('slow'),
    // A string, not a boolean: `?error=http` fails the request outright and
    // `?error=malformed` truncates the event stream, while a bare `?error`
    // keeps the original mid-stream failure.
    error: params.has('error') ? params.get('error') || '1' : null,
    /** Per-chunk delay, so ?slow=1 dribbles and the default is brisk. */
    delay: params.has('slow') ? 55 : 6,
  }
}

/**
 * Whether the request carries a hosted web-search tool.
 *
 * Covers the three shapes: Anthropic's `web_search_*` server tool, OpenAI's
 * `web_search` tool, and Gemini's `google_search` function declaration.
 */
function requestsHostedSearch(body) {
  const serialized = JSON.stringify(body ?? {})
  return (
    /"web_search[a-z0-9_]*"/i.test(serialized) ||
    /"google_search"/i.test(serialized) ||
    /"web_search_preview"/i.test(serialized)
  )
}

function readJson(req) {
  return new Promise((resolve) => {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'))
      } catch {
        resolve({})
      }
    })
  })
}

function sseHeaders(res) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    'access-control-allow-origin': '*',
  })
}

/** The model id from whichever request shape arrived. */
function modelOf(body) {
  return parseModel(body.model ?? body.modelId ?? 'mock')
}

// ---------------------------------------------------------------------------
// Anthropic Messages API
// ---------------------------------------------------------------------------
async function anthropic(req, res) {
  const body = await readJson(req)

  const { base, reason, delay, error } = modelOf(body)
  // Search is driven by the request, not by a flag: if the app sent the hosted
  // web_search tool, the model really would search. Detecting it here means the
  // app's search path (tool -> step row -> citations) is exercised end to end
  // rather than only when a magic model id is used.
  const search = requestsHostedSearch(body)
  // Deliberate failures, for exercising the app's error paths and its model
  // probe rather than only its happy path. `error` rides in the model id like
  // the other flags: `claude-opus-5-5?error=http`.
  if (error === 'http') {
    res.statusCode = 401
    res.setHeader('content-type', 'application/json')
    res.setHeader('access-control-allow-origin', '*')
    res.end(
      JSON.stringify({
        type: 'error',
        error: { type: 'authentication_error', message: 'invalid x-api-key' },
      }),
    )
    return
  }

  // Non-streaming callers — the app's model health check among them — get a
  // plain Messages response. Answering with an event stream regardless of
  // `stream` would make every probe look like an upstream failure.
  // Absence of `stream` means non-streaming, per the Messages API; only an
  // explicit `"stream": true` asks for the event stream.
  if (body.stream !== true) {
    const text =
      error === 'malformed'
        ? ''
        : '这个问题的核心在于取舍：把复杂度放在数据模型里，界面就能保持简单。'
    // A script may ask for realistic probe latency, so the health check does
    // not report a few milliseconds on camera.
    const [low, high] = SCRIPT?.probeMs ?? [0, 0]
    if (high) await sleep(low + Math.random() * (high - low))
    res.setHeader('content-type', 'application/json')
    res.setHeader('access-control-allow-origin', '*')
    res.end(
      JSON.stringify({
        id: `msg_${Date.now()}`,
        type: 'message',
        role: 'assistant',
        model: body.model ?? 'mock',
        content: text ? [{ type: 'text', text }] : [],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 128, output_tokens: 24 },
      }),
    )
    return
  }

  sseHeaders(res)

  const send = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`)

  if (error === 'malformed') {
    // A truncated event stream: the SDK surfaces an error part mid-stream
    // rather than throwing on the fetch.
    res.write('event: message_start\ndata: {"type":"message_start"}\n\n')
    res.end()
    return
  }

  send('message_start', {
    type: 'message_start',
    message: {
      id: `msg_${Date.now()}`,
      type: 'message',
      role: 'assistant',
      model: body.model ?? 'mock',
      content: [],
      stop_reason: null,
      usage: { input_tokens: 128, output_tokens: 0 },
    },
  })

  const plan = scriptedPlan(body, base)
  if (plan) await sleep(plan.ttftMs)

  let index = 0

  if (plan ? plan.reasoning : reason) {
    send('content_block_start', {
      type: 'content_block_start',
      index,
      content_block: { type: 'thinking', thinking: '' },
    })
    const thinking = plan
      ? paced(plan.reasoning, plan.reasoningCps)
      : words(['用户', '在问', '一个', '需要', '权衡的', '问题。', '先看', '约束。'], delay)
    for await (const word of thinking) {
      send('content_block_delta', {
        type: 'content_block_delta',
        index,
        delta: { type: 'thinking_delta', thinking: word },
      })
    }
    send('content_block_stop', { type: 'content_block_stop', index })
    index += 1
  }

  if (search) {
    // A server-hosted search: the model calls it, the result comes back, then
    // the visible answer follows with citations.
    send('content_block_start', {
      type: 'content_block_start',
      index,
      content_block: {
        type: 'server_tool_use',
        id: 'srvtoolu_1',
        name: 'web_search',
        input: {},
      },
    })
    const query = plan ? JSON.stringify({ query: plan.query }) : null
    const queryChunks = query
      ? [query.slice(0, 5), query.slice(5, 14), query.slice(14)]
      : ['{"que', 'ry": "weighted scroll', ' sync"}']
    for (const chunk of queryChunks) {
      send('content_block_delta', {
        type: 'content_block_delta',
        index,
        delta: { type: 'input_json_delta', partial_json: chunk },
      })
      await sleep(delay)
    }
    send('content_block_stop', { type: 'content_block_stop', index })
    index += 1

    // The pause the real API takes while the server runs the search.
    await sleep(plan ? plan.searchMs : delay * 8)

    send('content_block_start', {
      type: 'content_block_start',
      index,
      content_block: {
        type: 'web_search_tool_result',
        tool_use_id: 'srvtoolu_1',
        content: plan?.sources
          ? plan.sources.map((source, position) => ({
              type: 'web_search_result',
              url: source.url,
              title: source.title,
              page_age: null,
              encrypted_content: String(position),
            }))
          : [
              {
                type: 'web_search_result',
                url: 'https://example.com/a',
                title: 'Scroll synchronisation patterns',
                page_age: '2026-01-04',
                encrypted_content: 'x',
              },
              {
                type: 'web_search_result',
                url: 'https://example.com/b',
                title: 'Comparing panes side by side',
                page_age: null,
                encrypted_content: 'y',
              },
            ],
      },
    })
    send('content_block_stop', { type: 'content_block_stop', index })
    index += 1
  }

  if (error) {
    await sleep(120)
    send('error', { type: 'error', error: { type: 'api_error', message: 'mock upstream failure' } })
    res.end()
    return
  }

  send('content_block_start', {
    type: 'content_block_start',
    index,
    content_block: { type: 'text', text: '' },
  })

  const answer = plan ? paced(plan.text, plan.cps) : words(WORDS.map((word) => `${word} `), delay)
  for await (const word of answer) {
    send('content_block_delta', {
      type: 'content_block_delta',
      index,
      delta: { type: 'text_delta', text: word },
    })
  }

  send('content_block_stop', { type: 'content_block_stop', index })
  send('message_delta', {
    type: 'message_delta',
    delta: { stop_reason: 'end_turn', stop_sequence: null },
    usage: { output_tokens: 412 },
  })
  send('message_stop', { type: 'message_stop' })
  res.end()
}

// ---------------------------------------------------------------------------
// OpenAI Responses API
//
// Shapes below match the schemas the SDK validates against: `response.created`
// and `response.in_progress` require id/created_at/model, and `output_item.added`
// requires a typed `item` plus `output_index`. Getting these wrong fails fast
// with a TypeValidationError rather than degrading quietly.
// ---------------------------------------------------------------------------
async function openaiResponses(req, res) {
  const body = await readJson(req)
  const { base, reason, delay, error } = modelOf(body)
  const search = requestsHostedSearch(body)
  sseHeaders(res)

  const send = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`)
  const responseId = `resp_${Date.now()}`
  const createdAt = Math.floor(Date.now() / 1000)
  const model = body.model ?? 'mock'

  const envelope = { id: responseId, created_at: createdAt, model, service_tier: null }

  send('response.created', { type: 'response.created', response: envelope })
  send('response.in_progress', { type: 'response.in_progress', response: envelope })

  const plan = body.stream === true ? scriptedPlan(body, base) : null
  if (plan) await sleep(plan.ttftMs)

  let outputIndex = 0

  if (plan ? plan.reasoning : reason) {
    const itemId = `rs_${Date.now()}`
    send('response.output_item.added', {
      type: 'response.output_item.added',
      output_index: outputIndex,
      item: { type: 'reasoning', id: itemId, encrypted_content: null },
    })
    send('response.reasoning_summary_part.added', {
      type: 'response.reasoning_summary_part.added',
      item_id: itemId,
      output_index: outputIndex,
      summary_index: 0,
      part: { type: 'summary_text', text: '' },
    })
    const summary = plan ? null : ['先确定', '边界条件，', '再选择', '数据模型。']
    const thinking = plan ? paced(plan.reasoning, plan.reasoningCps) : words(summary, delay)
    for await (const word of thinking) {
      send('response.reasoning_summary_text.delta', {
        type: 'response.reasoning_summary_text.delta',
        item_id: itemId,
        output_index: outputIndex,
        summary_index: 0,
        delta: word,
      })
    }
    send('response.reasoning_summary_text.done', {
      type: 'response.reasoning_summary_text.done',
      item_id: itemId,
      output_index: outputIndex,
      summary_index: 0,
      text: plan ? plan.reasoning : summary.join(''),
    })
    send('response.output_item.done', {
      type: 'response.output_item.done',
      output_index: outputIndex,
      item: { type: 'reasoning', id: itemId, encrypted_content: null },
    })
    outputIndex += 1
  }

  if (search) {
    const callId = `ws_${Date.now()}`
    send('response.output_item.added', {
      type: 'response.output_item.added',
      output_index: outputIndex,
      item: { type: 'web_search_call', id: callId, status: 'in_progress' },
    })
    await sleep(plan ? plan.searchMs : delay * 4)
    send('response.output_item.done', {
      type: 'response.output_item.done',
      output_index: outputIndex,
      item: {
        type: 'web_search_call',
        id: callId,
        status: 'completed',
        ...(plan?.sources
          ? {
              action: {
                type: 'search',
                query: plan.query,
                sources: plan.sources.map((source) => ({ type: 'url', url: source.url })),
              },
            }
          : {}),
      },
    })
    outputIndex += 1
  }

  if (error) {
    await sleep(120)
    send('response.failed', {
      type: 'response.failed',
      sequence_number: 99,
      response: {
        error: { code: 'server_error', message: 'mock upstream failure' },
        incomplete_details: null,
        usage: null,
        service_tier: null,
      },
    })
    res.end()
    return
  }

  const messageId = `msg_${Date.now()}`
  send('response.output_item.added', {
    type: 'response.output_item.added',
    output_index: outputIndex,
    item: { type: 'message', id: messageId, phase: 'final_answer' },
  })
  send('response.content_part.added', {
    type: 'response.content_part.added',
    item_id: messageId,
    output_index: outputIndex,
    content_index: 0,
    part: { type: 'output_text', text: '', annotations: [] },
  })

  const answer = plan ? paced(plan.text, plan.cps) : words(WORDS.map((word) => `${word} `), delay)
  for await (const word of answer) {
    send('response.output_text.delta', {
      type: 'response.output_text.delta',
      item_id: messageId,
      output_index: outputIndex,
      content_index: 0,
      delta: word,
    })
  }

  // Hosted search cites its sources as annotations on the answer text.
  if (search && plan?.sources) {
    for (const source of plan.sources) {
      send('response.output_text.annotation.added', {
        type: 'response.output_text.annotation.added',
        item_id: messageId,
        output_index: outputIndex,
        content_index: 0,
        annotation: { type: 'url_citation', start_index: 0, end_index: 0, url: source.url, title: source.title },
      })
    }
  }

  send('response.output_text.done', {
    type: 'response.output_text.done',
    item_id: messageId,
    output_index: outputIndex,
    content_index: 0,
    text: plan ? plan.text : WORDS.join(' '),
  })
  send('response.output_item.done', {
    type: 'response.output_item.done',
    output_index: outputIndex,
    item: { type: 'message', id: messageId, phase: 'final_answer' },
  })

  send('response.completed', {
    type: 'response.completed',
    response: {
      incomplete_details: null,
      usage: {
        input_tokens: 128,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens: 412,
        output_tokens_details: { reasoning_tokens: reason ? 96 : 0 },
        total_tokens: 540,
      },
      service_tier: null,
    },
  })
  res.end()
}

// ---------------------------------------------------------------------------
// OpenAI Chat Completions (used by OpenRouter and custom endpoints)
// ---------------------------------------------------------------------------
async function openaiChat(req, res) {
  const body = await readJson(req)
  const { base: modelBase, reason, delay, error } = modelOf(body)
  sseHeaders(res)

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`)
  const id = `chatcmpl_${Date.now()}`
  const model = body.model ?? 'mock'
  const base = { id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model }

  send({ ...base, choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] })

  const plan = body.stream === true ? scriptedPlan(body, modelBase) : null
  if (plan) await sleep(plan.ttftMs)

  if (plan ? plan.reasoning : reason) {
    const thinking = plan
      ? paced(plan.reasoning, plan.reasoningCps)
      : words(['让我', '想一下', '这个', '问题的', '结构。'], delay)
    for await (const word of thinking) {
      send({
        ...base,
        choices: [{ index: 0, delta: { reasoning_content: word }, finish_reason: null }],
      })
    }
  }

  if (error) {
    await sleep(120)
    send({ error: { message: 'mock upstream failure', type: 'server_error' } })
    res.write('data: [DONE]\n\n')
    res.end()
    return
  }

  const answer = plan ? paced(plan.text, plan.cps) : words(WORDS.map((word) => `${word} `), delay)
  for await (const word of answer) {
    send({ ...base, choices: [{ index: 0, delta: { content: word }, finish_reason: null }] })
  }

  send({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })
  if (body.stream_options?.include_usage) {
    send({
      ...base,
      choices: [],
      usage: { prompt_tokens: 128, completion_tokens: 412, total_tokens: 540 },
    })
  }
  res.write('data: [DONE]\n\n')
  res.end()
}

// ---------------------------------------------------------------------------
// Google Generative Language API
// ---------------------------------------------------------------------------
async function google(req, res, url) {
  // Read the body exactly once: a second read of an already-drained stream
  // never resolves, and would hang the request rather than fail it.
  const body = await readJson(req)
  // Gemini carries the model in the path (`models/<id>:streamGenerateContent`),
  // with the method after a colon. Because the SDK does not percent-encode the
  // model id, a `?flag=1` suffix lands in the URL's *query string* rather than
  // the path — so flags are read from the whole raw URL, not the path segment.
  const pathModel = url.pathname.match(/models\/([^:]+)/)?.[1] ?? 'mock'
  const flags = new URLSearchParams(url.search || '')
  const { base, delay } = parseModel(pathModel)
  const reason = flags.has('reason')
  const error = flags.has('error')
  const search = flags.has('search') || requestsHostedSearch(body)
  sseHeaders(res)

  const send = (payload) => res.write(`data: ${JSON.stringify(payload)}\n\n`)
  const plan = url.pathname.includes(':streamGenerateContent') ? scriptedPlan(body, base) : null

  if (error) {
    await sleep(120)
    send({
      candidates: [{ content: { role: 'model', parts: [] }, index: 0, finishReason: 'OTHER' }],
    })
    res.end()
    return
  }

  if (plan) await sleep(plan.ttftMs)

  if (plan ? plan.reasoning : reason) {
    const thinking = plan
      ? paced(plan.reasoning, plan.reasoningCps)
      : words(['我会', '先拆解', '这个', '问题的', '组成部分。'], delay)
    for await (const part of thinking) {
      send({
        candidates: [
          { content: { role: 'model', parts: [{ text: part, thought: true }] }, index: 0 },
        ],
      })
    }
  }

  if (search) {
    send({
      candidates: [
        {
          content: {
            role: 'model',
            // A hosted-search grounding turn: the tool call carries no arguments
            // and the real content comes back as grounding metadata.
            parts: [{ functionCall: { name: 'google_search', args: {} } }],
          },
          index: 0,
        },
      ],
    })
    await sleep(plan ? plan.searchMs : delay * 4)
  }

  const answer = plan ? paced(plan.text, plan.cps) : words(WORDS.map((word) => `${word} `), delay)
  for await (const word of answer) {
    send({
      candidates: [{ content: { role: 'model', parts: [{ text: word }] }, index: 0 }],
    })
  }

  send({
    candidates: [
      {
        content: { role: 'model', parts: [] },
        index: 0,
        finishReason: 'STOP',
        ...(search
          ? {
              groundingMetadata: plan?.sources
                ? {
                    webSearchQueries: [plan.query],
                    groundingChunks: plan.sources.map((source) => ({
                      web: { uri: source.url, title: source.title },
                    })),
                  }
                : {
                    webSearchQueries: ['mock search'],
                    groundingChunks: [
                      { web: { uri: 'https://example.com/a', title: 'Example A' } },
                      { web: { uri: 'https://example.com/b', title: 'Example B' } },
                    ],
                  },
            }
          : {}),
      },
    ],
    usageMetadata: {
      promptTokenCount: 128,
      candidatesTokenCount: 412,
      totalTokenCount: 540,
      thoughtsTokenCount: reason ? 96 : 0,
    },
  })
  res.end()
}

/**
 * `GET …/models` — what the settings screen calls to list models.
 *
 * Real model ids are returned rather than `mock-…` names on purpose: the app's
 * capability table matches on the id, so fake names would leave reasoning and
 * hosted search permanently disabled and the capability path untested.
 */
const MODEL_CATALOGUE = {
  anthropic: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-4-5'],
  openai: ['gpt-5', 'gpt-4o'],
  google: ['gemini-3-pro', 'gemini-2.5-flash'],
  other: ['deepseek-reasoner', 'llama-3.3-70b'],
}

function listModels(res, pathname) {
  const family = pathname.startsWith('/anthropic')
    ? 'anthropic'
    : pathname.startsWith('/openai')
      ? 'openai'
      : pathname.startsWith('/google')
        ? 'google'
        : 'other'

  const models = MODEL_CATALOGUE[family]
  res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' })
  res.end(
    JSON.stringify({
      object: 'list',
      data: models.map((id) => ({ id, object: 'model', owned_by: 'mock' })),
    }),
  )
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`)

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': '*',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
    })
    res.end()
    return
  }

  if (url.pathname.endsWith('/models')) {
    listModels(res, url.pathname)
    return
  }

  try {
    if (url.pathname.startsWith('/anthropic')) return await anthropic(req, res)
    if (url.pathname.startsWith('/google')) return await google(req, res, url)
    if (url.pathname.startsWith('/openai-responses')) return await openaiResponses(req, res)
    if (url.pathname.startsWith('/openai')) return await openaiChat(req, res)
    // Same wire format as /openai, for custom OpenAI-compatible providers: the
    // app picks a custom provider's logo from its base URL, so one pointed at
    // /openai would wear OpenAI's mark. This route lists the `other` catalogue.
    if (url.pathname.startsWith('/compatible')) return await openaiChat(req, res)
  } catch (caught) {
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: { message: String(caught) } }))
    return
  }

  res.writeHead(404, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ error: { message: `no mock route for ${url.pathname}` } }))
})

server.listen(PORT, '127.0.0.1', () => {
  const base = `http://127.0.0.1:${PORT}`
  console.log(`mock provider listening on ${base}`)
  console.log('  anthropic        ', `${base}/anthropic/v1`)
  console.log('  openai (responses)', `${base}/openai-responses/v1`)
  console.log('  openai (chat)    ', `${base}/openai/v1`)
  console.log('  compatible (chat)', `${base}/compatible/v1`)
  console.log('  google           ', `${base}/google/v1beta`)
  console.log('  models           ', `${base}/anthropic/v1/models`)
  console.log('flags ride in the model id, e.g. mock-claude-opus-5-5?reason=1&search=1')
})
