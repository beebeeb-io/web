/**
 * Task 1705 — the drive sidebar's storage section must render exactly ONE
 * progress bar, at every usage level.
 *
 * Bug (user ruling, verbatim: "putting it 2x in there is not right. Remove
 * that it does that at 80% usage" / "showing 'Running low. Upgrade' is a good
 * one to show, but not 2x the status bar"): at ≥80% usage the sidebar stacked
 * a SECOND 3px progress bar (`SidebarQuotaBar`, formerly drive-layout.tsx)
 * under the always-present compact `StorageUsageBar` bar — two bars, plus a
 * duplicated "X of Y used" numbers block in the 80–95% band.
 *
 * Fix under test: the sidebar mounts `SidebarStorageFooter` (the extracted
 * real section — Storage/plan header, ONE `StorageUsageBar` compact, region
 * row). The single bar carries the warning line itself: "Running low.
 * Upgrade →" from ≥80%, escalating to "Almost full. Upgrade →" at ≥95%.
 * RED evidence (against a068fd8 + an export-only test seam on the then-real
 * SidebarQuotaBar): 3 pass / 3 fail — 2 bar tracks at ≥80% and the duplicated
 * numbers block (verification-evidence/1705/01-t1705-sidebar-bars-red-before-fix.txt).
 *
 * `renderToStaticMarkup` runs one synchronous pass, no effects (the 80ms
 * mount animation affects width style only, never element counts).
 *
 * Assertions (COUNTS, per the evidence protocol):
 *   ≥80%  → exactly 1 bar-track element + exactly 1 warning line, no
 *           duplicated "X of Y used" numbers block.
 *   ≥95%  → same, wording escalated to "Almost full".
 *   <80%  → 1 bar, zero warning lines.
 *
 * Bar tracks are counted via the `h-[3px]` class the bar track carries;
 * warning lines via the two status phrases.
 */
import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'

const { SidebarStorageFooter } = await import('../src/components/sidebar-storage-footer')

const QUOTA = 100 * 1000 ** 3 // 100 GB

/** Render the sidebar storage section at a given usage percentage. */
function renderSection(pct: number): string {
  const used = Math.round(QUOTA * (pct / 100))
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(SidebarStorageFooter, {
        usedBytes: used,
        quotaBytes: QUOTA,
        planLabel: 'pro plan',
        storageRegion: 'auto',
      }),
    ),
  )
}

/** Count 3px progress-bar track elements (the bar track carries `h-[3px]`). */
function countBarTracks(html: string): number {
  return (html.match(/h-\[3px\]/g) ?? []).length
}

/** Count warning lines (either status phrase; link text excluded). */
function countWarningLines(html: string): number {
  return (html.match(/Running low|Almost full/g) ?? []).length
}

describe('sidebar storage section — exactly ONE progress bar (task 1705)', () => {
  test('≥80% (90.5%): exactly ONE bar-track element and exactly ONE warning line', () => {
    const html = renderSection(90.5)
    expect(countBarTracks(html)).toBe(1)
    expect(countWarningLines(html)).toBe(1)
  })

  test('≥80% (90.5%): warning says "Running low" and links to /billing', () => {
    const html = renderSection(90.5)
    expect(html).toContain('Running low.')
    expect(html).not.toContain('Almost full')
    expect(html).toContain('href="/billing"')
  })

  test('≥80% (90.5%): no duplicated "X of Y used" numbers block', () => {
    const html = renderSection(90.5)
    expect(html).not.toMatch(/\bof\b[\s\S]*\bused\b/)
  })

  test('≥95% (95.5%): exactly ONE bar-track element and exactly ONE warning line', () => {
    const html = renderSection(95.5)
    expect(countBarTracks(html)).toBe(1)
    expect(countWarningLines(html)).toBe(1)
  })

  test('≥95% (95.5%): wording escalates to "Almost full"', () => {
    const html = renderSection(95.5)
    expect(html).toContain('Almost full.')
    expect(html).not.toContain('Running low')
  })

  test('<80% (50%): one bar, ZERO warning lines, no second bar', () => {
    const html = renderSection(50)
    expect(countBarTracks(html)).toBe(1)
    expect(countWarningLines(html)).toBe(0)
    expect(html).not.toMatch(/\bof\b[\s\S]*\bused\b/)
  })

  test('sidebar continuity: compact numbers, Manage link and region row stay', () => {
    const html = renderSection(90.5)
    expect(html).toContain('Manage')
    expect(html).toContain('/')
    expect(html).toContain('Europe')
    expect(html).toContain('pro plan')
  })
})
