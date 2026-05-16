/* tslint:disable */
/* eslint-disable */

/**
 * Compute recovery check from master key. Returns 32-byte `Uint8Array`.
 */
export function compute_recovery_check(master_key: Uint8Array): Uint8Array;

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
 * Generate a new 12-word BIP39 recovery phrase and the corresponding master
 * key. Returns `{ phrase: string, master_key: Uint8Array }`.
 */
export function generate_recovery_phrase(): any;

/**
 * Returns `true` if the given MIME type can be previewed in-app.
 */
export function is_previewable(mime_type?: string | null): boolean;

/**
 * Returns `true` if the file extension indicates a previewable file.
 */
export function is_previewable_by_extension(filename: string): boolean;

/**
 * Finish OPAQUE client login. Returns `{ message: Uint8Array, session_key: Uint8Array, export_key: Uint8Array }`.
 */
export function opaque_login_finish(client_state: Uint8Array, password: Uint8Array, server_response: Uint8Array): any;

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
 * Format a byte count as a human-readable SI string (e.g. "5.0 TB").
 */
export function storage_format_si(bytes: bigint): string;

/**
 * Compute X25519 shared secret for sharing. Returns 32-byte `Uint8Array`.
 */
export function x25519_shared_secret(my_private: Uint8Array, their_public: Uint8Array): Uint8Array;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly compute_recovery_check: (a: number, b: number) => [number, number, number, number];
    readonly decrypt_chunk: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
    readonly decrypt_chunks: (a: number, b: number, c: any) => [number, number, number, number];
    readonly decrypt_metadata: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
    readonly derive_file_key: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly derive_master_key: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly derive_share_key: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly derive_x25519_private: (a: number, b: number) => [number, number, number, number];
    readonly derive_x25519_public: (a: number, b: number) => [number, number, number, number];
    readonly encrypt_chunk: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly encrypt_metadata: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly generate_recovery_phrase: () => [number, number, number];
    readonly is_previewable: (a: number, b: number) => number;
    readonly is_previewable_by_extension: (a: number, b: number) => number;
    readonly opaque_login_finish: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly opaque_login_start: (a: number, b: number) => [number, number, number];
    readonly opaque_registration_finish: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
    readonly opaque_registration_start: (a: number, b: number) => [number, number, number];
    readonly plan_base_storage_bytes: (a: number, b: number) => bigint;
    readonly plan_can_add_storage: (a: number, b: number) => number;
    readonly plan_chunks: (a: bigint, b: number, c: number) => [number, number, number];
    readonly plan_effective_quota: (a: number, b: number, c: bigint, d: bigint) => bigint;
    readonly plan_max_extra_tb: (a: number, b: number) => bigint;
    readonly plan_monthly_cost_cents: (a: number, b: number, c: bigint, d: bigint) => bigint;
    readonly recover_from_phrase: (a: number, b: number) => [number, number, number, number];
    readonly storage_format_si: (a: bigint) => [number, number];
    readonly x25519_shared_secret: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
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
