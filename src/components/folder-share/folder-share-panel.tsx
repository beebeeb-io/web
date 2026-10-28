/**
 * Task 2237b — the owner's folder Share panel.
 *
 * One list per folder: the people who can open it, then the live links. When
 * the `shared_folders_v1` flag is off (or still loading) the untouched 2238
 * snapshot-bundle dialog renders instead, through `bundleFallback`.
 *
 * Copying an existing link needs its `#key=` fragment, and that secret is
 * never stored server-side. Links minted in this browser session keep their
 * URL here; an older link can only be copied from wherever it was first
 * shared, so its Copy button stays disabled rather than handing out a link
 * that cannot be opened.
 */
import { useCallback, useEffect, useState, type ReactElement, type ReactNode } from 'react'
import { Icon } from '@beebeeb/shared'
import {
  getFolderMembers,
  getSharedFolder,
  listFolderLinks,
  revokeFolderLink,
  updateFolderLink,
} from '../../lib/api'
import { fromBase64 } from '../../lib/crypto'
import { decryptOwnerFolderKey } from '../../lib/folder-share-crypto'
import { decryptActorName } from '../../lib/guest-actor-name'
import { rebuildFolderLinkUrl } from '../../lib/shared-folder-link-crypto'
import { SHARED_FOLDERS_FLAG } from '../../lib/flags'
import type { FolderLink } from '../../lib/folder-link-types'
import { useKeys } from '../../lib/key-context'
import { useFeatureFlag } from '../../lib/use-feature-flag'
import { createDisabledReason, CreateLinkForm } from './create-link-form'
import { FolderActivityTab } from './folder-activity-tab'
import { FolderLinkRow } from './folder-link-row'

export interface FolderSharePanelProps {
  open: boolean
  folderId: string
  folderName: string
  onClose: () => void
  /** The untouched 2238 dialog body, rendered verbatim when the flag is off. */
  bundleFallback: () => ReactElement
}

export interface ShareMemberRow {
  user_id: string
  email: string
  isOwner: boolean
}

export interface FolderSharePanelBodyProps {
  folderName: string
  members: ShareMemberRow[]
  links: FolderLink[]
  /** Decrypted labels keyed by link id. */
  labels: Record<string, string | null>
  /** Full link URLs we still hold (minted in this session). */
  urls: Record<string, string>
  copiedId: string | null
  confirmingRevokeId: string | null
  createSlot?: ReactNode
  loading?: boolean
  error?: string | null
  now?: number
  onTogglePause: (link: FolderLink) => void
  onCopy: (link: FolderLink, url: string) => void
  onRevoke: (link: FolderLink) => void
}

/** Owner first, labelled "You (owner)", then members by email. */
export function memberRows(
  members: { user_id: string; email: string; is_owner?: boolean }[],
  ownerId?: string,
): ShareMemberRow[] {
  const rows = members.map((m) => ({
    user_id: m.user_id,
    email: m.email,
    isOwner: m.is_owner === true || m.user_id === ownerId,
  }))
  return rows.sort((a, b) => {
    if (a.isOwner !== b.isOwner) return a.isOwner ? -1 : 1
    return a.email.localeCompare(b.email)
  })
}

export function memberLabel(row: ShareMemberRow): string {
  return row.isOwner ? 'You (owner)' : row.email
}

/**
 * The member list answers 404 until the folder has its first approved invite,
 * so "no invites yet" must read as an empty list, not as a panel failure —
 * otherwise the owner never sees the create form for the FIRST link (caught by
 * the Task 17 browser run). Every other error still surfaces.
 */
export function missingMembersFallback(
  err: unknown,
): { members: ShareMemberRow[]; owner_id: string } | null {
  const status = (err as { status?: unknown } | null | undefined)?.status
  return status === 404 ? { members: [], owner_id: '' } : null
}

