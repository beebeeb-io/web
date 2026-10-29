/**
 * Final review P3-2: the preload that keeps unit tests off production
 * (test/helpers/no-prod-network.ts, bunfig.toml [test] preload) must be seen
 * to go red. Each case provokes it and takes what it recorded, so the global
 * afterEach stays quiet for this file.
 */
import { describe, expect, test } from 'bun:test'
import { isProductionHost, takeProductionAttemptsForTests } from './helpers/no-prod-network'

describe('no unit test reaches a production host', () => {
  test('fetch to the default API base is refused and recorded', async () => {
    await expect(fetch('https://api.beebeeb.io/api/v1/files/11111111-1111-4111-8111-111111111111')).rejects.toThrow(/production host/)
    expect(takeProductionAttemptsForTests()).toEqual(['https://api.beebeeb.io/api/v1/files/11111111-1111-4111-8111-111111111111'])
  })

  test('the apex and every subdomain, in any case, as a string, a URL or a Request', async () => {
    const urls = ['https://beebeeb.io/', 'https://APP.Beebeeb.io/x', 'https://admin.beebeeb.io/', 'https://a.b.beebeeb.io./']
    for (const url of urls) await expect(fetch(url)).rejects.toThrow(/production host/)
    await expect(fetch(new URL('https://api.beebeeb.io/u'))).rejects.toThrow(/production host/)
    await expect(fetch(new Request('https://api.beebeeb.io/r'))).rejects.toThrow(/production host/)
    expect(takeProductionAttemptsForTests()).toHaveLength(urls.length + 2)
  })

  test('other hosts go through: a look-alike is not production, and a data URL fetches', async () => {
    expect(isProductionHost('beebeeb.io.example.com')).toBe(false)
    expect(isProductionHost('notbeebeeb.io')).toBe(false)
    expect(await (await fetch('data:,ok')).text()).toBe('ok')
    expect(takeProductionAttemptsForTests()).toEqual([])
  })
})
