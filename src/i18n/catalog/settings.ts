import type { Entry } from '../core'

/** Settings dialog and shortcut strings. Keys are stable; copy is read here, not in the component. */
export const settings = {
  // Dialog chrome and section names
  dialogTitle: { en: 'Settings', zh: '设置' },
  sectionProviders: { en: 'Providers', zh: '供应商' },
  sectionDefaults: { en: 'New chat defaults', zh: '新对话默认' },
  sectionSearch: { en: 'Web search', zh: '联网搜索' },
  sectionGeneral: { en: 'General', zh: '通用' },
  sectionShortcuts: { en: 'Shortcuts', zh: '快捷键' },

  // Shared actions
  add: { en: 'Add', zh: '添加' },
  save: { en: 'Save', zh: '保存' },
  cancel: { en: 'Cancel', zh: '取消' },

  // Providers list
  providersIntro: {
    en: 'Keys are stored locally by the system and never reach the interface or the database.',
    zh: '密钥保存在系统本地，不会进入界面或数据库。',
  },
  providersEmpty: {
    en: 'No providers yet. Add one and enter an API key to start chatting.',
    zh: '还没有供应商。添加一个并填入 API key 就能开始对话。',
  },
  providerModelCount: { en: '{count} models', zh: '{count} 个模型' },
  editProvider: { en: 'Edit provider', zh: '修改供应商' },
  editProviderHint: { en: 'Edit name, address and key', zh: '修改名称、地址与密钥' },
  deleteProvider: { en: 'Delete provider', zh: '删除供应商' },

  // Provider form
  chooseProvider: { en: 'Choose a provider', zh: '选择供应商' },
  openaiCompatibleGroup: { en: 'OpenAI-compatible', zh: '兼容 OpenAI 协议' },
  editingProvider: { en: 'Edit {name}', zh: '编辑 {name}' },
  configure: { en: 'Configure', zh: '配置' },
  fieldName: { en: 'Name', zh: '名称' },
  fieldNamePlaceholder: { en: 'e.g. Anthropic', zh: '例如 Anthropic' },
  fieldBaseUrl: { en: 'Base URL', zh: 'Base URL' },
  fieldApiKey: { en: 'API key', zh: 'API Key' },
  apiKeyKeepPlaceholder: { en: 'Leave empty to keep the saved key', zh: '留空则不修改已保存的密钥' },
  apiKeyLocalPlaceholder: {
    en: 'Optional for local services — any value works',
    zh: '本地服务可留空或随意填写',
  },
  apiKeyEditNote: {
    en: 'The key is written only to local system storage and cannot be read back, so the old value is not shown here. Enter a new one to replace it.',
    zh: '密钥只写入系统本地、不可读回，因此这里不会显示原来的值。填入新值即可替换。',
  },
  baseUrlChangedNotice: {
    en: 'Base URL changed — make sure the test below passes',
    zh: 'Base URL 已改变，请确认下面的测试通过',
  },
  modelListFetchFailed: {
    en: 'Saved, but the model list could not be fetched. You can add model IDs manually below.',
    zh: '已保存，但没取到模型列表。可以在下面手动添加模型 ID。',
  },

  // Reasoning parameter (OpenAI-compatible endpoints)
  fieldReasoningWire: { en: 'Thinking-depth parameter', zh: '思考深度参数' },
  wireAuto: { en: 'Automatic (inferred from model name)', zh: '自动（按模型名推断）' },
  wireEffort: { en: 'Send reasoning_effort (recommended)', zh: '发送 reasoning_effort（推荐）' },
  wireBudget: { en: 'Send thinking.budget_tokens', zh: '发送 thinking.budget_tokens' },
  wireNone: { en: 'Send no depth parameter', zh: '不发送任何深度参数' },
  wireHintAuto: {
    en: 'Decided by model name: Claude and GPT models show thinking depth, others do not.',
    zh: '按模型名判断：Claude 与 GPT 系列显示思考深度，其余不显示。',
  },
  wireHintEffort: {
    en: 'Sends the OpenAI-style reasoning_effort, accepted by most compatible services (relays included).',
    zh: '发送 OpenAI 形状的 reasoning_effort，多数兼容服务（含各类中转）都接受。',
  },
  wireHintBudget: {
    en: 'Sends the Anthropic-style thinking.budget_tokens, for services that expose that field themselves.',
    zh: '发送 Anthropic 形状的 thinking.budget_tokens，适合自行暴露该字段的服务。',
  },
  wireHintNone: {
    en: 'Sends nothing. Pick this when the server rejects unknown fields; the thinking-depth control is hidden.',
    zh: '完全不发送。服务端拒绝未知字段时选这个，思考深度控件会隐藏。',
  },

  // Provider model list
  modelsEnabled: { en: '{enabled}/{total} enabled', zh: '{enabled}/{total} 已启用' },
  modelsUnavailable: { en: '{count} unavailable', zh: '{count} 个不可用' },
  modelsAllAvailable: { en: 'All available', zh: '全部可用' },
  testEnabled: { en: 'Test enabled', zh: '测试已启用' },
  fetchModels: { en: 'Fetch models', zh: '获取模型' },
  modelsEmpty: {
    en: 'No models yet. Click “Fetch models” or add one manually below.',
    zh: '还没有模型。点「获取模型」，或在下面手动添加。',
  },
  manualModelPlaceholder: { en: 'Add a model ID manually, press Return', zh: '手动添加模型 ID，回车确认' },

  // Model health check
  probeHint: {
    en: 'Send a minimal request to check whether this model responds',
    zh: '发送一个最小请求，确认这个模型能否响应',
  },
  probeOk: {
    en: 'Responded in {latency}. Click to test again',
    zh: '响应正常，用时 {latency}。点击重新测试',
  },
  unavailable: { en: 'Unavailable', zh: '不可用' },
  test: { en: 'Test', zh: '测试' },

  // Web search
  searchIntro: {
    en: 'Built-in model search needs no setup. The third-party search below is for models without one.',
    zh: '模型自带的搜索不需要配置。下面的第三方搜索用于没有自带搜索的模型。',
  },
  configured: { en: 'Configured', zh: '已配置' },
  searchKeySavedPlaceholder: { en: 'Saved (type again to replace)', zh: '已保存（重新输入可覆盖）' },
  removeSearchKey: { en: 'Remove {name} key', zh: '移除 {name} 密钥' },

  // New chat defaults
  defaultsIntro: {
    en: 'Only for new chats. An existing chat reopens with the composer settings from its last send.',
    zh: '只用于新建的对话。已有的对话打开时，沿用它上一次发送时输入框的设置。',
  },
  defaultModel: { en: 'Default model', zh: '默认模型' },
  followLastModel: { en: 'Last model used', zh: '跟随上次使用的模型' },
  disabledSuffix: { en: '{name} (disabled)', zh: '{name}（已停用）' },
  disabled: { en: 'Disabled', zh: '已停用' },
  defaultCompareModels: {
    en: 'Default side-by-side models (up to {max})',
    zh: '默认并列模型（最多 {max} 个）',
  },
  enableModelsFirst: { en: 'Enable models under Providers first.', zh: '先在供应商里启用模型。' },
  compareHint: {
    en: 'Checked models answer alongside the default model from the first message of a new chat.',
    zh: '勾选后，新对话从第一条消息起就和默认模型并排回答。',
  },
  searchOff: { en: 'Off', zh: '关闭' },
  searchNative: {
    en: 'Built into the model (third-party when unsupported)',
    zh: '模型自带（不支持时用第三方）',
  },
  reasoning: { en: 'Thinking depth', zh: '思考深度' },
  reasoningFallbackHint: {
    en: 'If a model lacks this level, its closest level is used.',
    zh: '模型没有这一档时，用它最接近的一档。',
  },

  // General
  appearance: { en: 'Appearance', zh: '外观' },
  themeLight: { en: 'Light', zh: '浅色' },
  themeDark: { en: 'Dark', zh: '深色' },
  themeSystem: { en: 'System', zh: '跟随系统' },
  systemPrompt: { en: 'Custom instructions for all chats', zh: '全局自定义指令' },
  systemPromptPlaceholder: {
    en: 'e.g. Keep answers brief: conclusion first, then the reasons.',
    zh: '例如：回答尽量简洁，先给结论再给理由。',
  },
  autoTitle: { en: 'Generate titles for new chats automatically', zh: '自动为新对话生成标题' },
  // Interface language; the row itself is wired by the store owner.
  uiLanguage: { en: 'Interface language', zh: '界面语言' },
  uiLanguageZh: { en: '中文', zh: '中文' },
  uiLanguageEn: { en: 'English', zh: 'English' },

  // Shortcuts
  shortcutsIntro: {
    en: 'Click any binding, then press the key combination you want. At least one ⌘ / ⌥ / ⇧ is required.',
    zh: '点击任何一个键位，然后按下你想用的组合键。至少需要一个 ⌘ / ⌥ / ⇧。',
  },
  shortcutConflict: { en: 'Conflicts with “{name}”', zh: '与「{name}」冲突' },
  resetShortcut: { en: 'Restore default binding for {name}', zh: '恢复 {name} 的默认键位' },
  fixedBehaviour: { en: 'Fixed behaviour', zh: '固定行为' },
  pressKeys: { en: 'Press keys…', zh: '按下组合键…' },
  escToCancel: { en: 'Esc to cancel', zh: 'Esc 取消' },
  fixedSend: { en: 'Send', zh: '发送' },
  fixedSendHint: { en: 'Press in the composer to send', zh: '在输入框中按下即发送' },
  fixedNewline: { en: 'New line', zh: '换行' },
  fixedNewlineHint: { en: 'Insert a line break instead of sending', zh: '输入换行而不是发送' },

  // Shortcut actions (src/lib/shortcuts.ts)
  shortcutNewChat: { en: 'New chat', zh: '新对话' },
  shortcutNewChatHint: { en: 'Start a new conversation', zh: '开一个新会话' },
  shortcutPalette: { en: 'Command palette', zh: '命令面板' },
  shortcutPaletteHint: { en: 'Search chats, models and actions', zh: '搜索对话、模型与操作' },
  shortcutModelPicker: { en: 'Switch model', zh: '切换模型' },
  shortcutModelPickerHint: { en: 'Open the model picker for the composer', zh: '打开当前输入的模型选择' },
  shortcutToggleSidebar: { en: 'Show / hide sidebar', zh: '显示 / 隐藏侧栏' },
  shortcutToggleSidebarHint: { en: 'Switch between focused reading and browsing', zh: '在专注阅读与浏览之间切换' },
  shortcutSettings: { en: 'Settings', zh: '设置' },
  shortcutSettingsHint: { en: 'Open the settings window', zh: '打开设置窗口' },
  shortcutStop: { en: 'Stop generating', zh: '停止生成' },
  shortcutStopHint: { en: 'Stop every answer that is generating', zh: '中止当前所有正在生成的回答' },
} satisfies Record<string, Entry>
