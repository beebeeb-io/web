import { describe, expect, test } from 'bun:test'
import {
  WELCOME_FILE_NAME,
  WELCOME_FILE_PREF,
  welcomeFileContent,
  welcomeFileAtSignup,
  ensureDeferredWelcomeFile,
  __resetWelcomeFileForTests,
} from '../src/lib/welcome-file'

/**
 * Task 1037 — the welcome file must not be lost for an account that signs up
 * without a plan. Onboarding skips the upload while `account_state` is
 * `needs_plan` (the server refuses it with 409 plan_required) and records a
 * `welcome_file: "pending"` preference; the file is uploaded ONCE, the first
 * time the account is entitled (the /choose-plan success path, or any later
 * protected page), and the preference then reads "done".
 */

function fakePrefs(initial: unknown = null) {
  let value: unknown = initial
  const writes: unknown[] = []
  return {
    get: async () => value,
    set: async (v: unknown) => {
      value = v
      writes.push(v)
    },
    writes,
    current: () => value,
  }
}

describe('welcome file content', () => {
  test('name + markdown body are stable', () => {
    expect(WELCOME_FILE_NAME).toBe('Welcome to Beebeeb.md')
    expect(WELCOME_FILE_PREF).toBe('welcome_file')
    expect(welcomeFileContent()).toStartWith('# Welcome to Beebeeb\n')
    expect(welcomeFileContent()).toContain('You can delete this file anytime.')
  })
})

describe('welcomeFileAtSignup — onboarding decision', () => {
  test('needs_plan defers (upload would be refused with plan_required)', () => {
    expect(welcomeFileAtSignup('needs_plan')).toBe('defer')
  })
  test('ok (gate off / older server / grandfathered) uploads right away', () => {
    expect(welcomeFileAtSignup('ok')).toBe('upload')
  })
  test('lapsed can never happen at signup but must not try an upload', () => {
    expect(welcomeFileAtSignup('lapsed')).toBe('defer')
  })
})

describe('ensureDeferredWelcomeFile — once, only when pending', () => {
  test('pending → uploads once and marks done', async () => {
    __resetWelcomeFileForTests()
    const prefs = fakePrefs('pending')
    let uploads = 0
    const did = await ensureDeferredWelcomeFile('u1', {
      getPref: prefs.get,
      setPref: prefs.set,
      upload: async () => { uploads += 1 },
    })
    expect(did).toBe(true)
    expect(uploads).toBe(1)
    expect(prefs.current()).toBe('done')
  })

  test('not pending (null = never deferred, or already done) → no upload, no write', async () => {
    for (const v of [null, 'done', undefined, 'garbage']) {
      __resetWelcomeFileForTests()
      const prefs = fakePrefs(v)
      let uploads = 0
      const did = await ensureDeferredWelcomeFile('u2', {
        getPref: prefs.get,
        setPref: prefs.set,
        upload: async () => { uploads += 1 },
      })
      expect(did).toBe(false)
      expect(uploads).toBe(0)
      expect(prefs.writes).toEqual([])
    }
  })

  test('a "not pending" answer is remembered for the session (the gate runs on every page)', async () => {
    __resetWelcomeFileForTests()
    let reads = 0
    const deps = {
      getPref: async () => { reads += 1; return null },
      setPref: async () => {},
      upload: async () => {},
    }
    await ensureDeferredWelcomeFile('u5', deps)
    await ensureDeferredWelcomeFile('u5', deps)
    await ensureDeferredWelcomeFile('u5', deps)
    expect(reads).toBe(1)
  })

  test('concurrent callers for the same user share ONE upload (success path + route gate)', async () => {
    __resetWelcomeFileForTests()
    const prefs = fakePrefs('pending')
    let uploads = 0
    const deps = {
      getPref: prefs.get,
      setPref: prefs.set,
      upload: async () => {
        uploads += 1
        await new Promise((r) => setTimeout(r, 20))
      },
    }
    const [a, b] = await Promise.all([
      ensureDeferredWelcomeFile('u3', deps),
      ensureDeferredWelcomeFile('u3', deps),
    ])
    expect(uploads).toBe(1)
    expect([a, b]).toEqual([true, true])
    // A later call in the same session does not even read the preference again.
    expect(await ensureDeferredWelcomeFile('u3', deps)).toBe(true)
    expect(uploads).toBe(1)
  })

  test('a failed upload stays pending so a later visit retries', async () => {
    __resetWelcomeFileForTests()
    const prefs = fakePrefs('pending')
    let attempts = 0
    const deps = {
      getPref: prefs.get,
      setPref: prefs.set,
      upload: async () => {
        attempts += 1
        if (attempts === 1) throw new Error('network')
      },
    }
    expect(await ensureDeferredWelcomeFile('u4', deps)).toBe(false)
    expect(prefs.current()).toBe('pending')
    expect(await ensureDeferredWelcomeFile('u4', deps)).toBe(true)
    expect(attempts).toBe(2)
    expect(prefs.current()).toBe('done')
  })
})
