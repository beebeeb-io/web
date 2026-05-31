/**
 * /r/:token — Public file-request uploader (no auth required).
 *
 * Anyone with the link can upload file(s) directly into the request owner's
 * encrypted vault. Everything is encrypted IN THIS BROWSER before it is sent;
 * the server only ever sees ciphertext and opaque sealed key material.
 *
 * Crypto flow (per file) — all primitives are the beebeeb-core WASM bindings,
 * none hand-rolled:
 *   1. Read R_pub (the request public key) from the URL fragment (`#…`). The
 *      fragment is never transmitted to the server, so the server cannot MITM
 *      the seal. Missing/malformed fragment → hard stop ("link incomplete").
 *   2. Generate a random 32-byte content key C.
 *   3. Encrypt the filename (+ MIME) and every chunk with C (canonical
 *      EncryptedBlob format, matching normal vault uploads).
 *   4. seal_to_request(R_pub, C) → { E_pub, wrapped_C }. A fresh ephemeral
 *      keypair is generated inside core and its private half discarded.
 *   5. POST multipart: metadata { name_encrypted, size_bytes,
 *      sender_ephemeral_pubkey: E_pub, wrapped_key: wrapped_C } + chunk_0…N.
 *   6. Discard C.
 * Only the owner — who holds R_priv (wrapped under their master key) — can
 * recover C and decrypt. Beebeeb never can.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { BBLogo, BBButton, Icon } from '@beebeeb/shared'
import {
  getFileRequestPublic,
  uploadToFileRequest,
  type FileRequestPublic,
} from '../lib/api'
import {
  initCrypto,
  planChunks,
  encryptChunk,
  encryptFilename,
  serializeEncryptedBlob,
  sealToRequest,
  toBase64,
} from '../lib/crypto'
import { formatBytes } from '../lib/format'

// ─── Helpers ──────────────────────────────────────────────────────────────

/** Decode a base64url (URL-safe, unpadded) string to bytes. */
function fromBase64url(s: string): Uint8Array {
  let b64 = s.replace(/-/g, '+').replace(/_/g, '/')
  while (b64.length % 4 !== 0) b64 += '='
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

/** Read + validate R_pub from `location.hash`. Returns null if absent/malformed. */
function readRequestPublicKey(): Uint8Array | null {
  const raw = window.location.hash.replace(/^#/, '').trim()
  if (!raw) return null
  try {
    const bytes = fromBase64url(raw)
    // X25519 public keys are exactly 32 bytes — anything else is a broken link.
    if (bytes.length !== 32) return null
    return bytes
  } catch {
    return null
  }
}

type FileStatus = 'queued' | 'encrypting' | 'uploading' | 'done' | 'error'

interface UploadItem {
  file: File
  status: FileStatus
  progress: number
  error?: string
}

type Phase =
  | 'loading' // fetching request info
  | 'incomplete' // URL is missing/malformed R_pub fragment
  | 'error' // request not found / expired / closed
  | 'idle' // waiting for file pick
  | 'working' // encrypting + uploading
  | 'done' // success

// ─── Page ────────────────────────────────────────────────────────────────

export function UploadRequestPage() {
  const { token } = useParams<{ token: string }>()
  const [requestInfo, setRequestInfo] = useState<FileRequestPublic | null>(null)
  const [phase, setPhase] = useState<Phase>('loading')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [items, setItems] = useState<UploadItem[]>([])
  const [deliveredCount, setDeliveredCount] = useState(0)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dropRef = useRef<HTMLDivElement>(null)

  // The request public key lives in the URL fragment. Read it once on mount —
  // before anything else, so a broken link fails loudly and never proceeds.
  const rPub = useMemo(() => readRequestPublicKey(), [])

  useEffect(() => {
    if (!token) {
      setPhase('error')
      setErrorMsg('This link is invalid.')
      return
    }
    if (!rPub) {
      setPhase('incomplete')
      return
    }
    // Warm up the crypto worker in parallel with the info fetch.
    void initCrypto()
    getFileRequestPublic(token)
      .then((info) => {
        setRequestInfo(info)
        setPhase('idle')
      })
      .catch((e) => {
        setPhase('error')
        setErrorMsg(e instanceof Error ? e.message : 'This link is not available.')
      })
  }, [token, rPub])

  const isFull = useMemo(() => {
    if (!requestInfo) return false
    return requestInfo.files_received >= requestInfo.max_files
  }, [requestInfo])

  const remainingFiles = useMemo(() => {
    if (!requestInfo) return 0
    return Math.max(0, requestInfo.max_files - requestInfo.files_received)
  }, [requestInfo])

  const addFiles = useCallback(
    (incoming: FileList | File[]) => {
      const list = Array.from(incoming)
      if (list.length === 0) return
      setItems((prev) => {
        const room = Math.max(0, remainingFiles - prev.length)
        const next = list.slice(0, room).map<UploadItem>((file) => ({ file, status: 'queued', progress: 0 }))
        return [...prev, ...next]
      })
    },
    [remainingFiles],
  )

  // Drag-and-drop
  useEffect(() => {
    const el = dropRef.current
    if (!el) return
    const prevent = (e: DragEvent) => e.preventDefault()
    const onDrop = (e: DragEvent) => {
      e.preventDefault()
      if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files)
    }
    el.addEventListener('dragover', prevent)
    el.addEventListener('drop', onDrop)
    return () => {
      el.removeEventListener('dragover', prevent)
      el.removeEventListener('drop', onDrop)
    }
  }, [addFiles])

  /** Encrypt + seal + upload a single file. Returns nothing; updates item state. */
  const uploadOne = useCallback(
    async (index: number, file: File): Promise<void> => {
      if (!token || !rPub) return
      const update = (patch: Partial<UploadItem>) =>
        setItems((prev) => prev.map((it, i) => (i === index ? { ...it, ...patch } : it)))

      update({ status: 'encrypting', progress: 0 })

      // 1. Fresh random content key C for this file.
      const contentKey = crypto.getRandomValues(new Uint8Array(32))

      try {
        // 2. Encrypt the filename + MIME as canonical metadata under C.
        const metadataPlain = JSON.stringify({ name: file.name, mime_type: file.type || null })
        const encName = await encryptFilename(contentKey, metadataPlain)
        const nameEncrypted = serializeEncryptedBlob(encName.nonce, encName.ciphertext)

        // 3. Plan + encrypt chunks under C (nonce ‖ ciphertext per chunk).
        let plan: { chunk_size_bytes: number; chunk_count: number }
        try {
          plan = await planChunks(file.size, 'web')
        } catch {
          const size = 4 * 1024 * 1024
          plan = { chunk_size_bytes: size, chunk_count: Math.max(1, Math.ceil(file.size / size)) }
        }

        const form = new FormData()
        for (let i = 0; i < plan.chunk_count; i++) {
          const start = i * plan.chunk_size_bytes
          const end = Math.min(start + plan.chunk_size_bytes, file.size)
          const plaintext = new Uint8Array(await file.slice(start, end).arrayBuffer())
          const enc = await encryptChunk(contentKey, plaintext)
          const blob = new Uint8Array(enc.nonce.length + enc.ciphertext.length)
          blob.set(enc.nonce, 0)
          blob.set(enc.ciphertext, enc.nonce.length)
          form.append(`chunk_${i}`, new Blob([blob as BlobPart], { type: 'application/octet-stream' }))
          update({ status: 'encrypting', progress: Math.round(((i + 1) / plan.chunk_count) * 60) })
        }

        // 4. Seal C to the request public key (fresh ephemeral keypair in core).
        const { ePub, wrappedKey } = await sealToRequest(rPub, contentKey)

        // 5. Build metadata + POST.
        form.append(
          'metadata',
          JSON.stringify({
            name_encrypted: nameEncrypted,
            size_bytes: file.size,
            sender_ephemeral_pubkey: toBase64(ePub),
            wrapped_key: toBase64(wrappedKey),
          }),
        )

        update({ status: 'uploading', progress: 75 })
        await uploadToFileRequest(token, form)
        update({ status: 'done', progress: 100 })
      } finally {
        // 6. Discard the content key.
        contentKey.fill(0)
      }
    },
    [token, rPub],
  )

  const handleUpload = useCallback(async () => {
    const queued = items
      .map((it, i) => ({ it, i }))
      .filter(({ it }) => it.status === 'queued' || it.status === 'error')
    if (queued.length === 0) return

    setPhase('working')
    setErrorMsg(null)
    let delivered = deliveredCount

    // Sequential: bounds memory and respects the per-IP public rate limit.
    for (const { it, i } of queued) {
      try {
        await uploadOne(i, it.file)
        delivered++
        setDeliveredCount(delivered)
      } catch (e) {
        setItems((prev) =>
          prev.map((p, idx) =>
            idx === i
              ? { ...p, status: 'error', error: e instanceof Error ? e.message : 'Upload failed' }
              : p,
          ),
        )
      }
    }

    const anyError = items.some((it, i) => queued.find((q) => q.i === i) && it.status === 'error')
    if (delivered > 0 && !anyError) {
      setPhase('done')
    } else {
      setPhase('idle')
      if (delivered === 0) setErrorMsg('Upload failed. Please try again.')
    }
  }, [items, uploadOne, deliveredCount])

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

  const Shell = ({ children }: { children: React.ReactNode }) => (
    <div className="min-h-screen flex items-center justify-center bg-paper relative overflow-hidden">
      {honeycombBg}
      <div className="relative w-full max-w-[28rem] mx-4">
        <div className="mb-8 flex justify-center">
          <BBLogo size={16} />
        </div>
        {children}
      </div>
    </div>
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

  // ─── Incomplete link (no/invalid #R_pub fragment) ─────────────────────────
  if (phase === 'incomplete') {
    return (
      <Shell>
        <div className="bg-paper border border-line-2 rounded-xl shadow-3 p-8 text-center">
          <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-red/10 flex items-center justify-center">
            <Icon name="shield" size={24} className="text-red" />
          </div>
          <h2 className="text-lg font-semibold text-ink mb-2">This link is incomplete</h2>
          <p className="text-sm text-ink-3 leading-relaxed">
            The encryption key is missing from this link, so files uploaded here could never be
            decrypted. Ask the person who shared it to send you the full link — it should end
            with <span className="font-mono">#…</span>.
          </p>
        </div>
      </Shell>
    )
  }

  // ─── Error (dead link) ─────────────────────────────────────────────────────
  if (phase === 'error') {
    return (
      <Shell>
        <div className="bg-paper border border-line-2 rounded-xl shadow-3 p-8 text-center">
          <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-red/10 flex items-center justify-center">
            <Icon name="shield" size={24} className="text-red" />
          </div>
          <h2 className="text-lg font-semibold text-ink mb-2">Link unavailable</h2>
          <p className="text-sm text-ink-3">
            {errorMsg ?? 'This link has expired or is no longer active.'}
          </p>
        </div>
      </Shell>
    )
  }

  // ─── Success ─────────────────────────────────────────────────────────────
  if (phase === 'done') {
    return (
      <Shell>
        <div className="bg-paper border border-line-2 rounded-xl shadow-3 overflow-hidden">
          <div className="p-8 text-center">
            <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-green/10 flex items-center justify-center">
              <Icon name="check" size={24} className="text-green" />
            </div>
            <h2 className="text-[18px] font-semibold text-ink mb-2">
              {deliveredCount === 1 ? 'File delivered securely' : `${deliveredCount} files delivered securely`}
            </h2>
            <p className="text-[13px] text-ink-3 leading-relaxed">
              {deliveredCount === 1 ? 'Your file was' : 'Your files were'} encrypted in your browser
              before being sent. Only the recipient can open {deliveredCount === 1 ? 'it' : 'them'}.
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
      </Shell>
    )
  }

  // ─── Upload form (idle / working) ──────────────────────────────────────────
  const isWorking = phase === 'working'
  const hasFiles = items.length > 0
  const canAddMore = !isWorking && items.length < remainingFiles

  return (
    <Shell>
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
          {requestInfo && (
            <p className="text-[11px] text-ink-4 text-center font-mono mt-2">
              {requestInfo.files_received} of {requestInfo.max_files} received
              {requestInfo.max_total_bytes != null && (
                <> · up to {formatBytes(requestInfo.max_total_bytes)} total</>
              )}
            </p>
          )}
        </div>

        <div className="px-8 py-6">
          {isFull ? (
            <div className="rounded-lg bg-paper-2 border border-line px-4 py-6 text-center">
              <p className="text-[13px] font-medium text-ink">This request is full</p>
              <p className="text-[11px] text-ink-3 mt-1">
                It has already received the maximum number of files.
              </p>
            </div>
          ) : (
            <>
              {/* Drop zone */}
              <div
                ref={dropRef}
                onClick={() => canAddMore && fileInputRef.current?.click()}
                className={`
                  relative rounded-xl border-2 border-dashed transition-colors
                  flex flex-col items-center justify-center gap-3 py-10 px-4
                  ${isWorking ? 'border-line bg-paper-2 cursor-not-allowed opacity-60' :
                    !canAddMore ? 'border-line bg-paper-2 cursor-not-allowed opacity-60' :
                    'border-line hover:border-amber/40 hover:bg-paper-2 cursor-pointer'}
                `}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple={remainingFiles > 1}
                  className="sr-only"
                  disabled={!canAddMore}
                  onChange={(e) => {
                    if (e.target.files) addFiles(e.target.files)
                    e.target.value = ''
                  }}
                />
                <div className="w-12 h-12 rounded-xl bg-paper-3 flex items-center justify-center">
                  <Icon name="upload" size={22} className="text-ink-3" />
                </div>
                <div className="text-center">
                  <div className="text-[13px] font-medium text-ink">
                    {remainingFiles > 1 ? 'Drop files or click to browse' : 'Drop a file or click to browse'}
                  </div>
                  <div className="text-[11px] text-ink-4 mt-1">
                    {remainingFiles > 1
                      ? `Any file type · up to ${remainingFiles} files`
                      : 'Any file type'}
                  </div>
                </div>
              </div>

              {/* Selected files */}
              {hasFiles && (
                <ul className="mt-4 space-y-2">
                  {items.map((it, i) => (
                    <li
                      key={`${it.file.name}-${i}`}
                      className="flex items-center gap-3 rounded-lg border border-line bg-paper-2 px-3 py-2"
                    >
                      <div className="w-8 h-8 shrink-0 rounded-lg bg-amber/10 flex items-center justify-center">
                        <Icon
                          name={it.status === 'done' ? 'check' : 'file'}
                          size={16}
                          className={it.status === 'done' ? 'text-green' : 'text-amber-deep'}
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-[12px] font-medium text-ink truncate">{it.file.name}</div>
                        <div className="text-[10px] text-ink-4 font-mono">
                          {formatBytes(it.file.size)}
                          {it.status === 'encrypting' && ' · encrypting…'}
                          {it.status === 'uploading' && ' · sending…'}
                          {it.status === 'done' && ' · delivered'}
                          {it.status === 'error' && (
                            <span className="text-red"> · {it.error ?? 'failed'}</span>
                          )}
                        </div>
                        {(it.status === 'encrypting' || it.status === 'uploading') && (
                          <div className="mt-1 h-1 rounded-full bg-paper-3 overflow-hidden">
                            <div
                              className="h-full bg-amber rounded-full transition-all duration-300"
                              style={{ width: `${it.progress}%` }}
                            />
                          </div>
                        )}
                      </div>
                      {!isWorking && it.status !== 'done' && (
                        <button
                          type="button"
                          onClick={() => setItems((prev) => prev.filter((_, idx) => idx !== i))}
                          className="text-[11px] text-ink-4 hover:text-red transition-colors cursor-pointer"
                        >
                          Remove
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {errorMsg && phase === 'idle' && (
                <div className="mt-3 rounded-lg bg-red/5 border border-red/20 px-3 py-2 text-[12px] text-red">
                  {errorMsg}
                </div>
              )}

              {/* Submit */}
              <div className="mt-5">
                <BBButton
                  disabled={!hasFiles || isWorking}
                  onClick={handleUpload}
                  className="w-full"
                >
                  {isWorking ? (
                    <span className="flex items-center gap-2">
                      <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                      Encrypting & sending…
                    </span>
                  ) : items.length > 1 ? `Send ${items.length} files securely` : 'Send file securely'}
                </BBButton>
              </div>
            </>
          )}
        </div>

        {/* Footer — zero-knowledge badge */}
        <div className="px-8 py-4 bg-paper-2 border-t border-line">
          <div className="flex items-start gap-2.5 select-none" role="note">
            <div className="w-0.5 self-stretch bg-amber-deep rounded-full shrink-0 mt-0.5" />
            <div>
              <div className="flex items-center gap-1.5 mb-0.5">
                <Icon name="lock" size={11} className="text-amber-deep shrink-0" />
                <span className="text-[12px] font-semibold text-ink">Encrypted in your browser</span>
              </div>
              <p className="text-[11px] text-ink-3 leading-relaxed">
                Your {items.length > 1 ? 'files are' : 'file is'} encrypted before {items.length > 1 ? 'they leave' : 'it leaves'} this
                device, sealed so only the recipient can open {items.length > 1 ? 'them' : 'it'}. Beebeeb cannot read {items.length > 1 ? 'them' : 'it'}.
              </p>
            </div>
          </div>
        </div>
      </div>
    </Shell>
  )
}
