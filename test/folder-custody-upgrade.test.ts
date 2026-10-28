/**
 * Task 2237b, L7b (a) and contract 2237 §2: the custody upgrade of a folder
 * whose legacy (unbound) rows predate custody. Web #199, reworked onto #198.
 *
 * The upgrade's ONE key source is a folder key this client can prove
 * (`verifyLegacyFolderKey`). The legacy invite owner copy is never trusted on
 * its own (rv-web198c P1-2: a server can pass the folder's name blob off as
 * it). Until task 2255's verified read (L9) lands, the real verifier refuses
 * with FOLDER_KEY_UNVERIFIED, so the upgrade refuses honestly. These tests
 * drive the runner with a stand-in verifier to pin everything after it.
 */
import { beforeEach, describe, expect, test } from 'bun:test'
import { mockModuleScoped } from './helpers/scoped-module-mock'
import { ownedFolderCrypto } from './helpers/owned-folder-wasm'
import { loadWasm } from './helpers/wasm-crypto-mirror'

const wasm = loadWasm()
await mockModuleScoped('../src/lib/crypto', import.meta.dir, (r) => ({ ...r, ...ownedFolderCrypto() }))

const { createCustodyUpgrade, REAL_CUSTODY_UPGRADE_PORTS, verifyLegacyFolderKeyUnavailable } = await import(
  '../src/lib/folder-custody-upgrade'
)
type CustodyUpgradePorts = import('../src/lib/folder-custody-upgrade').CustodyUpgradePorts
type LegacyFolderKeyRow = import('../src/lib/folder-custody-upgrade').LegacyFolderKeyRow
const { FolderUpgradeRefusedError } = await import('../src/lib/folder-upgrade')
const share = await import('../src/lib/folder-share-crypto')
const { fromBase64, toBase64 } = await import('../src/lib/crypto')

const MASTER = new Uint8Array(32).fill(7)
const ROOT = '11111111-1111-4111-8111-111111111111'
const CHILD_FILE = '22222222-2222-4222-8222-222222222222'
const CHILD_FOLDER = '33333333-3333-4333-8333-333333333333'
const FOLDER_KEY = new Uint8Array(32).fill(0x5a)
const OTHER_KEY = new Uint8Array(32).fill(0x77)
const FILE_KEY = new Uint8Array(32).fill(0x61)
const NAME_KEY = new Uint8Array(32).fill(0x62)

async function legacyRow(key: Uint8Array, id: string, isFolder: boolean, child: Uint8Array): Promise<LegacyFolderKeyRow> {
  return { file_id: id, encrypted_file_key: await share.legacyInviteChildWrap(key, child), is_folder: isFolder }
}

type UpgradeBody = { ownerWrappedFolderKey: string; keys: { file_id: string; encrypted_file_key: string }[] }

let listings: LegacyFolderKeyRow[][] = []
let listed = 0
let sent: UpgradeBody[] = []
let upgradeAnswers: Array<'ok' | 'rewrap_incomplete' | 'custody_exists'> = []
let verifierCalls: Array<{ folderId: string; rows: readonly LegacyFolderKeyRow[] }> = []
let verifiedKeys: Uint8Array[] = []

function ports(overrides: Partial<CustodyUpgradePorts> = {}): CustodyUpgradePorts {
  return {
    ...REAL_CUSTODY_UPGRADE_PORTS,
    // A stand-in for task 2255: it "proves" FOLDER_KEY. The real one refuses.
    verifyLegacyFolderKey: async (_master, folderId, rows) => {
      verifierCalls.push({ folderId, rows })
      const key = new Uint8Array(FOLDER_KEY)
      verifiedKeys.push(key)
      return key
    },
    listLegacyFolderKeys: async () => listings[Math.min(listed++, listings.length - 1)],
    upgradeSharedFolderCustody: async (_folderId, body) => {
      sent.push(body)
      const answer = upgradeAnswers.shift() ?? 'ok'
      if (answer !== 'ok') throw Object.assign(new Error(answer), { status: 409, code: answer })
      return { created: true, key_version: 1, rewrapped: body.keys.length }
    },
    getSharedFolder: async (folderId) => ({
      folder_id: folderId,
      role: 'owner',
      access_level: 'edit',
      key_version: 1,
      owner_wrapped_folder_key: toBase64(wasm.wrapFolderCustody(MASTER, folderId, OTHER_KEY) as Uint8Array),
      wrapped_folder_key: null,
    }),
    ...overrides,
  }
}

