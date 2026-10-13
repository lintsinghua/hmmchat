#!/usr/bin/env node
/**
 * Builds `src/providers/catalog.data.ts` from the models.dev catalog.
 *
 * Why a vendored snapshot and not a live fetch: the app has to reason about a
 * model's capabilities *before* it sends anything — a wrong guess about
 * `reasoning_effort` is a 400 on the first message, not a degraded answer. That
 * decision cannot wait on a network round trip to a third party, and the app is
 * a local desktop client that should work offline and in China.
 *
 * Why not hand-maintain the table: it was hand-maintained, and it was wrong in
 * ways nobody could see — every gateway model looked like it had no reasoning,
 * `xhigh` was declared and never emitted, and five Chinese vendors were flattened
 * to "no thinking" while their models did expose a switch. Vendor capability
 * facts change monthly; a maintained catalog is the only honest source.
 *
 * Re-run with `pnpm sync:catalog`. The script fails loudly if the upstream
 * schema drifts, rather than writing a plausible-looking but wrong snapshot.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const SOURCE = process.env.MODELS_DEV_URL ?? 'https://models.dev/api.json'
const OUT = join(dirname(fileURLToPath(import.meta.url)), '../src/providers/catalog.data.ts')

/**
 * Vendors whose own entry wins when a model id appears behind several providers.
 *
 * The order matters and is not cosmetic: OpenRouter and Vercel resell the same
 * models, and their copies sometimes carry narrower reasoning options than the
 * vendor's. A first-party statement about its own model is the better fact.
 */
const FIRST_PARTY = [
  'anthropic',
  'openai',
  'google',
  'google-vertex',
  'xai',
  'deepseek',
  'moonshotai',
  'zhipuai',
  'alibaba',
  'minimax',
  'stepfun',
  'mistral',
  'meta',
  'cohere',
  'perplexity',
]

/** A model id as the app will look it up: no vendor prefix, no traffic suffix. */
function normalize(id) {
  let key = id.toLowerCase().trim()
  if (key.includes('/')) key = key.split('/', 2)[1]
  return key.replace(/:(free|nitro|extended|thinking|online)$/, '')
}

/**
 * Reasoning options as one short string.
 *
 * `e:` effort values, `t` a plain on/off switch, `b:` a token budget. Several
 * may be present — a model can expose an effort control *and* accept a budget —
 * which is why this is a list rather than a single kind.
 */
function encodeReasoning(options) {
  const parts = []
  for (const option of options ?? []) {
    if (option.type === 'effort') {
      const values = (option.values ?? []).filter(Boolean)
      if (values.length) parts.push(`e:${values.join('|')}`)
    } else if (option.type === 'toggle') {
      parts.push('t')
    } else if (option.type === 'budget_tokens') {
      // `~` separates the bounds because a minimum can be negative: Google uses
      // -1 to mean "dynamic", and a `-` separator encoded that as an empty floor
      // and a nonsense ceiling.
      const { min, max } = option
      // A negative floor is a sentinel, not an amount, so it is not a bound the
      // app should reason with — the usable floor is zero.
      const floor = typeof min === 'number' && min >= 0 ? min : 0
      const range = `${floor}${typeof max === 'number' ? `~${max}` : ''}`
      parts.push(`b:${range}`)
    }
  }
  return parts.join(';')
}

/**
 * Capability flags: i = images, p = PDF, t = tool calling, r = reasons.
 *
 * `r` matters more than it looks. Around a fifth of the catalog's models are
 * marked as reasoning with an *empty* `reasoning_options` — mostly open-weight
 * models on aggregators, where the catalog knows the model thinks but not how
 * the thinking is steered. Those rows are not "no reasoning"; they are
 * "reasoning, control unspecified", and the app fills the gap from its family
 * rules rather than telling the user the model cannot think.
 */
function encodeFlags(model) {
  const inputs = model.modalities?.input ?? []
  let flags = ''
  if (inputs.includes('image') && model.attachment) flags += 'i'
  if (inputs.includes('pdf')) flags += 'p'
  if (model.tool_call) flags += 't'
  if (model.reasoning) flags += 'r'
  return flags
}

