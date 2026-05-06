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
      subtitle="Upload photos or enable camera backup on mobile."
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
