import { describe, test, expect, mock } from 'bun:test'
import { buildApprovalKeyBlob, type ApproveKeyCryptoPorts } from '../src/lib/approve-invite-crypto'

/**
 * Task 1545, finding 1 — "Manually-approved folder-share invites store the
 * wrong key."
 *
 * share-approve.tsx's handleApprove() used to ALWAYS wrap
 * getFileKey(invite.file_id) (a deterministic deriveFileKey(masterKey,
 * fileId)) regardless of invite.is_folder_share, instead of the RANDOM
 * folderKey generated at invite-creation time that every child file's key
 * is wrapped under. buildApprovalKeyBlob() is the extracted, injectable-
 * crypto version of that logic — these tests pin its behavior for both
 * branches without needing the WASM crypto worker (not loadable under
 * `bun test`, per test/transfer-crypto.test.ts's header comment).
 */

const masterKey = new Uint8Array(32).fill(7)
const recipientPubKey = new Uint8Array(32).fill(9)
const folderId = 'folder-abc-123'
// The RANDOM folder key generated at invite-creation time — the ONLY key
// every child file's key is actually wrapped under (encryptChildFileKey).
const realFolderKey = new Uint8Array(32).fill(42)
const ownerEncryptedFolderKeyB64 = 'b3duZXItYmxvYg=='
const ownerEncryptedFolderKeyBytes = new Uint8Array([1, 2, 3, 4]) // whatever fromBase64 decodes it to

function throwingPort(name: string) {
  return mock(async () => {
    throw new Error(`${name} must not be called on this branch`)
  })
}

describe('buildApprovalKeyBlob — folder-share branch (1545#1)', () => {
  test('recovers the REAL folder key via the legacy invite owner copy (no custody record) and wraps THAT for the recipient — never derives from getFileKey', async () => {
    const legacyInviteOwnerKey = mock(async (mk: Uint8Array, fid: string, blob: Uint8Array) => {
      expect(mk).toBe(masterKey)
      expect(fid).toBe(folderId)
      expect(Array.from(blob)).toEqual(Array.from(ownerEncryptedFolderKeyBytes))
      return realFolderKey.slice()
    })
    const encryptFolderKeyForRecipient = mock(
      async (mk: Uint8Array, pub: Uint8Array, fid: string, folderKey: Uint8Array) => {
        expect(mk).toBe(masterKey)
        expect(pub).toBe(recipientPubKey)
        expect(fid).toBe(folderId)
        // THE regression guard: the key wrapped for the recipient must be
        // EXACTLY the folder key the owner copy opened to — not a
        // fresh deterministic value derived from fid/masterKey alone.
        expect(Array.from(folderKey)).toEqual(Array.from(realFolderKey))
        return new Uint8Array([9, 9, 9, 9])
      },
    )
    const getFileKey = mock(async (_id: string) => {
      throw new Error('getFileKey must never be called for a folder-share invite (finding 1545#1)')
    })

    const ports: ApproveKeyCryptoPorts = {
      custodyFolderKey: mock(async () => null),
      legacyInviteOwnerKey,
      encryptFolderKeyForRecipient,
      encryptFileKeyForSharing: throwingPort('encryptFileKeyForSharing'),
      fromBase64: (b64: string) => {
        expect(b64).toBe(ownerEncryptedFolderKeyB64)
        return ownerEncryptedFolderKeyBytes
      },
      zeroize: () => {},
    }

    const result = await buildApprovalKeyBlob(
      {
        file_id: folderId,
        is_folder_share: true,
        encrypted_owner_folder_key: ownerEncryptedFolderKeyB64,
      },
      masterKey,
      recipientPubKey,
      getFileKey,
      ports,
    )

    expect(getFileKey).not.toHaveBeenCalled()
    expect(legacyInviteOwnerKey).toHaveBeenCalledTimes(1)
    expect(encryptFolderKeyForRecipient).toHaveBeenCalledTimes(1)
    expect(Array.from(result)).toEqual([9, 9, 9, 9])
  })

  test('a folder-share invite with no encrypted_owner_folder_key throws instead of silently using the wrong key', async () => {
    const getFileKey = mock(async (_id: string) => {
      throw new Error('getFileKey must never be called for a folder-share invite')
    })
    const ports: ApproveKeyCryptoPorts = {
      custodyFolderKey: mock(async () => null),
      legacyInviteOwnerKey: throwingPort('legacyInviteOwnerKey'),
      encryptFolderKeyForRecipient: throwingPort('encryptFolderKeyForRecipient'),
      encryptFileKeyForSharing: throwingPort('encryptFileKeyForSharing'),
      fromBase64: () => new Uint8Array(),
      zeroize: () => {},
    }

    await expect(
      buildApprovalKeyBlob(
        { file_id: folderId, is_folder_share: true, encrypted_owner_folder_key: undefined },
        masterKey,
        recipientPubKey,
        getFileKey,
        ports,
      ),
    ).rejects.toThrow(/missing its owner folder key/)
    expect(getFileKey).not.toHaveBeenCalled()
  })

  test('L6/L7b: a folder with a custody record approves with the custody key; the invite copy is never opened', async () => {
    const custodyKey = new Uint8Array(32).fill(0x6c)
    const encryptFolderKeyForRecipient = mock(
      async (_mk: Uint8Array, _pub: Uint8Array, _fid: string, folderKey: Uint8Array) => {
        expect(Array.from(folderKey)).toEqual(Array.from(custodyKey))
        return new Uint8Array([7, 7])
      },
    )
    const ports: ApproveKeyCryptoPorts = {
      custodyFolderKey: mock(async (_mk: Uint8Array, fid: string) => {
        expect(fid).toBe(folderId)
        return { folderKey: custodyKey.slice(), encryptedOwnerFolderKeyB64: 'custody' }
      }),
      legacyInviteOwnerKey: throwingPort('legacyInviteOwnerKey'),
      encryptFolderKeyForRecipient,
      encryptFileKeyForSharing: throwingPort('encryptFileKeyForSharing'),
      fromBase64: () => new Uint8Array(),
      zeroize: () => {},
    }
    const result = await buildApprovalKeyBlob(
      { file_id: folderId, is_folder_share: true, encrypted_owner_folder_key: ownerEncryptedFolderKeyB64 },
      masterKey,
      recipientPubKey,
      async () => {
        throw new Error('never')
      },
      ports,
    )
    expect(Array.from(result)).toEqual([7, 7])
    expect(encryptFolderKeyForRecipient).toHaveBeenCalledTimes(1)
  })
})

