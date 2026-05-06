import { useState, useEffect, useCallback } from 'react'
import { SettingsShell, SettingsHeader } from '../../components/settings-shell'
import { Icon } from '../../components/icons'
import { useToast } from '../../components/toast'
import {
  getUserRegion,
  setUserRegion,
  ApiError,
  type AvailableRegion,
} from '../../lib/api'

// ── Helpers ───────────────────────────────────────────────────────────────────

function countryFromCity(city: string): string {
  const map: Record<string, string> = {
    falkenstein: 'Germany',
    helsinki: 'Finland',
    amsterdam: 'Netherlands',
    ede: 'Netherlands',
    frankfurt: 'Germany',
    paris: 'France',
    warsaw: 'Poland',
  }
  return map[city.toLowerCase()] ?? ''
}

// ── Region card ───────────────────────────────────────────────────────────────

interface RegionCardProps {
  region: AvailableRegion
  selected: boolean
  disabled: boolean
  onClick: () => void
}

function RegionCard({ region, selected, disabled, onClick }: RegionCardProps) {
  const country = countryFromCity(region.city)
  const locationLabel = country ? `${region.city}, ${country}` : region.city

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`w-full text-left flex items-start gap-3.5 px-4 py-3.5 rounded-lg border transition-all ${
        selected
          ? 'border-amber-deep bg-amber-bg ring-1 ring-amber/30 cursor-default'
          : disabled
            ? 'border-line bg-paper-2 opacity-50 cursor-default'
            : 'border-line bg-paper hover:border-line-2 hover:bg-paper-2 cursor-pointer'
      }`}
    >
      {/* Radio indicator */}
      <span
        className={`mt-0.5 w-4 h-4 rounded-full border-[1.5px] flex items-center justify-center shrink-0 ${
          selected ? 'border-amber-deep bg-amber' : 'border-line-2'
        }`}
      >
        {selected && <span className="w-1.5 h-1.5 rounded-full bg-ink" />}
      </span>

      {/* Text */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-[14px] font-semibold ${selected ? 'text-ink' : 'text-ink-2'}`}>
            {region.display_name}
          </span>
          {region.is_default && (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-paper-2 border border-line text-ink-4 leading-none">
              Default
            </span>
          )}
        </div>
        <div className="text-[12px] text-ink-3 mt-0.5 font-mono">
          {locationLabel} · {region.provider}
        </div>
      </div>

      {/* Selected checkmark */}
      {selected && (
        <Icon name="check" size={13} className="text-amber-deep mt-0.5 shrink-0" />
      )}
    </button>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function SettingsDataResidency() {
  const { showToast } = useToast()
  const [regions, setRegions] = useState<AvailableRegion[]>([])
  const [preferred, setPreferred] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [endpointMissing, setEndpointMissing] = useState(false)

  useEffect(() => {
    let cancelled = false
    getUserRegion()
      .then(data => {
        if (cancelled) return
        setRegions(data.regions ?? [])
        setPreferred(data.preferred_region ?? null)
      })
      .catch(err => {
        if (cancelled) return
        if (err instanceof ApiError && err.status === 404) {
          setEndpointMissing(true)
        }
        // Fall back to empty — page still renders gracefully
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  const handleSelect = useCallback(async (continent: string) => {
    if (continent === preferred || saving) return
    setSaving(true)
    const prev = preferred
    setPreferred(continent) // optimistic
    try {
      const result = await setUserRegion(continent)
      setPreferred(result.preferred_region)
      showToast({ icon: 'check', title: 'Region updated', description: 'New uploads will go to your preferred region.' })
    } catch (err) {
      setPreferred(prev) // roll back
      showToast({
        icon: 'x',
        title: 'Failed to save region',
        description: err instanceof Error ? err.message : 'Please try again.',
        danger: true,
      })
    } finally {
      setSaving(false)
    }
  }, [preferred, saving, showToast])

  const effectiveRegion = preferred ?? regions.find(r => r.is_default)?.continent ?? null
  const onlyOneRegion = regions.length <= 1

  return (
    <SettingsShell activeSection="data-residency">
      <SettingsHeader
        title="Data Residency"
        subtitle="Choose where your files are stored. New uploads go to your preferred region."
      />

      {loading ? (
        <div className="px-7 py-6 flex items-center gap-2 text-ink-3">
          <span className="w-3.5 h-3.5 border-2 border-line-2 border-t-ink-3 rounded-full animate-spin shrink-0" />
          <span className="text-[13px]">Loading regions…</span>
        </div>
      ) : (
        <>
          {/* Endpoint not deployed yet */}
          {endpointMissing && (
            <div className="mx-7 mt-4 flex items-start gap-2.5 p-3 rounded-lg border border-line bg-paper-2">
              <Icon name="cloud" size={13} className="text-ink-3 shrink-0 mt-0.5" />
              <p className="text-[12px] text-ink-3 leading-relaxed">
                Region selection requires the latest server update. Contact support if this persists.
              </p>
            </div>
          )}

          {/* Region list */}
          <div className="px-7 mt-5">
            {regions.length === 0 && !endpointMissing ? (
              <p className="text-[13px] text-ink-3">No regions available.</p>
            ) : (
              <>
                <div className="flex flex-col gap-2.5">
                  {regions.map(region => (
                    <RegionCard
                      key={region.continent}
                      region={region}
                      selected={effectiveRegion === region.continent}
                      disabled={saving || onlyOneRegion}
                      onClick={() => void handleSelect(region.continent)}
                    />
                  ))}
                </div>

                {/* Single-region note */}
                {onlyOneRegion && regions.length > 0 && (
                  <p className="text-[12px] text-ink-4 mt-3 leading-relaxed">
                    More regions coming soon. Your files are stored in {regions[0]?.city ?? 'Europe'}.
                  </p>
                )}
              </>
            )}
          </div>

          {/* Bottom note */}
          {regions.length > 0 && (
            <div className="px-7 mt-5 pb-6">
              <div className="flex items-start gap-2.5 p-3 rounded-lg bg-paper-2 border border-line">
                <Icon name="shield" size={13} className="text-amber-deep shrink-0 mt-0.5" />
                <div className="text-[12px] text-ink-3 leading-relaxed">
                  <strong className="text-ink-2">Existing files stay where they are.</strong>{' '}
                  Only new uploads use your preferred region. All regions are in the EU — Hetzner data centers, governed by EU law.
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </SettingsShell>
  )
}
