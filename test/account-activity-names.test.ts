import { describe, expect, test } from 'bun:test'

import {
  describeActivityEventWithFileName,
  type ActivityEncryptedNameSnapshot,
} from '../src/lib/account-activity-names'
import type { AccountActivityEvent } from '../src/lib/api'

const baseEvent: AccountActivityEvent = {
  id: 'event-1',
  type: 'file.upload',
  description: 'Uploaded a file',
  category: 'files',
  outcome: 'success',
  device: null,
  country_code: null,
  created_at: '2026-07-03T12:00:00.000Z',
}

function event(
  type: string,
  description: string,
  encrypted_name_snapshot?: ActivityEncryptedNameSnapshot | null,
): AccountActivityEvent {
  return { ...baseEvent, type, description, encrypted_name_snapshot }
}

describe('describeActivityEventWithFileName', () => {
  test('uses a decrypted upload snapshot when available', async () => {
    const description = await describeActivityEventWithFileName(
      event('file.upload', 'Uploaded a file', {
        file_id: 'file-1',
        name_encrypted: 'enc-report',
      }),
      async (fileId, encryptedName) => `${fileId}:${encryptedName}:report.pdf`,
    )

    expect(description).toBe('Uploaded file-1:enc-report:report.pdf')
  })

  test('formats rename events with old and new decrypted names', async () => {
    const names: Record<string, string> = {
      old: 'draft.txt',
      new: 'report.pdf',
    }

    const description = await describeActivityEventWithFileName(
      event('file.rename', 'Renamed a file', {
        file_id: 'file-1',
        old_name_encrypted: 'old',
        new_name_encrypted: 'new',
      }),
      async (_fileId, encryptedName) => names[encryptedName] ?? null,
    )

    expect(description).toBe('Renamed draft.txt to report.pdf')
  })

  test('falls back to the generic server description when decryption fails', async () => {
    const description = await describeActivityEventWithFileName(
      event('file.trash', 'Moved a file to trash', {
        file_id: 'file-1',
        name_encrypted: 'enc-report',
      }),
      async () => null,
    )

    expect(description).toBe('Moved a file to trash')
  })

  test('leaves non-file events unchanged', async () => {
    const description = await describeActivityEventWithFileName(
      event('auth.logout', 'Signed out', null),
      async () => 'ignored',
    )

    expect(description).toBe('Signed out')
  })
})
