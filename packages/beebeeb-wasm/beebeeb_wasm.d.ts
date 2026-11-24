/* tslint:disable */
/* eslint-disable */

export type DirectVerdict =
| { kind: "api_for_file" }
| { kind: "restart" }
| { kind: "terminal"; status: number; error: string | null }
| { kind: "corrupt" };

export type DirectStorageGet = { kind: "stored" } | { kind: "failed"; status: number };

export type DirectPoll =
| { kind: "request_window"; request: { object_version_id: string | null; start_index: number; count: number; renewal: boolean } }
| { kind: "fetch"; index: number; method: string; url: WasmSignedUrl; length: number; expires_at: string }
| { kind: "fetch_via_api"; index: number; object_version_id: string }
| { kind: "wait"; until_ms: number | null }
| { kind: "done" }
| { kind: "stop"; verdict: DirectVerdict };



export class AccountFlow {
    free(): void;
    [Symbol.dispose](): void;
    abandon(): void;
    changeEmail(new_email: string, password: string, recovery_check_b64: string, x25519_public_b64: string): any;
    /**
     * `onboardingStatus` / `onboardingBody`: the server's `GET /api/v1/onboarding` answer (its
     * password policy). `breachCheck`: a `WasmBreachCheck` made for `newPassword` and answered,
     * required when that policy declares a breach check (sign-up's gate).
     */
    changePassword(current: string, new_password: string, recovery_check_b64: string, x25519_public_b64: string, onboarding_status: number, onboarding_body: string, breach_check?: WasmBreachCheck | null): any;
    deleteAccount(password: string, code?: string | null): any;
    deleteCancel(link_token: string): any;
    deleteConfirm(link_token: string): any;
    constructor();
    regenerateBackupCodes(code: string): any;
    resume(status: number, body_text: string): any;
    revokeOtherSessions(): any;
    revokeSession(session_id: string): any;
    /**
     * Turning it off takes the password (a step-up inside); turning it on ignores it.
     */
    setActivityLogging(on: boolean, password?: string | null): any;
    setDisplayName(name: string): any;
    totpConfirm(code: string): any;
    totpDisable(code: string): any;
    totpSetup(password?: string | null, current_code?: string | null): any;
    verifyEmail(code: string): any;
    verifyPassword(password: string): any;
}

/**
 * The approving side: `new AuthApproval(code)`, `start()`, `onLookupResponse(...)` (the facts),
 * `codeMatches(typed)`, `approve(typed, password, masterKey)`, then `onResponse(...)` until
 * `{kind: "approved"}`.
 */
export class AuthApproval {
    free(): void;
    [Symbol.dispose](): void;
    approve(typed_code: string, password: string, master_key: Uint8Array): any;
    codeMatches(typed: string): boolean;
    /**
     * Deny the request shown for review (DW-A09); send the request, then `onDenyResponse`.
     */
    deny(): any;
    constructor(code: string);
    onDenyResponse(status: number, body: string, retry_after_secs?: number | null): void;
    onLookupResponse(status: number, body: string, retry_after_secs?: number | null): any;
    onResponse(status: number, body: string, retry_after_secs?: number | null): any;
    start(): any;
}

/**
 * The requesting side of sign in with another device: `initFrame(...)` is the first socket
 * frame, `onFrame(text)` reads each server frame.
 */
export class AuthDeviceRequest {
    free(): void;
    [Symbol.dispose](): void;
    initFrame(device_name: string | null | undefined, client: string, client_version: string, os: string): string;
    constructor();
    /**
     * `{kind: "waiting", userCode, verificationUri, expiresIn}` or
     * `{kind: "approved", sessionToken, masterKey: Uint8Array}`.
     */
    onFrame(text: string): any;
}

/**
 * `new AuthSignIn(email, password)`; `start()` then `onResponse(...)` until
 * `{kind: "signed_in", sessionToken}` or `{kind: "second_factor"}`, then `verifyRequest(code)` /
 * `onVerifyResponse(...)`.
 */
export class AuthSignIn {
    free(): void;
    [Symbol.dispose](): void;
    constructor(email: string, password: string);
    onResponse(status: number, body: string, retry_after_secs?: number | null): any;
    /**
     * The session token; throws `wrong_code` and stays ready for the next code.
     */
    onVerifyResponse(status: number, body: string, retry_after_secs?: number | null): string;
    start(): any;
    verifyRequest(code: string): any;
}

/**
 * `new AuthStepUp(password, purpose?, cliCode?)`; `start()`, `onResponse(...)` until
 * `{kind: "confirmed"}`, then `attachConfirmToken(path, body)` gives the consuming request.
 */
export class AuthStepUp {
    free(): void;
    [Symbol.dispose](): void;
    attachConfirmToken(path: string, body: any): any;
    constructor(password: string, purpose?: string | null, cli_code?: string | null);
    onResponse(status: number, body: string, retry_after_secs?: number | null): any;
    start(): any;
}

/**
 * Opaque handle holding ONLY the derived client-metadata key (task 1922).
 *
 * Make it once when the vault unlocks, free it on lock. List views and SSE
 * frames call `seal` / `open` / `openMany` on the handle, so the master key is
 * not copied into WASM memory on every frame. The derived key never leaves
 * Rust; the handle is zeroized on drop and `free()` is wasm-bindgen's own.
 */
export class ClientMetaKey {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Derive the key from a 32-byte master key. The bytes are taken into a
     * `Zeroizing` buffer and the master key is dropped before returning.
     */
    constructor(master_key: Uint8Array);
    /**
     * Open one field's `bbcm1.` envelope.
     */
    open(record_key: string, device_key: string | null | undefined, field: number, envelope: string): string;
    /**
     * Open many rows in one call: `items` is
     * `[{ recordKey, deviceKey?, field, envelope? }]`; the result is
     * `[{ ok: bool, value?: string }]`. One bad row never fails the batch: a
     * null envelope, a bad field or UUID, a malformed row and a failed open
     * each yield `{ ok: false }` for that row only.
     */
    openMany(items: any): any;
    /**
     * Seal one field. `device_key` must be `null` for field 1 and set for 2-4.
     */
    seal(record_key: string, device_key: string | null | undefined, field: number, plaintext: string): string;
}

/**
 * `new PhraseRecovery(policyStatus, policyBody, email, phrase)`; `start()` then
 * `onStartResponse`, `evaluate`, `breachRequest` / `onBreachResponse`, `setPassword` (a request),
 * `onRegisterResponse` (a request), `onFinalizeResponse` (`{kind: "signed_in", sessionToken,
 * masterKey}` or `{kind: "sign_in_required"}`).
 */
export class PhraseRecovery {
    free(): void;
    [Symbol.dispose](): void;
    breachRequest(password: string): any;
    evaluate(password: string): any;
    constructor(policy_status: number, policy_body: string, email: string, phrase: string);
    onBreachResponse(status: number | null | undefined, body: string): any;
    /**
     * The last step; the object is spent afterwards.
     */
    onFinalizeResponse(status: number, body: string, retry_after_secs?: number | null): any;
    onRegisterResponse(status: number, body: string, retry_after_secs?: number | null): any;
    onStartResponse(status: number, body: string, retry_after_secs?: number | null): void;
    setPassword(password: string, confirmation: string): any;
    start(): any;
}

/**
 * `new ShareCreateLink(appUrl, fileId, masterKey, fileKey, expiresInHours?, maxOpens?, passphrase?)`;
 * `start()`, then `onResponse(...)` until `{kind: "created", shareId, link, display}`.
 */
export class ShareCreateLink {
    free(): void;
    [Symbol.dispose](): void;
    constructor(app_url: string, file_id: string, master_key: Uint8Array, file_key: Uint8Array, expires_in_hours?: number | null, max_opens?: number | null, passphrase?: string | null);
    onResponse(status: number, body: string, retry_after_secs?: number | null): any;
    start(): any;
}

/**
 * `new ShareCreateRequest(appUrl, title, description?, targetFolderId?, maxFiles?, maxTotalBytes?,
 * expiresInSecs?, masterKey)`; `start()`, then `onResponse(...)` → `{id, link, display}`.
 */
export class ShareCreateRequest {
    free(): void;
    [Symbol.dispose](): void;
    constructor(app_url: string, title: string, description: string | null | undefined, target_folder_id: string | null | undefined, max_files: number | null | undefined, max_total_bytes: number | null | undefined, expires_in_secs: number | null | undefined, master_key: Uint8Array);
    onResponse(status: number, body: string, retry_after_secs?: number | null): any;
    start(): any;
}

/**
 * `new ShareFolderInvite(folderId, email, expectedPeerFingerprint, sharedFoldersWrite, custodySeen,
 * custodyUnreadable, masterKey)` (`expectedPeerFingerprint` REQUIRED: 32 bytes, or empty = not compared)
 * or `ShareFolderInvite.link(folderId, appUrl, accessLevel, label?, expiresInHours?, capBytes?,
 * maxOpens?, passphrase?, custodySeen, custodyUnreadable, masterKey)`; `start()`, then
 * `onResponse(...)` until `{kind: "shared" | "invited" | "awaiting_approval" | "link_created"}`. A
 * `{kind: "send", markCustodySeen}` with an id: persist the id BEFORE sending the request.
 */
export class ShareFolderInvite {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * A live folder link (web `createFolderLinkWithKeys`).
     */
    static link(folder_id: string, app_url: string, access_level: string, label: string | null | undefined, expires_in_hours: number | null | undefined, cap_bytes: number | null | undefined, max_opens: number | null | undefined, passphrase: string | null | undefined, custody_seen: string[], custody_unreadable: boolean, master_key: Uint8Array): ShareFolderInvite;
    constructor(folder_id: string, email: string, expected_peer_fingerprint: Uint8Array, shared_folders_write: boolean, custody_seen: string[], custody_unreadable: boolean, master_key: Uint8Array);
    onResponse(status: number, body: string, retry_after_secs?: number | null): any;
    start(): any;
}

/**
 * `new ShareMemberInvite(itemId, isFolder, email, expectedPeerFingerprint, masterKey, fileKey)`;
 * `start()`, then `onResponse(...)` until
 * `{kind: "shared" | "invited" | "awaiting_approval" | "peer_key_changed", inviteId}`.
 * `expectedPeerFingerprint` is REQUIRED: 32 bytes (the compared mark's fingerprint) or an empty
 * `Uint8Array` (not compared). `peer_key_changed`: nothing was sealed.
 */
export class ShareMemberInvite {
    free(): void;
    [Symbol.dispose](): void;
    constructor(item_id: string, is_folder: boolean, email: string, expected_peer_fingerprint: Uint8Array, master_key: Uint8Array, file_key: Uint8Array);
    onResponse(status: number, body: string, retry_after_secs?: number | null): any;
    start(): any;
}

/**
 * `new SignupFlow(policyStatus, policyBody)`; then the steps in order: `sendCode` /
 * `onCodeSent`, `verifyCode` / `onCodeVerified`, `evaluate`, `breachRequest` / `onBreachResponse`,
 * `setPassword`, `phraseWords`, `acknowledgePhrase`, `challengePositions`, `confirmPhrase`,
 * `registerStart` / `onRegisterStart` / `onRegisterFinish` (`{sessionToken, userId, masterKey}`),
 * `termsRequest`.
 */
export class SignupFlow {
    free(): void;
    [Symbol.dispose](): void;
    acknowledgePhrase(): void;
    /**
     * Take an existing master key instead of a new one; counts as confirmed.
     */
    adoptPhrase(phrase: string): void;
    /**
     * The breach request for this password, or `null` when the policy declares no check.
     */
    breachRequest(password: string): any;
    /**
     * 1-based word positions to ask for.
     */
    challengePositions(): Uint32Array;
    confirmPhrase(answers: string[]): void;
    evaluate(password: string): any;
    constructor(policy_status: number, policy_body: string);
    /**
     * `status` is `undefined` when the endpoint gave no answer. `{kind, count}` or `null`.
     */
    onBreachResponse(status: number | null | undefined, body: string): any;
    onCodeSent(status: number, body: string, retry_after_secs?: number | null): void;
    onCodeVerified(status: number, body: string, retry_after_secs?: number | null): void;
    /**
     * `{sessionToken, userId, masterKey: Uint8Array}`: store, then drop.
     */
    onRegisterFinish(status: number, body: string, retry_after_secs?: number | null): any;
    onRegisterStart(status: number, body: string, retry_after_secs?: number | null): any;
    /**
     * The 12 words, for the one-time display.
     */
    phraseWords(): string[];
    registerStart(): any;
    sendCode(email: string): any;
    setPassword(password: string, confirmation: string): any;
    termsRequest(): any;
    verifyCode(code: string): any;
    wipe(): void;
}

/**
 * Account key material stays opaque after device approval. It can answer a
 * proof but has no byte getter.
 */
export class WasmAccountKeyMaterial {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    answerRecoveryKeyProof(nonce: Uint8Array, server_public: Uint8Array, canonical_email: Uint8Array): Uint8Array;
    answerSessionKeyProof(nonce: Uint8Array, server_public: Uint8Array, session_id: Uint8Array, account_id: Uint8Array): Uint8Array;
}

/**
 * One extraction run. The driver acts on each step (create the folder,
 * stage and upload the file, supply bytes, ask for the password) and
 * reports back.
 */
export class WasmArchiveExtraction {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    cancel(): void;
    /**
     * The folder for `create_folder`'s `node` exists, with this id.
     */
    folderCreated(node: number, id: string): void;
    /**
     * The server answered 409 for `node`'s name: core numbers it again.
     */
    folderNameTaken(node: number): void;
    /**
     * The archive as the server lists it now (`{file_id,
     * object_version_id}`): another version stops the run.
     */
    identitySeen(identity_js: any): void;
    /**
     * The preview model while the run goes and after it ends; `input` as
     * for the session.
     */
    preview(input: any): any;
    releaseBefore(offset: bigint): void;
    /**
     * The run cannot go on: `"storage_full"`, `"network"`, `"damaged"`,
     * `"changed"` or `"account_blocked"`.
     */
    runFailed(reason: string): void;
    /**
     * The next step: `{kind}` is `need_bytes`, `need_password`,
     * `create_folder`, `file_begin`, `file_data` (`bytes` a `Uint8Array`,
     * not yet verified), `file_end`, `file_skipped`, `progress`, `waiting`
     * or `finished`.
     */
    step(): any;
    /**
     * The bytes at `offset`, as for the session.
     */
    supply(offset: bigint, bytes: Uint8Array): void;
    /**
     * The password the person entered for `need_password`. Supplied at
     * any other time it is dropped.
     */
    supplyPassword(password: string): void;
    /**
     * `node`'s upload finished (`ok`) or failed.
     */
    uploadFinished(node: number, ok: boolean): void;
}

/**
 * One archive being listed, previewed and opened. The driver answers each
 * `need_bytes` with `supply` and asks again.
 */
export class WasmArchiveSession {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Whether `password` opens entry `index`: `{kind: "need_bytes", start,
     * end}`, `"accepted"`, `"wrong"`, `"damaged"` (the entry's headers
     * are damaged: the password cannot be judged), `"not_needed"` or
     * `{kind: "io", message}`.
     */
    checkPassword(index: number, password: string): any;
    /**
     * The listing (`{format, entries, totals, protection, uses_zipcrypto,
     * complete}`), or `null` before `listed`.
     */
    listing(): any;
    /**
     * A session for an archive of `len` bytes on `platform` (`"native"`,
     * `"browser"` or `"mobile_app"`).
     */
    constructor(len: bigint, platform: string);
    /**
     * Read entry `index` whole, to open it: `{kind: "need_bytes", start,
     * end}` (supply, then call again with the same index), `{kind:
     * "bytes", bytes}` once its check passed, `"corrupt"`, `"wrong"`,
     * `{kind: "skipped", reason}`, `"too_large"` (over the platform's
     * open budget) or `{kind: "io", message}`. `password` is used when a
     * read starts.
     */
    openEntry(index: number, password?: string | null): any;
    /**
     * Plan an extraction of the listed archive: a `WasmExtractionPlan`, or
     * `{kind: "refused", refusal, text}`. `request`: `{archive_name,
     * selection: "all" | [path], destination: {siblings, backup_position,
     * writable}, server_free_bytes, device_free_bytes}`.
     */
    plan(request: any): any;
    /**
     * The preview model. `input`: `{archive_name, folder, selection,
     * destination: "next_to" | "choose_folder", password: null | boolean}`.
     */
    preview(input: any): any;
    /**
     * The preview model with a plan's notes (renamed entries, the browser's
     * size limit).
     */
    previewWithPlan(input: any, plan: WasmExtractionPlan): any;
    /**
     * Bytes before `offset` are no longer needed.
     */
    releaseBefore(offset: bigint): void;
    /**
     * Start extracting `plan`, bound to `identity` (`{file_id,
     * object_version_id}`); a password from the preview is passed on. The
     * session moves into the extraction: every later call on it throws.
     */
    startExtraction(identity_js: any, plan: WasmExtractionPlan, password?: string | null): WasmArchiveExtraction;
    /**
     * `{kind: "need_bytes", start, end}`, `{kind: "listed"}`,
     * `{kind: "refused", refusal, format, text}` or `{kind: "io", message}`.
     */
    step(): any;
    /**
     * The bytes at `offset`. Throws when they fall outside the archive or
     * differ from bytes already supplied there.
     */
    supply(offset: bigint, bytes: Uint8Array): void;
}

