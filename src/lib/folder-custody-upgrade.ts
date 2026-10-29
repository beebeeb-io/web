/**
 * Task 2237b, decision L7b (a), contract 2237 §2: the custody upgrade of a
 * folder that was shared before custody existed (a flag-off invite share). Its
 * child rows are in the legacy (unbound) format, so it gets no fresh custody
 * (409 `upgrade_required`); the upgrade is its only way to custody. It
 * re-seals every row as L7 and registers custody in one atomic call (server
 * #353), so the owner, members and guests keep reading every existing item.
 *
 * The folder key is the risky part. Members already hold it, so the upgrade
 * must keep it, and the owner's copy on a flag-off invite is the legacy one,
 * opened under the folder-NAME key: a server can pass the folder's own name
 * blob off as one (rv-web198c P1-2). So this module never trusts that copy on
 * its own. Its ONE key source is `verifyLegacyFolderKey`: one of the folder's
 * invite owner copies that opens in core's purpose-bound format, or a legacy
 * copy that core PROVES over the folder's rows (task 2255, decision L9,
 * openLegacyInviteOwnerCopy). No proof, no upgrade: FOLDER_KEY_UNVERIFIED.
 *
 * Nothing is ever written unless every row opens under the proven key: a row
 * under another key may be another invite's, which a member can still read.
 * Only counts are logged, never an id or a name. And no upgrade runs under a
 * folder this device has seen with custody (L7d): reading its legacy rows is
 * exactly the downgrade the custody memory exists to refuse.
 */
import {
  getFile,
  getSentInvites,
  getSharedFolder,
  listLegacyFolderKeys,
  upgradeSharedFolderCustody,
  type LegacyFolderKeyRow,
  type ShareInvite,
  type SharedFolderInfo,
} from './api'
import { fromBase64, toBase64, zeroize } from './crypto'
import {
  FOLDER_KEY_UNVERIFIED,
  legacyInviteChildKey,
  openFolderCustody,
  openOwnerCopyOverRows,
  sealChildKey,
  sealFolderCustody,
} from './folder-share-crypto'
import { FolderUpgradeRefusedError, type FolderUpgradeRunner } from './folder-upgrade'
import { assertNoSeenAncestor } from './custody-memory'

export type { LegacyFolderKeyRow }

/** Shown when a row is sealed under another key: replacing it could lock a member out. */
export const FOLDER_ROWS_UNOPENED = "Part of this folder was shared under another key, so it can't be upgraded."

/** Shown when the folder has more rows than one atomic upgrade takes. */
export const FOLDER_TOO_LARGE_TO_UPGRADE = 'This folder holds too many items to upgrade in one step.'

/**
 * The upgrade's only key source: the folder key, PROVEN against the folder's
 * legacy rows (all of them are passed, so the proof can run over any row in
 * one call, as core's L9 verifier does). Resolves to a key the caller owns and
 * zeroizes; throws FolderUpgradeRefusedError('key_unverified') otherwise.
 */
export type LegacyFolderKeyVerifier = (
  masterKey: Uint8Array,
  folderId: string,
  rows: readonly LegacyFolderKeyRow[],
) => Promise<Uint8Array>

export interface CoreVerifierPorts {
  getSentInvites: () => Promise<ShareInvite[]>
  /** The 2255 rule over the given rows (folder-share-crypto `openOwnerCopyOverRows`). */
  openOwnerCopy: (
    masterKey: Uint8Array,
    folderId: string,
    blob: Uint8Array,
    rows: { file_id: string; encrypted_file_key: string }[],
  ) => Promise<Uint8Array | null>
}

/**
 * The verifier on core (task 2255, L9): the owner copies of this folder's
 * invites, newest first and of any status (proof, not status, decides, and a
 * denied invite's copy is still the folder's key), each opened by the 2255
 * rule over the folder's legacy rows. The first that opens is the key. None:
 * FolderUpgradeRefusedError('key_unverified'). Core reads at most 64 distinct
 * row ids, so a folder whose first 64 listed rows hold no owner-written row
 * can't be proven and stays legacy (refused, nothing written).
 */
export function createCoreLegacyFolderKeyVerifier(overrides: Partial<CoreVerifierPorts> = {}): LegacyFolderKeyVerifier {
  const ports: CoreVerifierPorts = {
    getSentInvites: () => getSentInvites(),
    openOwnerCopy: (...a) => openOwnerCopyOverRows(...a),
    ...overrides,
  }
  return async (masterKey, folderId, rows) => {
    const copies = [
      ...new Set(
        (await ports.getSentInvites())
          .filter((i) => i.is_folder_share && i.file_id === folderId && !!i.encrypted_owner_folder_key)
          .sort((x, y) => (x.created_at < y.created_at ? 1 : x.created_at > y.created_at ? -1 : 0))
          .map((i) => i.encrypted_owner_folder_key as string),
      ),
    ]
    // Core reads exactly these two fields of each row.
    const proofRows = rows.map(({ file_id, encrypted_file_key }) => ({ file_id, encrypted_file_key }))
    for (const b64 of copies) {
      const key = await ports.openOwnerCopy(masterKey, folderId, fromBase64(b64), proofRows)
      if (key) return key
    }
    throw new FolderUpgradeRefusedError('key_unverified', FOLDER_KEY_UNVERIFIED)
  }
}

