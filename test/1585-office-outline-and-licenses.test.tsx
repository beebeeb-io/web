/**
 * Task 1585 — item 3 (phone-width outline) and the licenses link, at the
 * render level. The real-engine behaviour (overlay, no canvas resize,
 * breakpoint crossing) is covered by e2e/1585-office-followups.spec.ts.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { OutlinePane, OUTLINE_NARROW_QUERY } from '../src/components/office/outline-pane'
import { officeNoticesUrl, OFFICE_SOURCE_URL } from '../src/components/office/office-engine-host'
import { OfficeStatusBar } from '../src/components/office/office-status-bar'
import { OfficeAbout } from '../src/components/office/office-about'

const g = globalThis as { window?: unknown }
const hadWindow = 'window' in g
const originalWindow = g.window

/** A window whose matchMedia answers `matches` for the outline's query only. */
function setViewport(narrow: boolean) {
  g.window = {
    matchMedia: (q: string) => ({
      matches: q === OUTLINE_NARROW_QUERY ? narrow : false,
      media: q,
      addEventListener() {},
      removeEventListener() {},
    }),
  }
}

afterEach(() => {
  if (hadWindow) g.window = originalWindow
  else delete g.window
})

const HEADINGS = [
  { level: 1, text: 'Experience' },
  { level: 2, text: 'Education' },
]

describe('OutlinePane default state by width', () => {
  test('phone portrait (< 640 px): starts collapsed to the rail, no pane', () => {
    setViewport(true)
    const html = renderToStaticMarkup(<OutlinePane headings={HEADINGS} onSelect={() => {}} />)
    expect(html).toContain('data-testid="office-outline-rail"')
    expect(html).toContain('aria-label="Show outline"')
    expect(html).not.toContain('data-testid="office-outline-pane"')
    expect(html).not.toContain('Experience')
  })

  test('desktop: the docked 216 px pane, expanded, not an overlay', () => {
    setViewport(false)
    const html = renderToStaticMarkup(<OutlinePane headings={HEADINGS} onSelect={() => {}} />)
    expect(html).toContain('data-testid="office-outline-pane"')
    expect(html).toContain('w-[216px]')
    expect(html).not.toContain('data-overlay')
    expect(html).not.toContain('data-testid="office-outline-rail"')
    expect(html).toContain('Experience')
  })

  test('no matchMedia at all (SSR, old engines): the desktop default', () => {
    delete g.window
    const html = renderToStaticMarkup(<OutlinePane headings={HEADINGS} onSelect={() => {}} />)
    expect(html).toContain('data-testid="office-outline-pane"')
  })

  test('the breakpoint is Tailwind sm (639 px and below is narrow)', () => {
    expect(OUTLINE_NARROW_QUERY).toBe('(max-width: 639px)')
  })
})

describe('licenses link', () => {
  test('points at the running engine version’s THIRD_PARTY_NOTICES.txt', () => {
    expect(officeNoticesUrl('/office', 'phase4-2026-09-27')).toBe('/office/phase4-2026-09-27/THIRD_PARTY_NOTICES.txt')
    // A version is a path segment, never a path.
    expect(officeNoticesUrl('/office', '../x')).toBe('/office/..%2Fx/THIRD_PARTY_NOTICES.txt')
  })

  test('names the source repository', () => {
    expect(OFFICE_SOURCE_URL).toBe('https://github.com/beebeeb-io/office')
  })

  test('the status bar carries the Licenses control in both its loading and normal states', () => {
    const about = <OfficeAbout noticesUrl="/office/v1/THIRD_PARTY_NOTICES.txt" />
    const base = { pageLabel: null, wordCount: 3, dirty: false, conflict: false, versionNumber: 1, lastSavedAt: null, about }
    for (const html of [
      renderToStaticMarkup(<OfficeStatusBar {...base} />),
      renderToStaticMarkup(<OfficeStatusBar {...base} loadingLabel="Preparing the editor on this device…" />),
    ]) {
      expect(html).toContain('data-testid="office-about-button"')
      expect(html).toContain('>Licenses<')
    }
  })
})