/**
 * k-anonymity breach check for one password. Core hashes and matches; **JS
 * makes the HTTP call**, to the endpoint the onboarding document declares in
 * `policy.password.breach_check.endpoint` (Beebeeb's own API, never a third
 * party). Only `prefix` (5 hex chars) may be sent; the rest stays here and is
 * zeroized when the object is freed.
 *
 * The object is bound to the password it was made from and remembers the
 * answer: pass it to `WasmSignupCeremony.setPassword`, which refuses a check
 * made for a different password. A response body over 262144 bytes is treated
 * as an outage, so stop reading the response at that size.
 *
 * ```js
 * const q = new WasmBreachCheck(password)
 * const prefix = q.prefix               // send exactly this, and pass exactly what you sent back
 * let body = null
 * try { const r = await fetch(endpoint.replace('{prefix}', prefix)); if (r.ok) body = await r.text() } catch {}
 * const verdict = q.evaluate(prefix, body, failOpen)   // body === null means the call failed
 * ceremony.setPassword(password, confirmation, q)   // borrows q; omit-the-check cannot bypass a required gate
 * q.free()
 * ```
 */
export class WasmBreachCheck {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Record the answer and return the verdict for display. `requested_prefix`
     * is the prefix the request URL (or the cache entry read) actually used;
     * if it is not this password's prefix this throws an `Error` with code
     * `breach_prefix_mismatch` and records nothing (a body for another prefix
     * would otherwise read as clean). `body` is the
     * response text of a 2xx answer, or `null`/`undefined` when the request
     * failed (network error, timeout, non-2xx). An empty body counts as a
     * failed request. `fail_open` is `policy.password.breach_check.fail_open`
     * and only shapes this display value: the ceremony applies the value it
     * was constructed with. Returns `{ kind, count, allows_proceeding, check_failed }`.
     */
    evaluate(requested_prefix: string, body: string | null | undefined, fail_open: boolean): any;
    constructor(password: string);
    /**
     * The 5 upper-case hex characters to send to the server.
     */
    readonly prefix: string;
}

/**
 * Stateful, single-file streaming decryptor for the web client — the ONE way
 * web should decrypt file content (downloads, previews, shared links).
 *
 * Reads v2 (position-bound) and v1 (legacy) files. Both constructors take the
 * object `decrypt_file_metadata(...)` returned for the version being read
 * (crypto review P2-4): its `chunk_format` (0 = unrecorded, 2 = v2) and,
 * when the record carries one, its version commitment, which frame 0 must
 * match, so the server cannot serve another upload in its place. A missing
 * object, or one with only half a commitment, is refused; a legacy record
 * with no commitment opens v1 content only (the ruling of 2026-11-07). In v2 every frame must
 * be the next chunk in order and from the same upload as chunk 0, and nothing
 * may follow the last one; [`finish`] fails if the file ended before its last
 * chunk (truncation). JS must treat any thrown error — from `pushFrame` or
 * `finish` — as a failed download and discard the plaintext it has buffered.
 *
 * Replaces the per-chunk `decrypt_chunk(fileKey, nonce, ciphertext)` loop for
 * file content: that generic function has no position and can only open v1
 * frames (it stays for key unwrapping).
 *
 * [`finish`]: Self::finish
 */
export class WasmChunkDecryptor {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Consume the decryptor and run the end-of-stream check. Throws if no frame
     * was pushed or a v2 file ended before its last chunk. Returns
     * `{ chunk_count, format }`.
     */
    finish(): any;
    /**
     * Protected current or historical read. Supply the fields from that
     * version's own decrypted metadata record.
     */
    static forVersion(master_key: Uint8Array, file_id: string, expected_chunk_format: number, version_id: Uint8Array, version_counter: number): WasmChunkDecryptor;
    /**
     * Decryptor from an already-unwrapped 32-byte file key (share / shared-link
     * recipients). `file_id` must be the id the file was uploaded under;
     * `metadata` is what `decrypt_file_metadata_with_key` returned.
     */
    static fromFileKey(file_key: Uint8Array, file_id: string, metadata: any): WasmChunkDecryptor;
    /**
     * Decryptor for the owner: the file key is derived in core from the
     * 32-byte master key and `file_id`. `metadata` is what
     * `decrypt_file_metadata` returned for this version.
     */
    constructor(master_key: Uint8Array, file_id: string, metadata: any);
    /**
     * Decrypt the next wire frame (`nonce(12) || ciphertext || tag(16)`),
     * returning its plaintext. Frames must be pushed in order from chunk 0.
     */
    pushFrame(frame: Uint8Array): Uint8Array;
    /**
     * How many frames have been decrypted so far.
     */
    readonly chunksDecrypted: number;
    /**
     * The file's chunk format once chunk 0 has been opened: 1 = v1, 2 = v2;
     * 0 before the first frame.
     */
    readonly format: number;
    /**
     * v2: the upload's version id (chunk 0's 12-byte nonce) once chunk 0 has
     * authenticated — what a seeking reader passes to `decrypt_chunk_frame`.
     * `undefined` before chunk 0 and for v1 files.
     */
    readonly versionId: Uint8Array | undefined;
}

/**
 * Stateful, single-file streaming encryptor for the web client.
 *
 * WASM is single-threaded and cannot `Read` a browser `File`, so the web
 * client uses the **push** form of the shared `beebeeb-core` primitive: JS
 * slices the `Blob` and hands each plaintext chunk to [`push_chunk`], and core
 * encrypts it. This converges the web client onto the exact same crypto loop
 * (and wire format) as the CLI/desktop/mobile clients — the per-file key is
 * derived **once** inside core and never recombined in JS.
 *
 * Lifecycle: construct with [`new`](Self::new) (or
 * [`withChunkSize`](Self::with_chunk_size) when the server dictates the chunk
 * size), call [`pushChunk`](Self::push_chunk) once per slice in order, then
 * [`finish`](Self::finish) to run the integrity guard and get the summary.
 *
 * This is the first stateful `#[wasm_bindgen]` struct in the crate: it proves
 * the constructor + `&mut self` method + by-value `self` (consuming `finish`)
 * pattern across the JS boundary.
 */
export class WasmChunkEncryptor {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Consume the encryptor, run the integrity guard (all planned chunks
     * emitted and the ciphertext total matches), and return the summary
     * `{ chunk_count, total_plaintext, total_ciphertext, chunk_size_bytes }`.
     * Errors if the source shrank (fewer chunks/bytes than planned).
     */
    finish(): any;
    /**
     * Create a push-form encryptor for a NEW row minted by
     * `newOwnerItemId`/`newForeignItemId` (task 2275, L13).
     *
     * The id comes from the handle; the content key is core's derivation under
     * that id, which is also the member's rule for a new foreign item.
     */
    static forNewItem(item_id: WasmNewItemId, file_size: bigint, profile: string): WasmChunkEncryptor;
    /**
     * Create a push-form replacement encryptor for a resolved row (task 2275,
     * L13). The key, the id and the recorded chunk-format pin all come from the
     * `WasmWriteTarget`, so a caller cannot drop a recorded v2 pin.
     */
    static forTarget(target: WasmWriteTarget, file_size: bigint, profile: string): WasmChunkEncryptor;
    /**
     * Create a push-form encryptor whose chunk plan is derived from
     * `file_size` + `profile` (the client ladder).
     *
     * `master_key` must be exactly 32 bytes; it is copied into a `MasterKey`
     * (zeroized on drop). `profile` is one of `"desktop"`, `"web"`, `"mobile"`,
     * `"backup"`.
     */
    constructor(master_key: Uint8Array, file_id: string, file_size: bigint, profile: string);
    /**
     * Encrypt one plaintext chunk and return the full wire frame
     * (`nonce(12) || ciphertext || tag(16)`) for JS to PUT directly — no
     * recombination needed on the JS side. Errors if more chunks are pushed
     * than the plan allows.
     */
    pushChunk(plaintext: Uint8Array): Uint8Array;
    /**
     * Resuming an interrupted upload (task 1908 round 3): may this (new)
     * encryptor continue the old server upload session? `storedFormat` = the
     * `format` persisted next to the session id when the session was opened
     * (1 = v1, 2 = v2), or `undefined` if the resume record does not say.
     * Returns `"continue"` (keep the session, re-PUT from chunk 0) only for a
     * v1 session resumed by a v1 encryptor, else `"restart"`: never PUT to the
     * old session again, upload from chunk 0 into a fresh session. Restart =
     * `POST /api/v1/files/{id}/upload/abandon` (or wait for the lease to
     * expire), then init again; on a 409 retry that, never the old session.
     */
    resumePolicy(stored_format?: number | null): string;
    /**
     * Protected metadata values after frame 0 has been emitted. The previous
     * counter is omitted for a new file and supplied for a replacement.
     */
    versionCommitment(previous_counter?: number | null): any;
    /**
     * Create a push-form encryptor with an explicit, server-dictated chunk
     * size. Use this when the v2 upload-init response overrode `chunk_size`
     * so the client plan can't diverge from what the server expects.
     */
    static withChunkSize(master_key: Uint8Array, file_id: string, file_size: bigint, chunk_size_bytes: bigint): WasmChunkEncryptor;
    /**
     * Replace / new version of an EXISTING file (task 1908 round 4, I-1):
     * returns this encryptor writing in the format the file's recorded pin
     * requires. `recordedPin` = the `chunk_format` from
     * `decrypt_file_metadata` (0 = unrecorded, 2 = v2), never a server field.
     * Both supported pins produce v2 output; 0 preserves compatibility with
     * legacy history. Before the first `pushChunk` only; other codes throw. Consumes
     * the old JS object — use the returned one.
     */
    withRecordedPin(recorded_pin: number): WasmChunkEncryptor;
    /**
     * Planned number of chunks for this file.
     */
    readonly chunkCount: number;
    /**
     * Plaintext chunk size in bytes (the last chunk may be smaller). Returned
     * as a JS number (`f64`) to avoid `BigInt` at the boundary.
     */
    readonly chunkSize: number;
    /**
     * How many chunks have been pushed so far.
     */
    readonly chunksEmitted: number;
    /**
     * Expected total ciphertext bytes (`file_size + 28 * chunk_count`), the
     * value the client passes to `upload_init` as the total. Returned as a JS
     * number (`f64`).
     */
    readonly expectedTotalCiphertext: number;
    /**
     * The chunk format this encryptor writes: 2 = v2. Record it at upload via
     * `encrypt_name_with_chunk_format` (2 if this is 2, else 0) so readers
     * can pin it.
     */
    readonly format: number;
}

/**
 * How long a discovery answer is trusted, and whether to ask again: one per API base.
 * `lookup(nowMs)` is `{ kind: "fetch" | "cached" | "use_api", discovery? }`;
 * `record(outcome, body, nowMs)` takes the `classifyDirectAnswer` result and the
 * discovery body (or `null`).
 */
export class WasmDirectDiscoveryCache {
    free(): void;
    [Symbol.dispose](): void;
    lookup(now_ms: number): any;
    constructor();
    record(outcome: any, body: Uint8Array | null | undefined, now_ms: number): void;
}

/**
 * Whether this client may start a direct transfer now, per direction: after a transfer gave up direct,
 * no new one of that direction starts for ten minutes. One per API base and account; feed it
 * `Date.now()` (or a monotonic clock, consistently). `lastGaveUpMs` / `restore` let a client persist the
 * two timestamps. A recorded time later than "now" counts as expired.
 */
export class WasmDirectHealth {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * A transfer of `direction` gave up direct. Throws `direction_invalid` for anything but
     * `"download"` or `"upload"` (as every method here does).
     */
    gaveUp(direction: string, now_ms: number): void;
    /**
     * When the last give-up of `direction` was recorded, or `null`.
     */
    lastGaveUpMs(direction: string): number | undefined;
    /**
     * May a new direct transfer of `direction` start now?
     */
    mayStart(direction: string, now_ms: number): boolean;
    /**
     * As `mayStart`, for a file that may already have given up direct: it never may again (`fileGaveUp`).
     */
    mayStartFile(direction: string, now_ms: number, file_gave_up: boolean): boolean;
    constructor();
    /**
     * Put back a timestamp `lastGaveUpMs` returned earlier.
     */
    restore(direction: string, last_gave_up_ms: number): void;
}

/**
 * The download planner for ONE file: when to ask the API for a window of
 * links, which chunk to fetch next (at most 4 in flight, in order), when to
 * renew a link, and when a chunk goes to the pinned API route. It performs no
 * I/O and holds no clock: pass `Date.now()` as `nowMs` on every call.
 *
 * Drive it from one place:
 *
 * ```js
 * const p = new WasmDownloadPlanner(discovery, apiBase, fileId, seed)
 * for (;;) {
 *   const w = p.poll(Date.now())
 *   switch (w.kind) {
 *     case "request_window": // POST, then windowAnswered(body) or windowFailed(outcome)
 *       break
 *     case "fetch": // GET w.url.raw() (w.url is a WasmSignedUrl, not a string), then fetchOk(w.index) or fetchFailed(w.index)
 *       break
 *     case "fetch_via_api": // pinned route, then fetchOk or apiFetchFailed
 *       break
 *     case "wait": // sleep until w.until_ms or until a request returns
 *       break
 *     case "done": return
 *     case "stop": return // discard partial output and act on w.verdict.kind
 *   }
 *   // chunks are decrypted IN ORDER: after each, consumed(index); if one does
 *   // not authenticate, chunkUnauthentic(index)
 * }
 * ```
 */
export class WasmDownloadPlanner {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * The pinned API route failed for chunk `index` after the caller's own retries.
     */
    apiFetchFailed(index: number): void;
    /**
     * The ciphertext length of chunk `index` once the first window was accepted, else `null`.
     * The link's `length` is this number; the caller checks a storage answer against it.
     */
    chunkLength(index: number): number | null;
    /**
     * Chunk `index` arrived but did not authenticate when decrypted.
     */
    chunkUnauthentic(index: number): void;
    /**
     * Chunk `index` has been decrypted and written. Strictly in order.
     */
    consumed(index: number): void;
    /**
     * Chunks decrypted and written so far.
     */
    consumedCount(): number;
    /**
     * The transfer of chunk `index` from storage failed (any non-200, a short
     * body, a wrong length, a network error, an expired link).
     */
    fetchFailed(index: number, now_ms: number): void;
    /**
     * Chunk `index` arrived whole (status 200 and the right length).
     */
    fetchOk(index: number): void;
    /**
     * `{ chunk_count, chunk_size, encrypted_size, original_size }` once the
     * first window was accepted, else `null`.
     */
    geometry(): any;
    /**
     * Chunk requests (storage or API) currently outstanding.
     */
    inFlight(): number;
    /**
     * `discovery` is the object `parseDirectDiscovery` returned; `jitter_seed` is any number.
     * The seed is the number's IEEE-754 bits (`f64::to_bits`): `Math.random()` is fine, every
     * distinct number is a distinct seed (so two tabs do not share a retry schedule), the same
     * number repeats its schedule, and `0` and `-0` are two seeds. It is not a secret.
     */
    constructor(discovery: any, api_base: string, file_id: string, jitter_seed: number);
    /**
     * The pinned `object_version_id`, or `null` before the first window.
     */
    pinnedVersion(): string | undefined;
    /**
     * What to do now: a `DirectPoll` (`{ kind, ... }`, see the class docs). For `kind: "fetch"` the
     * `url` is a `WasmSignedUrl`, not a string: pass `url.raw()` to `fetch` and nothing else.
     */
    poll(now_ms: number): DirectPoll;
    /**
     * Cap the ciphertext bytes held at once (fetching, or fetched and waiting to be decrypted in order):
     * the planner then holds `clamp(floor(bytes / (chunk_size + 28)), 1, 4)` chunks, so 64 MiB holds four
     * chunks of 4 MiB but one of 256 MiB. Call it before the first `poll`. Throws `bytes_invalid` for a
     * number that is not a whole, non-negative byte count.
     */
    setMaxInFlightBytes(bytes: number): void;
    /**
     * Did the storage breaker trip? It does when a chunk used up its renewals and no chunk of this
     * transfer has come whole from storage: from then on every remaining chunk is a `fetch_via_api` poll.
     * When the file ends with this `true`, tell `WasmDirectHealth.gaveUp("download", nowMs)`.
     */
    storageGivenUp(): boolean;
    /**
     * The window answer for the outstanding request, as the raw response body
     * (`Uint8Array`). Returns `"accepted"`, `"malformed"` (the body is not the
     * contract's JSON; handled like any window the server could not serve), or
     * the code of the contract violation (`transport`, `file_mismatch`,
     * `version_changed`, `geometry`, `grants`, `length`, `method`,
     * `authority_<refusal>`, `expiry`, `unexpected`). It never throws: poll
     * again.
     */
    windowAnswered(body: Uint8Array, now_ms: number): string;
    /**
     * The window request failed. `outcome` is what `classifyDirectAnswer`
     * returned for the answer (or `{ kind: "use_api_now" }` for a network
     * error).
     */
    windowFailed(outcome: any, now_ms: number): void;
    /**
     * A 2xx window response whose body could not be decoded at all.
     */
    windowMalformed(): void;
}

/**
 * A plan from `WasmArchiveSession.plan`, for `startExtraction` and the
 * preview.
 */
export class WasmExtractionPlan {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * The plan as data: `{target, nodes, skipped, renamed, totals, notices}`.
     */
    view(): any;
    /**
     * `"planned"`, to tell it from a refusal.
     */
    readonly kind: string;
}

/**
 * The new device's side of a link. Send `publicFields().session_id`,
 * `public_key` and `device_name` (the canonical form) to `start_device_link`;
 * render `qr_payload` as the QR and show `typedCode()` next to it.
 */
export class WasmNewDeviceLink {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Typed-code path: answer the approver's message (relayed under role
     * `approver`). Relay the receiver's `message` under role `new_device`,
     * then open the approval with it. The attempt consumes this link.
     */
    answerTypedCode(approver_message: Uint8Array): WasmTypedReceiver;
    constructor(session_id: Uint8Array, device_name: string);
    /**
     * QR path: open the approval relayed for this link. The link supplies its
     * own session id and public key; the attempt consumes it.
     */
    open(approver_public: Uint8Array, nonce: Uint8Array, ciphertext: Uint8Array): WasmAccountKeyMaterial;
    publicFields(): any;
    typedCode(): string;
}