beforeEach(async () => {
  listings = [[
    await legacyRow(FOLDER_KEY, CHILD_FILE, false, FILE_KEY),
    await legacyRow(FOLDER_KEY, CHILD_FOLDER, true, NAME_KEY),
  ]]
  listed = 0
  sent = []
  upgradeAnswers = []
  verifierCalls = []
  verifiedKeys = []
})

describe('the upgrade has one key source, a key this client can prove (P1-2 / task 2255)', () => {
  test('today the real verifier refuses: FOLDER_KEY_UNVERIFIED, nothing sealed, nothing sent', async () => {
    const run = createCustodyUpgrade(ports({ verifyLegacyFolderKey: verifyLegacyFolderKeyUnavailable }))
    const err = await run(ROOT, MASTER).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(FolderUpgradeRefusedError)
    expect((err as InstanceType<typeof FolderUpgradeRefusedError>).reason).toBe('key_unverified')
    expect((err as Error).message).toBe(share.FOLDER_KEY_UNVERIFIED)
    expect(sent).toHaveLength(0)
  })

  test('the real ports use that refusing verifier (nothing seeds custody from the legacy owner copy)', () => {
    expect(REAL_CUSTODY_UPGRADE_PORTS.verifyLegacyFolderKey).toBe(verifyLegacyFolderKeyUnavailable)
  })

  test('the verifier gets the listed rows, so 2255 can prove the key against them in one call', async () => {
    await createCustodyUpgrade(ports())(ROOT, MASTER)
    expect(verifierCalls).toHaveLength(1)
    expect(verifierCalls[0].folderId).toBe(ROOT)
    expect(verifierCalls[0].rows.map((r) => r.file_id)).toEqual([CHILD_FILE, CHILD_FOLDER])
  })

  test('the module never names the unverified owner-copy readers', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const text = readFileSync(join(import.meta.dir, '..', 'src/lib/folder-custody-upgrade.ts'), 'utf8')
    expect(text).not.toContain('findExistingFolderKey')
    expect(text).not.toContain('legacyInviteOwnerKey')
  })
})

describe('with a proven key: one atomic L7 write (contract §1 and §2)', () => {
  test('every legacy row is re-sealed L7 for its own id and kind; custody is L6; the body says format "l7"', async () => {
    const key = await createCustodyUpgrade(ports())(ROOT, MASTER)
    expect(Array.from(key)).toEqual(Array.from(FOLDER_KEY))
    expect(sent).toHaveLength(1)
    const body = sent[0]
    // The custody record opens under the L6 key to the proven folder key.
    expect(Array.from(wasm.unwrapFolderCustody(MASTER, ROOT, fromBase64(body.ownerWrappedFolderKey)) as Uint8Array)).toEqual(Array.from(FOLDER_KEY))
    const byId = new Map(body.keys.map((k) => [k.file_id, fromBase64(k.encrypted_file_key)]))
    expect(Array.from(wasm.unwrapFolderChild(FOLDER_KEY, ROOT, CHILD_FILE, 1, byId.get(CHILD_FILE)!) as Uint8Array)).toEqual(Array.from(FILE_KEY))
    expect(Array.from(wasm.unwrapFolderChild(FOLDER_KEY, ROOT, CHILD_FOLDER, 2, byId.get(CHILD_FOLDER)!) as Uint8Array)).toEqual(Array.from(NAME_KEY))
    // The kind is bound: the file row is not a folder row.
    expect(() => wasm.unwrapFolderChild(FOLDER_KEY, ROOT, CHILD_FILE, 2, byId.get(CHILD_FILE)!)).toThrow(/decryption failed/)
    // Re-sealed, so the legacy reader no longer opens any of them.
    for (const k of body.keys) await expect(share.legacyInviteChildKey(FOLDER_KEY, k.encrypted_file_key)).rejects.toThrow()
  })

  test('a folder whose rows are all gone still sends the upgrade (empty rewrap), never a plain registration', async () => {
    listings = [[]]
    await createCustodyUpgrade(ports())(ROOT, MASTER)
    expect(sent).toHaveLength(1)
    expect(sent[0].keys).toEqual([])
  })
})

