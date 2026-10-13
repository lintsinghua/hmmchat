import type { Entry } from '../core'

/** Provider- and capability-facing strings. Keys are stable; copy is read here, not in the module. */
export const providers = {
  hintAnthropic: { en: 'Claude — native web search, thinking depth', zh: 'Claude — 原生联网搜索、思考深度' },
  hintOpenai: { en: 'GPT — Responses API, native web search', zh: 'GPT — Responses API，原生联网搜索' },
  hintGoogle: { en: 'Gemini — thinking levels, Google Search grounding', zh: 'Gemini — 思考级别、Google 搜索接地' },
  hintOpenrouter: { en: 'One key for many vendors’ models', zh: '一个 key 打通多家模型' },
  hintDeepseek: { en: 'V3 and R1, great value', zh: 'V3 与 R1，性价比高' },
  hintXai: { en: 'Grok — live web access', zh: 'Grok — 支持实时联网' },
  nameMoonshot: { en: 'Moonshot Kimi', zh: '月之暗面 Kimi' },
  hintMoonshot: { en: 'Kimi — long context', zh: 'Kimi — 长上下文' },
  nameZhipu: { en: 'Zhipu GLM', zh: '智谱 GLM' },
  hintZhipu: { en: 'GLM models', zh: 'GLM 系列' },
  hintLocal: { en: 'Runs locally, no key needed', zh: '本地运行，无需 key' },
  nameCustom: { en: 'Custom endpoint', zh: '自定义端点' },
  hintCustom: { en: 'Any OpenAI-compatible service', zh: '任何兼容 OpenAI 协议的服务' },
  reasoningParamDisabled: {
    en: 'This endpoint has the thinking-depth parameter turned off; the model uses its own default',
    zh: '该端点的思考深度参数已关闭，模型会使用自己的默认值',
  },
  reasoningOff: { en: 'Off', zh: '关闭' },
  reasoningLow: { en: 'Low', zh: '低' },
  reasoningMedium: { en: 'Medium', zh: '中' },
  reasoningHigh: { en: 'High', zh: '高' },
  reasoningXhigh: { en: 'Extra high', zh: '超高' },
  reasoningMax: { en: 'Max', zh: '最高' },
} satisfies Record<string, Entry>