/**
 * An opaque new-item id minted by core for one master key (task 2275, L13).
 *
 * There is no constructor from text and no export that turns arbitrary id text
 * into a sealer input: a new-item write can only use an id core minted (or
 * resumed from a persisted id + tag) for this master key. `idText` is the wire
 * form; `tag` is the resume tag to persist with the upload session.
 */
export class WasmNewItemId {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * The canonical id text to send on the wire.
     */
    readonly idText: string;
    /**
     * The resume tag to persist with the upload session (32 bytes).
     */
    readonly tag: Uint8Array;
}

/**
 * A request row's decrypt-only content reader (task 2275 §15; 2326 delta2
 * P2-2). It owns a copy of the row's content key `C`, bound to the row's file
 * id and recorded chunk-format pin; the key is zeroized when the reader drops
 * and no getter exposes it.
 *
 * `decryptor()` returns a FRESH sequential [`WasmChunkDecryptor`] at chunk 0
 * on every call (retry after a mid-stream error); `openFrame(...)` opens ONE
 * frame by index for a seek / range read.
 */
export class WasmRequestContentReader {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * A FRESH sequential decryptor at chunk 0. Call again after any error.
     *
     * Retry contract: discard EVERYTHING the failed attempt produced; never
     * splice attempt 1's prefix with attempt 2's suffix (after a replace that
     * splices two uploads of one id). The failed cursor is not poisoned
     * (`open_next` does not advance `next_index` on an error), but the output
     * must still be rebuilt from frame 0.
     */
    decryptor(): WasmChunkDecryptor;
    /**
     * Open ONE content frame at `index` without the frames before it (seek /
     * range read). `isLast = index == chunkCount - 1`. `format` (1 = v1,
     * 2 = v2) and `versionId` (12 bytes, v2 only) must come from authenticated
     * data. When the row is pinned to v2, `format: 1` is refused.
     */
    openFrame(version_id: Uint8Array, index: number, is_last: boolean, format: number, frame: Uint8Array): Uint8Array;
    /**
     * The row's recorded chunk-format pin: 0 = unrecorded, 2 = v2.
     */
    readonly chunkFormat: number;
    /**
     * The file id every frame of this row must be bound to.
     */
    readonly fileId: string;
}

/**
 * A stateful, client-side search index over a vault's file names.
 *
 * Build it from a file list, mutate it incrementally (`upsert`/`remove` return
 * the dirty bucket set as a `Uint32Array`), query it (returns a `string[]` of
 * file_ids), and (de)serialize it to encrypted shards for sync. The master key
 * crosses as 32 raw bytes; crypto runs in core.
 */
export class WasmSearchIndex {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Build from `files` — a JS array of `{ fileId, name }` objects.
     */
    static build(files: any, num_shards: number): WasmSearchIndex;
    /**
     * Encrypt only the given buckets (incremental sync) — pass the dirty set.
     */
    encryptBuckets(master_key: Uint8Array, buckets: Uint32Array): any;
    /**
     * Encrypt only the given buckets under the folder key (incremental sync).
     */
    encryptBucketsWithFolderKey(folder_key: Uint8Array, buckets: Uint32Array): any;
    /**
     * Encrypt every non-empty shard page → `[{bucket, page, blob: Uint8Array}]`.
     */
    encryptShards(master_key: Uint8Array): any;
    /**
     * Encrypt every non-empty shard page under the folder key.
     */
    encryptShardsWithFolderKey(folder_key: Uint8Array): any;
    /**
     * Reconstruct from encrypted shards (`[{bucket, page, blob: Uint8Array}]`),
     * decrypting each with the 32-byte master key.
     */
    static fromEncryptedShards(master_key: Uint8Array, shards: any, num_shards: number): WasmSearchIndex;
    /**
     * Reconstruct a shared folder's index from shards sealed under the folder
     * key (`encryptShardsWithFolderKey` output).
     */
    static fromEncryptedShardsWithFolderKey(folder_key: Uint8Array, shards: any, num_shards: number): WasmSearchIndex;
    /**
     * Empty index with 1–64 shards (zero is clamped to 1).
     */
    constructor(num_shards: number);
    /**
     * Search; returns the matching file_ids as a `string[]`.
     */
    query(term: string): string[];
    /**
     * Remove a file. Returns the dirty bucket set (`Uint32Array`).
     */
    remove(file_id: string): Uint32Array;
    /**
     * Insert or update a file. Returns the dirty bucket set (`Uint32Array`).
     */
    upsert(file_id: string, name: string): Uint32Array;
    /**
     * Number of indexed files.
     */
    readonly fileCount: number;
    /**
     * Shard count this index uses.
     */
    readonly numShards: number;
}

/**
 * A presigned storage link as the `fetch` step carries it: a bearer capability until it expires. It
 * is an object, not a string, so that `console.log`, `String(url)`, a template literal and
 * `JSON.stringify(step)` can never show it: all of them give the redacted form (scheme and host).
 * The only way to the link is `raw()`, by name.
 */
export class WasmSignedUrl {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * The full presigned link, to hand to `fetch`. Never log it.
     */
    raw(): string;
    /**
     * Scheme and host only: safe for a log line.
     */
    redacted(): string;
    /**
     * `JSON.stringify(step)`.
     */
    toJSON(): string;
    /**
     * `String(url)` and template literals.
     */
    toString(): string;
}

/**
 * The signup ceremony state machine, one per signup attempt.
 *
 * Holds the password, the master key (12 words) and the key derived from it inside WASM
 * memory in zeroizing buffers. Call `abandon()` when the flow is left (back,
 * cancel, error): freeing the object or waiting for garbage collection wipes
 * it too, but on the finalizer's schedule, which can be much later. See `beebeeb_core::onboarding::ceremony` for the rules.
 * Call order is enforced there: `startRegistration` fails until every other
 * required step is done.
 */
export class WasmSignupCeremony {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Abandon the signup: wipe the password, phrase and master key and return
     * to a fresh ceremony. Call on back, cancel and error exits.
     */
    abandon(): void;
    /**
     * The server accepted `register-finish`. Returns the 32-byte master key as
     * `Uint8Array`; the caller owns it and must wipe it when done (the same
     * contract as `generate_recovery_phrase`). The ceremony wipes the rest.
     * The only Rust-side copy of the key is a `Zeroizing` temporary that is
     * wiped as soon as the bytes have been copied into the JS array.
     */
    accountCreated(): Uint8Array;
    /**
     * The user confirms they saved the phrase.
     */
    acknowledgePhrase(): void;
    /**
     * Take an existing master key instead of generating one; counts as confirmed.
     * Throws `crypto` for an invalid phrase, `invalid_state` once confirmed or registering.
     */
    adoptPhrase(phrase: string): void;
    /**
     * Generate the master key (12 words) and the key derived from it (Argon2id, about a second).
     * Idempotent.
     */
    beginPhrase(): void;
    /**
     * The canonical order of the pre-account ceremony (master key first, then the password), as
     * `[{ step, spec_step_id }]`. Same as the order `pendingSteps` lists in.
     */
    static ceremonyStepOrder(): any;
    /**
     * 1-based word positions to ask for, ascending, stable for this phrase.
     */
    challengePositions(): Uint32Array;
    /**
     * `answers`: array of strings in `challengePositions` order. Throws
     * `phrase_word_mismatch` / `phrase_answer_count`; retryable.
     */
    confirmPhrase(answers: Array<any>): void;
    /**
     * The user changed the email address after it was verified: back to the
     * code step, password and confirmed phrase kept.
     */
    emailChanged(): void;
    /**
     * The server reported the signup ticket expired: back to the code step,
     * password and confirmed phrase kept.
     */
    emailTicketInvalidated(): void;
    /**
     * The server accepted the email code.
     */
    emailVerified(): void;
    /**
     * OPAQUE step 2, from the server's `register-start` response. Returns
     * `{ upload, x25519_public, recovery_check }` (all `Uint8Array`).
     */
    finishRegistration(server_message: Uint8Array): any;
    /**
     * `min_length` = `policy.password.min_length`; `email_verification_required`
     * = the document lists a required `verify_email_code`; `verify_word_count`
     * = `policy.recovery_phrase.verify_word_count`; `breach_check_required` =
     * the document declares a breach check, with `breach_fail_open` =
     * `policy.password.breach_check.fail_open` (applied by the ceremony, not
     * by the caller).
     */
    constructor(min_length: number, email_verification_required: boolean, verify_word_count: number, breach_check_required: boolean, breach_fail_open: boolean);
    /**
     * Every pending step in canonical order, as `[{ step, spec_step_id }]`.
     */
    pendingSteps(): any;
    /**
     * The phrase to show. Throws `phrase_unavailable` before `beginPhrase` or
     * after the phrase was confirmed (it is wiped then). The returned string
     * is a plain copy that lives in JS and cannot be wiped: call this only
     * while rendering the phrase and drop the reference afterwards.
     */
    phrase(): string;
    /**
     * The server rejected `register-finish` in a retryable way.
     */
    registrationFailed(): void;
    /**
     * Validate and store the password. `breach_check` is the
     * `WasmBreachCheck` made for **this** password, after `evaluate` recorded
     * the endpoint's answer. It is only borrowed: after a rejection the same
     * check can be passed again. Throws an `Error` whose `code` is
     * `password_mismatch`, `password_too_short`, `breach_check_missing`,
     * `breach_check_stale`, `password_breached` or `breach_check_blocked`.
     * Returns the password evaluation (same shape as `evaluate_password`).
     */
    setPassword(password: string, confirmation: string, breach_check: WasmBreachCheck): any;
    /**
     * `setPassword` for a document that declares no breach check. If the
     * ceremony was constructed with `breachCheckRequired = true` this throws
     * `breach_check_missing`: omitting the check cannot bypass the gate.
     */
    setPasswordUnchecked(password: string, confirmation: string): any;
    /**
     * OPAQUE step 1. Returns the `RegistrationRequest` bytes for
     * `opaque/register-start`. Throws `step_not_done` until every other
     * required step is done.
     */
    startRegistration(): Uint8Array;
    /**
     * First pending step: `{ step, spec_step_id }`.
     */
    step(): any;
}

/**
 * A storage GET's body as the bytes arrive, counted in core so no client counts its own.
 * `WasmStorageBody.fromHead(status, contentLength, expected)` starts it; `push(n)` counts the bytes
 * read and throws as soon as they would pass the grant; `finish()` gives `{ kind: "stored" }` or
 * `{ kind: "failed", status: 200 }` and consumes the handle. Every count crosses as a JS number.
 * Because `finish()` takes the handle by value, a JS `push` after `finish` throws wasm-bindgen's
 * moved-value error, which has no `code` (the count was consumed; there is nothing left to count).
 */
export class WasmStorageBody {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * The body's answer; the handle is consumed.
     */
    finish(): DirectStorageGet;
    /**
     * Start counting. `status` is the head's HTTP status and must be a whole number that fits a
     * `u16`; `content_length` is the head's `Content-Length` (or `null`). Throws `status_invalid`
     * for a status that is not one, and `failed` (with its `status`) when the head is not a `200`
     * whose length is exactly `expected`.
     */
    static fromHead(status: number, content_length: number | null | undefined, expected: number): WasmStorageBody;
    /**
     * Count `n` more bytes read. Throws `failed` (with its `status`) as soon as they would pass
     * `expected`, so the caller stops reading.
     */
    push(n: number): void;
}

/**
 * The approver's side of a typed-code attempt, for a browser without a camera.
 * Construct it with the code the person typed and the link detail's
 * `session_id` and `device_name`; relay `message` under role `approver`; pass
 * the new device's answer to `confirm`, and only then `seal`. Show
 * `deviceName` while the person types: `confirm` proves the new device
 * reported it.
 */
export class WasmTypedApproval {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Check the new device's answer (relayed under role `new_device`). Throws
     * `confirmation_failed` for a wrong code or a changed device name, and
     * `malformed_answer` for anything that is not an answer; the attempt is
     * spent either way, so deny the link and start again.
     */
    confirm(new_device_message: Uint8Array): void;
    constructor(typed_code: string, session_id: Uint8Array, device_name: string);
    /**
     * Seal the account key for the confirmed new device: `{ nonce, ciphertext }`
     * for `approve_device_link` (with no `approver_public`). Throws before
     * `confirm` succeeded.
     */
    seal(master_key: Uint8Array): any;
    readonly deviceName: string;
    /**
     * The message to relay under role `approver`.
     */
    readonly message: Uint8Array;
}

/**
 * The new device after it answered a typed-code attempt.
 */
export class WasmTypedReceiver {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Open the relayed typed-code approval (`nonce`, `ciphertext` from the
     * link result). The approver's tag is checked first; one attempt.
     */
    open(nonce: Uint8Array, ciphertext: Uint8Array): WasmAccountKeyMaterial;
    /**
     * The message to relay under role `new_device`.
     */
    readonly message: Uint8Array;
}

/**
 * An opaque write target issued by `resolveOwnedKey` (task 2275, L13).
 *
 * A replacement is sealed through this handle only: the id, the key and the
 * chunk-format pin all come from core's resolution, so a caller cannot point a
 * write at another row or drop a recorded v2 pin.
 */
export class WasmWriteTarget {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * The row id the write must target.
     */
    readonly itemId: string;
    /**
     * The chunk-format pin the write must keep (0 = unrecorded, 2 = v2).
     */
    readonly pin: number;
    readonly versionCounter: number | undefined;
    readonly versionId: Uint8Array | undefined;
}

export function answerSessionKeyProof(master_key: Uint8Array, nonce: Uint8Array, server_public: Uint8Array, session_id: Uint8Array, account_id: Uint8Array): Uint8Array;

export function apiDescriptor(name: string, id?: string | null): any;

/**
 * A count as the archive words show it (`1,234`).
 */
export function archiveCountLabel(n: bigint): string;

/**
 * The archive/extract rule: [`path_safety::archive_component`], the portable
 * sanitizer above. Named for the caller that extracts entries, so the intent is
 * on the call site; it never drops a name silently.
 */
export function archiveEntryName(name: string): string;

/**
 * A size as the archive words show it (`3.4 MB`).
 */
export function archiveSizeLabel(bytes: bigint): string;

/**
 * Core's words for `key` with `args` (`{name: value}`, values already
 * formatted): `{key, text, args}`. An unknown key throws.
 */
export function archiveText(key: string, args: any): any;

/**
 * The action every stopped backup offers: `"Back up again"`.
 */
export function backupAgainAction(): string;

/**
 * The app rule (spec Amendment 8): the words to show when `mutation` of a row
 * at `position` (`"root" | "device_folder" | "manifest" | "category_folder" |
 * "inside" | "outside"`, from `backupPositionAtDepth`; for `"create"`, the
 * folder the new item goes into) is refused, or `undefined`. A move checks
 * the row with `"move"` and the destination folder with `"create"`.
 */
export function backupCheckAppMutation(position: string, mutation: string): string | undefined;

/**
 * The drive rule (Explorer, Finder, the iOS Files app), with the same words:
 * nothing at or under the root is changed in a drive surface. `undefined`
 * when allowed. `ownActiveSource`: the original's path when the row is this
 * device's own backup of a folder still being backed up.
 */
export function backupCheckDriveMutation(position: string, own_active_source: string | null | undefined, mutation: string): string | undefined;

/**
 * The words when the notices could not be read: "Couldn't check — will
 * retry."
 */
export function backupCheckFailedWords(): string;

/**
 * The server's root rule: the words to show when `mutation` (`"trash" |
 * "delete" | "rename" | "move" | "create" | "write"`) of a row with `role` is
 * refused, or `undefined` when it is allowed. Only the root's trash, delete,
 * rename and move are refused; the web's own views use
 * `backupCheckAppMutation`.
 */
export function backupCheckRootMutation(role: string | null | undefined, mutation: string): string | undefined;

/**
 * The `lastPassAtMs` of a device with none under this engine yet (spec
 * Amendment 12c): `setupAtMs`, the moment backups were set up on this device,
 * or `legacyLastBackupMs`, an upgraded device's last successful backup under
 * the old engine; with both, the earlier; with neither, 0 (any removal notice
 * stops the backup). Both on the server's clock; a value that is not a whole
 * number of milliseconds throws.
 */
export function backupFirstPassBaseline(setup_at_ms?: number | null, legacy_last_backup_ms?: number | null): number;

/**
 * `true` for a row no listing ever shows (a device folder's `.device.json`);
 * `depth` and `name` as for `backupPositionAtDepth`.
 */
export function backupIsHiddenItem(depth: number | null | undefined, name: string): boolean;

/**
 * How far before `lastPassAtMs` a notice still counts, in milliseconds:
 * 600000 (10 minutes). A notice's `created_at` is the start of the server
 * transaction that wrote it, not its commit.
 */
export function backupNoticeOverlapMs(): number;

/**
 * The reason a `notifications` row (`type`, `data`) gives, or `undefined` for
 * a row that is not a backup notice: to show the notification with
 * `backupStopWords`. A removal whose reason this build does not know is
 * `"unknown_removal"` (its own words, never the "deleted" ones).
 */
export function backupNoticeReason(kind: string, data: any): string | undefined;

/**
 * The `since` to send to `GET /api/v1/notifications` (integer milliseconds,
 * inclusive): `lastPassAtMs` minus the overlap, never below 0. A value that
 * is not a whole number of milliseconds throws.
 */
export function backupNoticesSince(last_pass_at_ms: number): number;

