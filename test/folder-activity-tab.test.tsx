/**
 * Task 2237b — the folder activity list the owner reads.
 *
 * The copy is what users judge the release blocker by, so it is asserted on the
 * presentational list (the fetching wrapper needs effects, which this suite has
 * no DOM for; the live path runs in the Task 17 Playwright spec).
 */
import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  describeActivity,
  FolderActivityList,
} from '../src/components/folder-share/folder-activity-tab'
import type { SharedFolderActivityRow } from '../src/lib/folder-link-types'

function plain(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
}

function row(
  id: string,
  kind: SharedFolderActivityRow['kind'],
  itemCount: number,
  shareLabel: string | null,
  actor: string | null,
): SharedFolderActivityRow {
  return {
    id,
    kind,
    share_id: shareLabel ? `share-${id}` : null,
    share_label_encrypted: null,
    actor_user_id: null,
    actor_name_encrypted: null,
    item_count: itemCount,
    first_at: '2026-10-27T10:00:00Z',
    last_at: '2026-10-27T10:00:00Z',
  }
}

describe('describeActivity', () => {
  test('files added name the link they came through', () => {
    expect(describeActivity({ kind: 'files_added', item_count: 12 }, 'Family WhatsApp', 'Sam')).toBe(
      '12 files added via Family WhatsApp',
    )
    expect(describeActivity({ kind: 'files_added', item_count: 1 }, 'Family WhatsApp', null)).toBe(
      '1 file added via Family WhatsApp',
    )
  })

  test('deleted items say they are restorable and by whom', () => {
    const text = describeActivity({ kind: 'items_deleted', item_count: 3 }, null, 'Mum')
    expect(text).toBe('3 items deleted by Mum — restorable from Trash for 30 days')
  })

  test('renamed items count and name the actor', () => {
    expect(describeActivity({ kind: 'items_renamed', item_count: 2 }, null, 'Sam')).toBe(
      '2 items renamed by Sam',
    )
  })

  test('moves name the actor', () => {
    expect(describeActivity({ kind: 'items_moved', item_count: 4 }, null, 'Sam')).toBe('Items moved by Sam')
  })

  test('an undecryptable actor renders Someone and still shows the action', () => {
    expect(describeActivity({ kind: 'files_added', item_count: 2 }, null, null)).toBe('2 files added')
    expect(describeActivity({ kind: 'items_renamed', item_count: 2 }, null, null)).toBe(
      '2 items renamed by Someone',
    )
  })
})

describe('FolderActivityList', () => {
  test('renders rows in the order the API returned them', () => {
    const rows = [
      row('r1', 'files_added', 12, 'Family WhatsApp', 'Sam'),
      row('r2', 'items_deleted', 3, null, 'Mum'),
      row('r3', 'items_renamed', 2, null, 'Sam'),
    ]
    const html = plain(
      renderToStaticMarkup(
        createElement(FolderActivityList, {
          rows,
          labels: { r1: 'Family WhatsApp' },
          actors: { r1: 'Sam', r2: 'Mum', r3: 'Sam' },
        }),
      ),
    )
    const i1 = html.indexOf('12 files added via Family WhatsApp')
    const i2 = html.indexOf('3 items deleted by Mum')
    const i3 = html.indexOf('2 items renamed by Sam')
    expect(i1).toBeGreaterThan(-1)
    expect(i2).toBeGreaterThan(i1)
    expect(i3).toBeGreaterThan(i2)
  })

  test('an empty response says so', () => {
    const html = plain(renderToStaticMarkup(createElement(FolderActivityList, { rows: [] })))
    expect(html).toBe('No activity yet.')
  })
})
