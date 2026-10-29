/**
 * Task 2237b — the guest upload panel.
 *
 * One batch at a time, sequential uploads, and every row keeps its own state
 * so a rejection is never silent. The name prompt is asked once per browser per
 * folder; skipping is remembered for the session.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BBButton } from '@beebeeb/shared'
import { Icon } from '../icons'
import { useBrowseFiles, useBrowseFolders, type FolderFile } from '../upload-zone'
import type { FolderAccessLevel, Proof } from '../../lib/folder-link-types'
import {
  rejectMessage,
  uploadGuestFiles,
  type GuestUploadState,
  type GuestUploadTask,
} from '../../lib/guest-upload'
import { readActorName, readActorNameCiphertext, storeActorName, storeActorNameSkipped } from '../../lib/guest-actor-name'
import { ActorNamePrompt } from './actor-name-prompt'

/** The panel does not exist for a view-only link. */
export function panelVisible(level: FolderAccessLevel): boolean {
  return level === 'add' || level === 'edit'
}

export function shouldAskActorName(args: {
  level: FolderAccessLevel
  storedName: string | null
  asked: boolean
}): boolean {
  return panelVisible(args.level) && args.storedName === null && !args.asked
}

/**
 * What the next batch does: ask for a name first (once per browser and
 * folder), or upload, carrying the sealed name on EVERY batch so each
 * contribution is attributed, not only the first one.
 */
export function decideBatch(args: {
  level: FolderAccessLevel
  storedName: string | null
  asked: boolean
  encryptedName: string | null
}): { kind: 'ask' } | { kind: 'run'; actorNameEncrypted: string | null } {
  if (shouldAskActorName(args)) return { kind: 'ask' }
  return { kind: 'run', actorNameEncrypted: args.encryptedName }
}

/** One label per row state; the rejection copy comes from the engine. */
export function rowLabel(state: GuestUploadState): string {
  switch (state.name) {
    case 'queued':
      return 'Queued'
    case 'uploading':
      return `Uploading ${state.percent}%`
    case 'added':
      return 'Added'
    case 'rejected':
      return rejectMessage(state.reason)
  }
}

export function tasksFromFolderFiles(entries: FolderFile[]): GuestUploadTask[] {
  return entries.map((entry) => ({ file: entry.file, relativePath: entry.relativePath }))
}

export function tasksFromFiles(files: File[]): GuestUploadTask[] {
  return files.map((file) => ({ file, relativePath: null }))
}

