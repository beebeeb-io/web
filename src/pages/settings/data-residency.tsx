import { useState, useCallback } from 'react'
import { SettingsShell, SettingsHeader } from '../../components/settings-shell'
import { Icon, BBToggle } from '@beebeeb/shared'
import { useToast } from '../../components/toast'
import { useAuth } from '../../lib/auth-context'
import { useRegionChoices, saveRegionChoice } from '../../lib/use-region-choices'
import {
  groupChoices,
  choiceLabel,
  preferenceUnavailable,
  selectedChoiceId,
  selectedCountry,
  strictLabel,
  strictUnavailable,
  type StorageRegionChoice,
} from '../../lib/storage-regions'

// Task 1919, by COUNTRY since task 2050. The whole list comes from the API
// (`choices` of GET /me/region): "Europe" is the default (any of our European
// data centers, the server places the data); below it each country we store in,
// and the ones that are not live yet as "Coming soon". This file holds no city,
// country or id: a country that turns live changes the screen without a client
// release. A city is never shown (docs/canon/data-residency.md).

// ── Region row ────────────────────────────────────────────────────────────────

interface ChoiceRowProps {
  choice: StorageRegionChoice
  selected: boolean
  /** True while a save is in flight. */
  busy: boolean
  /** Shown under the name (the default row explains itself; a country has no subline). */
  hint?: string
  onSelect: () => void
}