describe('refusals and races', () => {
  test('one row under another key: nothing is sent, a count-only log, the refusal names the cause, the key is zeroized', async () => {
    listings = [[
      await legacyRow(FOLDER_KEY, CHILD_FILE, false, FILE_KEY),
      await legacyRow(OTHER_KEY, CHILD_FOLDER, true, NAME_KEY),
    ]]
    const warnings: unknown[][] = []
    const originalWarn = console.warn
    console.warn = (...args: unknown[]) => void warnings.push(args)
    let err: unknown
    try {
      err = await createCustodyUpgrade(ports())(ROOT, MASTER).catch((e: unknown) => e)
    } finally {
      console.warn = originalWarn
    }
    expect(err).toBeInstanceOf(FolderUpgradeRefusedError)
    expect((err as InstanceType<typeof FolderUpgradeRefusedError>).reason).toBe('rows_unopened')
    expect(sent).toHaveLength(0)
    expect(warnings).toHaveLength(1)
    const logged = JSON.stringify(warnings[0])
    expect(logged).toContain('"count":1')
    expect(logged).not.toContain(CHILD_FILE)
    expect(logged).not.toContain(CHILD_FOLDER)
    expect(verifiedKeys[0].every((b) => b === 0)).toBe(true)
  })

  test('413 from the listing (over the one-call cap): refused as too large, nothing sent', async () => {
    const run = createCustodyUpgrade(ports({
      listLegacyFolderKeys: async () => {
        throw Object.assign(new Error('too many'), { status: 413 })
      },
    }))
    const err = await run(ROOT, MASTER).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(FolderUpgradeRefusedError)
    expect((err as InstanceType<typeof FolderUpgradeRefusedError>).reason).toBe('too_large')
    expect(sent).toHaveLength(0)
  })

  test('409 rewrap_incomplete (a row added meanwhile): listed, proven and re-sealed once more', async () => {
    listings = [listings[0].slice(0, 1), listings[0]]
    upgradeAnswers = ['rewrap_incomplete']
    await createCustodyUpgrade(ports())(ROOT, MASTER)
    expect(listed).toBe(2)
    expect(verifierCalls).toHaveLength(2)
    expect(sent.map((b) => b.keys.length)).toEqual([1, 2])
    // The key of the refused attempt does not outlive it.
    expect(verifiedKeys[0].every((b) => b === 0)).toBe(true)
  })

  test('409 rewrap_incomplete twice: surfaced, never looped', async () => {
    upgradeAnswers = ['rewrap_incomplete', 'rewrap_incomplete']
    await expect(createCustodyUpgrade(ports())(ROOT, MASTER)).rejects.toThrow('rewrap_incomplete')
    expect(sent).toHaveLength(2)
  })

  test('409 custody_exists from the listing (upgraded meanwhile): the record is read and opened, nothing proven or sent', async () => {
    const key = await createCustodyUpgrade(ports({
      listLegacyFolderKeys: async () => {
        throw Object.assign(new Error('custody exists'), { status: 409, code: 'custody_exists' })
      },
    }))(ROOT, MASTER)
    expect(Array.from(key)).toEqual(Array.from(OTHER_KEY))
    expect(verifierCalls).toHaveLength(0)
    expect(sent).toHaveLength(0)
  })

  test('a refusal reads as its own sentence, never the generic retry line', async () => {
    const { userFriendlyError } = await import('../src/lib/user-friendly-error')
    const { createLinkErrorMessage } = await import('../src/components/folder-share/create-link-form')
    for (const reason of ['key_unverified', 'rows_unopened', 'too_large'] as const) {
      const err = new FolderUpgradeRefusedError(reason, `sentence for ${reason}`)
      expect(userFriendlyError(err)).toBe(`sentence for ${reason}`)
      expect(createLinkErrorMessage(err)).toBe(`sentence for ${reason}`)
    }
  })

  test("409 custody_exists (another device upgraded first): its record is read and opened (L6), never overwritten", async () => {
    upgradeAnswers = ['custody_exists']
    const key = await createCustodyUpgrade(ports())(ROOT, MASTER)
    expect(Array.from(key)).toEqual(Array.from(OTHER_KEY))
    expect(sent).toHaveLength(1)
    expect(verifiedKeys[0].every((b) => b === 0)).toBe(true)
  })
})
