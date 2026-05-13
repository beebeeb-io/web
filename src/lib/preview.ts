const PREVIEWABLE_EXTENSIONS = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif', 'heic', 'tiff', 'tif',
  'mp4', 'mov', 'webm', 'mkv',
  'txt', 'md', 'csv', 'json', 'xml', 'html', 'css', 'js', 'ts', 'py', 'rs', 'go', 'sh',
  'pdf',
])

export function isPreviewable(mimeType: string | null | undefined, fileName?: string | null): boolean {
  if (mimeType) {
    return (
      mimeType.startsWith('image/') ||
      mimeType.startsWith('video/') ||
      mimeType.startsWith('text/') ||
      mimeType === 'application/pdf' ||
      mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    )
  }
  if (fileName) {
    const ext = fileName.split('.').pop()?.toLowerCase()
    if (ext && PREVIEWABLE_EXTENSIONS.has(ext)) return true
  }
  return false
}
