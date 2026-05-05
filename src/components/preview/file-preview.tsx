import { useCallback, useEffect, useState } from 'react'
import { listVersions, restoreVersion, type DriveFile, type FileVersion } from '../../lib/api'
import { decryptToBlob, decryptVersionToBlob } from '../../lib/encrypted-download'
import { PreviewChrome } from './preview-chrome'
import { InfoRail } from './info-rail'
import { VersionScrubber } from './version-scrubber'
import { ImagePreview } from './image-preview'
import { PdfPreview } from './pdf-preview'
import { VideoPreview } from './video-preview'
import { MarkdownPreview } from './markdown-preview'
import { TextPreview } from './text-preview'
import { BBButton } from '../bb-button'
import { Icon } from '../icons'
import { useKeys } from '../../lib/key-context'
import { decryptFilename, fromBase64 } from '../../lib/crypto'

interface FilePreviewProps {
  file: DriveFile
  /** Pre-decrypted filename. If not provided, component will attempt to decrypt. */
  decryptedName?: string
  onClose: () => void
  /** Fires after a successful "Restore this version" so the parent can refresh listings. */
  onVersionRestored?: () => void
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

/** Map file extensions to language names for syntax coloring */
const EXT_LANGUAGE: Record<string, string> = {
  // JavaScript / TypeScript
  js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
  mjs: 'javascript', cjs: 'javascript',
  // Systems
  rs: 'rust', go: 'go', c: 'c', h: 'c', cpp: 'cpp', hpp: 'cpp',
  // JVM
  java: 'java', kt: 'kotlin', scala: 'scala',
  // Scripting
  py: 'python', rb: 'ruby', php: 'php', lua: 'lua', pl: 'perl', sh: 'shell',
  bash: 'shell', zsh: 'shell', fish: 'shell',
  // Web
  html: 'html', htm: 'html', css: 'css', scss: 'css', less: 'css', svg: 'xml',
  // Data / config
  json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml', xml: 'xml',
  sql: 'sql', graphql: 'graphql', gql: 'graphql',
  // DevOps / config
  dockerfile: 'docker', makefile: 'make', cmake: 'cmake',
  tf: 'terraform', hcl: 'terraform',
  // Other
  swift: 'swift', dart: 'dart', r: 'r', ex: 'elixir', exs: 'elixir',
  erl: 'erlang', hs: 'haskell', ml: 'ocaml', zig: 'zig', nim: 'nim',
  v: 'v', vue: 'vue', svelte: 'svelte', astro: 'astro',
}

/** Image/video extension sets used when mime_type is null (ZK-uploaded files) */
const IMAGE_EXTENSIONS_SET = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp', 'tiff', 'tif', 'svg', 'ico',
])
const VIDEO_EXTENSIONS_SET = new Set([
  'mp4', 'mov', 'avi', 'mkv', 'webm', 'm4v', 'ogv',
])

/** Extensions that should render as plain text (no syntax coloring) */
const TEXT_EXTENSIONS = new Set([
  'txt', 'log', 'csv', 'tsv', 'env', 'conf', 'ini', 'cfg', 'properties',
  'editorconfig', 'gitignore', 'gitattributes', 'dockerignore', 'npmrc',
  'nvmrc', 'prettierrc', 'eslintrc', 'babelrc',
])

/** MIME types that should render as text */
const TEXT_MIME_TYPES = new Set([
  'text/plain',
  'text/csv',
  'text/tab-separated-values',
  'text/x-log',
])

/** MIME types that should render as code */
const CODE_MIME_TYPES: Record<string, string> = {
  'text/javascript': 'javascript',
  'application/javascript': 'javascript',
  'text/typescript': 'typescript',
  'application/typescript': 'typescript',
  'text/html': 'html',
  'text/css': 'css',
  'text/xml': 'xml',
  'application/xml': 'xml',
  'application/json': 'json',
  'application/x-yaml': 'yaml',
  'text/yaml': 'yaml',
  'text/x-python': 'python',
  'text/x-java-source': 'java',
  'text/x-c': 'c',
  'text/x-c++': 'cpp',
  'text/x-rust': 'rust',
  'text/x-go': 'go',
  'text/x-shellscript': 'shell',
  'application/sql': 'sql',
  'application/toml': 'toml',
}