export function FolderSharePanelBody({
  folderName,
  members,
  links,
  labels,
  urls,
  copiedId,
  confirmingRevokeId,
  createSlot,
  loading,
  error,
  now,
  onTogglePause,
  onCopy,
  onRevoke,
}: FolderSharePanelBodyProps) {
  return (
    <div data-testid="folder-share-panel" className="flex flex-col">
      <div className="flex items-center gap-2 border-b border-line px-1 pb-3">
        <Icon name="users" size={14} className="text-ink" />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{folderName}</span>
      </div>

      {error && (
        <p role="alert" className="mt-2 text-xs text-red">
          {error}
        </p>
      )}

      <ul className="mt-1">
        {members.map((row) => (
          <li
            key={row.user_id}
            data-testid="folder-member-row"
            className="flex items-center gap-2 border-t border-line px-1 py-2.5"
          >
            <span className="min-w-0 flex-1 truncate text-sm text-ink">{memberLabel(row)}</span>
            {row.isOwner ? (
              <span className="font-mono text-xs text-ink-3">Owner</span>
            ) : (
              <span className="font-mono text-xs text-ink-3">Member</span>
            )}
          </li>
        ))}
      </ul>

      <div className="mt-4 flex items-center gap-2 px-1">
        <span className="text-sm font-semibold text-ink">Links</span>
        <span className="font-mono text-xs text-ink-3">{links.length}</span>
      </div>

      {loading ? (
        <p className="px-1 py-3 text-xs text-ink-3">Loading links…</p>
      ) : links.length === 0 ? (
        <p className="px-1 py-3 text-xs text-ink-3">No links yet.</p>
      ) : (
        <ul>
          {links.map((link) => {
            const url = urls[link.id] ?? ''
            return (
              <FolderLinkRow
                key={link.id}
                link={link}
                label={labels[link.id] ?? null}
                url={url}
                copiedId={copiedId}
                confirmingRevoke={confirmingRevokeId === link.id}
                now={now}
                onTogglePause={onTogglePause}
                onCopy={onCopy}
                onRevoke={onRevoke}
              />
            )
          })}
        </ul>
      )}

      {createSlot}
    </div>
  )
}

const clipboardPort = {
  writeText: async (text: string) => {
    await navigator.clipboard.writeText(text)
  },
}

function errorText(err: unknown): string {
  const message = (err as { message?: unknown } | null | undefined)?.message
  return typeof message === 'string' && message ? message : 'Something went wrong. Try again.'
}

