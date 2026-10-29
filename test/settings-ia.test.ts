import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript-api'

const read = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8')
const profile = read('pages/settings/profile.tsx')
const privacy = read('pages/settings/privacy.tsx')
const nav = read('components/settings-shell.tsx')
const profileAst = ts.createSourceFile('profile.tsx', profile, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const labels: string[] = []
const links: string[] = []
function visit(node: ts.Node) {
  if (ts.isJsxAttribute(node) && node.initializer && ts.isStringLiteral(node.initializer)) {
    if (node.name.getText() === 'label') labels.push(node.initializer.text)
    if (node.name.getText() === 'to') links.push(node.initializer.text)
  }
  ts.forEachChild(node, visit)
}
visit(profileAst)

describe('settings have one useful home', () => {
  test('profile no longer contains a second privacy editor or delete entry', () => {
    expect(labels).not.toContain('Activity tracking')
    expect(labels).not.toContain('Delete account')
    expect(labels).not.toContain('Recovery contact')
    expect(links).not.toContain('/settings/delete-account')
    expect(profile.includes('setTrackingPreference')).toBe(false)
  })
  test('privacy contains the canonical tracking editor and deletion entry', () => {
    expect(privacy.includes('<ActivityTrackingSettings />')).toBe(true)
    expect(privacy.includes('to="/settings/profile"')).toBe(false)
    expect(privacy.includes('to="/settings/delete-account"')).toBe(true)
  })
  test('coming-soon screens do not occupy primary settings navigation', () => {
    expect(nav.includes("href: '/settings/developer'")).toBe(false)
    expect(nav.includes("href: '/settings/referrals'")).toBe(false)
    for (const label of ['Account', 'Privacy & data', 'Storage location', 'Plan & billing', 'Help & about']) {
      expect(nav.includes(`label: '${label}'`)).toBe(true)
    }
  })
})
