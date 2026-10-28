/**
 * Task 2237b — creating a live folder link.
 *
 * The custody order is the expensive part to get wrong: a second, different
 * folder key locks out every member and every existing link, so these tests
 * pin the order (custody first, then the token) and the exact key the link's
 * `wrapped_folder_key` opens with.
 */
import { beforeEach, describe, expect, test } from 'bun:test'
import { loadWasm } from './helpers/wasm-crypto-mirror'
import { mockModuleScoped } from './helpers/scoped-module-mock'

// `combine_folder_link_key` is core; the worker hop is the only thing skipped.
await mockModuleScoped('../src/lib/crypto', import.meta.dir, () => ({
  combineFolderLinkKey: async (key: Uint8Array, stretch: Uint8Array | null) =>
    loadWasm().combineFolderLinkKey(key, stretch) as Uint8Array,
  deriveKeys: async (password: string, salt: Uint8Array) => ({
    masterKey: loadWasm().derive_master_key(password, salt).key as Uint8Array,
  }),
}))

import type { CreateFolderLinkPorts } from '../src/lib/folder-link-create'

const { createFolderLinkWithKeys, folderLinkActionError, MAX_FOLDER_LINKS } = await import(
  '../src/lib/folder-link-create'
)
const {
  readLinkKeyFragment,
  linkUnwrapKey,
  unwrapFolderKeyFromLink,
  deriveLinkPassphraseKey,
  ownerWrappedLinkKey,
  ownerWrappedLinkToken,
  rebuildFolderLinkUrl,
} = await import('../src/lib/shared-folder-link-crypto')
const { unwrapKeyFromShare } = await import('../src/lib/crypto')
const { fromBase64, toBase64 } = await import('../src/lib/crypto')

const MASTER = new Uint8Array(32).fill(0x11)
const FOLDER_ID = 'folder-1'
const FOLDER_KEY = new Uint8Array(32).fill(0x22)

type Call = { name: string; arg?: unknown }

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    folderId: FOLDER_ID,
    masterKey: MASTER,
    accessLevel: 'view' as const,
    label: null,
    expiresInHours: null,
    capBytes: null,
    passphrase: null,
    maxOpens: null,
    ...overrides,
  }
}

