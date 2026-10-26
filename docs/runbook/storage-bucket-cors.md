# Web direct download: bucket CORS and go-live (task 2173)

Owner: lead for every bucket change and deployment; L13 prepares files and local evidence.
Contracts: [clients design](../superpowers/specs/2026-10-25-direct-transfer-clients-design.md#83-bucket-cors-decision-e2-a-production-change-its-own-step), [ordering amendment](../superpowers/plans/2026-10-25-2173-direct-upload-pipelining.md#critical-path-to-web-direct-download-live-w1-w2-w4-w5-no-w3).

The download path does not wait for W3. Uploads stay disabled with `BB_DIRECT_DISABLE=web:upload` after download go-live. Until the download release window, use `web` (both directions disabled). The global upload flag also stays off. The full CORS document includes future upload headers so a second bucket change is unnecessary.

## Documents and credentials

Server repo files: `ops/storage/bucket-cors-web-v1.json`, `ops/storage/bucket-cors-web-v1.test-bucket.json`, `scripts/storage/bucket-cors.sh`.
Production origins: only `https://app.beebeeb.io`. The test document also allows `http://localhost:5173` and `http://127.0.0.1:5173`. Methods: GET and PUT. Allowed headers: `content-type`, `content-md5`, `if-none-match` (v2 signs both latter headers). ExposeHeaders is absent. MaxAgeSeconds is 3600. A GET has zero preflights; upload preflights equal PUTs because the full signed URL is unique. CORS never makes a private bucket public.

Use an operator-owned credential file outside git, containing the standard S3 access key, secret key, and optional session token. The script sources it inside a subshell with tracing off. Set the endpoint, credential-file, and region environment variables required by the script. Never put credentials in arguments, shell history or logs. Never print the credential file.

The script validates the document before any provider call. `check` verifies the entire CORS document, absence of a website configuration (only NoSuchWebsiteConfiguration counts), and an unsigned missing-key GET returning 403/404 without following redirects. Extra origins/methods/headers/rules, website redirects, AccessDenied on the website check, network errors and 3xx all fail. `apply` reads back and runs those checks too. A non-test bucket apply is refused before any AWS call without BB_PROD_OK=1. The guard is not authorization: only the lead executes apply, including the test bucket.

## Test-bucket change: lead only

1. Record the existing CORS document privately so it can be restored exactly; absence is also a state. Record the test API/web/core SHAs and isolate accounts and generated objects. Keep the bucket private.
2. From the server checkout, run `scripts/storage/bucket-cors.sh apply beebeeb-test01 ops/storage/bucket-cors-web-v1.test-bucket.json` with the credential environment above. Run `check` with the same arguments. Record 3 checks passed and the document hash.
3. Wait until the REST endpoint answers the expected OPTIONS and GET policy from each browser origin. Do not treat one successful read-back as propagation evidence. A restrictive replacement/deletion may remain in browser preflight caches for up to the previous 3600-second maximum; use fresh browser profiles for negative rungs.
4. Run the download-only rows below with a local API relaying seed uploads into the test bucket. W3, direct PUT, abandon-then-API and upload throughput are W4b and remain deferred.
5. The lead removes/restores CORS only in this test bucket for the negative rung, repeats the tests in fresh profiles, restores the saved policy, and verifies every generated object is reclaimed and the dedicated test namespace/bucket is empty. Record counts; no production traffic or production account is a test fixture.

## Release-window browser checklist (not run by L13)

COMMON.md forbids browser E2E in the full-speed implementation lanes. These rungs are delayed to the release window, never counted as passed by unit tests.

| Row | Expected evidence |
| --- | --- |
| New web/new local server, direct on, existing MinIO | Seed through API; saved-file SHA-256 equal; grants >0; storage GETs equal chunk count; API byte requests 0; storage OPTIONS 0 |
| Released web/new server | Existing API download unchanged and byte-identical |
| New web/old server (29e88197) | Discovery bare 404; API download unchanged and byte-identical |
| New web/new server, download flag off or family disabled | API download; storage GETs 0 |
| Missing discovery allowlist pair | Grants 0 and storage requests 0; byte-identical API save |
| CORS absent or storage aborted | First file >0 and <=16 storage GETs then pinned chunk route; second file 0 storage requests in the same login |
| Storage 302 | No followed redirect; bounded renewal then pinned chunk; second file 0 storage requests |
| `localStorage["bb.transport"]="api"` | Discovery/grants/storage 0; byte-identical API download |
| 256 MiB chunks, Chromium | One held chunk, bounded reorder memory; SHA-256 equal |
| Zero-byte, single-chunk, version replaced, sleep past expiry | Empty output authenticated; no mixed-version completion; expiry renews without counting a fetch failure |
| Chromium, Firefox, WebKit locally; Chromium, Firefox, Safari prod smoke | Each row counted per browser, exact SHAs and hashes captured |
| Real-TLS test bucket | Same download rows; fresh profiles for negative CORS; bucket empty afterwards |

Web's `e2e/2173-direct-download.spec.ts` prepares five local MinIO modes: direct, forced API, aborted storage, redirect, missing pair. It is explicitly skipped in the ordinary local-filesystem suite; it must run (not skip) for this rung. `e2e/scripts/web-e2e.sh` supports BB_E2E_STORAGE=minio using an **already provisioned** loopback MinIO with `beebeeb-test01`, required CORS, and a prebuilt local API. It starts no MinIO container and applies no CORS. Example environment (fixture credentials use local defaults):

```sh
BB_E2E_STORAGE=minio E2E_MINIO_ENDPOINT=http://127.0.0.1:9000 \
  E2E_API_BIN=/absolute/path/to/local/beebeeb-api \
  ./e2e/scripts/web-e2e.sh e2e/2173-direct-download.spec.ts
```

The helper rejects non-loopback endpoints and any other bucket. For flags off, set BB_E2E_DIRECT_DOWNLOAD=0 and select the forced-API row; old/new binary combinations need separately recorded API binaries. Run Firefox/WebKit with an appropriate Playwright project configuration; the default authenticated project is Chromium only. Playwright traces, request logs, videos and HARs can contain signed URLs: keep diagnostic artifacts private and do not upload them to CI/support. Test runs needing such captures must disable trace/video capture or sanitize before sharing. The prepared spec has not proved the remaining matrix rows or any actual browser behavior.

## W5 steps 1–4: lead handoff

1. **Required input:** a current, complete, read-only export of every production pool's `{host, bucket}` from the registry, identifying `BB_DIRECT_TRANSFER_POOLS`. L13 commits the exact W5 allowlist export supplied by the lead in `config/storage-allowlist.json`; the lead still owns applying CORS and deploying it. Do not infer buckets from old logs or a provider host. Commit those exact pairs in web and run `bun scripts/check-storage-csp.ts`, build, and `--check`; all four sources plus the built page must match. Keep the Office sandbox connect-src self only. Review/merge before adding any pool to the server allowlist.
2. Confirm B1 (per-family kill switch) is merged and deployed on **every** API node; initially list `web`. Lead deploys the exact tested web SHA via [DEPLOYMENT.md](../DEPLOYMENT.md). Server direct download being globally on does not establish browser readiness.
3. Lead applies the production document once per eligible bucket, with BB_PROD_OK=1, and runs check after each; record pool count, documents and propagation probes. No parallel bucket changes. Provisioning any future pool includes allowlist+CSP deployment, private/no-website policy, CORS apply/check, then server direct-pool eligibility, in that order.
4. Lead runs production smoke on the dedicated test account in Chromium, Firefox and Safari, then changes the family entry from `web` to **`web:upload`**, health-gated per node. Probe authenticated discovery on each node: download lists object-download-v1; upload does not offer direct. Record requests, hashes and scrubbed output. Never remove web:upload in this task; W5 step 5 requires W3/W4b and upload benchmark approval.

Rollback: lead restores `web` (or adds `web:download`) to BB_DIRECT_DISABLE, health-gated per node, without changing uploaded sessions. The support switch `bb.transport=api` is a reversible per-browser workaround. Restore saved bucket CORS (or delete only if it was absent before); do not assume DeleteBucketCors is the correct prior state. Keep the old web image available under the deployment procedure.

## Support and evidence

Support never asks for a HAR of a direct transfer. An unsolicited HAR is a secret until every link expires; keep it access-restricted, scrub query strings/signatures/credentials/security tokens before sharing, and delete per the support retention policy. Browser-owned CORS/CSP console diagnostics can print the full URL even when application logs contain none. Application telemetry passes through `packages/shared/src/telemetry/scrub.ts`; consent rules still apply.

L13 evidence: `~/code/bb-gate-logs/fullspeed/l13-s3-web/`. No CORS apply, provider request, production deploy, production switch edit or browser E2E was performed by this lane.
