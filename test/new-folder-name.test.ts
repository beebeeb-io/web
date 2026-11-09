import { describe, expect, it } from 'bun:test'

import { checkNewFolderName } from '../src/lib/new-document'

describe('checkNewFolderName (no two folders with one name)', () => {
  it('refuses a name a sibling already has, case-insensitively', () => {
    expect(checkNewFolderName('Backups', ['Backups', 'Photos'])).toEqual({ ok: false, reason: '“Backups” already exists in this folder.' })
    expect(checkNewFolderName('  backups ', ['Backups'])).toEqual({ ok: false, reason: '“backups” already exists in this folder.' })
    expect(checkNewFolderName('report.pdf', ['Report.PDF'])).toEqual({ ok: false, reason: '“report.pdf” already exists in this folder.' })
  })
  it('accepts a free name, trimmed', () => {
    expect(checkNewFolderName('  Contracts ', ['Backups'])).toEqual({ ok: true, name: 'Contracts' })
  })
  it('refuses an empty name and a slash', () => {
    expect(checkNewFolderName('   ', []).ok).toBe(false)
    expect(checkNewFolderName('a/b', []).ok).toBe(false)
    expect(checkNewFolderName('a\\b', []).ok).toBe(false)
  })
})
