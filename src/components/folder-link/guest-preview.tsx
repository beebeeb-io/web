import { useEffect, useState } from 'react'
import { PreviewChrome } from '../preview/preview-chrome'
import { ImagePreview } from '../preview/image-preview'
import { VideoPreview } from '../preview/video-preview'
import { PdfPreview } from '../preview/pdf-preview'
import { TextPreview } from '../preview/text-preview'
import { getFileType } from '../file-icon'
import { formatBytes } from '../../lib/format'
import {
  GUEST_PREVIEW_MAX_BYTES,
  GuestPreviewTooLargeError,
  fetchGuestDownloadBlob,
  fetchGuestPlaintextBlob,
} from '../../lib/guest-bytes'
import type { Proof } from '../../lib/folder-link-types'
import type { GuestNode } from './use-guest-listing'

/**
 * Task 2237b — guest preview.
 *
 * Same leaves as the Drive preview, fed from the public byte source. No share,
 * star or edit controls: a guest link owns nothing here.
 */
export function GuestPreview(props: {
  token: string
  node: GuestNode
  proof: Proof | null
  onClose: () => void
  onPrev?: () => void
  onNext?: () => void
  hasPrev?: boolean
  hasNext?: boolean
}) {
  const { node } = props
  const name = node.name ?? "can't read name"
  const [blob, setBlob] = useState<Blob | null>(null)
  const [failed, setFailed] = useState<'missing' | 'too_large' | 'broken' | null>(
    node.fileKey ? null : 'missing',
  )
  const [zoom, setZoom] = useState(1)
  const rotation = 0
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!node.fileKey) return
    let live = true
    const controller = new AbortController()
    setBlob(null)
    setFailed(null)
    void fetchGuestPlaintextBlob({
      token: props.token,
      item: node.item,
      fileKey: node.fileKey,
      proof: props.proof,
      signal: controller.signal,
    })
      .then((next) => {
        if (live) setBlob(next)
      })
      .catch((err) => {
        if (!live) return
        setFailed(err instanceof GuestPreviewTooLargeError ? 'too_large' : 'broken')
      })
    return () => {
      live = false
      controller.abort()
    }
  }, [node, props.token, props.proof])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') props.onClose()
      else if (event.key === 'ArrowLeft' && props.hasPrev) props.onPrev?.()
      else if (event.key === 'ArrowRight' && props.hasNext) props.onNext?.()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [props])

  const download = async () => {
    if (!node.fileKey || busy) return
    setBusy(true)
    try {
      const full = await fetchGuestDownloadBlob({
        token: props.token,
        item: node.item,
        fileKey: node.fileKey,
        proof: props.proof,
      })
      const url = URL.createObjectURL(full)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = name
      anchor.click()
      URL.revokeObjectURL(url)
    } catch {
      setFailed('broken')
    } finally {
      setBusy(false)
    }
  }

  const kind = getFileType(name, false)
  const leaves = () => {
    if (failed === 'missing') {
      return <Notice text="This file can't be opened here." />
    }
    if (failed === 'too_large' || failed === 'broken') {
      return (
        <Notice
          text="Download to open this file."
          action={
            <button
              type="button"
              onClick={download}
              disabled={busy}
              className="mt-3 rounded-lg bg-amber px-3 py-1.5 text-sm font-semibold text-ink disabled:opacity-50"
            >
              Download
            </button>
          }
        />
      )
    }
    if (!blob) return <p className="text-sm text-ink-3">Opening file…</p>

    if (kind === 'image') {
      return (
        <ImagePreview
          blob={blob}
          filename={name}
          zoom={zoom}
          rotation={rotation}
          onZoomChange={setZoom}
          onClose={props.onClose}
          onPrev={props.onPrev}
          onNext={props.onNext}
          hasPrev={props.hasPrev}
          hasNext={props.hasNext}
        />
      )
    }
    if (kind === 'video') return <VideoPreview blob={blob} />
    if (kind === 'pdf') return <PdfPreview blob={blob} />
    if (isTextKind(kind, node.mimeType)) {
      return <TextPreview blob={blob} filename={name} />
    }
    return (
      <Notice
        text="Download to open this file."
        action={
          <button
            type="button"
            onClick={download}
            disabled={busy}
            className="mt-3 rounded-lg bg-amber px-3 py-1.5 text-sm font-semibold text-ink disabled:opacity-50"
          >
            Download
          </button>
        }
      />
    )
  }

  return (
    <PreviewChrome
      filename={name}
      kind={kind}
      size={formatBytes(node.item.size_bytes)}
      onClose={props.onClose}
      decrypted={blob !== null}
      onDownload={node.fileKey ? download : undefined}
    >
      {leaves()}
    </PreviewChrome>
  )
}

function isTextKind(kind: string, mimeType: string | null): boolean {
  if (mimeType?.startsWith('text/')) return true
  return ['word', 'md', 'code', 'data'].includes(kind)
}

function Notice(props: { text: string; action?: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center p-8 text-center text-sm text-ink-3">
      <p>{props.text}</p>
      {props.action}
    </div>
  )
}

export { GUEST_PREVIEW_MAX_BYTES }
