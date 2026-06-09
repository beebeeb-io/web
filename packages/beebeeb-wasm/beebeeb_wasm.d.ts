/* tslint:disable */
/* eslint-disable */

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
     * Create a push-form encryptor with an explicit, server-dictated chunk
     * size. Use this when the v2 upload-init response overrode `chunk_size`
     * so the client plan can't diverge from what the server expects.
     */
    static withChunkSize(master_key: Uint8Array, file_id: string, file_size: bigint, chunk_size_bytes: bigint): WasmChunkEncryptor;
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
 */
export function decrypt_chunk(key: Uint8Array, nonce: Uint8Array, ciphertext: Uint8Array): Uint8Array;

/**
 * Decrypt a sequence of encrypted chunks and return the concatenated plaintext.
 * Each chunk is a JS object `{ nonce: Uint8Array, ciphertext: Uint8Array }`.
 * Returns the full plaintext as `Uint8Array`.
 */
export function decrypt_chunks(key: Uint8Array, chunks: any): Uint8Array;

/**
 * Decrypt a metadata blob back to a UTF-8 string.
 */
export function decrypt_metadata(key: Uint8Array, nonce: Uint8Array, ciphertext: Uint8Array): string;

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
 * Format a byte count as a human-readable SI string (e.g. "5.0 TB").
 */
export function storage_format_si(bytes: bigint): string;

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
    readonly __wbg_wasmchunkencryptor_free: (a: number, b: number) => void;
    readonly compute_recovery_check: (a: number, b: number, c: number) => void;
    readonly decompress_gzip: (a: number, b: number, c: number) => void;
    readonly decrypt_chunk: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly decrypt_chunks: (a: number, b: number, c: number, d: number) => void;
    readonly decrypt_metadata: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly derive_file_key: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly derive_master_key: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly derive_request_wrap_key: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly derive_share_key: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly derive_x25519_private: (a: number, b: number, c: number) => void;
    readonly derive_x25519_public: (a: number, b: number, c: number) => void;
    readonly encrypt_chunk: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly encrypt_metadata: (a: number, b: number, c: number, d: number, e: number) => void;
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
    readonly storage_format_si: (a: number, b: bigint) => void;
    readonly unwrap_request_private: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => void;
    readonly wasmchunkencryptor_chunkCount: (a: number) => number;
    readonly wasmchunkencryptor_chunkSize: (a: number) => number;
    readonly wasmchunkencryptor_chunksEmitted: (a: number) => number;
    readonly wasmchunkencryptor_expectedTotalCiphertext: (a: number) => number;
    readonly wasmchunkencryptor_finish: (a: number, b: number) => void;
    readonly wasmchunkencryptor_new: (a: number, b: number, c: number, d: number, e: number, f: bigint, g: number, h: number) => void;
    readonly wasmchunkencryptor_pushChunk: (a: number, b: number, c: number, d: number) => void;
    readonly wasmchunkencryptor_withChunkSize: (a: number, b: number, c: number, d: number, e: number, f: bigint, g: bigint) => void;
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