/**
 * Parse a decrypted `.device.json` into a plain object: the known fields and
 * every unknown one, as core keeps them.
 */
export function backupParseManifest(json: string): any;

/**
 * What one pass does before it uploads anything (spec Amendments 12, 12c):
 * `{outcome: "run", stopped: [{category, reason}]}` when the notices were
 * read (as `backupStop`), or `{outcome: "check_failed"}` when
 * `noticesFetchOk` is false (a server or network error, or a page missing):
 * upload nothing, turn nothing off, show `backupCheckFailedWords()`, retry at
 * the next scheduled pass, and keep `lastPassAtMs` where it was. `notices`
 * is not read when the fetch failed.
 *
 * Superseded by `backupPassGateV2` (spec Amendment 12d), for the reason
 * given on `backupStop`. Kept unchanged for v0.2.3 callers.
 */
export function backupPassGate(notices_fetch_ok: boolean, notices: any, last_pass_at_ms: number, listing: any): any;

/**
 * What one pass does before it uploads anything (spec Amendments 12, 12c,
 * 12d): `{outcome: "run", stopped, acknowledged}` when the notices were read
 * (as `backupStopV2`), or `{outcome: "check_failed"}` when `noticesFetchOk`
 * is false: upload nothing, turn nothing off, show `backupCheckFailedWords()`,
 * retry at the next scheduled pass, and keep both `lastPassAtMs` and the
 * acknowledged set. `notices` is not read when the fetch failed.
 */
export function backupPassGateV2(notices_fetch_ok: boolean, notices: any, last_pass_at_ms: number, acknowledged: any, listing: any): any;

/**
 * The position of the row `name`, `depth` folders below the flagged root
 * (`null` or `undefined`: not under it): `"outside"`, `"root"` (0),
 * `"device_folder"` (1), `"manifest"` (2, a device folder's `.device.json`),
 * `"category_folder"` (2) or `"inside"` (3 or more).
 */
export function backupPositionAtDepth(depth: number | null | undefined, name: string): string;

/**
 * One byte per row of a listing (its `system_role`, `""` for none): 1 when
 * the row is the protected root (no trash, delete, rename or move), else 0. A role this
 * build does not know is protected (1), never an error: it fails safe, and the
 * rest of the listing still renders.
 */
export function backupProtectionMany(roles: string[]): Uint8Array;

/**
 * The badge every client shows on the Backups root (`"Read-only"`).
 */
export function backupRootBadge(): string;

/**
 * Which backups turn off on this pass, and why (spec Amendment 12, steps
 * 1-4): `[{category, reason}]` in category key order, empty when nothing
 * changes. `notices`: the `notifications` rows (`{type, data,
 * created_at_ms}`); a row that is not a backup notice is skipped whatever its
 * shape, and a backup notice without a whole `created_at_ms` throws. `lastPassAtMs`: on the
 * server's clock, when this device's previous pass started, or when the
 * person last turned a backup on or chose "Back up again" since. `listing`:
 * `{device_folder_id, device_folder_live, folders: [{category,
 * category_folder_id, category_folder_live}]}`. An unknown category key or an
 * id that is not a UUID throws.
 *
 * Superseded by `backupStopV2` (spec Amendment 12d): this strict filter
 * misses a notice whose server transaction was still open when the previous
 * pass read the notices. Kept unchanged for v0.2.3 callers.
 */
export function backupStop(notices: any, last_pass_at_ms: number, listing: any): any;

/**
 * Which backups turn off on this pass, and why (spec Amendments 12 and
 * 12d): `{stopped: [{category, reason}], acknowledged: [id]}`. A notice
 * counts when its `created_at_ms` is after `lastPassAtMs` minus the overlap
 * and its `id` is not in `acknowledged` (the ids the previous pass returned;
 * empty on a first pass). `acknowledged` in the answer replaces the stored
 * set: store it with the stops and the new `lastPassAtMs`, and keep it when
 * the person chooses "Back up again". `notices`: the rows (`{id, type, data,
 * created_at_ms}`) from `backupNoticesSince(lastPassAtMs)` on, read as for
 * `backupStop`; `listing` as for `backupStop`.
 */
export function backupStopV2(notices: any, last_pass_at_ms: number, acknowledged: any, listing: any): any;

/**
 * The words a stopped backup shows (spec Amendment 12), followed by the
 * action `backupAgainAction()`. `device` is the device's name and `folder`
 * the folder's display name; the four account-wide reasons name neither. An
 * unknown reason throws.
 */
export function backupStopWords(reason: string, device: string, folder: string): string;

/**
 * Build `{app_url}/{s|f}/{token}#key={key}`. `route` is `"s"` (the default
 * when omitted or `null`) or `"f"`.
 */
export function buildShareLink(app_url: string, token: string, key: string, route?: string | null): string;

/**
 * Check one server-provided name (a single component, never a path).
 *
 * `portable` selects the strict cross-platform rule set (what a pulled tree or
 * an archive must satisfy); `windows` says the caller will write it with
 * Windows path semantics. Returns normally when the name is safe, throws the
 * user-facing reason otherwise (e.g. `contains a path separator`).
 */
export function checkPathComponent(name: string, portable: boolean, windows: boolean): void;

/**
 * Was the body a storage GET actually delivered the chunk? Same answer shape as
 * `checkStorageGet`, but decided by the counted bytes: `stored` only when `received` is
 * exactly `expected`. `Content-Length` is only the head; a truncated stream ends short.
 */
export function checkStorageBody(received: number, expected: number): DirectStorageGet;

/**
 * Was a storage GET answer the chunk we asked for? `{ kind: "stored" }` or
 * `{ kind: "failed", status }`; a caller with no HTTP answer passes status `0` (exactly what
 * `WasmStorageBody.fromHead` reports for it). Only a `200` whose `Content-Length` is exactly
 * `expected` is `stored`.
 * `status` crosses as a JS number and is validated exactly as `WasmStorageBody.fromHead` validates
 * it: a whole number in `0..=65535`, else `status_invalid`. `undefined` is not a number and throws
 * `status_invalid` too, so a caller cannot omit the answer it means to report.
 */
export function checkStorageGet(status: number, content_length: number | null | undefined, expected: number): DirectStorageGet;

/**
 * May the client follow this storage link? Throws an `Error` whose `code` is
 * the refusal (`malformed`, `not_https`, `userinfo`, `ip_literal`, `loopback`,
 * `bad_host`, `port`, `host_not_listed`, `bucket_not_listed`, `bad_path`); the
 * message never contains the URL. `discovery` is the object
 * `parseDirectDiscovery` returned; `api_base` is the API origin in use.
 */
export function checkStorageUrl(url: string, discovery: any, api_base: string): void;

/**
 * L14: does this row's L7 wrap open to exactly `expectedKey`?
 */
export function childWrapMatches(folder_key: Uint8Array, shared_folder_id: string, item_id: string, kind: number, wrapped: Uint8Array, expected_key: Uint8Array): boolean;

/**
 * What an API answer means, as `{ kind, millis?, status?, error? }` with `kind`
 * one of `proceed`, `not_supported`, `use_api_now`, `api_for_this_file`
 * (for an UPLOAD call: this session cannot go direct, so abandon it and init again WITHOUT the
 * capability token),
 * `restart`, `backoff` (with `millis`), `terminal` (with `status`, `error`),
 * `retry` (the pinned chunk route and the upload calls: a failure that may pass; the retry rules of
 * the pinned route are `pinnedRetryDecision`, those of an upload are core's `UploadChunkState`, which is
 * not exported yet, so do not pass an upload outcome to `pinnedRetryDecision`), `regrant`
 * (`upload_commit` only: the staged chunk is not there, ask for a new link and send it again), `held`
 * (`upload_commit` only: the server holds the chunk's commit lock, possibly for minutes: wait and
 * commit again, `millis` is the server's stated wait or null). core's `UploadChunkState` gives a hold an
 * allowance of its own (the lock TTL, 420 s, plus 30 s; never polling faster than once a second), but it
 * is not exported yet: a host that handles `held` itself must bound the wait the same way (at least the
 * server's lock TTL, or it abandons a chunk whose commit would have gone through), poll no faster than
 * once a second, and not count a hold as one of its failures.
 * `call` is `"discovery"`, `"download_grant"`, `"pinned_chunk"`, `"upload_grant"` or
 * `"upload_commit"`; pass `status` 0 when there was
 * no HTTP answer. `body` is whatever was read of the body (at most 64 KiB is
 * looked at); `retry_after` is the raw header value.
 */
export function classifyDirectAnswer(call: string, status: number, content_type: string | null | undefined, body: Uint8Array, retry_after?: string | null): any;

/**
 * Combine a folder link's fragment key `K_c` with an optional 32-byte
 * passphrase stretch (task 2237b). Pass `undefined`/`null` for a link without
 * a passphrase. Returns a 32-byte `Uint8Array`: the key that unwraps the
 * link's sealed folder key. Never send the result or `K_c` to the server.
 */
export function combineFolderLinkKey(k_c: Uint8Array, passphrase_stretch?: Uint8Array | null): Uint8Array;

/**
 * Compute recovery check from master key. Returns 32-byte `Uint8Array`.
 */
export function compute_recovery_check(master_key: Uint8Array): Uint8Array;

/**
 * Decode any accepted stored form of the metadata envelope.
 *
 * Throws an `Error` whose message starts with `invalid input:` — the core
 * error's own text — for invalid JSON, a missing/non-byte field, an unknown
 * cipher suite, or a `null` field. Fields core does not know are ignored.
 */
export function decodeMetadataEnvelope(payload: string): any;

/**
 * Decrypt a ciphertext chunk that was produced by `encrypt_chunk`.
 * `key`, `nonce`, and `ciphertext` are raw byte slices.
 *
 * Generic no-AAD AEAD open (key unwrap, share keys, v1 blobs). It does NOT
 * open v2 file-content frames — use `WasmChunkDecryptor` (sequential) or
 * `decrypt_chunk_frame` (random access) for file content (task 1908).
 */
export function decrypt_chunk(key: Uint8Array, nonce: Uint8Array, ciphertext: Uint8Array): Uint8Array;

/**
 * Random-access open of ONE file-content frame at a known position (seeking
 * readers: video, range previews). `index` is the chunk requested and
 * `is_last = index == chunk_count - 1`; a server that serves another chunk or
 * lies about the count fails the tag. `metadata` is what
 * `decrypt_file_metadata` returned for this version, never a server field:
 * with a version commitment only that upload's v2 frames open; a record
 * without one opens v1 frames only, and a `chunk_format: 2` record without
 * one is refused (the ruling of 2026-11-07).
 */
export function decrypt_chunk_frame(file_key: Uint8Array, file_id: string, metadata: any, index: number, is_last: boolean, frame: Uint8Array): Uint8Array;

/**
 * Decrypt a sequence of encrypted chunks and return the concatenated plaintext.
 * Each chunk is a JS object `{ nonce: Uint8Array, ciphertext: Uint8Array }`.
 * Returns the full plaintext as `Uint8Array`.
 */
export function decrypt_chunks(key: Uint8Array, chunks: any): Uint8Array;

/**
 * The metadata reader for FILES (task 1908 round 3): exactly
 * [`decrypt_name_metadata`], except that a plaintext (non-JSON)
 * `name_encrypted` is refused — a plaintext name carries no chunk-format pin.
 * Take every file-content reader's `chunk_format` from THIS;
 * `decrypt_name_metadata` stays for folders / display.
 */
export function decrypt_file_metadata(master_key: Uint8Array, file_id: string, name_encrypted: string): any;

/**
 * [`decrypt_file_metadata`] with an already-unwrapped 32-byte file key.
 */
export function decrypt_file_metadata_with_key(file_key: Uint8Array, name_encrypted: string): any;

/**
 * Decrypt a metadata blob back to a UTF-8 string.
 */
export function decrypt_metadata(key: Uint8Array, nonce: Uint8Array, ciphertext: Uint8Array): string;

/**
 * Decrypt a `name_encrypted` envelope (same format/key matrix as core
 * `decrypt_name`) into `{ name, mime_type, chunk_format }`. `chunk_format`
 * (0 = unrecorded, 2 = v2) is what every content reader of the file must be
 * given — task 1908.
 */
export function decrypt_name_metadata(master_key: Uint8Array, file_id: string, name_encrypted: string): any;

/**
 * [`decrypt_name_metadata`] with an already-unwrapped 32-byte file key (share
 * / shared-link recipients, file-request content keys).
 */
export function decrypt_name_metadata_with_key(file_key: Uint8Array, name_encrypted: string): any;

/**
 * Batch-decrypt file names in ONE WASM call (task 0806 — folder-load perf).
 *
 * `items` is a JS array of `{ fileId: string, nameEncrypted: string }`.
 * `master_key` is the 32 raw bytes. Returns a JS array (same order + length as
 * `items`) of `{ name: string|null, mimeType: string|null, error: string|null }`
 * — `name` set on success, `error` set on failure (bad blob / unparseable
 * fileId / wrong key). One bad item never fails the batch. Mirrors core
 * `decrypt_names` (string-UUID then legacy binary-UUID key attempt).
 */
export function decrypt_names(master_key: Uint8Array, items: any): any;

/**
 * Open a `note_encrypted` envelope: the note subkey first, then the legacy
 * raw file key (notes stored before the switch). A plaintext value is an
 * error. The ONLY way to open a note — not `decryptFilename`.
 */
export function decrypt_note(file_key: Uint8Array, note_encrypted: string): string;

/**
 * Open a thumbnail frame: the thumbnail subkey first, then the legacy raw
 * file key (thumbnails stored before the switch).
 */
export function decrypt_thumbnail(file_key: Uint8Array, frame: Uint8Array): Uint8Array;

/**
 * Stretch a folder-link passphrase (Argon2id over the canonical NFC form,
 * token-bound salt). Refuses an empty passphrase. Pass the result to
 * `combineFolderLinkKey`; never send it to the server.
 */
export function deriveFolderLinkPassphraseStretch(passphrase: string, token: string): Uint8Array;

/**
 * Derive one bucket key of a shared folder's encrypted search index (task
 * 2237b): `HKDF-SHA256(ikm = folder key, salt = none, info =
 * "beebeeb-shared-folder-index-v1" || bucket as u32 LE)`. Returns a 32-byte
 * `Uint8Array`. `bucket` must be below the index's shard count (64 in the
 * standard layout); values of 64 or more are rejected here.
 */
export function deriveSharedFolderIndexKey(folder_key: Uint8Array, bucket: number): Uint8Array;

/**
 * Derive a per-file encryption key from a master key and file ID via
 * HKDF-SHA256. Both `master_key` and `file_id` are raw byte slices.
 * Returns the 32-byte file key as `Uint8Array`.
 */
export function derive_file_key(master_key: Uint8Array, file_id: Uint8Array): Uint8Array;

/**
 * Derive a 32-byte master key from a password and salt (>= 16 bytes) via
 * Argon2id. Returns a JS object `{ key: Uint8Array }`.
 */
export function derive_master_key(password: string, salt: Uint8Array): any;

/**
 * Derive the per-request private-key-wrapping key from the owner's master key.
 * `master_key` is 32 bytes, `request_id` is arbitrary bytes. Returns 32-byte `Uint8Array`.
 */
export function derive_request_wrap_key(master_key: Uint8Array, request_id: Uint8Array): Uint8Array;

/**
 * Derive a share key from a shared secret + file ID. Returns 32-byte `Uint8Array`.
 */
export function derive_share_key(shared_secret: Uint8Array, file_id: Uint8Array): Uint8Array;

/**
 * Derive X25519 signing key from master key. Returns 32-byte `Uint8Array`.
 */
export function derive_x25519_private(master_key: Uint8Array): Uint8Array;

/**
 * Derive X25519 verification key from signing key. Returns 32-byte `Uint8Array`.
 */
export function derive_x25519_public(private_key: Uint8Array): Uint8Array;

/**
 * `/api/v1/files/{id}/download-grants` for `file_id`.
 */
export function directDownloadGrantsPath(file_id: string): string;

/**
 * `{ cap_object_download_v1, cap_object_upload_v1, capabilities_header,
 * discovery_path, max_window, default_window, chunk_overhead,
 * max_discovery_body_bytes, max_grant_body_bytes, max_chunk_body_bytes,
 * storage_connect_timeout_ms, storage_get_idle_ms, discovery_timeout_ms,
 * api_call_timeout_ms, background_put_resource_timeout_ms }`: the contract's
 * names and numbers, the response caps and the time bounds every client applies,
 * so no client re-types them.
 */
export function directTransferConstants(): any;

/**
 * Serialize a nonce + ciphertext pair into the canonical wire format.
 *
 * Returns `{"ciphertext":"<base64>","nonce":"<base64>"}` — byte-identical to
 * `beebeeb_core::metadata_wire::serialize_encrypted_metadata`. Never emits a
 * `cipher_suite`: the writer is frozen.
 *
 * Throws for a nonce that is not exactly 12 bytes (AES-GCM's nonce length).
 *
 * # Names, thumbnails and notes are not this pair
 *
 * The envelope is generic: no AAD, no field identity, so a reader can open a
 * value sealed for one field as if it were another. The fields are kept
 * apart by PURPOSE SUBKEY: one per-file HKDF subkey per purpose
 * (`beebeeb/name/v1`, `beebeeb/thumb/v1`, `beebeeb/note/v1` in core's
 * `encrypt`). New names, thumbnails and notes are subkey-sealed. Raw-key
 * envelopes remain readable only as unprotected legacy metadata.
 *
 * Use `encryptNameForNewItem` / `encryptNameForTarget` for a name,
 * `encryptThumbnailForNewItem` / `encryptThumbnailForTarget` for a
 * thumbnail, and `encryptNoteForNewItem` / `encryptNoteForTarget` for a
 * note. Read them with `decrypt_file_metadata`, `decrypt_note` and
 * `decrypt_thumbnail` (snake_case: these exports have no `js_name`). Never
 * use `decrypt_metadata` for them: it checks no AAD and cannot tell which
 * field a value was sealed for.
 */
