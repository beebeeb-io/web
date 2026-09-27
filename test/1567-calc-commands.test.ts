import { describe, test, expect } from 'bun:test'
import {
  deriveCalcButtonState,
  CALC_HOME_COMMANDS,
  CALC_STATE_COMMANDS,
  CALC_PALETTE_ENTRIES,
  type UnoStateMap,
} from '../src/lib/office/calc-commands'

describe('deriveCalcButtonState', () => {
  test('defaults to enabled + unpressed before any state has arrived', () => {
    expect(deriveCalcButtonState({}, '.uno:Bold')).toEqual({ enabled: true, pressed: false })
  })

  test('a toggle command reflects state:true as pressed', () => {
    const states: UnoStateMap = { '.uno:Bold': { isEnabled: true, state: true } }
    expect(deriveCalcButtonState(states, '.uno:Bold')).toEqual({ enabled: true, pressed: true })
  })

  test('Calc alignment commands use Calc-specific uno names, not Writer paragraph ones', () => {
    const states: UnoStateMap = {
      '.uno:AlignLeft': { isEnabled: true, state: true },
      '.uno:AlignHorizontalCenter': { isEnabled: true, state: false },
    }
    expect(deriveCalcButtonState(states, '.uno:AlignLeft').pressed).toBe(true)
    expect(deriveCalcButtonState(states, '.uno:AlignHorizontalCenter').pressed).toBe(false)
    // Writer's own alignment command strings must never be treated as toggled
    // by this table -- they are a different command family entirely.
    expect(deriveCalcButtonState({ '.uno:LeftPara': { isEnabled: true, state: true } }, '.uno:LeftPara').pressed).toBe(false)
  })

  test('a disabled command is never pressed even if its state is true', () => {
    const states: UnoStateMap = { '.uno:NumberFormatCurrency': { isEnabled: false, state: true } }
    expect(deriveCalcButtonState(states, '.uno:NumberFormatCurrency')).toEqual({ enabled: false, pressed: true })
  })

  test('an action command (AutoSum) reports no state key and is never "pressed"', () => {
    // Matches the real engine's own reporting shape for action commands,
    // verified against the artifact: onState(".uno:AutoSum") -> {isEnabled:true}
    // with no `state` field at all.
    const states: UnoStateMap = { '.uno:AutoSum': { isEnabled: true, state: undefined } }
    expect(deriveCalcButtonState(states, '.uno:AutoSum').pressed).toBe(false)
  })
})

describe('CALC_HOME_COMMANDS', () => {
  test('every command id is unique (React keys / test selectors depend on this)', () => {
    const ids = CALC_HOME_COMMANDS.map((d) => d.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  test('every command targets a real .uno: command', () => {
    for (const def of CALC_HOME_COMMANDS) {
      expect(def.command.startsWith('.uno:')).toBe(true)
    }
  })

  test('action commands (Undo/Redo/AutoSum/Sort/inc-decimals) are flagged, never toggle-tracked', () => {
    const actionIds = CALC_HOME_COMMANDS.filter((d) => d.action).map((d) => d.id)
    expect(actionIds.sort()).toEqual(['autosum', 'inc-decimals', 'redo', 'sort', 'undo'].sort())
  })
})

describe('CALC_STATE_COMMANDS', () => {
  test('excludes action commands (nothing to subscribe a toggle listener to)', () => {
    expect(CALC_STATE_COMMANDS).not.toContain('.uno:Undo')
    expect(CALC_STATE_COMMANDS).not.toContain('.uno:AutoSum')
  })

  test('includes every real toggle command the Home ribbon renders', () => {
    expect(CALC_STATE_COMMANDS).toEqual(
      expect.arrayContaining(['.uno:Bold', '.uno:Italic', '.uno:Underline', '.uno:AlignLeft', '.uno:AlignHorizontalCenter', '.uno:AlignRight', '.uno:NumberFormatCurrency', '.uno:DataFilterAutoFilter']),
    )
  })
})

describe('CALC_PALETTE_ENTRIES', () => {
  test('offers the extra number formats not shown on the ribbon face', () => {
    expect(CALC_PALETTE_ENTRIES.some((e) => e.command === '.uno:NumberFormatPercent')).toBe(true)
    expect(CALC_PALETTE_ENTRIES.some((e) => e.command === '.uno:NumberFormatStandard')).toBe(true)
  })

  test('every entry id is unique', () => {
    const ids = CALC_PALETTE_ENTRIES.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
