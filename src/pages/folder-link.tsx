/**
 * Task 2237b — the anonymous shared-folder page.
 *
 * All async decisions live in `resolveGuestState` / `openWithPassphrase`, which
 * are pure enough to test without a DOM. The page component is a thin wrapper:
 * resolve on mount, submit a passphrase, render one of five states.
 */
import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { GuestShell } from '../components/folder-link/guest-shell'
import { Unavailable } from '../components/folder-link/unavailable'
import { GuestBrowser } from '../components/folder-link/guest-browser'
import {
  FolderNotAvailableError,
  clearProof,
  readProof,
  resolveFolderLink,
  storeProof,
  verifyFolderLinkPassphrase,
} from '../lib/folder-link-public'
import type { FolderAccessLevel, Proof, PublicFolderRoot } from '../lib/folder-link-types'
import {
  deriveLinkPassphraseKey,
  resolveGuestFolderKey,
} from '../lib/shared-folder-link-crypto'
import { ApiError } from '../lib/api'

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
        <p role="status" className="text-sm text-ink-3">
          Opening folder…
        </p>
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
          className="mx-auto max-w-sm rounded-lg border border-line bg-paper-2 p-6"
          onSubmit={(event) => {
            event.preventDefault()
            props.onSubmit()
          }}
        >
          <h2 className="text-lg font-semibold">This folder is protected</h2>
          <label className="mt-4 block text-sm text-ink-3" htmlFor="folder-link-passphrase">
            Passphrase
          </label>
          <input
            id="folder-link-passphrase"
            type="password"
            autoComplete="current-password"
            className="mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm"
            value={props.passphrase}
            onChange={(event) => props.onPassphraseChange(event.target.value)}
          />
          {props.passphraseError ? (
            <p className="mt-2 text-sm text-red-600">{props.passphraseError}</p>
          ) : null}
          <button
            type="submit"
            disabled={props.busy || props.passphrase.length === 0}
            className="mt-4 w-full rounded-lg bg-amber px-3 py-2 text-sm font-semibold text-ink disabled:opacity-50"
          >
            {props.busy ? 'Opening…' : 'Open folder'}
          </button>
        </form>
      </GuestShell>
    )
  }

  const { root, folderKey, level, proof } = state
  const canUpload = level === 'add' || level === 'edit'
  return (
    <GuestShell
      title="Shared folder"
      toolbar={
        canUpload ? (
          <button
            type="button"
            className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium"
          >
            Upload
          </button>
        ) : undefined
      }
    >
      {canUpload ? <NamePrompt /> : null}
      <GuestBrowser
        token={props.token}
        folderKey={folderKey}
        level={level}
        proof={proof}
        rootName={root.root_name_encrypted}
        onOpenFile={() => undefined}
        onPreview={() => undefined}
      />
    </GuestShell>
  )
}

/** Asked once, before the first upload; Task 13 wires it to the engine. */
function NamePrompt() {
  return (
    <div className="mb-4 rounded-lg border border-line bg-paper-2 p-3">
      <label className="block text-sm text-ink-3" htmlFor="folder-link-actor-name">
        Your name
      </label>
      <input
        id="folder-link-actor-name"
        type="text"
        className="mt-1 w-full max-w-xs rounded-lg border border-line bg-paper px-3 py-2 text-sm"
        placeholder="Shown to the folder owner"
      />
    </div>
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