function getExtension(filename: string): string {
  const dot = filename.lastIndexOf('.')
  if (dot === -1) return ''
  return filename.slice(dot + 1).toLowerCase()
}

function getKindLabel(mimeType: string | null | undefined, filename: string): string {
  const ext = getExtension(filename)
  if (mimeType?.startsWith('image/')) {
    const sub = mimeType.split('/')[1]?.toUpperCase() ?? 'Image'
    return sub === 'JPEG' ? 'JPEG Image' : `${sub} Image`
  }
  if (mimeType === 'application/pdf') return 'PDF Document'
  if (mimeType?.startsWith('video/')) {
    const sub = mimeType.split('/')[1]?.toUpperCase() ?? 'Video'
    return `${sub} Video`
  }
  if (mimeType === 'text/markdown') return 'Markdown'

  if ((mimeType && TEXT_MIME_TYPES.has(mimeType)) || TEXT_EXTENSIONS.has(ext)) {
    if (ext === 'csv') return 'CSV File'
    if (ext === 'tsv') return 'TSV File'
    if (ext === 'log') return 'Log File'
    if (ext === 'env') return 'Environment File'
    if (ext === 'conf' || ext === 'ini' || ext === 'cfg') return 'Config File'
    return 'Plain Text'
  }

  const lang = (mimeType ? CODE_MIME_TYPES[mimeType] : undefined) ?? EXT_LANGUAGE[ext]
  if (lang) {
    return `${lang.charAt(0).toUpperCase() + lang.slice(1)} Source`
  }

  return mimeType ?? (ext.toUpperCase() || 'File')
}

// Image formats that no current desktop browser decodes natively.
// These fall through to the "preview not available" fallback so the user
// gets a download prompt instead of a silently broken <img>.
const UNSUPPORTED_IMAGE_MIMES = new Set([
  'image/heic',
  'image/heif',
  'image/heic-sequence',
  'image/heif-sequence',
])
const UNSUPPORTED_IMAGE_EXTS = new Set(['heic', 'heif'])

function pickRenderer(
  mimeType: string | null | undefined,
  blob: Blob,
  filename: string,
): React.ReactNode {
  const ext = getExtension(filename)
  if (mimeType?.startsWith('image/') || IMAGE_EXTENSIONS_SET.has(ext)) {
    if (UNSUPPORTED_IMAGE_MIMES.has(mimeType ?? '') || UNSUPPORTED_IMAGE_EXTS.has(ext)) {
      return null
    }
    return <ImagePreview blob={blob} />
  }
  if (mimeType === 'application/pdf' || ext === 'pdf') {
    return <PdfPreview blob={blob} />
  }
  if (mimeType?.startsWith('video/') || VIDEO_EXTENSIONS_SET.has(ext)) {
    return <VideoPreview blob={blob} />
  }
  if (mimeType === 'text/markdown' || ext === 'md' || ext === 'mdx') {
    return <MarkdownPreview blob={blob} />
  }

  // Code files — text preview with syntax coloring
  const lang = (mimeType ? CODE_MIME_TYPES[mimeType] : undefined) ?? EXT_LANGUAGE[ext]
  if (lang) {
    return <TextPreview blob={blob} language={lang} filename={filename} />
  }

  // Plain text files
  if ((mimeType ? TEXT_MIME_TYPES.has(mimeType) : false) || TEXT_EXTENSIONS.has(ext)) {
    return <TextPreview blob={blob} filename={filename} />
  }

  return null
}

