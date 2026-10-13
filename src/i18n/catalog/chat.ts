import type { Entry } from '../core'

/**
 * Strings owned by the chat layer: titles it writes into the sidebar, the text
 * it puts in front of a quoted conversation, and the errors it surfaces.
 *
 * Model-facing instructions are NOT here. The prompt that names a title tells
 * the model to answer in the language of the message it is naming, so a Chinese
 * question still gets a Chinese title while the app is in English — the user's
 * language, not the interface's, is what decides.
 */
export const chat = {
  /** The title a conversation carries until it is named. */
  placeholderTitle: { en: 'New chat', zh: '新对话' },
  /** Suffix on a duplicated conversation: "京都五日游（副本）" / "Kyoto · copy". */
  duplicateSuffix: { en: 'copy', zh: '副本' },
  saveFailed: { en: 'Not sent — could not save: {reason}', zh: '保存失败，未发送：{reason}' },
  providerMissing: { en: 'Provider not configured: {providerId}', zh: '供应商未配置: {providerId}' },

  /** Header of a quoted conversation carried as an attachment. */
  quoteHeader: {
    en: 'Another conversation of the user’s, 《{title}》, for background. {rounds} rounds in all.',
    zh: '这是用户之前的另一段对话《{title}》，作为背景参考，共 {rounds} 轮。',
  },
  /** Speaker labels inside that quote. */
  quoteUser: { en: 'User', zh: '用户' },
  /** Name of the attachment chip holding the quote. */
  quoteChipName: { en: 'Quote: {title}', zh: '引用：{title}' },


  /** Appended where an attachment was cut to fit the model's budget. */
  truncated: { en: '\n… (truncated)', zh: '\n…（已截断）' },
  /** Introduces the attached files inside the prompt sent to the model. */
  attachedFilesHeader: {
    en: 'Here are the files that came with the message:',
    zh: '以下是随消息附上的文件内容：',
  },
  /** Per-page header added when extracted PDF text is long enough to need one. */
  pdfPage: { en: '# Page {page}', zh: '# 第 {page} 页' },
} satisfies Record<string, Entry>
