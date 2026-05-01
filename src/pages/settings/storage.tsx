import { useState, useEffect, useCallback } from 'react'
import { SettingsShell, SettingsHeader, SettingsRow } from '../../components/settings-shell'
import { Icon } from '../../components/icons'
import { BBButton } from '../../components/bb-button'
import { useToast } from '../../components/toast'
import { getPreference, setPreference, getStorageUsage, type StorageUsage } from '../../lib/api'

interface StorageRegion {
  id: string
  city: string
  country: string
  provider: string
  available: boolean
}

const regions: StorageRegion[] = [
  { id: 'frankfurt', city: 'Frankfurt', country: 'DE', provider: 'Hetzner', available: true },
  { id: 'amsterdam', city: 'Amsterdam', country: 'NL', provider: 'Leaseweb', available: true },
  { id: 'paris', city: 'Paris', country: 'FR', provider: 'Scaleway', available: false },
]

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes < 1024 * 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
  return `${(bytes / (1024 * 1024 * 1024 * 1024)).toFixed(1)} TB`
}

export function SettingsStorage() {
  const { showToast } = useToast()
  const [selectedRegion, setSelectedRegion] = useState('frankfurt')
  const [savedRegion, setSavedRegion] = useState('frankfurt')
  const [usage, setUsage] = useState<StorageUsage | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const [pref, usageData] = await Promise.all([
          getPreference<{ pool_name: string }>('storage_region').catch(() => null),
          getStorageUsage().catch(() => null),
        ])
        if (pref?.pool_name) {
          setSelectedRegion(pref.pool_name)
          setSavedRegion(pref.pool_name)
        }
        if (usageData) {
          setUsage(usageData)
        }
      } catch {
        // defaults are fine
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [])

  const hasChanges = selectedRegion !== savedRegion

  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      await setPreference('storage_region', { pool_name: selectedRegion })
      setSavedRegion(selectedRegion)
      showToast({ icon: 'check', title: 'Storage region saved' })
    } catch {
      showToast({ icon: 'x', title: 'Failed to save region', danger: true })
    } finally {
      setSaving(false)
    }
  }, [selectedRegion, showToast])

  const usedPct = usage
    ? Math.min(100, (usage.used_bytes / usage.plan_limit_bytes) * 100)
    : 0

  return (
    <SettingsShell activeSection="storage">
      <SettingsHeader
        title="Storage & data"
        subtitle="Manage your storage usage and choose where new uploads are stored."
      />

      {/* Usage bar */}
      <SettingsRow label="Usage" hint="Encrypted storage used across all regions.">
        {loading ? (
          <div className="h-10 flex items-center">
            <span className="text-[12.5px] text-ink-3">Loading...</span>
          </div>
        ) : usage ? (
          <div className="max-w-[400px]">
            <div className="flex items-baseline justify-between mb-1.5">
              <span className="text-sm font-semibold text-ink">
                {formatBytes(usage.used_bytes)}
              </span>
              <span className="text-[12px] text-ink-3">
                of {formatBytes(usage.plan_limit_bytes)} ({usage.plan_name})
              </span>
            </div>
            <div className="h-2 rounded-full bg-paper-3 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${usedPct}%`,
                  background: usedPct > 90
                    ? 'oklch(0.65 0.2 25)'
                    : 'oklch(0.82 0.17 84)',
                }}
              />
            </div>
            <div className="text-[11px] text-ink-4 mt-1">
              {usedPct.toFixed(1)}% used
            </div>
          </div>
        ) : (
          <span className="text-[12.5px] text-ink-3">Could not load usage data.</span>
        )}
      </SettingsRow>

      {/* Region selector */}
      <SettingsRow
        label="Storage region"
        hint="New uploads go to your selected region. Existing files stay where they are."
      >
        <div className="grid gap-2 max-w-[460px]">
          {regions.map((region) => {
            const isActive = region.id === selectedRegion
            return (
              <button
                key={region.id}
                type="button"
                disabled={!region.available}
                onClick={() => region.available && setSelectedRegion(region.id)}
                className={`flex items-center gap-3 px-3.5 py-3 rounded-md border text-left transition-colors ${
                  isActive
                    ? 'border-amber-deep bg-amber-bg cursor-default'
                    : region.available
                      ? 'border-line bg-paper hover:bg-paper-2 cursor-pointer'
                      : 'border-line bg-paper-2 opacity-50 cursor-not-allowed'
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`text-[13px] ${isActive ? 'font-semibold' : ''}`}>
                      {region.city} {region.country}
                    </span>
                    <span className="text-[11px] text-ink-4 font-mono">
                      {region.provider}
                    </span>
                  </div>
                </div>
                {isActive && (
                  <Icon name="check" size={12} className="text-amber-deep shrink-0" />
                )}
                {!region.available && (
                  <span className="text-[10px] font-medium text-ink-4 uppercase tracking-wider shrink-0">
                    Coming soon
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </SettingsRow>

      {/* Version history link */}
      <SettingsRow
        label="Version history"
        hint="Control how many versions are kept and for how long."
      >
        <a
          href="/security"
          className="inline-flex items-center gap-1.5 text-[13px] text-ink-2 hover:text-ink transition-colors"
        >
          Manage version settings
          <Icon name="chevron-right" size={10} className="text-ink-3" />
        </a>
      </SettingsRow>

      {/* Save button */}
      {hasChanges && (
        <div className="flex justify-end px-7 py-4">
          <BBButton variant="amber" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save changes'}
          </BBButton>
        </div>
      )}
    </SettingsShell>
  )
}