export function encodeMetadataEnvelope(nonce: Uint8Array, ciphertext: Uint8Array): string;

/**
 * Seal a name for a NEW row minted by `newOwnerItemId`/`newForeignItemId`.
 *
 * The id handle decides the key (L12): an owner id derives it. A new foreign
 * id is refused (an F id never derives its name key) — an F name is sealed
 * through the `writeTarget` it gets after adoption; only its content goes
 * through `WasmChunkEncryptor.forNewItem`.
 */
export function encryptNameForNewItem(item_id: WasmNewItemId, filename: string, mime_type: string | null | undefined, pin: number): string;

/**
 * Protected name metadata for a NEW row after frame 0 was emitted.
 */
export function encryptNameForNewItemVersion(item_id: WasmNewItemId, filename: string, mime_type: string | null | undefined, pin: number, version_id: Uint8Array, version_counter: number): string;

/**
 * Seal a replacement name through the resolved row's write target. The key and
 * the pin come from the target, so a caller cannot substitute either.
 */
export function encryptNameForTarget(target: WasmWriteTarget, filename: string, mime_type?: string | null): string;

/**
 * Protected metadata for a replacement version through the resolved target.
 */
export function encryptNameForTargetVersion(target: WasmWriteTarget, filename: string, mime_type: string | null | undefined, version_id: Uint8Array, version_counter: number): string;

/**
 * Seal a note for a NEW row minted by `newOwnerItemId`/`newForeignItemId`.
 */
export function encryptNoteForNewItem(item_id: WasmNewItemId, note: string, pin: number): string;

/**
 * Seal a replacement note through the resolved row's write target.
 */
export function encryptNoteForTarget(target: WasmWriteTarget, note: string): string;

/**
 * Seal a thumbnail for a NEW row minted by `newOwnerItemId`/`newForeignItemId`.
 */
export function encryptThumbnailForNewItem(item_id: WasmNewItemId, plaintext: Uint8Array, pin: number): Uint8Array;

/**
 * Seal a replacement thumbnail through the resolved row's write target.
 */
export function encryptThumbnailForTarget(target: WasmWriteTarget, plaintext: Uint8Array): Uint8Array;

/**
 * Encrypt a plaintext chunk with AES-256-GCM. Returns a JS object
 * `{ cipher_suite: string, nonce: Uint8Array, ciphertext: Uint8Array }`.
 */
export function encrypt_chunk(key: Uint8Array, plaintext: Uint8Array): any;

/**
 * Encrypt a UTF-8 metadata string (filename, path, etc.) with AES-256-GCM.
 * Returns the same JS object shape as `encrypt_chunk`.
 */
export function encrypt_metadata(key: Uint8Array, metadata: string): any;

/**
 * Seal the name/MIME envelope under a GIVEN per-file key, by the rule of a
 * recorded pin (task 1958). The only name writer that takes a key, so it serves
 * keys NOT derived from the master key (file-request uploads, shared-folder
 * files); for a derived key it writes what `encrypt_name_with_chunk_format`
 * writes. A v2 pin records `chunk_format: 2` and is always sealed under the
 * name subkey; 0 follows the current write rule. Any other code is an error.
 * `recordedPin`:
 * - an EXISTING file (rename): the `chunk_format` from
 *   `decrypt_file_metadata` / `..._with_key` of THIS file (0 = unrecorded,
 *   2 = v2), never a server field;
 * - a NEW file (e.g. a file-request upload): the pin of the format its content
 *   was written in, `recorded_for(encryptor.format())` (2 for a v2 upload, 0
 *   for v1), as at any upload. Nothing else is allowed for a new file.
 */
export function encrypt_name_for(file_key: Uint8Array, filename: string, mime_type: string | null | undefined, recorded_pin: number): string;

/**
 * Encrypt a filename (+ MIME) into a `name_encrypted` envelope that also
 * records the file's chunk format (task 1908): `chunk_format` 2 = every upload
 * of this file id is v2, 0 = record nothing (the pre-1908 shape). New file:
 * 2 only if its content was written as v2. Rename / replace: pass the value
 * `decrypt_file_metadata` returned — never upgrade a file with v1 history,
 * never drop a recorded 2.
 */
export function encrypt_name_with_chunk_format(master_key: Uint8Array, file_id: string, filename: string, mime_type: string | null | undefined, chunk_format: number): string;

/**
 * Seal protected metadata for a newly written version.
 */
export function encrypt_name_with_version(master_key: Uint8Array, file_id: string, filename: string, mime_type: string | null | undefined, chunk_format: number, version_id: Uint8Array, version_counter: number): string;

/**
 * Seal a file note for a file with no recorded pin yet (task 1908 round 5):
 * returns the canonical `EncryptedBlob` JSON to store in `note_encrypted` (the
 * shape `serializeEncryptedBlob` writes). Follows the gated seal switch, like
 * `encrypt_thumbnail`. For a note on an EXISTING file (the details panel) use
 * `encrypt_note_for` with the file's recorded pin. The ONLY way to seal a
 * note — not `encryptFilename` / `encrypt_metadata` under the file key (a
 * raw-key note can stand in for a v2 file's name and content).
 */
export function encrypt_note(file_key: Uint8Array, note: string): string;

/**
 * Seal a note of an EXISTING file under the rule of its recorded pin (task
 * 1908 round 5): `recordedPin` = the `chunk_format` from
 * `decrypt_file_metadata` of THIS file (0 = unrecorded, 2 = v2), never a
 * server field. A v2 pin is always sealed under the note subkey; 0 behaves
 * like `encrypt_note`.
 */
export function encrypt_note_for(file_key: Uint8Array, note: string, recorded_pin: number): string;

/**
 * Seal a thumbnail (already-encoded image bytes) under a 32-byte file key:
 * `nonce(12) || ciphertext || tag(16)` (the existing thumbnail wire format).
 * The ONLY way to seal a thumbnail (task 1908 round 3) — after the gated seal
 * switch it uses the thumbnail subkey, so a thumbnail can never be served as
 * file content.
 */
export function encrypt_thumbnail(file_key: Uint8Array, plaintext: Uint8Array): Uint8Array;

/**
 * Seal a thumbnail of an EXISTING file under the rule of its recorded pin
 * (task 1908 round 4): `recordedPin` = the `chunk_format` from
 * `decrypt_file_metadata` (0 = unrecorded, 2 = v2). A v2 pin is always sealed
 * under the thumbnail subkey; 0 behaves like `encrypt_thumbnail`.
 */
export function encrypt_thumbnail_for(file_key: Uint8Array, plaintext: Uint8Array, recorded_pin: number): Uint8Array;

/**
 * Evaluate a password against the server's `policy.password.min_length`
 * (clamped up to the core floor of 12). Returns
 * `{ length, min_length, missing_characters, meets_minimum, has_mixed_case,
 * has_number_or_symbol, strength, level, hint }`. Contains no part of the password.
 */
export function evaluate_password(password: string, min_length: number): any;

/**
 * Web `handleCopyExisting` in core: the request's link, or `undefined`.
 */
export function fileRequestRebuildLink(app_url: string, master_key: Uint8Array, token?: string | null, wrapped_private_key?: string | null, wrap_nonce?: string | null): string | undefined;

/**
 * Shorten a client-metadata string for sealing: over 1024 UTF-8 bytes, keep
 * the last 1021 bytes on a char boundary behind a leading `…`.
 */
export function fitForSeal(s: string): string;

/**
 * A shared folder's key id (task 2133): a one-way id of the folder's 32-byte
 * key, for a server to compare folder keys without learning them (HKDF-SHA256,
 * info `beebeeb/folder-key-id/v1`). Returns a 32-byte `Uint8Array`; not secret,
 * and never a key. Wipes the copy of the key this function owns
 * (wasm-bindgen's own copy is freed without a wipe).
 */
export function folder_key_id(folder_key: Uint8Array): Uint8Array;

/**
 * Format a byte count with binary units and IEC labels: `1 KiB` (1,024),
 * `1 MiB`, `1.0 TiB`. Same ladder and precision rule as the SI formatter; a
 * negative count keeps its sign and never scales (`-1500 B`).
 */
export function formatBinary(bytes: bigint): string;

/**
 * Format a byte count in decimal units with `decimals` decimals (0, 1 or 2),
 * carrying a value that rounds up into the next unit (`999.6 KB` with one
 * decimal prints `1.0 MB`). Counts below 1,000 always print as `N B`.
 */
export function formatCompact(bytes: bigint, decimals: number): string;

/**
 * Generate a recovery kit PDF with a title, master key words, and metadata.
 *
 * `metadata_keys` and `metadata_values` are parallel arrays of key-value pairs.
 * Returns the raw PDF bytes as `Uint8Array`.
 */
export function generate_recovery_pdf(title: string, words: any, metadata_keys: any, metadata_values: any): Uint8Array;

/**
 * Generate a new master key (12 BIP39 words) and the corresponding derived
 * key. Returns `{ phrase: string, master_key: Uint8Array }`.
 */
export function generate_recovery_phrase(): any;

/**
 * Generate a canonical share token (task 0708): 20 bytes of OS randomness as
 * URL-safe-no-pad base64 (27 chars). Web mints this for A1 owner-recoverable
 * shares so the client-supplied `token` matches the server's format exactly
 * (single canonical impl shared with native/UniFFI via `beebeeb-core`).
 */
export function generate_share_token(): string;

/**
 * True when `item_id` is a canonical foreign (F) id; InvalidInput (a JS throw)
 * when the text is not canonical at all.
 */
export function isForeignItemId(item_id: string): boolean;

/**
 * Returns `true` if the given MIME type can be previewed in-app.
 */
export function is_previewable(mime_type?: string | null): boolean;

/**
 * Returns `true` if the file extension indicates a previewable file.
 */
export function is_previewable_by_extension(filename: string): boolean;

/**
 * The ciphertext bytes a process of `class` (`"native"`, `"browser"`, `"mobile_app"`,
 * `"mobile_extension"`) may hold at once. Throws `class_invalid` for any other string.
 */
export function maxInFlightBytes(_class: string): number;

/**
 * Mint a guest (F) item id with NO master key (task 2275 §15). The anonymous
 * uploader path uses this; the id is a canonical RFC 9562 UUID v8 and core's
 * class check classifies it as foreign. The server has no T2 F-class check
 * yet (future server work), so only the core check protects this id today.
 */
export function mintGuestItemId(): string;

/**
 * Mint a new foreign (F) item id (RFC 9562 UUID v8) for `master_key`.
 */
export function newForeignItemId(master_key: Uint8Array): WasmNewItemId;

/**
 * Mint a new owner (O) item id (random UUID v4) for `master_key`.
 */
export function newOwnerItemId(master_key: Uint8Array): WasmNewItemId;

/**
 * An account email in the server's stored form (Rust `str::trim`, then
 * Unicode lower case). Use it for every email that names a contact or a pin.
 */
export function normalizeEmail(raw: string): string;

/**
 * Finish OPAQUE client login. Returns `{ message: Uint8Array, session_key: Uint8Array, export_key: Uint8Array }`.
 *
 * Normal login accepts only the current KSF version (1). A server-supplied
 * legacy or unknown version is rejected; legacy accounts require the explicit
 * migration path in core.
 */
export function opaque_login_finish(client_state: Uint8Array, password: Uint8Array, server_response: Uint8Array, ksf_version: number): any;

/**
 * Start OPAQUE client login. Returns `{ message: Uint8Array, state: Uint8Array }`.
 */
export function opaque_login_start(password: Uint8Array): any;

/**
 * Finish OPAQUE client registration. Returns `Uint8Array` (registration upload).
 */
export function opaque_registration_finish(client_state: Uint8Array, password: Uint8Array, server_response: Uint8Array): Uint8Array;

/**
 * Start OPAQUE client registration. Returns `{ message: Uint8Array, state: Uint8Array }`.
 */
export function opaque_registration_start(password: Uint8Array): any;

/**
 * Open a guest's display name. The envelope must be a JSON object with
 * exactly the keys `cipher_suite`, `nonce` and `ciphertext` (any key order,
 * any whitespace) that opens under the one actor-name key; the plaintext then
 * goes through the same `sanitize_actor_name` rule as the writer and is
 * returned sanitized. Every refusal is a decryption failure.
 */
export function openFolderActorName(folder_key: Uint8Array, shared_folder_id: string, envelope: string): string;

/**
 * The one legacy (unbound) child opener: a 60-byte frame under the folder
 * key, refused when its 32-byte plaintext is valid UTF-8 (L9 rule 1).
 * Returns `undefined` when the frame is not a legacy child wrap.
 */
export function openLegacyChildKey(folder_key: Uint8Array, wrapped: Uint8Array): Uint8Array | undefined;

/**
 * L9 (task 2255): open a LEGACY invite owner copy and return its key only when
 * core proves it over the folder's rows, in ONE call. `rows` are the server's
 * `GET /shares/invites/{id}/folder-keys` rows verbatim:
 * `[{ file_id: string, encrypted_file_key: string }]`, the key in standard base64.
 * They are read lazily, and core examines at most 64 distinct ids. Returns
 * `undefined` when the copy does not open, holds text, or is not proven; the
 * unproven candidate never reaches JS. Attack B (task 2255) is a named residual.
 */
export function openLegacyInviteOwnerCopy(master_key: Uint8Array, folder_id: string, legacy_copy: Uint8Array, rows: any): Uint8Array | undefined;

/**
 * Open a sealed request upload (owner decrypt path). Recovers the content key.
 * `r_priv` and `e_pub` are 32 bytes; `file_id` is arbitrary bytes. Returns
 * 32-byte `Uint8Array`.
 *
 * **DECRYPT-ONLY.** This is a request row's content key `C`, and the
 * anonymous uploader holds it. Use it to read the row's content; never seal a
 * name, note or thumbnail under this key. For a request row the owner's rename
 * goes through `seal_request_rename` / `sealRequestRename` (the §15
 * string-derived key), never `C`.
 */
export function open_request_upload(r_priv: Uint8Array, e_pub: Uint8Array, file_id: Uint8Array, wrapped_key: Uint8Array): Uint8Array;

/**
 * Resolve the owner's per-file key for ONE content version of a file from the
 * canonical `file_id` and that version's first chunk frame, and report which
 * id convention that version's key came from (SF-0002). Returns
 * `{ key: Uint8Array, convention }`, where `convention` is `"string"`,
 * `"binary"` or `"upper_repair"`.
 *
 * The first chunk frame may be a v1 legacy frame (`nonce || ciphertext ||
 * tag`, no AAD — what the iOS File Provider wrote) or core's v2 frame 0.
 *
 * A file is READ-ONLY for the client if EITHER
 * [`ownerFileKeyForName`](owner_file_key_for_name) or ANY of its versions
 * reports `"upper_repair"`: no rename, no new version; save an edit as a new
 * file. Resolve each version separately — the name's convention does not
 * decide the content key.
 */
export function ownerFileKeyForContent(master_key: Uint8Array, file_id: string, first_chunk_frame: Uint8Array): any;

/**
 * Resolve the owner's per-file key for a file from the `(file_id,
 * name_encrypted)` pair the server stores, and report which id convention the
 * key came from (SF-0002). Returns `{ key: Uint8Array, convention }`, where
 * `convention` is `"string"`, `"binary"` or `"upper_repair"`.
 *
 * The string convention is tried first, then the legacy binary one, then the
 * uppercase repair one (only when uppercasing changes the id). The first
 * candidate whose key authenticates `name_encrypted` wins.
 *
 * `"upper_repair"` is READ-ONLY: treat the file as read-only — no rename and
 * no new version; save an edit as a new file. Core only reports the
 * convention; it never re-seals or migrates an existing row.
 */
export function ownerFileKeyForName(master_key: Uint8Array, file_id: string, name_encrypted: string): any;

/**
 * When `wire_bytes` received since `start_ms` at `kbps` KiB/s lets the next storage
 * request start. The three counts cross as JS numbers (`f64`), like every other count.
 * `-Infinity` (`i64::MIN` in core) means there is no ceiling: a real deadline is a
 * finite number, so a caller only has to test `Number.isFinite`. Desktop's formula,
 * unchanged in value.
 */
export function pacedUntilMs(start_ms: number, wire_bytes: number, kbps: number): number;

/**
 * May this client use the direct transport for `direction`? True only when discovery
 * offers it AND has at least one storage pair AND every pair in `discovery.storage_buckets`
 * is in `pairs` (an array of `{host, bucket}`). Hosts compare ASCII case-insensitively,
 * buckets exactly.
 */
export function pairsAllowed(discovery: any, direction: string, pairs: any): boolean;

/**
 * Decode a discovery body (`GET /api/v1/transfer/capabilities`). Returns
 * `{ download, upload, storage_hosts, storage_buckets: [{host, bucket}],
 * max_window, url_ttl_seconds }`; unknown fields are ignored and missing lists
 * are empty. Throws an `Error` with `code` `discovery_too_large` or
 * `discovery_malformed`.
 */
export function parseDirectDiscovery(body: Uint8Array): any;

/**
 * Parse a `Retry-After` delta-seconds header: the number of seconds, or `null`
 * for anything else (empty, negative, fractional, an HTTP date), so the caller
 * falls back to the ladder.
 */
export function parseRetryAfter(value: string): any;

