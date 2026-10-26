import type { Entry } from '../core'

/**
 * Composer strings: the composer itself, its compare/search/reasoning
 * popovers, the model picker, the quote picker and attachment notices.
 * Keys are stable; copy is read here, not in the component.
 */
export const composer = {
  // --- Text box ------------------------------------------------------------
  placeholder: { en: 'Ask something, or drop files here…', zh: '问点什么，或把文件拖进来…' },
  placeholderTouch: { en: 'Ask something…', zh: '问点什么…' },
  placeholderTogether: {
    en: 'Ask something — {count} models will answer together…',
    zh: '问点什么，{count} 个模型一起回答…',
  },
  placeholderSome: { en: 'Ask something — {count} models will answer…', zh: '问点什么，{count} 个模型回答…' },
  placeholderOnly: { en: 'Ask something — only {model} will answer…', zh: '问点什么，只有 {model} 回答…' },
  footerHint: { en: 'Enter to send · Shift+Enter for a new line', zh: 'Enter 发送 · Shift+Enter 换行' },
  send: { en: 'Send', zh: '发送' },
  stop: { en: 'Stop', zh: '停止' },
  stopGenerating: { en: 'Stop generating', zh: '停止生成' },

  // --- Add menu ------------------------------------------------------------
  add: { en: 'Add', zh: '添加' },
  addTitle: { en: 'Add files or quote a chat', zh: '添加文件或引用对话' },
  addFiles: { en: 'Add files', zh: '添加文件' },
  addFilesHint: { en: 'Or drag and paste', zh: '可拖入或粘贴' },
  quoteChat: { en: 'Quote a chat…', zh: '引用对话…' },
  quoteChatHint: { en: 'Type @', zh: '输入 @' },
  skippedUnsupportedOne: { en: 'Skipped 1 unsupported file', zh: '已跳过 1 个不支持的文件' },
  skippedUnsupported: { en: 'Skipped {count} unsupported files', zh: '已跳过 {count} 个不支持的文件' },

  // --- Model chips ---------------------------------------------------------
  dragToReorder: { en: 'Drag to reorder models', zh: '拖动以调整模型顺序' },
  sendTo: { en: 'Send to {model}', zh: '发给 {model}' },
  atLeastOneModel: { en: 'At least one model must receive the message', zh: '至少要发给一个模型' },
  excludeFromNext: { en: 'Stop sending to {model} from the next message', zh: '下一条起不发给 {model}' },
  includeFromNext: { en: 'Also send to {model} from the next message', zh: '下一条起也发给 {model}' },
  defaultCompareModel: {
    en: '{model} (default comparison model — change it in Settings)',
    zh: '{model}（默认并列模型，可在设置中修改）',
  },
  remove: { en: 'Remove {name}', zh: '移除 {name}' },
  removedModel: { en: 'Removed {model}', zh: '已移除 {model}' },
  restoreModelTitle: { en: 'Bring back {model} and its answers', zh: '把 {model} 和它的回答放回来' },
  undo: { en: 'Undo', zh: '撤销' },
  backToSideBySide: { en: 'Back to side by side (Esc)', zh: '回到并排（Esc）' },
  viewingAlone: { en: 'Viewing alone', zh: '单独查看' },
  allColumns: { en: 'All {count} columns', zh: '全部 {count} 列' },
  sendToAllTitle: { en: 'Send to all models again (Esc)', zh: '恢复发给全部模型（Esc）' },
  onlyItAnswers: { en: 'Only this one answers', zh: '仅它回答' },
  someAnswering: { en: '{n}/{total} answering', zh: '{n}/{total} 个回答' },
  all: { en: 'All', zh: '全部' },

  // --- Attachment chip -----------------------------------------------------
  rounds: { en: '{count} rounds', zh: '{count} 轮' },
  characters: { en: '{count} chars', zh: '{count} 字' },
  imageNotVisible: { en: "This model can't see images", zh: '当前模型看不到图片' },

  // --- Compare -------------------------------------------------------------
  maxLanes: { en: 'Up to {max} models side by side', zh: '最多 {max} 个模型并排' },
  comparingTitle: {
    en: 'Comparing {count} models — click to add another',
    zh: '正在并排 {count} 个模型，点这里再加一个',
  },
  compareTitle: { en: 'Compare models side by side', zh: '并排对比多个模型' },
  columns: { en: '{count} columns', zh: '{count} 列' },
  modelsCount: { en: '{count} models', zh: '{count} 个模型' },
  modelsAsked: { en: '{n}/{total} models', zh: '{n}/{total} 个模型' },
  answeringModels: { en: 'Models answering', zh: '回答的模型' },
  askAll: { en: 'Ask all', zh: '全部都问' },
  compare: { en: 'Compare', zh: '对比' },
  removed: { en: 'Removed', zh: '已移除' },
  answeredRounds: { en: '{count} rounds answered', zh: '{count} 轮回答' },
  restore: { en: 'Restore', zh: '恢复' },
  addAnotherModel: { en: 'Add another model', zh: '再加一个模型' },
  compareSideBySide: { en: 'Compare side by side', zh: '并排对比' },

  // --- Web search ----------------------------------------------------------
  webSearch: { en: 'Web search', zh: '联网搜索' },
  webSearchMode: { en: 'Web search: {mode}', zh: '联网搜索：{mode}' },
  webSearchOff: { en: 'Web search is off', zh: '联网搜索已关闭' },
  webSearchUnsupported: { en: "This model doesn't support web search", zh: '这个模型不支持联网搜索' },
  off: { en: 'Off', zh: '关闭' },
  builtInSearch: { en: 'Built-in', zh: '模型自带' },
  unsupported: { en: 'Not supported', zh: '不支持' },
  searchNative: { en: 'Web', zh: '联网' },

  // --- Reasoning -----------------------------------------------------------
  reasoningDefault: { en: 'Default', zh: '默认' },
  reasoningDepth: { en: 'Reasoning', zh: '思考深度' },
  reasoningDepthValue: { en: 'Reasoning: {level}', zh: '思考深度：{level}' },
  reasoningPerColumn: { en: 'Reasoning per column', zh: '各列思考深度' },
  modelReasoning: { en: '{model} reasoning', zh: '{model} 思考深度' },
  reasoningNotAdjustable: {
    en: "This model's reasoning depth can't be adjusted",
    zh: '这个模型不支持调节思考深度',
  },
  listSeparator: { en: ', ', zh: '，' },

  // --- Model picker --------------------------------------------------------
  noModels: {
    en: 'No models available yet. Add a provider in Settings first.',
    zh: '还没有可用模型。先在设置里添加供应商。',
  },

  // --- Quote picker --------------------------------------------------------
  quoteDialogTitle: { en: 'Quote a chat', zh: '引用对话' },
  searchChatsToQuote: { en: 'Search chats to quote…', zh: '搜索要引用的对话…' },
  noMatchingChats: { en: 'No matching chats', zh: '没有匹配的对话' },
  noOtherChats: { en: 'No other chats to quote yet', zh: '还没有别的对话可以引用' },
  untitledChat: { en: 'New chat', zh: '新对话' },
  loadingChat: { en: 'Loading chat…', zh: '正在读取对话…' },
  chatGone: { en: 'This chat no longer exists', zh: '这个对话已经不存在了' },
  backToChatList: { en: 'Back to chat list', zh: '返回对话列表' },
  pickRoundsHint: {
    en: 'Choose the rounds to quote as context for this chat',
    zh: '选择要引用的轮次，作为这段对话的背景',
  },
  selectNone: { en: 'Select none', zh: '全不选' },
  selectAll: { en: 'Select all', zh: '全选' },
  quoteWhichColumn: { en: "Which column's answers to quote", zh: '引用哪一列的回答' },
  quote: { en: 'Quote', zh: '引用' },
  columnAnswersSuffix: { en: 'answers', zh: '的回答' },
  emptyChat: { en: 'This chat is empty', zh: '这个对话还没有内容' },
  roundLabel: { en: 'Round {n}: {question}', zh: '第 {n} 轮：{question}' },
  attachmentsOnly: { en: '(Attachments only)', zh: '（只有附件）' },
  roundUnanswered: {
    en: "{model} didn't answer this round — only the question will be quoted",
    zh: '{model} 没有回答这一轮，只引用问题',
  },
  quoteSize: { en: '{count} rounds · about {chars} chars', zh: '{count} 轮 · 约 {chars} 字' },
  noRoundsSelected: { en: 'No rounds selected', zh: '没有选择轮次' },
  quoteTooLong: { en: ' · Long — vision models will truncate it', zh: ' · 较长，能看图的模型会截断' },
  cancel: { en: 'Cancel', zh: '取消' },

  // --- Attachment notices (src/lib/attachments.ts) -------------------------
  fileTooLarge: { en: 'Larger than {size} — not read', zh: '文件超过 {size}，未读取' },
  imageNote: {
    en: 'Image: readable only if the model supports vision',
    zh: '图片：按模型是否支持视觉决定能否直接查看',
  },
  noTextExtracted: { en: "Couldn't extract text from this file", zh: '未能从这个文件里提取文字' },
  binaryFile: { en: 'Binary file — contents not read', zh: '二进制文件，未读取内容' },
  readFailed: { en: 'Read failed', zh: '读取失败' },
  readFailedWith: { en: 'Read failed: {error}', zh: '读取失败：{error}' },
  pdfNoText: {
    en: 'This PDF has no text layer (possibly a scan) — only vision models can read it',
    zh: '这份 PDF 没有文字层（可能是扫描件），只有支持视觉的模型能读',
  },
  pdfParseFailed: { en: "Couldn't parse PDF: {error}", zh: 'PDF 解析失败：{error}' },
} satisfies Record<string, Entry>
