import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { BBButton } from '../components/bb-button'
import { BBCheckbox } from '../components/bb-checkbox'
import { BBLogo } from '../components/bb-logo'
import { Icon } from '../components/icons'
import { useKeys } from '../lib/key-context'
import { generateRecoveryPhrase } from '../lib/crypto'

const BULLET_POINTS: Array<{
  icon: 'eye' | 'key' | 'shield'
  title: string
  desc: string
}> = [
  {
    icon: 'eye',
    title: "We can't see it",
    desc: 'Encrypted on your device before upload.',
  },
  {
    icon: 'key',
    title: "We can't reset it",
    desc: "Lost phrase = lost access. That's the deal.",
  },
  {
    icon: 'shield',
    title: "You're the only custodian",
    desc: 'No backdoors, no master keys, no exceptions.',
  },
]

export function Onboarding() {
  const navigate = useNavigate()
  const { setMasterKey, cryptoReady } = useKeys()
  const [saved, setSaved] = useState(false)
  const [recoveryWords, setRecoveryWords] = useState<string[]>([])
  const [phraseError, setPhraseError] = useState<string | null>(null)

  useEffect(() => {
    if (!cryptoReady) return
    let cancelled = false
    async function generate() {
      try {
        const { phrase, masterKey } = await generateRecoveryPhrase()
        if (cancelled) return
        setRecoveryWords(phrase.split(' '))
        // Store the recovery-derived master key
        setMasterKey(masterKey)
      } catch (err) {
        if (cancelled) return
        setPhraseError(
          err instanceof Error ? err.message : 'Failed to generate recovery phrase',
        )
      }
    }
    generate()
    return () => { cancelled = true }
  }, [cryptoReady, setMasterKey])

  return (
    <div className="min-h-screen flex items-center justify-center bg-paper p-xl">
      <div className="w-full max-w-[820px] bg-paper border border-line-2 rounded-xl shadow-3 overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-4 px-xl py-lg border-b border-line">
          <BBLogo size={15} />
          <div className="ml-auto flex items-center gap-1.5">
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className={`w-7 h-[3px] rounded-full ${
                  i <= 3 ? 'bg-ink' : 'bg-paper-3'
                }`}
              />
            ))}
            <span className="ml-2 text-xs font-medium text-ink-2">
              3 / 4
            </span>
          </div>
        </div>

        <div className="grid grid-cols-[1.2fr_1fr]">
          {/* LEFT -- phrase */}
          <div className="p-8 border-r border-line">
            <p className="text-xs font-medium text-ink-2 mb-2.5">
              Recovery phrase · 12 words
            </p>
            <h1 className="text-xl font-semibold text-ink mb-1.5">
              Your master key, in words.
            </h1>
            <p className="text-sm text-ink-3 leading-relaxed mb-5">
              These 12 words are the only way to recover your account. Write
              them down or save to a password manager.
            </p>

            {/* Word grid */}
            <div className="bg-paper-2 border border-line rounded-lg p-4.5 mb-4">
              {phraseError ? (
                <p className="text-xs text-red">{phraseError}</p>
              ) : recoveryWords.length === 0 ? (
                <p className="text-xs text-ink-3">Generating recovery phrase...</p>
              ) : (
                <div className="grid grid-cols-2 gap-x-7 gap-y-2.5">
                  {recoveryWords.map((word, i) => (
                    <div
                      key={i}
                      className="flex items-baseline gap-2.5 pb-2 border-b border-dashed border-line"
                    >
                      <span className="font-mono text-[11px] text-ink-4 w-4.5">
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <span className="font-mono text-sm font-medium text-ink">
                        {word}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex gap-2">
              <BBButton
                size="sm"
                onClick={() => {
                  if (recoveryWords.length > 0) {
                    navigator.clipboard.writeText(recoveryWords.join(' '))
                  }
                }}
              >
                <Icon name="copy" size={14} className="mr-1.5" />
                Copy
              </BBButton>
              <BBButton size="sm">
                <Icon name="download" size={14} className="mr-1.5" />
                Download PDF
              </BBButton>
            </div>
          </div>

          {/* RIGHT -- explanation */}
          <div className="p-8 bg-paper-2 flex flex-col">
            <p className="text-xs font-medium text-ink-2 mb-2.5">
              Why this matters
            </p>
            <h2 className="text-base font-semibold text-ink mb-5">
              True zero-knowledge means we can't reach in — and neither can
              anyone else.
            </h2>

            <div className="flex flex-col gap-3.5 mb-6">
              {BULLET_POINTS.map(({ icon, title, desc }, i) => (
                <div key={i} className="flex gap-2.5">
                  <div className="mt-0.5 w-[22px] h-[22px] shrink-0 bg-amber-bg rounded-full flex items-center justify-center text-amber-deep">
                    <Icon name={icon} size={12} />
                  </div>
                  <div>
                    <p className="text-[13px] font-semibold text-ink">
                      {title}
                    </p>
                    <p className="text-xs text-ink-3 mt-0.5">{desc}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-auto">
              <div className="mb-4">
                <BBCheckbox
                  checked={saved}
                  onChange={setSaved}
                  label="I've saved my recovery phrase offline."
                />
              </div>

              <BBButton
                variant="amber"
                size="lg"
                className="w-full"
                disabled={!saved}
                onClick={() => navigate('/')}
              >
                Continue
                <Icon name="chevron-right" size={16} className="ml-1.5" />
              </BBButton>

              <p className="text-center mt-2.5 text-[11px] text-ink-4">
                Stored in Frankfurt · Hetzner · under EU jurisdiction
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
