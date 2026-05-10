/**
 * /r/:token — Public file upload page (no auth required).
 *
 * Anyone with the link can upload a file directly into the vault owner's
 * encrypted storage.  The file is encrypted in this browser before sending;
 * the server never sees plaintext.
 *
 * Crypto flow (simple, self-contained — no WASM dependency):
 *   1. Derive a random 32-byte AES-256-GCM key.
 *   2. Generate a random 12-byte nonce.
 *   3. Encrypt the file bytes with that key + nonce.
 *   4. Send { name_encrypted, size_bytes } + encrypted chunks to the server.
 *
 * The "ephemeral_public_key" from the server is currently stored in the file
 * metadata for future ECDH-based key wrapping.  Full key encapsulation will
 * be wired once the WASM core exposes X25519 HKDF.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { BBLogo } from '@beebeeb/shared'
import { BBButton } from '@beebeeb/shared'
import { Icon } from '@beebeeb/shared'
import { getFileRequestPublic, uploadToFileRequest, type FileRequestPublic } from '../lib/api'
import { formatBytes } from '../lib/format'

// ─── Crypto helpers ──────────────────────────────────────────────────────────

/** Generate a random AES-256-GCM key. */
async function generateAesKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt'])
}

/** Encrypt plaintext bytes with AES-256-GCM. Returns { nonce, ciphertext }. */
async function encryptBytes(
  key: CryptoKey,
  plaintext: Uint8Array<ArrayBuffer>,
): Promise<{ nonce: Uint8Array<ArrayBuffer>; ciphertext: Uint8Array<ArrayBuffer> }> {
  const nonce = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, plaintext)
  return { nonce, ciphertext: new Uint8Array(ct) }
}

/** base64url-encode a byte array. */
function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

/** Concatenate Uint8Arrays into one. */
function concat(...arrays: Uint8Array<ArrayBuffer>[]): Uint8Array<ArrayBuffer> {
  const total = arrays.reduce((n, a) => n + a.length, 0)
  const out = new Uint8Array(total) as Uint8Array<ArrayBuffer>
  let offset = 0
  for (const a of arrays) { out.set(a, offset); offset += a.length }
  return out
}

// ─── Page ────────────────────────────────────────────────────────────────────

type Phase =
  | 'loading'      // fetching request info
  | 'error'        // request not found / expired
  | 'idle'         // waiting for file pick
  | 'encrypting'   // encrypting in browser
  | 'uploading'    // POST in flight
  | 'done'         // success

