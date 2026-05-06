import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import { AuthShell } from './auth-shell'
import { BBButton } from '@beebeeb/shared'
import { Icon } from '@beebeeb/shared'
import { recoverFromPhrase } from '../lib/crypto'
import { useKeys } from '../lib/key-context'
import { decryptFromQr } from '../lib/qr-crypto'
import jsQR from 'jsqr'

type Tab = 'phrase' | 'qr'
type QrStep = 'scanning' | 'enter-code' | 'decrypting'

interface DeviceProvisionProps {
  password: string
  onProvisioned: () => void
}

export function DeviceProvision({ password, onProvisioned }: DeviceProvisionProps) {
  const { setMasterKey } = useKeys()

  const [activeTab, setActiveTab] = useState<Tab>('phrase')
  const [phrase, setPhrase] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // QR scanning state
  const [qrStep, setQrStep] = useState<QrStep>('scanning')
  const [qrPayload, setQrPayload] = useState('')
  const [codeInput, setCodeInput] = useState('')
  const [cameraError, setCameraError] = useState('')
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const animFrameRef = useRef<number>(0)

  // ─── Recovery phrase handler ──────────────────────

  async function handleRestore(e: FormEvent) {
    e.preventDefault()
    setError('')

    const trimmed = phrase.trim()
    const words = trimmed.split(/\s+/)

    if (words.length !== 12) {
      setError(`Enter all 12 words. You entered ${words.length}.`)
      return
    }

    setSubmitting(true)

    try {
      const masterKey = await recoverFromPhrase(trimmed)
      await setMasterKey(masterKey, password)
      onProvisioned()
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Invalid recovery phrase. Check your words and try again.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  // ─── QR camera scanning ──────────────────────────

  const stopCamera = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current)
      animFrameRef.current = 0
    }
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop()
      }
      streamRef.current = null
    }
  }, [])

  const startCamera = useCallback(async () => {
    setCameraError('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'NotAllowedError') {
        setCameraError('Camera access denied. Allow camera access in your browser settings.')
      } else if (err instanceof DOMException && err.name === 'NotFoundError') {
        setCameraError('No camera found on this device.')
      } else {
        setCameraError('Could not access camera.')
      }
    }
  }, [])

  const scanFrame = useCallback(() => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas || video.readyState !== video.HAVE_ENOUGH_DATA) {
      animFrameRef.current = requestAnimationFrame(scanFrame)
      return
    }

    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) {
      animFrameRef.current = requestAnimationFrame(scanFrame)
      return
    }

    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const qr = jsQR(imageData.data, imageData.width, imageData.height, {
      inversionAttempts: 'dontInvert',
    })

    if (qr && qr.data) {
      // Validate it looks like a base64 payload
      try {
        const raw = atob(qr.data)
        if (raw.length >= 13) {
          setQrPayload(qr.data)
          setQrStep('enter-code')
          stopCamera()
          return
        }
      } catch {
        // Not valid base64, keep scanning
      }
    }

    animFrameRef.current = requestAnimationFrame(scanFrame)
  }, [stopCamera])

  // Start scanning loop when camera is ready
  useEffect(() => {
    if (activeTab !== 'qr' || qrStep !== 'scanning') return
    startCamera().then(() => {
      animFrameRef.current = requestAnimationFrame(scanFrame)
    })
    return () => stopCamera()
  }, [activeTab, qrStep, startCamera, scanFrame, stopCamera])

  // ─── Code verification + decrypt ─────────────────

  async function handleCodeSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')

    const trimmedCode = codeInput.replace(/\s/g, '')
    if (trimmedCode.length !== 6 || !/^\d{6}$/.test(trimmedCode)) {
      setError('Enter the 6-digit code shown on the other device.')
      return
    }

    setQrStep('decrypting')
    try {
      const masterKey = await decryptFromQr(qrPayload, trimmedCode)
      await setMasterKey(masterKey, password)
      onProvisioned()
    } catch (err) {
      setError(
        err instanceof Error && err.message.includes('decrypt')
          ? 'Wrong code. Check the number on the other device and try again.'
          : err instanceof Error
            ? err.message
            : 'Decryption failed. Try again.',
      )
      setQrStep('enter-code')
    }
  }

  function resetQrScan() {
    setQrPayload('')
    setCodeInput('')
    setError('')
    setQrStep('scanning')
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => stopCamera()
  }, [stopCamera])

  return (
    <AuthShell
      title="Set up this device"
      subtitle="This device doesn't have your encryption keys yet. Restore them to continue."
    >
      {/* Tab bar */}
      <div className="flex border-b border-line mb-5">
        <button
          type="button"
          onClick={() => {
            setActiveTab('phrase')
            setError('')
          }}
          className={`flex-1 pb-2.5 text-sm font-medium transition-colors cursor-pointer ${
            activeTab === 'phrase'
              ? 'text-ink border-b-2 border-amber'
              : 'text-ink-3 hover:text-ink-2'
          }`}
        >
          Recovery phrase
        </button>
        <button
          type="button"
          onClick={() => {
            setActiveTab('qr')
            setError('')
          }}
          className={`flex-1 pb-2.5 text-sm font-medium transition-colors cursor-pointer ${
            activeTab === 'qr'
              ? 'text-ink border-b-2 border-amber'
              : 'text-ink-3 hover:text-ink-2'
          }`}
        >
          Scan QR
        </button>
      </div>

      {activeTab === 'phrase' && (
        <form onSubmit={handleRestore}>
          <label
            htmlFor="recovery-phrase"
            className="block text-xs font-medium text-ink-2 mb-1.5"
          >
            Recovery phrase
          </label>
          <textarea
            id="recovery-phrase"
            value={phrase}
            onChange={(e) => {
              setPhrase(e.currentTarget.value)
              if (error) setError('')
            }}
            placeholder="word1 word2 word3 ... word12"
            rows={3}
            autoComplete="off"
            spellCheck={false}
            className="w-full border border-line rounded-md bg-paper px-3 py-2.5 text-sm font-mono text-ink placeholder:text-ink-4 outline-none transition-all focus:ring-2 focus:ring-amber/30 focus:border-amber-deep resize-none"
          />
          <p className="text-xs text-ink-3 mt-1.5 mb-4">
            Enter the 12 words you saved when you created your account, separated by spaces.
          </p>

          {error && (
            <p className="text-xs text-red mb-3">{error}</p>
          )}

          <BBButton
            type="submit"
            variant="amber"
            size="lg"
            className="w-full"
            disabled={submitting || !phrase.trim()}
          >
            <Icon name="key" size={14} className="mr-2" />
            {submitting ? 'Restoring vault...' : 'Restore vault'}
          </BBButton>
        </form>
      )}

      {activeTab === 'qr' && qrStep === 'scanning' && (
        <div>
          {cameraError ? (
            <div className="py-xl text-center">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-lg bg-paper-2 mb-4">
                <Icon name="lock" size={20} className="text-ink-3" />
              </div>
              <p className="text-sm text-red leading-relaxed max-w-[22rem] mx-auto mb-4">
                {cameraError}
              </p>
              <BBButton size="sm" variant="default" onClick={startCamera}>
                Try again
              </BBButton>
            </div>
          ) : (
            <div>
              <p className="text-xs text-ink-3 mb-3 leading-relaxed">
                Point your camera at the QR code shown on your existing device.
              </p>
              <div className="relative rounded-lg overflow-hidden bg-black aspect-square max-w-[320px] mx-auto">
                <video
                  ref={videoRef}
                  playsInline
                  muted
                  className="w-full h-full object-cover"
                />
                {/* Scan guide overlay */}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="w-[60%] h-[60%] border-2 border-white/40 rounded-lg" />
                </div>
              </div>
              <canvas ref={canvasRef} className="hidden" />
            </div>
          )}
        </div>
      )}

      {activeTab === 'qr' && qrStep === 'enter-code' && (
        <form onSubmit={handleCodeSubmit}>
          <div className="py-2 text-center mb-4">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-lg bg-amber-bg mb-3">
              <Icon name="check" size={20} className="text-amber-deep" />
            </div>
            <p className="text-sm font-medium text-ink">QR code scanned</p>
            <p className="text-xs text-ink-3 mt-1">
              Enter the 6-digit code shown on the other device.
            </p>
          </div>

          <label
            htmlFor="provision-code"
            className="block text-xs font-medium text-ink-2 mb-1.5"
          >
            Verification code
          </label>
          <input
            id="provision-code"
            type="text"
            inputMode="numeric"
            pattern="\d{6}"
            maxLength={7}
            value={codeInput}
            onChange={(e) => {
              // Allow digits and a space in the middle for readability
              const raw = e.currentTarget.value.replace(/[^\d]/g, '').slice(0, 6)
              setCodeInput(raw.length > 3 ? `${raw.slice(0, 3)} ${raw.slice(3)}` : raw)
              if (error) setError('')
            }}
            placeholder="000 000"
            autoComplete="off"
            autoFocus
            className="w-full border border-line rounded-md bg-paper px-3 py-2.5 text-center text-xl font-mono font-bold text-ink tracking-[0.2em] placeholder:text-ink-4 outline-none transition-all focus:ring-2 focus:ring-amber/30 focus:border-amber-deep"
          />

          {error && (
            <p className="text-xs text-red mt-2 mb-1">{error}</p>
          )}

          <div className="flex gap-2 mt-4">
            <BBButton
              type="button"
              variant="ghost"
              size="lg"
              className="flex-1"
              onClick={resetQrScan}
            >
              Rescan
            </BBButton>
            <BBButton
              type="submit"
              variant="amber"
              size="lg"
              className="flex-1"
              disabled={codeInput.replace(/\s/g, '').length !== 6}
            >
              <Icon name="lock" size={14} className="mr-2" />
              Unlock vault
            </BBButton>
          </div>
        </form>
      )}

      {activeTab === 'qr' && qrStep === 'decrypting' && (
        <div className="py-xl text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-lg bg-amber-bg mb-4">
            <Icon name="lock" size={20} className="text-amber-deep animate-pulse" />
          </div>
          <p className="text-sm font-medium text-ink">Decrypting vault key...</p>
          <p className="text-xs text-ink-3 mt-1">This only takes a moment.</p>
        </div>
      )}
    </AuthShell>
  )
}
