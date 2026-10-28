/**
 * Task 2237b — the anonymous shared-folder page.
 *
 * All async decisions live in `resolveGuestState` / `openWithPassphrase`, which
 * are pure enough to test without a DOM. The page component is a thin wrapper:
 * resolve on mount, submit a passphrase, render one of five states.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { GuestShell } from '../components/folder-link/guest-shell'
import { Unavailable } from '../components/folder-link/unavailable'
import { GuestBrowser } from '../components/folder-link/guest-browser'
import { GuestUploadPanel, tasksFromFiles, tasksFromFolderFiles } from '../components/folder-link/guest-upload-panel'
import { UploadZone } from '../components/upload-zone'
import type { GuestUploadTask } from '../lib/guest-upload'
import {
  FolderNotAvailableError,
  FOLDER_PROOF_REQUIRED_EVENT,
  clearProof,
  readProof,
  resolveFolderLink,
  storeProof,
  verifyFolderLinkPassphrase,
} from '../lib/folder-link-public'
import type { FolderAccessLevel, Proof, PublicFolderRoot } from '../lib/folder-link-types'
import {
  EmptyLinkPassphraseError,
  deriveLinkPassphraseKey,
  resolveGuestFolderKey,
} from '../lib/shared-folder-link-crypto'
import { ApiError } from '../lib/api'
import { BBButton, Icon } from '@beebeeb/shared'

export type GuestState =
  | { name: 'loading' }
  | { name: 'passphrase_required' }
  | { name: 'not_available' }
  | { name: 'update_required' }
  | {
      name: 'listed'
      root: PublicFolderRoot
      folderKey: Uint8Array
      level: FolderAccessLevel
      proof: Proof | null
    }

export const WRONG_PASSPHRASE = "That passphrase isn't right."

/**
 * Resolve a token into a page state. `passphraseStretch` is only needed when
 * the caller just verified a passphrase: the server hands back the same wrap,
 * so this derived value is what makes it openable.
 */
export async function resolveGuestState(args: {
  token: string
  proof: Proof | null
  passphraseStretch?: Uint8Array | null
}): Promise<GuestState> {
  try {
    const resolved = await resolveFolderLink(args.token, args.proof)
    if (resolved.kind === 'passphrase_required') return { name: 'passphrase_required' }
    const key = await resolveGuestFolderKey(
      args.token,
      args.proof,
      args.passphraseStretch ?? null,
    )
    switch (key.kind) {
      case 'unlocked':
        return {
          name: 'listed',
          root: resolved.root,
          folderKey: key.value.folderKey,
          level: key.value.level,
          proof: args.proof,
        }
      case 'passphrase_required':
        return { name: 'passphrase_required' }
      case 'update_required':
        return { name: 'update_required' }
      default:
        return { name: 'not_available' }
    }
  } catch (err) {
    if (err instanceof ApiError && err.status === 401 && err.code === 'passphrase_required') {
      clearProof(args.token)
      return { name: 'passphrase_required' }
    }
    if (err instanceof FolderNotAvailableError) return { name: 'not_available' }
    return { name: 'not_available' }
  }
}

/** Verify a passphrase, store the proof and open the folder. */
export async function openWithPassphrase(args: {
  token: string
  passphrase: string
}): Promise<{ state: GuestState; error: string | null }> {
  try {
    const verified = await verifyFolderLinkPassphrase(args.token, args.passphrase)
    // Forward compatibility: a server that predates the proof gate answers
    // without `proof`. The link is not openable here — ask for an update.
    if (typeof verified.proof !== 'string' || verified.proof.length === 0) {
      return { state: { name: 'update_required' }, error: null }
    }
    const proof = storeProof(args.token, verified.proof, verified.proof_expires_at)
    const stretch = await deriveLinkPassphraseKey(args.passphrase, args.token)
    const state = await resolveGuestState({
      token: args.token,
      proof,
      passphraseStretch: stretch,
    })
    return { state, error: state.name === 'passphrase_required' ? WRONG_PASSPHRASE : null }
  } catch (err) {
    if (err instanceof EmptyLinkPassphraseError) {
      return { state: { name: 'passphrase_required' }, error: err.message }
    }
    if (err instanceof ApiError && err.status === 403) {
      return { state: { name: 'passphrase_required' }, error: WRONG_PASSPHRASE }
    }
    if (err instanceof FolderNotAvailableError) {
      return { state: { name: 'not_available' }, error: null }
    }
    return { state: { name: 'not_available' }, error: null }
  }
}

/**
 * The render tree for a settled state. Exported so the page states can be
 * asserted without a browser renderer.
 */
