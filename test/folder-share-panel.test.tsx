/**
 * Task 2237b — owner folder share panel.
 *
 * No DOM in this suite: the panel's decisions are exported pure functions and
 * its markup is rendered with `renderToStaticMarkup`. The live paths (create,
 * pause, copy, two-step revoke against the API) are exercised in the Task 17
 * Playwright spec.
 */
import { afterAll, describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { mockModuleScoped } from './helpers/scoped-module-mock'
import type { FolderLink } from '../src/lib/folder-link-types'

const apiCalls: string[] = []

await mockModuleScoped('../src/lib/api', import.meta.dir, () => ({
  listFolderLinks: async () => {
    apiCalls.push('listFolderLinks')
    return []
  },
  getFolderMembers: async () => {
    apiCalls.push('getFolderMembers')
    return { members: [], owner_id: 'u-owner' }
  },
  getSharedFolder: async () => {
    apiCalls.push('getSharedFolder')
    throw new Error('not found')
  },
  getEvaluateFlags: async () => ({ flags: {} }),
}))

const {
  FolderSharePanel,
  FolderSharePanelBody,
  memberRows,
  memberLabel,
} = await import('../src/components/folder-share/folder-share-panel')
const { createDisabledReason } = await import('../src/components/folder-share/create-link-form')
const {
  expiryLabel,
  levelChipLabel,
  linkTitle,
  capProgressLabel,
  usageLabel,
  revokeReducer,
  revokeLabel,
  pauseActionLabel,
} = await import('../src/components/folder-share/folder-link-row')

afterAll(() => {
  apiCalls.length = 0
})

function plain(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
}

function link(overrides: Partial<FolderLink> = {}): FolderLink {
  return {
    id: 'l1',
    folder_id: 'folder-1',
    access_level: 'view',
    label_encrypted: null,
    expires_at: null,
    max_opens: null,
    open_count: 0,
    download_count: 4,
    paused: false,
    cap_bytes: null,
    cap_used_bytes: 0,
    passphrase_protected: false,
    created_at: '2026-10-20T00:00:00Z',
    revoked_at: null,
    wrapped_folder_key: null,
    owner_wrapped_key: null,
    owner_wrapped_token: null,
    ...overrides,
  }
}

function body(props: Record<string, unknown> = {}) {
  return createElement(FolderSharePanelBody, {
    folderName: 'Design',
    members: [],
    links: [],
    labels: {},
    urls: {},
    copiedId: null,
    confirmingRevokeId: null,
    onTogglePause: () => undefined,
    onCopy: () => undefined,
    onRevoke: () => undefined,
    ...props,
  } as never)
}

describe('the flag decides the body (2237b)', () => {
  test('flag off renders the untouched bundle fallback and asks for no links', () => {
    apiCalls.length = 0
    let fallbackRendered = 0
    const html = renderToStaticMarkup(
      createElement(FolderSharePanel, {
        open: true,
        folderId: 'folder-1',
        folderName: 'Design',
        onClose: () => undefined,
        bundleFallback: () => {
          fallbackRendered += 1
          return createElement('div', null, 'Shares the 3 files in this folder as they are now.')
        },
      }),
    )
    expect(html).toContain('Shares the 3 files in this folder as they are now.')
    expect(fallbackRendered).toBe(1)
    expect(apiCalls).not.toContain('listFolderLinks')
  })

  test('a closed panel renders nothing', () => {
    const html = renderToStaticMarkup(
      createElement(FolderSharePanel, {
        open: false,
        folderId: 'folder-1',
        folderName: 'Design',
        onClose: () => undefined,
        bundleFallback: () => createElement('div', null, 'fallback'),
      }),
    )
    expect(html).toBe('')
  })
})

describe('the list (2237b)', () => {
  test('the owner row reads "You (owner)" and comes before members', () => {
    const rows = memberRows(
      [
        { user_id: 'u-b', email: 'b@example.com' },
        { user_id: 'u-owner', email: 'me@example.com', is_owner: true },
      ],
      'u-owner',
    )
    expect(rows[0].isOwner).toBe(true)
    expect(memberLabel(rows[0])).toBe('You (owner)')
    expect(rows[1].email).toBe('b@example.com')

    const html = plain(
      renderToStaticMarkup(body({ members: rows, links: [link(), link({ id: 'l2' })] })),
    )
    expect(html).toContain('You (owner)')
    expect(html).toContain('b@example.com')
    expect(html.match(/Untitled link/g) ?? []).toHaveLength(2)
  })

  test('level chips map view/add/edit', () => {
    expect(levelChipLabel('view')).toBe('Can view')
    expect(levelChipLabel('add')).toBe('Can add')
    expect(levelChipLabel('edit')).toBe('Can edit')
    const html = plain(renderToStaticMarkup(body({ links: [link({ access_level: 'add' })] })))
    expect(html).toContain('Can add')
  })

  test('expiry and usage copy', () => {
    const now = Date.parse('2026-10-28T12:00:00Z')
    expect(expiryLabel(null, now)).toBe('Never expires')
    expect(expiryLabel('2026-10-31T12:00:00Z', now)).toBe('Expires in 3 days')
    expect(expiryLabel('2026-10-28T17:00:00Z', now)).toBe('Expires in 5 hours')
    expect(expiryLabel('2026-10-27T12:00:00Z', now)).toBe('Expired')
    expect(usageLabel({ download_count: 4 })).toBe('4 downloads')
    expect(usageLabel({ download_count: 1 })).toBe('1 download')
  })

  test('a capped link shows used of cap', () => {
    // formatBytes is SI (1 GB = 1e9), so the copy reads like the product copy.
    expect(capProgressLabel({ cap_bytes: 5_000_000_000, cap_used_bytes: 1_200_000_000 })).toBe(
      '1.2 GB of 5 GB used',
    )
    expect(capProgressLabel({ cap_bytes: null, cap_used_bytes: 0 })).toBeNull()
  })

  test('a paused link renders Resume, a live one renders Pause', () => {
    expect(pauseActionLabel(true)).toBe('Resume')
    expect(pauseActionLabel(false)).toBe('Pause')
    const paused = plain(renderToStaticMarkup(body({ links: [link({ paused: true })] })))
    expect(paused).toContain('Resume')
    expect(paused).toContain('Paused')
    const live = plain(renderToStaticMarkup(body({ links: [link({ paused: false })] })))
    expect(live).toContain('Pause')
    expect(live).not.toContain('Resume')
  })

  test('a label wins over "Untitled link"', () => {
    expect(linkTitle('Design team')).toBe('Design team')
    expect(linkTitle('   ')).toBe('Untitled link')
  })

  test('revoke needs two clicks and the second one is the revoke', () => {
    const first = revokeReducer({ confirming: false }, 'click')
    expect(first).toEqual({ next: { confirming: true }, revoke: false })
    expect(revokeLabel(first.next.confirming)).toBe('Revoke link?')
    const second = revokeReducer(first.next, 'click')
    expect(second).toEqual({ next: { confirming: false }, revoke: true })
    expect(revokeReducer({ confirming: true }, 'cancel').revoke).toBe(false)
  })

  test('copy confirmation is per link', () => {
    const html = plain(renderToStaticMarkup(body({ links: [link()], copiedId: 'l1' })))
    expect(html).toContain('Link copied.')
    expect(html).not.toContain('Copy link')
  })

  test('20 links disables creating with the server limit spelled out', () => {
    expect(createDisabledReason(19)).toBeNull()
    expect(createDisabledReason(20)).toBe('A folder can have at most 20 links.')
    const links = Array.from({ length: 20 }, (_, i) => link({ id: `l${i}` }))
    const html = plain(
      renderToStaticMarkup(
        body({
          links,
          createSlot: createElement(
            'div',
            null,
            createElement('button', { disabled: true }, 'Create link'),
            createElement('p', null, createDisabledReason(links.length)),
          ),
        }),
      ),
    )
    expect(html).toContain('Create link')
    expect(html).toContain('20 links')
  })
})
