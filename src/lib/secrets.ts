import { invoke } from '@tauri-apps/api/core'
import { isTauri } from './env'

/**
 * Write-only secret store, backed by src-tauri/src/secrets.rs.
 *
 * Values are never returned to the webview. Provider configuration stores a
 * placeholder (`{{secret:...}}`) where the key belongs, and Rust substitutes the
 * real value on the way out — only for requests to the origin the key was bound
 * to. So model output cannot talk a script into exfiltrating a key: there is no
 * read path to call, and a request aimed at an attacker's host simply does not
 * resolve the placeholder.
 */

/** Origin a provider's key should be bound to, derived from its base URL. */
export function originOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).origin
  } catch {
    return baseUrl
  }
}

/** The placeholder to embed in a header value or URL. */
export function secretPlaceholder(name: string): string {
  return `{{secret:${name}}}`
}

/** Secret names are derived from the provider id so they are stable. */
export function secretNameForProvider(providerId: string): string {
  return `provider:${providerId}`
}

export async function setSecret(name: string, value: string, origin: string): Promise<void> {
  if (!isTauri) {
    // Browser dev loop: keep it in memory only. Never written to disk, and lost
    // on reload — which is the right tradeoff for a key with no native store.
    memorySecrets.set(name, value)
    return
  }
  await invoke('secret_set', { name, value, origin })
}

export async function deleteSecret(name: string): Promise<void> {
  if (!isTauri) {
    memorySecrets.delete(name)
    return
  }
  await invoke('secret_delete', { name })
}

export async function listSecretNames(): Promise<string[]> {
  if (!isTauri) return [...memorySecrets.keys()]
  return invoke<string[]>('secret_names')
}

/** Which secret names exist, for rendering "key is set" state in settings. */
const memorySecrets = new Map<string, string>()

export async function hasSecret(name: string): Promise<boolean> {
  const names = await listSecretNames()
  return names.includes(name)
}
