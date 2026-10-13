import type { Entry } from '../core'

/** Thread and message strings. Keys are stable; copy is read here, not in the components. */
export const thread = {
  // Thread
  satOutTitle: {
    en: '{model} was not sent these {count} rounds and cannot see them',
    zh: '这 {count} 轮没有发给 {model}，它也看不到',
  },
  satOutRounds: { en: 'Sat out {count} rounds', zh: '{count} 轮未参与' },
  skippedTitle: {
    en: '{model} was not asked this one and cannot see it',
    zh: '{model} 没有被问到这一条，也看不到它',
  },
  skipped: { en: 'Not asked', zh: '未参与' },
  viewAlone: { en: 'View {model} alone', zh: '单独查看 {model}' },
  scrollToBottom: { en: 'Scroll to bottom', zh: '回到底部' },

  // ReplyView
  inheritedFrom: { en: 'From {model}', zh: '承自 {model}' },
  answerItself: { en: 'Let it answer', zh: '让它自己答' },
  thinking: { en: 'Thinking', zh: '思考中' },
  retry: { en: 'Retry', zh: '重试' },
  copied: { en: 'Copied', zh: '已复制' },
  copy: { en: 'Copy', zh: '复制' },
  copyAnswer: { en: 'Copy answer', zh: '复制回答' },
  regenerate: { en: 'Regenerate', zh: '重新生成' },
  previousVersion: { en: 'Previous version', zh: '上一个版本' },
  nextVersion: { en: 'Next version', zh: '下一个版本' },
  outputTokens: { en: '{count} tokens', zh: '{count} tokens' },
  stop: { en: 'Stop', zh: '停止' },
  stopGenerating: { en: 'Stop generating', zh: '停止生成' },
  columnPosition: { en: 'Column {n} of {count}', zh: '第 {n} 列，共 {count} 列' },

  // UserMessage
  cancel: { en: 'Cancel', zh: '取消' },
  resend: { en: 'Resend', zh: '重新发送' },
  quoteTitle: {
    en: 'Quoted from “{title}” · {count} rounds · Click to open the original chat',
    zh: '引用自《{title}》· {count} 轮 · 点击打开原对话',
  },
  characters: { en: '{count} chars', zh: '{count} 字' },
  binary: { en: 'Binary', zh: '二进制' },
  previousQuestionVersion: { en: 'Previous version of this question', zh: '上一个提问版本' },
  nextQuestionVersion: { en: 'Next version of this question', zh: '下一个提问版本' },
  forkHere: { en: 'Branch from here', zh: '从这里分支' },
  forkHereHint: {
    en: 'Start a new chat with the context up to this point',
    zh: '连同之前的上下文开一个新对话',
  },
  editAndResend: { en: 'Edit and resend', zh: '编辑并重新发送' },
  editMessage: { en: 'Edit message', zh: '编辑消息' },

  // ReasoningPanel
  reasoningStreaming: { en: 'Thinking', zh: '正在思考' },
  reasoningDone: { en: 'Thought for {seconds} s', zh: '已思考 {seconds} 秒' },
  reasoning: { en: 'Reasoning', zh: '思考过程' },

  // SearchSteps
  searching: { en: 'Searching {query}', zh: '正在搜索 {query}' },
  searchedQuery: { en: 'Searched “{query}”', zh: '已搜索 “{query}”' },
  searchedTimes: { en: 'Searched {count} times', zh: '已搜索 {count} 次' },
  sourceCountOne: { en: ' · 1 source', zh: ' · 1 个来源' },
  sourceCount: { en: ' · {count} sources', zh: ' · {count} 个来源' },

  // Markdown (Streamdown's built-in controls; only those this app enables)
  copyCode: { en: 'Copy code', zh: '复制代码' },
  copyTable: { en: 'Copy table', zh: '复制表格' },
  copyTableAsMarkdown: { en: 'Copy table as Markdown', zh: '以 Markdown 复制表格' },
  copyTableAsCsv: { en: 'Copy table as CSV', zh: '以 CSV 复制表格' },
  copyTableAsTsv: { en: 'Copy table as TSV', zh: '以 TSV 复制表格' },
  imageNotAvailable: { en: 'Image not available', zh: '图片无法显示' },
  openExternalLink: { en: 'Open external link?', zh: '打开外部链接？' },
  externalLinkWarning: {
    en: 'You’re about to visit an external website.',
    zh: '即将访问一个外部网站。',
  },
  openLink: { en: 'Open link', zh: '打开链接' },
  copyLink: { en: 'Copy link', zh: '复制链接' },
  close: { en: 'Close', zh: '关闭' },
} satisfies Record<string, Entry>
