// ─── MIME from file name ───────────────────────────
// The fallback when a row carries no MIME type (ZK uploads). Moved out of
// drive.tsx unchanged.

/** The MIME type a name's extension implies, or null when it says nothing known. */
export function inferMimeFromName(name: string): string | null {
  const ext = name.toLowerCase().split('.').pop()
  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'png':
      return 'image/png'
    case 'webp':
      return 'image/webp'
    case 'gif':
      return 'image/gif'
    case 'heic':
      return 'image/heic'
    case 'heif':
      return 'image/heif'
    case 'pdf':
      return 'application/pdf'
    case 'txt':
      return 'text/plain'
    case 'md':
      return 'text/markdown'
    case 'csv':
      return 'text/csv'
    case 'json':
      return 'application/json'
    case 'docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    case 'xlsx':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    case 'mp4':
      return 'video/mp4'
    case 'mov':
      return 'video/quicktime'
    default:
      return null
  }
}
