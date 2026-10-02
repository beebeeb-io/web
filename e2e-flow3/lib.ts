import { type Page, type Download, expect } from '@playwright/test'
import * as fs from 'fs'
import * as crypto from 'crypto'
export const F = '/private/tmp/claude-501/-Users-guuslangelaar-Development-Beebeeb-beebeeb-io/cc7eef98-55fc-4493-9ff2-638c99aac79f/scratchpad/flow-3'
export const FX = F + '/fixtures'
export const API = 'http://localhost:3333'
export const sha = (p: string) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')
export const shaStream = (p: string) => new Promise<string>((res, rej) => { const h = crypto.createHash('sha256'); fs.createReadStream(p).on('data', d => h.update(d)).on('end', () => res(h.digest('hex'))).on('error', rej) })
type R = { step: string; result: 'pass' | 'fail' | 'blocked'; evidence: string; ms: number }
export class Recorder {
  results: R[] = []
  constructor(public file: string, public page: () => Page) {}
  async step(name: string, fn: () => Promise<string | void>, opts: { blockedIf?: boolean; blockedWhy?: string } = {}) {
    const t0 = Date.now()
    if (opts.blockedIf) { this.push({ step: name, result: 'blocked', evidence: opts.blockedWhy ?? 'prerequisite failed', ms: 0 }); return false }
    try {
      const ev = await fn()
      this.push({ step: name, result: 'pass', evidence: ev || 'ok', ms: Date.now() - t0 })
      return true
    } catch (e: any) {
      const slug = name.replace(/[^a-z0-9]+/gi, '-').slice(0, 60)
      const shot = `${F}/shots/FAIL-${slug}.png`
      try { await this.page().screenshot({ path: shot, fullPage: true }) } catch {}
      let body = ''
      try { body = (await this.page().locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 600) } catch {}
      this.push({ step: name, result: 'fail', evidence: `${String(e?.message ?? e).split('\n').slice(0, 4).join(' | ')} || url=${this.page().url()} || shot=${shot} || body=${body}`, ms: Date.now() - t0 })
      return false
    }
  }
  push(r: R) { this.results.push(r); fs.writeFileSync(this.file, JSON.stringify(this.results, null, 1)); console.log(`[STEP] ${r.result.toUpperCase()} ${r.step} (${r.ms}ms) :: ${r.evidence.slice(0, 300)}`) }
}
export async function dismissOverlays(page: Page) {
  for (const re of [/^Essential only$/, /^(Skip for now|Skip tour|Close)$/]) {
    const b = page.getByRole('button', { name: re }).first()
    if (await b.isVisible({ timeout: 500 }).catch(() => false)) await b.click().catch(() => {})
  }
}
export async function saveDownload(d: Download, name: string) { const p = `${F}/downloads/${Date.now()}-${name}`; await d.saveAs(p); return p }
export function rowOf(page: Page, name: string) {
  return page.getByRole('row').filter({ hasText: name }).first()
}
export async function openMenu(page: Page, name: string) {
  await dismissOverlays(page)
  const row = page.locator('[role=row]').filter({ hasText: name }).first()
  for (let i = 0; i < 4; i++) {
    try { await row.hover({ timeout: 6000 }); await row.getByRole('button', { name: 'File actions' }).click({ timeout: 6000 }); return } catch (e) { if (i === 3) throw e; await page.waitForTimeout(1000); await dismissOverlays(page) }
  }
}
export async function menuItem(page: Page, re: RegExp) { await page.getByRole('menuitem', { name: re }).first().click() }
export function lastEmailCode(logPath: string, email: string): string | null {
  const txt = fs.readFileSync(logPath, 'utf8')
  const idx = txt.lastIndexOf('To: ' + email)
  if (idx < 0) return null
  const tail = txt.slice(idx, idx + 6000)
  const m = tail.match(/code[^0-9]{0,80}?(\d{6,8})\b/i)
  return m ? m[1] : null
}
