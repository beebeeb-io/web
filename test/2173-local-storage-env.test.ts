import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
const script = 'e2e/scripts/direct-storage-env.sh'

/**
 * The harness reads its settings from the environment, and accepts most of them
 * with a default. The test is about the script's own choices, not the machine's,
 * so the child gets ONLY the ambient keys the shell and python need and the
 * overrides below — never a copy of `process.env`. That also drops `BASH_ENV`
 * (and `ENV`), which a container may point at a file that exports its own
 * storage settings into the sourced script.
 */
const PASS_THROUGH = ['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL'] as const

function harnessEnv(overrides: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const key of PASS_THROUGH) {
    const value = process.env[key]
    if (value !== undefined) env[key] = value
  }
  return { ...env, ...overrides }
}

test('MinIO harness refuses provider and non-test bucket before any server starts', () => {
  for (const endpoint of ['https://s3.example.test', 'http://127.0.0.1:9000?x=1', 'http://user@localhost:9000']) {
    const r = spawnSync('bash', ['-ec', `source ${script}`], { env: harnessEnv({ BB_E2E_STORAGE: 'minio', E2E_MINIO_ENDPOINT: endpoint }) })
    expect(r.status).not.toBe(0)
  }
  const r = spawnSync('bash', ['-ec', `source ${script}`], { env: harnessEnv({ BB_E2E_STORAGE: 'minio', E2E_MINIO_BUCKET: 'another-bucket' }) })
  expect(r.status).not.toBe(0)
})
test('MinIO harness enables download only and adds the same dev bucket', () => {
  const r = spawnSync('bash', ['-ec', `source ${script}; test "$BB_DIRECT_UPLOAD" = 0; test "$BB_DIRECT_DISABLE" = web:upload; test "$BB_DIRECT_DOWNLOAD" = 1; test "\${E2E_STORAGE_ENV[0]}" = BLOB_STORE=s3; test -n "$VITE_DEV_STORAGE_PAIR"`], { env: harnessEnv({ BB_E2E_STORAGE: 'minio' }) })
  expect(r.status).toBe(0)
})