export function GuestUploadPanel(props: {
  token: string
  folderId: string
  folderKey: Uint8Array
  proof: Proof | null
  level: FolderAccessLevel
  parentId: string | null
  siblingNames: Map<string, string>
  onUploaded: () => void
  queue: GuestUploadTask[]
  setQueue: (tasks: GuestUploadTask[]) => void
  /** Files dropped anywhere on the page; each new `seq` starts one batch. */
  dropped?: { seq: number; tasks: GuestUploadTask[] } | null
}) {
  const visible = panelVisible(props.level)
  const [rows, setRows] = useState<Map<string, GuestUploadState>>(new Map())
  const [busy, setBusy] = useState(false)
  const [promptOpen, setPromptOpen] = useState(false)
  const pending = useRef<GuestUploadTask[]>([])
  // The stored name is read from localStorage asynchronously; a drop that
  // arrives before the read resolves must not be mistaken for a first visit
  // and pop the prompt again on every reload.
  const nameRead = useRef<Promise<void>>(Promise.resolve())
  const storedNameRef = useRef<string | null>(null)
  const encryptedNameRef = useRef<string | null>(null)
  const askedRef = useRef(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!visible) return
    let live = true
    nameRead.current = Promise.all([
      readActorName(props.folderId, props.folderKey),
      readActorNameCiphertext(props.folderId, props.folderKey),
    ])
      .then(([name, encrypted]) => {
        if (!live) return
        storedNameRef.current = name
        encryptedNameRef.current = encrypted
        if (name !== null) askedRef.current = true
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [visible, props.folderId, props.folderKey])

  const keyFor = (task: GuestUploadTask) => task.relativePath ?? task.file.name

  const run = useCallback(
    async (tasks: GuestUploadTask[], actorNameEncrypted: string | null) => {
      if (tasks.length === 0) return
      setBusy(true)
      setError(null)
      const initial = new Map<string, GuestUploadState>()
      for (const task of tasks) initial.set(keyFor(task), { name: 'queued' })
      setRows(initial)
      try {
        const result = await uploadGuestFiles({
          token: props.token,
          rootId: props.folderId,
          folderKey: props.folderKey,
          proof: props.proof,
          parentId: props.parentId,
          tasks,
          siblingNames: props.siblingNames,
          actorNameEncrypted,
          onEvent: (event) => {
            const key = event.relativePath ?? event.name
            setRows((current) => {
              const next = new Map(current)
              next.set(key, event.state)
              return next
            })
          },
        })
        if (result.added > 0) props.onUploaded()
      } catch {
        setError('The upload did not finish.')
      } finally {
        setBusy(false)
      }
    },
    [
      props.token,
      props.folderId,
      props.folderKey,
      props.proof,
      props.parentId,
      props.siblingNames,
      props.onUploaded,
    ],
  )

  const start = useCallback(
    (tasks: GuestUploadTask[]) => {
      if (!visible || tasks.length === 0) return
      props.setQueue(tasks)
      void (async () => {
        await nameRead.current
        const next = decideBatch({
          level: props.level,
          storedName: storedNameRef.current,
          asked: askedRef.current,
          encryptedName: encryptedNameRef.current,
        })
        if (next.kind === 'ask') {
          // No request is made before the guest answers.
          pending.current = tasks
          setPromptOpen(true)
          return
        }
        await run(tasks, next.actorNameEncrypted)
      })()
    },
    [visible, props, run],
  )

  // A drop anywhere on the page is the same as picking those files here.
  const startRef = useRef(start)
  startRef.current = start
  const dropSeq = props.dropped?.seq
  useEffect(() => {
    if (dropSeq === undefined || !props.dropped) return
    startRef.current(props.dropped.tasks)
    // Only a new drop (a new seq) starts a batch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dropSeq])

  const nameBrowse = useBrowseFiles((files) => start(tasksFromFiles(files)))
  const folderBrowse = useBrowseFolders((entries) => start(tasksFromFolderFiles(entries)))

  const queue = props.queue
  const rowKeys = useMemo(() => queue.map(keyFor), [queue])
  if (!visible) return null

  return (
    <div className="space-y-3">
      <ActorNamePrompt
        open={promptOpen}
        onSubmit={(name) => {
          setPromptOpen(false)
          askedRef.current = true
          storedNameRef.current = name
          void storeActorName(props.folderId, props.folderKey, name).then((encrypted) => {
            encryptedNameRef.current = encrypted
            void run(pending.current, encrypted)
          })
        }}
        onSkip={() => {
          setPromptOpen(false)
          askedRef.current = true
          storedNameRef.current = ''
          encryptedNameRef.current = null
          storeActorNameSkipped(props.folderId)
          void run(pending.current, null)
        }}
      />

      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-lg border border-dashed border-line-2 bg-paper-2 px-3 py-2.5 md:px-4">
        <p className="flex min-w-0 items-center gap-2 text-[12px] text-ink-3">
          <Icon name="upload" size={13} className="shrink-0 text-ink-3" />
          <span>Drop files or a folder to add them here.</span>
        </p>
        <div className="flex items-center gap-2">
          <BBButton
            type="button"
            onClick={folderBrowse.browseFolder}
            disabled={busy}
            className="min-h-11 gap-1.5 text-[13px] disabled:opacity-60 md:min-h-9"
          >
            <Icon name="folder" size={13} />
            Upload folder
          </BBButton>
          <BBButton
            type="button"
            variant="amber"
            onClick={nameBrowse.browse}
            disabled={busy}
            className="min-h-11 gap-1.5 text-[13px] disabled:opacity-60 md:min-h-9"
          >
            <Icon name="upload" size={13} />
            Upload
          </BBButton>
        </div>
      </div>
      <nameBrowse.HiddenInput />
      <folderBrowse.HiddenFolderInput />

      {error ? (
        <p role="alert" className="text-[13px] text-ink-3">
          {error}
        </p>
      ) : null}

      {rowKeys.length > 0 ? (
        <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-paper" aria-label="Uploads">
          {queue.map((task, index) => {
            const state = rows.get(rowKeys[index]) ?? { name: 'queued' as const }
            const rejected = state.name === 'rejected'
            return (
              <li
                key={`${rowKeys[index]}-${index}`}
                className="relative flex items-center justify-between gap-3 px-3 py-2 text-[13px] md:px-4"
                data-state={state.name}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Icon name={state.name === 'added' ? 'check' : 'file'} size={13} className={state.name === 'added' ? 'shrink-0 text-green' : 'shrink-0 text-ink-3'} />
                  <span className="min-w-0 truncate">{task.relativePath ?? task.file.name}</span>
                </span>
                <span className={rejected ? 'shrink-0 text-ink-2' : 'shrink-0 font-mono text-[11px] tabular-nums text-ink-3'}>
                  {rowLabel(state)}
                </span>
                {state.name === 'uploading' ? (
                  <span
                    aria-hidden="true"
                    className="absolute bottom-0 left-0 h-[2px] bg-amber transition-[width] duration-200"
                    style={{ width: `${state.percent}%` }}
                  />
                ) : null}
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}
