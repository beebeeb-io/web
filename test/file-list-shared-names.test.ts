import { describe, expect, test } from 'bun:test'
import { addedBySomeoneElse } from '../src/components/file-list'

describe('shared folder rows added by another account', () => {
  test('a member upload resolves through the folder key, not the viewer master key', () => {
    expect(addedBySomeoneElse({ uploaded_by: 'member-1' }, 'owner-1')).toBe(true)
  })

  test('the viewer\'s own uploads keep the master-key path', () => {
    expect(addedBySomeoneElse({ uploaded_by: 'owner-1' }, 'owner-1')).toBe(false)
  })

  test('rows without attribution and unknown viewers keep the master-key path', () => {
    expect(addedBySomeoneElse({}, 'owner-1')).toBe(false)
    expect(addedBySomeoneElse({ uploaded_by: 'member-1' }, null)).toBe(false)
  })
})
