import { afterAll, describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

/**
 * Task 1581 — office bundle delivery.
 *
 * 1. office-precompress.sh derived the bundle version from `shasum "$f"`
 *    lines, which embed the ABSOLUTE path of each file. The staging input is a
 *    fresh `mktemp -d` every run, so identical bytes gave a new version per
 *    build (0aa0675ef9f2a8b4 vs 292096dbdd12ceef) and every deploy made
 *    opted-in users re-download the whole engine (~55 MB brotli).
 * 2. The office scripts resolved the workspace root with a relative
 *    `--git-common-dir` joined against the CALLER's cwd, so running
 *    office-bundle-stage.sh from anywhere but repos/web looked for
 *    ~/Development/repos/office.
 */

const WEB_DIR = resolve(import.meta.dir, '..')
const PRECOMPRESS = join(WEB_DIR, 'scripts/office-precompress.sh')
const WORKSPACE_LIB = join(WEB_DIR, 'scripts/lib/workspace-root.sh')

const scratch: string[] = []
function scratchDir(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix))
  scratch.push(d)
  return d
}
afterAll(() => {
  for (const d of scratch) rmSync(d, { recursive: true, force: true })
})

/** A small stand-in for the assembled bundle tree (nested dir included, like bridge/). */
function writeFixture(dir: string): void {
  mkdirSync(join(dir, 'bridge'), { recursive: true })
  writeFileSync(join(dir, 'soffice.wasm'), Buffer.from([0x00, 0x61, 0x73, 0x6d, 1, 0, 0, 0]))
  writeFileSync(join(dir, 'soffice.js'), 'var Module = {};\n')
  writeFileSync(join(dir, 'bb-office-host.html'), '<html><body></body></html>\n')
  writeFileSync(join(dir, 'bridge/bb-office-worker.js'), 'self.onmessage = () => {};\n')
}

function run(cmd: string, args: string[], cwd: string) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8' })
  return { status: r.status, stdout: (r.stdout ?? '').trim(), stderr: r.stderr ?? '' }
}

function printVersion(input: string): string {
  // cwd deliberately NOT the web repo — the version must not depend on it either.
  const r = run('bash', [PRECOMPRESS, '--input', input, '--print-version'], tmpdir())
  expect(r.stderr).toBe('')
  expect(r.status).toBe(0)
  return r.stdout
}

const HAS_BROTLI = spawnSync('bash', ['-c', 'command -v brotli'], { encoding: 'utf8' }).status === 0

describe('office bundle version is content-addressed (1581#1)', () => {
  test('the same files staged into two different temp dirs give the same version', () => {
    const a = scratchDir('bb-1581-a-')
    const b = join(scratchDir('bb-1581-b-with-a-longer-name-'), 'nested', 'stage')
    writeFixture(a)
    mkdirSync(b, { recursive: true })
    cpSync(a, b, { recursive: true })

    const va = printVersion(a)
    const vb = printVersion(b)
    console.log(`1581 determinism: version(a)=${va} version(b)=${vb}`)
    expect(va).toMatch(/^[0-9a-f]{16}$/)
    expect(vb).toBe(va)
  })

  test('changing one byte changes the version', () => {
    const a = scratchDir('bb-1581-c-')
    writeFixture(a)
    const before = printVersion(a)
    writeFileSync(join(a, 'bridge/bb-office-worker.js'), 'self.onmessage = () => {} ;\n')
    expect(printVersion(a)).not.toBe(before)
  })

  test('renaming a file (same bytes) changes the version', () => {
    const a = scratchDir('bb-1581-d-')
    writeFixture(a)
    const before = printVersion(a)
    const bytes = readFileSync(join(a, 'soffice.js'))
    rmSync(join(a, 'soffice.js'))
    writeFileSync(join(a, 'soffice2.js'), bytes)
    expect(printVersion(a)).not.toBe(before)
  })

  test.skipIf(!HAS_BROTLI)('two full precompress runs write the same manifest.json version', () => {
    const versions: string[] = []
    for (const p of ['bb-1581-full-a-', 'bb-1581-full-bb-']) {
      const input = scratchDir(p)
      writeFixture(input)
      const out = scratchDir(`${p}out-`)
      const r = run('bash', [PRECOMPRESS, '--input', input, '--output', out], tmpdir())
      expect(r.status).toBe(0)
      const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'))
      expect(manifest.assets).toHaveLength(4)
      versions.push(manifest.version)
      expect(manifest.version).toBe(printVersion(input))
    }
    expect(versions[1]).toBe(versions[0])
  }, 120_000) // brotli -q11 spawns; slow under a loaded machine
})

function gitInit(dir: string): void {
  const g = (...args: string[]) => {
    const r = run('git', args, dir)
    if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`)
  }
  g('init', '-q')
  g('-c', 'user.name=t', '-c', 'user.email=t@beebeeb.io', 'commit', '-q', '--allow-empty', '-m', 'init')
}

function resolveWorkspace(webDir: string, cwd: string): string {
  const r = run('bash', ['-c', `source "${WORKSPACE_LIB}" && bb_workspace_root "$1"`, 'x', webDir], cwd)
  expect(r.stderr).toBe('')
  expect(r.status).toBe(0)
  return realpathSync(r.stdout)
}

describe('workspace root resolution is cwd-independent (1581#2)', () => {
  // A throwaway <ws>/repos/web PRIMARY checkout: git prints its common dir
  // relative (".git"), which is exactly the case the old code got wrong.
  const ws = scratchDir('bb-1581-ws-')
  const primary = join(ws, 'repos', 'web')
  mkdirSync(primary, { recursive: true })
  gitInit(primary)
  const expected = realpathSync(ws)

  test('from the primary checkout itself', () => {
    expect(resolveWorkspace(primary, primary)).toBe(expected)
  })

  test('from an unrelated cwd (/tmp) — the reported failure', () => {
    expect(resolveWorkspace(primary, tmpdir())).toBe(expected)
  })

  test('from the workspace root', () => {
    expect(resolveWorkspace(primary, ws)).toBe(expected)
  })

  test('from a linked worktree outside the workspace', () => {
    const wt = join(scratchDir('bb-1581-wt-'), 'web-1581')
    const r = run('git', ['worktree', 'add', '-q', '--detach', wt], primary)
    expect(r.status).toBe(0)
    expect(resolveWorkspace(wt, tmpdir())).toBe(expected)
  })

  test('no script re-implements the resolver inline', () => {
    const offenders: string[] = []
    for (const dir of ['scripts', 'e2e/scripts']) {
      for (const f of readdirSync(join(WEB_DIR, dir))) {
        if (!f.endsWith('.sh')) continue
        const src = readFileSync(join(WEB_DIR, dir, f), 'utf8')
        if (src.includes('rev-parse --git-common-dir')) offenders.push(`${dir}/${f}`)
      }
    }
    expect(offenders).toEqual([])
  })
})
