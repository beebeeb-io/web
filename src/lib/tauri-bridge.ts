import { invoke } from '@tauri-apps/api/core'

export const isTauri = () =>
  typeof window !== 'undefined' && typeof (window as any).__TAURI__ !== 'undefined'

export async function pushTauriSession(
  token: string,
  masterKeyBytes: Uint8Array,
  email?: string,
): Promise<void> {
  try {
    if (!isTauri()) return
    await invoke('set_session', {
      token,
      masterKey: Array.from(masterKeyBytes),
      email: email ?? null,
    }).catch(console.warn)
  } catch (err) {
    console.warn(err)
  }
}

export async function clearTauriSession(): Promise<void> {
  try {
    if (!isTauri()) return
    await invoke('clear_session').catch(console.warn)
  } catch (err) {
    console.warn(err)
  }
}
