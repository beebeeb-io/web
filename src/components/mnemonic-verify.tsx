import { useState, useMemo } from 'react'
import { BBButton } from './bb-button'
import { BBInput } from './bb-input'

interface MnemonicVerifyProps {
  phrase: string
  onVerified: () => void
  onBack: () => void
}

function pickRandomIndices(wordCount: number, count: number): number[] {
  const indices = new Set<number>()
  while (indices.size < count) {
    indices.add(Math.floor(Math.random() * wordCount))
  }
  return Array.from(indices).sort((a, b) => a - b)
}

export function MnemonicVerify({ phrase, onVerified, onBack }: MnemonicVerifyProps) {
  const words = phrase.split(' ').filter(Boolean)

  const indices = useMemo(
    () => pickRandomIndices(words.length, Math.min(3, words.length)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [words.length],
  )

  const [inputs, setInputs] = useState<Record<number, string>>({})
  const [error, setError] = useState('')

  function handleChange(index: number, value: string) {
    setInputs((prev) => ({ ...prev, [index]: value }))
    if (error) setError('')
  }

  function handleVerify() {
    const allCorrect = indices.every(
      (i) => (inputs[i] ?? '').trim().toLowerCase() === words[i].toLowerCase(),
    )
    if (allCorrect) {
      onVerified()
    } else {
      setError('One or more words are incorrect. Check your recovery phrase and try again.')
    }
  }

  return (
    <div className="space-y-lg">
      <div>
        <h2 className="text-lg font-semibold text-ink mb-1">Verify your recovery phrase</h2>
        <p className="text-sm text-ink-3 leading-relaxed">
          Enter the requested words to confirm you saved your phrase.
        </p>
      </div>

      <div className="space-y-md">
        {indices.map((wordIndex) => (
          <BBInput
            key={wordIndex}
            label={`Word #${wordIndex + 1}`}
            placeholder={`Enter word ${wordIndex + 1}`}
            value={inputs[wordIndex] ?? ''}
            onChange={(e) => handleChange(wordIndex, e.target.value)}
            autoComplete="off"
            className="font-mono"
          />
        ))}
      </div>

      {error && (
        <p className="text-sm text-red">{error}</p>
      )}

      <div className="flex items-center gap-3">
        <BBButton variant="ghost" onClick={onBack}>
          Back
        </BBButton>
        <BBButton variant="amber" onClick={handleVerify}>
          Verify
        </BBButton>
      </div>
    </div>
  )
}
