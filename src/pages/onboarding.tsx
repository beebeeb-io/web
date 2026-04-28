import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { BBButton } from '../components/bb-button'
import { BBCheckbox } from '../components/bb-checkbox'
import { BBInput } from '../components/bb-input'
import { BBLogo } from '../components/bb-logo'
import { Icon } from '../components/icons'

const BULLET_POINTS = [
  { icon: 'eye' as const, title: "We can't see it", desc: 'Encrypted on your device before upload.' },
  { icon: 'key' as const, title: "We can't reset it", desc: "Lost phrase = lost access. That's the deal." },
  { icon: 'shield' as const, title: "You're the only custodian", desc: 'No backdoors, no master keys, no exceptions.' },
]

export function Onboarding() {
  const navigate = useNavigate()
  const [saved, setSaved] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [verifyInput, setVerifyInput] = useState('')
  const [verifyError, setVerifyError] = useState('')

  const phrase = sessionStorage.getItem('bb_mnemonic') ?? ''
  const words = phrase.split(' ').filter(Boolean)

  const verifyIndices = useMemo(() => {
    if (words.length === 0) return [0, 0]
    const a = Math.floor(Math.random() * words.length)
    let b = Math.floor(Math.random() * words.length)
    while (b === a) b = Math.floor(Math.random() * words.length)
    return [Math.min(a, b), Math.max(a, b)]
  }, [words.length])

  function handleContinue() {
    if (!verifying) {
      setVerifying(true)
      return
    }
    const parts = verifyInput.trim().toLowerCase().split(/\s+/)
    if (parts.length !== 2 || parts[0] !== words[verifyIndices[0]] || parts[1] !== words[verifyIndices[1]]) {
      setVerifyError(`Incorrect. Enter word ${verifyIndices[0] + 1} and word ${verifyIndices[1] + 1} from your phrase.`)
      return
    }
    sessionStorage.removeItem('bb_mnemonic')
    navigate('/')
  }

  if (words.length === 0) {
    navigate('/signup')
    return null
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-paper p-xl">
      <div className="w-full max-w-[820px] bg-paper border border-line-2 rounded-xl shadow-3 overflow-hidden">
        <div className="flex items-center gap-4 px-xl py-lg border-b border-line">
          <BBLogo size={15} />
          <div className="ml-auto flex items-center gap-1.5">
            {[1, 2, 3].map((i) => (
              <div key={i} className={`w-7 h-[3px] rounded-full ${i <= (verifying ? 3 : 2) ? 'bg-ink' : 'bg-paper-3'}`} />
            ))}
            <span className="ml-2 text-xs font-medium text-ink-2">{verifying ? '3' : '2'} / 3</span>
          </div>
        </div>

        <div className="grid grid-cols-[1.2fr_1fr]">
          <div className="p-8 border-r border-line">
            <p className="text-xs font-medium text-ink-2 mb-2.5">Recovery phrase</p>
            <h1 className="text-xl font-semibold text-ink mb-1.5">
              {verifying ? 'Verify your phrase' : 'Your master key, in words.'}
            </h1>
            <p className="text-sm text-ink-3 leading-relaxed mb-5">
              {verifying
                ? `Enter word ${verifyIndices[0] + 1} and word ${verifyIndices[1] + 1} to prove you saved them.`
                : `These ${words.length} words are the only way to recover your account. Write them down or save to a password manager.`}
            </p>

            {verifying ? (
              <div className="mb-4">
                <div className="flex gap-3 mb-3">
                  <div className="flex-1">
                    <label className="text-xs text-ink-3 mb-1 block">Word {verifyIndices[0] + 1}</label>
                    <BBInput
                      placeholder={`Word ${verifyIndices[0] + 1}`}
                      value={verifyInput.split(/\s+/)[0] ?? ''}
                      onChange={(e) => {
                        const parts = verifyInput.split(/\s+/)
                        parts[0] = e.target.value
                        setVerifyInput(parts.join(' '))
                        setVerifyError('')
                      }}
                      className="font-mono"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="text-xs text-ink-3 mb-1 block">Word {verifyIndices[1] + 1}</label>
                    <BBInput
                      placeholder={`Word ${verifyIndices[1] + 1}`}
                      value={verifyInput.split(/\s+/)[1] ?? ''}
                      onChange={(e) => {
                        const parts = verifyInput.split(/\s+/)
                        while (parts.length < 2) parts.push('')
                        parts[1] = e.target.value
                        setVerifyInput(parts.slice(0, 1).join(' ') + ' ' + e.target.value)
                        setVerifyError('')
                      }}
                      className="font-mono"
                    />
                  </div>
                </div>
                {verifyError && <p className="text-xs text-red">{verifyError}</p>}
              </div>
            ) : (
              <>
                <div className="bg-paper-2 border border-line rounded-lg p-4.5 mb-4">
                  <div className="grid grid-cols-3 gap-x-5 gap-y-2.5">
                    {words.map((word, i) => (
                      <div key={i} className="flex items-baseline gap-2.5 pb-2 border-b border-dashed border-line">
                        <span className="font-mono text-[11px] text-ink-4 w-4.5">{String(i + 1).padStart(2, '0')}</span>
                        <span className="font-mono text-sm font-medium text-ink">{word}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="flex gap-2">
                  <BBButton size="sm" onClick={() => navigator.clipboard.writeText(phrase)}>
                    <Icon name="copy" size={14} className="mr-1.5" /> Copy
                  </BBButton>
                </div>
              </>
            )}
          </div>

          <div className="p-8 bg-paper-2 flex flex-col">
            <p className="text-xs font-medium text-ink-2 mb-2.5">Why this matters</p>
            <h2 className="text-base font-semibold text-ink mb-5">
              True zero-knowledge means we can't reach in — and neither can anyone else.
            </h2>
            <div className="flex flex-col gap-3.5 mb-6">
              {BULLET_POINTS.map(({ icon, title, desc }, i) => (
                <div key={i} className="flex gap-2.5">
                  <div className="mt-0.5 w-[22px] h-[22px] shrink-0 bg-amber-bg rounded-full flex items-center justify-center text-amber-deep">
                    <Icon name={icon} size={12} />
                  </div>
                  <div>
                    <p className="text-[13px] font-semibold text-ink">{title}</p>
                    <p className="text-xs text-ink-3 mt-0.5">{desc}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-auto">
              {!verifying && (
                <div className="mb-4">
                  <BBCheckbox checked={saved} onChange={setSaved} label="I've saved my recovery phrase offline." />
                </div>
              )}
              <BBButton
                variant="amber"
                size="lg"
                className="w-full"
                disabled={!verifying && !saved}
                onClick={handleContinue}
              >
                {verifying ? 'Verify & continue' : 'I saved it — verify'}
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
