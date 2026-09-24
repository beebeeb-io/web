/**
 * Client error reporter — speaks the Sentry envelope protocol directly to our
 * own GlitchTip in Falkenstein (deploy/glitchtip/). No SDK: an SDK's value is
 * its auto-instrumentation (breadcrumbs, console capture, fetch bodies, URLs),
 * and every one of those is a channel through which a zero-knowledge client
 * would leak file names and share links — the exact objection recorded in
 * docs/visionary/010-mobile-critical-path.md:443.
 *
 * Opt-in, default off. Consent is read on EVERY send, so revoking is immediate.
 * No `@sentry/*` dependency at all — this file IS the client. `send_default_pii`
 * has no equivalent flag here because there is no PII collection to disable:
 * `user`/`breadcrumbs` are simply never populated on the event we construct.
 */
import { scrubFrames, scrubText } from './scrub'

const CONSENT_KEY = 'bb_error_reports'
const INSTALL_KEY = 'bb_error_install'
const MAX_EVENTS_PER_SESSION = 20
const MIN_INTERVAL_MS = 5_000
const TIMEOUT_MS = 8_000

export interface TelemetryInit {
  dsn: string
  client: 'web' | 'admin'
  release: string
  environment: string
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
  fetchImpl?: typeof fetch
  now?: () => number
}

interface State extends Required<Omit<TelemetryInit, 'storage'>> {
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
  endpoint: string
  key: string
  seen: Set<string>
  sent: number
  lastSentAt: number
}

let state: State | null = null

/**
 * Consent (opt-in flag + install id) lives in its own storage reference,
 * independent of `state`/the transport half. This is set on every
 * `initTelemetry` call regardless of whether the DSN is present or valid —
 * so a user's choice stays readable and revocable even while telemetry is
 * currently wired to no DSN (or a broken one). Without this split, removing
 * or breaking the DSN would silently strand a previously-set "on" flag in
 * storage where the user can no longer see or clear it, ready to resume
 * reporting the moment a valid DSN comes back (Codex review, web PR #63,
 * task 1369).
 */
let consentStorage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null = null

/** `https://<key>@errors.beebeeb.io/<project>` → endpoint + public key. */
function parseDsn(dsn: string): { endpoint: string; key: string } {
  const u = new URL(dsn)
  const project = u.pathname.replace(/^\//, '')
  return { endpoint: `${u.protocol}//${u.host}/api/${project}/envelope/`, key: u.username }
}

function randomHex(bytes: number): string {
  const a = new Uint8Array(bytes)
  globalThis.crypto.getRandomValues(a)
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Wires the reporter to a project DSN. A no-op DSN (empty string) or a
 * missing call to `initTelemetry` at all leaves `state` null, and
 * `reportError` below is then a guaranteed no-op — this is how the reporter
 * stays inert everywhere `errors.beebeeb.io` has no DNS record yet: nothing
 * calls `initTelemetry` with a real DSN until that's true, and no DSN is
 * committed as a fallback default anywhere in this file.
 */
export function initTelemetry(opts: TelemetryInit): void {
  // Consent storage is wired up unconditionally, BEFORE anything that could
  // throw — a user's opt-in/out choice must stay visible and revocable no
  // matter what happens to DSN parsing below.
  try {
    consentStorage = opts.storage ?? globalThis.localStorage ?? null
  } catch {
    consentStorage = null
  }

  state = null
  if (!opts.dsn) return

  try {
    const { endpoint, key } = parseDsn(opts.dsn)
    state = {
      dsn: opts.dsn,
      client: opts.client,
      release: opts.release,
      environment: opts.environment,
      storage: opts.storage ?? globalThis.localStorage,
      fetchImpl: opts.fetchImpl ?? globalThis.fetch.bind(globalThis),
      now: opts.now ?? (() => Date.now()),
      endpoint,
      key,
      seen: new Set(),
      sent: 0,
      lastSentAt: -Infinity,
    }
  } catch {
    // A malformed DSN (typo, bad copy-paste) must never throw out of here —
    // this runs at module-boot time in main.tsx, before createRoot(). Stay
    // fully inert instead of blanking the app (Codex review, web PR #63).
    state = null
  }
}

export function getTelemetryConsent(): boolean {
  try {
    return consentStorage?.getItem(CONSENT_KEY) === 'on'
  } catch {
    return false
  }
}

export function setTelemetryConsent(on: boolean): void {
  if (!consentStorage) return
  try {
    if (on) {
      consentStorage.setItem(CONSENT_KEY, 'on')
      if (!consentStorage.getItem(INSTALL_KEY)) consentStorage.setItem(INSTALL_KEY, randomHex(16))
    } else {
      consentStorage.removeItem(CONSENT_KEY)
      consentStorage.removeItem(INSTALL_KEY)
    }
  } catch { /* storage unavailable — stay off */ }
}

function installId(): string {
  try {
    return consentStorage?.getItem(INSTALL_KEY) ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

/**
 * Report an error to our own GlitchTip. Never throws — telemetry must never
 * be able to break the app it's trying to observe. Silently does nothing
 * when: telemetry was never initialized (no DSN configured, e.g. before
 * errors.beebeeb.io has DNS), consent is off (the default), the same
 * fingerprint was already sent this session, the per-session cap is hit, or
 * the minimum interval since the last send hasn't elapsed.
 */
export function reportError(err: unknown, extra?: Record<string, string | number | boolean>): void {
  try {
    const s = state
    if (!s || !getTelemetryConsent()) return

    const error = err instanceof Error ? err : new Error(String(err))
    const type = error.name || 'Error'
    const value = scrubText(error.message)
    const frames = scrubFrames(error.stack)

    const fingerprint = `${type}|${value}|${frames[0]?.filename ?? ''}:${frames[0]?.lineno ?? 0}`
    if (s.seen.has(fingerprint)) return
    if (s.sent >= MAX_EVENTS_PER_SESSION) return
    const now = s.now()
    if (now - s.lastSentAt < MIN_INTERVAL_MS) return
    s.seen.add(fingerprint)
    s.sent += 1
    s.lastSentAt = now

    const eventId = randomHex(16)
    const scrubbedExtra: Record<string, string> = {}
    for (const [k, v] of Object.entries(extra ?? {})) scrubbedExtra[k] = scrubText(String(v))

    // No `user`, no `breadcrumbs` — this event has no PII fields to strip
    // because none are ever populated (the SDK-free equivalent of
    // `send_default_pii: false`).
    const event = {
      event_id: eventId,
      timestamp: Math.floor(now / 1000),
      platform: 'javascript',
      level: 'error',
      release: s.release,
      environment: s.environment,
      tags: { client: s.client, install: installId() },
      extra: scrubbedExtra,
      exception: { values: [{ type, value, stacktrace: { frames: frames.reverse() } }] },
    }
    const body =
      `${JSON.stringify({ event_id: eventId, sent_at: new Date(now).toISOString() })}\n` +
      `${JSON.stringify({ type: 'event' })}\n` +
      `${JSON.stringify(event)}\n`

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    void s
      .fetchImpl(s.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-sentry-envelope',
          'X-Sentry-Auth': `Sentry sentry_version=7, sentry_key=${s.key}, sentry_client=beebeeb-reporter/1.0`,
        },
        body,
        keepalive: true,
        signal: controller.signal,
      })
      .catch(() => undefined)
      .finally(() => clearTimeout(timer))
  } catch {
    /* telemetry must never be able to break the app */
  }
}

export function __resetTelemetryForTests(): void {
  state = null
  consentStorage = null
}