/**
 * Parse a share link on either route and on any `https` host (legacy hosts
 * included; plain `http` only for loopback). Returns
 * `{ base_url, route, token, key }`; `key` is the percent-decoded fragment
 * value, not yet decoded as bytes — use `shareKeyBytes(key)` for that.
 *
 * The thrown message starts with core's stable code, so a caller can branch:
 * `missing_fragment`, `missing_key`, `missing_token`, `not_a_share_link`.
 */
export function parseShareLink(url: string): any;

/**
 * The `vault-key-escrow` body for a credential id and a blob.
 */
export function passkeyEscrowBody(credential_id: Uint8Array, blob: Uint8Array): string;

/**
 * `login-start`'s answer → `AssertionStart` JSON. The server's `rpId` must equal `expectedRpId`
 * (`passkey_rp_mismatch` otherwise); `allowLocalhost` is the explicit development flag.
 */
export function passkeyParseAssertionStart(answer_json: string, expected_rp_id: string, allow_localhost: boolean): string;

/**
 * `register-start`'s answer → `RegistrationStart` JSON. The server's `rp.id` must equal `expectedRpId`
 * (`passkey_rp_mismatch` otherwise); `allowLocalhost` is the explicit development flag.
 */
export function passkeyParseRegistrationStart(answer_json: string, expected_rp_id: string, allow_localhost: boolean): string;

/**
 * The PRF eval input web passes as `prf.eval.first`.
 */
export function passkeyPrfEvalInput(): Uint8Array;

/**
 * Open an escrow blob with a PRF output. Returns the 32-byte vault key (the WASM boundary's raw-key convention).
 */
export function passkeyUnwrapVaultKey(prf_output: Uint8Array, blob: Uint8Array): Uint8Array;

/**
 * Wrap the vault key under a PRF output: the escrow blob (`nonce || ct || tag`).
 */
export function passkeyWrapVaultKey(prf_output: Uint8Array, master_key: Uint8Array): Uint8Array;

/**
 * The shared retry policy of the pinned per-chunk route (4 attempts, 150 s of waiting in all, a
 * stated `Retry-After` kept, otherwise 1 s doubling). `outcome` is what `classifyDirectAnswer`
 * returned for `call: "pinned_chunk"`; `attempt` is the 1-based number of the attempt that just
 * failed; `waitedMs` is the total waited so far.
 */
export function pinnedRetryDecision(outcome: any, attempt: number, waited_ms: number): any;

/**
 * Return the base storage quota (in bytes) for a plan slug.
 */
export function plan_base_storage_bytes(plan_slug: string): bigint;

/**
 * Whether the plan supports purchasing extra storage.
 */
export function plan_can_add_storage(plan_slug: string): boolean;

/**
 * Plan how to split a file into chunks for upload based on the client profile.
 *
 * `profile` must be one of: `"desktop"`, `"web"`, `"mobile"`, `"backup"`.
 * Returns `{ chunk_size_bytes: number, chunk_count: number }`.
 */
export function plan_chunks(file_size_bytes: bigint, profile: string): any;

/**
 * Compute the effective quota after add-ons and bonus bytes.
 */
export function plan_effective_quota(plan_slug: string, extra_tb: bigint, bonus_bytes: bigint): bigint;

/**
 * Maximum additional TB a plan may purchase.
 */
export function plan_max_extra_tb(plan_slug: string): bigint;

/**
 * Monthly cost in cents for a plan with optional add-ons.
 */
export function plan_monthly_cost_cents(plan_slug: string, extra_tb: bigint, extra_users: bigint): bigint;

/**
 * One preview decision per name, for one platform: `result[i]` is `1` when
 * `names[i]` can be previewed in-app on `platform`, `0` otherwise.
 *
 * `platform` is `"web"`, `"desktop"` or `"mobile"`. Any other string throws
 * `unknown preview platform \`…\`` — it never falls back to a default, because
 * answering for the wrong client is exactly the regression this export exists
 * to prevent.
 *
 * The vector `test-vectors/consolidation/preview_platforms.json` carries the
 * expected answer for every extension of the three-way union, per platform.
 */
export function previewableBatchFor(names: string[], platform: string): Uint8Array;

/**
 * Recover the derived key from the 12 words of a master key.
 * Returns the 32-byte master key as `Uint8Array`.
 */
export function recover_from_phrase(phrase: string): Uint8Array;

/**
 * 0-based positions of words that are not BIP39 words (DW-A47's per-word hint).
 */
export function recoveryUnknownWordPositions(words: string[]): Uint32Array;

/**
 * A URL for a log line: scheme and host only.
 */
export function redactUrl(url: string): string;

/**
 * Resolve one row's key from its id class (task 2275 L12).
 *
 * `kind` is the row kind (1 = file, 2 = folder) and is required: a plaintext
 * name on a FOLDER uses the string convention, a plaintext name on a FILE must
 * authenticate content chunk 0 (`firstChunkFrame`) and is refused without one.
 *
 * Returns `{ key: Uint8Array, contentKey: Uint8Array | null, origin: string,
 * name: {name?, mimeType?, plaintext?, chunkFormat}, writeTarget:
 * WasmWriteTarget | null }`. `origin` is "derived", "derived_binary",
 * "derived_upper_repair", "owner_wrap" or "folder_wrap". `contentKey` is set
 * only for an SF-0002 split row (name and content under different
 * conventions). A row with an upper-repair name or content key is READ-ONLY and
 * has no write target.
 *
 * Owner ids never use `ownerWrap`/the folder wrap; foreign ids never derive a
 * key and require one of them to open AND authenticate the name.
 */
export function resolveOwnedKey(master_key: Uint8Array, item_id: string, kind: number, owner_wrap: Uint8Array | null | undefined, name_encrypted: string, shared_folder_id?: string | null, folder_key?: Uint8Array | null, folder_wrap?: Uint8Array | null, first_chunk_frame?: Uint8Array | null): any;

/**
 * Resolve a 2236 request row: `{content, nameOrigin, name, mimeType,
 * chunkFormat, seal, renameTarget}`. `content` is a decrypt-only
 * `WasmRequestContentReader` for the row's content key; no raw key reaches JS,
 * so a request-row result offers no sealing path. The seal is `"bound"` or
 * `"unbound"` (§15), and `renameTarget` is `{origin, pin}` or null when the
 * name is upper-repair (read-only). Renames go through `sealRequestRename`.
 *
 * `request_wrap_context` is the context the owner wrapped the request private
 * key under: empty for every request created so far (the server mints the
 * request id after the wrap). A real request id refuses a shipped row; this
 * function never tries both contexts.
 */
export function resolveRequestRow(master_key: Uint8Array, item_id: string, request_wrap_context: Uint8Array, wrapped_request_private: Uint8Array, wrap_nonce: Uint8Array, sender_ephemeral_pubkey: Uint8Array, wrapped_content_key: Uint8Array, name_encrypted: string): any;

/**
 * Resume a minted id from the id text and tag persisted with an upload session
 * (task 2275, L13). The tag is re-checked in constant time; a tampered tag, a
 * different id or a server-echoed id is refused, so an interrupted upload can
 * continue but a substituted id cannot be sealed.
 */
export function resumeNewItemId(master_key: Uint8Array, item_id: string, tag: Uint8Array): WasmNewItemId;

/**
 * What to do with an unfinished upload found on disk. `recorded` is `"api"` or `"direct"` (what the resume
 * record names); `discovery` is `{ kind, upload? }` with `kind` `"offers"` (and `upload: true | false`),
 * `"not_supported"` (a JSON 404), `"unknown"` (a 5xx, a timeout, a bare 404: no usable answer) or
 * `"unauthorized"` (401 or 403); `forcedApi` is the user's own switch. Returns `"continue_api"`,
 * `"continue_direct"`, `"abandon_to_api"`, `"keep_record_and_fail"` or `"keep_record_and_reauthenticate"`.
 * A recorded direct session is given up only on a definite no. Throws `recorded_invalid` or
 * `discovery_state_invalid`.
 */
export function resumeTransport(recorded: string, discovery: any, forced_api: boolean): string;

/**
 * The decision after `attempts_made` attempts: the delay in milliseconds to
 * wait before the next attempt, or `null` to surface the last error. A server
 * `Retry-After` (`retry_after_seconds`, a number of seconds or `null`)
 * replaces the ladder exactly.
 *
 * `outcome` is `"success"`, `"network"`, `"fatal"`, or `{ status: 503 }`.
 */
export function retryDecide(policy: any, attempts_made: number, outcome: any, retry_after_seconds: any): any;

/**
 * The un-jittered ladder delay before retry number `retry` (1-based; retry 0
 * means "no retry" and is 0 ms), capped at the policy's `cap_ms`.
 */
export function retryDelayMs(policy: any, retry: number): number;

/**
 * The ladder delay shortened per the policy's jitter, with a caller-supplied
 * sample in permille (`0..=1000`; larger values are clamped). A `"none"`
 * policy ignores the sample.
 */
export function retryJitteredDelayMs(policy: any, retry: number, sample_permille: number): number;

/**
 * The shipped policy: six requests in all (one try plus five retries), 500 ms
 * base, a 30 s cap, no jitter, and a server `Retry-After` honoured.
 */
export function retryPolicy(): any;

/**
 * Rewrite one name so it is safe under the strictest (Windows) rule set:
 * `: < > " | ? *` become `_`, trailing dots/spaces become `_`, a reserved
 * device name gets a leading `_`, and bidi controls are removed. A name that
 * is structurally unsafe (separator, `.`/`..`, control character, drive
 * prefix) is still refused, never rewritten.
 */
export function sanitizePathComponent(name: string): string;

/**
 * QR path, approver side: the new device's name as its scanned QR carries
 * it. Show this name while the person confirms, never the relay's
 * `device_name`. Throws for text that is not a Beebeeb device-link QR.
 */
export function scannedDeviceLinkName(scanned_qr: string): string;

/**
 * Text that may contain URLs, made safe to print.
 */
export function scrubText(text: string): string;

/**
 * QR path, approver side. `scanned_qr` is the raw text the camera read from
 * the new device's screen; core parses it, so no fingerprint or name bytes
 * come from JavaScript. Never build that text from server data: the typed
 * code gives no protection against a substituted key on this path. Without a
 * camera, use `WasmTypedApproval`. `relayed_device_name` is the name the
 * relay reports for the link: a name that differs from the scanned one
 * throws `device_name_changed` before anything is sealed; deny the link.
 */
export function sealDeviceLink(master_key: Uint8Array, scanned_qr: string, relayed_public: Uint8Array, relayed_device_name: string, typed_code: string): any;

/**
 * Seal a guest's display name under the folder key, bound to the shared root.
 * Seals `sanitize_actor_name(name)` (core `kdf::sanitize_actor_name`): NFC;
 * controls, bidi controls and the other display controls of its strip table
 * removed (ZWNJ, ZWJ, variation selectors and tag characters are kept); NFC
 * again; then a leading combining mark, a result outside 1..64 Unicode scalar
 * values and a visibly blank name are refused (invalid input). Returns the
 * envelope: a JSON object with exactly the keys `cipher_suite`, `nonce` and
 * `ciphertext`.
 */
export function sealFolderActorName(folder_key: Uint8Array, shared_folder_id: string, name: string): string;

/**
 * Seal a request-row rename under the section 15 string-convention key derived
 * from `item_id`, keeping the row's recorded `pin` (`chunkFormat` from
 * `resolveRequestRow`). This is the only sealing path a request-row result
 * offers: `resolveRequestRow` hands back no key, so a rename cannot be sealed
 * under the content key `C` that the anonymous uploader holds (A9).
 *
 * An F id is refused by the same owner-class check the resolver runs. `pin` is
 * the `renameTarget.pin` the resolver returned (the row's recorded format),
 * never a field from the wire. Pin direction matters both ways:
 * - a pin of 2 on a v1 row makes the file unreadable until it is renamed again
 *   with the correct pin;
 * - a pin of 0 on a v2 row drops the recorded 2, turns frame-0 detection back
 *   on, and lets a server serve the uploader's old no-AAD name blob under `C`
 *   as a one-frame v1 file.
 */
export function sealRequestRename(master_key: Uint8Array, item_id: string, pin: number, filename: string, mime_type?: string | null): string;

/**
 * Protected request-row rename preserving the resolver's version fields.
 */
export function sealRequestRenameWithVersion(master_key: Uint8Array, item_id: string, pin: number, version_id: Uint8Array, version_counter: number, filename: string, mime_type?: string | null): string;

/**
 * Seal a content key to a request's public key (anonymous uploader path).
 * `r_pub` and `content_key` are 32 bytes; `file_id` is arbitrary bytes.
 * Returns `{ e_pub: Uint8Array, wrapped_key: Uint8Array }`.
 */
export function seal_to_request(r_pub: Uint8Array, file_id: Uint8Array, content_key: Uint8Array): any;

/**
 * Compute the shard sync plan to converge `local` (the client's shard set) with
 * `remote` (the server manifest from `GET /api/v1/search-index/shards`), LWW.
 * `local`/`remote` are arrays of `{ bucket, page, version }`; returns
 * `{ toPut, toGet, toDelete }` arrays of `{ bucket, page }`. See the core
 * `search_sync::diff_manifest` doc for the `localIsAuthoritative` semantics.
 */
export function searchIndexSyncPlan(local: any, remote: any, local_is_authoritative: boolean): any;

/**
 * Approve a claimed file invite later: `shareApproveFileInviteRequest(inviteId, fileId,
 * recipientPublicKeyB64, masterKey, fileKey, expectedPeerFingerprint)` returns
 * `{request, recipientPublicKey}` (hex: the exact key sealed to). `expectedPeerFingerprint` is
 * REQUIRED (32 bytes, or empty = not compared). After `peer_key_changed` and "share anyway", pass
 * the key the refusal carried and the fingerprint of those bytes, never a re-fetched key.
 */
export function shareApproveFileInviteRequest(invite_id: string, file_id: string, recipient_public_key_b64: string, master_key: Uint8Array, file_key: Uint8Array, expected_peer_fingerprint: Uint8Array): any;

/**
 * `shareCreateBundle(appUrl, fileIds, positions, fileKeys, masterKey, expiresInHours?, maxOpens?, passphrase?)`:
 * a `ShareCreateLink` over an ordered set of files (web's bundle branch). `fileKeys` is the
 * concatenation of each item's 32-byte key, in the order of `fileIds`.
 */
export function shareCreateBundle(app_url: string, file_ids: string[], positions: Uint32Array, file_keys: Uint8Array, master_key: Uint8Array, expires_in_hours?: number | null, max_opens?: number | null, passphrase?: string | null): ShareCreateLink;

/**
 * Decode a `#key=` value as bytes, accepting standard base64 (legacy links) and
 * base64url (current links), padded or unpadded; `null` when it is neither.
 */
export function shareKeyBytes(key: string): any;

/**
 * The recipient side of a person share.
 */
export function shareOpenMemberFileKey(master_key: Uint8Array, owner_public_key: Uint8Array, file_id: string, sealed: Uint8Array): Uint8Array;

/**
 * [`share_rebuild_link`] for a bundle (no single wrapped file key).
 */
export function shareRebuildBundleLink(app_url: string, master_key: Uint8Array, owner_wrapped_key?: string | null, owner_wrapped_token?: string | null): string | undefined;

/**
 * Web `rebuildFolderLinkUrl` in core: the owner's folder link, or `undefined`.
 */
export function shareRebuildFolderLink(app_url: string, master_key: Uint8Array, share_id: string, owner_wrapped_key: string | null | undefined, owner_wrapped_token: string | null | undefined, wrapped_folder_key: string | null | undefined, passphrase_protected: boolean): string | undefined;

/**
 * The owner's working link from a share's owner blobs; `undefined` when it can't be rebuilt.
 * `wrappedFileKey` (the link's stored `wrapped_file_key`, required) must open under the rebuilt link
 * key. A bundle uses `shareRebuildBundleLink`.
 */
export function shareRebuildLink(app_url: string, master_key: Uint8Array, owner_wrapped_key: string | null | undefined, owner_wrapped_token: string | null | undefined, wrapped_file_key: string): string | undefined;

/**
 * `shareSafetyNumber(masterKey, ownUserId, peerUserId, peerPublicKey)` →
 * `{ digits: "60 digits", peerFingerprint: "<SHA-256 of the peer key, hex>" }`. The own sharing
 * key is derived from the master key in core; `peerPublicKey` is the key the share was sealed to.
 */
export function shareSafetyNumber(master_key: Uint8Array, own_user_id: string, peer_user_id: string, peer_public_key: Uint8Array): any;

export function shareUnwrapKey(wrap_key: Uint8Array, wrapped: Uint8Array): Uint8Array;

/**
 * Web's `wrapKeyForShare` in core: `nonce(12) || ciphertext`, no AAD.
 */
export function shareWrapKey(wrap_key: Uint8Array, plaintext: Uint8Array): Uint8Array;

/**
 * The request for the server's sign-up policy (`GET /api/v1/onboarding`).
 */
export function signupPolicyRequest(): any;

/**
 * The most a storage GET of `len` ciphertext bytes may take, in milliseconds (the same formula as a PUT).
 * Throws like `storagePutTotalMs`.
 */
export function storageGetTotalMs(len: number): number;

/**
 * The most a storage PUT of `len` ciphertext bytes may take, in milliseconds: a minute plus the
 * chunk at 1 Mbit/s (`60 s + ceil(len / 131072) s`). Throws an `Error` with `code` `length_invalid`
 * for a `len` that is not a whole, non-negative number.
 */
export function storagePutTotalMs(len: number): number;

/**
 * Format a byte count as a human-readable SI string (e.g. "5.0 TB").
 */
export function storage_format_si(bytes: bigint): string;

/**
 * Where `bytes` falls against one variant's budgets: `"target"` (at or below
 * `target_bytes`, stop the ladder), `"fallback"` (above target but at or below
 * `max_bytes`, keep it and keep trying) or `"rejected"` (above `max_bytes`).
 */
