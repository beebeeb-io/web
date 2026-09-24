import { beforeEach, describe, expect, it } from 'bun:test'
import {
  initTelemetry, reportError, getTelemetryConsent, setTelemetryConsent, __resetTelemetryForTests,
  isTelemetryConfigured,
} from './reporter'

function memStorage() {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    _map: m,
  }
}

function setup(now = () => 0) {
  const calls: { url: string; body: string }[] = []
  const storage = memStorage()
  initTelemetry({
    dsn: 'https://pub1234567890@errors.beebeeb.io/1',
    client: 'web',
    release: 'web@1.0.0',
    environment: 'test',
    storage,
    now,
    fetchImpl: (async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), body: String(init.body) })
      return new Response('', { status: 200 })
    }) as unknown as typeof fetch,
  })
  return { calls, storage }
}

beforeEach(() => __resetTelemetryForTests())

describe('consent', () => {
  it('sends nothing while consent is off (the default)', async () => {
    const { calls } = setup()
    expect(getTelemetryConsent()).toBe(false)
    reportError(new Error('boom'))
    await Bun.sleep(1)
    expect(calls).toHaveLength(0)
  })

  it('sends once consent is on, and stops again when revoked', async () => {
    const { calls } = setup()
    setTelemetryConsent(true)
    reportError(new Error('boom'))
    await Bun.sleep(1)
    expect(calls).toHaveLength(1)
    setTelemetryConsent(false)
    reportError(new Error('different'))
    await Bun.sleep(1)
    expect(calls).toHaveLength(1)
  })

  it('drops the install id on opt-out', () => {
    const { storage } = setup()
    setTelemetryConsent(true)
    expect(storage.getItem('bb_error_install')).toMatch(/^[0-9a-f]{32}$/)
    setTelemetryConsent(false)
    expect(storage.getItem('bb_error_install')).toBeNull()
  })
})

describe('envelope', () => {
  it('posts a 3-line envelope to the DSN project with the auth header', async () => {
    const { calls } = setup()
    setTelemetryConsent(true)
    reportError(new Error('boom'))
    await Bun.sleep(1)
    expect(calls[0].url).toBe('https://errors.beebeeb.io/api/1/envelope/')
    const lines = calls[0].body.trim().split('\n')
    expect(lines).toHaveLength(3)
    expect(JSON.parse(lines[1])).toEqual({ type: 'event' })
    const event = JSON.parse(lines[2])
    expect(event.exception.values[0].type).toBe('Error')
    expect(event.tags.client).toBe('web')
    expect(event.tags.install).toMatch(/^[0-9a-f]{32}$/)
    expect(event.user).toBeUndefined()
    expect(event.breadcrumbs).toBeUndefined()
  })

  it('scrubs the message and the frames', async () => {
    const { calls } = setup()
    setTelemetryConsent(true)
    const err = new Error('cannot decrypt "Holiday photos 2026.jpeg" for bb_sess_9xKq2mZr8vTn4pLd0eWc')
    err.stack = 'Error: x\n    at go (/Users/guuslangelaar/app/src/lib/api.ts:10:1)'
    reportError(err)
    await Bun.sleep(1)
    const body = calls[0].body
    expect(body).not.toContain('Holiday')
    expect(body).not.toContain('9xKq2mZr8vTn4pLd0eWc')
    expect(body).not.toContain('guuslangelaar')
    expect(body).toContain('api.ts')
  })

  it('never lets a plaintext file name shown in the view reach the captured payload', async () => {
    // Adversarial: the exact file-name string a user would see in the UI.
    // This is the zero-knowledge guarantee for telemetry — the transport is
    // mocked, but nothing else about the reporter is; if this test passes by
    // accident (e.g. because the mock never actually gets called), the other
    // assertions on `calls` below would also fail, since they read from the
    // same captured array.
    const { calls } = setup()
    setTelemetryConsent(true)
    const plaintextName = 'Holiday photos 2026 Corfu.jpeg'
    const err = new Error(`Failed to decrypt "${plaintextName}"`)
    reportError(err)
    await Bun.sleep(1)
    expect(calls).toHaveLength(1)
    const body = calls[0].body
    expect(body).not.toContain(plaintextName)
    expect(body).not.toContain('Holiday')
    expect(body).not.toContain('Corfu')
    expect(body).toContain('<name>.jpeg')
  })
})

describe('volume control', () => {
  it('dedupes an identical error within a session', async () => {
    const { calls } = setup()
    setTelemetryConsent(true)
    reportError(new Error('same'))
    await Bun.sleep(1)
    reportError(new Error('same'))
    await Bun.sleep(1)
    expect(calls).toHaveLength(1)
  })

  it('caps at 20 events per session', async () => {
    let t = 0
    const { calls } = setup(() => (t += 10_000))
    setTelemetryConsent(true)
    for (let i = 0; i < 30; i++) { reportError(new Error(`e${i}`)); await Bun.sleep(1) }
    expect(calls).toHaveLength(20)
  })

  it('never throws when the transport fails', async () => {
    __resetTelemetryForTests()
    initTelemetry({
      dsn: 'https://pub1234567890@errors.beebeeb.io/1',
      client: 'web', release: 'web@1.0.0', environment: 'test',
      storage: memStorage(),
      fetchImpl: (async () => { throw new Error('offline') }) as unknown as typeof fetch,
    })
    setTelemetryConsent(true)
    expect(() => reportError(new Error('boom'))).not.toThrow()
    await Bun.sleep(1)
  })
})

