import type { FolderAccessLevel, Proof } from '../../lib/folder-link-types'

/**
 * Task 2237b — placeholder browser. Task 7 replaces this with the real
 * grid/list listing; the page shell only needs the mount point for now.
 */
export function GuestBrowser(props: {
  token: string
  folderKey: Uint8Array
  level: FolderAccessLevel
  proof: Proof | null
  rootName?: string
  onOpenFile: (node: unknown) => void
  onPreview: (node: unknown) => void
  refreshKey?: number
}) {
  return (
    <div className="rounded-lg border border-line bg-paper-2 p-6 text-center text-sm text-ink-3">
      <p>This folder is empty.</p>
      {props.level === 'add' || props.level === 'edit' ? (
        <p className="mt-1">Drop files here, or use Upload.</p>
      ) : null}
    </div>
  )
}