/** The real verifier (REAL_CUSTODY_UPGRADE_PORTS). */
export const verifyLegacyFolderKeyWithCore: LegacyFolderKeyVerifier = createCoreLegacyFolderKeyVerifier()

export interface CustodyUpgradePorts {
  verifyLegacyFolderKey: LegacyFolderKeyVerifier
  listLegacyFolderKeys: (folderId: string) => Promise<LegacyFolderKeyRow[]>
  upgradeSharedFolderCustody: typeof upgradeSharedFolderCustody
  getSharedFolder: (folderId: string) => Promise<SharedFolderInfo>
  /** A folder's parent, for the L7d ancestor check. */
  parentOf: (id: string) => Promise<string | null>
}

// Resolved at call time, so a module mock registered later always applies.
export const REAL_CUSTODY_UPGRADE_PORTS: CustodyUpgradePorts = {
  verifyLegacyFolderKey: verifyLegacyFolderKeyWithCore,
  listLegacyFolderKeys: (...a) => listLegacyFolderKeys(...a),
  upgradeSharedFolderCustody: (...a) => upgradeSharedFolderCustody(...a),
  getSharedFolder: (...a) => getSharedFolder(...a),
  parentOf: async (id) => (await getFile(id)).parent_id ?? null,
}

function errorCode(err: unknown): string | undefined {
  const code = (err as { code?: unknown } | null | undefined)?.code
  return typeof code === 'string' ? code : undefined
}

function errorStatus(err: unknown): unknown {
  return (err as { status?: unknown } | null | undefined)?.status
}

/** How often the rows are listed and re-sealed when they change underneath (409 rewrap_incomplete). */
const UPGRADE_ATTEMPTS = 2

/**
 * Every row re-sealed L7 for its own (root, item, kind), or a refusal. All or
 * nothing: one row that does not open under `folderKey` refuses the upgrade.
 */
async function resealRows(
  folderId: string,
  folderKey: Uint8Array,
  rows: readonly LegacyFolderKeyRow[],
): Promise<{ file_id: string; encrypted_file_key: string }[]> {
  const keys: { file_id: string; encrypted_file_key: string }[] = []
  let unopened = 0
  for (const row of rows) {
    let childKey: Uint8Array
    try {
      childKey = await legacyInviteChildKey(folderKey, row.encrypted_file_key)
    } catch {
      unopened += 1
      continue
    }
    try {
      keys.push({
        file_id: row.file_id,
        encrypted_file_key: await sealChildKey(folderKey, { rootId: folderId, itemId: row.file_id, isFolder: row.is_folder }, childKey),
      })
    } finally {
      zeroize(childKey)
    }
  }
  if (unopened > 0) {
    console.warn('[custody-upgrade] folder stays legacy: rows that do not open under its key', { count: unopened })
    throw new FolderUpgradeRefusedError('rows_unopened', FOLDER_ROWS_UNOPENED)
  }
  return keys
}

/** Another device upgraded first: its custody record is the truth (L6), never overwritten. */
async function openExistingCustody(folderId: string, masterKey: Uint8Array, ports: CustodyUpgradePorts, cause: unknown): Promise<Uint8Array> {
  const wrapped = (await ports.getSharedFolder(folderId)).owner_wrapped_folder_key
  if (!wrapped) throw cause
  return openFolderCustody(masterKey, folderId, fromBase64(wrapped))
}

/** The runner REAL_FOLDER_LINK_PORTS.upgradeLegacyFolder uses (contract §2). */
export function createCustodyUpgrade(ports: CustodyUpgradePorts = REAL_CUSTODY_UPGRADE_PORTS): FolderUpgradeRunner {
  return async (folderId, masterKey) => {
    // L7d: opening legacy rows is a legacy read, refused under any folder (this
    // one or an ancestor) this device has seen with custody.
    await assertNoSeenAncestor(folderId, ports.parentOf)
    for (let attempt = 1; ; attempt += 1) {
      let rows: LegacyFolderKeyRow[]
      try {
        rows = await ports.listLegacyFolderKeys(folderId)
      } catch (err) {
        if (errorCode(err) === 'custody_exists') return openExistingCustody(folderId, masterKey, ports, err)
        if (errorStatus(err) === 413) throw new FolderUpgradeRefusedError('too_large', FOLDER_TOO_LARGE_TO_UPGRADE)
        throw err
      }
      const folderKey = await ports.verifyLegacyFolderKey(masterKey, folderId, rows)
      try {
        const keys = await resealRows(folderId, folderKey, rows)
        const ownerWrappedFolderKey = toBase64(await sealFolderCustody(masterKey, folderId, folderKey))
        await ports.upgradeSharedFolderCustody(folderId, { ownerWrappedFolderKey, keys })
        return folderKey
      } catch (err) {
        zeroize(folderKey)
        // A row was added or removed between the listing and the call:
        // nothing changed, so list, prove and re-seal once more.
        if (errorCode(err) === 'rewrap_incomplete' && attempt < UPGRADE_ATTEMPTS) continue
        if (errorCode(err) === 'custody_exists') return openExistingCustody(folderId, masterKey, ports, err)
        if (errorStatus(err) === 413) throw new FolderUpgradeRefusedError('too_large', FOLDER_TOO_LARGE_TO_UPGRADE)
        throw err
      }
    }
  }
}
