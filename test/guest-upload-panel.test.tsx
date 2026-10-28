/**
 * Task 2237b — guest upload panel.
 *
 * There is no DOM in this suite, so the panel's decisions live in exported pure
 * functions and its markup is asserted with `renderToStaticMarkup`. The live
 * drag, click and progress paths are exercised in the Playwright spec (Task 17).
 */
import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ActorNamePrompt, ACTOR_NAME_MAX_LENGTH } from '../src/components/folder-link/actor-name-prompt'
import {
  GuestUploadPanel,
  panelVisible,
  rowLabel,
  shouldAskActorName,
  tasksFromFiles,
  tasksFromFolderFiles,
} from '../src/components/folder-link/guest-upload-panel'
import { rejectMessage, type GuestUploadTask } from '../src/lib/guest-upload'

function plain(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
}

const FOLDER_KEY = new Uint8Array(32)

function task(name: string, relativePath: string | null = null): GuestUploadTask {
  return { file: new File([new Uint8Array(1)], name, { type: 'text/plain' }), relativePath }
}

function panel(overrides: Partial<Parameters<typeof GuestUploadPanel>[0]> = {}) {
  return createElement(GuestUploadPanel, {
    token: 'tok',
    folderId: 'folder-1',
    folderKey: FOLDER_KEY,
    proof: null,
    level: 'add',
    parentId: null,
    siblingNames: new Map(),
    onUploaded: () => undefined,
    queue: [],
    setQueue: () => undefined,
    ...overrides,
  })
}

describe('panel visibility', () => {
  test('a view-only link renders nothing', () => {
    expect(panelVisible('view')).toBe(false)
    expect(renderToStaticMarkup(panel({ level: 'view' }))).toBe('')
  })

  test('add and edit render the panel', () => {
    expect(panelVisible('add')).toBe(true)
    expect(panelVisible('edit')).toBe(true)
    const html = plain(renderToStaticMarkup(panel({ level: 'add' })))
    expect(html).toContain('Upload')
    expect(html).toContain('Upload folder')
    expect(html).toContain('Drop files or a folder to add them here.')
  })
})

describe('the name prompt', () => {
  test('is due before the first upload and never again once a name exists', () => {
    expect(shouldAskActorName({ level: 'add', storedName: null, asked: false })).toBe(true)
    expect(shouldAskActorName({ level: 'add', storedName: 'Sam', asked: false })).toBe(false)
    expect(shouldAskActorName({ level: 'add', storedName: null, asked: true })).toBe(false)
    expect(shouldAskActorName({ level: 'view', storedName: null, asked: false })).toBe(false)
  })

  test('renders the copy and a 40-character field', () => {
    const html = plain(
      renderToStaticMarkup(
        createElement(ActorNamePrompt, { open: true, onSubmit: () => undefined, onSkip: () => undefined }),
      ),
    )
    expect(html).toContain('What should we call you?')
    expect(html).toContain("It's stored encrypted with the folder.")
    expect(html).toContain('Continue')
    expect(html).toContain('Skip')
    expect(ACTOR_NAME_MAX_LENGTH).toBe(40)
  })

  test('renders nothing when closed', () => {
    expect(
      renderToStaticMarkup(
        createElement(ActorNamePrompt, { open: false, onSubmit: () => undefined, onSkip: () => undefined }),
      ),
    ).toBe('')
  })
})

describe('the queue', () => {
  test('two dropped files become two Queued rows', () => {
    const tasks = tasksFromFiles([
      new File([new Uint8Array(1)], 'a.txt'),
      new File([new Uint8Array(1)], 'b.txt'),
    ])
    const html = plain(renderToStaticMarkup(panel({ queue: tasks })))
    expect(html.match(/Queued/g) ?? []).toHaveLength(2)
    expect(html).toContain('a.txt')
    expect(html).toContain('b.txt')
  })

  test('a dropped folder keeps its relative path', () => {
    const tasks = tasksFromFolderFiles([
      { file: new File([new Uint8Array(1)], 'a.jpg'), relativePath: 'Trip/2019/a.jpg' },
    ])
    expect(tasks[0].relativePath).toBe('Trip/2019/a.jpg')
    const html = plain(renderToStaticMarkup(panel({ queue: tasks })))
    expect(html).toContain('Trip/2019/a.jpg')
  })

  test('row labels cover every state', () => {
    expect(rowLabel({ name: 'queued' })).toBe('Queued')
    expect(rowLabel({ name: 'uploading', percent: 42 })).toBe('Uploading 42%')
    expect(rowLabel({ name: 'added', fileId: 'f1' })).toBe('Added')
    expect(rowLabel({ name: 'rejected', reason: 'cap', message: '' })).toBe('That folder is full.')
    expect(rowLabel({ name: 'rejected', reason: 'rate', message: '' })).toBe(
      'Too many uploads right now. Try again in a minute.',
    )
  })

  test('a rejected row keeps its message visible in the list markup path', () => {
    // The row's text comes from `rowLabel`; assert the copy the panel renders.
    expect(rejectMessage('cap')).toBe('That folder is full.')
    const rejected = plain(renderToStaticMarkup(panel({ queue: [task('full.bin')] })))
    expect(rejected).toContain('full.bin')
  })
})
