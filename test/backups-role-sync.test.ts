import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

import { applyOpToTree } from '../src/lib/sync/tree-ops'
import type { SyncNode } from '../src/lib/api'

const node = (over: Partial<SyncNode> = {}): SyncNode => ({
  id: 'root-1', name_encrypted: 'x', parent_id: null, is_folder: true, size_bytes: 0, mime_type: null,
  content_hash: null, version_number: 1, has_thumbnail: false, has_large_thumbnail: false,
  storage_pool_id: null, is_trashed: false, is_starred: false, created_at: '', updated_at: '', ...over,
})

describe('the Backups root flag in the sync tree (LD-0113)', () => {
  it('folder_system_role sets and clears the flag, keeping the rest of the node', () => {
    const tree = new Map([['root-1', node({ name_encrypted: 'sealed' })]])
    expect(applyOpToTree(tree, new Set(), 'folder_system_role', { id: 'root-1', system_role: 'backups_root' })).toBe('applied')
    expect(tree.get('root-1')?.system_role).toBe('backups_root')
    expect(tree.get('root-1')?.name_encrypted).toBe('sealed')
    applyOpToTree(tree, new Set(), 'folder_system_role', { id: 'root-1', system_role: null })
    expect(tree.get('root-1')?.system_role).toBeNull()
  })
  it('a rename keeps the flag', () => {
    const tree = new Map([['root-1', node({ system_role: 'backups_root' })]])
    applyOpToTree(tree, new Set(), 'folder_rename', { id: 'root-1', new_name_encrypted: 'y' })
    expect(tree.get('root-1')?.system_role).toBe('backups_root')
  })
  it('an op for an unknown folder asks for a resync', () => {
    expect(applyOpToTree(new Map(), new Set(), 'folder_system_role', { id: 'nope', system_role: 'backups_root' })).toBe('missing-node')
  })
  it('the drive keeps the flag when it derives rows from the sync tree', () => {
    // syncNodeToDriveFile lives inside a hook; this pins that it copies the field.
    const src = readFileSync(new URL('../src/pages/drive/use-drive-files.ts', import.meta.url), 'utf8')
    const mapper = src.slice(src.indexOf('const syncNodeToDriveFile'), src.indexOf('}, [])', src.indexOf('const syncNodeToDriveFile')))
    expect(mapper).toContain('system_role: n.system_role')
  })
})
