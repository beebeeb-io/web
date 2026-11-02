// The op → tree reducer. Kept free of client state so every caller (live
// stream, catch-up, optimistic submit, snapshot re-apply) shares one schema.

import type { SyncNode } from '../api'
import { payloadToNode } from './protocol'

/**
 * Mutate the in-memory tree based on op type + payload.
 *
 * `knownAbsent` tracks ids a completed snapshot confirmed absent; a create of
 * that id makes a later missing-node op resync again.
 */
export function applyOpToTree(
  tree: Map<string, SyncNode>,
  knownAbsent: Set<string>,
  opType: string,
  payload: Record<string, unknown>,
): 'applied' | 'missing-node' {
  switch (opType) {
    case 'file_create':
    case 'folder_create': {
      const node = payloadToNode(payload, opType === 'folder_create')
      if (node) {
        tree.set(node.id, node)
        // The id exists now — a later missing-node op must resync again.
        knownAbsent.delete(node.id)
      }
      return 'applied'
    }
    case 'file_update': {
      const id = payload.id as string | undefined
      if (!id) return 'applied'
      const existing = tree.get(id)
      if (!existing) return 'missing-node'
      tree.set(id, {
        ...existing,
        size_bytes: (payload.size_bytes as number | undefined) ?? existing.size_bytes,
        version_number:
          (payload.version_number as number | undefined) ?? existing.version_number,
        content_hash:
          (payload.content_hash as string | undefined) ?? existing.content_hash,
        has_thumbnail:
          (payload.has_thumbnail as boolean | undefined) ?? existing.has_thumbnail,
        has_large_thumbnail:
          (payload.has_large_thumbnail as boolean | undefined) ?? existing.has_large_thumbnail,
        // A new version can land in another pool (task 1919: the person
        // picked another country); the drive shows that pool's country.
        storage_pool_id:
          'storage_pool_id' in payload
            ? ((payload.storage_pool_id as string | null | undefined) ?? null)
            : existing.storage_pool_id,
        updated_at: new Date().toISOString(),
      })
      return 'applied'
    }
    case 'file_move':
    case 'folder_move': {
      const id = payload.id as string | undefined
      if (!id) return 'applied'
      const existing = tree.get(id)
      if (!existing) return 'missing-node'
      tree.set(id, {
        ...existing,
        parent_id: (payload.new_parent_id as string | null | undefined) ?? null,
        updated_at: new Date().toISOString(),
      })
      return 'applied'
    }
    case 'file_rename':
    case 'folder_rename': {
      const id = payload.id as string | undefined
      if (!id) return 'applied'
      const existing = tree.get(id)
      if (!existing) return 'missing-node'
      tree.set(id, {
        ...existing,
        name_encrypted:
          (payload.new_name_encrypted as string | undefined) ?? existing.name_encrypted,
        updated_at: new Date().toISOString(),
      })
      return 'applied'
    }
    case 'file_trash': {
      const id = payload.id as string | undefined
      if (!id) return 'applied'
      const existing = tree.get(id)
      if (!existing) return 'missing-node'
      tree.set(id, { ...existing, is_trashed: true })
      return 'applied'
    }
    case 'file_restore': {
      const id = payload.id as string | undefined
      if (!id) return 'applied'
      const existing = tree.get(id)
      if (!existing) return 'missing-node'
      tree.set(id, { ...existing, is_trashed: false })
      return 'applied'
    }
    case 'file_delete': {
      const id = payload.id as string | undefined
      if (id) tree.delete(id)
      return 'applied'
    }
    case 'share_create':
    case 'share_revoke':
      // Notification-only — UI listens for these to refresh share state.
      return 'applied'
    default:
      // Unknown op type — keep going. Future protocol versions may add
      // new types and we don't want to crash on them.
      return 'applied'
  }
}
