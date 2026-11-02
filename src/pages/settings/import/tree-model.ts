import type { DbxEntry } from './dropbox-model'


// ── Tree node (Dropbox) ──────────────────────────────────────────────────────

export interface TreeNode {
  tag: 'file' | 'folder'
  name: string
  path: string
  size?: number
  children?: TreeNode[]
  expanded: boolean
  loading: boolean
  hasMore: boolean
  cursor?: string
}

export function newNode(entry: DbxEntry): TreeNode {
  return {
    tag: entry['.tag'],
    name: entry.name,
    path: entry.path_lower,
    size: entry.size,
    expanded: false,
    loading: false,
    hasMore: false,
    children: entry['.tag'] === 'folder' ? undefined : [],
  }
}

export function updateNode(nodes: TreeNode[], path: string, patch: Partial<TreeNode>): TreeNode[] {
  return nodes.map(n => {
    if (n.path === path) return { ...n, ...patch }
    if (n.children) return { ...n, children: updateNode(n.children, path, patch) }
    return n
  })
}

// ── Tree node (Google Drive) ─────────────────────────────────────────────────

export interface GDriveTreeNode {
  tag: 'file' | 'folder' | 'gdoc'
  id: string
  name: string
  mimeType: string
  /** Synthetic path built from ancestor folder names */
  parentPath: string
  size?: number
  children?: GDriveTreeNode[]
  expanded: boolean
  loading: boolean
  hasMore: boolean
  nextPageToken?: string
}

export function updateGDriveNode(
  nodes: GDriveTreeNode[],
  id: string,
  patch: Partial<GDriveTreeNode>,
): GDriveTreeNode[] {
  return nodes.map(n => {
    if (n.id === id) return { ...n, ...patch }
    if (n.children) return { ...n, children: updateGDriveNode(n.children, id, patch) }
    return n
  })
}

export function findGDriveNode(nodes: GDriveTreeNode[], id: string): GDriveTreeNode | null {
  for (const n of nodes) {
    if (n.id === id) return n
    if (n.children) {
      const found = findGDriveNode(n.children, id)
      if (found) return found
    }
  }
  return null
}

// ── Find a node by path in a Dropbox tree ─────────────────────────────────────

export function findNode(nodes: TreeNode[], path: string): TreeNode | null {
  for (const n of nodes) {
    if (n.path === path) return n
    if (n.children) {
      const found = findNode(n.children, path)
      if (found) return found
    }
  }
  return null
}

