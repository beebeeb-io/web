import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * Task 1545, finding 3 — the free-tier share nudge claimed a passphrase
 * and custom expiry "won't work" on Free ("the recipient will get the file
 * without a passphrase, with the default 7-day expiry"). The server
 * (repos/server shares.rs create_share/create_bundle_share) applies both
 * unconditionally for every plan — only a flat 50-share count cap is
 * plan-gated. The claim was simply false, so it is removed rather than left
 * lying to a user about a security setting they just configured (see the
 * task's Notes section for the queued product question: should this become
 * a real, server-enforced Basic-tier gate instead?).
 */

function read(relPath: string): string {
  return readFileSync(fileURLToPath(new URL(`../${relPath}`, import.meta.url)), 'utf-8')
}

describe('share-dialog.tsx no longer claims passphrase/expiry "won\'t work" on Free (1545#3)', () => {
  test('the false claim string is gone', () => {
    const src = read('src/components/share-dialog.tsx')
    expect(src).not.toContain('will get the file without a passphrase')
    expect(src).not.toContain('Passphrases and custom expiry are part of Basic.')
  })
})
