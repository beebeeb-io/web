import { Icon } from './icons'

type FileType = 'folder' | 'pdf' | 'doc' | 'image' | 'zip' | 'md' | 'fig' | 'default'

interface FileIconProps {
  type: FileType
  size?: number
}

const colorMap: Record<FileType, string> = {
  folder: 'var(--color-amber)',
  pdf: '#e85a4f',
  doc: '#3b82f6',
  image: '#16a34a',
  zip: '#64748b',
  md: '#0f766e',
  fig: '#a855f7',
  default: 'var(--color-ink-3)',
}

const bgMap: Record<FileType, string> = {
  folder: 'var(--color-amber-bg)',
  pdf: 'var(--color-paper-2)',
  doc: 'var(--color-paper-2)',
  image: 'var(--color-paper-2)',
  zip: 'var(--color-paper-2)',
  md: 'var(--color-paper-2)',
  fig: 'var(--color-paper-2)',
  default: 'var(--color-paper-2)',
}

export function getFileType(name: string, isFolder: boolean): FileType {
  if (isFolder) return 'folder'
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'pdf') return 'pdf'
  if (['doc', 'docx'].includes(ext)) return 'doc'
  if (['jpg', 'jpeg', 'png', 'gif', 'heic', 'webp', 'svg'].includes(ext)) return 'image'
  if (['zip', 'tar', 'gz', 'rar', '7z'].includes(ext)) return 'zip'
  if (['md', 'mdx'].includes(ext)) return 'md'
  if (['fig', 'figma'].includes(ext)) return 'fig'
  return 'default'
}

export function FileIcon({ type, size = 24 }: FileIconProps) {
  const iconSize = Math.round(size * 0.54)
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-md border border-line"
      style={{
        width: size,
        height: size,
        background: bgMap[type],
        color: colorMap[type],
      }}
    >
      <Icon name={type === 'folder' ? 'folder' : 'file'} size={iconSize} />
    </div>
  )
}