// Codex review findings on web PR #63 (2026-09-24), both confirmed against the
// code before being fixed:
describe('malformed / absent configuration (Codex P1 + P2)', () => {
  it('P1: a malformed DSN never throws out of initTelemetry — it must stay inert, not blank the app', () => {
    __resetTelemetryForTests()
    // initTelemetry() runs at module-boot time in main.tsx, before createRoot().
    // A synchronous throw here previously meant ANY invalid VITE_ERROR_REPORTING_DSN
    // value (a typo, a copy-paste mistake) would blank the entire app for every user —
    // exactly the "never a white screen" failure mode this codebase forbids elsewhere
    // (WasmGuard's own rule). Telemetry must degrade to "off", never take the app down.
    expect(() => initTelemetry({
      dsn: 'not-a-valid-dsn',
      client: 'web',
      release: 'web@1.0.0',
      environment: 'test',
      storage: memStorage(),
    })).not.toThrow()
    expect(getTelemetryConsent()).toBe(false)
    expect(() => reportError(new Error('boom'))).not.toThrow()
  })

  it('P2: consent stays readable and revocable even when there is no valid DSN configured', async () => {
    const storage = memStorage()
    // Consent is granted while a real DSN is configured...
    initTelemetry({
      dsn: 'https://pub1234567890@errors.beebeeb.io/1',
      client: 'web', release: 'web@1.0.0', environment: 'test', storage,
    })
    setTelemetryConsent(true)
    expect(getTelemetryConsent()).toBe(true)

    // ...then the DSN is removed (e.g. ops temporarily unsets
    // VITE_ERROR_REPORTING_DSN) and the app re-inits with the SAME storage.
    // Without this fix, getTelemetryConsent() would silently read as `false`
    // (state === null), the settings toggle would render "off" even though the
    // user never revoked anything, and clicking it to actually turn it off
    // would be a no-op — leaving the stale `on` flag in storage to silently
    // resume reporting the moment a DSN comes back, with no chance for the
    // user to have turned it off in between.
    initTelemetry({ dsn: '', client: 'web', release: 'web@1.0.0', environment: 'test', storage })
    expect(getTelemetryConsent()).toBe(true)
    setTelemetryConsent(false)
    expect(getTelemetryConsent()).toBe(false)
    expect(storage.getItem('bb_error_install')).toBeNull()

    // And reportError still can't send anything without a valid DSN, consent
    // notwithstanding — no transport, no event.
    setTelemetryConsent(true)
    reportError(new Error('boom'))
    await Bun.sleep(1)
  })
})

// Task 1369b: the settings "Error reports" card must only render while
// telemetry is actually wired to a real DSN — otherwise it offers an opt-in
// that silently sends nothing (errors.beebeeb.io has no DNS record yet).
// `isTelemetryConfigured()` is the single source of truth the UI gates on.
describe('isTelemetryConfigured', () => {
  it('is false before initTelemetry has ever been called', () => {
    __resetTelemetryForTests()
    expect(isTelemetryConfigured()).toBe(false)
  })

  it('is false with an empty DSN (the shipped no-DNS-yet state)', () => {
    __resetTelemetryForTests()
    initTelemetry({ dsn: '', client: 'web', release: 'web@1.0.0', environment: 'test', storage: memStorage() })
    expect(isTelemetryConfigured()).toBe(false)
  })

  it('is false with a malformed DSN that fails to parse', () => {
    __resetTelemetryForTests()
    initTelemetry({
      dsn: 'not-a-valid-dsn', client: 'web', release: 'web@1.0.0', environment: 'test',
      storage: memStorage(),
    })
    expect(isTelemetryConfigured()).toBe(false)
  })

  it('is true once initTelemetry succeeds with a valid DSN', () => {
    __resetTelemetryForTests()
    initTelemetry({
      dsn: 'https://pub1234567890@errors.beebeeb.io/1', client: 'web', release: 'web@1.0.0',
      environment: 'test', storage: memStorage(),
    })
    expect(isTelemetryConfigured()).toBe(true)
  })

  it('flips back to false if telemetry is re-initialized with no DSN', () => {
    __resetTelemetryForTests()
    const storage = memStorage()
    initTelemetry({
      dsn: 'https://pub1234567890@errors.beebeeb.io/1', client: 'web', release: 'web@1.0.0',
      environment: 'test', storage,
    })
    expect(isTelemetryConfigured()).toBe(true)
    initTelemetry({ dsn: '', client: 'web', release: 'web@1.0.0', environment: 'test', storage })
    expect(isTelemetryConfigured()).toBe(false)
  })
})
