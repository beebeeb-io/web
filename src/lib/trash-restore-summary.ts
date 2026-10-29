/**
 * Task 1918 round 4b — what a bulk restore in Trash tells the person.
 *
 * `POST /api/v1/files/{id}/restore` answers 202 (`complete: false`) for a folder whose trash group
 * is larger than one request may touch; the server restores the rest in the background. Those
 * folders are not "restored" yet: they keep their rows in the list (the list refreshes as the
 * server's restore events arrive) and the toast says they are restoring in the background.
 */
export interface RestoreResultLike {
  complete: boolean
}

export function splitRestored(ids: string[], results: RestoreResultLike[]): { done: string[]; background: string[] } {
  const done: string[] = []
  const background: string[] = []
  ids.forEach((id, i) => {
    if (results[i]?.complete === false) background.push(id)
    else done.push(id)
  })
  return { done, background }
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

export function restoreToast(done: number, background: number): { title: string; description: string } {
  if (background === 0) {
    return { title: `${done} ${plural(done, 'file', 'files')} restored`, description: 'Moved back to your vault' }
  }
  const folders = `${background} large ${plural(background, 'folder', 'folders')}`
  return {
    title: done > 0 ? `${done} restored; ${folders} restoring in the background` : `${folders} restoring in the background`,
    description: 'Their contents come back over the next minutes; the trash updates as they do.',
  }
}
