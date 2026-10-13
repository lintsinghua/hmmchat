import { generateText } from 'ai'
import { capabilitiesFor, createModel, type ProviderConfig } from './registry'
import { providerOptionsFor } from './reasoning'

import { t } from '@/i18n/core'
import { lib } from '@/i18n'

/**
 * Model health check.
 *
 * Sends the smallest request that exercises the whole path the chat uses — the
 * same model construction, the Rust proxy, secret substitution and the vendor's
 * real completion endpoint — rather than listing `/models`, which succeeds on
 * many gateways for model ids that then 404 on the first message.
 *
 * Any completed response counts as alive, including one cut short by the token
 * cap: the question is "will this model answer", not "what does it say".
 */

export type ProbeResult =
  | { ok: true; ms: number }
  | { ok: false; ms: number; error: string }

const TIMEOUT_MS = 30_000

export async function probeModel(provider: ProviderConfig, modelId: string): Promise<ProbeResult> {
  const started = performance.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const capabilities = capabilitiesFor(provider, modelId)
    await generateText({
      model: createModel(provider, modelId),
      prompt: 'ping',
      // Reasoning models need room to think before the first visible token, and
      // some vendors reject a cap below their thinking minimum.
      maxOutputTokens: capabilities.thinking === 'none' ? 8 : 2048,
      providerOptions: providerOptionsFor(provider.kind, 'off', capabilities.thinking),
      maxRetries: 0,
      abortSignal: controller.signal,
    })
    return { ok: true, ms: Math.round(performance.now() - started) }
  } catch (error) {
    const ms = Math.round(performance.now() - started)
    if (controller.signal.aborted) return { ok: false, ms, error: t(lib.probeTimeout) }
    return { ok: false, ms, error: describeError(error) }
  } finally {
    clearTimeout(timer)
  }
}

/** Reduces an SDK error to the line a user can act on. */
function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error)
  const withStatus = error as Error & { statusCode?: number; responseBody?: string }
  const body = withStatus.responseBody?.trim()
  let detail = error.message
  if (body) {
    try {
      const parsed = JSON.parse(body) as { error?: { message?: string } | string; message?: string }
      const message =
        typeof parsed.error === 'string' ? parsed.error : (parsed.error?.message ?? parsed.message)
      if (message) detail = message
    } catch {
      detail = body
    }
  }
  const prefix = withStatus.statusCode ? `${withStatus.statusCode} ` : ''
  return `${prefix}${detail}`.slice(0, 240)
}

/** Runs probes with bounded concurrency, reporting each result as it lands. */
export async function probeMany(
  provider: ProviderConfig,
  modelIds: string[],
  onResult: (modelId: string, result: ProbeResult) => void,
  concurrency = 4,
): Promise<void> {
  const queue = [...modelIds]
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
      onResult(id, await probeModel(provider, id))
    }
  })
  await Promise.all(workers)
}
