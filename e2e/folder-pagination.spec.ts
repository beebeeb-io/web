import { test, expect, type APIRequestContext } from '@playwright/test'

// Same default as global.setup's API_URL (can't import a test file from a spec).
const API_URL = process.env.E2E_API_URL ?? 'http://localhost:3001'

/**
 * 0739 — keyset pagination past the 200-item cap (web half).
 *
 * Ported from the standalone driver verified during 0739 gating
 * (.claude/tasks/_qa-evidence/0739/0739-e2e-driver.cjs). Proves, against the
 * running server:
 *   1. a folder with >200 children is enumerated IN FULL by following
 *      `next_cursor` — no dup, no skip, genuinely multi-page (the listAllFiles /
 *      collectAllChildren loop);
 *   2. the drive UI renders the full child count (the silent 200-cap is gone).
 *
 * Hermetic: clears the (disposable e2e) account's root folders first, seeds its
 * own subtree, and deletes it in teardown — so repeated runs stay clean and the
 * seeded folder is the only one at root (deterministic to open in the UI).
 */

const N = 220 // > the server's 200 default page size → forces ≥2 pages at limit 50

// name_encrypted is an opaque serialized blob to the server (never decrypted).
// Random canonical blobs are enough for a listing/count test; the drive shows
// them as undecryptable, but every ROW still lists.
function blob(): string {
  return JSON.stringify({
    cipher_suite: 'V1Aes256Gcm',
    nonce: Array.from({ length: 12 }, () => Math.floor(Math.random() * 256)),
    ciphertext: Array.from({ length: 16 }, () => Math.floor(Math.random() * 256)),
  })
}

async function createFolder(req: APIRequestContext, parentId?: string): Promise<string> {
  const res = await req.post(`${API_URL}/api/v1/files/folder`, {
    data: parentId ? { name_encrypted: blob(), parent_id: parentId } : { name_encrypted: blob() },
  })
  if (!res.ok()) throw new Error(`createFolder ${res.status()}: ${await res.text()}`)
  return (await res.json()).id
}

async function listRootFolderIds(req: APIRequestContext): Promise<string[]> {
  const ids: string[] = []
  let cursor: string | undefined
  do {
    const qs = new URLSearchParams({ limit: '200' })
    if (cursor) qs.set('cursor', cursor)
    const res = await req.get(`${API_URL}/api/v1/files?${qs}`)
    const j = await res.json()
    for (const f of j.files) if (f.is_folder) ids.push(f.id)
    cursor = j.next_cursor ?? undefined
  } while (cursor)
  return ids
}

async function deleteFile(req: APIRequestContext, id: string): Promise<void> {
  await req.delete(`${API_URL}/api/v1/files/${id}`)
}

async function listChildIds(req: APIRequestContext, parentId: string): Promise<string[]> {
  const ids: string[] = []
  let cursor: string | undefined
  do {
    const qs = new URLSearchParams({ parent_id: parentId, limit: '200' })
    if (cursor) qs.set('cursor', cursor)
    const res = await req.get(`${API_URL}/api/v1/files?${qs}`)
    const j = await res.json()
    for (const f of j.files) ids.push(f.id)
    cursor = j.next_cursor ?? undefined
  } while (cursor)
  return ids
}

test.describe('0739 keyset pagination — drive lists all children past the 200 cap', () => {
  let parentId: string

  test.beforeAll(async ({ playwright }) => {
    const req = await playwright.request.newContext({ storageState: 'playwright/.auth/user.json' })
    // Hermetic start: clear prior root folders (disposable e2e account).
    for (const id of await listRootFolderIds(req)) await deleteFile(req, id)
    // Seed a parent + N children.
    parentId = await createFolder(req)
    for (let i = 0; i < N; i++) await createFolder(req, parentId)
    await req.dispose()
  })

  test.afterAll(async ({ playwright }) => {
    const req = await playwright.request.newContext({ storageState: 'playwright/.auth/user.json' })
    if (parentId) {
      // Delete children then the parent — covers servers where folder delete
      // does NOT cascade, so repeated runs leave no orphaned rows.
      for (const id of await listChildIds(req, parentId)) await deleteFile(req, id)
      await deleteFile(req, parentId)
    }
    await req.dispose()
  })

  test('keyset cursor enumerates ALL children (no dup/skip, multi-page)', async ({ page }) => {
    const seen: string[] = []
    let cursor: string | undefined
    let pages = 0
    do {
      const qs = new URLSearchParams({ parent_id: parentId, limit: '50' })
      if (cursor) qs.set('cursor', cursor)
      const res = await page.request.get(`${API_URL}/api/v1/files?${qs}`)
      expect(res.ok()).toBe(true)
      const j = await res.json()
      pages++
      for (const f of j.files) seen.push(f.id)
      cursor = j.next_cursor ?? undefined
    } while (cursor && pages < 50)

    expect(seen.length).toBe(N) // every child returned
    expect(new Set(seen).size).toBe(N) // no duplicates
    expect(pages).toBeGreaterThan(1) // genuinely paginated past one page (the >200 case)
  })

  test('drive UI renders the full child count (no silent 200 cap)', async ({ page }) => {
    await page.goto('/')
    // Overlays are pre-suppressed by global.setup; open the (only) seeded folder.
    const folderRow = page.getByText('Folder', { exact: true }).first()
    await expect(folderRow).toBeVisible({ timeout: 15_000 })
    await folderRow.dblclick()

    // The drive footer shows "N items" for the open folder.
    await expect(page.getByText(new RegExp(`\\b${N}\\s+items?\\b`))).toBeVisible({ timeout: 20_000 })
  })
})
