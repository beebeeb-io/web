import { useState, useEffect } from 'react'
import { Icon } from '@beebeeb/shared'
import { fetchShareCiphertextPreview } from '../../lib/api'
import { extractShareKeyToken } from '../../lib/share-key'

// ─── Glassbox sub-components ──────────────────────────────────────────────────

/** The amber "Decrypted in your browser" banner with collapsible explanation. */
export function ZeroBanner() {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-xl border border-amber/30 bg-amber-bg overflow-hidden mb-4">
      <div className="flex items-start gap-3 px-4 py-3.5">
        {/* Amber left accent */}
        <div className="w-0.5 self-stretch bg-amber-deep rounded-full shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Icon name="lock" size={12} className="text-amber-deep shrink-0" />
            <span className="text-[13px] font-semibold text-ink">Decrypted in your browser</span>
          </div>
          <p className="text-[12px] text-ink-2 leading-relaxed">
            Beebeeb cannot read this file. The decryption key is in the URL fragment
            {' '}<span className="font-mono text-[11px] text-amber-deep">#key=…</span>{' '}
            which never reaches our servers.
          </p>
          <button
            type="button"
            onClick={() => setOpen(v => !v)}
            className="mt-2 flex items-center gap-1 text-[11.5px] text-amber-deep font-medium hover:underline underline-offset-2 cursor-pointer"
          >
            How does this work?
            <Icon
              name="chevron-down"
              size={10}
              className={`transition-transform ${open ? 'rotate-180' : ''}`}
            />
          </button>
        </div>
      </div>

      {open && (
        <div className="border-t border-amber/20 px-4 py-3 bg-amber-bg/60">
          <ol className="space-y-2.5">
            {[
              {
                n: '1',
                title: 'A random key was generated',
                body: 'When the file was shared, a random 256-bit key was created locally in the sender\'s browser. It never left their device in plaintext.',
              },
              {
                n: '2',
                title: 'The key encrypted the file',
                body: 'AES-256-GCM encrypted each chunk of the file client-side, running in WebAssembly. The server only ever received ciphertext.',
              },
              {
                n: '3',
                title: 'The key lives in the URL fragment',
                body: 'Browsers never send the #fragment to servers. When you opened this link, the key stayed local — we served you the ciphertext, your browser decrypted it.',
              },
            ].map(step => (
              <li key={step.n} className="flex items-start gap-3">
                <span className="w-5 h-5 rounded-full bg-amber-deep/20 text-amber-deep text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                  {step.n}
                </span>
                <div>
                  <div className="text-[12px] font-semibold text-ink">{step.title}</div>
                  <div className="text-[11.5px] text-ink-3 leading-relaxed mt-0.5">{step.body}</div>
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  )
}

/** Renders the URL with the #key=... fragment highlighted in amber. */
export function UrlAnnotation() {
  const fullUrl = window.location.href
  const hashIdx = fullUrl.indexOf('#')
  if (hashIdx === -1) return null

  const base = fullUrl.slice(0, hashIdx)
  const fragment = fullUrl.slice(hashIdx) // includes the '#'

  // Extract just the key value for display truncation. Uses the same
  // extractShareKeyToken() as the real decode paths (task 1531) — NOT
  // URLSearchParams, which decodes '+' as a space (form-urlencoded
  // semantics) and would show a mangled preview for a standard-base64 key
  // containing '+'. Display-only: never used to derive the actual key.
  const keyVal = extractShareKeyToken(fragment) ?? ''
  const keyDisplay =
    keyVal.length > 16
      ? `${keyVal.slice(0, 8)}…${keyVal.slice(-4)}`
      : keyVal

  const fragmentDisplay = `#key=${keyDisplay}`

  return (
    <div className="mt-4 pt-4 border-t border-line">
      <div className="text-[10.5px] font-mono text-ink-3 break-all leading-relaxed bg-paper-2 rounded-lg border border-line px-3 py-2.5">
        <span className="text-ink-4">{base}</span>
        <span
          className="text-amber-deep font-semibold"
          title={fragment}
        >
          {fragmentDisplay}
        </span>
      </div>
      <div className="flex items-center gap-1 mt-1.5 ml-[calc(1rem+1px)] text-[10.5px] text-ink-4">
        <svg width="8" height="14" viewBox="0 0 8 14" fill="none" className="shrink-0">
          <path d="M4 0v10M1 8l3 4 3-4" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        <span>this part never reaches our servers</span>
      </div>
    </div>
  )
}

/** Converts a Uint8Array to a formatted two-column hex dump string. */
function toHexDump(bytes: Uint8Array, limit = 64): string {
  const rows: string[] = []
  const capped = bytes.slice(0, limit)
  for (let i = 0; i < capped.length; i += 8) {
    const chunk = capped.slice(i, i + 8)
    rows.push(Array.from(chunk).map(b => b.toString(16).padStart(2, '0')).join(' '))
  }
  return rows.join('\n')
}

/** The "Show what the server sees" expandable panel. */
export function ServerViewPanel({
  token,
  passphrase,
  decryptedName,
  nameEncrypted,
}: {
  token: string
  passphrase?: string
  decryptedName: string | null
  nameEncrypted?: string | null
}) {
  const [open, setOpen] = useState(false)
  const [ciphertext, setCiphertext] = useState<Uint8Array | null>(null)
  const [loading, setLoading] = useState(false)
  const [fetchError, setFetchError] = useState(false)

  useEffect(() => {
    if (!open || ciphertext || loading) return
    setLoading(true)
    setFetchError(false)
    fetchShareCiphertextPreview(token, passphrase)
      .then(bytes => setCiphertext(bytes))
      .catch(() => {
        // Fallback: use name_encrypted ciphertext bytes as the demo
        if (nameEncrypted && nameEncrypted.startsWith('{')) {
          try {
            const parsed = JSON.parse(nameEncrypted)
            if (parsed.ciphertext) {
              const ct = Array.isArray(parsed.ciphertext)
                ? new Uint8Array(parsed.ciphertext)
                : new Uint8Array(atob(parsed.ciphertext).split('').map(c => c.charCodeAt(0)))
              setCiphertext(ct)
              return
            }
          } catch { /* ignore */ }
        }
        setFetchError(true)
      })
      .finally(() => setLoading(false))
  }, [open, ciphertext, loading, token, passphrase])

  const hexDump = ciphertext ? toHexDump(ciphertext, 64) : null

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 text-[11.5px] text-ink-3 hover:text-ink-2 transition-colors cursor-pointer"
      >
        <Icon
          name="chevron-down"
          size={10}
          className={`transition-transform ${open ? 'rotate-180' : ''}`}
        />
        Show what the server sees
      </button>

      {open && (
        <div className="mt-3 rounded-xl border border-line overflow-hidden">
          {/* Panel header */}
          <div className="flex items-center gap-2 px-3 py-2 bg-paper-2 border-b border-line">
            <div className="w-2.5 h-2.5 rounded-full bg-red/60" />
            <div className="w-2.5 h-2.5 rounded-full bg-amber/60" />
            <div className="w-2.5 h-2.5 rounded-full bg-green/60" />
            <span className="ml-1 text-[10px] font-mono text-ink-4">beebeeb-server · share/{token.slice(0, 8)}…</span>
          </div>

          {/* Stacked layout — always vertical for clarity on all viewports */}
          <div className="divide-y divide-line">
            {/* Server's view — raw ciphertext */}
            <div className="p-3.5">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-3 mb-2">
                What the server stored
              </div>
              {loading ? (
                <div className="flex items-center gap-2 text-[11px] text-ink-4 py-2">
                  <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Fetching ciphertext…
                </div>
              ) : fetchError ? (
                <p className="text-[11px] text-ink-4 italic">Could not fetch ciphertext preview</p>
              ) : hexDump ? (
                <>
                  <pre className="font-mono text-[10px] text-ink-3 leading-relaxed whitespace-pre overflow-x-auto bg-paper-3 rounded-md p-2 max-w-full">
                    {hexDump}
                  </pre>
                  <p className="text-[10px] text-ink-4 mt-1.5 italic">
                    AES-256-GCM ciphertext — meaningless without your key
                  </p>
                </>
              ) : null}
            </div>

            {/* Your view — decrypted */}
            <div className="p-3.5">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-3 mb-2">
                What you see
              </div>
              <div className="flex items-center gap-2 bg-paper-3 rounded-md px-3 py-2.5 min-w-0">
                <Icon name="file" size={14} className="text-ink-3 shrink-0" />
                <span className="text-[12px] font-medium text-ink truncate min-w-0">
                  {decryptedName ?? 'Decrypting…'}
                </span>
              </div>
              <p className="text-[10px] text-ink-4 mt-1.5 italic">
                Decrypted in your browser via WebAssembly
              </p>
            </div>
          </div>

          {/* Footer */}
          <div className="px-3.5 py-2.5 bg-paper-2 border-t border-line text-[11px] text-ink-3 leading-relaxed">
            The difference is <span className="font-mono text-[10.5px] text-ink-2">AES-256-GCM</span> decryption,
            running entirely in your browser. Beebeeb never holds the key.
          </div>
        </div>
      )}
    </div>
  )
}
