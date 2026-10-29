import { describe, test, expect } from 'bun:test'
import { TEMPLATE_DEFS } from '../src/lib/office/templates'

describe('TEMPLATE_DEFS', () => {
  test('offers exactly the five templates in the approved mockup, in order', () => {
    expect(TEMPLATE_DEFS.map((t) => t.label)).toEqual(['Blank', 'Letter', 'Invoice', 'Meeting notes', 'Report'])
  })

  test('every id is unique', () => {
    const ids = TEMPLATE_DEFS.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  test('every template has a non-empty description', () => {
    for (const t of TEMPLATE_DEFS) {
      expect(t.description.length).toBeGreaterThan(0)
    }
  })
})
