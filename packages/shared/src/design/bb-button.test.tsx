import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { BBButton, bbButtonClassName, type BBButtonSize, type BBButtonVariant } from './bb-button'
import { BBDensityProvider } from './density'

// Admin redesign 2018 / S1. The web app keeps `comfortable`; the admin opts into `compact`
// (the "Component kit" artboard, design/admin-redesign-2026-10/Kit-Desktop.dc.html + Kit-Phone).

/** BBButton's classes before S1, copied from web main 486832c. The web app must not change. */
const PRE_S1_BASE =
  'inline-flex items-center justify-center font-medium transition-all cursor-pointer focus-visible:ring-2 focus-visible:ring-amber-deep focus-visible:ring-offset-2'
const PRE_S1_VARIANT = {
  amber: 'bg-amber text-[oklch(0.22_0.01_70)] hover:brightness-95 active:brightness-90',
  default: 'bg-paper text-ink border border-line hover:bg-paper-2 active:bg-paper-3',
  ghost: 'bg-transparent text-ink-2 hover:bg-paper-2 active:bg-paper-3',
  danger: 'bg-red text-white hover:brightness-95 active:brightness-90',
} as const
const PRE_S1_SIZE = {
  sm: 'px-sm py-xs text-sm rounded-sm',
  md: 'px-md py-sm text-sm rounded-md',
  lg: 'px-lg py-md text-base rounded-lg',
} as const

function classOf(html: string): string {
  const m = html.match(/class="([^"]*)"/)
  if (!m) throw new Error(`no class attribute in ${html}`)
  return m[1]
}

function tokens(classes: string): string[] {
  return classes.split(/\s+/).filter(Boolean)
}

describe('BBButton, comfortable (web): unchanged by S1', () => {
  for (const variant of Object.keys(PRE_S1_VARIANT) as (keyof typeof PRE_S1_VARIANT)[]) {
    for (const size of Object.keys(PRE_S1_SIZE) as (keyof typeof PRE_S1_SIZE)[]) {
      test(`${variant} × ${size} renders the pre-S1 class string`, () => {
        const html = renderToStaticMarkup(
          <BBButton variant={variant} size={size} className="extra">
            Go
          </BBButton>,
        )
        expect(classOf(html)).toBe(`${PRE_S1_BASE} ${PRE_S1_VARIANT[variant]} ${PRE_S1_SIZE[size]} extra`)
        expect(html).not.toContain('data-bb')
      })
    }
  }

  test('the defaults are still default × md', () => {
    const html = renderToStaticMarkup(<BBButton>Go</BBButton>)
    expect(classOf(html)).toBe(`${PRE_S1_BASE} ${PRE_S1_VARIANT.default} ${PRE_S1_SIZE.md} `)
  })

  test('primary and secondary are the same buttons as amber and default', () => {
    expect(bbButtonClassName('primary', 'md')).toBe(bbButtonClassName('amber', 'md'))
    expect(bbButtonClassName('secondary', 'sm')).toBe(bbButtonClassName('default', 'sm'))
  })
})

describe('BBButton, compact (admin kit)', () => {
  const kitVariants: BBButtonVariant[] = ['primary', 'secondary', 'ghost', 'danger', 'danger-solid']
  const kitSizes: BBButtonSize[] = ['sm', 'md', 'touch']

  // Desktop min-heights from the kit's "Sizes" row: Small 28, Medium 34, Touch 44.
  const desktopMinHeight: Record<BBButtonSize, string> = {
    sm: 'md:min-h-7',
    md: 'md:min-h-[34px]',
    touch: 'min-h-11',
    lg: 'min-h-11',
  }

  for (const size of kitSizes) {
    test(`${size}: desktop height from the kit, and 44 × 44 below md`, () => {
      const t = tokens(bbButtonClassName('secondary', size, 'compact'))
      expect(t).toContain(desktopMinHeight[size])
      // Phone: every button is a 44 px target (min-h-11 / min-w-11 unprefixed).
      expect(t).toContain('min-h-11')
      expect(t).toContain('min-w-11')
      // No other unprefixed height may undercut it.
      expect(t.filter(c => /^(h|min-h|max-h)-/.test(c))).toEqual(['min-h-11'])
    })
  }

  test('lg renders as touch', () => {
    expect(bbButtonClassName('primary', 'lg', 'compact')).toBe(bbButtonClassName('primary', 'touch', 'compact'))
  })

  test('amber fills only the primary variant', () => {
    expect(tokens(bbButtonClassName('primary', 'md', 'compact'))).toContain('bg-amber')
    for (const v of kitVariants.filter(v => v !== 'primary')) {
      expect(bbButtonClassName(v, 'md', 'compact')).not.toMatch(/(^|\s)(\w+:)*(bg|border|text)-amber/)
    }
  })

  test('danger is outlined (it opens the confirm step); only danger-solid is filled red', () => {
    const danger = tokens(bbButtonClassName('danger', 'md', 'compact'))
    expect(danger).toContain('border-red-border')
    expect(danger).toContain('bg-[oklch(0.995_0.002_85)]')
    expect(tokens(bbButtonClassName('danger-solid', 'md', 'compact'))).toContain('bg-[oklch(0.52_0.19_25)]')
  })

  test('every variant has a disabled look of its own (no reliance on a page stylesheet)', () => {
    for (const v of kitVariants) {
      expect(bbButtonClassName(v, 'md', 'compact')).toMatch(/(^|\s)disabled:text-\[/)
    }
  })

  test('renders with the compact classes and marks itself under the provider', () => {
    const html = renderToStaticMarkup(
      <BBDensityProvider density="compact">
        <BBButton variant="amber" size="sm">
          Save
        </BBButton>
      </BBDensityProvider>,
    )
    expect(classOf(html)).toBe(`${bbButtonClassName('primary', 'sm', 'compact')} `)
    expect(html).toContain('data-bb="button"')
    expect(html).toContain('data-variant="primary"')
    expect(html).toContain('data-size="sm"')
  })
})
