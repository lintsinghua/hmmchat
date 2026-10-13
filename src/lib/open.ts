import { openUrl, revealItemInDir } from '@tauri-apps/plugin-opener'
import { isTauri } from './env'

/**
 * Opens a URL outside the app.
 *
 * Inside Tauri the system browser is used, so a link click never navigates the
 * webview away from the app. In the browser dev loop a new tab is opened.
 */
export async function openExternal(url: string): Promise<void> {
  if (!/^https?:/i.test(url)) return

  if (isTauri) {
    try {
      await openUrl(url)
      return
    } catch {
      // Fall through to the browser path so a plugin failure is not a dead end.
    }
  }

  window.open(url, '_blank', 'noopener,noreferrer')
}

/** Reveals a local file or folder in the Finder. */
export async function revealPath(path: string): Promise<void> {
  if (!isTauri) return
  await revealItemInDir(path)
}
