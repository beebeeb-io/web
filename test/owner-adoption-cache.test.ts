/**
 * Task 2237b — custody and root lookups are cached.
 *
 * Every row of a shared folder asks for its shared root and that root's
 * custody record on every decrypt pass, and every owner upload asks again.
 * Uncached that was several API calls per row per pass (a 200-row folder:
 * hundreds of calls, enough to trip the rate limiter). A custody hit lasts
 * the session; "not shared" (404) and parent lookups are re-checked after
 * `CUSTODY_RECHECK_MS`, because a folder can be shared or moved meanwhile.
 */
import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mockModuleScoped } from './helpers/scoped-module-mock'

const custodyCalls: string[] = []
const fileCalls: string[] = []
const shared = new Set<string>()
const parents = new Map<string, string | null>()
let transient = false
const invites: Record<string, unknown>[] = []
let inviteCalls = 0

await mockModuleScoped('../src/lib/api', import.meta.dir, (r) => ({
  ...r,
  getSharedFolder: async (folderId: string) => {
    custodyCalls.push(folderId)
    if (transient) throw new Error('offline')
    const ApiError = r.ApiError as new (m: string, s: number, c?: string) => Error
    if (!shared.has(folderId)) throw new ApiError('not found', 404, 'not_found')
    return {
      folder_id: folderId,
      role: 'owner',
      access_level: 'edit',
      key_version: 1,
      owner_wrapped_folder_key: null,
      wrapped_folder_key: null,
    }
  },
  getFile: async (id: string) => {
    fileCalls.push(id)
    return { id, parent_id: parents.get(id) ?? null }
  },
  getSentInvites: async () => {
    inviteCalls++
    return invites
  },
}))

const { CUSTODY_RECHECK_MS, clearSharedFolderLookups, forgetSharedFolderCustody, sharedRootFor } =
  await import('../src/lib/owner-adoption')

const realNow = Date.now
let now = 1_000_000

beforeEach(() => {
  custodyCalls.length = 0
  fileCalls.length = 0
  shared.clear()
  parents.clear()
  clearSharedFolderLookups()
  transient = false
  invites.length = 0
  inviteCalls = 0
  now = 1_000_000
  Date.now = () => now
})

afterEach(() => {
  Date.now = realNow
})

test('200 rows in the shared root cost ONE custody lookup, not 200', async () => {
  shared.add('root')
  for (let i = 0; i < 200; i++) expect(await sharedRootFor('root', `file-${i}`)).toBe('root')
  expect(custodyCalls).toEqual(['root'])
  expect(fileCalls).toHaveLength(0)
})

test('rows in a subfolder walk up once, then reuse the cached answers', async () => {
  shared.add('root')
  parents.set('sub', 'root')
  for (let i = 0; i < 50; i++) expect(await sharedRootFor('sub', `file-${i}`)).toBe('root')
  expect(custodyCalls.sort()).toEqual(['root', 'sub'])
  expect(fileCalls).toEqual(['sub'])
})

test('"not shared" is re-checked after the window, so a folder shared meanwhile is found', async () => {
  expect(await sharedRootFor('plain', 'plain')).toBeNull()
  shared.add('plain')
  // Inside the window the cached answer stands.
  now += CUSTODY_RECHECK_MS - 1
  expect(await sharedRootFor('plain', 'plain')).toBeNull()
  now += 2
  expect(await sharedRootFor('plain', 'plain')).toBe('plain')
})

test('forgetting a folder makes the very next lookup see its new custody', async () => {
  expect(await sharedRootFor('plain', 'plain')).toBeNull()
  shared.add('plain')
  forgetSharedFolderCustody('plain')
  expect(await sharedRootFor('plain', 'plain')).toBe('plain')
})

test('a transient failure is not cached as "not shared"', async () => {
  shared.add('root')
  transient = true
  expect(await sharedRootFor('root', 'f')).toBeNull()
  transient = false
  // No window to wait out: the failure was never remembered.
  expect(await sharedRootFor('root', 'f')).toBe('root')
})

test('a folder shared only with members (an active invite, no custody) is a shared root', async () => {
  // The member regression: a member's upload into an invite-only folder must
  // still take the shared-folder path on the owner's side.
  invites.push({ id: 'inv-1', file_id: 'members-only', is_folder_share: true, status: 'approved', created_at: '2026-10-28T00:00:00Z' })
  parents.set('sub', 'members-only')
  for (let i = 0; i < 20; i++) expect(await sharedRootFor('sub', `file-${i}`)).toBe('members-only')
  expect(inviteCalls).toBe(1)
  // A revoked invite does not make a root.
  clearSharedFolderLookups()
  invites[0].status = 'revoked'
  expect(await sharedRootFor('sub', 'file-x')).toBeNull()
})
