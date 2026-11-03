/**
 * 2326 review P3-2: the file list asks CORE about a request row's name, even
 * when `name_encrypted` is not an envelope.
 *
 * A request-row name is only ever core's to open (§15 / L13): a plaintext one
 * authenticates nothing, so core refuses it ("a request row's name must be an
 * encrypted envelope"). The list used to take the legacy plaintext shortcut
 * first, which displayed that raw string as the file name and never reached
 * core at all. Rendered for real with react-dom/client over the DOM stub of
 * test/ld-0001-b-r3-hook.test.tsx.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import React from 'react'
import { preserveGlobals } from './helpers/scoped-global'
import { mockModuleScoped } from './helpers/scoped-module-mock'
import type { DriveFile } from '../src/lib/api'
import { useDecryptedNames, displayNameFrom } from '../src/components/file-list/use-decrypted-names'

preserveGlobals('window', 'document', 'navigator')

/** What core answers for a request row whose name is not an envelope. */
const CORE_REFUSAL = "invalid input: request row name check: a request row's name must be an encrypted envelope"

const asked: string[] = []

await mockModuleScoped('../src/lib/key-context', import.meta.dir, (real) => ({
  ...real,
  useKeys: (() => ({
    isUnlocked: true,
    // Neither of these may be reached for a request row in this test.
    getFileKeyForFile: async (file: DriveFile) => {
      asked.push(`key:${file.id}`)
      throw new Error('a request row has no key to hand out')
    },
    getRequestRow: async (file: DriveFile): Promise<{ name: string | null }> => {
      asked.push(`row:${file.id}`)
      throw new Error(CORE_REFUSAL)
    },
  })) as never,
}))

// ── A minimal DOM: enough for createRoot + a component that renders null ──────

function makeNode(tag: string): Record<string, unknown> {
  const children: Array<Record<string, unknown>> = []
  const el: Record<string, unknown> = {
    nodeType: tag === '#text' ? 3 : tag === '#comment' ? 8 : 1,
    tagName: tag.startsWith('#') ? undefined : tag.toUpperCase(),
    appendChild(c: Record<string, unknown>) { children.push(c); return c },
    removeChild(c: Record<string, unknown>) { const i = children.indexOf(c); if (i >= 0) children.splice(i, 1); return c },
    insertBefore(c: Record<string, unknown>) { children.push(c); return c },
    setAttribute() {}, getAttribute() { return null }, removeAttribute() {},
    addEventListener() {}, removeEventListener() {},
    style: {}, dataset: {},
    get firstChild() { return children[0] ?? null },
    contains() { return false },
    textContent: '',
  }
  el.childNodes = children
  return el
}

function installDom(): Record<string, unknown> {
  const doc: Record<string, unknown> = {
    createElement: (t: string) => makeNode(t),
    createElementNS: (_ns: string, t: string) => makeNode(t),
    createTextNode: () => makeNode('#text'),
    createComment: () => makeNode('#comment'),
    addEventListener() {}, removeEventListener() {},
  }
  const win: Record<string, unknown> = {
    event: undefined,
    addEventListener() {}, removeEventListener() {},
    document: doc,
    HTMLIFrameElement: function HTMLIFrameElement() {},
    navigator: { onLine: true, userAgent: 'bun-test' },
  }
  doc.defaultView = win
  const container = makeNode('div')
  container.ownerDocument = doc
  doc.activeElement = container
  const body = makeNode('body')
  body.ownerDocument = doc
  doc.body = body
  const g = globalThis as Record<string, unknown>
  g.window = win
  g.document = doc
  g.navigator = { onLine: true, userAgent: 'bun-test' }
  return container
}

/** A request row the server reported with a name that is NOT an envelope. */
function plaintextRequestRow(): DriveFile {
  return {
    id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    name_encrypted: 'plain-note.txt',
    mime_type: 'text/plain',
    file_request_id: '11111111-2222-4333-8444-555555555555',
    sender_ephemeral_pubkey: 'cHVi',
    wrapped_content_key: 'd3JhcHBlZA==',
  } as unknown as DriveFile
}

let unmount: (() => void) | null = null

afterEach(async () => {
  unmount?.()
  unmount = null
  // Let React finish the unmount and its scheduler tasks while this file's DOM
  // globals still exist (react-dom reads `window.event` from a macrotask).
  await tick(4)
})

async function tick(times = 3): Promise<void> {
  for (let i = 0; i < times; i++) await new Promise((r) => setTimeout(r, 5))
}

async function waitFor(cond: () => boolean, label: string, tries = 400): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (cond()) return
    await tick(1)
  }
  throw new Error(`timed out waiting for ${label}`)
}

describe('useDecryptedNames: a plaintext request-row name', () => {
  test('goes to core and shows as unavailable, never verbatim', async () => {
    asked.length = 0
    const file = plaintextRequestRow()
    const container = installDom()
    const client = (await import('react-dom/client')) as unknown as {
      createRoot(node: unknown): { render(node: unknown): void; unmount(): void }
    }
    const out: { names: Record<string, string | null> } = { names: {} }
    function Probe({ files }: { files: DriveFile[] }) {
      out.names = useDecryptedNames(files)
      return null
    }
    const root = client.createRoot(container)
    unmount = () => root.unmount()
    root.render(React.createElement(Probe, { files: [file] }))
    await tick()

    // The row is routed to core, not to the plaintext shortcut.
    await waitFor(
      () => asked.includes(`row:${file.id}`) || out.names[file.id] !== undefined,
      'the row to be routed',
    )
    expect(out.names[file.id]).not.toBe('plain-note.txt')
    expect(asked).toContain(`row:${file.id}`)
    expect(asked).not.toContain(`key:${file.id}`)

    // After the retries give up the row is unavailable (the "Encrypted file"
    // placeholder), never the plaintext string.
    await waitFor(() => out.names[file.id] === null, 'the row to settle on unavailable')
    expect(displayNameFrom(out.names, file)).toBe('Encrypted file')
  }, 15_000)
})
