/**
 * Region choices for the signed-in person (task 1919).
 *
 * One small store, shared by everything that shows where data goes: the
 * Data residency page, the sidebar's region row and the upload cards. It
 * fetches `GET /api/v1/me/region` (the stored preference plus the server's
 * list of choices) once per person per page load, so a choice saved on the
 * settings page updates the sidebar at once, with no event plumbing.
 *
 * The list is the server's. When the fetch fails there is NO invented list:
 * the state is `error` and the page says so.
 */
import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { ApiError, getUserRegion, setUserRegion } from './api'
import { parseChoices, type StorageRegionChoice } from './storage-regions'

export type RegionStoreStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface RegionStoreState {
  status: RegionStoreStatus
  /** Whose data this is; a different person resets the store. */
  owner: string | null
  choices: StorageRegionChoice[]
  /** The stored preference as the server holds it: null, the default id, or a datacenter id. */
  preferred: string | null
  /** True when the server has no region endpoint at all (older than the feature). */
  endpointMissing: boolean
  /** True when the server answered but sent no `choices` (older than task 1919). */
  listMissing: boolean
  error: string | null
}

const INITIAL: RegionStoreState = {
  status: 'idle',
  owner: null,
  choices: [],
  preferred: null,
  endpointMissing: false,
  listMissing: false,
  error: null,
}

let state: RegionStoreState = INITIAL
let inflight: Promise<void> | null = null
/** Bumped by every load and every reset; a response from an older one is ignored. */
let epoch = 0
const listeners = new Set<() => void>()

function set(next: RegionStoreState) {
  state = next
  for (const l of listeners) l()
}

function subscribe(l: () => void): () => void {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

function snapshot(): RegionStoreState {
  return state
}

/** Forget everything (sign-out, a different person). Exported for tests. */
export function resetRegionStore(): void {
  epoch++
  inflight = null
  set(INITIAL)
}

export async function loadRegionChoices(owner: string | null, opts: { force?: boolean } = {}): Promise<void> {
  if (state.owner !== owner) resetRegionStore()
  if (!opts.force && (state.status === 'ready' || inflight)) return inflight ?? undefined
  const mine = ++epoch
  const run = (inflight = (async () => {
    set({ ...state, owner, status: state.status === 'ready' ? 'ready' : 'loading', error: null })
    try {
      const data = await getUserRegion()
      if (epoch !== mine) return
      const choices = parseChoices(data.choices)
      set({
        status: 'ready',
        owner,
        choices,
        preferred: data.preferred_region ?? null,
        endpointMissing: false,
        listMissing: choices.length === 0,
        error: null,
      })
    } catch (err) {
      if (epoch !== mine) return
      set({
        ...INITIAL,
        status: 'error',
        owner,
        endpointMissing: err instanceof ApiError && err.status === 404,
        error: err instanceof Error ? err.message : 'Could not load regions.',
      })
    } finally {
      if (epoch === mine) inflight = null
    }
  })())
  return run
}

/**
 * Save a choice. The new value shows at once and is rolled back if the server
 * refuses; the refusal is thrown to the caller (the page toasts it).
 */
export async function saveRegionChoice(id: string | null): Promise<void> {
  const previous = state.preferred
  set({ ...state, preferred: id })
  try {
    const result = await setUserRegion(id)
    set({ ...state, preferred: result.preferred_region ?? null })
  } catch (err) {
    set({ ...state, preferred: previous })
    throw err
  }
}

export function useRegionChoices(owner: string | null | undefined) {
  const raw = useSyncExternalStore(subscribe, snapshot, snapshot)
  const key = owner ?? null
  // Another person's data is never shown, not even for the render before the reset.
  const s = raw.owner === key ? raw : INITIAL

  useEffect(() => {
    if (!key) return
    void loadRegionChoices(key)
  }, [key])

  const reload = useCallback(() => loadRegionChoices(key, { force: true }), [key])
  return { ...s, reload }
}