function ChoiceRow({ choice, selected, busy, hint, onSelect }: ChoiceRowProps) {
  const comingSoon = choice.status === 'coming_soon'
  const unavailable = !choice.selectable
  const subline = hint ?? ''

  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-disabled={unavailable || undefined}
      data-testid={`region-${choice.id}`}
      data-status={choice.status}
      disabled={unavailable || busy}
      onClick={onSelect}
      className={`w-full text-left flex items-start gap-3.5 px-4 py-3.5 rounded-lg border transition-all ${
        selected
          ? 'border-amber-deep bg-amber-bg ring-1 ring-amber/30 cursor-default'
          : unavailable
            ? 'border-line bg-paper-2 opacity-60 cursor-not-allowed'
            : 'border-line bg-paper hover:border-line-2 hover:bg-paper-2 cursor-pointer'
      }`}
    >
      <span
        className={`mt-0.5 w-4 h-4 rounded-full border-[1.5px] flex items-center justify-center shrink-0 ${
          selected ? 'border-amber-deep bg-amber' : 'border-line-2'
        }`}
      >
        {selected && <span className="w-1.5 h-1.5 rounded-full bg-ink" />}
      </span>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-[14px] font-semibold ${selected ? 'text-ink' : 'text-ink-2'}`}>
            {choice.name}
          </span>
          {choice.is_default && (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-paper-2 border border-line text-ink-4 leading-none">
              Default
            </span>
          )}
          {comingSoon && (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-paper-3 border border-line text-ink-3 leading-none">
              Coming soon
            </span>
          )}
        </div>
        {subline && (
          <div className="text-[12px] text-ink-3 mt-0.5 leading-relaxed">{subline}</div>
        )}
      </div>

      {selected && <Icon name="check" size={13} className="text-amber-deep mt-0.5 shrink-0" />}
    </button>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function SettingsDataResidency() {
  const { showToast } = useToast()
  const { user } = useAuth()
  const { status, choices, preferred, strict, endpointMissing, listMissing, error, reload } = useRegionChoices(
    user?.user_id,
  )
  const [saving, setSaving] = useState(false)

  const grouped = groupChoices(choices)
  // Task 2053: strict on and the country unavailable: uploads are refused, not rerouted.
  const refusing = strictUnavailable(preferred, strict, choices)
  const selectedId = refusing ? null : selectedChoiceId(preferred, choices)
  const unavailable = preferenceUnavailable(preferred, choices)
  const pinned = selectedCountry(preferred, choices)
  const loading = status === 'idle' || status === 'loading'
  const failed = status === 'error' || (status === 'ready' && (listMissing || !grouped.defaultChoice))

  const handleSelect = useCallback(
    async (choice: StorageRegionChoice) => {
      if (saving || !choice.selectable || choice.id === selectedId) return
      setSaving(true)
      try {
        // Strict is a promise about ONE country: it carries over to another
        // country, and ends when the person goes back to "Europe".
        await saveRegionChoice(choice.id, choice.kind === 'country' && strict)
        showToast({
          icon: 'check',
          title: 'Region updated',
          description: choice.is_default
            ? 'New uploads go to any of our European data centers.'
            : `New uploads go to ${choiceLabel(choice)}.`,
        })
      } catch (err) {
        showToast({
          icon: 'x',
          title: 'Failed to save region',
          description: err instanceof Error ? err.message : 'Please try again.',
          danger: true,
        })
      } finally {
        setSaving(false)
      }
    },
    [saving, selectedId, strict, showToast],
  )

  const handleStrict = useCallback(
    async (next: boolean) => {
      if (saving || !pinned) return
      setSaving(true)
      try {
        await saveRegionChoice(pinned.id, next)
        showToast({
          icon: 'check',
          title: next ? `Only storing in ${choiceLabel(pinned)}` : 'Other EU countries allowed',
          description: next
            ? `If ${choiceLabel(pinned)} cannot take a new file, the upload stops.`
            : 'If your country cannot take a new file, it goes to another EU country.',
        })
      } catch (err) {
        showToast({
          icon: 'x',
          title: 'Failed to save region',
          description: err instanceof Error ? err.message : 'Please try again.',
          danger: true,
        })
      } finally {
        setSaving(false)
      }
    },
    [saving, pinned, showToast],
  )

  const handleAllowOthers = useCallback(async () => {
    if (saving || !refusing) return
    setSaving(true)
    try {
      await saveRegionChoice(refusing.id, false)
      showToast({
        icon: 'check',
        title: 'Other EU countries allowed',
        description: 'New uploads go to another European data center until your country is back.',
      })
    } catch (err) {
      showToast({
        icon: 'x',
        title: 'Failed to save region',
        description: err instanceof Error ? err.message : 'Please try again.',
        danger: true,
      })
    } finally {
      setSaving(false)
    }
  }, [saving, refusing, showToast])

  return (
    <SettingsShell activeSection="data-residency">
      <SettingsHeader
        title="Data Residency"
        subtitle="Choose where your files are stored. New uploads go where you choose."
      />

      {loading ? (
        <div className="px-7 py-6 flex items-center gap-2 text-ink-3">
          <span className="w-3.5 h-3.5 border-2 border-line-2 border-t-ink-3 rounded-full animate-spin shrink-0" />
          <span className="text-[13px]">Loading regions…</span>
        </div>
      ) : failed ? (
        <div className="px-7 mt-5" data-testid="region-error">
          <div className="flex items-start gap-2.5 p-3 rounded-lg border border-line bg-paper-2">
            <Icon name="cloud" size={13} className="text-ink-3 shrink-0 mt-0.5" />
            <div className="text-[12px] text-ink-3 leading-relaxed">
              {endpointMissing || listMissing
                ? 'Region choice needs the latest server update. Your files are stored in Europe in the meantime.'
                : `We could not load the region list${error ? ` (${error})` : ''}. Your files are not affected.`}
              <div className="mt-2">
                <button
                  type="button"
                  onClick={() => void reload()}
                  className="text-[12px] font-medium text-ink-2 underline underline-offset-2 hover:text-ink"
                >
                  Try again
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="px-7 mt-5" role="radiogroup" aria-label="Where new uploads are stored">
            {/* The default: no country, any European data center. */}
            {grouped.defaultChoice && (
              <ChoiceRow
                choice={grouped.defaultChoice}
                selected={selectedId === grouped.defaultChoice.id}
                busy={saving}
                hint="Any of our European data centers. We place your files."
                onSelect={() => void handleSelect(grouped.defaultChoice!)}
              />
            )}

            {(grouped.live.length > 0 || grouped.comingSoon.length > 0) && (
              <div className="text-[11px] font-medium uppercase tracking-wider text-ink-3 mt-5 mb-2.5">
                Or choose a country
              </div>
            )}

            <div className="flex flex-col gap-2.5">
              {grouped.live.map((choice) => (
                <ChoiceRow
                  key={choice.id}
                  choice={choice}
                  selected={selectedId === choice.id}
                  busy={saving}
                  onSelect={() => void handleSelect(choice)}
                />
              ))}
              {grouped.comingSoon.map((choice) => (
                <ChoiceRow
                  key={choice.id}
                  choice={choice}
                  selected={false}
                  busy={saving}
                  onSelect={() => undefined}
                />
              ))}
            </div>
            {(pinned || refusing) && (
              <div
                className="mt-4 flex items-start gap-3.5 px-4 py-3.5 rounded-lg border border-line bg-paper"
                data-testid="region-strict"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-semibold text-ink-2" id="region-strict-label">
                    {refusing ? `Only store in ${refusing.name}` : strictLabel(pinned!)}
                  </div>
                  <div className="text-[12px] text-ink-3 mt-0.5 leading-relaxed">
                    Off by default. If {refusing ? refusing.name : choiceLabel(pinned!)} cannot take a
                    new file, the upload stops instead of going to another EU country.
                  </div>
                </div>
                <BBToggle
                  on={strict}
                  size="adaptive"
                  disabled={saving}
                  aria-label={refusing ? `Only store in ${refusing.name}` : strictLabel(pinned!)}
                  onChange={(next) => {
                    if (refusing) {
                      if (!next) void handleAllowOthers()
                    } else void handleStrict(next)
                  }}
                />
              </div>
            )}

            {refusing ? (
              <div
                className="mt-3 p-3 rounded-lg border border-line bg-paper-2"
                data-testid="region-unavailable"
              >
                <p className="text-[12px] text-ink-2 leading-relaxed">
                  <strong>New uploads are refused while {refusing.name} is unavailable.</strong>{' '}
                  You chose to only store in {refusing.name}, so we stop an upload rather than send
                  it elsewhere. Existing files are not affected.
                </p>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void handleAllowOthers()}
                  className="mt-2 text-[12px] font-medium text-ink-2 underline underline-offset-2 hover:text-ink disabled:opacity-60"
                >
                  Allow other EU countries
                </button>
              </div>
            ) : (
              unavailable && (
                <p className="text-[12px] text-ink-3 mt-3 leading-relaxed" data-testid="region-unavailable">
                  The country you chose is not available right now. New uploads go to any of our
                  European data centers until it is back.
                </p>
              )
            )}
          </div>

          <div className="px-7 mt-5 pb-6">
            <div className="flex items-start gap-2.5 p-3 rounded-lg bg-paper-2 border border-line">
              <Icon name="shield" size={13} className="text-amber-deep shrink-0 mt-0.5" />
              <div className="text-[12px] text-ink-3 leading-relaxed">
                <strong className="text-ink-2">Existing files stay where they are.</strong>{' '}
                Only new uploads use your choice. Unless you turn on &ldquo;only store in&rdquo;, a
                country that cannot take new files at that moment passes them to another European
                data center, and the file&apos;s details always show which country it is in.
                Everything is stored in Europe, under EU law.
              </div>
            </div>
          </div>
        </>
      )}
    </SettingsShell>
  )
}