function fakePorts(overrides: Partial<CreateFolderLinkPorts> = {}) {
  const calls: Call[] = []
  let custodyReads = 0
  const linkCrypto = {
    generateLinkKey: () => crypto.getRandomValues(new Uint8Array(32)),
    deriveLinkPassphraseKey,
    linkUnwrapKey,
    wrapFolderKeyForLink: async (folderKey: Uint8Array, linkKey: Uint8Array) => {
      const iv = crypto.getRandomValues(new Uint8Array(12))
      const cryptoKey = await crypto.subtle.importKey('raw', linkKey as BufferSource, { name: 'AES-GCM' }, false, ['encrypt'])
      const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, folderKey as BufferSource))
      return toBase64(new Uint8Array([...iv, ...ct]))
    },
    // The real owner wraps (WebCrypto AES-GCM): L2 is asserted by opening them.
    ownerWrappedLinkKey,
    ownerWrappedLinkToken,
  }

  const ports: CreateFolderLinkPorts = {
    getSharedFolder: async (folderId: string) => {
      calls.push({ name: 'getSharedFolder', arg: folderId })
      custodyReads += 1
      if (custodyReads === 1) {
        return {
          folder_id: folderId,
          role: 'owner',
          access_level: 'edit',
          key_version: 1,
          owner_wrapped_folder_key: null,
          wrapped_folder_key: null,
        }
      }
      return {
        folder_id: folderId,
        role: 'owner',
        access_level: 'edit',
        key_version: 2,
        owner_wrapped_folder_key: toBase64(new Uint8Array(60).fill(9)),
        wrapped_folder_key: null,
      }
    },
    decryptOwnerFolderKey: async () => {
      calls.push({ name: 'decryptOwnerFolderKey' })
      return new Uint8Array(FOLDER_KEY)
    },
    encryptOwnerFolderKey: async () => new Uint8Array(60).fill(3),
    findExistingFolderKey: async () => {
      calls.push({ name: 'findExistingFolderKey' })
      return null
    },
    generateFolderKey: async () => {
      calls.push({ name: 'generateFolderKey' })
      return new Uint8Array(FOLDER_KEY)
    },
    // Only ever asked for the ROOT's own name key (published under the folder
    // key); a different value from the folder key on purpose.
    deriveFileKey: async (masterKey: Uint8Array, fileId: string) => {
      calls.push({ name: 'deriveFileKey', arg: fileId })
      void masterKey
      return new Uint8Array(32).fill(0x44)
    },
    encryptChildFileKey: async (folderKey: Uint8Array, key: Uint8Array) =>
      `enc:${folderKey[0]}:${key[0]}`,
    registerSharedFolderKey: async (folderId, body) => {
      calls.push({ name: 'registerSharedFolderKey', arg: body })
      return { created: true, key_version: body.key_version }
    },
    createFolderLink: async (body) => {
      calls.push({ name: 'createFolderLink', arg: body })
      return {
        id: 'link-1',
        token: body.token ?? '',
        key_version: 1,
        folder_id: folderIdOf(body),
        access_level: (body.access_level ?? 'view') as never,
        label_encrypted: null,
        expires_at: null,
        max_opens: null,
        open_count: 0,
        download_count: 0,
        paused: false,
        cap_bytes: null,
        cap_used_bytes: 0,
        passphrase_protected: !!body.passphrase,
        created_at: '2026-10-28T00:00:00Z',
        revoked_at: null,
        wrapped_folder_key: body.wrapped_folder_key,
        owner_wrapped_key: null,
        owner_wrapped_token: null,
      } as never
    },
    encryptAllChildrenKeys: async (_masterKey: Uint8Array, folderKey: Uint8Array, folderId: string) => {
      // A copy: the caller zeroizes its key afterwards (comparing the live
      // array would compare zeros with zeros).
      calls.push({ name: 'encryptAllChildrenKeys', arg: { folderId, folderKey: new Uint8Array(folderKey) } })
      return [{ file_id: 'file-1', encrypted_file_key: 'enc-child-1' }]
    },
    generateShareToken: async () => 'tok_2237b',
    ...linkCrypto,
    encryptLabel: async (_key: Uint8Array, label: string) => `enc:${label}`,
    fromBase64,
    toBase64,
    origin: () => 'https://app.example',
    ...overrides,
  }
  return { ports, calls }
}

function folderIdOf(body: { folder_id?: string }): string {
  return body.folder_id ?? FOLDER_ID
}

function names(calls: Call[]): string[] {
  return calls.map((c) => c.name)
}

beforeEach(() => {
  /* nothing global to reset: every test builds its own ports */
})

describe('folder-link-create — custody order (2237b)', () => {
  test('a folder with no custody registers key_version 1 once, then creates the link', async () => {
    const { ports, calls } = fakePorts()
    await createFolderLinkWithKeys(baseInput(), ports)

    expect(names(calls)).toEqual([
      'getSharedFolder',
      'findExistingFolderKey',
      'generateFolderKey',
      'registerSharedFolderKey',
      'encryptAllChildrenKeys',
      'deriveFileKey',
      'createFolderLink',
    ])
    const register = calls.find((c) => c.name === 'registerSharedFolderKey')?.arg as {
      key_version: number
      owner_wrapped_folder_key: string
    }
    expect(register.key_version).toBe(1)
    expect(register.owner_wrapped_folder_key.length).toBeGreaterThan(0)
  })

  test('an existing custody record is opened, never re-registered', async () => {
    const { ports, calls } = fakePorts({
      getSharedFolder: async () => ({
        folder_id: FOLDER_ID,
        role: 'owner',
        access_level: 'edit',
        key_version: 3,
        owner_wrapped_folder_key: toBase64(new Uint8Array(60).fill(5)),
        wrapped_folder_key: null,
      }),
    })
    await createFolderLinkWithKeys(baseInput(), ports)

    expect(names(calls)).not.toContain('registerSharedFolderKey')
    expect(names(calls)).not.toContain('generateFolderKey')
    expect(names(calls)).toContain('decryptOwnerFolderKey')
  })

  test('409 key_version_conflict re-reads and uses the key that won the race', async () => {
    const { ports, calls } = fakePorts({
      registerSharedFolderKey: async () => {
        calls.push({ name: 'registerSharedFolderKey' })
        throw Object.assign(new Error('key_version_conflict'), { code: 'key_version_conflict' })
      },
    })
    await createFolderLinkWithKeys(baseInput(), ports)

    expect(names(calls).filter((n) => n === 'registerSharedFolderKey')).toHaveLength(1)
    expect(names(calls).filter((n) => n === 'getSharedFolder')).toHaveLength(2)
    // The link is created against the re-read key, not the one we minted.
    expect(names(calls)).toContain('createFolderLink')
    expect(names(calls)).toContain('decryptOwnerFolderKey')
  })
})

