/**
 * Task 2237b — the guest upload panel.
 *
 * One batch at a time, sequential uploads, and every row keeps its own state
 * so a rejection is never silent. The name prompt is asked once per browser per
 * folder; skipping is remembered for the session.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useBrowseFiles, useBrowseFolders, type FolderFile } from '../upload-zone'
import type { FolderAccessLevel, Proof } from '../../lib/folder-link-types'
import {
  rejectMessage,
  uploadGuestFiles,
  type GuestUploadState,
  type GuestUploadTask,
} from '../../lib/guest-upload'
import { readActorName, storeActorName } from '../../lib/guest-actor-name'
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
}) {
  const visible = panelVisible(props.level)
  const [rows, setRows] = useState<Map<string, GuestUploadState>>(new Map())
  const [busy, setBusy] = useState(false)
  const [promptOpen, setPromptOpen] = useState(false)
  const [asked, setAsked] = useState(false)
  const [storedName, setStoredName] = useState<string | null>(null)
  const pending = useRef<GuestUploadTask[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!visible) return
    let live = true
    void readActorName(props.folderId, props.folderKey).then((name) => {
      if (!live) return
      setStoredName(name)
      if (name !== null) setAsked(true)
    })
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
      if (shouldAskActorName({ level: props.level, storedName, asked })) {
        // No request is made before the guest answers.
        pending.current = tasks
        setPromptOpen(true)
        return
      }
      void run(tasks, null)
    },
    [visible, props, storedName, asked, run],
  )

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
          setAsked(true)
          setStoredName(name)
          void storeActorName(props.folderId, props.folderKey, name).then((encrypted) => {
            void run(pending.current, encrypted)
          })
        }}
        onSkip={() => {
          setPromptOpen(false)
          setAsked(true)
          void run(pending.current, null)
        }}
      />

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={nameBrowse.browse}
          disabled={busy}
          className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium disabled:opacity-60"
        >
          Upload
        </button>
        <button
          type="button"
          onClick={folderBrowse.browseFolder}
          disabled={busy}
          className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium disabled:opacity-60"
        >
          Upload folder
        </button>
        <p className="text-xs text-ink-3">Drop files or a folder to add them here.</p>
      </div>
      <nameBrowse.HiddenInput />
      <folderBrowse.HiddenFolderInput />

      {error ? (
        <p role="alert" className="text-sm text-ink-3">
          {error}
        </p>
      ) : null}

      {rowKeys.length > 0 ? (
        <ul className="divide-y divide-line rounded-lg border border-line bg-paper">
          {queue.map((task, index) => {
            const state = rows.get(rowKeys[index]) ?? { name: 'queued' as const }
            const rejected = state.name === 'rejected'
            return (
              <li
                key={`${rowKeys[index]}-${index}`}
                className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                data-state={state.name}
              >
                <span className="min-w-0 truncate">
                  {task.relativePath ?? task.file.name}
                </span>
                <span className={rejected ? 'shrink-0 text-ink-3' : 'shrink-0 font-mono text-xs text-ink-3'}>
                  {rowLabel(state)}
                </span>
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}
