import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
const script = 'e2e/scripts/direct-storage-env.sh'

/**
 * The harness reads its settings from the environment, and accepts most of them
 * with a default. Running inside an e2e harness (or after any test that exports
 * one of these) must not change what this test proves, so every storage key is
 * dropped before the overrides are applied: the test is about the script's own
 * choices, not the machine's.
 */
function harnessEnv(overrides: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  for (const key of Object.keys(env)) {
    if (/^(BB_E2E_|E2E_MINIO_|BB_DIRECT_|S3_|VITE_DEV_STORAGE_PAIR$)/.test(key)) delete env[key]
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
