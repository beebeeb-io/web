import { EmptyState } from './empty-state'

interface EmptyPhotosProps {
  onUpload: () => void
  onGoToDrive: () => void
}

export function EmptyPhotos({ onUpload, onGoToDrive }: EmptyPhotosProps) {
  return (
    <EmptyState
      icon="image"
      heading="No photos yet"
      subtitle="Upload images and videos to your drive and they will appear here automatically. Supports JPG, PNG, GIF, WebP, HEIC, AVIF, and more."
      cta={{
        label: 'Upload photos',
        icon: 'upload',
        onClick: onUpload,
      }}
      secondaryCta={{
        label: 'Go to drive',
        icon: 'folder',
        onClick: onGoToDrive,
      }}
      hint="EXIF data and GPS coordinates are stripped before encryption."
    />
  )
}
