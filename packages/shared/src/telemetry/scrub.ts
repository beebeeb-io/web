/**
 * Telemetry scrubbing — the load-bearing privacy guardrail promised in
 * deploy/glitchtip/README.md and required by docs/visionary/010:443.
 *
 * Everything that leaves a device passes through here exactly once, at event
 * construction — one chokepoint, not per call site (the same decision
 * repos/server/beebeeb-api/src/error_capture.rs:39 made for the server).
 *
 * Order matters: specific shapes (session tokens, UUIDs, emails, URLs) are
 * replaced before the broad hex/base64 sweeps, which would otherwise eat them
 * and lose the diagnostic signal that a token WAS present.
 */

const MAX_LEN = 200

const FILE_EXTENSIONS =
  'jpe?g|png|heic|gif|webp|mp4|mov|m4v|pdf|docx?|xlsx?|pptx?|txt|md|csv|zip|key|pages|numbers'

const URL_QUERY_OR_FRAGMENT = /((?:https?:\/\/|\/)[^\s"'`]*?)[?#][^\s"'`]*/g
const SESSION_TOKEN = /bb_sess_[A-Za-z0-9_-]+/g
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi
const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g
const LONG_HEX = /\b[0-9a-f]{32,}\b/gi
/**
 * A QUOTED file name, possibly multi-word (a real folder/file name almost
 * always contains spaces): the whole quoted phrase is the user's — only the
 * extension is diagnostic. Runs BEFORE both QUOTED_LONG and the generic
 * FILE_NAME below, so `"Holiday photos 2026 Corfu.jpeg"` becomes
 * `"<name>.jpeg"` in one step rather than only redacting the last,
 * unquoted-looking word before the extension.
 */
const QUOTED_FILE_NAME = new RegExp(`(["'\`])([^"'\`]{1,200})\\.(${FILE_EXTENSIONS})\\1`, 'gi')
const QUOTED_LONG = /(["'`])([^"'`]{41,})\1/g
/** An UNQUOTED path segment that looks like a user's file: keep the extension, drop the stem. */
const FILE_NAME = new RegExp(`([^\\s/\\\\"'\`]{1,200})\\.(${FILE_EXTENSIONS})\\b`, 'gi')
/** Any remaining opaque run — share keys, base64url blobs. Runs last. */
const LONG_OPAQUE = /\b[A-Za-z0-9_-]{20,}\b/g

/** Identifiers that are ours, not the user's — never redacted. */
const ALLOWED_LONG_TOKENS = new Set([
  'CryptoError',
  'uploadEncryptedFileNative',
  'downloadAndDecryptFileNative',
  'unhandledrejection',
  'componentDidCatch',
])

export function scrubText(input: string): string {
  if (!input) return ''
  let s = String(input)
  try {
    s = s.replace(URL_QUERY_OR_FRAGMENT, '$1')
    s = s.replace(SESSION_TOKEN, '<session>')
    s = s.replace(EMAIL, '<email>')
    s = s.replace(UUID, '<id>')
    s = s.replace(QUOTED_FILE_NAME, (_m, quote: string, _stem: string, ext: string) => `${quote}<name>.${ext}${quote}`)
    s = s.replace(QUOTED_LONG, (_m, _quote, body: string) => `<str:${body.length}>`)
    s = s.replace(FILE_NAME, '<name>.$2')
    s = s.replace(LONG_HEX, '<hex>')
    s = s.replace(LONG_OPAQUE, (m) => (ALLOWED_LONG_TOKENS.has(m) ? m : '<token>'))
  } catch {
    return '<unscrubbable>'
  }
  return s.length > MAX_LEN ? `${s.slice(0, MAX_LEN)}…` : s
}

export interface Frame {
  filename: string
  function: string
  lineno: number
  colno: number
}

const FRAME_RE = /^\s*at\s+(?:async\s+)?([^\s(]+)?\s*\(?([^\s()]+?):(\d+):(\d+)\)?\s*$/

/**
 * Rebuild frames from a stack string, keeping ONLY basename + function +
 * position. abs_path, context lines and locals are never forwarded: an
 * absolute path leaks a username, a context line leaks source we did not scrub.
 */
export function scrubFrames(stack: string | undefined): Frame[] {
  if (!stack) return []
  const frames: Frame[] = []
  for (const line of stack.split('\n')) {
    const m = FRAME_RE.exec(line)
    if (!m) continue
    const [, fn, file, lineno, colno] = m
    const basename = file.split(/[/\\]/).pop() ?? '<anon>'
    frames.push({
      filename: scrubText(basename),
      function: fn ? scrubText(fn) : '<anonymous>',
      lineno: Number(lineno),
      colno: Number(colno),
    })
    if (frames.length >= 30) break
  }
  return frames
}
