import { useMemo, type MouseEvent } from 'react'
import { Streamdown, type PluginConfig, type StreamdownTranslations } from 'streamdown'
import { createMathPlugin } from '@streamdown/math'
import remarkCjkFriendly from 'remark-cjk-friendly'
import 'streamdown/styles.css'
import 'katex/dist/katex.min.css'
import { cn } from '@/lib/cn'
import { openExternal } from '@/lib/open'
import { getLanguage, useT } from '@/i18n/core'
import { thread } from '@/i18n'
import { leadHeadings } from '@/lib/lead-heading'
import { normalizeMath } from '@/lib/math'
import { keepMathPunctuation } from '@/lib/math-nobreak'

/**
 * Assistant message body.
 *
 * Streamdown handles the hard part of rendering *partially received* markdown:
 * an unterminated code fence, a half-typed table, or a `**bold` that has not
 * closed yet all parse without the whole block flipping between plain and
 * formatted on every chunk. It also withholds syntax highlighting until a fence
 * closes, which avoids a large code block visibly re-highlighting itself as it
 * grows.
 *
 * The `cjk` plugin places `remark-cjk-friendly` *before* remark-gfm. That
 * ordering matters: without it, `**粗体：**` followed by Chinese punctuation
 * fails to parse as emphasis, which is the single most common markdown defect
 * in Chinese model output. `leadHeadings` rides along after it, so a bold
 * line standing alone spaces like the section label it is.
 *
 * The `math` plugin renders KaTeX. Its parser only sees `$$…$$`;
 * `normalizeMath` first rewrites the `\(…\)`, `\[…\]` and `$…$` that models
 * actually write, so a lone dollar in a price is never read as a formula.
 */

type Transformer = (tree: unknown, file: unknown) => unknown
type Attacher = (this: unknown, options: unknown) => Transformer | void

const katex = createMathPlugin({ errorColor: 'hsl(var(--ink-muted))' })
const [rehypeKatex, katexOptions] = katex.rehypePlugin as [Attacher, unknown]

const PLUGINS: PluginConfig = {
  math: {
    ...katex,
    // Streamdown takes one rehype plugin for math and runs it after its own
    // sanitizer, so the punctuation pass rides in front of KaTeX here, where
    // the class it adds survives.
    rehypePlugin: [
      function (this: unknown, options: unknown): Transformer {
        const render = rehypeKatex.call(this, options)
        return (tree, file) => {
          keepMathPunctuation(tree as Parameters<typeof keepMathPunctuation>[0])
          return render?.(tree, file)
        }
      },
      katexOptions,
    ],
  },
  cjk: {
    name: 'cjk',
    type: 'cjk',
    remarkPlugins: [],
    remarkPluginsAfter: [leadHeadings],
    // Must run before remark-gfm so emphasis parsing sees the CJK boundaries.
    remarkPluginsBefore: [remarkCjkFriendly],
  },
}

interface MarkdownProps {
  children: string
  /** True while tokens are still arriving — enables the streaming caret. */
  streaming?: boolean
  /** Tighter type for narrow compare columns. */
  compact?: boolean
  className?: string
}

export function Markdown({ children, streaming, compact, className }: MarkdownProps) {
  const t = useT()
  const language = getLanguage()
  // Streamdown's own controls; only those this component leaves enabled. Kept
  // referentially stable per language so streaming tokens do not re-render them.
  const translations = useMemo<Partial<StreamdownTranslations>>(
    () => ({
      copied: t(thread.copied),
      copyCode: t(thread.copyCode),
      copyTable: t(thread.copyTable),
      copyTableAsMarkdown: t(thread.copyTableAsMarkdown),
      copyTableAsCsv: t(thread.copyTableAsCsv),
      copyTableAsTsv: t(thread.copyTableAsTsv),
      imageNotAvailable: t(thread.imageNotAvailable),
      openExternalLink: t(thread.openExternalLink),
      externalLinkWarning: t(thread.externalLinkWarning),
      openLink: t(thread.openLink),
      copyLink: t(thread.copyLink),
      close: t(thread.close),
    }),
    // `t` is stable; the language is what changes the strings.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [language],
  )

  const source = useMemo(() => normalizeMath(children), [children])

  // Links open in the system browser rather than navigating the webview: doing
  // otherwise would replace the app with a web page and lose the session.
  const handleClick = useMemo(
    () => (event: MouseEvent<HTMLDivElement>) => {
      const anchor = (event.target as HTMLElement).closest('a')
      if (!anchor) return
      const href = anchor.getAttribute('href')
      if (!href) return
      event.preventDefault()
      void openExternal(href)
    },
    [],
  )

  return (
    <div
      className={cn('md', compact && 'md-compact', className)}
      onClick={handleClick}
    >
      <Streamdown
        mode={streaming ? 'streaming' : 'static'}
        isAnimating={streaming}
        plugins={PLUGINS}
        translations={translations}
        // The caret is rendered by the smoother at the true end of the visible
        // text; Streamdown's own would double up on it.
        caret="block"
        controls={{
          code: { copy: true, download: false },
          table: { copy: true, download: false, fullscreen: false },
          mermaid: false,
          image: { download: false },
        }}
        // Code blocks in a chat are rarely taller than this, and a scrollbar
        // inside a scrolling thread is confusing.
        codeBlockMaxHeight={560}
        tableMaxHeight={420}
      >
        {source}
      </Streamdown>
    </div>
  )
}