export function FolderLinkView(props: {
  state: GuestState
  token: string
  passphrase: string
  passphraseError: string | null
  busy: boolean
  onPassphraseChange: (value: string) => void
  onSubmit: () => void
}) {
  const { state } = props

  if (state.name === 'loading') {
    return (
      <GuestShell title="Shared folder">
        <div className="rounded-lg border border-line bg-paper px-5 py-12 text-center">
          <p role="status" className="text-[13px] text-ink-3">
            Opening folder…
          </p>
        </div>
      </GuestShell>
    )
  }

  if (state.name === 'not_available' || state.name === 'update_required') {
    return <Unavailable reason={state.name} />
  }

  if (state.name === 'passphrase_required') {
    return (
      <GuestShell title="Shared folder">
        <form
          className="mx-auto mt-4 w-full max-w-sm rounded-lg border border-line bg-paper p-6 shadow-1"
          onSubmit={(event) => {
            event.preventDefault()
            props.onSubmit()
          }}
        >
          <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-amber-bg">
            <Icon name="lock" size={18} className="text-amber-deep" />
          </div>
          <h2 className="text-[17px] font-semibold">This folder is protected</h2>
          <p className="mt-1 text-[13px] text-ink-3">
            Enter the passphrase you were given. It opens the folder in this browser only.
          </p>
          <label className="mt-4 block text-[12px] font-medium text-ink-2" htmlFor="folder-link-passphrase">
            Passphrase
          </label>
          <input
            id="folder-link-passphrase"
            type="password"
            autoComplete="current-password"
            className="mt-1 min-h-11 w-full rounded-md border border-line bg-paper px-3 text-[14px] focus:outline-none focus-visible:ring-2 focus-visible:ring-amber"
            value={props.passphrase}
            onChange={(event) => props.onPassphraseChange(event.target.value)}
          />
          {props.passphraseError ? (
            <p role="alert" className="mt-2 text-[13px] text-red">{props.passphraseError}</p>
          ) : null}
          <BBButton
            type="submit"
            variant="amber"
            disabled={props.busy || props.passphrase.length === 0}
            className="mt-4 min-h-11 w-full font-semibold disabled:opacity-50"
          >
            {props.busy ? 'Opening…' : 'Open folder'}
          </BBButton>
        </form>
      </GuestShell>
    )
  }

  const { root, folderKey, level, proof } = state
  return (
    <FolderLinkBody
      token={props.token}
      root={root}
      folderKey={folderKey}
      level={level}
      proof={proof}
    />
  )
}

/** What this link lets a guest do, in one plain line under the title. */
export function accessLine(level: FolderAccessLevel): string {
  // Only what this page offers: renaming and deleting from a link are not
  // in the guest UI yet, so an edit link reads the same as an add link.
  return level === 'add' || level === 'edit'
    ? 'Shared with you. You can view, download and add files.'
    : 'Shared with you. You can view and download.'

}

function FolderLinkBody(props: {
  token: string
  root: PublicFolderRoot
  folderKey: Uint8Array
  level: FolderAccessLevel
  proof: Proof | null
}) {
  const canUpload = props.level === 'add' || props.level === 'edit'
  const [queue, setQueue] = useState<GuestUploadTask[]>([])
  const [refresh, setRefresh] = useState(0)
  const [title, setTitle] = useState('Shared folder')
  // Uploads land in the folder the guest is looking at, not always the root.
  const [location, setLocation] = useState<string | null>(null)
  const [dropped, setDropped] = useState<{ seq: number; tasks: GuestUploadTask[] } | null>(null)
  const siblingNames = useRef<Map<string, string>>(new Map())
  const rememberNames = useCallback((parentId: string | null, names: string[]) => {
    for (const name of names) {
      siblingNames.current.set(`${parentId ?? 'root'}:${name.toLowerCase()}`, name)
    }
  }, [])
  const drop = useCallback((tasks: GuestUploadTask[]) => {
    if (tasks.length === 0) return
    setDropped((current) => ({ seq: (current?.seq ?? 0) + 1, tasks }))
  }, [])

  const browser = (
    <GuestBrowser
      token={props.token}
      folderKey={props.folderKey}
      level={props.level}
      proof={props.proof}
      rootName={props.root.root_name_encrypted}
      rootWrappedKey={props.root.root_wrapped_key ?? null}
      onNames={rememberNames}
      onOpenFile={() => undefined}
      onPreview={() => undefined}
      onRootName={setTitle}
      onLocationChange={setLocation}
      refreshKey={refresh}
    />
  )

  return (
    <GuestShell title={title} subtitle={accessLine(props.level)}>
      {canUpload ? (
        // The same drop zone as Files: drop anywhere on the folder to add.
        <UploadZone
          onFiles={(files) => drop(tasksFromFiles(files))}
          onFolderFiles={(entries) => drop(tasksFromFolderFiles(entries))}
        >
          <div className="mb-3">
            <GuestUploadPanel
              token={props.token}
              folderId={props.root.folder_id}
              folderKey={props.folderKey}
              proof={props.proof}
              level={props.level}
              parentId={location}
              siblingNames={siblingNames.current}
              onUploaded={() => setRefresh((value) => value + 1)}
              queue={queue}
              setQueue={setQueue}
              dropped={dropped}
            />
          </div>
          {browser}
        </UploadZone>
      ) : (
        browser
      )}
    </GuestShell>
  )
}

export function FolderLinkPage() {
  const { token = '' } = useParams<{ token: string }>()
  const [state, setState] = useState<GuestState>({ name: 'loading' })
  const [passphrase, setPassphrase] = useState('')
  const [passphraseError, setPassphraseError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    void resolveGuestState({ token, proof: readProof(token) }).then((next) => {
      if (live) setState(next)
    })
    return () => {
      live = false
    }
  }, [token])

  useEffect(() => {
    const expired = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== token) return
      setState({ name: 'passphrase_required' })
      setPassphrase('')
      setPassphraseError(null)
    }
    window.addEventListener(FOLDER_PROOF_REQUIRED_EVENT, expired)
    return () => window.removeEventListener(FOLDER_PROOF_REQUIRED_EVENT, expired)
  }, [token])

  const submit = useCallback(() => {
    if (busy) return
    setBusy(true)
    setPassphraseError(null)
    void openWithPassphrase({ token, passphrase })
      .then(({ state: next, error }) => {
        setState(next)
        setPassphraseError(error)
        if (next.name === 'not_available') clearProof(token)
      })
      .finally(() => setBusy(false))
  }, [busy, passphrase, token])

  return (
    <FolderLinkView
      state={state}
      token={token}
      passphrase={passphrase}
      passphraseError={passphraseError}
      busy={busy}
      onPassphraseChange={setPassphrase}
      onSubmit={submit}
    />
  )
}
