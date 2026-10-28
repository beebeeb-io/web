/**
 * Task 2237b — the owner's "New link" form inside the folder share panel.
 *
 * A folder can hold at most 20 links (the server refuses the 21st), so the
 * button is disabled at the ceiling with the reason spelled out rather than
 * letting the request fail.
 */
import { useState } from 'react'
import { BBButton } from '@beebeeb/shared'
import {
  createFolderLinkWithKeys,
  folderLinkActionError,
  MAX_FOLDER_LINKS,
  type CreatedFolderLink,
} from '../../lib/folder-link-create'
import { EmptyLinkPassphraseError } from '../../lib/link-passphrase'
import type { FolderAccessLevel } from '../../lib/folder-link-types'
import { FOLDER_NEEDS_UPGRADE, FolderUpgradeRefusedError, needsFolderUpgrade } from '../../lib/folder-upgrade'

/**
 * The line a failed create shows. A folder that needs the custody upgrade
 * (contract 2237 §2), or whose upgrade was refused, gets its own sentence,
 * never the generic retry line: retrying can't help it.
 */
export function createLinkErrorMessage(err: unknown): string {
  if (err instanceof EmptyLinkPassphraseError) return err.message
  if (needsFolderUpgrade(err)) return FOLDER_NEEDS_UPGRADE
  if (err instanceof FolderUpgradeRefusedError) return err.message
  return folderLinkActionError(err)?.message || 'Could not create the link. Try again.'
}

export function createDisabledReason(linkCount: number): string | null {
  return linkCount >= MAX_FOLDER_LINKS ? `A folder can have at most ${MAX_FOLDER_LINKS} links.` : null
}

export const EXPIRY_OPTIONS: { label: string; hours: number | null }[] = [
  { label: 'Never expires', hours: null },
  { label: '1 day', hours: 24 },
  { label: '7 days', hours: 24 * 7 },
  { label: '30 days', hours: 24 * 30 },
]

const GB = 1024 * 1024 * 1024

export const CAP_OPTIONS: { label: string; bytes: number | null }[] = [
  { label: 'No cap', bytes: null },
  { label: '1 GB', bytes: GB },
  { label: '5 GB', bytes: 5 * GB },
  { label: '10 GB', bytes: 10 * GB },
]

export interface CreateLinkFormState {
  label: string
  level: FolderAccessLevel
  expiryHours: number | null
  capBytes: number | null
  passphrase: string
}

export const EMPTY_CREATE_FORM: CreateLinkFormState = {
  label: '',
  level: 'view',
  expiryHours: null,
  capBytes: null,
  passphrase: '',
}

export interface CreateLinkFormProps {
  folderId: string
  masterKey: Uint8Array
  linkCount: number
  onCreated: (link: CreatedFolderLink) => void
}

export function CreateLinkForm({ folderId, masterKey, linkCount, onCreated }: CreateLinkFormProps) {
  const [form, setForm] = useState<CreateLinkFormState>(EMPTY_CREATE_FORM)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const disabledReason = createDisabledReason(linkCount)

  async function submit() {
    if (disabledReason || busy) return
    setBusy(true)
    setError(null)
    try {
      const created = await createFolderLinkWithKeys({
        folderId,
        masterKey,
        accessLevel: form.level,
        label: form.label.trim() ? form.label.trim() : null,
        expiresInHours: form.expiryHours,
        capBytes: form.capBytes,
        // Exactly as typed (normalised to NFC in createFolderLinkWithKeys);
        // only an untouched field means "no passphrase".
        passphrase: form.passphrase === '' ? null : form.passphrase,
        maxOpens: null,
      })
      setForm(EMPTY_CREATE_FORM)
      onCreated(created)
    } catch (e) {
      setError(createLinkErrorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="border-t border-line px-1 pt-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs text-ink-2">
          <span>Label (optional)</span>
          <input
            type="text"
            value={form.label}
            maxLength={60}
            onChange={(e) => setForm({ ...form, label: e.target.value })}
            placeholder="For the design team"
            className="rounded-lg border border-line bg-paper px-2 py-1.5 text-sm text-ink"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-2">
          <span>Access</span>
          <select
            value={form.level}
            onChange={(e) => setForm({ ...form, level: e.target.value as FolderAccessLevel })}
            className="rounded-lg border border-line bg-paper px-2 py-1.5 text-sm text-ink"
          >
            <option value="view">Can view</option>
            <option value="add">Can add</option>
            <option value="edit">Can edit</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-2">
          <span>Expires</span>
          <select
            value={form.expiryHours === null ? 'never' : String(form.expiryHours)}
            onChange={(e) =>
              setForm({ ...form, expiryHours: e.target.value === 'never' ? null : Number(e.target.value) })
            }
            className="rounded-lg border border-line bg-paper px-2 py-1.5 text-sm text-ink"
          >
            {EXPIRY_OPTIONS.map((o) => (
              <option key={o.label} value={o.hours === null ? 'never' : String(o.hours)}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-2">
          <span>Upload cap</span>
          <select
            value={form.capBytes === null ? 'none' : String(form.capBytes)}
            onChange={(e) =>
              setForm({ ...form, capBytes: e.target.value === 'none' ? null : Number(e.target.value) })
            }
            className="rounded-lg border border-line bg-paper px-2 py-1.5 text-sm text-ink"
          >
            {CAP_OPTIONS.map((o) => (
              <option key={o.label} value={o.bytes === null ? 'none' : String(o.bytes)}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="mt-2 flex flex-col gap-1 text-xs text-ink-2">
        <span>Passphrase (optional)</span>
        <input
          type="password"
          value={form.passphrase}
          onChange={(e) => setForm({ ...form, passphrase: e.target.value })}
          className="rounded-lg border border-line bg-paper px-2 py-1.5 text-sm text-ink"
        />
      </label>
      {error && (
        // The upgrade notice is a fact about the folder, not a failed action.
        <p role="alert" className={`mt-2 text-xs ${error === FOLDER_NEEDS_UPGRADE ? 'text-ink-2' : 'text-red'}`}>
          {error}
        </p>
      )}
      <div className="mt-3 flex items-center gap-2">
        <BBButton variant="amber" onClick={submit} disabled={busy || disabledReason !== null}>
          {busy ? 'Creating…' : 'Create link'}
        </BBButton>
        {disabledReason && <p className="text-xs text-ink-3">{disabledReason}</p>}
      </div>
    </div>
  )
}
