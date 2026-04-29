import { useEffect, useState } from 'react'
import { downloadFile, type DriveFile } from '../../lib/api'
import { PreviewChrome } from './preview-chrome'
import { InfoRail } from './info-rail'
import { ImagePreview } from './image-preview'
import { PdfPreview } from './pdf-preview'
import { VideoPreview } from './video-preview'
import { MarkdownPreview } from './markdown-preview'
import { BBButton } from '../bb-button'
import { Icon } from '../icons'
import { useKeys } from '../../lib/key-context'
import { decryptFilename, fromBase64 } from '../../lib/crypto'

interface FilePreviewProps {
  file: DriveFile
  /** Pre-decrypted filename. If not provided, component will attempt to decrypt. */
  decryptedName?: string
  onClose: () => void
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

function getKindLabel(mimeType: string): string {
  if (mimeType.startsWith('image/')) {
    const sub = mimeType.split('/')[1]?.toUpperCase() ?? 'Image'
    return sub === 'JPEG' ? 'JPEG Image' : `${sub} Image`
  }
  if (mimeType === 'application/pdf') return 'PDF Document'
  if (mimeType.startsWith('video/')) {
    const sub = mimeType.split('/')[1]?.toUpperCase() ?? 'Video'
    return `${sub} Video`
  }
  if (mimeType === 'text/markdown') return 'Markdown'
  if (mimeType === 'text/plain') return 'Plain Text'
  return mimeType
}

function pickRenderer(
  mimeType: string,
  blob: Blob,
): React.ReactNode {
  if (mimeType.startsWith('image/')) {
    return <ImagePreview blob={blob} />
  }
  if (mimeType === 'application/pdf') {
    return <PdfPreview blob={blob} />
  }
  if (mimeType.startsWith('video/')) {
    return <VideoPreview blob={blob} />
  }
  if (mimeType === 'text/markdown' || mimeType === 'text/plain') {
    return <MarkdownPreview blob={blob} />
  }
  return null
}

export function FilePreview({ file, decryptedName: decryptedNameProp, onClose }: FilePreviewProps) {
  const { getFileKey, isUnlocked } = useKeys()
  const [blob, setBlob] = useState<Blob | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [localDecryptedName, setLocalDecryptedName] = useState<string | null>(null)

  // Display name: use prop, then locally decrypted, then raw
  const name = decryptedNameProp ?? localDecryptedName ?? file.name_encrypted

  // Decrypt filename if not provided as prop
  useEffect(() => {
    if (decryptedNameProp || !isUnlocked) return
    let cancelled = false
    async function decrypt() {
      try {
        const parsed = JSON.parse(file.name_encrypted) as {
          nonce: string
          ciphertext: string
        }
        const fileKey = await getFileKey(file.id)
        const decrypted = await decryptFilename(
          fileKey,
          fromBase64(parsed.nonce),
          fromBase64(parsed.ciphertext),
        )
        if (!cancelled) setLocalDecryptedName(decrypted)
      } catch {
        // Not encrypted JSON or decryption failed -- use raw value
      }
    }
    decrypt()
    return () => { cancelled = true }
  }, [file.id, file.name_encrypted, decryptedNameProp, isUnlocked, getFileKey])

  useEffect(() => {
    let cancelled = false
    setBlob(null)
    setError(null)

    downloadFile(file.id)
      .then((b) => {
        if (!cancelled) setBlob(b)
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setError(
            err instanceof Error ? err.message : 'Failed to load file',
          )
      })

    return () => {
      cancelled = true
    }
  }, [file.id])

  const sizeStr = formatSize(file.size_bytes)
  const kindLabel = getKindLabel(file.mime_type)
  const renderer = blob ? pickRenderer(file.mime_type, blob) : null
  const canPreview = renderer !== null

  function handleDownload() {
    if (!blob) return
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return (
    <PreviewChrome
      filename={name}
      kind={file.mime_type}
      size={sizeStr}
      onClose={onClose}
      rightRail={
        <InfoRail
          filename={name}
          kind={kindLabel}
          size={sizeStr}
          items={[
            ['Modified', new Date(file.updated_at).toLocaleDateString()],
          ]}
        />
      }
    >
      {/* Loading state */}
      {!blob && !error && (
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-line border-t-amber" />
          <span className="text-sm text-ink-3">Decrypting...</span>
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="flex flex-col items-center gap-3 text-center">
          <Icon name="shield" size={32} className="text-red" />
          <p className="text-sm font-medium text-ink">{error}</p>
          <BBButton variant="default" size="sm" onClick={onClose}>
            Close
          </BBButton>
        </div>
      )}

      {/* Unsupported type */}
      {blob && !canPreview && (
        <div className="flex flex-col items-center gap-4 text-center">
          <Icon name="file" size={40} className="text-ink-3" />
          <p className="text-sm text-ink-2">
            Preview not available for this file type
          </p>
          <BBButton variant="amber" size="md" onClick={handleDownload}>
            <Icon name="download" size={14} className="mr-2" />
            Download
          </BBButton>
        </div>
      )}

      {/* Actual preview */}
      {renderer}
    </PreviewChrome>
  )
}
