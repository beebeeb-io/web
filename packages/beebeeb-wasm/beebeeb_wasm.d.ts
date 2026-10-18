/* tslint:disable */
/* eslint-disable */

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
 * Reads v2 (position-bound) and v1 (legacy) files. Both constructors take
 * `expectedChunkFormat` from the file's encrypted metadata
 * (`decrypt_file_metadata(...).chunk_format`; 0 = unrecorded, 2 = v2): with
 * 2 only v2 frames open; with 0 (legacy metadata) chunk 0 decides. In v2 every
 * frame must be the next chunk in order and from the same upload as chunk 0,
 * and nothing may follow the last one; [`finish`] fails if the file ended
 * before its last chunk (truncation). JS must treat any thrown error — from
 * `pushFrame` or `finish` — as a failed download and discard the plaintext it
 * has buffered.
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
     * Decryptor from an already-unwrapped 32-byte file key (share / shared-link
     * recipients). `file_id` must be the id the file was uploaded under.
     */
    static fromFileKey(file_key: Uint8Array, file_id: string, expected_chunk_format: number): WasmChunkDecryptor;
    /**
     * Decryptor for the owner: the file key is derived in core from the
     * 32-byte master key and `file_id`.
     */
    constructor(master_key: Uint8Array, file_id: string, expected_chunk_format: number);
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
     * A v2 pin forces v2 frames even during the read-only phase; 0 keeps the
     * default. Before the first `pushChunk` only; other codes throw. Consumes
     * the old JS object — use the returned one.
     *
     * **New-file rule (lead ruling 2026-10-17):** pass 2 ONLY when it was
     * read from an EXISTING file's authenticated metadata. A brand-new file
     * makes NO call (the default write format applies) and records `format`
     * in its name; passing 2 for a new file would create a v2 file before the
     * switch. Core cannot enforce this; the web client keeps a test that its
     * new-file path never calls this with 2.
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
     * The chunk format this encryptor writes: 1 = v1, 2 = v2 (task 1908).
     * Still 1 during the read-only rollout phase. Record it at upload via
     * `encrypt_name_with_chunk_format` (2 if this is 2, else 0) so readers
     * can pin it.
     */
    readonly format: number;
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
     * Encrypt every non-empty shard page → `[{bucket, page, blob: Uint8Array}]`.
     */
    encryptShards(master_key: Uint8Array): any;
    /**
     * Reconstruct from encrypted shards (`[{bucket, page, blob: Uint8Array}]`),
     * decrypting each with the 32-byte master key.
     */
    static fromEncryptedShards(master_key: Uint8Array, shards: any, num_shards: number): WasmSearchIndex;
    /**
     * Empty index with the given shard count (clamped to ≥ 1).
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
 * The signup ceremony state machine, one per signup attempt.
 *
 * Holds the password, the recovery phrase and the master key inside WASM
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
     * Generate the recovery phrase and master key (Argon2id, about a second).
     * Idempotent.
     */
    beginPhrase(): void;
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
 * Compute recovery check from master key. Returns 32-byte `Uint8Array`.
 */
export function compute_recovery_check(master_key: Uint8Array): Uint8Array;

/**
 * Decompress gzip-compressed data. Returns `Uint8Array`.
 */