export function thumbnailBudget(variant: string, bytes: number): string;

/**
 * The encoder output a variant asks for on `platform`: `"heic"` on iOS and
 * macOS (the OS owns the encoder), `"webp"` everywhere else.
 */
export function thumbnailFormat(variant: string, platform: string): string;

/**
 * The policy for one variant (`small`, `medium`, `large`):
 * `{ variant, target_px, target_bytes, max_bytes, steps }`, where each step is
 * `{ max_dimension, quality }`.
 */
export function thumbnailPolicy(variant: string): any;

/**
 * Decrypt a `nonce(12) || ciphertext` blob produced by `transfer_encrypt`.
 *
 * Delegates to `transfer::decrypt_transfer`.
 */
export function transfer_decrypt(key: Uint8Array, blob: Uint8Array): Uint8Array;

/**
 * Derive the 32-byte AES-256 transfer key from a shared secret + session id.
 *
 * `HKDF-SHA256(ikm = shared_secret, salt = session_id, info = "beebeeb-transfer-v1")`.
 * SALTED with `session_id` — NOT the salt-less `derive_sas_bytes` derivation.
 */
export function transfer_derive_key(shared_secret: Uint8Array, session_id: Uint8Array): Uint8Array;

/**
 * Derive the 4-byte SAS material from a shared secret + session id.
 *
 * `HKDF-SHA256(ikm = shared_secret, salt = session_id, info = "beebeeb-sas-v1")`.
 * SALTED with `session_id`. Both devices computing the same 4 bytes (and thus
 * the same 4 SAS words) is the MITM check. This is intentionally distinct from
 * the salt-less `derive_sas_bytes` exported elsewhere.
 */
export function transfer_derive_sas_bytes(shared_secret: Uint8Array, session_id: Uint8Array): Uint8Array;

/**
 * Encrypt a transfer payload under the transfer key.
 *
 * Returns `nonce(12) || AES-256-GCM ciphertext+tag` — the same wire format as
 * `encrypt_blob`. Delegates to `transfer::encrypt_transfer`.
 */
export function transfer_encrypt(key: Uint8Array, plaintext: Uint8Array): Uint8Array;

/**
 * Generate a fresh ephemeral X25519 keypair for a transfer.
 *
 * Returns `{ public: Uint8Array(32), private: Uint8Array(32) }`. `core`'s
 * `transfer::generate_keypair` returns an `EphemeralSecret` that cannot cross
 * the FFI boundary, so — matching the `createRequestKeypair` web precedent —
 * the private scalar is 32 bytes of OS randomness and the public point is the
 * X25519 base-point multiplication (`opaque::derive_x25519_public`). The two
 * produce the same shared secret as the core's `EphemeralSecret` path because
 * X25519 clamps the scalar identically (`StaticSecret::from`).
 */
export function transfer_generate_keypair(): any;

/**
 * Map 4 SAS bytes to 4 words from the canonical 256-word transfer wordlist.
 *
 * Returns a JS array of 4 strings. Keeps the wordlist as one source of truth
 * (core) so web and Swift render identical words for the same SAS bytes.
 */
export function transfer_sas_to_words(sas_bytes: Uint8Array): any;

export function unwrapFolderChild(folder_key: Uint8Array, shared_folder_id: string, item_id: string, kind: number, wrapped: Uint8Array): Uint8Array;

/**
 * Open an L6 custody record. Never accepts a legacy (unbound) owner copy.
 */
export function unwrapFolderCustody(master_key: Uint8Array, folder_id: string, wrapped: Uint8Array): Uint8Array;

/**
 * Open a purpose-bound invite owner copy; never performs a legacy fallback.
 */
export function unwrapInviteOwnerCopy(master_key: Uint8Array, folder_id: string, wrapped: Uint8Array): Uint8Array;

/**
 * Open a link label; one key, one shape. Returns the label in NFC (a non-NFC
 * plaintext is normalized, not refused); invalid UTF-8 or a label outside
 * 1..40 Unicode scalar values after NFC is a decryption failure.
 */
export function unwrapLinkLabel(master_key: Uint8Array, share_id: string, wrapped: Uint8Array): string;

/**
 * Open a link's owner copy of K_c. K_c is the deliberate export: JS puts it
 * in the link fragment. The master key never leaves the caller.
 */
export function unwrapLinkOwnerKey(master_key: Uint8Array, share_id: string, wrapped: Uint8Array): Uint8Array;

/**
 * Open a link's owner copy of its token.
 */
export function unwrapLinkOwnerToken(master_key: Uint8Array, share_id: string, wrapped: Uint8Array): Uint8Array;

/**
 * Open only an L8 owner file-key record, requiring exactly 32 plaintext bytes.
 */
export function unwrapOwnerFileKey(master_key: Uint8Array, item_id: string, wrapped: Uint8Array): Uint8Array;

/**
 * Unwrap a request's X25519 private key. Returns 32-byte `Uint8Array`.
 */
export function unwrap_request_private(master_key: Uint8Array, request_id: Uint8Array, wrapped: Uint8Array, nonce: Uint8Array): Uint8Array;

/**
 * L7 wire = nonce(12) || ciphertext+tag(48); UUID strings bind raw UUID bytes.
 */
export function wrapFolderChild(folder_key: Uint8Array, shared_folder_id: string, item_id: string, kind: number, child_key: Uint8Array): Uint8Array;

/**
 * Seal a shared folder's key to the owner's master key (L6 custody record).
 */
export function wrapFolderCustody(master_key: Uint8Array, folder_id: string, folder_key: Uint8Array): Uint8Array;

/**
 * Seal a purpose-bound invite owner copy (L9).
 */
export function wrapInviteOwnerCopy(master_key: Uint8Array, folder_id: string, folder_key: Uint8Array): Uint8Array;

/**
 * Seal a link label to the owner's master key, bound to the 16-byte share id.
 * Wire = nonce(12) || ciphertext+tag, like the L6 wraps.
 */
export function wrapLinkLabel(master_key: Uint8Array, share_id: string, label: string): Uint8Array;

/**
 * Seal a folder link's fragment key K_c to the owner's master key, bound to
 * the link's share id (so the owner can copy the link again later).
 */
export function wrapLinkOwnerKey(master_key: Uint8Array, share_id: string, link_key: Uint8Array): Uint8Array;

/**
 * Seal a folder link's raw token to the owner's master key, bound to the
 * link's share id.
 */
export function wrapLinkOwnerToken(master_key: Uint8Array, share_id: string, token: Uint8Array): Uint8Array;

/**
 * Seal an owner file-key adoption record with its own purpose key and AAD (L8).
 * Item IDs use the exact UTF-8 string bytes used by the L6 exports.
 */
export function wrapOwnerFileKey(master_key: Uint8Array, item_id: string, file_key: Uint8Array): Uint8Array;

/**
 * Wrap a request's X25519 private key under the owner's master key.
 * Returns `{ wrapped: Uint8Array, nonce: Uint8Array }`.
 */
export function wrap_request_private(master_key: Uint8Array, request_id: Uint8Array, r_priv: Uint8Array): any;

/**
 * Compute X25519 shared secret for sharing. Returns 32-byte `Uint8Array`.
 */
