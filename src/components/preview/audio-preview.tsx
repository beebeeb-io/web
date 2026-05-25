import { useEffect, useRef, useState } from 'react'

interface AudioPreviewProps {
  blob: Blob
  filename: string
}

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export function AudioPreview({ blob, filename }: AudioPreviewProps) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const objectUrl = URL.createObjectURL(blob)
    setUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [blob])

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0
  const ext = filename.split('.').pop()?.toUpperCase() ?? 'Audio'

  function togglePlay() {
    const audio = audioRef.current
    if (!audio) return
    if (audio.paused) {
      audio.play().catch(() => setError('Playback failed'))
    } else {
      audio.pause()
    }
  }

  function handleSeek(e: React.MouseEvent<HTMLDivElement>) {
    const audio = audioRef.current
    if (!audio || !duration) return
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    audio.currentTime = ratio * duration
  }

  if (!url) return null

  return (
    <div className="flex w-full max-w-[480px] flex-col items-center gap-5">
      {/* Disc icon */}
      <div
        className="flex h-32 w-32 items-center justify-center rounded-full border border-line bg-paper-2"
        style={{ boxShadow: '0 8px 32px -8px rgba(0,0,0,0.2)' }}
      >
        <div className="flex h-20 w-20 items-center justify-center rounded-full border border-line/60 bg-paper">
          <span className="font-mono text-[11px] font-medium text-ink-3">{ext}</span>
        </div>
      </div>

      {/* Player card */}
      <div className="w-full rounded-xl border border-line bg-paper p-5" style={{ boxShadow: '0 4px 20px -4px rgba(0,0,0,0.12)' }}>
        <audio
          ref={audioRef}
          src={url}
          preload="metadata"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onTimeUpdate={() => setCurrentTime(audioRef.current?.currentTime ?? 0)}
          onLoadedMetadata={() => setDuration(audioRef.current?.duration ?? 0)}
          onError={() => setError('This audio format is not supported by your browser')}
        />

        {error ? (
          <p className="text-center text-sm text-red">{error}</p>
        ) : (
          <>
            {/* Track name */}
            <p className="mb-4 truncate text-center text-[13px] font-medium text-ink">
              {filename}
            </p>

            {/* Seek bar */}
            <div
              className="group mb-3 flex cursor-pointer items-center"
              onClick={handleSeek}
              role="slider"
              aria-label="Seek"
              aria-valuenow={currentTime}
              aria-valuemin={0}
              aria-valuemax={duration}
              tabIndex={0}
            >
              <div className="relative h-[4px] flex-1 rounded-full bg-ink/10">
                <div
                  className="absolute inset-y-0 left-0 rounded-full bg-amber"
                  style={{ width: `${progress}%` }}
                />
                <div
                  className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber opacity-0 transition-opacity group-hover:opacity-100"
                  style={{ left: `${progress}%` }}
                />
              </div>
            </div>

            {/* Time + controls */}
            <div className="flex items-center justify-between">
              <span className="font-mono text-[11px] text-ink-3">
                {formatTime(currentTime)}
              </span>

              <button
                type="button"
                onClick={togglePlay}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-amber text-paper transition-transform hover:scale-105 active:scale-95"
              >
                {playing ? (
                  <svg width="14" height="16" viewBox="0 0 14 16" fill="currentColor">
                    <rect x="1" y="0" width="4" height="16" rx="1" />
                    <rect x="9" y="0" width="4" height="16" rx="1" />
                  </svg>
                ) : (
                  <svg width="14" height="16" viewBox="0 0 14 16" fill="currentColor" className="ml-0.5">
                    <path d="M1 1.3a1 1 0 0 1 1.5-.86l11 7a1 1 0 0 1 0 1.72l-11 7A1 1 0 0 1 1 15.3V1.3Z" />
                  </svg>
                )}
              </button>

              <span className="font-mono text-[11px] text-ink-3">
                {duration > 0 ? formatTime(duration) : '--:--'}
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
