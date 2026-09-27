import { describe, test, expect } from 'bun:test'
import {
  deriveButtonState,
  filterPaletteEntries,
  WRITER_PALETTE_ENTRIES,
  WRITER_HOME_COMMANDS,
  type UnoStateMap,
} from '../src/lib/office/ribbon-commands'

describe('deriveButtonState', () => {
  test('defaults to enabled + unpressed before any state has arrived', () => {
    expect(deriveButtonState({}, '.uno:Bold')).toEqual({ enabled: true, pressed: false })
  })

  test('a toggle command reflects state:true as pressed', () => {
    const states: UnoStateMap = { '.uno:Bold': { isEnabled: true, state: true } }
    expect(deriveButtonState(states, '.uno:Bold')).toEqual({ enabled: true, pressed: true })
  })

  test('a toggle command reflects state:false as not pressed', () => {
    const states: UnoStateMap = { '.uno:Bold': { isEnabled: true, state: false } }
    expect(deriveButtonState(states, '.uno:Bold')).toEqual({ enabled: true, pressed: false })
  })

  test('a disabled command is never pressed even if its state is true', () => {
    const states: UnoStateMap = { '.uno:Bold': { isEnabled: false, state: true } }
    expect(deriveButtonState(states, '.uno:Bold')).toEqual({ enabled: false, pressed: true })
  })

  test('a non-toggle command (Undo) is never "pressed" regardless of its state payload', () => {
    const states: UnoStateMap = { '.uno:Undo': { isEnabled: true, state: 'whatever' } }
    expect(deriveButtonState(states, '.uno:Undo').pressed).toBe(false)
  })

  test('every alignment command toggles independently', () => {
    const states: UnoStateMap = {
      '.uno:LeftPara': { isEnabled: true, state: true },
      '.uno:CenterPara': { isEnabled: true, state: false },
    }
    expect(deriveButtonState(states, '.uno:LeftPara').pressed).toBe(true)
    expect(deriveButtonState(states, '.uno:CenterPara').pressed).toBe(false)
  })
})

describe('WRITER_HOME_COMMANDS', () => {
  test('every command id is unique (React keys / test selectors depend on this)', () => {
    const ids = WRITER_HOME_COMMANDS.map((d) => d.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  test('every command targets a real .uno: command', () => {
    for (const def of WRITER_HOME_COMMANDS) {
      expect(def.command.startsWith('.uno:')).toBe(true)
    }
  })
})

describe('filterPaletteEntries', () => {
  test('empty query returns every entry, in table order', () => {
    expect(filterPaletteEntries(WRITER_PALETTE_ENTRIES, '')).toEqual(WRITER_PALETTE_ENTRIES)
  })

  test('"heading" surfaces Heading 1/2/3 in order, matching the approved mockup', () => {
    const results = filterPaletteEntries(WRITER_PALETTE_ENTRIES, 'heading')
    expect(results.map((r) => r.label)).toEqual(['Heading 1', 'Heading 2', 'Heading 3'])
  })

  test('is case-insensitive', () => {
    expect(filterPaletteEntries(WRITER_PALETTE_ENTRIES, 'HEADING').length).toBe(3)
  })

  test('matching nothing returns an empty array, not the full table', () => {
    expect(filterPaletteEntries(WRITER_PALETTE_ENTRIES, 'xyz-does-not-exist')).toEqual([])
  })

  test('a query with only whitespace is treated as empty', () => {
    expect(filterPaletteEntries(WRITER_PALETTE_ENTRIES, '   ')).toEqual(WRITER_PALETTE_ENTRIES)
  })
})
