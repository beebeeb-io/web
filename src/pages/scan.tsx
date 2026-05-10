import { useState, useRef, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { DriveLayout } from '../components/drive-layout'
import { Icon } from '@beebeeb/shared'
import { useKeys } from '../lib/key-context'
import { useToast } from '../components/toast'
import { encryptedUpload } from '../lib/encrypted-upload'

// ─── PDF generation (no external deps) ──────────────────────────────────────
// Builds a minimal valid PDF that embeds one JPEG per page.
// Each page matches the image dimensions, so portrait/landscape is preserved.

function buildMinimalPdf(pages: { jpegBase64: string; width: number; height: number }[]): Uint8Array {
  const enc = (s: string) => new TextEncoder().encode(s)

  const offsets: number[] = []

  // Object numbering: 1=catalog, 2=pages, then per page: 3+3i=page, 4+3i=content, 5+3i=image
  const catalogId = 1
  const pagesId = 2
  const firstPageObjId = 3 // pages start at 3, stride 3: page, content, image

  const pageObjIds: number[] = []
  for (let i = 0; i < pages.length; i++) {
    pageObjIds.push(firstPageObjId + i * 3)
  }

  // We'll build all objects first, then concatenate with tracked offsets.
  type PdfObj = { id: number; data: string }
  const pdfObjs: PdfObj[] = []

  // Catalog
  pdfObjs.push({
    id: catalogId,
    data: `${catalogId} 0 obj\n<< /Type /Catalog /Pages ${pagesId} 0 R >>\nendobj\n`,
  })

  // Pages dict (kids filled after we know all page IDs)
  const kidsRef = pageObjIds.map(id => `${id} 0 R`).join(' ')
  pdfObjs.push({
    id: pagesId,
    data: `${pagesId} 0 obj\n<< /Type /Pages /Kids [${kidsRef}] /Count ${pages.length} >>\nendobj\n`,
  })

  for (let i = 0; i < pages.length; i++) {
    const { jpegBase64, width, height } = pages[i]
    const pageObjId = firstPageObjId + i * 3
    const contentObjId = pageObjId + 1
    const imageObjId = pageObjId + 2
    const imgName = `Im${i}`

    // Page object
    pdfObjs.push({
      id: pageObjId,
      data:
        `${pageObjId} 0 obj\n` +
        `<< /Type /Page /Parent ${pagesId} 0 R\n` +
        `   /MediaBox [0 0 ${width} ${height}]\n` +
        `   /Resources << /XObject << /${imgName} ${imageObjId} 0 R >> >>\n` +
        `   /Contents ${contentObjId} 0 R >>\n` +
        `endobj\n`,
    })

    // Content stream: draw image filling the page
    const streamStr = `q ${width} 0 0 ${height} 0 0 cm /${imgName} Do Q`
    pdfObjs.push({
      id: contentObjId,
      data:
        `${contentObjId} 0 obj\n` +
        `<< /Length ${streamStr.length} >>\n` +
        `stream\n${streamStr}\nendstream\n` +
        `endobj\n`,
    })

    // JPEG image XObject
    const jpegBytes = Uint8Array.from(atob(jpegBase64), c => c.charCodeAt(0))
    const imageHeader =
      `${imageObjId} 0 obj\n` +
      `<< /Type /XObject /Subtype /Image\n` +
      `   /Width ${width} /Height ${height}\n` +
      `   /ColorSpace /DeviceRGB /BitsPerComponent 8\n` +
      `   /Filter /DCTDecode /Length ${jpegBytes.length} >>\n` +
      `stream\n`
    const imageFooter = `\nendstream\nendobj\n`

    // We store image objects separately because they contain binary
    pdfObjs.push({
      id: imageObjId,
      data: imageHeader,
      // signal that binary payload follows
    } as PdfObj & { binary?: Uint8Array; footer?: string })
    // Store binary data on the object
    ;(pdfObjs[pdfObjs.length - 1] as PdfObj & { binary?: Uint8Array; footer?: string }).binary =
      jpegBytes
    ;(pdfObjs[pdfObjs.length - 1] as PdfObj & { binary?: Uint8Array; footer?: string }).footer =
      imageFooter
  }

  // Now serialise into one byte array, tracking cross-ref offsets
  const header = enc('%PDF-1.4\n%\xc2\xa9\n')
  const parts: Uint8Array[] = [header]
  let byteOffset = header.length

  // Sort objects by ID to write in order
  const sorted = [...pdfObjs].sort((a, b) => a.id - b.id)

  for (const obj of sorted) {
    offsets[obj.id] = byteOffset
    const headerBytes = enc((obj as PdfObj & { binary?: Uint8Array }).data ?? '')
    parts.push(headerBytes)
    byteOffset += headerBytes.length

    const extra = obj as PdfObj & { binary?: Uint8Array; footer?: string }
    if (extra.binary) {
      parts.push(extra.binary)
      byteOffset += extra.binary.length
      const footerBytes = enc(extra.footer ?? '')
      parts.push(footerBytes)
      byteOffset += footerBytes.length
    }
  }

  // Cross-reference table
  const xrefOffset = byteOffset
  const maxId = Math.max(...sorted.map(o => o.id))
  let xref = `xref\n0 ${maxId + 1}\n`
  xref += '0000000000 65535 f \n'
  for (let id = 1; id <= maxId; id++) {
    const off = offsets[id] ?? 0
    xref += `${String(off).padStart(10, '0')} 00000 n \n`
  }
  xref +=
    `trailer\n<< /Size ${maxId + 1} /Root ${catalogId} 0 R >>\n` +
    `startxref\n${xrefOffset}\n%%EOF\n`
  parts.push(enc(xref))

  // Concatenate all parts
  const totalLen = parts.reduce((s, p) => s + p.length, 0)
  const result = new Uint8Array(totalLen)
  let pos = 0
  for (const p of parts) {
    result.set(p, pos)
    pos += p.length
  }
  return result
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatScanFilename(): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  const time = `${pad(now.getHours())}-${pad(now.getMinutes())}`
  return `Scan_${date}_${time}.pdf`
}

function uint8ArrayToFile(data: Uint8Array, name: string, mime: string): File {
  return new File([data.buffer as ArrayBuffer], name, { type: mime })
}

// Capture a JPEG frame from the video element, returning base64 string + dimensions
function captureFrame(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
): { jpegBase64: string; width: number; height: number; dataUrl: string } {
  const vw = video.videoWidth || 640
  const vh = video.videoHeight || 480
  canvas.width = vw
  canvas.height = vh
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(video, 0, 0, vw, vh)
  const dataUrl = canvas.toDataURL('image/jpeg', 0.92)
  const jpegBase64 = dataUrl.split(',')[1]
  return { jpegBase64, width: vw, height: vh, dataUrl }
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface CapturedPage {
  id: string
  jpegBase64: string
  width: number
  height: number
  dataUrl: string
}

type ScanStep = 'viewfinder' | 'review' | 'saving' | 'done'

// ─── Component ───────────────────────────────────────────────────────────────

export function ScanPage() {
  const navigate = useNavigate()
  const { getFileKey, isUnlocked, cryptoReady } = useKeys()
  const { showToast } = useToast()

  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const [step, setStep] = useState<ScanStep>('viewfinder')
  const [pages, setPages] = useState<CapturedPage[]>([])
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [cameraReady, setCameraReady] = useState(false)
  const [saveProgress, setSaveProgress] = useState(0)
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null)
  const [flash, setFlash] = useState(false)

  // Start camera on mount
  useEffect(() => {
    let cancelled = false

    async function startCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        })
        if (cancelled) {
          stream.getTracks().forEach(t => t.stop())
          return
        }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          videoRef.current.onloadedmetadata = () => {
            if (!cancelled) setCameraReady(true)
          }
        }
      } catch (err) {
        if (cancelled) return
        const msg = err instanceof Error ? err.message : 'Unknown error'
        if (msg.includes('Permission') || msg.includes('NotAllowed')) {
          setCameraError('Camera permission denied. Allow camera access in your browser settings.')
        } else if (msg.includes('NotFound')) {
          setCameraError('No camera found on this device.')
        } else {
          setCameraError(`Could not start camera: ${msg}`)
        }
      }
    }

    startCamera()

    return () => {
      cancelled = true
      streamRef.current?.getTracks().forEach(t => t.stop())
    }
  }, [])

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
  }, [])

  const handleCapture = useCallback(() => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas || !cameraReady) return

    // Flash effect
    setFlash(true)
    setTimeout(() => setFlash(false), 150)

    const { jpegBase64, width, height, dataUrl } = captureFrame(video, canvas)
    const newPage: CapturedPage = {
      id: crypto.randomUUID(),
      jpegBase64,
      width,
      height,
      dataUrl,
    }
    setPages(prev => [...prev, newPage])
    setSelectedPageId(newPage.id)
    setStep('review')
  }, [cameraReady])

  const handleScanAnother = useCallback(() => {
    setStep('viewfinder')
  }, [])

  const handleDeletePage = useCallback((id: string) => {
    setPages(prev => {
      const next = prev.filter(p => p.id !== id)
      if (next.length === 0) {
        setStep('viewfinder')
        setSelectedPageId(null)
      } else {
        setSelectedPageId(next[next.length - 1].id)
      }
      return next
    })
  }, [])

  const handleSaveToVault = useCallback(async () => {
    if (pages.length === 0 || !isUnlocked || !cryptoReady) return

    setStep('saving')
    setSaveProgress(5)

    try {
      // Build PDF from all captured pages
      const pdfBytes = buildMinimalPdf(
        pages.map(p => ({ jpegBase64: p.jpegBase64, width: p.width, height: p.height })),
      )
      setSaveProgress(30)

      const filename = formatScanFilename()
      const file = uint8ArrayToFile(pdfBytes, filename, 'application/pdf')

      const fileId = crypto.randomUUID()
      const fileKey = await getFileKey(fileId)
      setSaveProgress(40)

      stopCamera()

      await encryptedUpload(file, fileId, fileKey, undefined, (p) => {
        // Map upload progress (0-100) to our 40-100 range
        setSaveProgress(40 + Math.round(p.progress * 0.6))
      })

      setSaveProgress(100)
      setStep('done')

      // Dispatch event so the drive list refreshes if open
      window.dispatchEvent(new CustomEvent('beebeeb:file-uploaded'))

      showToast({ icon: 'check', title: `${filename} saved to vault` })

      // Navigate to drive after brief pause
      setTimeout(() => navigate('/'), 1200)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Upload failed'
      showToast({ icon: 'x', title: `Could not save scan: ${msg}`, danger: true })
      setStep('review')
      setSaveProgress(0)
    }
  }, [pages, isUnlocked, cryptoReady, getFileKey, stopCamera, showToast, navigate])

  // ── Render ────────────────────────────────────────────────────────────────

  const selectedPage = pages.find(p => p.id === selectedPageId) ?? pages[pages.length - 1]

  return (
    <DriveLayout>
      <div className="flex flex-col h-full overflow-hidden bg-paper">

        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-line bg-paper-2 shrink-0">
          <button
            type="button"
            onClick={() => { stopCamera(); navigate(-1) }}
            className="p-1.5 rounded-md text-ink-2 hover:bg-paper-3/60 transition-colors cursor-pointer"
            aria-label="Go back"
          >
            <Icon name="x" size={16} />
          </button>
          <div className="flex items-center gap-2">
            <Icon name="camera" size={15} className="text-amber-deep" />
            <h1 className="text-[15px] font-semibold text-ink">Scan document</h1>
          </div>
          {pages.length > 0 && (
            <span className="ml-auto text-[12px] text-ink-3 font-mono">
              {pages.length} page{pages.length !== 1 ? 's' : ''} captured
            </span>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 flex flex-col md:flex-row min-h-0 overflow-hidden">

          {/* Left: viewfinder or captured image preview */}
          <div className="relative flex-1 flex items-center justify-center bg-ink overflow-hidden">

            {/* Camera viewfinder */}
            <div
              className={`relative w-full ${step === 'viewfinder' ? 'flex' : 'hidden'} items-center justify-center`}
              style={{ aspectRatio: '4/3', maxHeight: '100%' }}
            >
              {/* Flash overlay */}
              {flash && (
                <div className="absolute inset-0 z-10 bg-white pointer-events-none opacity-70 transition-opacity" />
              )}

              {cameraError ? (
                <div className="flex flex-col items-center gap-3 px-6 text-center">
                  <Icon name="camera" size={32} className="text-ink-3" />
                  <p className="text-[14px] text-paper-2">{cameraError}</p>
                  <button
                    type="button"
                    onClick={() => window.location.reload()}
                    className="text-[13px] text-amber underline cursor-pointer"
                  >
                    Try again
                  </button>
                </div>
              ) : (
                <>
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-full object-cover"
                  />
                  {/* Document outline overlay */}
                  {cameraReady && (
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <div
                        className="border-2 rounded-xl"
                        style={{
                          width: '82%',
                          aspectRatio: '3/4',
                          borderColor: 'var(--color-amber)',
                          boxShadow: '0 0 0 2000px rgba(0,0,0,0.35)',
                          borderRadius: '12px',
                        }}
                      >
                        {/* Corner marks */}
                        {[
                          'top-0 left-0 border-t-2 border-l-2 rounded-tl-xl',
                          'top-0 right-0 border-t-2 border-r-2 rounded-tr-xl',
                          'bottom-0 left-0 border-b-2 border-l-2 rounded-bl-xl',
                          'bottom-0 right-0 border-b-2 border-r-2 rounded-br-xl',
                        ].map((cls, i) => (
                          <div
                            key={i}
                            className={`absolute ${cls}`}
                            style={{
                              width: 28,
                              height: 28,
                              borderColor: 'var(--color-amber)',
                            }}
                          />
                        ))}
                        <div className="absolute inset-0 flex items-end justify-center pb-3">
                          <span className="text-[11px] text-amber font-mono opacity-80">
                            Align document within frame
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                  {!cameraReady && !cameraError && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="text-[13px] text-ink-3">Starting camera...</span>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Captured page review */}
            {step !== 'viewfinder' && selectedPage && (
              <div className="flex-1 flex items-center justify-center p-4 w-full">
                <img
                  src={selectedPage.dataUrl}
                  alt={`Page ${pages.indexOf(selectedPage) + 1}`}
                  className="max-w-full max-h-full object-contain rounded-lg shadow-3"
                  style={{ maxHeight: 'calc(100vh - 260px)' }}
                />
              </div>
            )}

            {/* Saving overlay */}
            {step === 'saving' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/60 z-20">
                <Icon name="lock" size={28} className="text-amber" />
                <div className="flex flex-col items-center gap-2 w-48">
                  <div className="w-full h-1.5 rounded-full bg-paper-3/30 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-amber transition-all duration-300"
                      style={{ width: `${saveProgress}%` }}
                    />
                  </div>
                  <span className="text-[12px] font-mono text-paper-2">
                    {saveProgress < 40 ? 'Generating PDF...' : 'Encrypting and uploading...'}
                  </span>
                </div>
              </div>
            )}

            {/* Done overlay */}
            {step === 'done' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/60 z-20">
                <div className="size-12 rounded-full bg-amber flex items-center justify-center">
                  <Icon name="check" size={22} className="text-ink" />
                </div>
                <span className="text-[14px] text-paper font-medium">Saved to vault</span>
              </div>
            )}
          </div>

          {/* Right / Bottom: controls + thumbnail strip */}
          <div className="shrink-0 flex flex-col bg-paper-2 border-t md:border-t-0 md:border-l border-line md:w-64">

            {/* Page thumbnails */}
            {pages.length > 0 && (
              <div className="p-3 border-b border-line">
                <div className="text-[10px] uppercase tracking-wider font-medium text-ink-3 mb-2">
                  Pages
                </div>
                <div className="flex flex-row md:flex-col gap-2 overflow-x-auto md:overflow-y-auto md:max-h-56">
                  {pages.map((page, idx) => (
                    <div
                      key={page.id}
                      className={`relative shrink-0 cursor-pointer rounded-md overflow-hidden border-2 transition-colors ${
                        selectedPage?.id === page.id
                          ? 'border-amber'
                          : 'border-transparent hover:border-line-2'
                      }`}
                      style={{ width: 64, height: 80 }}
                      onClick={() => {
                        setSelectedPageId(page.id)
                        if (step === 'viewfinder') setStep('review')
                      }}
                    >
                      <img
                        src={page.dataUrl}
                        alt={`Page ${idx + 1}`}
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute bottom-0 left-0 right-0 bg-black/40 text-[9px] font-mono text-white text-center py-0.5">
                        {idx + 1}
                      </div>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); handleDeletePage(page.id) }}
                        className="absolute top-0.5 right-0.5 size-4 rounded-full bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 hover:opacity-100 transition-opacity cursor-pointer"
                        aria-label={`Remove page ${idx + 1}`}
                      >
                        <Icon name="x" size={9} className="text-white" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Action buttons */}
            <div className="flex flex-col gap-2.5 p-4 mt-auto">
              {step === 'viewfinder' && (
                <>
                  {pages.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setStep('review')}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-[13px] font-medium border border-line text-ink-2 hover:bg-paper-3/50 transition-colors cursor-pointer"
                    >
                      <Icon name="image" size={14} />
                      Review pages
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleCapture}
                    disabled={!cameraReady || !!cameraError}
                    className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg text-[14px] font-semibold bg-amber text-ink hover:bg-amber/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
                  >
                    <Icon name="camera" size={16} />
                    Capture
                  </button>
                </>
              )}

              {(step === 'review') && (
                <>
                  <button
                    type="button"
                    onClick={handleScanAnother}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-[13px] font-medium border border-line text-ink-2 hover:bg-paper-3/50 transition-colors cursor-pointer"
                  >
                    <Icon name="plus" size={14} />
                    Scan another page
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveToVault}
                    disabled={pages.length === 0}
                    className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg text-[14px] font-semibold bg-amber text-ink hover:bg-amber/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
                  >
                    <Icon name="lock" size={16} />
                    Save {pages.length} page{pages.length !== 1 ? 's' : ''} to vault
                  </button>
                </>
              )}

              {step === 'saving' && (
                <div className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg text-[13px] text-ink-3 border border-line">
                  <Icon name="cloud" size={14} />
                  Saving...
                </div>
              )}

              <p className="text-[10px] text-ink-4 text-center font-mono mt-1">
                Encrypted end-to-end before upload
              </p>
            </div>
          </div>
        </div>

        {/* Hidden canvas for frame capture */}
        <canvas ref={canvasRef} className="hidden" />
      </div>
    </DriveLayout>
  )
}
