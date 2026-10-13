import type { Entry } from '../core'

/**
 * Strings used by more than one layer, or by none in particular.
 *
 * Small on purpose: most copy belongs to the screen that shows it, and a
 * grab-bag catalog is where translations go to be forgotten.
 */
export const lib = {
  /** Why "model's own search" is unavailable on this endpoint. */
  searchNeedsTools: {
    en: 'This model takes no tool calls, so it cannot use the provider’s own search on this endpoint.',
    zh: '这个模型不接受工具调用，在这个端点上无法使用供应商自带的搜索。',
  },
  /** Health-check failure when the endpoint never answers. */
  probeTimeout: { en: 'Timed out (30 s with no response)', zh: '超时（30 秒无响应）' },
  /** Copy-progress noun for a source list. */
  sourcesOne: { en: '1 source', zh: '1 个来源' },
  sourcesMany: { en: '{count} sources', zh: '{count} 个来源' },
} satisfies Record<string, Entry>
