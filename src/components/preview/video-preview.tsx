import { useEffect, useRef, useState } from 'react'

interface VideoPreviewProps {
  blob: Blob
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export function VideoPreview({ blob }: VideoPreviewProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)

  useEffect(() => {
    const objectUrl = URL.createObjectURL(blob)
    setUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [blob])

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0

  function togglePlay() {
    const video = videoRef.current
    if (!video) return
    if (video.paused) {
      video.play()
    } else {
      video.pause()
    }
  }

  function handleSeek(e: React.MouseEvent<HTMLDivElement>) {
    const video = videoRef.current
    if (!video || !duration) return
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    video.currentTime = ratio * duration
  }

  if (!url) return null

  return (
    <div
      className="relative w-full overflow-hidden rounded-md"
      style={{
        maxWidth: 640,
        aspectRatio: '16/9',
        boxShadow: '0 20px 60px -10px rgba(0,0,0,0.4)',
      }}
    >
      <video
        ref={videoRef}
        src={url}
        className="h-full w-full object-contain bg-black"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={() => setCurrentTime(videoRef.current?.currentTime ?? 0)}
        onLoadedMetadata={() => setDuration(videoRef.current?.duration ?? 0)}
        onClick={togglePlay}
      />

      {/* Play button overlay */}
      {!playing && (
        <button
          type="button"
          onClick={togglePlay}
          className="absolute left-1/2 top-1/2 flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-[1.5px] border-white/80 bg-black/50 backdrop-blur-sm transition-transform hover:scale-105"
        >
          <div
            className="ml-1"
            style={{
              width: 0,
              height: 0,
              borderTop: '12px solid transparent',
              borderBottom: '12px solid transparent',
              borderLeft: '18px solid white',
            }}
          />
        </button>
      )}

      {/* Controls bar */}
      <div
        className="absolute inset-x-0 bottom-0 p-3.5"
        style={{
          background: 'linear-gradient(0deg, rgba(0,0,0,0.7), transparent)',
        }}
      >
        {/* Seek bar */}
        <div
          className="mb-2 flex cursor-pointer items-center gap-1"
          onClick={handleSeek}
          role="slider"
          aria-valuenow={currentTime}
          aria-valuemin={0}
          aria-valuemax={duration}
          tabIndex={0}
        >
          <div className="relative h-[3px] flex-1 rounded-sm bg-white/20">
            <div
              className="absolute inset-y-0 left-0 rounded-sm bg-amber"
              style={{ width: `${progress}%` }}
            />
            <div
              className="absolute top-1/2 h-[11px] w-[11px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber"
              style={{ left: `${progress}%` }}
            />
          </div>
        </div>

        {/* Time display */}
        <div className="flex items-center gap-2.5 text-paper">
          <span className="font-mono text-[11px]">
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>
        </div>
      </div>
    </div>
  )
}
