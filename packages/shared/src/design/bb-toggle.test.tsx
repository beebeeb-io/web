import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { BBToggle, bbToggleClassNames } from './bb-toggle'
import { BBDensityProvider, type BBDensity } from './density'

// Admin redesign 2018 / S1: "Same size on and off. The colour sits on the inner track, never on
// the button box, so no global button rule can stretch it." (Kit-Desktop.dc.html, Switches)

function render(on: boolean, density: BBDensity, disabled = false): string {
  return renderToStaticMarkup(
    <BBDensityProvider density={density}>
      <BBToggle on={on} disabled={disabled} aria-label="Send alerts" />
    </BBDensityProvider>,
  )
}

function buttonClass(html: string): string {
  const m = html.match(/^<button[^>]*class="([^"]*)"/)
  if (!m) throw new Error(`no button class in ${html}`)
  return m[1]
}

for (const density of ['compact', 'comfortable'] as const) {
  describe(`BBToggle, ${density}`, () => {
    test('the button box has the same classes on and off', () => {
      expect(buttonClass(render(true, density))).toBe(buttonClass(render(false, density)))
      expect(bbToggleClassNames(true, false, density).box).toBe(bbToggleClassNames(false, false, density).box)
    })

    test('amber is on the inner track only, and only when on', () => {
      for (const on of [true, false]) {
        expect(buttonClass(render(on, density))).not.toContain('amber')
      }
      expect(bbToggleClassNames(true, false, density).track).toMatch(/(^|\s)bg-amber(\s|$)/)
      expect(bbToggleClassNames(false, false, density).track).not.toContain('amber')
    })

    test('is a labelled switch whose aria-checked follows on', () => {
      expect(render(true, density)).toContain('role="switch"')
      expect(render(true, density)).toContain('aria-checked="true"')
      expect(render(false, density)).toContain('aria-checked="false"')
      expect(render(false, density)).toContain('aria-label="Send alerts"')
    })
  })
}

describe('BBToggle, compact geometry (kit)', () => {
  const box = bbToggleClassNames(false, false, 'compact').box.split(/\s+/)
  const track = bbToggleClassNames(false, false, 'compact').track.split(/\s+/)

  test('phone: a 60 × 44 hit box around a 44 × 26 track', () => {
    expect(box).toContain('h-11')
    expect(box).toContain('w-[60px]')
    expect(track).toContain('h-[26px]')
    expect(track).toContain('w-11')
  })

  test('desktop: a 52 × 36 box around a 36 × 20 track', () => {
    expect(box).toContain('md:h-9')
    expect(box).toContain('md:w-[52px]')
    expect(track).toContain('md:h-5')
    expect(track).toContain('md:w-9')
  })

  test('the knob travels to 2 px from the far edge (phone 18 px, desktop 16 px)', () => {
    const knob = bbToggleClassNames(true, false, 'compact').knob.split(/\s+/)
    expect(knob).toContain('translate-x-[18px]')
    expect(knob).toContain('md:translate-x-4')
  })

  test('marks itself so the admin stylesheet leaves it alone; disabled dims to 0.45', () => {
    expect(render(false, 'compact', true)).toContain('data-bb="toggle"')
    expect(box).toContain('disabled:opacity-45')
  })
})

describe('BBToggle, comfortable geometry (web, unchanged)', () => {
  test('the pre-S1 geometry: a 36 × 20 box, the in-flow knob 2 px in off and 16 px in on', () => {
    const on = bbToggleClassNames(true, false, 'comfortable')
    const off = bbToggleClassNames(false, false, 'comfortable')
    expect(on.box.split(/\s+/)).toEqual(expect.arrayContaining(['h-5', 'w-9', 'border', 'border-transparent', 'items-center']))
    // The track covers the whole 36 × 20 border box, behind the knob.
    expect(on.track.split(/\s+/)).toEqual(expect.arrayContaining(['absolute', '-inset-px', 'border']))
    expect(on.knob.split(/\s+/)).toEqual(expect.arrayContaining(['inline-block', 'h-3.5', 'w-3.5', 'translate-x-4']))
    expect(off.knob.split(/\s+/)).toContain('translate-x-0.5')
    // Knob first in flow, track not wrapping it: the button keeps the old text baseline.
    expect(render(true, 'comfortable')).toMatch(/^<button[^>]*><span aria-hidden="true" class="absolute [^"]*"><\/span><span class="relative inline-block/)
    expect(render(false, 'comfortable')).not.toContain('data-bb')
  })
})