/** The live panel: flag on, data loaded. */
function FolderSharePanelLive({ open, folderId, folderName, onClose }: FolderSharePanelProps) {
  const [members, setMembers] = useState<ShareMemberRow[]>([])
  const [links, setLinks] = useState<FolderLink[]>([])
  const [labels, setLabels] = useState<Record<string, string | null>>({})
  const [urls, setUrls] = useState<Record<string, string>>({})
  const { getMasterKey } = useKeys()
  const [masterKey, setMasterKey] = useState<Uint8Array | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [confirmingRevokeId, setConfirmingRevokeId] = useState<string | null>(null)
  const [tab, setTab] = useState<'people' | 'activity'>('people')

  useEffect(() => {
    if (!open) return
    let live = true
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        const [memberResponse, linkRows, custody] = await Promise.all([
          getFolderMembers(folderId).catch((err) => {
            const empty = missingMembersFallback(err)
            if (empty) return empty
            throw err
          }),
          listFolderLinks(folderId),
          getSharedFolder(folderId).catch(() => null),
        ])
        if (!live) return
        setMembers(memberRows(memberResponse.members, memberResponse.owner_id))
        setLinks(linkRows)

        const key = getMasterKey()
        setMasterKey(key)

        // L2: every link the owner made, on any device, can be copied again:
        // its URL is rebuilt from the owner's wrapped token and K_c.
        const origin = typeof window !== 'undefined' ? window.location.origin : ''
        const rebuilt = await Promise.all(
          linkRows.map(async (link) => [link.id, await rebuildFolderLinkUrl(link, key, origin)] as const),
        )
        if (live) {
          setUrls((current) => {
            const next = { ...current }
            for (const [id, url] of rebuilt) if (url && !next[id]) next[id] = url
            return next
          })
        }

        const folderKey = custody?.owner_wrapped_folder_key
          ? await decryptOwnerFolderKey(key, folderId, fromBase64(custody.owner_wrapped_folder_key))
          : null
        if (folderKey) {
          const entries = await Promise.all(
            linkRows.map(async (link) => {
              if (!link.label_encrypted) return [link.id, null] as const
              return [link.id, await decryptActorName(folderKey, link.label_encrypted)] as const
            }),
          )
          if (live) setLabels(Object.fromEntries(entries))
          folderKey.fill(0)
        }
      } catch (e) {
        if (live) setError(errorText(e))
      } finally {
        if (live) setLoading(false)
      }
    })()
    return () => {
      live = false
    }
    // getMasterKey is a stable key-context accessor; the panel loads on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, folderId])

  const togglePause = useCallback(async (link: FolderLink) => {
    try {
      const updated = await updateFolderLink(link.id, { paused: !link.paused })
      setLinks((rows) => rows.map((row) => (row.id === link.id ? { ...row, ...updated } : row)))
    } catch (e) {
      setError(errorText(e))
    }
  }, [])

  const copy = useCallback(
    async (link: FolderLink, url: string) => {
      if (!url) return
      try {
        await clipboardPort.writeText(url)
        setCopiedId(link.id)
        setTimeout(() => setCopiedId((id) => (id === link.id ? null : id)), 2000)
      } catch (e) {
        setError(errorText(e))
      }
    },
    [],
  )

  const revoke = useCallback(
    async (link: FolderLink) => {
      if (confirmingRevokeId !== link.id) {
        setConfirmingRevokeId(link.id)
        return
      }
      setConfirmingRevokeId(null)
      try {
        await revokeFolderLink(link.id)
        setLinks((rows) => rows.filter((row) => row.id !== link.id))
      } catch (e) {
        setError(errorText(e))
      }
    },
    [confirmingRevokeId],
  )

  const createSlot = masterKey ? (
    <div className="mt-4">
      <CreateLinkForm
        folderId={folderId}
        masterKey={masterKey}
        linkCount={links.length}
        onCreated={(created) => {
          setUrls((m) => ({ ...m, [created.id]: created.url }))
          setLinks((rows) => [
            {
              id: created.id,
              folder_id: folderId,
              access_level: created.level,
              // The label is encrypted with the folder key by the create call;
              // the row reads it back from the next list response.
              label_encrypted: null,
              expires_at: null,
              max_opens: null,
              open_count: 0,
              download_count: 0,
              paused: false,
              cap_bytes: null,
              cap_used_bytes: 0,
              passphrase_protected: created.passphraseProtected,
              created_at: new Date().toISOString(),
              revoked_at: null,
              wrapped_folder_key: null,
              owner_wrapped_key: null,
              owner_wrapped_token: null,
            },
            ...rows,
          ])
        }}
      />
      {createDisabledReason(links.length) === null && (
        <p className="mt-2 px-1 text-[11px] text-ink-3">
          Links stay live until you revoke them or they expire.
        </p>
      )}
    </div>
  ) : null

  return (
    <div role="dialog" aria-modal="true" aria-label="Share folder" className="flex flex-col">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-semibold text-ink">Share “{folderName}”</span>
        <button type="button" onClick={onClose} aria-label="Close" className="text-ink-3">
          <Icon name="x" size={14} />
        </button>
      </div>
      <div role="tablist" aria-label="Share panel sections" className="mb-3 flex gap-1 rounded-md bg-paper-2 p-1">
        {(['people', 'activity'] as const).map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`flex-1 rounded px-2 py-1 text-xs ${tab === key ? 'bg-paper text-ink shadow-sm' : 'text-ink-3'}`}
          >
            {key === 'people' ? 'People & links' : 'Activity'}
          </button>
        ))}
      </div>
      {tab === 'activity' ? (
        <FolderActivityTab folderId={folderId} />
      ) : (
      <FolderSharePanelBody
        folderName={folderName}
        members={members}
        links={links}
        labels={labels}
        urls={urls}
        copiedId={copiedId}
        confirmingRevokeId={confirmingRevokeId}
        createSlot={createSlot}
        loading={loading}
        error={error}
        onTogglePause={togglePause}
        onCopy={copy}
        onRevoke={(link) => void revoke(link)}
      />
      )}
    </div>
  )
}

export function FolderSharePanel(props: FolderSharePanelProps) {
  const flag = useFeatureFlag(SHARED_FOLDERS_FLAG)
  if (!props.open) return null
  if (!flag.enabled) return props.bundleFallback()
  return <FolderSharePanelLive {...props} />
}