export function x25519_shared_secret(my_private: Uint8Array, their_public: Uint8Array): Uint8Array;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_accountflow_free: (a: number, b: number) => void;
    readonly __wbg_authapproval_free: (a: number, b: number) => void;
    readonly __wbg_authdevicerequest_free: (a: number, b: number) => void;
    readonly __wbg_authsignin_free: (a: number, b: number) => void;
    readonly __wbg_authstepup_free: (a: number, b: number) => void;
    readonly __wbg_clientmetakey_free: (a: number, b: number) => void;
    readonly __wbg_phraserecovery_free: (a: number, b: number) => void;
    readonly __wbg_sharecreatelink_free: (a: number, b: number) => void;
    readonly __wbg_sharecreaterequest_free: (a: number, b: number) => void;
    readonly __wbg_sharefolderinvite_free: (a: number, b: number) => void;
    readonly __wbg_sharememberinvite_free: (a: number, b: number) => void;
    readonly __wbg_signupflow_free: (a: number, b: number) => void;
    readonly __wbg_wasmaccountkeymaterial_free: (a: number, b: number) => void;
    readonly __wbg_wasmarchiveextraction_free: (a: number, b: number) => void;
    readonly __wbg_wasmarchivesession_free: (a: number, b: number) => void;
    readonly __wbg_wasmbreachcheck_free: (a: number, b: number) => void;
    readonly __wbg_wasmchunkdecryptor_free: (a: number, b: number) => void;
    readonly __wbg_wasmchunkencryptor_free: (a: number, b: number) => void;
    readonly __wbg_wasmdirectdiscoverycache_free: (a: number, b: number) => void;
    readonly __wbg_wasmdirecthealth_free: (a: number, b: number) => void;
    readonly __wbg_wasmdownloadplanner_free: (a: number, b: number) => void;
    readonly __wbg_wasmextractionplan_free: (a: number, b: number) => void;
    readonly __wbg_wasmnewdevicelink_free: (a: number, b: number) => void;
    readonly __wbg_wasmnewitemid_free: (a: number, b: number) => void;
    readonly __wbg_wasmrequestcontentreader_free: (a: number, b: number) => void;
    readonly __wbg_wasmsearchindex_free: (a: number, b: number) => void;
    readonly __wbg_wasmsignedurl_free: (a: number, b: number) => void;
    readonly __wbg_wasmsignupceremony_free: (a: number, b: number) => void;
    readonly __wbg_wasmstoragebody_free: (a: number, b: number) => void;
    readonly __wbg_wasmtypedapproval_free: (a: number, b: number) => void;
    readonly __wbg_wasmtypedreceiver_free: (a: number, b: number) => void;
    readonly __wbg_wasmwritetarget_free: (a: number, b: number) => void;
    readonly accountflow_abandon: (a: number) => void;
    readonly accountflow_changeEmail: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => void;
    readonly accountflow_changePassword: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number) => void;
    readonly accountflow_deleteAccount: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly accountflow_deleteCancel: (a: number, b: number, c: number, d: number) => void;
    readonly accountflow_deleteConfirm: (a: number, b: number, c: number, d: number) => void;
    readonly accountflow_new: () => number;
    readonly accountflow_regenerateBackupCodes: (a: number, b: number, c: number, d: number) => void;
    readonly accountflow_resume: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly accountflow_revokeOtherSessions: (a: number, b: number) => void;
    readonly accountflow_revokeSession: (a: number, b: number, c: number, d: number) => void;
    readonly accountflow_setActivityLogging: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly accountflow_setDisplayName: (a: number, b: number, c: number, d: number) => void;
    readonly accountflow_totpConfirm: (a: number, b: number, c: number, d: number) => void;
    readonly accountflow_totpDisable: (a: number, b: number, c: number, d: number) => void;
    readonly accountflow_totpSetup: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly accountflow_verifyEmail: (a: number, b: number, c: number, d: number) => void;
    readonly accountflow_verifyPassword: (a: number, b: number, c: number, d: number) => void;
    readonly answerSessionKeyProof: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number) => void;
    readonly apiDescriptor: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly archiveCountLabel: (a: number, b: bigint) => void;
    readonly archiveEntryName: (a: number, b: number, c: number) => void;
    readonly archiveSizeLabel: (a: number, b: bigint) => void;
    readonly archiveText: (a: number, b: number, c: number, d: number) => void;
    readonly authapproval_approve: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => void;
    readonly authapproval_codeMatches: (a: number, b: number, c: number) => number;
    readonly authapproval_deny: (a: number, b: number) => void;
    readonly authapproval_new: (a: number, b: number, c: number) => void;
    readonly authapproval_onDenyResponse: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly authapproval_onLookupResponse: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly authapproval_onResponse: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly authapproval_start: (a: number, b: number) => void;
    readonly authdevicerequest_initFrame: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => void;
    readonly authdevicerequest_new: () => number;
    readonly authdevicerequest_onFrame: (a: number, b: number, c: number, d: number) => void;
    readonly authsignin_new: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly authsignin_onResponse: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly authsignin_onVerifyResponse: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly authsignin_start: (a: number, b: number) => void;
    readonly authsignin_verifyRequest: (a: number, b: number, c: number, d: number) => void;
    readonly authstepup_attachConfirmToken: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly authstepup_new: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly authstepup_onResponse: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly authstepup_start: (a: number, b: number) => void;
    readonly backupAgainAction: (a: number) => void;
    readonly backupCheckAppMutation: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly backupCheckDriveMutation: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly backupCheckFailedWords: (a: number) => void;
    readonly backupCheckRootMutation: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly backupFirstPassBaseline: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly backupIsHiddenItem: (a: number, b: number, c: number) => number;
    readonly backupNoticeOverlapMs: () => number;
    readonly backupNoticeReason: (a: number, b: number, c: number, d: number) => void;
    readonly backupNoticesSince: (a: number, b: number) => void;
    readonly backupParseManifest: (a: number, b: number, c: number) => void;
    readonly backupPassGate: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly backupPassGateV2: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly backupPositionAtDepth: (a: number, b: number, c: number, d: number) => void;
    readonly backupProtectionMany: (a: number, b: number, c: number) => void;
    readonly backupRootBadge: (a: number) => void;
    readonly backupStop: (a: number, b: number, c: number, d: number) => void;
    readonly backupStopV2: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly backupStopWords: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly buildShareLink: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => void;
    readonly checkPathComponent: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly checkStorageBody: (a: number, b: number, c: number) => void;
    readonly checkStorageGet: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly checkStorageUrl: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly childWrapMatches: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number) => void;
    readonly classifyDirectAnswer: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => void;
    readonly clientmetakey_new: (a: number, b: number, c: number) => void;
    readonly clientmetakey_open: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => void;
    readonly clientmetakey_openMany: (a: number, b: number, c: number) => void;
    readonly clientmetakey_seal: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => void;
    readonly combineFolderLinkKey: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly compute_recovery_check: (a: number, b: number, c: number) => void;
    readonly decodeMetadataEnvelope: (a: number, b: number, c: number) => void;
    readonly decrypt_chunk: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly decrypt_chunk_frame: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => void;
    readonly decrypt_chunks: (a: number, b: number, c: number, d: number) => void;
    readonly decrypt_file_metadata: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly decrypt_file_metadata_with_key: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly decrypt_metadata: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly decrypt_name_metadata: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly decrypt_name_metadata_with_key: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly decrypt_names: (a: number, b: number, c: number, d: number) => void;
    readonly decrypt_note: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly decrypt_thumbnail: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly deriveFolderLinkPassphraseStretch: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly deriveSharedFolderIndexKey: (a: number, b: number, c: number, d: number) => void;
    readonly derive_file_key: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly derive_master_key: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly derive_request_wrap_key: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly derive_share_key: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly derive_x25519_private: (a: number, b: number, c: number) => void;
    readonly derive_x25519_public: (a: number, b: number, c: number) => void;
    readonly directDownloadGrantsPath: (a: number, b: number, c: number) => void;
    readonly directTransferConstants: (a: number) => void;
    readonly encodeMetadataEnvelope: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly encryptNameForNewItem: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly encryptNameForNewItemVersion: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => void;
    readonly encryptNameForTarget: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly encryptNameForTargetVersion: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => void;
    readonly encryptNoteForNewItem: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly encryptNoteForTarget: (a: number, b: number, c: number, d: number) => void;
    readonly encryptThumbnailForNewItem: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly encryptThumbnailForTarget: (a: number, b: number, c: number, d: number) => void;
    readonly encrypt_chunk: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly encrypt_metadata: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly encrypt_name_for: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => void;
    readonly encrypt_name_with_chunk_format: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => void;
    readonly encrypt_name_with_version: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number) => void;
    readonly encrypt_note: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly encrypt_note_for: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly encrypt_thumbnail: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly encrypt_thumbnail_for: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly evaluate_password: (a: number, b: number, c: number, d: number) => void;
    readonly fileRequestRebuildLink: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number) => void;
    readonly fitForSeal: (a: number, b: number, c: number) => void;
    readonly folder_key_id: (a: number, b: number, c: number) => void;
    readonly formatBinary: (a: number, b: bigint) => void;
    readonly formatCompact: (a: number, b: bigint, c: number) => void;
    readonly generate_recovery_pdf: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly generate_recovery_phrase: (a: number) => void;
    readonly generate_share_token: (a: number) => void;
    readonly isForeignItemId: (a: number, b: number, c: number) => void;
    readonly is_previewable: (a: number, b: number) => number;
    readonly is_previewable_by_extension: (a: number, b: number) => number;
    readonly maxInFlightBytes: (a: number, b: number, c: number) => void;
    readonly mintGuestItemId: (a: number) => void;
    readonly newForeignItemId: (a: number, b: number, c: number) => void;
    readonly newOwnerItemId: (a: number, b: number, c: number) => void;
    readonly normalizeEmail: (a: number, b: number, c: number) => void;
    readonly opaque_login_finish: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => void;
    readonly opaque_login_start: (a: number, b: number, c: number) => void;
    readonly opaque_registration_finish: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly opaque_registration_start: (a: number, b: number, c: number) => void;
    readonly openFolderActorName: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly openLegacyChildKey: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly openLegacyInviteOwnerCopy: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => void;
    readonly open_request_upload: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => void;
    readonly ownerFileKeyForContent: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly ownerFileKeyForName: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly pacedUntilMs: (a: number, b: number, c: number, d: number) => void;
    readonly pairsAllowed: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly parseDirectDiscovery: (a: number, b: number, c: number) => void;
    readonly parseRetryAfter: (a: number, b: number) => number;
    readonly parseShareLink: (a: number, b: number, c: number) => void;
    readonly passkeyEscrowBody: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly passkeyParseAssertionStart: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly passkeyParseRegistrationStart: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly passkeyPrfEvalInput: (a: number) => void;
    readonly passkeyUnwrapVaultKey: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly passkeyWrapVaultKey: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly phraserecovery_breachRequest: (a: number, b: number, c: number, d: number) => void;
    readonly phraserecovery_evaluate: (a: number, b: number, c: number, d: number) => void;
    readonly phraserecovery_new: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => void;
    readonly phraserecovery_onBreachResponse: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly phraserecovery_onFinalizeResponse: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly phraserecovery_onRegisterResponse: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly phraserecovery_onStartResponse: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly phraserecovery_setPassword: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly phraserecovery_start: (a: number, b: number) => void;
    readonly pinnedRetryDecision: (a: number, b: number, c: number, d: number) => void;
    readonly plan_base_storage_bytes: (a: number, b: number) => bigint;
    readonly plan_can_add_storage: (a: number, b: number) => number;
    readonly plan_chunks: (a: number, b: bigint, c: number, d: number) => void;
    readonly plan_effective_quota: (a: number, b: number, c: bigint, d: bigint) => bigint;
    readonly plan_max_extra_tb: (a: number, b: number) => bigint;
    readonly plan_monthly_cost_cents: (a: number, b: number, c: bigint, d: bigint) => bigint;
    readonly previewableBatchFor: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly recover_from_phrase: (a: number, b: number, c: number) => void;
    readonly recoveryUnknownWordPositions: (a: number, b: number, c: number) => void;
    readonly redactUrl: (a: number, b: number, c: number) => void;
    readonly resolveOwnedKey: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number, p: number, q: number, r: number) => void;
    readonly resolveRequestRow: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number, p: number, q: number) => void;
    readonly resumeNewItemId: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly resumeTransport: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly retryDecide: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly retryDelayMs: (a: number, b: number, c: number) => void;
    readonly retryJitteredDelayMs: (a: number, b: number, c: number, d: number) => void;
    readonly retryPolicy: (a: number) => void;
    readonly sanitizePathComponent: (a: number, b: number, c: number) => void;
    readonly scannedDeviceLinkName: (a: number, b: number, c: number) => void;
    readonly scrubText: (a: number, b: number, c: number) => void;
    readonly sealDeviceLink: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number) => void;
    readonly sealFolderActorName: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly sealRequestRename: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => void;
    readonly sealRequestRenameWithVersion: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number) => void;
    readonly seal_to_request: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly searchIndexSyncPlan: (a: number, b: number, c: number, d: number) => void;
    readonly shareApproveFileInviteRequest: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number) => void;
    readonly shareCreateBundle: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number) => void;
    readonly shareKeyBytes: (a: number, b: number) => number;
    readonly shareOpenMemberFileKey: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => void;
    readonly shareRebuildBundleLink: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => void;
    readonly shareRebuildFolderLink: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number) => void;
    readonly shareRebuildLink: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number) => void;
    readonly shareSafetyNumber: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => void;
    readonly shareUnwrapKey: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly shareWrapKey: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly sharecreatelink_new: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number) => void;
    readonly sharecreatelink_onResponse: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly sharecreatelink_start: (a: number, b: number) => void;
    readonly sharecreaterequest_new: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number, p: number) => void;
    readonly sharecreaterequest_onResponse: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly sharecreaterequest_start: (a: number, b: number) => void;
    readonly sharefolderinvite_link: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number, p: number, q: number, r: number, s: number, t: number) => void;
    readonly sharefolderinvite_new: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number) => void;
    readonly sharefolderinvite_onResponse: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly sharefolderinvite_start: (a: number, b: number) => void;
    readonly sharememberinvite_new: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number) => void;
    readonly sharememberinvite_onResponse: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly sharememberinvite_start: (a: number, b: number) => void;
    readonly signupPolicyRequest: (a: number) => void;
    readonly signupflow_acknowledgePhrase: (a: number, b: number) => void;
    readonly signupflow_adoptPhrase: (a: number, b: number, c: number, d: number) => void;
    readonly signupflow_breachRequest: (a: number, b: number, c: number, d: number) => void;
    readonly signupflow_challengePositions: (a: number, b: number) => void;
    readonly signupflow_confirmPhrase: (a: number, b: number, c: number, d: number) => void;
    readonly signupflow_evaluate: (a: number, b: number, c: number, d: number) => void;
    readonly signupflow_new: (a: number, b: number, c: number, d: number) => void;
    readonly signupflow_onBreachResponse: (a: number, b: number, c: number, d: number) => number;
    readonly signupflow_onCodeSent: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly signupflow_onCodeVerified: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly signupflow_onRegisterFinish: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly signupflow_onRegisterStart: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly signupflow_phraseWords: (a: number, b: number) => void;
    readonly signupflow_registerStart: (a: number, b: number) => void;
    readonly signupflow_sendCode: (a: number, b: number, c: number, d: number) => void;
    readonly signupflow_setPassword: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly signupflow_termsRequest: (a: number, b: number) => void;
    readonly signupflow_verifyCode: (a: number, b: number, c: number, d: number) => void;
    readonly signupflow_wipe: (a: number) => void;
    readonly storageGetTotalMs: (a: number, b: number) => void;
    readonly storagePutTotalMs: (a: number, b: number) => void;
    readonly storage_format_si: (a: number, b: bigint) => void;
    readonly thumbnailBudget: (a: number, b: number, c: number, d: number) => void;
    readonly thumbnailFormat: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly thumbnailPolicy: (a: number, b: number, c: number) => void;
    readonly transfer_decrypt: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly transfer_derive_key: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly transfer_derive_sas_bytes: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly transfer_encrypt: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly transfer_generate_keypair: (a: number) => void;
    readonly transfer_sas_to_words: (a: number, b: number, c: number) => void;
    readonly unwrapFolderChild: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => void;
    readonly unwrapFolderCustody: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly unwrapInviteOwnerCopy: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly unwrapLinkLabel: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly unwrapLinkOwnerKey: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly unwrapLinkOwnerToken: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly unwrapOwnerFileKey: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly unwrap_request_private: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => void;
    readonly wasmaccountkeymaterial_answerRecoveryKeyProof: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => void;
    readonly wasmaccountkeymaterial_answerSessionKeyProof: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => void;
    readonly wasmarchiveextraction_cancel: (a: number) => void;
    readonly wasmarchiveextraction_folderCreated: (a: number, b: number, c: number, d: number) => void;
    readonly wasmarchiveextraction_folderNameTaken: (a: number, b: number) => void;
    readonly wasmarchiveextraction_identitySeen: (a: number, b: number, c: number) => void;
    readonly wasmarchiveextraction_preview: (a: number, b: number, c: number) => void;
    readonly wasmarchiveextraction_releaseBefore: (a: number, b: bigint) => void;
    readonly wasmarchiveextraction_runFailed: (a: number, b: number, c: number, d: number) => void;
    readonly wasmarchiveextraction_step: (a: number, b: number) => void;
    readonly wasmarchiveextraction_supply: (a: number, b: number, c: bigint, d: number, e: number) => void;
    readonly wasmarchiveextraction_supplyPassword: (a: number, b: number, c: number) => void;
    readonly wasmarchiveextraction_uploadFinished: (a: number, b: number, c: number) => void;
    readonly wasmarchivesession_checkPassword: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly wasmarchivesession_listing: (a: number, b: number) => void;
    readonly wasmarchivesession_new: (a: number, b: bigint, c: number, d: number) => void;
    readonly wasmarchivesession_openEntry: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly wasmarchivesession_plan: (a: number, b: number, c: number) => void;
    readonly wasmarchivesession_preview: (a: number, b: number, c: number) => void;
    readonly wasmarchivesession_previewWithPlan: (a: number, b: number, c: number, d: number) => void;
    readonly wasmarchivesession_releaseBefore: (a: number, b: number, c: bigint) => void;
    readonly wasmarchivesession_startExtraction: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly wasmarchivesession_step: (a: number, b: number) => void;
    readonly wasmarchivesession_supply: (a: number, b: number, c: bigint, d: number, e: number) => void;
    readonly wasmbreachcheck_evaluate: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly wasmbreachcheck_new: (a: number, b: number) => number;
    readonly wasmbreachcheck_prefix: (a: number, b: number) => void;
    readonly wasmchunkdecryptor_chunksDecrypted: (a: number) => number;
    readonly wasmchunkdecryptor_finish: (a: number, b: number) => void;
    readonly wasmchunkdecryptor_forVersion: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => void;
    readonly wasmchunkdecryptor_format: (a: number) => number;
    readonly wasmchunkdecryptor_fromFileKey: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly wasmchunkdecryptor_new: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly wasmchunkdecryptor_pushFrame: (a: number, b: number, c: number, d: number) => void;
    readonly wasmchunkdecryptor_versionId: (a: number, b: number) => void;
    readonly wasmchunkencryptor_chunkCount: (a: number) => number;
    readonly wasmchunkencryptor_chunkSize: (a: number) => number;
    readonly wasmchunkencryptor_chunksEmitted: (a: number) => number;
    readonly wasmchunkencryptor_expectedTotalCiphertext: (a: number) => number;
    readonly wasmchunkencryptor_finish: (a: number, b: number) => void;
    readonly wasmchunkencryptor_forNewItem: (a: number, b: number, c: bigint, d: number, e: number) => void;
    readonly wasmchunkencryptor_forTarget: (a: number, b: number, c: bigint, d: number, e: number) => void;
    readonly wasmchunkencryptor_format: (a: number) => number;
    readonly wasmchunkencryptor_new: (a: number, b: number, c: number, d: number, e: number, f: bigint, g: number, h: number) => void;
    readonly wasmchunkencryptor_pushChunk: (a: number, b: number, c: number, d: number) => void;
    readonly wasmchunkencryptor_resumePolicy: (a: number, b: number, c: number) => void;
    readonly wasmchunkencryptor_versionCommitment: (a: number, b: number, c: number, d: number) => void;
    readonly wasmchunkencryptor_withChunkSize: (a: number, b: number, c: number, d: number, e: number, f: bigint, g: bigint) => void;
    readonly wasmchunkencryptor_withRecordedPin: (a: number, b: number, c: number) => void;
    readonly wasmdirectdiscoverycache_lookup: (a: number, b: number, c: number) => void;
    readonly wasmdirectdiscoverycache_new: () => number;
    readonly wasmdirectdiscoverycache_record: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly wasmdirecthealth_gaveUp: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly wasmdirecthealth_lastGaveUpMs: (a: number, b: number, c: number, d: number) => void;
    readonly wasmdirecthealth_mayStart: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly wasmdirecthealth_mayStartFile: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly wasmdirecthealth_new: () => number;
    readonly wasmdirecthealth_restore: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly wasmdownloadplanner_apiFetchFailed: (a: number, b: number, c: number) => void;
    readonly wasmdownloadplanner_chunkLength: (a: number, b: number) => number;
    readonly wasmdownloadplanner_chunkUnauthentic: (a: number, b: number, c: number) => void;
    readonly wasmdownloadplanner_consumed: (a: number, b: number, c: number) => void;
    readonly wasmdownloadplanner_consumedCount: (a: number) => number;
    readonly wasmdownloadplanner_fetchFailed: (a: number, b: number, c: number, d: number) => void;
    readonly wasmdownloadplanner_fetchOk: (a: number, b: number, c: number) => void;
    readonly wasmdownloadplanner_geometry: (a: number, b: number) => void;
    readonly wasmdownloadplanner_inFlight: (a: number) => number;
    readonly wasmdownloadplanner_new: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly wasmdownloadplanner_pinnedVersion: (a: number, b: number) => void;
    readonly wasmdownloadplanner_poll: (a: number, b: number, c: number) => void;
    readonly wasmdownloadplanner_setMaxInFlightBytes: (a: number, b: number, c: number) => void;
    readonly wasmdownloadplanner_storageGivenUp: (a: number) => number;
    readonly wasmdownloadplanner_windowAnswered: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly wasmdownloadplanner_windowFailed: (a: number, b: number, c: number, d: number) => void;
    readonly wasmdownloadplanner_windowMalformed: (a: number) => void;
    readonly wasmextractionplan_kind: (a: number, b: number) => void;
    readonly wasmextractionplan_view: (a: number, b: number) => void;
    readonly wasmnewdevicelink_answerTypedCode: (a: number, b: number, c: number, d: number) => void;
    readonly wasmnewdevicelink_new: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly wasmnewdevicelink_open: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => void;
    readonly wasmnewdevicelink_publicFields: (a: number, b: number) => void;
    readonly wasmnewdevicelink_typedCode: (a: number, b: number) => void;
    readonly wasmnewitemid_idText: (a: number, b: number) => void;
    readonly wasmnewitemid_tag: (a: number, b: number) => void;
    readonly wasmrequestcontentreader_chunkFormat: (a: number) => number;
    readonly wasmrequestcontentreader_decryptor: (a: number) => number;
    readonly wasmrequestcontentreader_fileId: (a: number, b: number) => void;
    readonly wasmrequestcontentreader_openFrame: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => void;
    readonly wasmsearchindex_build: (a: number, b: number, c: number) => void;
    readonly wasmsearchindex_encryptBuckets: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly wasmsearchindex_encryptBucketsWithFolderKey: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly wasmsearchindex_encryptShards: (a: number, b: number, c: number, d: number) => void;
    readonly wasmsearchindex_encryptShardsWithFolderKey: (a: number, b: number, c: number, d: number) => void;
    readonly wasmsearchindex_fileCount: (a: number) => number;
    readonly wasmsearchindex_fromEncryptedShards: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly wasmsearchindex_fromEncryptedShardsWithFolderKey: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly wasmsearchindex_new: (a: number, b: number) => void;
    readonly wasmsearchindex_numShards: (a: number) => number;
    readonly wasmsearchindex_query: (a: number, b: number, c: number, d: number) => void;
    readonly wasmsearchindex_remove: (a: number, b: number, c: number, d: number) => void;
    readonly wasmsearchindex_upsert: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly wasmsignedurl_raw: (a: number, b: number) => void;
    readonly wasmsignedurl_redacted: (a: number, b: number) => void;
    readonly wasmsignupceremony_abandon: (a: number) => void;
    readonly wasmsignupceremony_accountCreated: (a: number, b: number) => void;
    readonly wasmsignupceremony_acknowledgePhrase: (a: number, b: number) => void;
    readonly wasmsignupceremony_adoptPhrase: (a: number, b: number, c: number, d: number) => void;
    readonly wasmsignupceremony_beginPhrase: (a: number, b: number) => void;
    readonly wasmsignupceremony_ceremonyStepOrder: (a: number) => void;
    readonly wasmsignupceremony_challengePositions: (a: number, b: number) => void;
    readonly wasmsignupceremony_confirmPhrase: (a: number, b: number, c: number) => void;
    readonly wasmsignupceremony_emailChanged: (a: number) => void;
    readonly wasmsignupceremony_emailTicketInvalidated: (a: number) => void;
    readonly wasmsignupceremony_emailVerified: (a: number) => void;
    readonly wasmsignupceremony_finishRegistration: (a: number, b: number, c: number, d: number) => void;
    readonly wasmsignupceremony_new: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly wasmsignupceremony_pendingSteps: (a: number, b: number) => void;
    readonly wasmsignupceremony_phrase: (a: number, b: number) => void;
    readonly wasmsignupceremony_registrationFailed: (a: number) => void;
    readonly wasmsignupceremony_setPassword: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly wasmsignupceremony_setPasswordUnchecked: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly wasmsignupceremony_startRegistration: (a: number, b: number) => void;
    readonly wasmsignupceremony_step: (a: number, b: number) => void;
    readonly wasmstoragebody_finish: (a: number, b: number) => void;
    readonly wasmstoragebody_fromHead: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly wasmstoragebody_push: (a: number, b: number, c: number) => void;
    readonly wasmtypedapproval_confirm: (a: number, b: number, c: number, d: number) => void;
    readonly wasmtypedapproval_deviceName: (a: number, b: number) => void;
    readonly wasmtypedapproval_message: (a: number, b: number) => void;
    readonly wasmtypedapproval_new: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly wasmtypedapproval_seal: (a: number, b: number, c: number, d: number) => void;
    readonly wasmtypedreceiver_message: (a: number, b: number) => void;
    readonly wasmtypedreceiver_open: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly wasmwritetarget_itemId: (a: number, b: number) => void;
    readonly wasmwritetarget_pin: (a: number) => number;
    readonly wasmwritetarget_versionCounter: (a: number, b: number) => void;
    readonly wasmwritetarget_versionId: (a: number, b: number) => void;
    readonly wrapFolderChild: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => void;
    readonly wrapFolderCustody: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly wrapInviteOwnerCopy: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly wrapLinkLabel: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly wrapLinkOwnerKey: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly wrapLinkOwnerToken: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly wrapOwnerFileKey: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly wrap_request_private: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly x25519_shared_secret: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly wasmsignedurl_toJSON: (a: number, b: number) => void;
    readonly wasmsignedurl_toString: (a: number, b: number) => void;
    readonly __wbindgen_export: (a: number, b: number) => number;
    readonly __wbindgen_export2: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_export3: (a: number) => void;
    readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
    readonly __wbindgen_export4: (a: number, b: number, c: number) => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
