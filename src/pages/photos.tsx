import { useState } from 'react'
import { BBButton } from '../components/bb-button'
import { DriveLayout } from '../components/drive-layout'
import { Icon } from '../components/icons'

// ─── Mock photo data ────────────────────────────

interface PhotoGroup {
  date: string
  place: string | null
  items: PhotoItem[]
}

interface PhotoItem {
  id: string
  isVideo: boolean
  duration: string | null
  isShared: boolean
  isFeatured: boolean
}

const MOCK_GROUPS: PhotoGroup[] = [
  {
    date: 'Monday · Apr 14',
    place: 'Lisbon',
    items: Array.from({ length: 10 }, (_, i) => ({
      id: `g0-${i}`,
      isVideo: i === 7,
      duration: i === 7 ? '0:34' : null,
      isShared: i === 1,
      isFeatured: i === 3,
    })),
  },
  {
    date: 'Sunday · Apr 6',
    place: 'Paris',
    items: Array.from({ length: 8 }, (_, i) => ({
      id: `g1-${i}`,
      isVideo: i === 4,
      duration: i === 4 ? '1:12' : null,
      isShared: i === 0 || i === 6,
      isFeatured: false,
    })),
  },
  {
    date: 'Apr 1 — Mar 28',
    place: null,
    items: Array.from({ length: 12 }, (_, i) => ({
      id: `g2-${i}`,
      isVideo: i === 2,
      duration: i === 2 ? '2:05' : null,
      isShared: false,
      isFeatured: i === 5,
    })),
  },
  {
    date: 'March 2025',
    place: null,
    items: Array.from({ length: 18 }, (_, i) => ({
      id: `g3-${i}`,
      isVideo: i === 11,
      duration: i === 11 ? '0:48' : null,
      isShared: i === 3 || i === 9,
      isFeatured: i === 0,
    })),
  },
  {
    date: 'September 2025',
    place: null,
    items: Array.from({ length: 42 }, (_, i) => ({
      id: `g4-${i}`,
      isVideo: i === 5 || i === 22 || i === 37,
      duration: i === 5 ? '0:15' : i === 22 ? '3:41' : i === 37 ? '0:58' : null,
      isShared: i % 11 === 0,
      isFeatured: i === 2 || i === 19,
    })),
  },
]

// ─── Deterministic warm gradient for placeholders ─

function placeholderGradient(index: number): string {
  const hues = [55, 65, 42, 75, 50, 60, 48, 70, 58, 44]
  const chromas = [0.14, 0.16, 0.18, 0.12, 0.15, 0.17, 0.13, 0.19, 0.14, 0.16]
  const lightA = [0.88, 0.84, 0.86, 0.90, 0.82, 0.87, 0.85, 0.89, 0.83, 0.86]
  const lightB = [0.72, 0.68, 0.70, 0.74, 0.66, 0.71, 0.69, 0.73, 0.67, 0.70]
  const i = index % 10
  return `linear-gradient(135deg, oklch(${lightA[i]} ${chromas[i]} ${hues[i]}), oklch(${lightB[i]} ${chromas[(i + 3) % 10]} ${hues[(i + 5) % 10]}))`
}

// ─── Tab selector ───────────────────────────────

const TABS = ['All', 'Albums', 'People', 'Places'] as const

// ─── Date range options ─────────────────────────

const DATE_RANGES = ['Last 7 days', 'Last 30 days', 'Last 3 months', 'All time'] as const

// ─── Photos page ────────────────────────────────

