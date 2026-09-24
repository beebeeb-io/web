import { beforeEach, describe, expect, it } from 'bun:test'
import {
  initTelemetry, reportError, getTelemetryConsent, setTelemetryConsent, __resetTelemetryForTests,
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