describe('buildApprovalKeyBlob — single-file branch (unchanged, regression guard)', () => {
  test('a non-folder invite still uses getFileKey + encryptFileKeyForSharing, never touches the folder-key ports', async () => {
    const fileId = 'file-xyz'
    const fileKey = new Uint8Array(32).fill(3)
    const getFileKey = mock(async (id: string) => {
      expect(id).toBe(fileId)
      return fileKey.slice()
    })
    const encryptFileKeyForSharing = mock(
      async (mk: Uint8Array, pub: Uint8Array, fid: string, fk: Uint8Array) => {
        expect(mk).toBe(masterKey)
        expect(pub).toBe(recipientPubKey)
        expect(fid).toBe(fileId)
        expect(Array.from(fk)).toEqual(Array.from(fileKey))
        return { encryptedFileKey: new Uint8Array([5, 5]), nonce: new Uint8Array([1, 1, 1]) }
      },
    )
    const ports: ApproveKeyCryptoPorts = {
      custodyFolderKey: throwingPort('custodyFolderKey'),
      legacyInviteOwnerKey: throwingPort('legacyInviteOwnerKey'),
      encryptFolderKeyForRecipient: throwingPort('encryptFolderKeyForRecipient'),
      encryptFileKeyForSharing,
      fromBase64: () => new Uint8Array(),
      zeroize: () => {},
    }

    const result = await buildApprovalKeyBlob(
      { file_id: fileId, is_folder_share: false, encrypted_owner_folder_key: undefined },
      masterKey,
      recipientPubKey,
      getFileKey,
      ports,
    )

    expect(getFileKey).toHaveBeenCalledTimes(1)
    expect(encryptFileKeyForSharing).toHaveBeenCalledTimes(1)
    // nonce || ciphertext, in that order
    expect(Array.from(result)).toEqual([1, 1, 1, 5, 5])
  })

  test('is_folder_share undefined (older invite shape) is treated as a single-file share', async () => {
    const fileId = 'file-legacy'
    const getFileKey = mock(async () => new Uint8Array(32).fill(1))
    const encryptFileKeyForSharing = mock(async () => ({
      encryptedFileKey: new Uint8Array([1]),
      nonce: new Uint8Array([2]),
    }))
    const ports: ApproveKeyCryptoPorts = {
      custodyFolderKey: throwingPort('custodyFolderKey'),
      legacyInviteOwnerKey: throwingPort('legacyInviteOwnerKey'),
      encryptFolderKeyForRecipient: throwingPort('encryptFolderKeyForRecipient'),
      encryptFileKeyForSharing,
      fromBase64: () => new Uint8Array(),
      zeroize: () => {},
    }

    await buildApprovalKeyBlob(
      { file_id: fileId, is_folder_share: undefined, encrypted_owner_folder_key: undefined },
      masterKey,
      recipientPubKey,
      getFileKey,
      ports,
    )

    expect(getFileKey).toHaveBeenCalledTimes(1)
    expect(encryptFileKeyForSharing).toHaveBeenCalledTimes(1)
  })
})