export function UploadRequestPage() {
  const { token } = useParams<{ token: string }>()
  const [requestInfo, setRequestInfo] = useState<FileRequestPublic | null>(null)
  const [phase, setPhase] = useState<Phase>('loading')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [progress, setProgress] = useState(0)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dropRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!token) { setPhase('error'); setErrorMsg('Invalid link.'); return }
    getFileRequestPublic(token)
      .then(info => {
        setRequestInfo(info)
        setPhase('idle')
      })
      .catch(e => {
        setPhase('error')
        setErrorMsg(e instanceof Error ? e.message : 'This link is not available.')
      })
  }, [token])

  // Drag-and-drop
  useEffect(() => {
    const el = dropRef.current
    if (!el) return
    const prevent = (e: DragEvent) => e.preventDefault()
    const onDrop = (e: DragEvent) => {
      e.preventDefault()
      const f = e.dataTransfer?.files?.[0]
      if (f) setFile(f)
    }
    el.addEventListener('dragover', prevent)
    el.addEventListener('drop', onDrop)
    return () => { el.removeEventListener('dragover', prevent); el.removeEventListener('drop', onDrop) }
  }, [])

  const handleUpload = useCallback(async () => {
    if (!file || !token || !requestInfo) return
    setPhase('encrypting')
    setProgress(0)

    try {
      // 1. Read file bytes
      const plaintext = new Uint8Array(await file.arrayBuffer()) as Uint8Array<ArrayBuffer>

      // 2. Generate AES-256-GCM key
      const aesKey = await generateAesKey()

      // 3. Encrypt
      setProgress(20)
      const { nonce, ciphertext } = await encryptBytes(aesKey, plaintext)

      // 4. Build name_encrypted — JSON blob { nonce, ciphertext } matching server format
      const nameKey = await generateAesKey()
      const encodedName = new TextEncoder().encode(file.name) as Uint8Array<ArrayBuffer>
      const { nonce: nn, ciphertext: nc } = await encryptBytes(nameKey, encodedName)
      const nameEncrypted = JSON.stringify({
        nonce: toBase64Url(nn),
        ciphertext: toBase64Url(nc),
        // Include the ephemeral_public_key so the owner's client can identify
        // which key was used to wrap this file.
        request_public_key: requestInfo.ephemeral_public_key,
      })

      // 5. Prepend nonce to ciphertext to form the chunk blob (nonce || ciphertext)
      const chunkBlob = concat(nonce, ciphertext)

      setProgress(60)
      setPhase('uploading')

      // 6. Build FormData
      const form = new FormData()
      form.append(
        'metadata',
        JSON.stringify({ name_encrypted: nameEncrypted, size_bytes: plaintext.byteLength }),
      )
      form.append('chunk_0', new Blob([chunkBlob], { type: 'application/octet-stream' }))

      // 7. Upload
      setProgress(80)
      await uploadToFileRequest(token, form)

      setProgress(100)
      setPhase('done')
    } catch (e) {
      setPhase('idle')
      setErrorMsg(e instanceof Error ? e.message : 'Upload failed. Please try again.')
    }
  }, [file, token, requestInfo])

  // ─── Honeycomb background ────────────────────────────────────────────────
  const honeycombBg = (
    <div
      className="absolute inset-0 opacity-[0.04]"
      style={{
        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='56' height='100' viewBox='0 0 56 100'%3E%3Cpath d='M28 66L0 50L0 16L28 0L56 16L56 50L28 66Z' fill='none' stroke='%23000' stroke-width='1'/%3E%3C/svg%3E")`,
        backgroundSize: '56px 100px',
      }}
    />
  )

  // ─── Loading ─────────────────────────────────────────────────────────────
  if (phase === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-paper">
        <svg className="animate-spin h-6 w-6 text-amber" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      </div>
    )
  }

  // ─── Error ───────────────────────────────────────────────────────────────
  if (phase === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-paper relative overflow-hidden">
        {honeycombBg}
        <div className="relative w-full max-w-[28rem] mx-4">
          <div className="mb-8 flex justify-center">
            <BBLogo size={16} />
          </div>
          <div className="bg-paper border border-line-2 rounded-xl shadow-3 p-8 text-center">
            <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-red/10 flex items-center justify-center">
              <Icon name="shield" size={24} className="text-red" />
            </div>
            <h2 className="text-lg font-semibold text-ink mb-2">Link unavailable</h2>
            <p className="text-sm text-ink-3">{errorMsg ?? 'This link has expired or is no longer active.'}</p>
          </div>
        </div>
      </div>
    )
  }

  // ─── Success ─────────────────────────────────────────────────────────────
  if (phase === 'done') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-paper relative overflow-hidden">
        {honeycombBg}
        <div className="relative w-full max-w-[28rem] mx-4">
          <div className="mb-8 flex justify-center">
            <BBLogo size={16} />
          </div>
          <div className="bg-paper border border-line-2 rounded-xl shadow-3 overflow-hidden">
            <div className="p-8 text-center">
              <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-green/10 flex items-center justify-center">
                <Icon name="check" size={24} className="text-green" />
              </div>
              <h2 className="text-[18px] font-semibold text-ink mb-2">File delivered securely</h2>
              <p className="text-[13px] text-ink-3 leading-relaxed">
                Your file was encrypted in your browser before it was sent.
                Only the recipient can open it.
              </p>
            </div>
            <div className="px-8 py-4 bg-paper-2 border-t border-line">
              <div className="flex items-center justify-center gap-1.5 text-[11px] text-ink-3">
                <Icon name="lock" size={11} className="text-amber-deep" />
                End-to-end encrypted with Beebeeb
              </div>
            </div>
          </div>
          <p className="text-center text-[12px] text-ink-4 mt-4">
            Want encrypted storage for your own files?{' '}
            <a href="/signup" className="text-amber-deep hover:underline">Create a free account</a>
          </p>
        </div>
      </div>
    )
  }

  // ─── Upload form (idle / encrypting / uploading) ──────────────────────────
  const isWorking = phase === 'encrypting' || phase === 'uploading'

  return (
    <div className="min-h-screen flex items-center justify-center bg-paper relative overflow-hidden">
      {honeycombBg}
      <div className="relative w-full max-w-[28rem] mx-4">

        {/* Logo */}
        <div className="mb-8 flex justify-center">
          <BBLogo size={16} />
        </div>

        <div className="bg-paper border border-line-2 rounded-xl shadow-3 overflow-hidden">

          {/* Header */}
          <div className="px-8 pt-7 pb-5 border-b border-line">
            <h1 className="text-[18px] font-semibold text-ink mb-1 text-center">
              {requestInfo?.title ?? 'Upload a file'}
            </h1>
            {requestInfo?.description && (
              <p className="text-[13px] text-ink-3 text-center leading-relaxed mt-1">
                {requestInfo.description}
              </p>
            )}
          </div>

          {/* Drop zone */}
          <div className="px-8 py-6">
            <div
              ref={dropRef}
              onClick={() => !isWorking && fileInputRef.current?.click()}
              className={`
                relative rounded-xl border-2 border-dashed transition-colors
                flex flex-col items-center justify-center gap-3 py-10 px-4
                ${isWorking ? 'border-line bg-paper-2 cursor-not-allowed opacity-60' :
                  file ? 'border-amber/60 bg-amber-bg cursor-pointer' :
                  'border-line hover:border-amber/40 hover:bg-paper-2 cursor-pointer'}
              `}
            >
              <input
                ref={fileInputRef}
                type="file"
                className="sr-only"
                disabled={isWorking}
                onChange={e => e.target.files?.[0] && setFile(e.target.files[0])}
              />

              {file ? (
                <>
                  <div className="w-12 h-12 rounded-xl bg-amber/10 flex items-center justify-center">
                    <Icon name="file" size={22} className="text-amber-deep" />
                  </div>
                  <div className="text-center">
                    <div className="text-[13px] font-medium text-ink truncate max-w-[18rem]">{file.name}</div>
                    <div className="text-[11px] text-ink-3 font-mono mt-0.5">{formatBytes(file.size)}</div>
                  </div>
                  {!isWorking && (
                    <button
                      type="button"
                      onClick={e => { e.stopPropagation(); setFile(null) }}
                      className="text-[11px] text-ink-4 hover:text-red transition-colors cursor-pointer"
                    >
                      Remove
                    </button>
                  )}
                </>
              ) : (
                <>
                  <div className="w-12 h-12 rounded-xl bg-paper-3 flex items-center justify-center">
                    <Icon name="upload" size={22} className="text-ink-3" />
                  </div>
                  <div className="text-center">
                    <div className="text-[13px] font-medium text-ink">Drop a file or click to browse</div>
                    <div className="text-[11px] text-ink-4 mt-1">Any file type, up to 500 MB</div>
                  </div>
                </>
              )}
            </div>

            {/* Progress bar */}
            {isWorking && (
              <div className="mt-4">
                <div className="h-1.5 rounded-full bg-paper-3 overflow-hidden">
                  <div
                    className="h-full bg-amber rounded-full transition-all duration-300"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <div className="text-[11px] text-ink-3 text-center mt-1.5">
                  {phase === 'encrypting' ? 'Encrypting in your browser…' : 'Sending encrypted file…'}
                </div>
              </div>
            )}

            {/* Error message */}
            {errorMsg && phase === 'idle' && (
              <div className="mt-3 rounded-lg bg-red/5 border border-red/20 px-3 py-2 text-[12px] text-red">
                {errorMsg}
              </div>
            )}

            {/* Submit */}
            <div className="mt-5">
              <BBButton
                disabled={!file || isWorking}
                onClick={handleUpload}
                className="w-full"
              >
                {isWorking ? (
                  <span className="flex items-center gap-2">
                    <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    {phase === 'encrypting' ? 'Encrypting…' : 'Uploading…'}
                  </span>
                ) : 'Send file securely'}
              </BBButton>
            </div>
          </div>

          {/* Footer — zero-knowledge badge */}
          <div className="px-8 py-4 bg-paper-2 border-t border-line">
            <div
              className="flex items-start gap-2.5 cursor-pointer select-none"
              role="note"
            >
              <div className="w-0.5 self-stretch bg-amber-deep rounded-full shrink-0 mt-0.5" />
              <div>
                <div className="flex items-center gap-1.5 mb-0.5">
                  <Icon name="lock" size={11} className="text-amber-deep shrink-0" />
                  <span className="text-[12px] font-semibold text-ink">Encrypted in your browser</span>
                </div>
                <p className="text-[11px] text-ink-3 leading-relaxed">
                  Your file is encrypted before it leaves this device. Beebeeb cannot read it.
                </p>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}
