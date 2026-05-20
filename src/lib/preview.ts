const PREVIEWABLE_EXTENSIONS = new Set([
  // Images (native browser + HEIC via heic2any)
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif', 'heic', 'heif', 'tiff', 'tif',
  // Camera RAW (download-only preview card)
  'dng', 'cr2', 'cr3', 'nef', 'arw', 'orf', 'rw2', 'raf',
  // Video (including HEVC)
  'mp4', 'mov', 'webm', 'mkv', 'hevc',
  // Text / code
  'txt', 'md', 'csv', 'json', 'xml', 'html', 'css', 'js', 'ts', 'py', 'rs', 'go', 'sh',
  // Documents
  'pdf', 'docx', 'xlsx',
  // Presentations (download-only preview card)
  'pptx', 'ppt', 'odp', 'key',
])

export function isPreviewable(mimeType: string | null | undefined, fileName?: string | null): boolean {
  if (mimeType) {
    return (
      mimeType.startsWith('image/') ||
      mimeType.startsWith('video/') ||
      mimeType.startsWith('text/') ||
      mimeType === 'application/pdf' ||
      mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
      mimeType === 'application/vnd.ms-powerpoint'
    )
  }
  if (fileName) {
    const ext = fileName.split('.').pop()?.toLowerCase()
    if (ext && PREVIEWABLE_EXTENSIONS.has(ext)) return true
  }
  return false
}
