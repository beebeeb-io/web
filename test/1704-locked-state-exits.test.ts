import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

/**
 * Task 1704 SLICE 2 — locked-state self-service exits: the pure logic that
 * the honest "Vault locked (no vault key)" surface is built from.
 *
 * Governing spec: decisions/2026-10-02-vault-key-password-recovery-and-admin-
 * reset-policy.md — Amendment + Decision 4 + the §6 exits table. A user who
 * just completed the email password reset (SLICE 1, /set-password) holds a
 * FRESH account credential but no vault key: the device's wrapped vault can
 * never open under the new password. This slice routes that state to an
 * honest locked-state surface (instead of VaultUnlock's dead-end password
 * form) with re-entry via the 12-word phrase and self-service exits.
 *
 * This suite covers the pieces that are testable WITHOUT a browser harness
 * (this repo has no jsdom/@testing-library — see test/1471's header note):
 *   1. the post-reset lock marker + the locked-vault surface decision
 *      (the "routing brain" factored into a pure function, mirroring
 *      shouldReconcileLock() in impersonation-context.tsx);
 *   2. the "delete all data" exit orchestration — trash-then-erase in
 *      server-capped batches, one single-use step-up token PER batch, and
 *      an honest verification pass that re-lists the server instead of
 *      trusting void responses.
 * Component copy, confirmation gates, and click wiring are pinned in
 * test/1704-vault-locked-no-key.test.tsx; the browser rung is lead-gated
 * and stays OPEN.
 */

// ── sessionStorage stub ──────────────────────────────────────────────────────
class MemoryStorage {
  private store = new Map<string, string>()
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value)
  }
  removeItem(key: string): void {
    this.store.delete(key)
  }
}

const originalSessionStorage = (globalThis as Record<string, unknown>).sessionStorage
let storage: MemoryStorage
beforeEach(() => {
  storage = new MemoryStorage()
  ;(globalThis as Record<string, unknown>).sessionStorage = storage
})
afterEach(() => {
  ;(globalThis as Record<string, unknown>).sessionStorage = originalSessionStorage
})

// ── 1. The routing brain ─────────────────────────────────────────────────────

describe('post-reset lock marker (task 1704 SLICE 2)', () => {
  test('markPasswordResetCompleted sets the marker; isPostResetLockedDevice reads it', async () => {
    const { markPasswordResetCompleted, isPostResetLockedDevice, POST_RESET_LOCK_KEY } =
      await import('../src/lib/post-reset-lock')
    expect(isPostResetLockedDevice()).toBe(false)
    markPasswordResetCompleted()
    expect(storage.getItem(POST_RESET_LOCK_KEY)).not.toBeNull()
    expect(isPostResetLockedDevice()).toBe(true)
  })

  test('clearPostResetLock removes it again (the escape hatch / unlock cleanup)', async () => {
    const {
      markPasswordResetCompleted,
      clearPostResetLock,
      isPostResetLockedDevice,
    } = await import('../src/lib/post-reset-lock')
    markPasswordResetCompleted()
    expect(isPostResetLockedDevice()).toBe(true)
    clearPostResetLock()
    expect(isPostResetLockedDevice()).toBe(false)
  })

  test('absent storage never throws and reads false (privacy modes, non-DOM)', async () => {
    ;(globalThis as Record<string, unknown>).sessionStorage = undefined
    const { isPostResetLockedDevice, markPasswordResetCompleted } = await import(
      '../src/lib/post-reset-lock'
    )
    expect(() => markPasswordResetCompleted()).not.toThrow()
    expect(isPostResetLockedDevice()).toBe(false)
  })

  test('a value left by something else counts only when it is the real marker value', async () => {
    const { POST_RESET_LOCK_KEY, isPostResetLockedDevice } = await import(
      '../src/lib/post-reset-lock'
    )
    storage.setItem(POST_RESET_LOCK_KEY, 'garbage')
    expect(isPostResetLockedDevice()).toBe(false)
  })
})

describe('resolveLockedVaultSurface() — the ProtectedRoute decision, pure', () => {
  test('impersonation wins FIRST: 1693 semantics preserved even with a reset marker', async () => {
    const { resolveLockedVaultSurface } = await import('../src/lib/post-reset-lock')
    expect(
      resolveLockedVaultSurface({ impersonating: true, postResetMarker: true, unlockFormRequested: false }),
    ).toBe('impersonated')
  })

  test('post-reset marker (no dismiss) → the honest no-key surface, NOT the password form', async () => {
    const { resolveLockedVaultSurface } = await import('../src/lib/post-reset-lock')
    expect(
      resolveLockedVaultSurface({ impersonating: false, postResetMarker: true, unlockFormRequested: false }),
    ).toBe('no_key')
  })

  test('escape hatch (unlockFormRequested) → the normal VaultUnlock password form', async () => {
    const { resolveLockedVaultSurface } = await import('../src/lib/post-reset-lock')
    expect(
      resolveLockedVaultSurface({ impersonating: false, postResetMarker: true, unlockFormRequested: true }),
    ).toBe('unlock_form')
  })

  test('no marker → the normal VaultUnlock password form (normal users untouched)', async () => {
    const { resolveLockedVaultSurface } = await import('../src/lib/post-reset-lock')
    expect(
      resolveLockedVaultSurface({ impersonating: false, postResetMarker: false, unlockFormRequested: false }),
    ).toBe('unlock_form')
  })
})

