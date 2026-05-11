import { test } from '@playwright/test'

test('trace login loop', async ({ page }) => {
  const t0 = Date.now()
  const logs: string[] = []

  // Intercept history API BEFORE the app loads to capture call stacks
  await page.addInitScript(() => {
    const origReplace = history.replaceState.bind(history)
    const origPush = history.pushState.bind(history)
    history.replaceState = function(state, title, url) {
      if (typeof url === 'string' && (url.includes('/login') || url === '/')) {
        console.log('[HISTORY_REPLACE] to=' + url + ' stack=' + new Error().stack?.split('\n').slice(1, 6).join(' | '))
      }
      return origReplace(state, title, url)
    }
    history.pushState = function(state, title, url) {
      if (typeof url === 'string' && (url.includes('/login') || url === '/')) {
        console.log('[HISTORY_PUSH] to=' + url + ' stack=' + new Error().stack?.split('\n').slice(1, 6).join(' | '))
      }
      return origPush(state, title, url)
    }
  })

  page.on('framenavigated', frame => {
    if (frame === page.mainFrame()) {
      logs.push(`+${Date.now()-t0}ms URL → ${new URL(frame.url()).pathname}`)
    }
  })

  page.on('console', msg => {
    const text = msg.text()
    const t = Date.now() - t0
    // Capture all instrumentation logs
    if (
      text.includes('[HISTORY_') ||
      text.includes('[PR]') ||
      text.includes('[KEY]') ||
      text.includes('[STW]') ||
      text.includes('[SESS_EXPIRED]') ||
      text.includes('[WG]') ||
      text.includes('[DEBUG]') ||
      text.includes('[ApiErrorWiring]')
    ) {
      logs.push(`+${t}ms ${text.slice(0, 400)}`)
    }
  })

  await page.goto('http://localhost:5173/')
  await page.waitForTimeout(3000)

  console.log('\n=== LOOP TRACE ===')
  logs.slice(0, 60).forEach(l => console.log(l))
  console.log('=== END ===\n')
})
