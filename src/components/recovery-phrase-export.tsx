// The master key export: copy, download the text file, download the PDF.
import { useState } from 'react'
import { BBButton, Icon } from '@beebeeb/shared'
import { generateRecoveryKitPDF } from '../lib/recovery-kit-pdf'
import { copyPhraseWithAutoClear, phraseToText } from '../lib/recovery-phrase-export'

/** Text file name of the master key download (the lib's PHRASE_FILENAME is not this component's to rename). */
export const MASTER_KEY_FILENAME = 'beebeeb-master-key.txt'

function downloadMasterKeyTxt(words: string[]): void {
  const url = URL.createObjectURL(new Blob([phraseToText(words)], { type: 'text/plain' }))
  const a = document.createElement('a')
  a.href = url
  a.download = MASTER_KEY_FILENAME
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * Copy / Download .txt / Master key PDF for a freshly generated master key. The one implementation behind BOTH signup surfaces (legacy
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
      <BBButton size="sm" onClick={() => downloadMasterKeyTxt(words)} data-testid="phrase-download-txt">
        <Icon name="download" size={14} className="mr-1.5" /> Download .txt
      </BBButton>
      <BBButton
        size="sm"
        variant="amber"
        onClick={() => generateRecoveryKitPDF(phrase, email)}
        title="Opens a print-ready page. Choose 'Save as PDF' in the print dialog"
        data-testid="phrase-recovery-kit"
      >
        <Icon name="file-text" size={14} className="mr-1.5" /> Master key PDF
      </BBButton>
    </div>
  )
}