export function decompress_gzip(data: Uint8Array): Uint8Array;

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
 * lies about the count fails the tag. `format` (1 = v1, 2 = v2) must come from
 * authenticated data (2 when the encrypted metadata records v2, else a
 * `WasmChunkDecryptor.format` after chunk 0), never from a server field.
 * `version_id` (12 bytes, v2 only; ignored for v1) is `WasmChunkDecryptor.versionId`
 * after chunk 0 (or chunk 0's first 12 bytes): another upload's frames fail.
 */
export function decrypt_chunk_frame(file_key: Uint8Array, file_id: string, version_id: Uint8Array, index: number, is_last: boolean, format: number, frame: Uint8Array): Uint8Array;

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
 * Encrypt a filename (+ MIME) into a `name_encrypted` envelope that also
 * records the file's chunk format (task 1908): `chunk_format` 2 = every upload
 * of this file id is v2, 0 = record nothing (the pre-1908 shape). New file:
 * 2 only if its content was written as v2. Rename / replace: pass the value
 * `decrypt_file_metadata` returned — never upgrade a file with v1 history,
 * never drop a recorded 2.
 */
export function encrypt_name_with_chunk_format(master_key: Uint8Array, file_id: string, filename: string, mime_type: string | null | undefined, chunk_format: number): string;

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
 * Generate a recovery kit PDF with a title, recovery words, and metadata.
 *
 * `metadata_keys` and `metadata_values` are parallel arrays of key-value pairs.
 * Returns the raw PDF bytes as `Uint8Array`.
 */
export function generate_recovery_pdf(title: string, words: any, metadata_keys: any, metadata_values: any): Uint8Array;

/**
 * Generate a new 12-word BIP39 recovery phrase and the corresponding master
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
 * Returns `true` if the given MIME type can be previewed in-app.
 */
export function is_previewable(mime_type?: string | null): boolean;

/**
 * Returns `true` if the file extension indicates a previewable file.
 */
export function is_previewable_by_extension(filename: string): boolean;

/**
 * List entries in an archive, detecting format from the filename extension.
 * Supports `.tar`, `.gz`, `.tgz`, `.tar.gz`.
 * Returns a JS array of `{ name: string, size: number, is_directory: boolean }`.
 */
export function list_archive(data: Uint8Array, filename: string): any;

/**
 * List entries in a TAR archive from raw bytes.
 * Returns a JS array of `{ name: string, size: number, is_directory: boolean }`.
 */
export function list_tar_entries(data: Uint8Array): any;

/**
 * Finish OPAQUE client login. Returns `{ message: Uint8Array, session_key: Uint8Array, export_key: Uint8Array }`.
 *
 * `ksf_version` selects the KSF the account's password file was registered
 * under (0 = legacy Identity KSF, anything else = current Argon2id). The web
 * client reads it from the login-start response (`server_state` JSON) and
 * passes it through verbatim. The KSF must match or finish fails.
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
 * Open a sealed request upload (owner decrypt path). Recovers the content key.
 * `r_priv` and `e_pub` are 32 bytes; `file_id` is arbitrary bytes. Returns 32-byte `Uint8Array`.
 */
export function open_request_upload(r_priv: Uint8Array, e_pub: Uint8Array, file_id: Uint8Array, wrapped_key: Uint8Array): Uint8Array;

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
 * Recover a master key from a 12-word BIP39 recovery phrase.
 * Returns the 32-byte master key as `Uint8Array`.
 */
export function recover_from_phrase(phrase: string): Uint8Array;

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
 * Format a byte count as a human-readable SI string (e.g. "5.0 TB").
 */
export function storage_format_si(bytes: bigint): string;

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

/**
 * Unwrap a request's X25519 private key. Returns 32-byte `Uint8Array`.
 */
export function unwrap_request_private(master_key: Uint8Array, request_id: Uint8Array, wrapped: Uint8Array, nonce: Uint8Array): Uint8Array;

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
    readonly __wbg_wasmbreachcheck_free: (a: number, b: number) => void;
    readonly __wbg_wasmchunkdecryptor_free: (a: number, b: number) => void;
    readonly __wbg_wasmchunkencryptor_free: (a: number, b: number) => void;
    readonly __wbg_wasmsearchindex_free: (a: number, b: number) => void;
    readonly __wbg_wasmsignupceremony_free: (a: number, b: number) => void;
    readonly compute_recovery_check: (a: number, b: number, c: number) => void;
    readonly decompress_gzip: (a: number, b: number, c: number) => void;
    readonly decrypt_chunk: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly decrypt_chunk_frame: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number) => void;
    readonly decrypt_chunks: (a: number, b: number, c: number, d: number) => void;
    readonly decrypt_file_metadata: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly decrypt_file_metadata_with_key: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly decrypt_metadata: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly decrypt_name_metadata: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly decrypt_name_metadata_with_key: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly decrypt_names: (a: number, b: number, c: number, d: number) => void;
    readonly decrypt_note: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly decrypt_thumbnail: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly derive_file_key: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly derive_master_key: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly derive_request_wrap_key: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly derive_share_key: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly derive_x25519_private: (a: number, b: number, c: number) => void;
    readonly derive_x25519_public: (a: number, b: number, c: number) => void;
    readonly encrypt_chunk: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly encrypt_metadata: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly encrypt_name_with_chunk_format: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => void;
    readonly encrypt_note: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly encrypt_note_for: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly encrypt_thumbnail: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly encrypt_thumbnail_for: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly evaluate_password: (a: number, b: number, c: number, d: number) => void;
    readonly generate_recovery_pdf: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly generate_recovery_phrase: (a: number) => void;
    readonly generate_share_token: (a: number) => void;
    readonly is_previewable: (a: number, b: number) => number;
    readonly is_previewable_by_extension: (a: number, b: number) => number;
    readonly list_archive: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly list_tar_entries: (a: number, b: number, c: number) => void;
    readonly opaque_login_finish: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => void;
    readonly opaque_login_start: (a: number, b: number, c: number) => void;
    readonly opaque_registration_finish: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly opaque_registration_start: (a: number, b: number, c: number) => void;
    readonly open_request_upload: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => void;
    readonly plan_base_storage_bytes: (a: number, b: number) => bigint;
    readonly plan_can_add_storage: (a: number, b: number) => number;
    readonly plan_chunks: (a: number, b: bigint, c: number, d: number) => void;
    readonly plan_effective_quota: (a: number, b: number, c: bigint, d: bigint) => bigint;
    readonly plan_max_extra_tb: (a: number, b: number) => bigint;
    readonly plan_monthly_cost_cents: (a: number, b: number, c: bigint, d: bigint) => bigint;
    readonly recover_from_phrase: (a: number, b: number, c: number) => void;
    readonly seal_to_request: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly searchIndexSyncPlan: (a: number, b: number, c: number, d: number) => void;
    readonly storage_format_si: (a: number, b: bigint) => void;
    readonly transfer_decrypt: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly transfer_derive_key: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly transfer_derive_sas_bytes: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly transfer_encrypt: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly transfer_generate_keypair: (a: number) => void;
    readonly transfer_sas_to_words: (a: number, b: number, c: number) => void;
    readonly unwrap_request_private: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => void;
    readonly wasmbreachcheck_evaluate: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly wasmbreachcheck_new: (a: number, b: number) => number;
    readonly wasmbreachcheck_prefix: (a: number, b: number) => void;
    readonly wasmchunkdecryptor_chunksDecrypted: (a: number) => number;
    readonly wasmchunkdecryptor_finish: (a: number, b: number) => void;
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
    readonly wasmchunkencryptor_format: (a: number) => number;
    readonly wasmchunkencryptor_new: (a: number, b: number, c: number, d: number, e: number, f: bigint, g: number, h: number) => void;
    readonly wasmchunkencryptor_pushChunk: (a: number, b: number, c: number, d: number) => void;
    readonly wasmchunkencryptor_resumePolicy: (a: number, b: number, c: number) => void;
    readonly wasmchunkencryptor_withChunkSize: (a: number, b: number, c: number, d: number, e: number, f: bigint, g: bigint) => void;
    readonly wasmchunkencryptor_withRecordedPin: (a: number, b: number, c: number) => void;
    readonly wasmsearchindex_build: (a: number, b: number, c: number) => void;
    readonly wasmsearchindex_encryptBuckets: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly wasmsearchindex_encryptShards: (a: number, b: number, c: number, d: number) => void;
    readonly wasmsearchindex_fileCount: (a: number) => number;
    readonly wasmsearchindex_fromEncryptedShards: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly wasmsearchindex_new: (a: number) => number;
    readonly wasmsearchindex_numShards: (a: number) => number;
    readonly wasmsearchindex_query: (a: number, b: number, c: number, d: number) => void;
    readonly wasmsearchindex_remove: (a: number, b: number, c: number, d: number) => void;
    readonly wasmsearchindex_upsert: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly wasmsignupceremony_abandon: (a: number) => void;
    readonly wasmsignupceremony_accountCreated: (a: number, b: number) => void;
    readonly wasmsignupceremony_acknowledgePhrase: (a: number, b: number) => void;
    readonly wasmsignupceremony_beginPhrase: (a: number, b: number) => void;
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
    readonly wrap_request_private: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly x25519_shared_secret: (a: number, b: number, c: number, d: number, e: number) => void;
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
