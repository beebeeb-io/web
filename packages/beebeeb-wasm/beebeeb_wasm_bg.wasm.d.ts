/* tslint:disable */
/* eslint-disable */
export const memory: WebAssembly.Memory;
export const compute_recovery_check: (a: number, b: number) => [number, number, number, number];
export const decrypt_chunk: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
export const decrypt_metadata: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
export const derive_file_key: (a: number, b: number, c: number, d: number) => [number, number, number, number];
export const derive_master_key: (a: number, b: number, c: number, d: number) => [number, number, number];
export const derive_share_key: (a: number, b: number, c: number, d: number) => [number, number, number, number];
export const derive_x25519_private: (a: number, b: number) => [number, number, number, number];
export const derive_x25519_public: (a: number, b: number) => [number, number, number, number];
export const encrypt_chunk: (a: number, b: number, c: number, d: number) => [number, number, number];
export const encrypt_metadata: (a: number, b: number, c: number, d: number) => [number, number, number];
export const generate_recovery_phrase: () => [number, number, number];
export const opaque_login_finish: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
export const opaque_login_start: (a: number, b: number) => [number, number, number];
export const opaque_registration_finish: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
export const opaque_registration_start: (a: number, b: number) => [number, number, number];
export const recover_from_phrase: (a: number, b: number) => [number, number, number, number];
export const x25519_shared_secret: (a: number, b: number, c: number, d: number) => [number, number, number, number];
export const __wbindgen_malloc: (a: number, b: number) => number;
export const __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
export const __wbindgen_exn_store: (a: number) => void;
export const __externref_table_alloc: () => number;
export const __wbindgen_externrefs: WebAssembly.Table;
export const __externref_table_dealloc: (a: number) => void;
export const __wbindgen_free: (a: number, b: number, c: number) => void;
export const __wbindgen_start: () => void;
