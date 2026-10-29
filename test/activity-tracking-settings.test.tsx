// Controlled hooks execute the production handlers. Browser focus/layout is a release check.
import { describe, expect, test } from 'bun:test'
import { createElement, Fragment } from 'react'
import { readFileSync } from 'node:fs'
import ts from 'typescript-api'

const source = readFileSync(new URL('../src/components/settings/activity-tracking.tsx', import.meta.url), 'utf8')
const ast = ts.createSourceFile('tracking.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const declaration = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'ActivityTrackingSettings')!
const compiled = ts.transpileModule(declaration.getText(ast).replace(/^export /, ''), {
  compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 },
}).outputText

function mount(initial: boolean, fail = false, loadFailures = 0) {
  const states: unknown[] = [], writes: boolean[] = [], toasts: unknown[] = []
  let cursor = 0, tree: any, effectDeps: unknown[] | undefined
  const bindings = {
    React: { createElement, Fragment },
    useState(value: unknown) {
      const i = cursor++
      if (!(i in states)) states[i] = value
      return [states[i], (next: unknown) => { states[i] = typeof next === 'function' ? next(states[i]) : next }]
    },
    useEffect(fn: () => void, deps: unknown[]) {
      if (!effectDeps || deps.some((value, i) => value !== effectDeps![i])) { effectDeps = [...deps]; fn() }
    },
    useCallback: (fn: unknown) => fn,
    useToast: () => ({ showToast: (toast: unknown) => toasts.push(toast) }),
    getTrackingPreference: async () => { if (loadFailures-- > 0) throw Error('offline'); return { tracking_opted_in: initial } },
    setTrackingPreference: async (on: boolean) => { writes.push(on); if (fail) throw Error('offline') },
    BBButton: 'button', BBToggle: 'toggle', Icon: 'icon', SettingsRow: 'row',
  }
  const Component = new Function(...Object.keys(bindings), `${compiled}; return ActivityTrackingSettings`)(...Object.values(bindings))
  function render() { cursor = 0; tree = Component() }
  function elements(node: any): any[] {
    if (Array.isArray(node)) return node.flatMap(elements)
    return node?.props ? [node, ...elements(node.props.children)] : []
  }
  const find = (type: string, label?: string) => elements(tree).find(n => n.type === type && (!label || n.props.children === label))
  async function flush() { render(); for (let i = 0; i < 8; i++) await Promise.resolve(); render() }
  render()
  return { writes, toasts, find, flush, render }
}

describe('activity tracking keeps the existing consent boundary', () => {
  test('turning off requires confirmation; cancel writes nothing', async () => {
    const m = mount(true); await m.flush()
    m.find('toggle').props.onChange(false); m.render()
    expect(m.writes).toEqual([])
    expect(m.find('toggle').props.on).toBe(true)
    m.find('button', 'Cancel').props.onClick(); m.render()
    expect(m.writes).toEqual([])
    expect(m.find('button', 'Disable and delete data')).toBeUndefined()
  })
  test('confirmation sends one false preference update', async () => {
    const m = mount(true); await m.flush()
    m.find('toggle').props.onChange(false); m.render()
    m.find('button', 'Disable and delete data').props.onClick(); await m.flush()
    expect(m.writes).toEqual([false])
    expect(m.find('toggle').props.on).toBe(false)
    expect(m.find('toggle').props.disabled).toBe(false)
  })
  test('a failed save restores the previous consent and reports the error', async () => {
    for (const initial of [false, true]) {
      const m = mount(initial, true); await m.flush()
      m.find('toggle').props.onChange(!initial); m.render()
      if (initial) m.find('button', 'Disable and delete data').props.onClick()
      await m.flush()
      expect(m.writes).toEqual([!initial])
      expect(m.find('toggle').props.on).toBe(initial)
      expect(m.toasts).toHaveLength(1)
    }
  })
  test('a failed load offers retry without claiming tracking is disabled', async () => {
    const m = mount(true, false, 1); await m.flush()
    expect(m.find('toggle')).toBeUndefined()
    expect(m.writes).toEqual([])
    m.find('button', 'Try again').props.onClick(); await m.flush()
    expect(m.find('toggle').props.on).toBe(true)
    expect(m.writes).toEqual([])
  })

})
