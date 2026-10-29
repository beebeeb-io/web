import { test, expect } from '@playwright/test'
import fs from 'fs'
import { writeText, uploadAndWait, openPreview, previewOverlay } from './helpers/thumb-fixtures'

/**
 * Preview right rail must state the REAL cipher (flow "Web core journeys", P1).
 *
 * The CRYPTO block used to be hard-coded design mock copy — "XChaCha20-Poly1305",
 * a fixed "IV: 8f2e...91a3" and "MAC verified ✓" — identical for every file,
 * while every chunk is actually sealed with AES-256-GCM (core encrypt_chunk,
 * cipher_suite V1Aes256Gcm). A fabricated verification claim in a
 * zero-knowledge product is a lie; the rail must name AES-256-GCM, carry no fake
 * IV, and only claim tag verification after this file really decrypted.
 */
test.describe('Preview crypto rail is truthful', () => {
  let txt: string

  test.beforeAll(() => { txt = writeText(`bb-crypto-rail-${process.pid}.txt`, 'crypto-rail-truth\n') })
  test.afterAll(() => { try { fs.unlinkSync(txt) } catch { /* ignore */ } })

  test('names AES-256-GCM and shows no fabricated IV / cipher', async ({ page }) => {
    await page.goto('/')
    const base = await uploadAndWait(page, txt)
    await openPreview(page, base)

    const overlay = previewOverlay(page)
    // Wait for the real decrypt to finish so the post-decrypt state is asserted.
    await expect(overlay.getByText('Decrypting...')).toBeHidden({ timeout: 15_000 })

    await expect(overlay).toContainText('Crypto')
    await expect(overlay).not.toContainText('XChaCha20')
    await expect(overlay).not.toContainText('IV: 8f2e')
    await expect(overlay).not.toContainText('MAC verified')

    const crypto = overlay.getByTestId('preview-crypto')
    await expect(crypto).toContainText('AES-256-GCM')
    // A text file takes the full-download path: every chunk's GCM tag was
    // checked on decrypt, so the rail may (and should) say so.
    await expect(crypto).toContainText('GCM tags verified on decrypt')

    fs.mkdirSync('test-results/preview-crypto-rail', { recursive: true })
    await page.screenshot({ path: 'test-results/preview-crypto-rail/rail.png' })
  })
})