// ── 2. The wipe orchestration ("Delete all data") ────────────────────────────

/**
 * Server facts this orchestration must respect (verified on server main,
 * repos/server/beebeeb-api/src/routes/files.rs @ 1915063):
 *  - POST /api/v1/files/trash (bulkTrashFiles) trashes owned LIVE ids, capped
 *    at MAX_BULK_TRASH_IDS = 500 per request, cascades folders.
 *  - POST /api/v1/files/permanent (bulkPermanentDelete) erases owned ids that
 *    are ALREADY trashed (live ids are skipped), same 500 cap, gated by ONE
 *    single-use X-Confirm-Token per request (ConfirmedTrashAction).
 * So "wipe everything" = trash live ids, then erase in ≤500-id batches with a
 * fresh step-up token per batch, then RE-LIST and prove the server is empty
 * (a void response proves nothing — house evidence rule).
 */
describe('planFileWipe() — batch planning', () => {
  test('chunks ids into cap-sized batches, order preserved', async () => {
    const { planFileWipe } = await import('../src/lib/locked-state-exits')
    const ids = Array.from({ length: 1201 }, (_, i) => `id-${i}`)
    const batches = planFileWipe(ids, 500)
    expect(batches.length).toBe(3)
    expect(batches[0].length).toBe(500)
    expect(batches[1].length).toBe(500)
    expect(batches[2].length).toBe(201)
    expect(batches.flat()).toEqual(ids)
  })

  test('empty input → no batches', async () => {
    const { planFileWipe } = await import('../src/lib/locked-state-exits')
    expect(planFileWipe([], 500)).toEqual([])
  })

  test('duplicate ids are collapsed (folder + its child both listed)', async () => {
    const { planFileWipe } = await import('../src/lib/locked-state-exits')
    const batches = planFileWipe(['a', 'b', 'a', 'c', 'b'], 500)
    expect(batches).toEqual([['a', 'b', 'c']])
  })

  test('default cap is the server MAX_BULK_TRASH_IDS (500)', async () => {
    const { planFileWipe, WIPE_BATCH_CAP } = await import('../src/lib/locked-state-exits')
    expect(WIPE_BATCH_CAP).toBe(500)
    const ids = Array.from({ length: 501 }, (_, i) => `id-${i}`)
    expect(planFileWipe(ids).length).toBe(2)
  })
})

