/**
 * Adversarial scrubber vectors — the single source of truth for what may
 * never leave a device. `repos/mobile/src/lib/telemetry/scrub.test.ts`
 * imports an identical copy; the two must stay byte-identical.
 */
export interface ScrubVector {
  name: string
  input: string
  mustNotContain: string[]
  mustContain: string[]
}

export const SCRUB_VECTORS: ScrubVector[] = [
  {
    name: 'file name in a message',
    input: 'Failed to decrypt "Holiday photos 2026 Corfu.jpeg"',
    mustNotContain: ['Holiday', 'Corfu'],
    mustContain: ['<name>.jpeg'],
  },
  {
    name: 'file id (UUID)',
    input: 'chunk 0 of 57aaf293-2f0a-4c1e-9a11-8a4f2c9d0e11 failed',
    mustNotContain: ['57aaf293'],
    mustContain: ['<id>'],
  },
  {
    name: 'share link with key in the fragment',
    input: 'GET https://app.beebeeb.io/s/abc123#k=Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5 failed',
    mustNotContain: ['Zm9vYmFyYmF6', '#k='],
    mustContain: ['https://app.beebeeb.io/s/'],
  },
  {
    name: 'query string',
    input: 'fetch /api/v1/files?parent=abc&passphrase=hunter2 returned 500',
    mustNotContain: ['hunter2', 'passphrase'],
    mustContain: ['/api/v1/files'],
  },
  {
    name: 'session token',
    input: 'auth failed for bb_sess_9xKq2mZr8vTn4pLd0eWc',
    mustNotContain: ['9xKq2mZr8vTn4pLd0eWc'],
    mustContain: ['<session>'],
  },
  {
    name: 'hex key material',
    input: 'key mismatch a3f5c9d1e7b28046a3f5c9d1e7b28046a3f5c9d1e7b28046',
    mustNotContain: ['a3f5c9d1e7b28046a3f5c9d1e7b28046'],
    mustContain: ['<hex>'],
  },
  {
    name: 'email address',
    input: 'no account for qa0688content@beebeeb.io',
    mustNotContain: ['qa0688content'],
    mustContain: ['<email>'],
  },
  {
    name: 'long quoted user string',
    input: 'rename to "a really long folder name the user typed themselves here ok"',
    mustNotContain: ['really long folder name'],
    mustContain: ['<str:'],
  },
  {
    name: 'harmless technical message survives',
    input: 'CryptoError.Decryption at chunk 0',
    mustNotContain: [],
    mustContain: ['CryptoError.Decryption', 'chunk 0'],
  },
]
