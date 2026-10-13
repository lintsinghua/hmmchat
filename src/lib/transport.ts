import { Channel, invoke } from '@tauri-apps/api/core'
import { isTauri } from './env'

/**
 * Shape of the events the Rust proxy pushes over its IPC channel.
 * Mirrors `StreamEvent` in src-tauri/src/http.rs.
 */
type StreamEvent =
  | { kind: 'headers'; status: number; headers: [string, string][] }
  | { kind: 'chunk'; data: string }
  | { kind: 'end' }
  | { kind: 'error'; message: string }

/**
 * Response headers that are meaningless or actively harmful to forward: the
 * bytes have already been decoded and re-framed by reqwest, so `content-length`
 * and `content-encoding` would describe a body that no longer exists. Passing
 * `content-encoding: gzip` through would make the SDK try to gunzip plain JSON.
 */
const DROPPED_RESPONSE_HEADERS = new Set([
  'content-encoding',
  'content-length',
  'transfer-encoding',
  'connection',
])

let requestCounter = 0

function nextRequestId(): string {
  requestCounter += 1
  return `req-${Date.now().toString(36)}-${requestCounter}`
}

/** Decodes a base64 chunk without the `TextDecoder` round-trip that would
 *  corrupt characters split across chunk boundaries. */
function decodeBase64Chunk(data: string): Uint8Array {
  const binary = atob(data)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

async function serializeBody(body: BodyInit | null | undefined): Promise<string | null> {
  if (body === null || body === undefined) return null
  if (typeof body === 'string') return body
  if (body instanceof URLSearchParams) return body.toString()
  if (body instanceof ArrayBuffer) return new TextDecoder().decode(new Uint8Array(body))
  if (ArrayBuffer.isView(body)) {
    const view = body as ArrayBufferView
    return new TextDecoder().decode(
      new Uint8Array(view.buffer, view.byteOffset, view.byteLength),
    )
  }
  if (typeof Blob !== 'undefined' && body instanceof Blob) return await body.text()
  if (body instanceof ReadableStream) return await new Response(body).text()
  return String(body)
}

function toHeaderPairs(headers: Headers): [string, string][] {
  const pairs: [string, string][] = []
  headers.forEach((value, name) => pairs.push([name, value]))
  return pairs
}

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason: unknown) => void
  /** True once resolve() or reject() has run. */
  settled: boolean
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const state = { settled: false }
  const promise = new Promise<T>((res, rej) => {
    resolve = (value) => {
      state.settled = true
      res(value)
    }
    reject = (reason) => {
      state.settled = true
      rej(reason)
    }
  })
  return {
    promise,
    resolve,
    reject,
    get settled() {
      return state.settled
    },
  }
}

function abortError(): DOMException {
  return new DOMException('The operation was aborted.', 'AbortError')
}

/**
 * A `fetch` implementation that tunnels through the Rust proxy.
 *
 * Provider APIs reject browser-originated calls via CORS, so the AI SDK is
 * handed this instead of the platform `fetch`. It deliberately satisfies
 * `typeof globalThis.fetch` — the SDK's providers accept it as `FetchFunction`
 * and cannot tell the difference — which means no provider adapter needs to
 * know that a Rust process is doing the networking.
 *
 * The contract it has to honour: resolve as soon as response *headers* arrive,
 * with `response.body` streaming the rest. Rust therefore emits a `headers`
 * event first and the `invoke` promise is left running in the background, since
 * it only settles once the whole response has been forwarded.
 */
export const tauriFetch: typeof fetch = (input, init) => {
  if (!isTauri) {
    // Browser dev loop: talk to whatever the caller configured (the mock).
    return globalThis.fetch(input, init)
  }

  const request = typeof Request !== 'undefined' && input instanceof Request ? input : null
  const url = request ? request.url : String(input)
  const method = (init?.method ?? request?.method ?? 'GET').toUpperCase()
  const headers = new Headers(init?.headers ?? request?.headers)
  const signal = init?.signal ?? request?.signal ?? null

  if (signal?.aborted) return Promise.reject(abortError())

  const requestId = nextRequestId()
  const headers$ = deferred<{ status: number; headers: [string, string][] }>()
  const channel = new Channel<StreamEvent>()

  let bodyController: ReadableStreamDefaultController<Uint8Array> | null = null
  let closed = false
  let cancelled = false

  const close = () => {
    if (closed) return
    closed = true
    try {
      bodyController?.close()
    } catch {
      // Already closed by an error path; nothing to do.
    }
  }

  const fail = (error: unknown) => {
    if (closed) return
    closed = true
    try {
      bodyController?.error(error)
    } catch {
      // See above.
    }
  }

  channel.onmessage = (event) => {
    switch (event.kind) {
      case 'headers':
        headers$.resolve({ status: event.status, headers: event.headers })
        break
      case 'chunk':
        if (!closed) bodyController?.enqueue(decodeBase64Chunk(event.data))
        break
      case 'end':
        close()
        break
      case 'error':
        if (!headers$.settled) headers$.reject(new Error(event.message))
        else fail(new Error(event.message))
        break
    }
  }

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      bodyController = controller
    },
    cancel() {
      cancelled = true
      void invoke('http_abort', { requestId })
    },
  })

  void serializeBody(init?.body).then((serialized) => {
    if (cancelled) return
    return invoke('http_stream', {
      args: {
        requestId,
        url,
        method,
        headers: toHeaderPairs(headers),
        body: serialized,
      },
      onEvent: channel,
    })
  }).catch((error: unknown) => {
    // Reaching here means the command itself failed before or during the
    // stream: DNS failure, TLS error, an aborted request.
    if (!headers$.settled) headers$.reject(error)
    else fail(error)
  })

  const onAbort = () => {
    cancelled = true
    void invoke('http_abort', { requestId })
    fail(abortError())
  }
  signal?.addEventListener('abort', onAbort, { once: true })

  return headers$.promise.then(({ status, headers: rawHeaders }) => {
    const responseHeaders = new Headers()
    for (const [name, value] of rawHeaders) {
      if (DROPPED_RESPONSE_HEADERS.has(name.toLowerCase())) continue
      try {
        responseHeaders.append(name, value)
      } catch {
        // A header the platform refuses to let us set; safe to drop.
      }
    }

    // `Response` rejects statuses outside 200-599 and any body on 204/304.
    const safeStatus = status >= 200 && status <= 599 ? status : 200
    const withBody = safeStatus !== 204 && safeStatus !== 304

    return new Response(withBody ? body : null, {
      status: safeStatus,
      headers: responseHeaders,
    })
  })
}

/** Aborts an in-flight proxied request from outside the fetch call. */
export async function abortProxiedRequest(requestId: string): Promise<void> {
  if (!isTauri) return
  await invoke('http_abort', { requestId })
}