describe('executeDeleteAllData() — trash, erase per single-use token, verify empty', () => {
  async function run(deps: Record<string, unknown>) {
    const { executeDeleteAllData } = await import('../src/lib/locked-state-exits')
    return executeDeleteAllData(deps as never)
  }

  test('nothing on the server → verified empty, ZERO destructive calls, ZERO tokens consumed', async () => {
    const listFileIds = mock(async (_trashed: boolean) => [] as string[])
    const trashFiles = mock(async (_ids: string[]) => {})
    const permanentDelete = mock(async (_ids: string[], _t: string) => {})
    const nextToken = mock(async () => 'should-never-be-requested')

    const res = await run({
      listFileIds,
      trashFiles,
      permanentDelete,
      initialToken: 'token-1',
      nextToken,
    })

    expect(res.verifiedEmpty).toBe(true)
    expect(res.erased).toBe(0)
    expect(res.remaining).toBe(0)
    expect(trashFiles).not.toHaveBeenCalled()
    expect(permanentDelete).not.toHaveBeenCalled()
    expect(nextToken).not.toHaveBeenCalled()
  })

  test('small vault: trash live ids first, then ONE erase batch on the initial token, then re-list to verify', async () => {
    const calls: string[] = []
    const trashFiles = mock(async (ids: string[]) => {
      calls.push(`trash(${ids.length})`)
    })
    const permanentDelete = mock(async (ids: string[], token: string) => {
      calls.push(`erase(${ids.length},${token})`)
    })
    const tokens: string[] = []
    const listFileIds = mock(async (trashed: boolean) => {
      calls.push(`list(${trashed ? 'T' : 'L'})`)
      // before erase: 2 live + 1 trashed; after erase: nothing anywhere
      if (calls.filter((c) => c.startsWith('list')).length <= 2) {
        return trashed ? ['t1'] : ['l1', 'l2']
      }
      return []
    })

    const res = await run({
      listFileIds,
      trashFiles,
      permanentDelete,
      initialToken: 'tok-A',
      nextToken: async () => {
        tokens.push('x')
        return 'tok-x'
      },
    })

    expect(res.verifiedEmpty).toBe(true)
    expect(res.erased).toBe(3)
    expect(res.remaining).toBe(0)
    // trash step ran BEFORE the erase step, live ids only:
    expect(calls.indexOf('trash(2)')).toBeGreaterThan(-1)
    expect(calls.indexOf('erase(3,tok-A)')).toBeGreaterThan(calls.indexOf('trash(2)'))
    // the erase consumed exactly the initial single-use token:
    expect(tokens).toEqual([])
    expect(calls.filter((c) => c.startsWith('erase')).length).toBe(1)
  })

  test('601 ids → two erase batches; batches beyond the first each draw a FRESH token via nextToken()', async () => {
    const ALL = Array.from({ length: 601 }, (_, i) => `f${i}`)
    let lists = 0
    const listFileIds = mock(async (trashed: boolean) => {
      lists++
      if (lists <= 2) return trashed ? [] : ALL // pre-erase listing: all live
      return [] // post-erase verification: empty
    })
    const trashFiles = mock(async (_ids: string[]) => {})
    const batchSizes: number[] = []
    const tokensDrawn: string[] = []
    const permanentDelete = mock(async (ids: string[], token: string) => {
      batchSizes.push(ids.length)
      tokensDrawn.push(token)
      expect(ids.length).toBeLessThanOrEqual(500)
    })

    const res = await run({
      listFileIds,
      trashFiles,
      permanentDelete,
      initialToken: 'tok-1',
      nextToken: async () => `tok-${tokensDrawn.length + 1}`,
    })

    expect(res.verifiedEmpty).toBe(true)
    expect(res.erased).toBe(601)
    // 601 = 500 + 101 → two server-bounded batches:
    expect(batchSizes).toEqual([500, 101])
    // one single-use token per erase request — never reused:
    expect(tokensDrawn).toEqual(['tok-1', 'tok-2'])
  })

  test('1201 ids → three erase batches, three DISTINCT tokens', async () => {
    const ALL = Array.from({ length: 1201 }, (_, i) => `f${i}`)
    let lists = 0
    const listFileIds = mock(async (trashed: boolean) => {
      lists++
      return lists <= 2 ? (trashed ? [] : ALL) : []
    })
    const tokensDrawn: string[] = []
    const res = await run({
      listFileIds,
      trashFiles: async () => {},
      permanentDelete: async (_ids: string[], token: string) => {
        tokensDrawn.push(token)
      },
      initialToken: 'tok-1',
      nextToken: async () => `tok-${tokensDrawn.length + 1}`,
    })
    expect(res.verifiedEmpty).toBe(true)
    expect(res.erased).toBe(1201)
    expect(tokensDrawn).toEqual(['tok-1', 'tok-2', 'tok-3'])
  })

  test('progress is reported for trash and erase stages (honest working state)', async () => {
    const ALL = ['a', 'b']
    let lists = 0
    const listFileIds = mock(async (trashed: boolean) => {
      lists++
      return lists <= 2 ? (trashed ? [] : ALL) : []
    })
    const progress: string[] = []
    await run({
      listFileIds,
      trashFiles: async () => {},
      permanentDelete: async () => {},
      initialToken: 't',
      nextToken: async () => 't2',
      onProgress: (m: string) => progress.push(m),
    })
    expect(progress.length).toBeGreaterThan(0)
    expect(progress.join(' ')).toMatch(/eras|delet/i)
  })

  test('verification is HONEST: leftovers after erase → verifiedEmpty=false with the remaining count', async () => {
    const ALL = ['a', 'b']
    let lists = 0
    const listFileIds = mock(async (trashed: boolean) => {
      lists++
      // a hostile/failing server keeps reporting one live row forever
      return trashed ? [] : lists > 2 ? ['survivor'] : ALL
    })
    const res = await run({
      listFileIds,
      trashFiles: async () => {},
      permanentDelete: async () => {},
      initialToken: 't',
      nextToken: async () => 't2',
    })
    expect(res.verifiedEmpty).toBe(false)
    expect(res.remaining).toBe(1)
  })

  test('an error from the server propagates — the surface must show it, not fake success', async () => {
    const listFileIds = mock(async (_trashed: boolean) => ['a'])
    let caught: unknown = null
    try {
      await run({
        listFileIds,
        trashFiles: async () => {
          throw new Error('507 storage down')
        },
        permanentDelete: async () => {},
        initialToken: 't',
        nextToken: async () => 't2',
      })
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(Error)
    expect((caught as Error).message).toBe('507 storage down')
  })
})