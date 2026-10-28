import { beforeEach, describe, expect, test } from 'bun:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { mockModuleScoped } from './helpers/scoped-module-mock'
import { ApiError } from '../src/lib/api'

type Verify = {
  wrapped_folder_key: string
  key_version: number
  access_level: 'view'
  cap_bytes: null
  cap_used_bytes: number
  expires_at: null
  root_name_encrypted: string
  proof: string
  proof_expires_at: string
}

let resolveImpl: () => Promise<unknown> = async () => ({ kind: 'passphrase_required' })
let verifyImpl: () => Promise<Verify> = async () => validVerify()

function validVerify(): Verify {
  return {
    wrapped_folder_key: 'wrap',
    key_version: 1,
    access_level: 'view',
    cap_bytes: null,
    cap_used_bytes: 0,
    expires_at: null,
    root_name_encrypted: 'root',
    proof: 'p',
    proof_expires_at: new Date(Date.now() + 60_000).toISOString(),
  }
}

const publicReal = (await mockModuleScoped('../src/lib/folder-link-public', import.meta.dir, {
  resolveFolderLink: () => resolveImpl(),
  verifyFolderLinkPassphrase: () => verifyImpl(),
  storeProof: () => ({ token: 't', proof: 'p', expiresAt: Date.now() + 60_000 }),
  readProof: () => null,
  clearProof: () => undefined,
})) as unknown as { FolderNotAvailableError: new (message?: string) => Error }

await mockModuleScoped('../src/lib/shared-folder-link-crypto', import.meta.dir, {
  resolveGuestFolderKey: async () => ({
    kind: 'unlocked' as const,
    value: { folderKey: new Uint8Array(32), keyVersion: 1, level: 'view' as const },
  }),
  deriveLinkPassphraseKey: async () => new Uint8Array(32),
})

const { FolderLinkView, WRONG_PASSPHRASE, openWithPassphrase, resolveGuestState } = await import(
  '../src/pages/folder-link'
)

const noop = () => undefined

/** React escapes apostrophes in static markup; compare against plain text. */
const plain = (html: string) => html.replace(/&#x27;/g, "'")

function render(
  state: Parameters<typeof FolderLinkView>[0]['state'],
  overrides: Partial<Parameters<typeof FolderLinkView>[0]> = {},
) {
  return renderToStaticMarkup(
    React.createElement(FolderLinkView, {
      state,
      token: 'tok',
      passphrase: '',
      passphraseError: null,
      busy: false,
      onPassphraseChange: noop,
      onSubmit: noop,
      ...overrides,
    }),
  )
}

beforeEach(() => {
  resolveImpl = async () => ({ kind: 'passphrase_required' })
  verifyImpl = async () => validVerify()
})

describe('folder link page states (2237b)', () => {
  test('loading announces itself', () => {
    const html = render({ name: 'loading' })
    expect(html).toContain('role="status"')
    expect(html).toContain('Opening folder…')
  })

  test('a passphrase link shows the protected heading and makes no listing request', async () => {
    const state = await resolveGuestState({ token: 'tok', proof: null })
    expect(state).toEqual({ name: 'passphrase_required' })
    const html = render(state)
    expect(html).toContain('This folder is protected')
    expect(html).toContain('Passphrase')
    expect(html).toContain('Open folder')
  })

  test('a wrong passphrase keeps the typed value and says so', async () => {
    verifyImpl = async () => {
      throw new ApiError('Incorrect passphrase', 403, 'incorrect_passphrase')
    }
    const { state, error } = await openWithPassphrase({ token: 'tok', passphrase: 'secret' })
    expect(state.name).toBe('passphrase_required')
    expect(error).toBe(WRONG_PASSPHRASE)
    const html = render(state, { passphrase: 'secret', passphraseError: error })
    expect(plain(html)).toContain(WRONG_PASSPHRASE)
    expect(html).toContain('value="secret"')
  })

  test('a 404 resolves to not_available and renders both sentences', async () => {
    resolveImpl = async () => {
      throw new publicReal.FolderNotAvailableError()
    }
    const state = await resolveGuestState({ token: 'tok', proof: null })
    expect(state.name).toBe('not_available')
    const html = render(state)
    expect(plain(html)).toContain("This link isn't available.")
    expect(html).toContain(
      'It may have been turned off, expired, or the folder was removed. Ask the owner for a new link.',
    )
  })

  test('an old server without a proof asks for an update', async () => {
    verifyImpl = async () => {
      const body = validVerify() as Partial<Verify>
      delete body.proof
      return body as Verify
    }
    const { state } = await openWithPassphrase({ token: 'tok', passphrase: 'secret' })
    expect(state.name).toBe('update_required')
    const html = render(state)
    expect(html).toContain('Update Beebeeb')
    expect(html).toContain('This link needs a newer version of Beebeeb.')
  })

  test('level view has no upload affordance and no name prompt', () => {
    const html = render({
      name: 'listed',
      root: { root_name_encrypted: 'r' } as never,
      folderKey: new Uint8Array(32),
      level: 'view',
      proof: null,
    })
    expect(html).not.toContain('>Upload<')
    expect(html).not.toContain('Your name')
  })

  test('level add shows upload; the name prompt waits for the first upload', () => {
    const html = render({
      name: 'listed',
      root: { root_name_encrypted: 'r' } as never,
      folderKey: new Uint8Array(32),
      level: 'add',
      proof: null,
    })
    expect(html).toContain('>Upload<')
    expect(html).toContain('Drop files or a folder to add them here.')
    // The actor-name prompt is raised on the first upload, not at load.
    expect(html).not.toContain('What should we call you?')
  })
})

// Review thread PRRT_kwDOSLX6Nc6xA1pW (fixed in 8f566cd, pinned here): a
// guest upload or drop lands in the folder being browsed, not at the root.
// GuestBrowser reports its location (onLocationChange); the page hands it to
// the upload panel.
describe('guest uploads land in the folder being browsed', () => {
  test("the page passes the browser's location to the upload panel, never the root", async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const text = readFileSync(join(import.meta.dir, '..', 'src/pages/folder-link.tsx'), 'utf8')
    expect(text).toContain('onLocationChange={setLocation}')
    const start = text.indexOf('<GuestUploadPanel')
    const panel = text.slice(start, text.indexOf('/>', start))
    expect(start).toBeGreaterThan(0)
    expect(panel).toContain('parentId={location}')
    expect(panel).not.toContain('parentId={null}')
  })
})
