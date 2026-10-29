import { useState } from 'react'
import { BBButton, Icon } from '@beebeeb/shared'
import { generateRecoveryKitPDF } from '../lib/recovery-kit-pdf'
import { copyPhraseWithAutoClear, downloadPhraseTxt } from '../lib/recovery-phrase-export'

/**
 * Copy / Download .txt / Recovery Kit PDF for a freshly generated recovery
 * phrase. The one implementation behind BOTH signup surfaces (legacy
 * pages/onboarding.tsx and the document-driven phrase step), task 1815:
 * the document-driven step shipped without these and nobody noticed because
 * the two copies had diverged. Amber marks only the primary action.
 */
export function RecoveryPhraseExport({ words, email }: { words: string[]; email: string }) {
  const [copied, setCopied] = useState(false)
  const phrase = words.join(' ')

  async function copy() {
    try {
      await copyPhraseWithAutoClear(phrase, navigator.clipboard)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* clipboard denied: the words are on screen and the other two actions remain */
    }
  }

  return (
    <div className="flex flex-wrap gap-2" data-testid="phrase-export">
      <BBButton size="sm" onClick={copy} data-testid="phrase-copy">
        <Icon name="copy" size={14} className="mr-1.5" /> {copied ? 'Copied' : 'Copy'}
      </BBButton>
      <BBButton size="sm" onClick={() => downloadPhraseTxt(words)} data-testid="phrase-download-txt">
        <Icon name="download" size={14} className="mr-1.5" /> Download .txt
      </BBButton>
      <BBButton
        size="sm"
        variant="amber"
        onClick={() => generateRecoveryKitPDF(phrase, email)}
        title="Opens a print-ready page. Choose 'Save as PDF' in the print dialog"
        data-testid="phrase-recovery-kit"
      >
        <Icon name="file-text" size={14} className="mr-1.5" /> Recovery Kit PDF
      </BBButton>
    </div>
  )
}