describe('folder-link-create — the link itself (2237b)', () => {
  test('a plain link ends in #key= with a 43-character base64url secret and sends no passphrase', async () => {
    const { ports, calls } = fakePorts()
    const created = await createFolderLinkWithKeys(baseInput(), ports)

    expect(created.url.startsWith('https://app.example/f/tok_2237b#key=')).toBe(true)
    expect(created.url.split('#key=')[1]).toHaveLength(43)
    expect(created.passphraseProtected).toBe(false)
    const body = calls.find((c) => c.name === 'createFolderLink')?.arg as Record<string, unknown>
    expect('passphrase' in body).toBe(false)
    expect(body.token).toBe('tok_2237b')
    expect(typeof body.owner_wrapped_key).toBe('string')
    expect(typeof body.owner_wrapped_token).toBe('string')
  })

  test('a link publishes the subtree child keys the guest needs', async () => {
    const { ports, calls } = fakePorts()
    await createFolderLinkWithKeys(baseInput(), ports)

    const body = calls.find((c) => c.name === 'createFolderLink')?.arg as {
      folder_keys?: { file_id: string; encrypted_file_key: string }[]
    }
    // The root's own name key comes first (random folder key, L1), then the subtree.
    expect(body.folder_keys).toEqual([
      { file_id: FOLDER_ID, encrypted_file_key: `enc:${FOLDER_KEY[0]}:${0x44}` },
      { file_id: 'file-1', encrypted_file_key: 'enc-child-1' },
    ])
    expect(calls.find((c) => c.name === 'deriveFileKey')?.arg).toBe(FOLDER_ID)
    const encrypt = calls.find((c) => c.name === 'encryptAllChildrenKeys')?.arg as {
      folderId: string
      folderKey: Uint8Array
    }
    expect(encrypt.folderId).toBe(FOLDER_ID)
    expect(Array.from(encrypt.folderKey)).toEqual(Array.from(FOLDER_KEY))
  })

  test('a plain link opens with K_c alone', async () => {
    const { ports, calls } = fakePorts()
    const created = await createFolderLinkWithKeys(baseInput(), ports)
    const body = calls.find((c) => c.name === 'createFolderLink')?.arg as { wrapped_folder_key: string }

    const kc = readLinkKeyFragment(created.url)
    expect(kc).not.toBeNull()
    const opened = await unwrapFolderKeyFromLink(body.wrapped_folder_key, await linkUnwrapKey(kc!, null))
    expect(Array.from(opened)).toEqual(Array.from(FOLDER_KEY))
  })

  test('a passphrase link still carries #key= and opens only with K_c plus the stretch', async () => {
    const { ports, calls } = fakePorts()
    const created = await createFolderLinkWithKeys(baseInput({ passphrase: 'hunter2' }), ports)

    expect(created.url).toContain('#key=')
    expect(created.passphraseProtected).toBe(true)
    const body = calls.find((c) => c.name === 'createFolderLink')?.arg as {
      wrapped_folder_key: string
      passphrase?: string
    }
    expect(body.passphrase).toBe('hunter2')

    const kc = readLinkKeyFragment(created.url)!
    const stretch = await deriveLinkPassphraseKey('hunter2', created.token)
    const opened = await unwrapFolderKeyFromLink(body.wrapped_folder_key, await linkUnwrapKey(kc, stretch))
    expect(Array.from(opened)).toEqual(Array.from(FOLDER_KEY))

    // K_c alone must not open it.
    await expect(unwrapFolderKeyFromLink(body.wrapped_folder_key, kc)).rejects.toThrow()
  })

  test('two different passphrases produce different wrapped_folder_key values', async () => {
    const first = fakePorts()
    const second = fakePorts()
    const a = await createFolderLinkWithKeys(baseInput({ passphrase: 'hunter2' }), first.ports)
    const b = await createFolderLinkWithKeys(baseInput({ passphrase: 'correct horse' }), second.ports)
    const wa = (first.calls.find((c) => c.name === 'createFolderLink')?.arg as { wrapped_folder_key: string })
      .wrapped_folder_key
    const wb = (second.calls.find((c) => c.name === 'createFolderLink')?.arg as { wrapped_folder_key: string })
      .wrapped_folder_key
    expect(a.token).toBe(b.token) // the fake token is fixed; only the wrap differs
    expect(wa).not.toBe(wb)
  })

  test('the link ceiling is 20', () => {
    expect(MAX_FOLDER_LINKS).toBe(20)
  })
})

