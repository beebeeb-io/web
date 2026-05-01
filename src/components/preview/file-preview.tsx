import { useEffect, useState } from 'react'
import { type DriveFile } from '../../lib/api'
import { decryptToBlob } from '../../lib/encrypted-download'
import { PreviewChrome } from './preview-chrome'
import { InfoRail } from './info-rail'
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

function getKindLabel(mimeType: string, filename: string): string {
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

  const ext = getExtension(filename)

  if (TEXT_MIME_TYPES.has(mimeType) || TEXT_EXTENSIONS.has(ext)) {
    if (ext === 'csv') return 'CSV File'
    if (ext === 'tsv') return 'TSV File'
    if (ext === 'log') return 'Log File'
    if (ext === 'env') return 'Environment File'
    if (ext === 'conf' || ext === 'ini' || ext === 'cfg') return 'Config File'
    return 'Plain Text'
  }

  const lang = CODE_MIME_TYPES[mimeType] ?? EXT_LANGUAGE[ext]
  if (lang) {
    return `${lang.charAt(0).toUpperCase() + lang.slice(1)} Source`
  }

  return mimeType
}

function pickRenderer(
  mimeType: string,
  blob: Blob,
  filename: string,
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
  if (mimeType === 'text/markdown') {
    return <MarkdownPreview blob={blob} />
  }

  const ext = getExtension(filename)

  // Code files — text preview with syntax coloring
  const lang = CODE_MIME_TYPES[mimeType] ?? EXT_LANGUAGE[ext]
  if (lang) {
    return <TextPreview blob={blob} language={lang} />
  }

  // Plain text files
  if (TEXT_MIME_TYPES.has(mimeType) || TEXT_EXTENSIONS.has(ext)) {
    return <TextPreview blob={blob} />
  }

  // Markdown extension even if mime is wrong
  if (ext === 'md' || ext === 'mdx') {
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

    if (!isUnlocked) return

    async function loadAndDecrypt() {
      try {
        const fileKey = await getFileKey(file.id)
        const { plaintext } = await decryptToBlob(
          file.id,
          fileKey,
          file.name_encrypted,
          file.mime_type,
          file.chunk_count,
          file.size_bytes,
        )
        if (!cancelled) setBlob(plaintext)
      } catch (err: unknown) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : 'Failed to load file')
      }
    }
    loadAndDecrypt()

    return () => {
      cancelled = true
    }
  }, [file.id, file.name_encrypted, file.mime_type, file.chunk_count, file.size_bytes, isUnlocked, getFileKey])

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
