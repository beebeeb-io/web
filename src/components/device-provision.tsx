import { type FormEvent, useState } from 'react'
import { AuthShell } from './auth-shell'
import { BBButton } from './bb-button'
import { Icon } from './icons'
import { recoverFromPhrase } from '../lib/crypto'
import { useKeys } from '../lib/key-context'

type Tab = 'phrase' | 'qr'

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

  return (
    <AuthShell
      title="Set up this device"
      subtitle="This device doesn't have your encryption keys yet. Restore them to continue."
    >
      {/* Tab bar */}
      <div className="flex border-b border-line mb-5">
        <button
          type="button"
          onClick={() => setActiveTab('phrase')}
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
          onClick={() => setActiveTab('qr')}
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

      {activeTab === 'qr' && (
        <div className="py-xl text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-lg bg-paper-2 mb-4">
            <Icon name="lock" size={20} className="text-ink-3" />
          </div>
          <p className="text-sm text-ink-3 leading-relaxed max-w-[22rem] mx-auto">
            QR provisioning coming soon. Use your recovery phrase for now.
          </p>
        </div>
      )}
    </AuthShell>
  )
}