describe('folderLinkActionError (2237b)', () => {
  test('a 409 too_many_links surfaces the code and the server message', () => {
    const err = Object.assign(new Error('A folder can have at most 20 links.'), {
      status: 409,
      code: 'too_many_links',
    })
    expect(folderLinkActionError(err)).toEqual({
      code: 'too_many_links',
      message: 'A folder can have at most 20 links.',
    })
  })

  test('folder_key_missing is surfaced, never swallowed', () => {
    const err = Object.assign(new Error('folder key missing'), { status: 409, code: 'folder_key_missing' })
    expect(folderLinkActionError(err)?.code).toBe('folder_key_missing')
  })

  test('an error with no folder-link code returns null', () => {
    expect(folderLinkActionError(new Error('boom'))).toBeNull()
  })
})

/**
 * A tiny custody server: one record per folder, insert-once (409 on a second
 * register), and an owner wrap the fake can reverse. Two clients sharing it
 * behave like two devices of the same owner.
 */
function custodyServer() {
  const records = new Map<string, string>()
  return {
    records,
    getSharedFolder: async (folderId: string) => {
      const wrapped = records.get(folderId)
      if (!wrapped) throw Object.assign(new Error('not found'), { status: 404 })
      return { folder_id: folderId, role: 'owner', access_level: 'edit', key_version: 1, owner_wrapped_folder_key: wrapped, wrapped_folder_key: null } as never
    },
    registerSharedFolderKey: async (folderId: string, body: { owner_wrapped_folder_key: string; key_version: number }) => {
      if (records.has(folderId)) throw Object.assign(new Error('key_version_conflict'), { code: 'key_version_conflict' })
      records.set(folderId, body.owner_wrapped_folder_key)
      return { created: true, key_version: body.key_version }
    },
    // "Sealed" = the key bytes behind a marker; decrypt reverses it.
    encryptOwnerFolderKey: async (_m: Uint8Array, _f: string, key: Uint8Array) => new Uint8Array([0xee, ...key]),
    decryptOwnerFolderKey: async (_m: Uint8Array, _f: string, blob: Uint8Array) => blob.slice(1),
  }
}

function folderKeyOf(calls: Call[]): number[] {
  const arg = calls.find((c) => c.name === 'encryptAllChildrenKeys')?.arg as { folderKey: Uint8Array }
  return Array.from(arg.folderKey)
}

describe('L1 — the folder key is random and its one source is the custody record', () => {
  test('a first link mints a RANDOM key; it is not the master-derived folder key', async () => {
    const server = custodyServer()
    const derived = new Uint8Array(32).fill(0x44)
    const { ports, calls } = fakePorts({
      ...server,
      generateFolderKey: async () => crypto.getRandomValues(new Uint8Array(32)),
      deriveFileKey: async () => new Uint8Array(derived),
    })
    await createFolderLinkWithKeys(baseInput(), ports)
    const key = folderKeyOf(calls)
    expect(key).toHaveLength(32)
    expect(key).not.toEqual(Array.from(derived))
    expect(server.records.size).toBe(1)
  })

  test('two clients, and a reload, get the same folder key from the record', async () => {
    const server = custodyServer()
    const minted: number[][] = []
    const client = () => fakePorts({
      ...server,
      generateFolderKey: async () => {
        const key = crypto.getRandomValues(new Uint8Array(32))
        minted.push(Array.from(key))
        return key
      },
    })
    const first = client()
    await createFolderLinkWithKeys(baseInput(), first.ports)
    const second = client() // another device of the same owner
    await createFolderLinkWithKeys(baseInput(), second.ports)
    const reload = client() // the first device after a reload
    await createFolderLinkWithKeys(baseInput(), reload.ports)

    expect(minted).toHaveLength(1)
    expect(folderKeyOf(second.calls)).toEqual(minted[0])
    expect(folderKeyOf(reload.calls)).toEqual(minted[0])
  })

  test('two clients minting at the same moment end on ONE key: the loser re-reads the winner', async () => {
    const server = custodyServer()
    // Both read "no record" before either registers.
    let reads = 0
    const racingRead = async (folderId: string) => {
      reads++
      if (reads <= 2) throw Object.assign(new Error('not found'), { status: 404 })
      return server.getSharedFolder(folderId)
    }
    const a = fakePorts({ ...server, getSharedFolder: racingRead, generateFolderKey: async () => new Uint8Array(32).fill(1) })
    const b = fakePorts({ ...server, getSharedFolder: racingRead, generateFolderKey: async () => new Uint8Array(32).fill(2) })
    await Promise.all([createFolderLinkWithKeys(baseInput(), a.ports), createFolderLinkWithKeys(baseInput(), b.ports)])
    expect(folderKeyOf(a.calls)).toEqual(folderKeyOf(b.calls))
  })
})

