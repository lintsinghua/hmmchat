import { cn } from '@/lib/cn'
import type { ProviderConfig } from '@/providers/registry'
import { BRAND_SVG, type BrandId } from './brand-svg'

/**
 * A brand mark, drawn in the current text colour.
 *
 * Unknown brands fall back to a monogram in a hairline square rather than a
 * generic glyph, so a self-hosted endpoint still reads as *something* and the
 * row keeps its rhythm.
 */
export function BrandIcon({
  brand,
  fallback,
  className,
}: {
  brand: BrandId | null
  /** Text the monogram is taken from when `brand` is null. */
  fallback?: string
  className?: string
}) {
  if (!brand) {
    const letter = (fallback ?? '').replace(/[^\p{L}\p{N}]/gu, '').charAt(0).toUpperCase() || '·'
    return (
      <span
        aria-hidden
        className={cn(
          'inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px]',
          'border border-current text-[9px] font-semibold leading-none opacity-70',
          className,
        )}
      >
        {letter}
      </span>
    )
  }

  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="currentColor"
      fillRule="evenodd"
      className={cn('h-4 w-4 shrink-0', className)}
      // The markup is a static constant generated at build time, not user input.
      dangerouslySetInnerHTML={{ __html: BRAND_SVG[brand] }}
    />
  )
}

/** Ordered: the first pattern that matches the bare model id wins. */
const MODEL_BRANDS: Array<[RegExp, BrandId]> = [
  [/^claude/, 'claude'],
  [/^(gpt|chatgpt|o\d|codex|davinci|text-embedding|dall-e|whisper|tts)/, 'openai'],
  [/^(gemini|gemma|learnlm)/, 'gemini'],
  [/^deepseek/, 'deepseek'],
  [/^grok/, 'grok'],
  [/^(kimi|moonshot)/, 'kimi'],
  [/^(glm|chatglm|codegeex|cogview)/, 'zhipu'],
  [/^(llama|meta-llama)/, 'meta'],
  [/^(mistral|mixtral|codestral|ministral|pixtral|magistral|devstral)/, 'mistral'],
  [/^(qwen|qwq|qvq)/, 'qwen'],
  [/^(command|c4ai|aya)/, 'cohere'],
  [/^doubao/, 'doubao'],
  [/^(minimax|abab)/, 'minimax'],
  [/^(sonar|pplx)/, 'perplexity'],
  [/^step-/, 'stepfun'],
  [/^yi-/, 'yi'],
  [/^baichuan/, 'baichuan'],
]

/** The model family's mark, from its id (`anthropic/claude-…` works too). */
export function brandForModel(modelId: string): BrandId | null {
  const lower = modelId.toLowerCase().replace(/^~/, '')
  const bare = lower.includes('/') ? lower.slice(lower.lastIndexOf('/') + 1) : lower
  for (const [pattern, brand] of MODEL_BRANDS) {
    if (pattern.test(bare)) return brand
  }
  // OpenRouter-style namespace as a last resort: `meta-llama/…`, `x-ai/…`.
  const vendor = lower.includes('/') ? lower.slice(0, lower.indexOf('/')) : ''
  return vendor ? brandForHost(vendor) : null
}

/** Hosts and vendor names of common OpenAI-compatible endpoints. */
const HOST_BRANDS: Array<[RegExp, BrandId]> = [
  [/anthropic/, 'anthropic'],
  [/openai/, 'openai'],
  [/googleapis|gemini|google/, 'gemini'],
  [/openrouter/, 'openrouter'],
  [/deepseek/, 'deepseek'],
  [/x\.ai|x-ai|xai|grok/, 'xai'],
  [/moonshot|kimi/, 'moonshot'],
  [/bigmodel|zhipu/, 'zhipu'],
  [/ollama|:11434/, 'ollama'],
  [/lmstudio|lm-studio|:1234\b/, 'lmstudio'],
  [/mistral/, 'mistral'],
  [/dashscope|aliyun|qwen/, 'qwen'],
  [/cohere/, 'cohere'],
  [/volces|volcengine|doubao/, 'doubao'],
  [/minimax/, 'minimax'],
  [/perplexity/, 'perplexity'],
  [/groq/, 'groq'],
  [/siliconflow|siliconcloud/, 'siliconcloud'],
  [/stepfun/, 'stepfun'],
  [/lingyiwanwu|01\.ai/, 'yi'],
  [/baichuan/, 'baichuan'],
  [/meta-llama|meta/, 'meta'],
]

function brandForHost(text: string): BrandId | null {
  const lower = text.toLowerCase()
  for (const [pattern, brand] of HOST_BRANDS) {
    if (pattern.test(lower)) return brand
  }
  return null
}

/**
 * The provider's mark.
 *
 * First-party kinds map directly; a custom endpoint is recognised from its base
 * URL and then its name. Anything else gets a monogram.
 */
export function brandForProvider(
  provider: Pick<ProviderConfig, 'kind' | 'baseUrl' | 'name'>,
): BrandId | null {
  switch (provider.kind) {
    case 'anthropic':
      return 'anthropic'
    case 'openai':
      return 'openai'
    case 'google':
      return 'gemini'
    case 'openrouter':
      return 'openrouter'
    case 'openai-compatible':
      return brandForHost(provider.baseUrl) ?? brandForHost(provider.name)
  }
}

/** Convenience: a provider's mark with its name as the monogram fallback. */
export function ProviderIcon({
  provider,
  className,
}: {
  provider: Pick<ProviderConfig, 'kind' | 'baseUrl' | 'name'>
  className?: string
}) {
  return <BrandIcon brand={brandForProvider(provider)} fallback={provider.name} className={className} />
}

/** Convenience: a model family's mark with its id as the monogram fallback. */
export function ModelIcon({ modelId, className }: { modelId: string; className?: string }) {
  return <BrandIcon brand={brandForModel(modelId)} fallback={modelId} className={className} />
}
