import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { AdminShell, AdminHeader } from './admin-shell'
import { Icon } from '../../components/icons'
import { BBButton } from '../../components/bb-button'
import { BBChip } from '../../components/bb-chip'
import { useToast } from '../../components/toast'
import { formatBytes } from '../../lib/format'
import { PhaseBadge } from '../../components/admin/lifecycle/phase-badge'
import {
  listStoragePools,
  createStoragePool,
  updateStoragePool,
  listMigrations,
  getHealth,
  getAdminStats,
  reconcileUsage,
  type StoragePool,
  type MigrationSummary,
  type MigrationEntry,
  type HealthResponse,
  type AdminStats,
} from '../../lib/api'

type Tab = 'pools' | 'migrations' | 'health'

const TABS: { id: Tab; label: string }[] = [
  { id: 'pools', label: 'Pools' },
  { id: 'migrations', label: 'Migrations' },
  { id: 'health', label: 'Health' },
]

// ─── Capacity helpers ─────────────────────────────────────────────────────────

type CapacityUnit = 'GB' | 'TB' | 'PB'
const CAPACITY_DIVISORS: Record<CapacityUnit, number> = { GB: 1e9, TB: 1e12, PB: 1e15 }

function bytesToHuman(bytes: number | null): { value: string; unit: CapacityUnit } {
  if (!bytes) return { value: '', unit: 'TB' }
  for (const unit of ['PB', 'TB', 'GB'] as CapacityUnit[]) {
    const v = bytes / CAPACITY_DIVISORS[unit]
    if (v >= 1) {
      const rounded = Math.round(v * 100) / 100
      return { value: String(rounded), unit }
    }
  }
  return { value: String(bytes / 1e9), unit: 'GB' }
}

function humanToBytes(value: string, unit: CapacityUnit): number | null {
  const n = parseFloat(value)
  if (!value.trim() || isNaN(n)) return null
  return Math.round(n * CAPACITY_DIVISORS[unit])
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

function formatDate(iso: string | null): string {
  if (!iso) return '-'
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const mins = Math.floor((seconds % 3600) / 60)
  if (days > 0) return `${days}d ${hours}h ${mins}m`
  if (hours > 0) return `${hours}h ${mins}m`
  return `${mins}m`
}

function statusColor(status: string): { fg: string; bg: string } {
  switch (status) {
    case 'done':
      return { fg: 'oklch(0.45 0.12 155)', bg: 'oklch(0.94 0.06 155)' }
    case 'pending':
      return { fg: 'var(--color-amber-deep)', bg: 'var(--color-amber-bg)' }
    case 'copying':
    case 'verifying':
      return { fg: 'oklch(0.5 0.15 250)', bg: 'oklch(0.94 0.06 250)' }
    case 'failed':
      return { fg: 'var(--color-red)', bg: 'oklch(0.97 0.03 25)' }
    default:
      return { fg: 'var(--color-ink-3)', bg: 'var(--color-paper-2)' }
  }
}

function UsageBar({
  used,
  capacity,
}: {
  used: number
  capacity: number | null
}) {
  if (!capacity || capacity <= 0) {
    return (
      <div className="flex items-center gap-2">
        <div className="flex-1 h-2 rounded-full bg-paper-3">
          <div className="h-full rounded-full bg-amber" style={{ width: '0%' }} />
        </div>
        <span className="font-mono text-[10px] text-ink-3">No limit</span>
      </div>
    )
  }
  const pct = Math.min((used / capacity) * 100, 100)
  const color =
    pct > 90
      ? 'var(--color-red)'
      : pct > 70
        ? 'var(--color-amber-deep)'
        : 'oklch(0.55 0.12 155)'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 rounded-full bg-paper-3">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
      <span className="font-mono text-[10px] text-ink-3 w-[40px] text-right">
        {pct.toFixed(1)}%
      </span>
    </div>
  )
}

interface CreatePoolFormData {
  name: string
  display_name: string
  provider: string
  endpoint: string
  bucket: string
  region: string
  city: string
  continent: string
  access_key_id: string
  secret_access_key: string
  capacity_value: string
  capacity_unit: CapacityUnit
}

