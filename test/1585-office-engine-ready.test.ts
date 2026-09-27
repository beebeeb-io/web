/**
 * Task 1585 item 4 — the host waits for the engine's real ready signal.
 *
 * `bbOffice` appears the moment bb-office-api.js parses; the engine is only
 * usable once Qt's loader has exposed `Module.uno_main`. Handing the bridge
 * over on `bbOffice` alone put every slow boot at the mercy of the bridge's
 * own internal 60 s wait instead of the host's budget.
 */
import { describe, expect, test } from 'bun:test'
import { engineReadyBridge } from '../src/components/office/office-engine-host'

const bridge = { open: () => Promise.resolve({ ext: 'docx', saveExt: 'docx' }) }

function win(props: Record<string, unknown>): Window {
  return props as unknown as Window
}

describe('engineReadyBridge', () => {
  test('nothing loaded yet → not ready', () => {
    expect(engineReadyBridge(win({}))).toBeNull()
  })

  test('bridge script ran but the engine has not booted → NOT ready', () => {
    expect(engineReadyBridge(win({ bbOffice: bridge }))).toBeNull()
    expect(engineReadyBridge(win({ bbOffice: bridge, Module: {} }))).toBeNull()
  })

  test('engine port without the bridge → not ready', () => {
    expect(engineReadyBridge(win({ Module: { uno_main: {} } }))).toBeNull()
  })

  test('bridge + Module.uno_main → ready, returns the bridge', () => {
    expect(engineReadyBridge(win({ bbOffice: bridge, Module: { uno_main: {} } }))).toBe(bridge as never)
  })

  test('a window that throws on access (navigated cross-origin) → not ready, never throws', () => {
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new DOMException('Blocked a frame', 'SecurityError')
        },
      },
    )
    expect(engineReadyBridge(hostile as Window)).toBeNull()
  })
})
