import { useState, useCallback } from 'react'
import { BBButton } from '../components/bb-button'
import { BBChip } from '../components/bb-chip'
import { Icon } from '../components/icons'
import { DriveLayout } from '../components/drive-layout'
import { useToast } from '../components/toast'
import { setPreference, getPreference } from '../lib/api'

interface MigrationSource {
  id: string
  name: string
  icon: string
  description: string
}

const SOURCES: MigrationSource[] = [
  { id: 'google_drive', name: 'Google Drive', icon: 'cloud', description: 'Import files from Google Drive' },
  { id: 'dropbox', name: 'Dropbox', icon: 'cloud', description: 'Import files from Dropbox' },
  { id: 'onedrive', name: 'OneDrive', icon: 'cloud', description: 'Import files from Microsoft OneDrive' },
  { id: 'icloud', name: 'iCloud Drive', icon: 'cloud', description: 'Import files from Apple iCloud' },
  { id: 'filen', name: 'Filen', icon: 'lock', description: 'Migrate from Filen encrypted storage' },
]

export function Migration() {
  const { showToast } = useToast()
  const [interested, setInterested] = useState<Set<string>>(new Set())

  useState(() => {
    getPreference<{ sources: string[] }>('migration_interest')
      .then((pref) => {
        if (pref?.sources) setInterested(new Set(pref.sources))
      })
      .catch(() => {})
  })

  const toggleInterest = useCallback(async (sourceId: string) => {
    const next = new Set(interested)
    if (next.has(sourceId)) {
      next.delete(sourceId)
    } else {
      next.add(sourceId)
    }
    setInterested(next)
    try {
      await setPreference('migration_interest', { sources: Array.from(next) })
      if (next.has(sourceId)) {
        showToast({ icon: 'check', title: `We'll notify you when ${SOURCES.find(s => s.id === sourceId)?.name} import is ready` })
      }
    } catch {
      showToast({ icon: 'x', title: 'Failed to save preference', danger: true })
    }
  }, [interested, showToast])

  return (
    <DriveLayout>
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="max-w-2xl">
          <h2 className="text-xl font-bold text-ink mb-1">Import your files</h2>
          <p className="text-sm text-ink-3 mb-6">
            Bring your files from other cloud providers into your encrypted vault.
          </p>

          <div className="bg-amber-bg border border-amber-deep/30 rounded-xl p-4 mb-6">
            <div className="flex items-start gap-3">
              <Icon name="lock" size={16} className="text-amber-deep mt-0.5 shrink-0" />
              <div>
                <div className="text-sm font-semibold text-ink mb-1">CLI migration available now</div>
                <p className="text-[13px] text-ink-2 leading-relaxed">
                  Use <code className="font-mono text-[12px] bg-paper px-1.5 py-0.5 rounded border border-line">bb push ~/Google\ Drive/</code> to
                  recursively upload and encrypt any local folder. Download your files from your current provider first, then push them to Beebeeb.
                </p>
                <a
                  href="https://beebeeb.io/docs/cli"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[12px] text-amber-deep font-medium mt-2 hover:underline"
                >
                  CLI documentation
                  <Icon name="chevron-right" size={10} />
                </a>
              </div>
            </div>
          </div>

          <h3 className="text-sm font-semibold text-ink mb-3">Direct import (coming soon)</h3>
          <p className="text-[13px] text-ink-3 mb-4">
            We're building direct import from cloud providers. Let us know which ones matter to you — we'll build the most requested ones first.
          </p>

          <div className="grid gap-2">
            {SOURCES.map((source) => {
              const isInterested = interested.has(source.id)
              return (
                <div
                  key={source.id}
                  className={`flex items-center gap-3 px-4 py-3 rounded-lg border transition-colors ${
                    isInterested
                      ? 'border-amber-deep bg-amber-bg'
                      : 'border-line bg-paper hover:bg-paper-2'
                  }`}
                >
                  <div className="w-8 h-8 rounded-md bg-paper-2 border border-line flex items-center justify-center">
                    <Icon name={source.icon as 'cloud' | 'lock'} size={14} className="text-ink-2" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-medium text-ink">{source.name}</div>
                    <div className="text-[11px] text-ink-3">{source.description}</div>
                  </div>
                  {isInterested ? (
                    <BBChip variant="amber">
                      <Icon name="check" size={10} className="mr-1" />
                      Interested
                    </BBChip>
                  ) : (
                    <BBButton
                      size="sm"
                      variant="ghost"
                      onClick={() => toggleInterest(source.id)}
                    >
                      Notify me
                    </BBButton>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </DriveLayout>
  )
}
