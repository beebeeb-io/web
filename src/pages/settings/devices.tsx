import { useCallback, useEffect, useRef, useState } from 'react'
import { SettingsShell, SettingsHeader } from '../../components/settings-shell'
import { Icon } from '../../components/icons'
import { BBChip } from '../../components/bb-chip'
import { BBButton } from '../../components/bb-button'
import { useKeys } from '../../lib/key-context'
import { encryptForQr, generateCode } from '../../lib/qr-crypto'
import QRCode from 'qrcode'

interface Device {
  name: string
  platform: string
  firstSeen: string
  lastActive: string
  current: boolean
  synced: string
  mobile: boolean
}

const devices: Device[] = [
  { name: 'MacBook Pro · Safari', platform: 'macOS 14.4', firstSeen: '24 Aug 2024', lastActive: 'Active now', current: true, synced: '23.4 GB', mobile: false },
  { name: 'iPhone 15 Pro', platform: 'iOS 17.5 · v1.2.0', firstSeen: '24 Aug 2024', lastActive: '14 min ago', current: false, synced: '8.2 GB · Camera only', mobile: true },
  { name: 'Pixel 8', platform: 'Android 14 · v1.2.0', firstSeen: '3 Sep 2024', lastActive: '3 days ago', current: false, synced: '4.1 GB · Selective', mobile: true },
  { name: 'Desktop · Windows', platform: 'Windows 11 · Sync v0.9', firstSeen: '12 Oct 2024', lastActive: '6 days ago', current: false, synced: '23.4 GB · Full', mobile: false },
  { name: 'bb CLI', platform: 'Linux · v0.4.1', firstSeen: '4 Mar 2026', lastActive: '12 days ago', current: false, synced: 'on-demand', mobile: false },
]

function AddDevicePanel() {
  const { getMasterKey, isUnlocked } = useKeys()
  const [showQr, setShowQr] = useState(false)
  const [code, setCode] = useState('')
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [error, setError] = useState('')
  const [expiresIn, setExpiresIn] = useState(300) // 5 min
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const startProvisioning = useCallback(async () => {
    setError('')
    try {
      const masterKey = getMasterKey()
      const numericCode = generateCode()
      const payload = await encryptForQr(masterKey, numericCode)
      const dataUrl = await QRCode.toDataURL(payload, {
        width: 240,
        margin: 2,
        color: { dark: '#1a1714', light: '#ffffff' },
        errorCorrectionLevel: 'M',
      })
      setCode(numericCode)
      setQrDataUrl(dataUrl)
      setShowQr(true)
      setExpiresIn(300)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate QR code')
    }
  }, [getMasterKey])

  // Countdown timer
  useEffect(() => {
    if (!showQr) return
    timerRef.current = setInterval(() => {
      setExpiresIn((prev) => {
        if (prev <= 1) {
          setShowQr(false)
          setCode('')
          setQrDataUrl('')
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [showQr])

  const cancelProvisioning = () => {
    setShowQr(false)
    setCode('')
    setQrDataUrl('')
    setExpiresIn(300)
    if (timerRef.current) clearInterval(timerRef.current)
  }

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60)
    const sec = s % 60
    return `${m}:${String(sec).padStart(2, '0')}`
  }

  if (!isUnlocked) return null

  return (
    <div className="px-7 py-5 border-b border-line">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-[13.5px] font-semibold text-ink">Add a device</h3>
        {!showQr && (
          <BBButton size="sm" variant="amber" onClick={startProvisioning}>
            <Icon name="plus" size={12} className="mr-1.5" />
            Generate QR
          </BBButton>
        )}
      </div>
      <p className="text-[11px] text-ink-3 leading-relaxed">
        Scan a QR code on the new device to transfer your vault key securely.
      </p>

      {error && (
        <p className="text-xs text-red mt-3">{error}</p>
      )}

      {showQr && (
        <div className="mt-4 flex gap-6 items-start">
          {/* QR code */}
          <div className="shrink-0">
            <div className="rounded-lg border border-line p-2 bg-white">
              <img
                src={qrDataUrl}
                alt="Device provisioning QR code"
                width={240}
                height={240}
                className="block"
              />
            </div>
          </div>

          {/* Code + instructions */}
          <div className="flex-1 min-w-0">
            <p className="text-xs text-ink-2 mb-3 leading-relaxed">
              On the new device, open Beebeeb, sign in, and choose "Scan QR" when prompted. After scanning, enter this code:
            </p>
            <div className="inline-flex items-center gap-3 bg-paper-2 border border-line rounded-lg px-4 py-3">
              <span className="text-2xl font-mono font-bold text-ink tracking-[0.2em]">
                {code.slice(0, 3)} {code.slice(3)}
              </span>
            </div>
            <div className="flex items-center gap-2 mt-3">
              <Icon name="clock" size={11} className="text-ink-3" />
              <span className="text-[11px] font-mono text-ink-3">
                Expires in {formatTime(expiresIn)}
              </span>
            </div>
            <div className="mt-4">
              <BBButton size="sm" variant="ghost" onClick={cancelProvisioning}>
                Cancel
              </BBButton>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export function SettingsDevices() {
  return (
    <SettingsShell activeSection="devices">
      <SettingsHeader
        title="Devices"
        subtitle="Every device holding a copy of your vault key. Revoke to re-encrypt your data against a new key."
      />

      <AddDevicePanel />

      <div className="py-2">
        {devices.map((d, i) => (
          <div
            key={i}
            className={`flex items-center gap-3.5 px-7 py-3.5 ${
              i < devices.length - 1 ? 'border-b border-line' : ''
            }`}
          >
            {/* Device icon */}
            <div className="w-10 h-10 rounded-lg bg-paper-2 border border-line flex items-center justify-center shrink-0">
              <Icon
                name={d.mobile ? 'image' : 'cloud'}
                size={15}
                className="text-ink-2"
              />
            </div>

            {/* Device info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 text-[13.5px] font-medium text-ink">
                {d.name}
                {d.current && (
                  <BBChip variant="green">
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-green mr-1.5" />
                    This device
                  </BBChip>
                )}
              </div>
              <div className="text-[11px] text-ink-3 mt-0.5">
                {d.platform} {'·'} first seen {d.firstSeen} {'·'} {d.lastActive}
              </div>
            </div>

            {/* Synced */}
            <span className="text-[11px] font-mono text-ink-3 shrink-0">{d.synced}</span>

            {/* Revoke */}
            {!d.current && (
              <BBButton size="sm" variant="ghost">Revoke</BBButton>
            )}
          </div>
        ))}
      </div>
    </SettingsShell>
  )
}