const EMPTY_POOL_FORM: CreatePoolFormData = {
  name: '',
  display_name: '',
  provider: 's3',
  endpoint: '',
  bucket: '',
  region: '',
  city: '',
  continent: 'europe',
  access_key_id: '',
  secret_access_key: '',
  capacity_value: '',
  capacity_unit: 'TB',
}

export function Infrastructure() {
  const { showToast } = useToast()
  const [tab, setTab] = useState<Tab>('pools')
  const [pools, setPools] = useState<StoragePool[]>([])
  const [migrationSummary, setMigrationSummary] =
    useState<MigrationSummary | null>(null)
  const [recentMigrations, setRecentMigrations] = useState<MigrationEntry[]>([])
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [, setStats] = useState<AdminStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [updatingPool, setUpdatingPool] = useState<string | null>(null)
  const [reconciling, setReconciling] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [createForm, setCreateForm] =
    useState<CreatePoolFormData>(EMPTY_POOL_FORM)
  const [creating, setCreating] = useState(false)
  const [editingPool, setEditingPool] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<{
    display_name: string
    city: string
    /** Human-readable numeric value (e.g. "100"). Empty string = unlimited. */
    capacity_value: string
    /** Unit for capacity_value. */
    capacity_unit: 'GB' | 'TB' | 'PB'
    is_active: boolean
  }>({ display_name: '', city: '', capacity_value: '', capacity_unit: 'TB', is_active: true })

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [poolsData, migrations, healthData, statsData] = await Promise.all([
        listStoragePools(),
        listMigrations().catch(() => null),
        getHealth().catch(() => null),
        getAdminStats().catch(() => null),
      ])
      setPools(poolsData)
      if (migrations) {
        setMigrationSummary(migrations.summary)
        setRecentMigrations(migrations.recent)
      }
      if (healthData) setHealth(healthData)
      if (statsData) setStats(statsData)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load infrastructure')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function handleReconcile() {
    setReconciling(true)
    try {
      const res = await reconcileUsage()
      showToast({
        icon: 'check',
        title: 'Usage reconciled',
        description: `${res.pools_corrected} pools, ${formatBytes(res.total_drift_bytes)} drift corrected`,
      })
      await load()
    } catch (err) {
      showToast({
        icon: 'x',
        title: 'Reconcile failed',
        description: err instanceof Error ? err.message : undefined,
        danger: true,
      })
    } finally {
      setReconciling(false)
    }
  }

  async function handleCreatePool(e: React.FormEvent) {
    e.preventDefault()
    setCreating(true)
    try {
      const capacity = humanToBytes(createForm.capacity_value, createForm.capacity_unit)
      const created = await createStoragePool({
        name: createForm.name,
        display_name: createForm.display_name,
        provider: createForm.provider,
        endpoint: createForm.endpoint,
        bucket: createForm.bucket,
        region: createForm.region,
        city: createForm.city || undefined,
        continent: createForm.continent || undefined,
        access_key_id: createForm.access_key_id,
        secret_access_key: createForm.secret_access_key,
        capacity_bytes: capacity,
      })
      setPools(prev => [...prev, created])
      setShowCreate(false)
      setCreateForm(EMPTY_POOL_FORM)
      showToast({ icon: 'check', title: 'Pool created', description: created.display_name })
    } catch (err) {
      showToast({
        icon: 'x',
        title: 'Create failed',
        description: err instanceof Error ? err.message : undefined,
        danger: true,
      })
    } finally {
      setCreating(false)
    }
  }

  function startEdit(pool: StoragePool) {
    setEditingPool(pool.id)
    const { value, unit } = bytesToHuman(pool.capacity_bytes)
    setEditDraft({
      display_name: pool.display_name,
      city: pool.city ?? '',
      capacity_value: value,
      capacity_unit: unit,
      is_active: pool.is_active,
    })
  }

  async function saveEdit(pool: StoragePool) {
    setUpdatingPool(pool.id)
    try {
      // Capacity: empty = unchanged (pass existing), set = new value, -1 sentinel = clear to unlimited
      const capacityFromForm = humanToBytes(editDraft.capacity_value, editDraft.capacity_unit)
      const capacity = editDraft.capacity_value.trim() === '' && pool.capacity_bytes !== null
        ? -1  // sentinel: clear to unlimited
        : capacityFromForm
      const updated = await updateStoragePool(pool.id, {
        display_name: editDraft.display_name,
        city: editDraft.city || undefined,
        capacity_bytes: capacity,
        is_active: editDraft.is_active,
      })
      setPools(prev => prev.map(p => (p.id === pool.id ? updated : p)))
      setEditingPool(null)
      showToast({ icon: 'check', title: 'Pool updated', description: updated.display_name })
    } catch (err) {
      showToast({
        icon: 'x',
        title: 'Update failed',
        description: err instanceof Error ? err.message : undefined,
        danger: true,
      })
    } finally {
      setUpdatingPool(null)
    }
  }

  const totalUsed = pools.reduce((sum, p) => sum + p.used_bytes, 0)
  const totalCapacity = pools.reduce((sum, p) => sum + (p.capacity_bytes ?? 0), 0)

  const isHealthy = health?.status === 'ok' || health?.status === 'healthy'
  const workersEntries = Object.entries(health?.background_workers?.items ?? {}).map(
    ([name, data]) => ({ name, data }),
  )

  return (
    <AdminShell activeSection="infrastructure">
      <AdminHeader
        title="Infrastructure"
        actions={
          <BBButton size="sm" variant="ghost" onClick={() => void load()}>
            Refresh
          </BBButton>
        }
      />

      {/* Tabs */}
      <div className="flex items-center gap-1 px-7 py-2 border-b border-line bg-paper-2">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-2.5 py-1 rounded-md text-[12px] transition-colors ${
              tab === t.id
                ? 'bg-paper text-ink font-medium shadow-1'
                : 'text-ink-3 hover:text-ink-2'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-7 py-5 flex flex-col gap-5">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <svg className="animate-spin h-6 w-6 text-amber" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
        ) : error ? (
          <div className="py-8 text-center">
            <div className="text-xs text-red mb-2">{error}</div>
            <BBButton size="sm" variant="ghost" onClick={() => void load()}>
              Retry
            </BBButton>
          </div>
        ) : tab === 'pools' ? (
          <>
            {/* Pools toolbar */}
            <div className="flex items-center gap-2">
              <BBChip>{pools.length} {pools.length === 1 ? 'pool' : 'pools'}</BBChip>
              {totalCapacity > 0 && (
                <span className="font-mono text-[11px] text-ink-3">
                  {formatBytes(totalUsed)} / {formatBytes(totalCapacity)} total
                </span>
              )}
              <span className="ml-auto flex gap-2">
                <BBButton size="sm" variant="ghost" onClick={handleReconcile} disabled={reconciling}>
                  {reconciling ? 'Reconciling...' : 'Reconcile usage'}
                </BBButton>
                <BBButton size="sm" variant="amber" onClick={() => setShowCreate(v => !v)}>
                  {showCreate ? 'Cancel' : 'Create pool'}
                </BBButton>
              </span>
            </div>

            {/* Create form */}
            {showCreate && (
              <form
                onSubmit={handleCreatePool}
                className="rounded-xl border border-amber/40 bg-paper p-5 grid grid-cols-2 gap-x-4 gap-y-3"
              >
                <div className="col-span-2 flex items-center gap-2 pb-1 border-b border-line mb-1">
                  <Icon name="plus" size={13} className="text-amber-deep" />
                  <span className="text-[12px] font-semibold text-ink">New storage pool</span>
                </div>

                {/* Name */}
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-3">Name</span>
                  <input
                    required
                    placeholder="e.g. s03, eu-fra-2"
                    className="border border-line-2 rounded-md px-2 py-1.5 text-xs font-mono bg-paper"
                    value={createForm.name}
                    onChange={e => setCreateForm({ ...createForm, name: e.target.value })}
                  />
                  <span className="text-[10px] text-ink-4">Internal identifier — used in env-var key names</span>
                </label>

                {/* Display name */}
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-3">Display name</span>
                  <input
                    required
                    placeholder="e.g. Hetzner Falkenstein"
                    className="border border-line-2 rounded-md px-2 py-1.5 text-xs bg-paper"
                    value={createForm.display_name}
                    onChange={e => setCreateForm({ ...createForm, display_name: e.target.value })}
                  />
                  <span className="text-[10px] text-ink-4">User-facing label shown in the UI</span>
                </label>

                {/* Provider */}
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-3">Provider</span>
                  <select
                    required
                    className="border border-line-2 rounded-md px-2 py-1.5 text-xs font-mono bg-paper"
                    value={createForm.provider}
                    onChange={e => setCreateForm({ ...createForm, provider: e.target.value })}
                  >
                    <option value="s3">s3</option>
                    <option value="local">local</option>
                  </select>
                  <span className="text-[10px] text-ink-4">s3 = S3-compatible object storage · local = filesystem</span>
                </label>

                {/* Region */}
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-3">Region</span>
                  <input
                    required
                    placeholder="e.g. fsn1"
                    className="border border-line-2 rounded-md px-2 py-1.5 text-xs font-mono bg-paper"
                    value={createForm.region}
                    onChange={e => setCreateForm({ ...createForm, region: e.target.value })}
                  />
                  <span className="text-[10px] text-ink-4">Provider region code (used in storage_location)</span>
                </label>

                {/* Endpoint */}
                <label className="flex flex-col gap-1 col-span-2">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-3">Endpoint</span>
                  <input
                    required
                    placeholder="https://fsn1.your-objectstorage.com"
                    className="border border-line-2 rounded-md px-2 py-1.5 text-xs font-mono bg-paper"
                    value={createForm.endpoint}
                    onChange={e => setCreateForm({ ...createForm, endpoint: e.target.value })}
                  />
                  <span className="text-[10px] text-ink-4">S3-compatible endpoint URL (leave blank for AWS default)</span>
                </label>

                {/* Bucket */}
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-3">Bucket</span>
                  <input
                    required
                    placeholder="e.g. beebeeb-s03"
                    className="border border-line-2 rounded-md px-2 py-1.5 text-xs font-mono bg-paper"
                    value={createForm.bucket}
                    onChange={e => setCreateForm({ ...createForm, bucket: e.target.value })}
                  />
                  <span className="text-[10px] text-ink-4">Bucket name (must already exist)</span>
                </label>

                {/* Capacity */}
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-3">Capacity</span>
                  <div className="flex gap-1.5">
                    <input
                      type="number"
                      min="0"
                      step="any"
                      placeholder="e.g. 100"
                      className="flex-1 border border-line-2 rounded-md px-2 py-1.5 text-xs font-mono bg-paper min-w-0"
                      value={createForm.capacity_value}
                      onChange={e => setCreateForm({ ...createForm, capacity_value: e.target.value })}
                    />
                    <select
                      className="border border-line-2 rounded-md px-2 py-1.5 text-xs font-mono bg-paper"
                      value={createForm.capacity_unit}
                      onChange={e => setCreateForm({ ...createForm, capacity_unit: e.target.value as CapacityUnit })}
                    >
                      <option value="GB">GB</option>
                      <option value="TB">TB</option>
                      <option value="PB">PB</option>
                    </select>
                  </div>
                  <span className="text-[10px] text-ink-4">Leave blank for unlimited</span>
                </div>

                {/* City */}
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-3">City</span>
                  <input
                    placeholder="e.g. Falkenstein"
                    className="border border-line-2 rounded-md px-2 py-1.5 text-xs bg-paper"
                    value={createForm.city}
                    onChange={e => setCreateForm({ ...createForm, city: e.target.value })}
                  />
                  <span className="text-[10px] text-ink-4">DC city shown in file storage badges</span>
                </label>

                {/* Continent */}
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-3">Continent</span>
                  <select
                    className="border border-line-2 rounded-md px-2 py-1.5 text-xs font-mono bg-paper"
                    value={createForm.continent}
                    onChange={e => setCreateForm({ ...createForm, continent: e.target.value })}
                  >
                    <option value="europe">europe</option>
                    <option value="north-america">north-america</option>
                    <option value="asia">asia</option>
                    <option value="australia">australia</option>
                    <option value="south-america">south-america</option>
                    <option value="africa">africa</option>
                  </select>
                  <span className="text-[10px] text-ink-4">Jurisdiction region for data-residency display</span>
                </label>

                {/* Credentials */}
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-3">Access key ID</span>
                  <input
                    required
                    autoComplete="off"
                    className="border border-line-2 rounded-md px-2 py-1.5 text-xs font-mono bg-paper"
                    value={createForm.access_key_id}
                    onChange={e => setCreateForm({ ...createForm, access_key_id: e.target.value })}
                  />
                  <span className="text-[10px] text-ink-4">Stored in env as STORAGE_POOL_&lt;NAME&gt;_ACCESS_KEY</span>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-3">Secret access key</span>
                  <input
                    required
                    type="password"
                    autoComplete="new-password"
                    className="border border-line-2 rounded-md px-2 py-1.5 text-xs font-mono bg-paper"
                    value={createForm.secret_access_key}
                    onChange={e => setCreateForm({ ...createForm, secret_access_key: e.target.value })}
                  />
                  <span className="text-[10px] text-ink-4">Stored in env as STORAGE_POOL_&lt;NAME&gt;_SECRET_KEY</span>
                </label>

                <div className="col-span-2 flex justify-end gap-2 pt-2 border-t border-line mt-1">
                  <BBButton
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setShowCreate(false)
                      setCreateForm(EMPTY_POOL_FORM)
                    }}
                  >
                    Cancel
                  </BBButton>
                  <BBButton type="submit" size="sm" variant="amber" disabled={creating}>
                    {creating ? 'Creating...' : 'Create pool'}
                  </BBButton>
                </div>
              </form>
            )}

            {pools.length === 0 ? (
              <div className="py-8 text-center text-xs text-ink-3">
                No storage pools configured
              </div>
            ) : (
              <div
                className="grid gap-3"
                style={{ gridTemplateColumns: pools.length > 1 ? '1fr 1fr' : '1fr' }}
              >
                {pools.map(pool => {
                  const isUpdating = updatingPool === pool.id
                  const isEditing = editingPool === pool.id
                  const healthOk =
                    pool.is_active && (pool.usage_pct ?? 0) < 95
                  return (
                    <div
                      key={pool.id}
                      className="rounded-xl bg-paper border border-line-2 p-4"
                    >
                      <div className="flex items-start gap-3 mb-3">
                        <div
                          className="w-[32px] h-[32px] rounded-lg shrink-0 flex items-center justify-center border"
                          style={{
                            background: pool.is_active
                              ? 'var(--color-amber-bg)'
                              : 'var(--color-paper-2)',
                            borderColor: pool.is_active
                              ? 'var(--color-amber-deep)'
                              : 'var(--color-line-2)',
                          }}
                        >
                          <Icon
                            name="cloud"
                            size={14}
                            style={{
                              color: pool.is_active
                                ? 'var(--color-amber-deep)'
                                : 'var(--color-ink-4)',
                            }}
                          />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[13px] font-semibold">
                              {pool.display_name}
                            </span>
                            <span
                              className="inline-block w-1.5 h-1.5 rounded-full"
                              style={{
                                background: healthOk
                                  ? 'oklch(0.55 0.12 155)'
                                  : 'var(--color-red)',
                              }}
                              title={healthOk ? 'Healthy' : 'Degraded'}
                            />
                            {pool.is_default && (
                              <BBChip variant="amber" className="text-[9px]">
                                Default
                              </BBChip>
                            )}
                            {/* Lifecycle phase badge */}
                            <PhaseBadge
                              phase={pool.lifecycle_phase ?? 'active'}
                              className="text-[9px]"
                            />
                          </div>
                          <div className="font-mono text-[10px] text-ink-3 mt-0.5">
                            {pool.name}
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-4 gap-2 mb-3">
                        <div>
                          <div className="text-[10px] text-ink-4">Provider</div>
                          <div className="font-mono text-[11px] font-medium">{pool.provider}</div>
                        </div>
                        <div>
                          <div className="text-[10px] text-ink-4">Region</div>
                          <div className="font-mono text-[11px] font-medium">{pool.region}</div>
                        </div>
                        <div>
                          <div className="text-[10px] text-ink-4">City</div>
                          <div className="text-[11px] font-medium">{pool.city ?? '—'}</div>
                        </div>
                        <div>
                          <div className="text-[10px] text-ink-4">Bucket</div>
                          <div className="font-mono text-[11px] font-medium truncate">{pool.bucket}</div>
                        </div>
                      </div>

                      <div className="mb-3">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[10px] text-ink-4">Usage</span>
                          <span className="font-mono text-[10px] text-ink-2">
                            {formatBytes(pool.used_bytes)}
                            {pool.capacity_bytes ? ` / ${formatBytes(pool.capacity_bytes)}` : ''}
                          </span>
                        </div>
                        <UsageBar used={pool.used_bytes} capacity={pool.capacity_bytes} />
                      </div>

                      {isEditing ? (
                        <div className="rounded-lg bg-paper-2 border border-line p-3 space-y-2 mb-3">
                          <label className="flex flex-col gap-1">
                            <span className="text-xs font-medium text-ink-2">Display name</span>
                            <input
                              className="border border-line-2 rounded-md px-2 py-1.5 text-xs bg-paper"
                              value={editDraft.display_name}
                              onChange={e =>
                                setEditDraft({ ...editDraft, display_name: e.target.value })
                              }
                            />
                          </label>
                          <label className="flex flex-col gap-1">
                            <span className="text-xs font-medium text-ink-2">City</span>
                            <input
                              className="border border-line-2 rounded-md px-2 py-1.5 text-xs bg-paper"
                              placeholder="e.g. Falkenstein"
                              value={editDraft.city}
                              onChange={e =>
                                setEditDraft({ ...editDraft, city: e.target.value })
                              }
                            />
                          </label>
                          <div className="flex flex-col gap-1">
                            <span className="text-xs font-medium text-ink-2">Capacity</span>
                            <div className="flex gap-1.5">
                              <input
                                type="number"
                                min="0"
                                step="any"
                                className="flex-1 border border-line-2 rounded-md px-2 py-1.5 text-xs font-mono bg-paper min-w-0"
                                value={editDraft.capacity_value}
                                placeholder="e.g. 100"
                                onChange={e =>
                                  setEditDraft({ ...editDraft, capacity_value: e.target.value })
                                }
                              />
                              <select
                                className="border border-line-2 rounded-md px-2 py-1.5 text-xs font-mono bg-paper"
                                value={editDraft.capacity_unit}
                                onChange={e =>
                                  setEditDraft({ ...editDraft, capacity_unit: e.target.value as 'GB' | 'TB' | 'PB' })
                                }
                              >
                                <option value="GB">GB</option>
                                <option value="TB">TB</option>
                                <option value="PB">PB</option>
                              </select>
                            </div>
                            <span className="text-[10px] text-ink-4">Leave blank for unlimited</span>
                          </div>
                          <label className="flex items-center gap-2 text-[12px]">
                            <input
                              type="checkbox"
                              checked={editDraft.is_active}
                              onChange={e =>
                                setEditDraft({ ...editDraft, is_active: e.target.checked })
                              }
                            />
                            <span>Active (accept new writes)</span>
                          </label>
                          <div className="flex justify-end gap-2 pt-1">
                            <BBButton
                              size="sm"
                              variant="ghost"
                              onClick={() => setEditingPool(null)}
                            >
                              Cancel
                            </BBButton>
                            <BBButton
                              size="sm"
                              variant="amber"
                              onClick={() => saveEdit(pool)}
                              disabled={isUpdating}
                            >
                              {isUpdating ? 'Saving...' : 'Save'}
                            </BBButton>
                          </div>
                        </div>
                      ) : null}

                      <div className="p-2 bg-paper-2 border border-line rounded-md font-mono text-[10px] text-ink-3 break-all mb-3">
                        {pool.endpoint}
                      </div>

                      {/* Lifecycle wizard link — replaces old migrate/decommission controls */}
                      <div className="mb-3">
                        <Link
                          to={`/admin/infrastructure/pools/${pool.id}`}
                          className="inline-flex items-center gap-1 text-xs font-medium text-ink-2 hover:text-ink transition-colors"
                        >
                          {(pool.lifecycle_phase ?? 'active') === 'active'
                            ? 'Manage'
                            : 'View progress'}
                          <Icon name="chevron-right" size={12} />
                        </Link>
                      </div>

                      <div className="flex items-center gap-2 pt-1 border-t border-line">
                        <BBButton size="sm" variant="ghost" onClick={() => startEdit(pool)}>
                          Edit
                        </BBButton>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </>
        ) : tab === 'migrations' ? (
          <>
            {migrationSummary && (
              <div className="grid grid-cols-5 gap-3">
                {(['pending', 'copying', 'verifying', 'done', 'failed'] as const).map(
                  status => {
                    const count = migrationSummary[status]
                    const colors = statusColor(status)
                    return (
                      <div
                        key={status}
                        className="rounded-lg border border-line bg-paper p-3 text-center"
                      >
                        <div
                          className="font-mono text-lg font-bold leading-tight"
                          style={{ color: count > 0 ? colors.fg : 'var(--color-ink-4)' }}
                        >
                          {count}
                        </div>
                        <div className="text-[10px] text-ink-3 capitalize mt-0.5">
                          {status}
                        </div>
                      </div>
                    )
                  },
                )}
              </div>
            )}

            <div className="rounded-xl border border-line-2 bg-paper overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-line">
                <Icon name="clock" size={13} className="text-ink-2" />
                <span className="text-[13px] font-semibold">Recent migrations</span>
                <BBChip>{recentMigrations.length} shown</BBChip>
              </div>

              {recentMigrations.length === 0 ? (
                <div className="py-8 text-center text-xs text-ink-3">
                  No migrations recorded yet
                </div>
              ) : (
                <>
                  <div
                    className="grid px-4 py-2 text-[10px] font-mono uppercase tracking-wide text-ink-3 border-b border-line bg-paper-2"
                    style={{ gridTemplateColumns: '120px 1fr 1fr 80px 70px 1fr 130px' }}
                  >
                    <span>File</span>
                    <span>From pool</span>
                    <span>To pool</span>
                    <span>Status</span>
                    <span>Chunks</span>
                    <span>Error</span>
                    <span>Created</span>
                  </div>
                  {recentMigrations.map(m => {
                    const colors = statusColor(m.status)
                    return (
                      <div
                        key={m.id}
                        className="grid px-4 py-2.5 text-xs border-b border-line items-center last:border-b-0"
                        style={{ gridTemplateColumns: '120px 1fr 1fr 80px 70px 1fr 130px' }}
                      >
                        <span className="font-mono text-[10px] text-ink-2 truncate" title={m.file_id}>
                          {m.file_id.slice(0, 8)}...
                        </span>
                        <span className="font-mono text-[11px] truncate">
                          {m.from_pool ?? '-'}
                        </span>
                        <span className="font-mono text-[11px] truncate">
                          {m.to_pool ?? '-'}
                        </span>
                        <span>
                          <span
                            className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium"
                            style={{ background: colors.bg, color: colors.fg }}
                          >
                            {m.status}
                          </span>
                        </span>
                        <span className="font-mono text-[11px] text-ink-2">{m.chunks_copied}</span>
                        <span
                          className="text-[10px] text-red truncate"
                          title={m.error ?? undefined}
                        >
                          {m.error ?? '-'}
                        </span>
                        <span className="font-mono text-[10px] text-ink-3">
                          {formatDate(m.created_at)}
                        </span>
                      </div>
                    )
                  })}
                </>
              )}
            </div>
          </>
        ) : (
          /* Health */
          <>
            <div className="rounded-xl border border-line-2 bg-paper-2 px-4 py-3 flex items-center gap-4 flex-wrap">
              <div className="flex items-center gap-2">
                <span
                  className="inline-block w-2 h-2 rounded-full"
                  style={{
                    background: health
                      ? isHealthy
                        ? 'var(--color-green)'
                        : 'var(--color-red)'
                      : 'var(--color-ink-4)',
                  }}
                />
                <span className="text-[13px] font-medium text-ink">
                  {health
                    ? isHealthy
                      ? 'All systems operational'
                      : 'System degraded'
                    : 'Health unavailable'}
                </span>
              </div>
              {health && (
                <>
                  <div className="h-4 w-px bg-line" />
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-ink-4">Uptime</span>
                    <span className="font-mono text-[11px] text-ink-2">
                      {health.uptime_seconds != null
                        ? formatUptime(health.uptime_seconds)
                        : '--'}
                    </span>
                  </div>
                  <div className="h-4 w-px bg-line" />
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-ink-4">Version</span>
                    <span className="font-mono text-[11px] text-ink-2">{health.version}</span>
                  </div>
                </>
              )}
            </div>

            {/* Component status grid */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="rounded-lg border border-line bg-paper p-3">
                <div className="text-[10px] text-ink-4 uppercase tracking-wide mb-1">API</div>
                <div className="flex items-center gap-1.5">
                  <span
                    className="inline-block w-1.5 h-1.5 rounded-full"
                    style={{
                      background: isHealthy ? 'var(--color-green)' : 'var(--color-red)',
                    }}
                  />
                  <span className="font-mono text-[12px] text-ink">{health?.status ?? 'unknown'}</span>
                </div>
              </div>
              <div className="rounded-lg border border-line bg-paper p-3">
                <div className="text-[10px] text-ink-4 uppercase tracking-wide mb-1">Database</div>
                <div className="font-mono text-[12px] text-ink">
                  {health?.checks?.database
                    ? `${health.checks.database.status} · ${health.checks.database.latency_ms} ms`
                    : '--'}
                </div>
              </div>
              <div className="rounded-lg border border-line bg-paper p-3">
                <div className="text-[10px] text-ink-4 uppercase tracking-wide mb-1">Blob store</div>
                <div className="font-mono text-[12px] text-ink">
                  {pools.length} {pools.length === 1 ? 'pool' : 'pools'}
                  {health?.checks?.blob_store && (
                    <span className="text-ink-3"> · {health.checks.blob_store.status}</span>
                  )}
                </div>
              </div>
              <div className="rounded-lg border border-line bg-paper p-3">
                <div className="text-[10px] text-ink-4 uppercase tracking-wide mb-1">WebSocket</div>
                <div className="font-mono text-[12px] text-ink">
                  {health?.websocket_connections != null
                    ? `${health.websocket_connections} live`
                    : '--'}
                </div>
              </div>
            </div>

            {/* Background workers */}
            <div className="rounded-xl border border-line-2 bg-paper overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-line">
                <Icon name="settings" size={13} className="text-ink-2" />
                <span className="text-[13px] font-semibold">Background workers</span>
                <BBChip>{workersEntries.length}</BBChip>
                {health?.background_workers?.any_stale && (
                  <BBChip variant="amber" className="text-[10px]">Stale</BBChip>
                )}
              </div>
              {workersEntries.length === 0 ? (
                <div className="py-8 text-center text-xs text-ink-3">No worker telemetry</div>
              ) : (
                <>
                  <div
                    className="grid px-4 py-2 text-[10px] font-mono uppercase tracking-wide text-ink-3 border-b border-line bg-paper-2"
                    style={{ gridTemplateColumns: '1fr 1fr 1fr 100px' }}
                  >
                    <span>Worker</span>
                    <span>Last run</span>
                    <span>Seconds ago</span>
                    <span>Status</span>
                  </div>
                  {workersEntries.map(({ name, data }) => {
                    const lastRun = data.last_run
                    const secondsAgo = data.seconds_ago
                    const status = data.status
                    const dotColor =
                      status === 'ok'
                        ? 'var(--color-green)'
                        : status === 'stale'
                          ? 'var(--color-amber-deep)'
                          : 'var(--color-ink-4)'
                    return (
                      <div
                        key={name}
                        className="grid px-4 py-2.5 text-xs border-b border-line items-center last:border-b-0"
                        style={{ gridTemplateColumns: '1fr 1fr 1fr 100px' }}
                      >
                        <span className="font-mono text-[11px] text-ink">{name}</span>
                        <span className="font-mono text-[10px] text-ink-3">
                          {lastRun ? formatDate(lastRun) : '—'}
                        </span>
                        <span className="font-mono text-[11px] text-ink-2">
                          {secondsAgo != null ? `${secondsAgo}s` : '—'}
                        </span>
                        <span className="flex items-center gap-1.5">
                          <span
                            className="inline-block w-1.5 h-1.5 rounded-full"
                            style={{ background: dotColor }}
                          />
                          <span className="font-mono text-[11px] text-ink-2">{status}</span>
                        </span>
                      </div>
                    )
                  })}
                </>
              )}
            </div>
          </>
        )}
      </div>
    </AdminShell>
  )
}
