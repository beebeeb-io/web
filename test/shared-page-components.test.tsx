/**
 * Task W-P2-4 — the Shared page's extracted cards and its item union.
 * Static markup only; the page's actions stay covered by its Playwright run.
 */
import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { SharedLinkCard } from '../src/pages/shared/share-link-card'
import { SharedInviteRow } from '../src/pages/shared/shared-invite-row'
import { isSharedFolder, sharedItemFile, sharedItemOf } from '../src/pages/shared/shared-item'
import { bundleChipLabel, formatExpiry, formatExpiryDate, isExpired, timeAgo } from '../src/pages/shared/format'
import type { DriveFile, MyShare, ShareInvite } from '../src/lib/api'

const html = (el: React.ReactElement) => renderToStaticMarkup(el)

function share(over: Partial<MyShare> = {}): MyShare {
  return {
    id: 's1',
    file_id: 'f1',
    share_type: 'file',
    item_count: 1,
    open_count: 3,
    max_opens: null,
    has_passphrase: false,
    last_opened_at: null,
    expires_at: null,
    created_at: '2026-10-01T10:00:00.000Z',
    revoked: false,
    file: { name_encrypted: '{"nonce":"x","ciphertext":"y"}' },
    ...over,
  } as MyShare
}

function invite(over: Partial<ShareInvite> = {}): ShareInvite {
  return {
    id: 'i1',
    file_id: 'f1',
    status: 'invited',
    sender_email: 'owner@example.com',
    recipient_email: 'friend@example.com',
    created_at: '2026-10-01T10:00:00.000Z',
    claimed_at: null,
    is_folder: false,
    ...over,
  } as ShareInvite
}

describe('SharedItem union', () => {
  test('the server flag maps to the union, exhaustively', () => {
    const asFile: DriveFile = { id: 'a', is_folder: false } as DriveFile
    const asFolder: DriveFile = { id: 'b', is_folder: true } as DriveFile
    expect(sharedItemOf(asFile).kind).toBe('file')
    expect(sharedItemOf(asFolder).kind).toBe('folder')

    const kindOf = (item: ReturnType<typeof sharedItemOf>): string => {
      switch (item.kind) {
        case 'file': return 'file'
        case 'folder': return 'folder'
      }
    }
    expect(kindOf(sharedItemOf(asFile))).toBe('file')
    expect(kindOf(sharedItemOf(asFolder))).toBe('folder')
    expect(isSharedFolder(sharedItemOf(asFolder))).toBe(true)
    expect(isSharedFolder(sharedItemOf(asFile))).toBe(false)
    expect(sharedItemFile(sharedItemOf(asFile)).id).toBe('a')
  })
})

describe('shared formatting', () => {
  test('bundle chip only for bundle shares', () => {
    expect(bundleChipLabel({ share_type: 'file', item_count: 3 } as MyShare)).toBeNull()
    expect(bundleChipLabel({ share_type: 'bundle', item_count: 1 } as MyShare)).toBe('bundle · 1 file')
    expect(bundleChipLabel({ share_type: 'bundle', item_count: 4 } as MyShare)).toBe('bundle · 4 files')
  })

  test('expiry wording keeps the old ladder', () => {
    const past = '2020-01-01T00:00:00.000Z'
    expect(formatExpiry(null)).toBe('No expiry')
    expect(isExpired(null)).toBe(false)
    expect(formatExpiry(past)).toBe('Expired')
    expect(isExpired(past)).toBe(true)
    expect(formatExpiryDate(null)).toBe('No expiry')
    expect(formatExpiryDate(past)).toBe('Expired')
  })

  test('timeAgo keeps its four buckets', () => {
    const now = Date.now()
    expect(timeAgo(new Date(now - 5_000).toISOString())).toBe('just now')
    expect(timeAgo(new Date(now - 5 * 60_000).toISOString())).toBe('5m ago')
    expect(timeAgo(new Date(now - 5 * 3_600_000).toISOString())).toBe('5h ago')
    expect(timeAgo(new Date(now - 3 * 86_400_000).toISOString())).toBe('3d ago')
  })
})

describe('SharedLinkCard', () => {
  const base = {
    share: share(),
    name: 'holiday.jpg',
    isExpanded: false,
    canCopy: true,
    isRevoking: false,
    onToggleExpanded: () => {},
    onCopy: () => {},
    onRevoke: () => {},
  }

  test('draws the name, views and expiry badge', () => {
    const out = html(<SharedLinkCard {...base} />)
    expect(out).toContain('holiday.jpg')
    expect(out).toContain('3')
    expect(out).toContain('views')
    expect(out).toContain('No expiry')
    expect(out).toContain('aria-label')
  })

  test('a bundle share draws its chip', () => {
    const out = html(<SharedLinkCard {...base} share={share({ share_type: 'bundle', item_count: 4 })} />)
    expect(out).toContain('bundle · 4 files')
  })

  test('the insights panel only exists when expanded, with or without a stored key', () => {
    expect(html(<SharedLinkCard {...base} />)).not.toContain('Revoke link')
    const expanded = html(<SharedLinkCard {...base} isExpanded />)
    expect(expanded).toContain('Revoke link')
    expect(expanded).toContain('Copy link')
    const noKey = html(<SharedLinkCard {...base} isExpanded canCopy={false} />)
    expect(noKey).toContain('isn')
    expect(noKey).not.toContain('Copy link')
  })
})

describe('SharedInviteRow', () => {
  test('claim variant: who shared and the Claim action', () => {
    const out = html(<SharedInviteRow variant="claim" invite={invite()} />)
    expect(out).toContain('owner@example.com')
    expect(out).toContain('shared a file')
    expect(out).toContain('Claim')
  })

  test('waiting-to-claim variant: recipient and chip', () => {
    const out = html(<SharedInviteRow variant="waiting-to-claim" invite={invite()} />)
    expect(out).toContain('friend@example.com')
    expect(out).toContain('Waiting to claim')
    expect(out).not.toContain('Claim</button>')
  })

  test('waiting-approval variant: sender and chip', () => {
    const out = html(<SharedInviteRow variant="waiting-approval" invite={invite({ status: 'claimed' })} />)
    expect(out).toContain('owner@example.com')
    expect(out).toContain('Waiting for approval')
  })
})