describe('L2 — a link keeps the owner\'s copy of K_c and can be copied again later', () => {
  test('owner_wrapped_key opens to K_c, not to the folder key', async () => {
    const { ports, calls } = fakePorts()
    const created = await createFolderLinkWithKeys(baseInput(), ports)
    const body = calls.find((c) => c.name === 'createFolderLink')?.arg as { owner_wrapped_key: string }
    const opened = await unwrapKeyFromShare(MASTER, fromBase64(body.owner_wrapped_key))
    expect(Array.from(opened)).toEqual(Array.from(readLinkKeyFragment(created.url)!))
    expect(Array.from(opened)).not.toEqual(Array.from(FOLDER_KEY))
  })

  test('after the panel is closed the same URL is rebuilt from the stored row', async () => {
    for (const passphrase of [null, 'hunter2']) {
      const { ports, calls } = fakePorts()
      const created = await createFolderLinkWithKeys(baseInput({ passphrase }), ports)
      const body = calls.find((c) => c.name === 'createFolderLink')?.arg as {
        owner_wrapped_key: string
        owner_wrapped_token: string
        wrapped_folder_key: string
      }
      // What GET /shares/folder-links returns for the owner, later, anywhere.
      const row = {
        owner_wrapped_key: body.owner_wrapped_key,
        owner_wrapped_token: body.owner_wrapped_token,
        wrapped_folder_key: body.wrapped_folder_key,
        passphrase_protected: passphrase !== null,
      }
      expect(await rebuildFolderLinkUrl(row, MASTER, 'https://app.example')).toBe(created.url)
      // Another account's master key cannot rebuild it.
      expect(await rebuildFolderLinkUrl(row, new Uint8Array(32).fill(0x99), 'https://app.example')).toBeNull()
    }
  })

  test('a stored key that does not open the link is never handed out', async () => {
    const one = fakePorts()
    const two = fakePorts()
    await createFolderLinkWithKeys(baseInput(), one.ports)
    await createFolderLinkWithKeys(baseInput(), two.ports)
    const a = one.calls.find((c) => c.name === 'createFolderLink')?.arg as Record<string, string>
    const b = two.calls.find((c) => c.name === 'createFolderLink')?.arg as Record<string, string>
    // K_c of link B pasted onto link A: the plain link proves it does not open.
    const mixed = { owner_wrapped_key: b.owner_wrapped_key, owner_wrapped_token: a.owner_wrapped_token, wrapped_folder_key: a.wrapped_folder_key, passphrase_protected: false }
    expect(await rebuildFolderLinkUrl(mixed, MASTER, 'https://app.example')).toBeNull()
    // The pre-L2 shape (the folder key stored as owner_wrapped_key) is refused too.
    const legacy = { owner_wrapped_key: await ownerWrappedLinkKey(MASTER, FOLDER_KEY), owner_wrapped_token: a.owner_wrapped_token, wrapped_folder_key: a.wrapped_folder_key, passphrase_protected: false }
    expect(await rebuildFolderLinkUrl(legacy, MASTER, 'https://app.example')).toBeNull()
  })
})

test('a whitespace-only passphrase is refused, never turned into a plain link', async () => {
  const { ports, calls } = fakePorts()
  await expect(createFolderLinkWithKeys(baseInput({ passphrase: '   ' }), ports)).rejects.toThrow(/empty/)
  expect(names(calls)).not.toContain('createFolderLink')
})
