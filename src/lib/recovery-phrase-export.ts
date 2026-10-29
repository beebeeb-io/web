/**
 * Pure helpers behind the recovery-phrase export actions (task 1815).
 * Shared by the legacy onboarding page and the document-driven phrase step
 * through components/recovery-phrase-export.tsx, so they cannot drift apart.
 */

export const PHRASE_FILENAME = 'beebeeb-recovery-phrase.txt'
export const CLIPBOARD_CLEAR_MS = 60_000

/** "01  word" per line, one line per word. */
export function phraseToText(words: string[]): string {
  return words.map((w, i) => `${String(i + 1).padStart(2, '0')}  ${w}`).join('\n')
}

export interface ClipboardLike {
  writeText(text: string): Promise<void>
}

export type Scheduler = (fn: () => void, ms: number) => unknown

/**
 * Copy the phrase and schedule a best-effort wipe of the clipboard after 60 s,
 * to limit how long the phrase sits where other apps can read it.
 */
export async function copyPhraseWithAutoClear(
  phrase: string,
  clipboard: ClipboardLike,
  schedule: Scheduler = (fn, ms) => setTimeout(fn, ms),
): Promise<void> {
  await clipboard.writeText(phrase)
  schedule(() => { clipboard.writeText('').catch(() => {}) }, CLIPBOARD_CLEAR_MS)
}

export function downloadPhraseTxt(words: string[]): void {
  const blob = new Blob([phraseToText(words)], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = PHRASE_FILENAME
  a.click()
  URL.revokeObjectURL(url)
}
