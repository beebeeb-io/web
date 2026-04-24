import { useCallback, useState } from 'react'
import type { DriveFile } from '../lib/api'

interface UseFilePreviewReturn {
  previewFile: DriveFile | null
  openPreview: (file: DriveFile) => void
  closePreview: () => void
}

export function useFilePreview(): UseFilePreviewReturn {
  const [previewFile, setPreviewFile] = useState<DriveFile | null>(null)

  const openPreview = useCallback((file: DriveFile) => {
    setPreviewFile(file)
  }, [])

  const closePreview = useCallback(() => {
    setPreviewFile(null)
  }, [])

  return { previewFile, openPreview, closePreview }
}
