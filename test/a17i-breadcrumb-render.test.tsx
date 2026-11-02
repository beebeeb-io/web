/**
 * A17i (rendering): the breadcrumb draws the shared root and the current
 * segment at every depth and width — the collapse keeps both, and the marker
 * comes from this client's own custody proof by id.
 */
import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { Breadcrumb, type BreadcrumbItem } from '../src/components/breadcrumb'
import { markCustodySeen } from '../src/lib/custody-memory'

const FAMILY = '11111111-1111-4111-8111-111111111111'
const OTHER = '33333333-3333-4333-8333-333333333333'

const html = (items: BreadcrumbItem[]) =>
  renderToStaticMarkup(<Breadcrumb items={items} onNavigate={() => {}} />)

describe('A17i breadcrumb', () => {
  test('a deep trail keeps the proven shared root, an ellipsis and the current segment', () => {
    markCustodySeen(FAMILY)
    const out = html([
      { id: null, name: 'Drive' },
      { id: FAMILY, name: 'Family' },
      { id: '44444444-4444-4444-8444-444444444444', name: '2024' },
      { id: '55555555-5555-4555-8555-555555555555', name: 'Photos' },
      { id: '66666666-6666-4666-8666-666666666666', name: 'Trip' },
    ])
    expect(out).toContain('Family (shared)')
    expect(out).toContain('breadcrumb-ellipsis')
    expect(out).toContain('Trip')
    expect(out).not.toContain('>2024<')
  })

  test('a shallow trail is drawn whole and a same name without proof is unmarked', () => {
    const out = html([
      { id: null, name: 'Drive' },
      { id: OTHER, name: 'Family' },
    ])
    expect(out).toContain('Family')
    expect(out).not.toContain('(shared)')
  })

  test('A17d: the marker holds by id when the name failed to decrypt', () => {
    markCustodySeen(FAMILY)
    const out = html([
      { id: null, name: 'Drive' },
      { id: FAMILY, name: 'Unable to decrypt' },
      { id: '44444444-4444-4444-8444-444444444444', name: '2024' },
      { id: '55555555-5555-4555-8555-555555555555', name: 'Photos' },
      { id: '66666666-6666-4666-8666-666666666666', name: 'Trip' },
    ])
    expect(out).toContain('Unable to decrypt (shared)')
  })
})
