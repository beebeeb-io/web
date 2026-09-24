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
  if (!opts.dsn) {
    state = null
    return
  }
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
}

export function getTelemetryConsent(): boolean {
  try {
    return state?.storage.getItem(CONSENT_KEY) === 'on'
  } catch {
    return false
  }
}

export function setTelemetryConsent(on: boolean): void {
  if (!state) return
  try {
    if (on) {
      state.storage.setItem(CONSENT_KEY, 'on')
      if (!state.storage.getItem(INSTALL_KEY)) state.storage.setItem(INSTALL_KEY, randomHex(16))
    } else {
      state.storage.removeItem(CONSENT_KEY)
      state.storage.removeItem(INSTALL_KEY)
    }
  } catch { /* storage unavailable — stay off */ }
}

function installId(): string {
  try {
    return state?.storage.getItem(INSTALL_KEY) ?? 'unknown'
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
}
