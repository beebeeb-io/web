import type {
  AccountActivityEvent,
  ActivityEncryptedNameSnapshot,
  MyActivityEvent,
} from '@beebeeb/shared'

export type { ActivityEncryptedNameSnapshot }

export type ActivityNameEvent = AccountActivityEvent | MyActivityEvent
export type ActivityNameDecryptor = (fileId: string, encryptedName: string) => Promise<string | null>

export const FILE_ACTIVITY_EVENT_TYPES = new Set([
  'file.create',
  'file.upload',
  'file.uploaded',
  'file.downloaded',
  'file.delete',
  'file.trash',
  'file.permanent_delete',
  'file.restore',
  'file.rename',
  'file.conflict_created',
])

function cleanName(name: string | null | undefined): string | null {
  const trimmed = name?.trim()
  if (!trimmed || trimmed === 'Encrypted file') return null
  return trimmed
}

function describeWithName(type: string, name: string): string | null {
  switch (type) {
    case 'file.create':
      return `Created folder ${name}`
    case 'file.upload':
    case 'file.uploaded':
      return `Uploaded ${name}`
    case 'file.downloaded':
      return `Downloaded ${name}`
    case 'file.delete':
      return `Deleted ${name}`
    case 'file.trash':
      return `Moved ${name} to trash`
    case 'file.permanent_delete':
      return `Permanently deleted ${name}`
    case 'file.restore':
      return `Restored ${name}`
    case 'file.conflict_created':
      return `Created conflict copy ${name}`
    default:
      return null
  }
}

export async function describeActivityEventWithFileName(
  event: ActivityNameEvent,
  decryptName: ActivityNameDecryptor,
): Promise<string> {
  if (!FILE_ACTIVITY_EVENT_TYPES.has(event.type)) return event.description

  const snapshot = event.encrypted_name_snapshot
  if (!snapshot?.file_id) return event.description

  try {
    if (event.type === 'file.rename') {
      const oldName = snapshot.old_name_encrypted
        ? cleanName(await decryptName(snapshot.file_id, snapshot.old_name_encrypted))
        : null
      const newName = snapshot.new_name_encrypted
        ? cleanName(await decryptName(snapshot.file_id, snapshot.new_name_encrypted))
        : null

      if (oldName && newName) return `Renamed ${oldName} to ${newName}`
      const fallbackName = cleanName(
        snapshot.name_encrypted ? await decryptName(snapshot.file_id, snapshot.name_encrypted) : newName ?? oldName,
      )
      return fallbackName ? `Renamed ${fallbackName}` : event.description
    }

    const encryptedName = snapshot.name_encrypted ?? snapshot.new_name_encrypted ?? snapshot.old_name_encrypted
    if (!encryptedName) return event.description

    const name = cleanName(await decryptName(snapshot.file_id, encryptedName))
    if (!name) return event.description

    return describeWithName(event.type, name) ?? event.description
  } catch {
    return event.description
  }
}

export async function hydrateActivityEventDescriptions<T extends ActivityNameEvent>(
  events: T[],
  decryptName: ActivityNameDecryptor,
): Promise<T[]> {
  return Promise.all(
    events.map(async (event) => ({
      ...event,
      description: await describeActivityEventWithFileName(event, decryptName),
    })),
  )
}

export async function decryptActivitySnapshotName(fileKey: Uint8Array, encryptedName: string): Promise<string | null> {
  if (!encryptedName.startsWith('{')) return null

  const { decryptFilename, parseEncryptedBlob } = await import('./crypto')
  const { nonce, ciphertext } = parseEncryptedBlob(encryptedName)
  const plain = await decryptFilename(fileKey, nonce, ciphertext)
  try {
    const metadata = JSON.parse(plain) as { name?: string; mime_type?: string }
    return cleanName(metadata.name ?? plain)
  } catch {
    return cleanName(plain)
  }
}
