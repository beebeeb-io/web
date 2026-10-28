import { describe, expect, test } from 'bun:test'
import {
  canAdd,
  canEdit,
  linkErrorCode,
  parseFolderAccessLevel,
} from '../src/lib/folder-link-types'

describe('folder link access levels (2237b)', () => {
  test('known levels pass through', () => {
    expect(parseFolderAccessLevel('add')).toBe('add')
    expect(parseFolderAccessLevel('edit')).toBe('edit')
    expect(parseFolderAccessLevel('view')).toBe('view')
  })

  test('an unknown stored value degrades to the least powerful level', () => {
    expect(parseFolderAccessLevel('ADMIN')).toBe('view')
    expect(parseFolderAccessLevel(null)).toBe('view')
    expect(parseFolderAccessLevel(undefined)).toBe('view')
    expect(parseFolderAccessLevel('')).toBe('view')
  })

  test('add and edit can add; view cannot', () => {
    expect(canAdd('add')).toBe(true)
    expect(canAdd('edit')).toBe(true)
    expect(canAdd('view')).toBe(false)
  })

  test('only edit can edit', () => {
    expect(canEdit('edit')).toBe(true)
    expect(canEdit('add')).toBe(false)
    expect(canEdit('view')).toBe(false)
  })
})

describe('folder link errors (2237b)', () => {
  test('a known server code is returned as-is', () => {
    expect(linkErrorCode({ code: 'too_many_links', status: 409 })).toBe('too_many_links')
    expect(linkErrorCode({ code: 'folder_gone' })).toBe('folder_gone')
  })

  test('anything else is unknown', () => {
    expect(linkErrorCode(new Error('boom'))).toBe('unknown')
    expect(linkErrorCode({ code: 'nope' })).toBe('unknown')
    expect(linkErrorCode(null)).toBe('unknown')
    expect(linkErrorCode('too_many_links')).toBe('unknown')
  })
})
