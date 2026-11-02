// Decrypts file names for the list and caches them by file id.
import { useEffect, useState } from 'react'
import { useKeys } from '../../lib/key-context'
import { decryptManyNames } from '../../lib/crypto'
import type { DriveFile } from '../../lib/api'

/**
 * Decrypted display names for a file list (moved out of `FileList` by W-P2-4).
 *
 * `decryptedNames[id]` semantics:
 *   undefined  →  not yet decrypted (show skeleton in UI)
 *   string     →  successfully decrypted name
 *   null       →  decryption failed (show "Encrypted file" placeholder)
 *
 * NEVER fall back to `file.name_encrypted` — that exposes raw JSON ciphertext
 * to users and is the bug this fix addresses.
 */
export type DecryptedNames = Record<string, string | null>

export function useDecryptedNames(
  files: DriveFile[],
  externalDecryptedNames?: Record<string, string>,
): DecryptedNames {
  const { getFileKeyForFile, isUnlocked } = useKeys()
  const [decryptedNames, setDecryptedNames] = useState<DecryptedNames>({})

  useEffect(() => {
    if (externalDecryptedNames !== undefined) {
      setDecryptedNames(externalDecryptedNames)
      return
    }
    if (!isUnlocked) {
      setDecryptedNames({})
      return
    }
    if (files.length === 0) {
      setDecryptedNames({})
      return
    }
    let cancelled = false

    // Retry transient failures (commonly: WASM still initializing when the
    // first render fires, a brief master-key handoff race, or — for folders
    // created on iOS — the file-key being derived from a different KDF path
    // that races with the web key cache warm-up). Four attempts with mild
    // backoff costs at most ~1.5s before we surface the encrypted placeholder.
    const MAX_ATTEMPTS = 4
    const RETRY_DELAY_MS = 300

    // Per-file decryption is split into two phases so we can collapse N
    // worker round-trips into 1:
    //   1) Key derivation runs on the main thread in parallel (cheap, cached).
    //   2) The decrypt is one batched Comlink call to the worker, which reads
    //      every envelope with core's name reader (name subkey first, then the
    //      legacy raw key; task 1943).
    //
    // Errors are tracked per file: a key-derivation failure for one row never
    // blocks the others, and the worker's batched call also reports errors
    // per-item (an unparsable or unopenable envelope included).
    type Prepared =
      | { id: string; status: 'ok'; fileKey: Uint8Array; nameEncrypted: string }
      | { id: string; status: 'plaintext'; name: string }
      | { id: string; status: 'error'; error: unknown }

    async function prepareOne(file: DriveFile): Promise<Prepared> {
      // Legacy format (iOS before 930c61a): plain-text name, not JSON-encrypted.
      if (!file.name_encrypted.startsWith('{')) {
        return { id: file.id, status: 'plaintext', name: file.name_encrypted }
      }
      try {
        // A file another person added to a shared folder is sealed under a key
        // this account cannot derive; getFileKeyForFile takes the folder-key
        // path for it (owner wrap, then `shared_folder_keys` under the shared
        // ROOT), the same path download, rename and zip use (task 2237b).
        const fileKey = await getFileKeyForFile(file)
        return { id: file.id, status: 'ok', fileKey, nameEncrypted: file.name_encrypted }
      } catch (err) {
        return { id: file.id, status: 'error', error: err }
      }
    }

    async function decryptAll() {
      const names: Record<string, string | null> = {}
      const errors = new Map<string, unknown>()
      // Files that still need a retry pass — initialized to all files, then
      // narrowed each attempt to only those that failed.
      let pending: DriveFile[] = files.slice()

      for (let attempt = 0; attempt < MAX_ATTEMPTS && pending.length > 0; attempt++) {
        if (cancelled) return

        // Phase 1: derive keys in parallel.
        const prepared = await Promise.all(pending.map(prepareOne))
        if (cancelled) return

        // Phase 2: one batched worker call for all rows that made it to "ok".
        const batchInput = prepared
          .filter((p): p is Extract<Prepared, { status: 'ok' }> => p.status === 'ok')
          .map(({ id, fileKey, nameEncrypted }) => ({ id, fileKey, nameEncrypted }))

        let batchResults: Awaited<ReturnType<typeof decryptManyNames>> = []
        if (batchInput.length > 0) {
          try {
            batchResults = await decryptManyNames(batchInput)
          } catch (err) {
            // Whole-batch failure (worker crash, comlink disconnect, …) — treat
            // every item in this batch as failed so the retry loop covers them.
            for (const item of batchInput) errors.set(item.id, err)
          }
        }
        if (cancelled) return

        const resultById = new Map(batchResults.map((r) => [r.id, r]))
        const stillFailing: DriveFile[] = []

        for (const p of prepared) {
          if (p.status === 'plaintext') {
            names[p.id] = p.name
            errors.delete(p.id)
            continue
          }
          if (p.status === 'error') {
            errors.set(p.id, p.error)
            const f = pending.find((file) => file.id === p.id)
            if (f) stillFailing.push(f)
            continue
          }
          const r = resultById.get(p.id)
          if (r && r.error === undefined && typeof r.name === 'string') {
            names[p.id] = r.name
            errors.delete(p.id)
          } else {
            errors.set(p.id, r?.error ?? errors.get(p.id) ?? new Error('decryption failed'))
            const f = pending.find((file) => file.id === p.id)
            if (f) stillFailing.push(f)
          }
        }

        pending = stillFailing
        if (pending.length > 0 && attempt < MAX_ATTEMPTS - 1) {
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * (attempt + 1)))
        }
      }

      if (cancelled) return

      // Anything still in `pending` after retries failed permanently.
      for (const file of pending) {
        names[file.id] = null
        // eslint-disable-next-line no-console
        console.error('[file-list] decryption failed', {
          fileId: file.id,
          error:
            errors.get(file.id) instanceof Error
              ? (errors.get(file.id) as Error).message
              : String(errors.get(file.id)),
        })
      }
      setDecryptedNames(names)
    }
    decryptAll()
    return () => { cancelled = true }
  }, [files, isUnlocked, getFileKeyForFile, externalDecryptedNames])

  return decryptedNames
}

/**
 * Returns the display name for a file.
 *
 * - `undefined` in decryptedNames → decryption pending → returns null (caller shows skeleton)
 * - `null` in decryptedNames      → decryption failed  → returns "Encrypted file"
 * - `string` in decryptedNames    → success            → returns the name
 *
 * NEVER returns raw ciphertext JSON. The caller is responsible for rendering
 * a skeleton when this returns null.
 */
export function displayNameFrom(decryptedNames: DecryptedNames, file: DriveFile): string | null {
  const cached = decryptedNames[file.id]
  if (cached === undefined) return null      // pending — caller shows skeleton
  if (cached === null) return 'Encrypted file' // failed
  return cached                               // success
}