export function Photos() {
  const [activeTab, setActiveTab] = useState(0)
  const [dateRange, setDateRange] = useState<(typeof DATE_RANGES)[number]>('All time')
  const [dateDropdownOpen, setDateDropdownOpen] = useState(false)

  const totalItems = MOCK_GROUPS.reduce((sum, g) => sum + g.items.length, 0)

  return (
    <DriveLayout>
        {/* Header */}
        <div className="px-5 py-3 border-b border-line flex items-center gap-3">
          <Icon name="image" size={15} />
          <div>
            <div className="text-sm font-semibold text-ink">Photos</div>
            <div className="text-[11px] text-ink-3">
              <span className="font-mono tabular-nums">{totalItems.toLocaleString()}</span> items
              {' -- '}
              <span className="font-mono tabular-nums">32.4 GB</span>
            </div>
          </div>

          {/* Tab selector */}
          <div
            className="ml-auto flex gap-1 p-[3px] rounded-md border border-line"
            style={{ background: 'var(--color-paper-2)' }}
          >
            {TABS.map((tab, i) => (
              <button
                key={tab}
                onClick={() => setActiveTab(i)}
                className="transition-all"
                style={{
                  padding: '4px 10px',
                  borderRadius: 4,
                  fontSize: 12,
                  background: i === activeTab ? 'var(--color-paper)' : 'transparent',
                  boxShadow: i === activeTab ? 'var(--shadow-1)' : 'none',
                  fontWeight: i === activeTab ? 600 : 400,
                  color: i === activeTab ? 'var(--color-ink)' : 'var(--color-ink-3)',
                }}
              >
                {tab}
              </button>
            ))}
          </div>

          {/* Date range selector */}
          <div className="relative">
            <BBButton
              size="sm"
              onClick={() => setDateDropdownOpen(!dateDropdownOpen)}
              className="gap-1.5"
            >
              <Icon name="clock" size={12} />
              {dateRange}
              <Icon name="chevron-down" size={10} />
            </BBButton>
            {dateDropdownOpen && (
              <div className="absolute right-0 top-full mt-1 bg-paper border border-line-2 rounded-lg shadow-2 z-20 overflow-hidden min-w-[160px]">
                {DATE_RANGES.map((range) => (
                  <button
                    key={range}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-[13px] hover:bg-paper-2 transition-colors text-left ${
                      dateRange === range ? 'font-semibold text-ink' : 'text-ink-2'
                    }`}
                    onClick={() => {
                      setDateRange(range)
                      setDateDropdownOpen(false)
                    }}
                  >
                    {dateRange === range && <Icon name="check" size={12} />}
                    <span className={dateRange !== range ? 'pl-5' : ''}>{range}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <BBButton size="sm" className="gap-1.5">
            <Icon name="upload" size={12} /> Upload
          </BBButton>
        </div>

        {/* Photo grid */}
        <div className="flex-1 overflow-y-auto px-5 py-[18px]">
          {MOCK_GROUPS.map((group, gi) => (
            <div key={gi} className="mb-6">
              {/* Group header */}
              <div className="flex items-baseline mb-2.5 gap-2.5">
                <span className="text-[13px] font-semibold text-ink">{group.date}</span>
                {group.place && (
                  <span className="text-[11px] text-ink-3">-- {group.place}</span>
                )}
                <span className="font-mono text-[11px] text-ink-4 ml-auto">
                  {group.items.length} photos
                </span>
              </div>

              {/* Grid */}
              <div className="grid gap-1" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))' }}>
                {group.items.map((photo, pi) => {
                  const globalIndex = gi * 100 + pi
                  return (
                    <div
                      key={photo.id}
                      className="relative overflow-hidden rounded-sm cursor-pointer group/cell"
                      style={{
                        aspectRatio: '1',
                        background: photo.isFeatured
                          ? placeholderGradient(globalIndex)
                          : placeholderGradient(globalIndex),
                        opacity: photo.isFeatured ? 1 : 0.85,
                      }}
                    >
                      {/* Hover overlay */}
                      <div className="absolute inset-0 bg-ink/0 group-hover/cell:bg-ink/10 transition-colors" />

                      {/* Starred badge (featured) */}
                      {photo.isFeatured && (
                        <div
                          className="absolute right-1 top-1 flex items-center justify-center"
                          style={{
                            width: 16,
                            height: 16,
                            borderRadius: 999,
                            background: 'rgba(0,0,0,0.35)',
                          }}
                        >
                          <Icon name="star" size={9} className="text-white" />
                        </div>
                      )}

                      {/* Video duration badge */}
                      {photo.isVideo && photo.duration && (
                        <div
                          className="absolute left-1 bottom-1 flex items-center gap-1 px-1.5 py-0.5 rounded"
                          style={{
                            background: 'rgba(0,0,0,0.55)',
                            fontSize: 10,
                            color: 'white',
                            fontFamily: 'var(--font-mono)',
                          }}
                        >
                          {photo.duration}
                        </div>
                      )}

                      {/* Shared indicator */}
                      {photo.isShared && (
                        <div
                          className="absolute left-1 top-1 flex items-center justify-center"
                          style={{
                            width: 16,
                            height: 16,
                            borderRadius: 999,
                            background: 'rgba(0,0,0,0.35)',
                          }}
                        >
                          <Icon name="users" size={9} className="text-white" />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Auto-backup status bar */}
        <div className="px-5 py-2 border-t border-line bg-paper-2 flex items-center gap-3.5 text-[11px] text-ink-3">
          <span className="flex items-center gap-1.5">
            <Icon name="upload" size={12} className="text-ink-3" />
            Auto-backup: 3 new -- on Wi-Fi -- 68%
          </span>
          <span>--</span>
          <span className="flex items-center gap-1.5">
            <Icon name="shield" size={12} className="text-amber-deep" />
            All photos E2E encrypted -- EXIF stripped on upload
          </span>
          <span
            className="ml-auto flex items-center gap-1.5 font-mono text-[10px]"
            title="GPS & device serial stripped before encryption"
          >
            <Icon name="lock" size={10} className="text-amber-deep" />
            GPS & device serial stripped before encryption
          </span>
        </div>
    </DriveLayout>
  )
}
