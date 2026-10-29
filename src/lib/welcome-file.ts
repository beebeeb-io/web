/**
 * The "Welcome to Beebeeb.md" file every new account gets (task 1037 update).
 *
 * Onboarding used to upload it unconditionally right after account creation.
 * Since 1037 a new account starts WITHOUT a plan (`account_state:
 * "needs_plan"`, quota 0) and the server refuses the upload with 409
 * `plan_required`, so the file was silently lost. Now:
 *
 *  - onboarding asks `welcomeFileAtSignup(state)`: `upload` as before for an
 *    entitled account (gate off, older server), `defer` for needs_plan — it
 *    then records the server preference `welcome_file: "pending"`;
 *  - `ensureDeferredWelcomeFile` uploads it ONCE, the first time the account is
 *    entitled: on the /choose-plan success path (awaited, so the drive shows it
 *    on arrival) and from the route gate on any later protected page (another
 *    tab, a later visit). The preference then reads "done", so it never
 *    uploads twice; concurrent callers in one tab share one in-flight upload.
 *
 * Pure + dependency-injected so `test/1037-welcome-file.test.ts` pins it; the
 * encrypted upload itself lives in `welcome-file-upload.ts`.
 */

import type { AccountState } from '@beebeeb/shared'

export const WELCOME_FILE_NAME = 'Welcome to Beebeeb.md'

/** Server preference key: "pending" while deferred, "done" once uploaded. */
export const WELCOME_FILE_PREF = 'welcome_file'

export function welcomeFileContent(): string {
  return [
    '# Welcome to Beebeeb',
    '',
    'Your files are now protected by end-to-end encryption.',
    'The decryption key lives on this device — we never see it.',
    '',
    '## Try it',
    '- Drag a file here to upload (it\'s encrypted before leaving your browser)',
    '- Click "Share" to create a link (the key is in the URL fragment)',
    '- Open the link in an incognito tab — watch it decrypt in the browser',
    '',
    '## Need help?',
    '- Support: support@beebeeb.io',
    '',
    'You can delete this file anytime.',
  ].join('\n')
}

/** Onboarding: upload now, or defer until the account holds a plan. */
export function welcomeFileAtSignup(state: AccountState): 'upload' | 'defer' {
  return state === 'ok' ? 'upload' : 'defer'
}

export interface DeferredWelcomeDeps {
  getPref: () => Promise<unknown>
  setPref: (value: 'pending' | 'done') => Promise<void>
  upload: () => Promise<void>
}

const inFlight = new Map<string, Promise<boolean>>()
const doneThisSession = new Set<string>()
/** Users whose preference said "not pending" this session — only onboarding
 *  (which runs before the account is ever entitled) writes "pending". */
const notPendingThisSession = new Set<string>()

/**
 * Upload a deferred welcome file if (and only if) it is still pending. Returns
 * true when the file is now present because of this or an earlier call in this
 * session. A failed upload leaves the preference "pending" (retried later).
 */
export function ensureDeferredWelcomeFile(userId: string, deps: DeferredWelcomeDeps): Promise<boolean> {
  if (doneThisSession.has(userId)) return Promise.resolve(true)
  if (notPendingThisSession.has(userId)) return Promise.resolve(false)
  const running = inFlight.get(userId)
  if (running) return running
  const p = (async () => {
    try {
      const pref = await deps.getPref()
      if (pref !== 'pending') {
        notPendingThisSession.add(userId)
        return false
      }
      await deps.upload()
      await deps.setPref('done')
      doneThisSession.add(userId)
      return true
    } catch {
      return false
    } finally {
      inFlight.delete(userId)
    }
  })()
  inFlight.set(userId, p)
  return p
}

/** Test-only: forget the per-session dedupe state. */
export function __resetWelcomeFileForTests(): void {
  inFlight.clear()
  doneThisSession.clear()
  notPendingThisSession.clear()
}