/**
 * A local copy can be passed instead of fetching: models.dev is a single 5 MB
 * response that a flaky connection will happily truncate mid-stream, and a
 * half-written catalog would produce a half-populated snapshot. `MODELS_DEV_FILE`
 * lets the sync be run against a verified download.
 */
const localPath = process.env.MODELS_DEV_FILE
let catalog

if (localPath) {
  catalog = JSON.parse(readFileSync(localPath, 'utf8'))
  console.log(`catalog: reading ${localPath}`)
} else {
  const response = await fetch(SOURCE, { signal: AbortSignal.timeout(120_000) })
  if (!response.ok) {
    console.error(`catalog: ${SOURCE} returned ${response.status} ${response.statusText}`)
    process.exit(1)
  }
  const text = await response.text()
  try {
    catalog = JSON.parse(text)
  } catch {
    console.error(
      `catalog: ${SOURCE} returned ${text.length} bytes that are not valid JSON — ` +
        'the download was probably truncated. Retry, or pass MODELS_DEV_FILE.',
    )
    process.exit(1)
  }
}
if (typeof catalog !== 'object' || catalog === null || Array.isArray(catalog)) {
  console.error('catalog: unexpected top-level shape; refusing to write a snapshot')
  process.exit(1)
}

const table = {}
const seen = new Set()
let duplicates = 0

for (const providerId of [...FIRST_PARTY, ...Object.keys(catalog)]) {
  const provider = catalog[providerId]
  if (!provider?.models) continue

  for (const [modelId, model] of Object.entries(provider.models)) {
    const key = normalize(modelId)
    if (seen.has(key)) {
      duplicates += 1
      continue
    }
    seen.add(key)

    const reasoning = encodeReasoning(model.reasoning_options)
    const flags = encodeFlags(model)

    // A row survives if it says anything the conservative fallback would not
    // already say. That includes the models which *lack* tool calling: an id
    // absent from the table is given the benefit of the doubt and treated as
    // conversational, so an embedding or image model has to be listed
    // explicitly or it would be pre-selected into a chat model list. Rows that
    // merely match the default — tools, nothing else — are dropped.
    if (!reasoning && !/[ipr]/.test(flags) && flags.includes('t')) continue

    table[key] = [reasoning, flags]
  }
}

const rows = Object.keys(table).length
if (rows < 500) {
  console.error(`catalog: only ${rows} usable rows; upstream schema has probably changed`)
  process.exit(1)
}

const body = `/**
 * Model capability snapshot, generated from models.dev — do not edit by hand.
 *
 * Re-generate with \`pnpm sync:catalog\`. Each row is
 * \`[reasoning, flags]\` where flags are \`i\` (images), \`p\` (PDF) and \`t\`
 * (tool calling), and reasoning encodes what the vendor accepts for depth:
 *
 *   e:low|medium|high   effort values, exactly as the vendor documents them
 *   t                   an on/off switch and nothing finer
 *   b:1024~32768       a token budget, with the range the vendor accepts
 *
 * Several may appear for one model (some accept both an effort level and a
 * budget). Flags are \`i\` (images), \`p\` (PDF), \`t\` (tool calling) and
 * \`r\` (reasons, but the vendor publishes no depth options — the family rules
 * in \`capabilities.ts\` decide what control to offer). An id absent from this
 * table is unknown, not incapable.
 *
 * Vendors: ${Object.keys(catalog).length} · models: ${rows}
 */
export interface CatalogEntry {
  /** Encoded reasoning options; empty means the model takes no depth parameter. */
  reasoning: string
  /** \`i\` images · \`p\` PDF · \`t\` tool calling · \`r\` reasons */
  flags: string
}

export const CATALOG: Record<string, [string, string]> = ${JSON.stringify(table)}
`

writeFileSync(OUT, body)
console.log(
  `catalog: ${rows} models from ${Object.keys(catalog).length} vendors -> ${OUT}\n` +
    `         ${duplicates} duplicate ids skipped in favour of the first-party entry`,
)