export function FilePreview({ file, decryptedName: decryptedNameProp, onClose, onVersionRestored }: FilePreviewProps) {
  const { getFileKey, isUnlocked } = useKeys()
  const [blob, setBlob] = useState<Blob | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [localDecryptedName, setLocalDecryptedName] = useState<string | null>(null)

  // Version state — only populated for files with > 1 version.
  const [versions, setVersions] = useState<FileVersion[] | null>(null)
  const [currentVersionNumber, setCurrentVersionNumber] = useState<number>(file.version_number ?? 1)
  // null = viewing the live current version; otherwise a historical version id.
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null)
  const [versionLoading, setVersionLoading] = useState(false)
  // Bumped on every successful blob swap so the canvas key changes and
  // the renderer re-mounts with the decrypt-fade-in animation.
  const [renderKey, setRenderKey] = useState(0)

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

  // Fetch the version list once per file (only if there's actually history).
  useEffect(() => {
    if (!isUnlocked) return
    if ((file.version_number ?? 1) <= 1) {
      setVersions(null)
      return
    }
    let cancelled = false
    listVersions(file.id)
      .then((res) => {
        if (cancelled) return
        setVersions(res.versions)
        setCurrentVersionNumber(res.current_version)
      })
      .catch(() => {
        if (!cancelled) setVersions(null)
      })
    return () => { cancelled = true }
  }, [file.id, file.version_number, isUnlocked])

  // Load + decrypt content for the current selection (null = live version).
  useEffect(() => {
    let cancelled = false
    setBlob(null)
    setError(null)
    if (!isUnlocked) return

    async function loadAndDecrypt() {
      try {
        const fileKey = await getFileKey(file.id)
        let plaintext: Blob
        if (selectedVersionId === null) {
          const res = await decryptToBlob(
            file.id,
            fileKey,
            file.name_encrypted,
            file.mime_type ?? undefined,
            file.chunk_count,
            file.size_bytes,
          )
          plaintext = res.plaintext
        } else {
          const v = versions?.find((x) => x.id === selectedVersionId)
          if (!v) throw new Error('Version not found')
          setVersionLoading(true)
          plaintext = await decryptVersionToBlob(
            file.id,
            v.id,
            fileKey,
            file.mime_type ?? undefined,
            v.chunk_count,
            v.size_bytes,
          )
        }
        if (!cancelled) {
          setBlob(plaintext)
          setRenderKey((k) => k + 1)
        }
      } catch (err: unknown) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : 'Failed to load file')
      } finally {
        if (!cancelled) setVersionLoading(false)
      }
    }
    loadAndDecrypt()

    return () => {
      cancelled = true
    }
  }, [file.id, file.name_encrypted, file.mime_type, file.chunk_count, file.size_bytes, isUnlocked, getFileKey, selectedVersionId, versions])

  const handleRestore = useCallback(async () => {
    if (selectedVersionId === null) return
    if (!confirm('Restore this version? The current version becomes a previous one.')) return
    try {
      await restoreVersion(file.id, selectedVersionId)
      // After restore: refetch versions, snap back to live.
      const res = await listVersions(file.id)
      setVersions(res.versions)
      setCurrentVersionNumber(res.current_version)
      setSelectedVersionId(null)
      onVersionRestored?.()
    } catch {
      setError('Restore failed. The version may have been deleted.')
    }
  }, [file.id, selectedVersionId, onVersionRestored])

  const sizeStr = formatSize(file.size_bytes)
  const kindLabel = getKindLabel(file.mime_type, name)
  const renderer = blob ? pickRenderer(file.mime_type, blob, name) : null
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
      kind={file.mime_type ?? ''}
      size={sizeStr}
      onClose={onClose}
      decrypted={!!blob}
      belowTopBar={
        versions && versions.length > 1 ? (
          <VersionScrubber
            versions={versions}
            currentVersionNumber={currentVersionNumber}
            selectedVersionId={selectedVersionId}
            onSelect={setSelectedVersionId}
            onRestore={handleRestore}
            loading={versionLoading}
          />
        ) : undefined
      }
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

      {/* Actual preview — keyed on renderKey so each blob swap (initial
          load, version switch) triggers a fresh fade-in animation. */}
      {renderer && (
        <div key={renderKey} className="decrypt-fade-in flex h-full w-full items-center justify-center">
          {renderer}
        </div>
      )}
    </PreviewChrome>
  )
}
