/**
 * Task W-P2-1 — the drive page's extracted presentational pieces. One render
 * test per component that draws without a provider; the containers that call
 * the page's hooks stay covered by the page's Playwright snapshot pair.
 */
import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { DriveTopBar, type DriveTopBarProps } from '../src/pages/drive/drive-top-bar'
import { DriveBanners, type DriveBannersProps } from '../src/pages/drive/drive-banners'

const html = (el: React.ReactElement) => renderToStaticMarkup(el)

const topBar: DriveTopBarProps = {
  breadcrumbs: [
    { id: null, name: 'My files' },
    { id: 'd1', name: 'Photos' },
  ],
  onNavigate: () => {},
  folderId: 'd1',
  sharedFolderIds: new Set<string>(),
  currentUserId: null,
  officeAvailable: false,
  frozen: false,
  uploadMenuOpen: false,
  onToggleUploadMenu: () => {},
  onNewFolder: () => {},
  onNewDocument: () => {},
  onUpload: () => {},
  onUploadFolder: () => {},
}

const banners: DriveBannersProps = {
  pausedUploads: [],
  onResumeSelect: () => {},
  onDismissPaused: () => {},
  loadError: null,
  onRetryLoad: () => {},
  dedupWarning: null,
  onDedupUpload: () => {},
  onDedupSkip: () => {},
  storageUsage: null,
  accountState: 'ok',
  subscription: null,
  onUpgrade: () => {},
  incomingInviteCount: 0,
  pendingApprovalCount: 0,
  pendingSharesDismissed: true,
  onDismissPendingShares: () => {},
  onViewPendingShares: () => {},
  folderSuggestion: null,
  suggestionCreating: false,
  isRoot: true,
  onAcceptSuggestion: () => {},
  onDismissSuggestion: () => {},
}

describe('DriveTopBar', () => {
  test('draws every breadcrumb and the New/Upload controls', () => {
    const out = html(<DriveTopBar {...topBar} />)
    expect(out).toContain('My files')
    expect(out).toContain('Photos')
    expect(out).toContain('New')
    expect(out).toContain('Upload')
  })

  test('the upload menu only renders when it is open', () => {
    const closed = html(<DriveTopBar {...topBar} />)
    const open = html(<DriveTopBar {...topBar} uploadMenuOpen />)
    expect(closed.length).toBeLessThan(open.length)
  })
})

describe('DriveBanners', () => {
  test('draws nothing when there is nothing to say', () => {
    expect(html(<DriveBanners {...banners} />)).toBe('')
  })

  test('a load error draws the retry banner', () => {
    const out = html(<DriveBanners {...banners} loadError="Network down" />)
    expect(out).toContain('Network down')
  })

  test('paused uploads draw the resume banner with their count', () => {
    const out = html(
      <DriveBanners
        {...banners}
        pausedUploads={[
          { id: 'u1' } as unknown as DriveBannersProps['pausedUploads'][number],
          { id: 'u2' } as unknown as DriveBannersProps['pausedUploads'][number],
        ]}
      />,
    )
    expect(out).toContain('2')
  })

  test('a dedup warning names the existing file', () => {
    const out = html(
      <DriveBanners
        {...banners}
        dedupWarning={{ file: new File([], 'a.txt'), hash: 'h', existingName: 'a (1).txt', otherFiles: [] }}
      />,
    )
    expect(out).toContain('a (1).txt')
  })

  test('the folder suggestion only appears at the root', () => {
    const sug = { type: 'images' as const, count: 4 }
    expect(html(<DriveBanners {...banners} folderSuggestion={sug} />)).toContain('4')
    expect(html(<DriveBanners {...banners} folderSuggestion={sug} isRoot={false} />)).toBe('')
  })
})
