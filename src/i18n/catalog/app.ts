import type { Entry } from '../core'

/** Shell, sidebar and command palette strings. Keys are stable; copy is read here, not in the component. */
export const app = {
  // Title bar
  showSidebar: { en: 'Show sidebar', zh: '显示侧栏' },

  // Empty state greetings: reasons to open the app, not product copy.
  greetingAskAnything: { en: 'What would you like to ask today?', zh: '今天想问点什么？' },
  greetingStockMarket: { en: 'How is the stock market doing today?', zh: '今天的股市怎么样？' },
  greetingSortMaterials: { en: 'Help me make sense of these notes?', zh: '帮我把这堆材料理一理？' },
  greetingBrokenCode: { en: 'Why won’t this code run?', zh: '这段代码为什么跑不起来？' },
  greetingDinner: { en: 'What should I have for dinner?', zh: '晚饭吃什么好呢？' },
  greetingSchedule: { en: 'Can you plan my schedule for next week?', zh: '下周的行程帮我排一下？' },
  greetingEmailReply: { en: 'How should I reply to this email?', zh: '这封邮件该怎么回？' },
  greetingContract: { en: 'Can you check this contract for traps?', zh: '帮我看看这份合同有没有坑？' },

  // Hint chips
  hintDropFiles: { en: 'Drop in files for the model to read', zh: '拖入文件即可让模型阅读' },
  hintCompare: { en: 'Use Compare on the right to run models side by side', zh: '右侧「对比」并排多个模型' },
  hintPalette: { en: 'Open the command palette', zh: '打开命令面板' },

  // Setup prompt
  setupTitle: { en: 'Connect a model first', zh: '先接一个模型' },
  setupAction: { en: 'Set up a provider', zh: '配置供应商' },

  // Sidebar
  newChat: { en: 'New chat', zh: '新对话' },
  search: { en: 'Search', zh: '搜索' },
  noMatchingChats: { en: 'No matching chats', zh: '没有匹配的对话' },
  noChats: { en: 'No chats yet', zh: '还没有对话' },
  settings: { en: 'Settings', zh: '设置' },
  matchAnswer: { en: 'A', zh: '答' },
  matchQuestion: { en: 'Q', zh: '问' },
  confirmDelete: { en: 'Delete?', zh: '删除？' },
  delete: { en: 'Delete', zh: '删除' },
  cancel: { en: 'Cancel', zh: '取消' },
  pin: { en: 'Pin', zh: '置顶' },
  unpin: { en: 'Unpin', zh: '取消置顶' },
  quoteIntoCurrent: { en: 'Quote in current chat', zh: '引用到当前对话' },
  duplicate: { en: 'Duplicate', zh: '复制一份' },
  duplicateChat: { en: 'Duplicate chat', zh: '复制对话' },
  rename: { en: 'Rename', zh: '重命名' },
  deleteChat: { en: 'Delete chat', zh: '删除对话' },
  groupPinned: { en: 'Pinned', zh: '置顶' },
  groupToday: { en: 'Today', zh: '今天' },
  groupYesterday: { en: 'Yesterday', zh: '昨天' },
  groupLastWeek: { en: 'Previous 7 days', zh: '最近 7 天' },
  groupEarlier: { en: 'Earlier', zh: '更早' },

  // Command palette
  paletteUnfocus: { en: 'Back to side by side ({count} columns)', zh: '回到并排（{count} 列）' },
  paletteFocusLane: { en: 'View {name} alone', zh: '单独查看 {name}' },
  paletteToggleSidebar: { en: 'Show / hide sidebar', zh: '显示 / 隐藏侧栏' },
  paletteTitle: { en: 'Command palette', zh: '命令面板' },
  palettePlaceholder: { en: 'Search chats, models or commands…', zh: '搜索对话、模型或命令…' },
  paletteEmpty: { en: 'No matching results', zh: '没有匹配的结果' },
  paletteActions: { en: 'Actions', zh: '操作' },
  paletteModels: { en: 'Models', zh: '模型' },
  paletteChats: { en: 'Chats', zh: '对话' },
} satisfies Record<string, Entry>
