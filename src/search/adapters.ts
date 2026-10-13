import { tool } from 'ai'
import { jsonSchema } from 'ai'
import { secretNameForProvider, secretPlaceholder } from '@/lib/secrets'
import type { SearchMode, Source } from '@/chat/types'

/**
 * Bring-your-own web search.
 *
 * The app's default is the provider's own hosted search (cheaper to build, no
 * second API key). These adapters exist for the cases where that is not
 * available: models with no hosted search, and endpoints the user adds
 * themselves. They are exposed to the model as one `web_search` function tool,
 * so the UI renders search steps and citations identically either way.
 *
 * `jsonSchema` is used rather than zod to keep zod out of the dependency tree —
 * the AI SDK exports the helper.
 */

export interface SearchResult {
  title: string
  url: string
  /** Text handed to the model as context. */
  content: string
}

export interface SearchAdapter {
  id: Exclude<SearchMode, 'native' | 'none'>
  label: string
  /** Placeholder shown in settings when no key is configured. */
  keyHint: string
  search(query: string, signal: AbortSignal): Promise<SearchResult[]>
}

const RESULT_LIMIT = 5

/** Reads a JSON response, turning a non-2xx into a readable error. */
async function readJson(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!response.ok) {
    // Vendor error bodies vary; include the status so the user can tell an
    // auth failure from a rate limit, and truncate so a stray HTML page does
    // not flood the chat.
    throw new Error(`${response.status} ${text.slice(0, 300)}`)
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`unexpected response: ${text.slice(0, 200)}`)
  }
}

const tavily: SearchAdapter = {
  id: 'tavily',
  label: 'Tavily',
  keyHint: 'tvly-…',
  async search(query, signal) {
    const apiKey = resolveKey('tavily')
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        max_results: RESULT_LIMIT,
        // The "advanced" depth returns cleaned page text rather than snippets,
        // which is what makes the results useful as model context.
        search_depth: 'advanced',
        include_answer: false,
      }),
      signal,
    })

    const data = (await readJson(response)) as {
      results?: Array<{ title?: string; url?: string; content?: string }>
    }

    return (data.results ?? []).slice(0, RESULT_LIMIT).map((item) => ({
      title: item.title ?? item.url ?? 'untitled',
      url: item.url ?? '',
      content: item.content ?? '',
    }))
  },
}

const brave: SearchAdapter = {
  id: 'brave',
  label: 'Brave Search',
  keyHint: 'BSA…',
  async search(query, signal) {
    const apiKey = resolveKey('brave')
    const url = new URL('https://api.search.brave.com/res/v1/web/search')
    url.searchParams.set('q', query)
    url.searchParams.set('count', String(RESULT_LIMIT))

    const response = await fetch(url, {
      headers: { accept: 'application/json', 'x-subscription-token': apiKey },
      signal,
    })

    const data = (await readJson(response)) as {
      web?: { results?: Array<{ title?: string; url?: string; description?: string }> }
    }

    return (data.web?.results ?? []).slice(0, RESULT_LIMIT).map((item) => ({
      title: item.title ?? item.url ?? 'untitled',
      url: item.url ?? '',
      content: item.description ?? '',
    }))
  },
}

const exa: SearchAdapter = {
  id: 'exa',
  label: 'Exa',
  keyHint: 'exa-…',
  async search(query, signal) {
    const apiKey = resolveKey('exa')
    const response = await fetch('https://api.exa.ai/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify({
        query,
        numResults: RESULT_LIMIT,
        // Exa returns page text with search results at no extra charge, which
        // is why it needs no separate content-fetch step.
        contents: { text: { maxCharacters: 4000 } },
      }),
      signal,
    })

    const data = (await readJson(response)) as {
      results?: Array<{ title?: string; url?: string; text?: string }>
    }

    return (data.results ?? []).slice(0, RESULT_LIMIT).map((item) => ({
      title: item.title ?? item.url ?? 'untitled',
      url: item.url ?? '',
      content: item.text ?? '',
    }))
  },
}

export const SEARCH_ADAPTERS: SearchAdapter[] = [tavily, brave, exa]

export function searchAdapter(id: string): SearchAdapter | undefined {
  return SEARCH_ADAPTERS.find((adapter) => adapter.id === id)
}

/**
 * Resolves a search API key.
 *
 * Search vendors have no CORS-friendly story either, so the key is a Rust-side
 * secret like the provider keys — the adapter sends the placeholder and the
 * proxy substitutes it. In the browser dev loop there is no proxy, and the
 * caller is talking to the mock, so a stand-in value is fine.
 */
function resolveKey(adapterId: string): string {
  return secretPlaceholder(secretNameForProvider(`search:${adapterId}`))
}

/** Builds the `web_search` tool exposed to models without hosted search. */
export function createSearchTool(
  adapter: SearchAdapter,
  onStep: (step: { query: string; sources: Source[] }) => void,
) {
  return tool({
    description:
      'Search the web for current information. Use it when the answer depends on facts ' +
      'you cannot verify from memory, and cite the returned sources by URL in your answer.',
    inputSchema: jsonSchema<{ query: string }>({
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query. Be specific and use the user\'s own terminology.',
        },
      },
      required: ['query'],
      additionalProperties: false,
    }),
    async execute({ query }, { abortSignal }) {
      const results = await adapter.search(
        query,
        abortSignal ?? new AbortController().signal,
      )

      const sources: Source[] = results.map((result, index) => ({
        id: `${adapter.id}-${index}-${result.url}`,
        url: result.url,
        title: result.title,
      }))

      onStep({ query, sources })

      // Returned to the model as text: a numbered list keeps the citations the
      // model writes in its answer easy to reconcile with the source chips.
      return results
        .map(
          (result, index) =>
            `[${index + 1}] ${result.title}\n${result.url}\n${result.content.slice(0, 3000)}`,
        )
        .join('\n\n')
    },
  })
}
