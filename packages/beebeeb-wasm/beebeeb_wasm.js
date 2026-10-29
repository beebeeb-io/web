/* @ts-self-types="./beebeeb_wasm.d.ts" */

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
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmBreachCheckFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmbreachcheck_free(ptr, 0);
    }
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
     * @param {string} requested_prefix
     * @param {string | null | undefined} body
     * @param {boolean} fail_open
     * @returns {any}
     */
    evaluate(requested_prefix, body, fail_open) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(requested_prefix, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            var ptr1 = isLikeNone(body) ? 0 : passStringToWasm0(body, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            var len1 = WASM_VECTOR_LEN;
            wasm.wasmbreachcheck_evaluate(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1, fail_open);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            return takeObject(r0);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * @param {string} password
     */
    constructor(password) {
        const ptr0 = passStringToWasm0(password, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmbreachcheck_new(ptr0, len0);
        this.__wbg_ptr = ret >>> 0;
        WasmBreachCheckFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * The 5 upper-case hex characters to send to the server.
     * @returns {string}
     */
    get prefix() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.wasmbreachcheck_prefix(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred1_0, deferred1_1, 1);
        }
    }
}
if (Symbol.dispose) WasmBreachCheck.prototype[Symbol.dispose] = WasmBreachCheck.prototype.free;

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
    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(WasmChunkDecryptor.prototype);
        obj.__wbg_ptr = ptr;
        WasmChunkDecryptorFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmChunkDecryptorFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmchunkdecryptor_free(ptr, 0);
    }
    /**
     * How many frames have been decrypted so far.
     * @returns {number}
     */
    get chunksDecrypted() {
        const ret = wasm.wasmchunkdecryptor_chunksDecrypted(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Consume the decryptor and run the end-of-stream check. Throws if no frame
     * was pushed or a v2 file ended before its last chunk. Returns
     * `{ chunk_count, format }`.
     * @returns {any}
     */
    finish() {
        try {
            const ptr = this.__destroy_into_raw();
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.wasmchunkdecryptor_finish(retptr, ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            return takeObject(r0);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * The file's chunk format once chunk 0 has been opened: 1 = v1, 2 = v2;
     * 0 before the first frame.
     * @returns {number}
     */
    get format() {
        const ret = wasm.wasmchunkdecryptor_format(this.__wbg_ptr);
        return ret;
    }
    /**
     * Decryptor from an already-unwrapped 32-byte file key (share / shared-link
     * recipients). `file_id` must be the id the file was uploaded under.
     * @param {Uint8Array} file_key
     * @param {string} file_id
     * @param {number} expected_chunk_format
     * @returns {WasmChunkDecryptor}
     */
    static fromFileKey(file_key, file_id, expected_chunk_format) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passArray8ToWasm0(file_key, wasm.__wbindgen_export);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(file_id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len1 = WASM_VECTOR_LEN;
            wasm.wasmchunkdecryptor_fromFileKey(retptr, ptr0, len0, ptr1, len1, expected_chunk_format);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            return WasmChunkDecryptor.__wrap(r0);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Decryptor for the owner: the file key is derived in core from the
     * 32-byte master key and `file_id`.
     * @param {Uint8Array} master_key
     * @param {string} file_id
     * @param {number} expected_chunk_format
     */
    constructor(master_key, file_id, expected_chunk_format) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passArray8ToWasm0(master_key, wasm.__wbindgen_export);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(file_id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len1 = WASM_VECTOR_LEN;
            wasm.wasmchunkdecryptor_new(retptr, ptr0, len0, ptr1, len1, expected_chunk_format);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            this.__wbg_ptr = r0 >>> 0;
            WasmChunkDecryptorFinalization.register(this, this.__wbg_ptr, this);
            return this;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Decrypt the next wire frame (`nonce(12) || ciphertext || tag(16)`),
     * returning its plaintext. Frames must be pushed in order from chunk 0.
     * @param {Uint8Array} frame
     * @returns {Uint8Array}
     */
    pushFrame(frame) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passArray8ToWasm0(frame, wasm.__wbindgen_export);
            const len0 = WASM_VECTOR_LEN;
            wasm.wasmchunkdecryptor_pushFrame(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            if (r3) {
                throw takeObject(r2);
            }
            var v2 = getArrayU8FromWasm0(r0, r1).slice();
            wasm.__wbindgen_export4(r0, r1 * 1, 1);
            return v2;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * v2: the upload's version id (chunk 0's 12-byte nonce) once chunk 0 has
     * authenticated — what a seeking reader passes to `decrypt_chunk_frame`.
     * `undefined` before chunk 0 and for v1 files.
     * @returns {Uint8Array | undefined}
     */
    get versionId() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.wasmchunkdecryptor_versionId(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            let v1;
            if (r0 !== 0) {
                v1 = getArrayU8FromWasm0(r0, r1).slice();
                wasm.__wbindgen_export4(r0, r1 * 1, 1);
            }
            return v1;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
}
if (Symbol.dispose) WasmChunkDecryptor.prototype[Symbol.dispose] = WasmChunkDecryptor.prototype.free;

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
    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(WasmChunkEncryptor.prototype);
        obj.__wbg_ptr = ptr;
        WasmChunkEncryptorFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmChunkEncryptorFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmchunkencryptor_free(ptr, 0);
    }
    /**
     * Planned number of chunks for this file.
     * @returns {number}
     */
    get chunkCount() {
        const ret = wasm.wasmchunkencryptor_chunkCount(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Plaintext chunk size in bytes (the last chunk may be smaller). Returned
     * as a JS number (`f64`) to avoid `BigInt` at the boundary.
     * @returns {number}
     */
    get chunkSize() {
        const ret = wasm.wasmchunkencryptor_chunkSize(this.__wbg_ptr);
        return ret;
    }
    /**
     * How many chunks have been pushed so far.
     * @returns {number}
     */
    get chunksEmitted() {
        const ret = wasm.wasmchunkencryptor_chunksEmitted(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Expected total ciphertext bytes (`file_size + 28 * chunk_count`), the
     * value the client passes to `upload_init` as the total. Returned as a JS
     * number (`f64`).
     * @returns {number}
     */
    get expectedTotalCiphertext() {
        const ret = wasm.wasmchunkencryptor_expectedTotalCiphertext(this.__wbg_ptr);
        return ret;
    }
    /**
     * Consume the encryptor, run the integrity guard (all planned chunks
     * emitted and the ciphertext total matches), and return the summary
     * `{ chunk_count, total_plaintext, total_ciphertext, chunk_size_bytes }`.
     * Errors if the source shrank (fewer chunks/bytes than planned).
     * @returns {any}
     */
    finish() {
        try {
            const ptr = this.__destroy_into_raw();
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.wasmchunkencryptor_finish(retptr, ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            return takeObject(r0);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * The chunk format this encryptor writes: 1 = v1, 2 = v2 (task 1908).
     * Still 1 during the read-only rollout phase. Record it at upload via
     * `encrypt_name_with_chunk_format` (2 if this is 2, else 0) so readers
     * can pin it.
     * @returns {number}
     */
    get format() {
        const ret = wasm.wasmchunkencryptor_format(this.__wbg_ptr);
        return ret;
    }
    /**
     * Create a push-form encryptor whose chunk plan is derived from
     * `file_size` + `profile` (the client ladder).
     *
     * `master_key` must be exactly 32 bytes; it is copied into a `MasterKey`
     * (zeroized on drop). `profile` is one of `"desktop"`, `"web"`, `"mobile"`,
     * `"backup"`.
     * @param {Uint8Array} master_key
     * @param {string} file_id
     * @param {bigint} file_size
     * @param {string} profile
     */
    constructor(master_key, file_id, file_size, profile) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passArray8ToWasm0(master_key, wasm.__wbindgen_export);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(file_id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len1 = WASM_VECTOR_LEN;
            const ptr2 = passStringToWasm0(profile, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len2 = WASM_VECTOR_LEN;
            wasm.wasmchunkencryptor_new(retptr, ptr0, len0, ptr1, len1, file_size, ptr2, len2);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            this.__wbg_ptr = r0 >>> 0;
            WasmChunkEncryptorFinalization.register(this, this.__wbg_ptr, this);
            return this;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Encrypt one plaintext chunk and return the full wire frame
     * (`nonce(12) || ciphertext || tag(16)`) for JS to PUT directly — no
     * recombination needed on the JS side. Errors if more chunks are pushed
     * than the plan allows.
     * @param {Uint8Array} plaintext
     * @returns {Uint8Array}
     */
    pushChunk(plaintext) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passArray8ToWasm0(plaintext, wasm.__wbindgen_export);
            const len0 = WASM_VECTOR_LEN;
            wasm.wasmchunkencryptor_pushChunk(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            if (r3) {
                throw takeObject(r2);
            }
            var v2 = getArrayU8FromWasm0(r0, r1).slice();
            wasm.__wbindgen_export4(r0, r1 * 1, 1);
            return v2;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
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
     * @param {number | null} [stored_format]
     * @returns {string}
     */
    resumePolicy(stored_format) {
        let deferred2_0;
        let deferred2_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.wasmchunkencryptor_resumePolicy(retptr, this.__wbg_ptr, isLikeNone(stored_format) ? 0xFFFFFF : stored_format);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr1 = r0;
            var len1 = r1;
            if (r3) {
                ptr1 = 0; len1 = 0;
                throw takeObject(r2);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * Create a push-form encryptor with an explicit, server-dictated chunk
     * size. Use this when the v2 upload-init response overrode `chunk_size`
     * so the client plan can't diverge from what the server expects.
     * @param {Uint8Array} master_key
     * @param {string} file_id
     * @param {bigint} file_size
     * @param {bigint} chunk_size_bytes
     * @returns {WasmChunkEncryptor}
     */
    static withChunkSize(master_key, file_id, file_size, chunk_size_bytes) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passArray8ToWasm0(master_key, wasm.__wbindgen_export);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(file_id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len1 = WASM_VECTOR_LEN;
            wasm.wasmchunkencryptor_withChunkSize(retptr, ptr0, len0, ptr1, len1, file_size, chunk_size_bytes);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            return WasmChunkEncryptor.__wrap(r0);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
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
     * @param {number} recorded_pin
     * @returns {WasmChunkEncryptor}
     */
    withRecordedPin(recorded_pin) {
        try {
            const ptr = this.__destroy_into_raw();
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.wasmchunkencryptor_withRecordedPin(retptr, ptr, recorded_pin);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            return WasmChunkEncryptor.__wrap(r0);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
}
if (Symbol.dispose) WasmChunkEncryptor.prototype[Symbol.dispose] = WasmChunkEncryptor.prototype.free;

/**
 * How long a discovery answer is trusted, and whether to ask again: one per API base.
 * `lookup(nowMs)` is `{ kind: "fetch" | "cached" | "use_api", discovery? }`;
 * `record(outcome, body, nowMs)` takes the `classifyDirectAnswer` result and the
 * discovery body (or `null`).
 */
export class WasmDirectDiscoveryCache {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmDirectDiscoveryCacheFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmdirectdiscoverycache_free(ptr, 0);
    }
    /**
     * @param {number} now_ms
     * @returns {any}
     */
    lookup(now_ms) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.wasmdirectdiscoverycache_lookup(retptr, this.__wbg_ptr, now_ms);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            return takeObject(r0);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    constructor() {
        const ret = wasm.wasmdirectdiscoverycache_new();
        this.__wbg_ptr = ret >>> 0;
        WasmDirectDiscoveryCacheFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @param {any} outcome
     * @param {Uint8Array | null | undefined} body
     * @param {number} now_ms
     */
    record(outcome, body, now_ms) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            var ptr0 = isLikeNone(body) ? 0 : passArray8ToWasm0(body, wasm.__wbindgen_export);
            var len0 = WASM_VECTOR_LEN;
            wasm.wasmdirectdiscoverycache_record(retptr, this.__wbg_ptr, addHeapObject(outcome), ptr0, len0, now_ms);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
}
if (Symbol.dispose) WasmDirectDiscoveryCache.prototype[Symbol.dispose] = WasmDirectDiscoveryCache.prototype.free;

/**
 * Whether this client may start a direct transfer now, per direction: after a transfer gave up direct,
 * no new one of that direction starts for ten minutes. One per API base and account; feed it
 * `Date.now()` (or a monotonic clock, consistently). `lastGaveUpMs` / `restore` let a client persist the
 * two timestamps. A recorded time later than "now" counts as expired.
 */
export class WasmDirectHealth {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmDirectHealthFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmdirecthealth_free(ptr, 0);
    }
    /**
     * A transfer of `direction` gave up direct. Throws `direction_invalid` for anything but
     * `"download"` or `"upload"` (as every method here does).
     * @param {string} direction
     * @param {number} now_ms
     */
    gaveUp(direction, now_ms) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(direction, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.wasmdirecthealth_gaveUp(retptr, this.__wbg_ptr, ptr0, len0, now_ms);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * When the last give-up of `direction` was recorded, or `null`.
     * @param {string} direction
     * @returns {number | undefined}
     */
    lastGaveUpMs(direction) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-32);
            const ptr0 = passStringToWasm0(direction, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.wasmdirecthealth_lastGaveUpMs(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r2 = getDataViewMemory0().getFloat64(retptr + 8 * 1, true);
            var r4 = getDataViewMemory0().getInt32(retptr + 4 * 4, true);
            var r5 = getDataViewMemory0().getInt32(retptr + 4 * 5, true);
            if (r5) {
                throw takeObject(r4);
            }
            return r0 === 0 ? undefined : r2;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(32);
        }
    }
    /**
     * May a new direct transfer of `direction` start now?
     * @param {string} direction
     * @param {number} now_ms
     * @returns {boolean}
     */
    mayStart(direction, now_ms) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(direction, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.wasmdirecthealth_mayStart(retptr, this.__wbg_ptr, ptr0, len0, now_ms);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            return r0 !== 0;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * As `mayStart`, for a file that may already have given up direct: it never may again (`fileGaveUp`).
     * @param {string} direction
     * @param {number} now_ms
     * @param {boolean} file_gave_up
     * @returns {boolean}
     */
    mayStartFile(direction, now_ms, file_gave_up) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(direction, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.wasmdirecthealth_mayStartFile(retptr, this.__wbg_ptr, ptr0, len0, now_ms, file_gave_up);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            return r0 !== 0;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    constructor() {
        const ret = wasm.wasmdirecthealth_new();
        this.__wbg_ptr = ret >>> 0;
        WasmDirectHealthFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Put back a timestamp `lastGaveUpMs` returned earlier.
     * @param {string} direction
     * @param {number} last_gave_up_ms
     */
    restore(direction, last_gave_up_ms) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(direction, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.wasmdirecthealth_restore(retptr, this.__wbg_ptr, ptr0, len0, last_gave_up_ms);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
}
if (Symbol.dispose) WasmDirectHealth.prototype[Symbol.dispose] = WasmDirectHealth.prototype.free;

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
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmDownloadPlannerFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmdownloadplanner_free(ptr, 0);
    }
    /**
     * The pinned API route failed for chunk `index` after the caller's own retries.
     * @param {number} index
     */
    apiFetchFailed(index) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.wasmdownloadplanner_apiFetchFailed(retptr, this.__wbg_ptr, index);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * The ciphertext length of chunk `index` once the first window was accepted, else `null`.
     * The link's `length` is this number; the caller checks a storage answer against it.
     * @param {number} index
     * @returns {number | null}
     */
    chunkLength(index) {
        const ret = wasm.wasmdownloadplanner_chunkLength(this.__wbg_ptr, index);
        return takeObject(ret);
    }
    /**
     * Chunk `index` arrived but did not authenticate when decrypted.
     * @param {number} index
     */
    chunkUnauthentic(index) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.wasmdownloadplanner_chunkUnauthentic(retptr, this.__wbg_ptr, index);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Chunk `index` has been decrypted and written. Strictly in order.
     * @param {number} index
     */
    consumed(index) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.wasmdownloadplanner_consumed(retptr, this.__wbg_ptr, index);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Chunks decrypted and written so far.
     * @returns {number}
     */
    consumedCount() {
        const ret = wasm.wasmdownloadplanner_consumedCount(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * The transfer of chunk `index` from storage failed (any non-200, a short
     * body, a wrong length, a network error, an expired link).
     * @param {number} index
     * @param {number} now_ms
     */
    fetchFailed(index, now_ms) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.wasmdownloadplanner_fetchFailed(retptr, this.__wbg_ptr, index, now_ms);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Chunk `index` arrived whole (status 200 and the right length).
     * @param {number} index
     */
    fetchOk(index) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.wasmdownloadplanner_fetchOk(retptr, this.__wbg_ptr, index);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * `{ chunk_count, chunk_size, encrypted_size, original_size }` once the
     * first window was accepted, else `null`.
     * @returns {any}
     */
    geometry() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.wasmdownloadplanner_geometry(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            return takeObject(r0);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Chunk requests (storage or API) currently outstanding.
     * @returns {number}
     */
    inFlight() {
        const ret = wasm.wasmdownloadplanner_inFlight(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * `discovery` is the object `parseDirectDiscovery` returned; `jitter_seed` is any number.
     * The seed is the number's IEEE-754 bits (`f64::to_bits`): `Math.random()` is fine, every
     * distinct number is a distinct seed (so two tabs do not share a retry schedule), the same
     * number repeats its schedule, and `0` and `-0` are two seeds. It is not a secret.
     * @param {any} discovery
     * @param {string} api_base
     * @param {string} file_id
     * @param {number} jitter_seed
     */
    constructor(discovery, api_base, file_id, jitter_seed) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(api_base, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(file_id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len1 = WASM_VECTOR_LEN;
            wasm.wasmdownloadplanner_new(retptr, addHeapObject(discovery), ptr0, len0, ptr1, len1, jitter_seed);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            this.__wbg_ptr = r0 >>> 0;
            WasmDownloadPlannerFinalization.register(this, this.__wbg_ptr, this);
            return this;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * The pinned `object_version_id`, or `null` before the first window.
     * @returns {string | undefined}
     */
    pinnedVersion() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.wasmdownloadplanner_pinnedVersion(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            let v1;
            if (r0 !== 0) {
                v1 = getStringFromWasm0(r0, r1).slice();
                wasm.__wbindgen_export4(r0, r1 * 1, 1);
            }
            return v1;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * What to do now: a `DirectPoll` (`{ kind, ... }`, see the class docs). For `kind: "fetch"` the
     * `url` is a `WasmSignedUrl`, not a string: pass `url.raw()` to `fetch` and nothing else.
     * @param {number} now_ms
     * @returns {DirectPoll}
     */
    poll(now_ms) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.wasmdownloadplanner_poll(retptr, this.__wbg_ptr, now_ms);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            return takeObject(r0);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Cap the ciphertext bytes held at once (fetching, or fetched and waiting to be decrypted in order):
     * the planner then holds `clamp(floor(bytes / (chunk_size + 28)), 1, 4)` chunks, so 64 MiB holds four
     * chunks of 4 MiB but one of 256 MiB. Call it before the first `poll`. Throws `bytes_invalid` for a
     * number that is not a whole, non-negative byte count.
     * @param {number} bytes
     */
    setMaxInFlightBytes(bytes) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.wasmdownloadplanner_setMaxInFlightBytes(retptr, this.__wbg_ptr, bytes);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Did the storage breaker trip? It does when a chunk used up its renewals and no chunk of this
     * transfer has come whole from storage: from then on every remaining chunk is a `fetch_via_api` poll.
     * When the file ends with this `true`, tell `WasmDirectHealth.gaveUp("download", nowMs)`.
     * @returns {boolean}
     */
    storageGivenUp() {
        const ret = wasm.wasmdownloadplanner_storageGivenUp(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * The window answer for the outstanding request, as the raw response body
     * (`Uint8Array`). Returns `"accepted"`, `"malformed"` (the body is not the
     * contract's JSON; handled like any window the server could not serve), or
     * the code of the contract violation (`transport`, `file_mismatch`,
     * `version_changed`, `geometry`, `grants`, `length`, `method`,
     * `authority_<refusal>`, `expiry`, `unexpected`). It never throws: poll
     * again.
     * @param {Uint8Array} body
     * @param {number} now_ms
     * @returns {string}
     */
    windowAnswered(body, now_ms) {
        let deferred2_0;
        let deferred2_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passArray8ToWasm0(body, wasm.__wbindgen_export);
            const len0 = WASM_VECTOR_LEN;
            wasm.wasmdownloadplanner_windowAnswered(retptr, this.__wbg_ptr, ptr0, len0, now_ms);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred2_0 = r0;
            deferred2_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * The window request failed. `outcome` is what `classifyDirectAnswer`
     * returned for the answer (or `{ kind: "use_api_now" }` for a network
     * error).
     * @param {any} outcome
     * @param {number} now_ms
     */
    windowFailed(outcome, now_ms) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.wasmdownloadplanner_windowFailed(retptr, this.__wbg_ptr, addHeapObject(outcome), now_ms);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * A 2xx window response whose body could not be decoded at all.
     */
    windowMalformed() {
        wasm.wasmdownloadplanner_windowMalformed(this.__wbg_ptr);
    }
}
if (Symbol.dispose) WasmDownloadPlanner.prototype[Symbol.dispose] = WasmDownloadPlanner.prototype.free;

/**
 * A stateful, client-side search index over a vault's file names.
 *
 * Build it from a file list, mutate it incrementally (`upsert`/`remove` return
 * the dirty bucket set as a `Uint32Array`), query it (returns a `string[]` of
 * file_ids), and (de)serialize it to encrypted shards for sync. The master key
 * crosses as 32 raw bytes; crypto runs in core.
 */
export class WasmSearchIndex {
    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(WasmSearchIndex.prototype);
        obj.__wbg_ptr = ptr;
        WasmSearchIndexFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmSearchIndexFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmsearchindex_free(ptr, 0);
    }
    /**
     * Build from `files` — a JS array of `{ fileId, name }` objects.
     * @param {any} files
     * @param {number} num_shards
     * @returns {WasmSearchIndex}
     */
    static build(files, num_shards) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.wasmsearchindex_build(retptr, addHeapObject(files), num_shards);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            return WasmSearchIndex.__wrap(r0);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Encrypt only the given buckets (incremental sync) — pass the dirty set.
     * @param {Uint8Array} master_key
     * @param {Uint32Array} buckets
     * @returns {any}
     */
    encryptBuckets(master_key, buckets) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passArray8ToWasm0(master_key, wasm.__wbindgen_export);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passArray32ToWasm0(buckets, wasm.__wbindgen_export);
            const len1 = WASM_VECTOR_LEN;
            wasm.wasmsearchindex_encryptBuckets(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            return takeObject(r0);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Encrypt only the given buckets under the folder key (incremental sync).
     * @param {Uint8Array} folder_key
     * @param {Uint32Array} buckets
     * @returns {any}
     */
    encryptBucketsWithFolderKey(folder_key, buckets) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passArray8ToWasm0(folder_key, wasm.__wbindgen_export);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passArray32ToWasm0(buckets, wasm.__wbindgen_export);
            const len1 = WASM_VECTOR_LEN;
            wasm.wasmsearchindex_encryptBucketsWithFolderKey(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            return takeObject(r0);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Encrypt every non-empty shard page → `[{bucket, page, blob: Uint8Array}]`.
     * @param {Uint8Array} master_key
     * @returns {any}
     */
    encryptShards(master_key) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passArray8ToWasm0(master_key, wasm.__wbindgen_export);
            const len0 = WASM_VECTOR_LEN;
            wasm.wasmsearchindex_encryptShards(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            return takeObject(r0);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Encrypt every non-empty shard page under the folder key.
     * @param {Uint8Array} folder_key
     * @returns {any}
     */
    encryptShardsWithFolderKey(folder_key) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passArray8ToWasm0(folder_key, wasm.__wbindgen_export);
            const len0 = WASM_VECTOR_LEN;
            wasm.wasmsearchindex_encryptShardsWithFolderKey(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            return takeObject(r0);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Number of indexed files.
     * @returns {number}
     */
    get fileCount() {
        const ret = wasm.wasmsearchindex_fileCount(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Reconstruct from encrypted shards (`[{bucket, page, blob: Uint8Array}]`),
     * decrypting each with the 32-byte master key.
     * @param {Uint8Array} master_key
     * @param {any} shards
     * @param {number} num_shards
     * @returns {WasmSearchIndex}
     */
    static fromEncryptedShards(master_key, shards, num_shards) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passArray8ToWasm0(master_key, wasm.__wbindgen_export);
            const len0 = WASM_VECTOR_LEN;
            wasm.wasmsearchindex_fromEncryptedShards(retptr, ptr0, len0, addHeapObject(shards), num_shards);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            return WasmSearchIndex.__wrap(r0);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Reconstruct a shared folder's index from shards sealed under the folder
     * key (`encryptShardsWithFolderKey` output).
     * @param {Uint8Array} folder_key
     * @param {any} shards
     * @param {number} num_shards
     * @returns {WasmSearchIndex}
     */
    static fromEncryptedShardsWithFolderKey(folder_key, shards, num_shards) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passArray8ToWasm0(folder_key, wasm.__wbindgen_export);
            const len0 = WASM_VECTOR_LEN;
            wasm.wasmsearchindex_fromEncryptedShardsWithFolderKey(retptr, ptr0, len0, addHeapObject(shards), num_shards);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            return WasmSearchIndex.__wrap(r0);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Empty index with 1–64 shards (zero is clamped to 1).
     * @param {number} num_shards
     */
    constructor(num_shards) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.wasmsearchindex_new(retptr, num_shards);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            this.__wbg_ptr = r0 >>> 0;
            WasmSearchIndexFinalization.register(this, this.__wbg_ptr, this);
            return this;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Shard count this index uses.
     * @returns {number}
     */
    get numShards() {
        const ret = wasm.wasmsearchindex_numShards(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Search; returns the matching file_ids as a `string[]`.
     * @param {string} term
     * @returns {string[]}
     */
    query(term) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(term, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.wasmsearchindex_query(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var v2 = getArrayJsValueFromWasm0(r0, r1).slice();
            wasm.__wbindgen_export4(r0, r1 * 4, 4);
            return v2;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Remove a file. Returns the dirty bucket set (`Uint32Array`).
     * @param {string} file_id
     * @returns {Uint32Array}
     */
    remove(file_id) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(file_id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.wasmsearchindex_remove(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var v2 = getArrayU32FromWasm0(r0, r1).slice();
            wasm.__wbindgen_export4(r0, r1 * 4, 4);
            return v2;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Insert or update a file. Returns the dirty bucket set (`Uint32Array`).
     * @param {string} file_id
     * @param {string} name
     * @returns {Uint32Array}
     */
    upsert(file_id, name) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(file_id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(name, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len1 = WASM_VECTOR_LEN;
            wasm.wasmsearchindex_upsert(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var v3 = getArrayU32FromWasm0(r0, r1).slice();
            wasm.__wbindgen_export4(r0, r1 * 4, 4);
            return v3;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
}
if (Symbol.dispose) WasmSearchIndex.prototype[Symbol.dispose] = WasmSearchIndex.prototype.free;

/**
 * A presigned storage link as the `fetch` step carries it: a bearer capability until it expires. It
 * is an object, not a string, so that `console.log`, `String(url)`, a template literal and
 * `JSON.stringify(step)` can never show it: all of them give the redacted form (scheme and host).
 * The only way to the link is `raw()`, by name.
 */
export class WasmSignedUrl {
    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(WasmSignedUrl.prototype);
        obj.__wbg_ptr = ptr;
        WasmSignedUrlFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmSignedUrlFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmsignedurl_free(ptr, 0);
    }
    /**
     * The full presigned link, to hand to `fetch`. Never log it.
     * @returns {string}
     */
    raw() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.wasmsignedurl_raw(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * Scheme and host only: safe for a log line.
     * @returns {string}
     */
    redacted() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.wasmsignedurl_redacted(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * `JSON.stringify(step)`.
     * @returns {string}
     */
    toJSON() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.wasmsignedurl_toJSON(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * `String(url)` and template literals.
     * @returns {string}
     */
    toString() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.wasmsignedurl_toString(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred1_0, deferred1_1, 1);
        }
    }
}
if (Symbol.dispose) WasmSignedUrl.prototype[Symbol.dispose] = WasmSignedUrl.prototype.free;

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
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmSignupCeremonyFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmsignupceremony_free(ptr, 0);
    }
    /**
     * Abandon the signup: wipe the password, phrase and master key and return
     * to a fresh ceremony. Call on back, cancel and error exits.
     */
    abandon() {
        wasm.wasmsignupceremony_abandon(this.__wbg_ptr);
    }
    /**
     * The server accepted `register-finish`. Returns the 32-byte master key as
     * `Uint8Array`; the caller owns it and must wipe it when done (the same
     * contract as `generate_recovery_phrase`). The ceremony wipes the rest.
     * The only Rust-side copy of the key is a `Zeroizing` temporary that is
     * wiped as soon as the bytes have been copied into the JS array.
     * @returns {Uint8Array}
     */
    accountCreated() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.wasmsignupceremony_accountCreated(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            return takeObject(r0);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * The user confirms they saved the phrase.
     */
    acknowledgePhrase() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.wasmsignupceremony_acknowledgePhrase(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Generate the recovery phrase and master key (Argon2id, about a second).
     * Idempotent.
     */
    beginPhrase() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.wasmsignupceremony_beginPhrase(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * 1-based word positions to ask for, ascending, stable for this phrase.
     * @returns {Uint32Array}
     */
    challengePositions() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.wasmsignupceremony_challengePositions(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            if (r3) {
                throw takeObject(r2);
            }
            var v1 = getArrayU32FromWasm0(r0, r1).slice();
            wasm.__wbindgen_export4(r0, r1 * 4, 4);
            return v1;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * `answers`: array of strings in `challengePositions` order. Throws
     * `phrase_word_mismatch` / `phrase_answer_count`; retryable.
     * @param {Array<any>} answers
     */
    confirmPhrase(answers) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.wasmsignupceremony_confirmPhrase(retptr, this.__wbg_ptr, addHeapObject(answers));
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * The user changed the email address after it was verified: back to the
     * code step, password and confirmed phrase kept.
     */
    emailChanged() {
        wasm.wasmsignupceremony_emailChanged(this.__wbg_ptr);
    }
    /**
     * The server reported the signup ticket expired: back to the code step,
     * password and confirmed phrase kept.
     */
    emailTicketInvalidated() {
        wasm.wasmsignupceremony_emailTicketInvalidated(this.__wbg_ptr);
    }
    /**
     * The server accepted the email code.
     */
    emailVerified() {
        wasm.wasmsignupceremony_emailVerified(this.__wbg_ptr);
    }
    /**
     * OPAQUE step 2, from the server's `register-start` response. Returns
     * `{ upload, x25519_public, recovery_check }` (all `Uint8Array`).
     * @param {Uint8Array} server_message
     * @returns {any}
     */
    finishRegistration(server_message) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passArray8ToWasm0(server_message, wasm.__wbindgen_export);
            const len0 = WASM_VECTOR_LEN;
            wasm.wasmsignupceremony_finishRegistration(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            return takeObject(r0);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * `min_length` = `policy.password.min_length`; `email_verification_required`
     * = the document lists a required `verify_email_code`; `verify_word_count`
     * = `policy.recovery_phrase.verify_word_count`; `breach_check_required` =
     * the document declares a breach check, with `breach_fail_open` =
     * `policy.password.breach_check.fail_open` (applied by the ceremony, not
     * by the caller).
     * @param {number} min_length
     * @param {boolean} email_verification_required
     * @param {number} verify_word_count
     * @param {boolean} breach_check_required
     * @param {boolean} breach_fail_open
     */
    constructor(min_length, email_verification_required, verify_word_count, breach_check_required, breach_fail_open) {
        const ret = wasm.wasmsignupceremony_new(min_length, email_verification_required, verify_word_count, breach_check_required, breach_fail_open);
        this.__wbg_ptr = ret >>> 0;
        WasmSignupCeremonyFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Every pending step in canonical order, as `[{ step, spec_step_id }]`.
     * @returns {any}
     */
    pendingSteps() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.wasmsignupceremony_pendingSteps(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            return takeObject(r0);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * The phrase to show. Throws `phrase_unavailable` before `beginPhrase` or
     * after the phrase was confirmed (it is wiped then). The returned string
     * is a plain copy that lives in JS and cannot be wiped: call this only
     * while rendering the phrase and drop the reference afterwards.
     * @returns {string}
     */
    phrase() {
        let deferred2_0;
        let deferred2_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.wasmsignupceremony_phrase(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr1 = r0;
            var len1 = r1;
            if (r3) {
                ptr1 = 0; len1 = 0;
                throw takeObject(r2);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * The server rejected `register-finish` in a retryable way.
     */
    registrationFailed() {
        wasm.wasmsignupceremony_registrationFailed(this.__wbg_ptr);
    }
    /**
     * Validate and store the password. `breach_check` is the
     * `WasmBreachCheck` made for **this** password, after `evaluate` recorded
     * the endpoint's answer. It is only borrowed: after a rejection the same
     * check can be passed again. Throws an `Error` whose `code` is
     * `password_mismatch`, `password_too_short`, `breach_check_missing`,
     * `breach_check_stale`, `password_breached` or `breach_check_blocked`.
     * Returns the password evaluation (same shape as `evaluate_password`).
     * @param {string} password
     * @param {string} confirmation
     * @param {WasmBreachCheck} breach_check
     * @returns {any}
     */
    setPassword(password, confirmation, breach_check) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(password, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(confirmation, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len1 = WASM_VECTOR_LEN;
            _assertClass(breach_check, WasmBreachCheck);
            wasm.wasmsignupceremony_setPassword(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1, breach_check.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            return takeObject(r0);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * `setPassword` for a document that declares no breach check. If the
     * ceremony was constructed with `breachCheckRequired = true` this throws
     * `breach_check_missing`: omitting the check cannot bypass the gate.
     * @param {string} password
     * @param {string} confirmation
     * @returns {any}
     */
    setPasswordUnchecked(password, confirmation) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(password, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(confirmation, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len1 = WASM_VECTOR_LEN;
            wasm.wasmsignupceremony_setPasswordUnchecked(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            return takeObject(r0);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * OPAQUE step 1. Returns the `RegistrationRequest` bytes for
     * `opaque/register-start`. Throws `step_not_done` until every other
     * required step is done.
     * @returns {Uint8Array}
     */
    startRegistration() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.wasmsignupceremony_startRegistration(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            if (r3) {
                throw takeObject(r2);
            }
            var v1 = getArrayU8FromWasm0(r0, r1).slice();
            wasm.__wbindgen_export4(r0, r1 * 1, 1);
            return v1;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * First pending step: `{ step, spec_step_id }`.
     * @returns {any}
     */
    step() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.wasmsignupceremony_step(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            return takeObject(r0);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
}
if (Symbol.dispose) WasmSignupCeremony.prototype[Symbol.dispose] = WasmSignupCeremony.prototype.free;

/**
 * Was the body a storage GET actually delivered the chunk? Same answer shape as
 * `checkStorageGet`, but decided by the counted bytes: `stored` only when `received` is
 * exactly `expected`. `Content-Length` is only the head; a truncated stream ends short.
 * @param {number} received
 * @param {number} expected
 * @returns {DirectStorageGet}
 */
export function checkStorageBody(received, expected) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        wasm.checkStorageBody(retptr, received, expected);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        if (r2) {
            throw takeObject(r1);
        }
        return takeObject(r0);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * Was a storage GET answer the chunk we asked for? `{ kind: "stored" }` or
 * `{ kind: "failed", status }`; status `0` means there was no HTTP answer at all.
 * Only a `200` whose `Content-Length` is exactly `expected` is `stored`.
 * @param {number} status
 * @param {number | null | undefined} content_length
 * @param {number} expected
 * @returns {DirectStorageGet}
 */
export function checkStorageGet(status, content_length, expected) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        wasm.checkStorageGet(retptr, status, !isLikeNone(content_length), isLikeNone(content_length) ? 0 : content_length, expected);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        if (r2) {
            throw takeObject(r1);
        }
        return takeObject(r0);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * May the client follow this storage link? Throws an `Error` whose `code` is
 * the refusal (`malformed`, `not_https`, `userinfo`, `ip_literal`, `loopback`,
 * `bad_host`, `port`, `host_not_listed`, `bucket_not_listed`, `bad_path`); the
 * message never contains the URL. `discovery` is the object
 * `parseDirectDiscovery` returned; `api_base` is the API origin in use.
 * @param {string} url
 * @param {any} discovery
 * @param {string} api_base
 */
export function checkStorageUrl(url, discovery, api_base) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passStringToWasm0(url, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(api_base, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len1 = WASM_VECTOR_LEN;
        wasm.checkStorageUrl(retptr, ptr0, len0, addHeapObject(discovery), ptr1, len1);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        if (r1) {
            throw takeObject(r0);
        }
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

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
 * @param {string} call
 * @param {number} status
 * @param {string | null | undefined} content_type
 * @param {Uint8Array} body
 * @param {string | null} [retry_after]
 * @returns {any}
 */
export function classifyDirectAnswer(call, status, content_type, body, retry_after) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passStringToWasm0(call, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        var ptr1 = isLikeNone(content_type) ? 0 : passStringToWasm0(content_type, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        var len1 = WASM_VECTOR_LEN;
        const ptr2 = passArray8ToWasm0(body, wasm.__wbindgen_export);
        const len2 = WASM_VECTOR_LEN;
        var ptr3 = isLikeNone(retry_after) ? 0 : passStringToWasm0(retry_after, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        var len3 = WASM_VECTOR_LEN;
        wasm.classifyDirectAnswer(retptr, ptr0, len0, status, ptr1, len1, ptr2, len2, ptr3, len3);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        if (r2) {
            throw takeObject(r1);
        }
        return takeObject(r0);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * Combine a folder link's fragment key `K_c` with an optional 32-byte
 * passphrase stretch (task 2237b). Pass `undefined`/`null` for a link without
 * a passphrase. Returns a 32-byte `Uint8Array`: the key that unwraps the
 * link's sealed folder key. Never send the result or `K_c` to the server.
 * @param {Uint8Array} k_c
 * @param {Uint8Array | null} [passphrase_stretch]
 * @returns {Uint8Array}
 */
export function combineFolderLinkKey(k_c, passphrase_stretch) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArray8ToWasm0(k_c, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        var ptr1 = isLikeNone(passphrase_stretch) ? 0 : passArray8ToWasm0(passphrase_stretch, wasm.__wbindgen_export);
        var len1 = WASM_VECTOR_LEN;
        wasm.combineFolderLinkKey(retptr, ptr0, len0, ptr1, len1);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
        if (r3) {
            throw takeObject(r2);
        }
        var v3 = getArrayU8FromWasm0(r0, r1).slice();
        wasm.__wbindgen_export4(r0, r1 * 1, 1);
        return v3;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * Compute recovery check from master key. Returns 32-byte `Uint8Array`.
 * @param {Uint8Array} master_key
 * @returns {Uint8Array}
 */
export function compute_recovery_check(master_key) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArray8ToWasm0(master_key, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        wasm.compute_recovery_check(retptr, ptr0, len0);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
        if (r3) {
            throw takeObject(r2);
        }
        var v2 = getArrayU8FromWasm0(r0, r1).slice();
        wasm.__wbindgen_export4(r0, r1 * 1, 1);
        return v2;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * Decompress gzip-compressed data. Returns `Uint8Array`.
 * @param {Uint8Array} data
 * @returns {Uint8Array}
 */
export function decompress_gzip(data) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        wasm.decompress_gzip(retptr, ptr0, len0);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
        if (r3) {
            throw takeObject(r2);
        }
        var v2 = getArrayU8FromWasm0(r0, r1).slice();
        wasm.__wbindgen_export4(r0, r1 * 1, 1);
        return v2;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * Decrypt a ciphertext chunk that was produced by `encrypt_chunk`.
 * `key`, `nonce`, and `ciphertext` are raw byte slices.
 *
 * Generic no-AAD AEAD open (key unwrap, share keys, v1 blobs). It does NOT
 * open v2 file-content frames — use `WasmChunkDecryptor` (sequential) or
 * `decrypt_chunk_frame` (random access) for file content (task 1908).
 * @param {Uint8Array} key
 * @param {Uint8Array} nonce
 * @param {Uint8Array} ciphertext
 * @returns {Uint8Array}
 */
export function decrypt_chunk(key, nonce, ciphertext) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArray8ToWasm0(key, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(nonce, wasm.__wbindgen_export);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArray8ToWasm0(ciphertext, wasm.__wbindgen_export);
        const len2 = WASM_VECTOR_LEN;
        wasm.decrypt_chunk(retptr, ptr0, len0, ptr1, len1, ptr2, len2);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
        if (r3) {
            throw takeObject(r2);
        }
        var v4 = getArrayU8FromWasm0(r0, r1).slice();
        wasm.__wbindgen_export4(r0, r1 * 1, 1);
        return v4;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * Random-access open of ONE file-content frame at a known position (seeking
 * readers: video, range previews). `index` is the chunk requested and
 * `is_last = index == chunk_count - 1`; a server that serves another chunk or
 * lies about the count fails the tag. `format` (1 = v1, 2 = v2) must come from
 * authenticated data (2 when the encrypted metadata records v2, else a
 * `WasmChunkDecryptor.format` after chunk 0), never from a server field.
 * `version_id` (12 bytes, v2 only; ignored for v1) is `WasmChunkDecryptor.versionId`
 * after chunk 0 (or chunk 0's first 12 bytes): another upload's frames fail.
 * @param {Uint8Array} file_key
 * @param {string} file_id
 * @param {Uint8Array} version_id
 * @param {number} index
 * @param {boolean} is_last
 * @param {number} format
 * @param {Uint8Array} frame
 * @returns {Uint8Array}
 */
export function decrypt_chunk_frame(file_key, file_id, version_id, index, is_last, format, frame) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArray8ToWasm0(file_key, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(file_id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArray8ToWasm0(version_id, wasm.__wbindgen_export);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passArray8ToWasm0(frame, wasm.__wbindgen_export);
        const len3 = WASM_VECTOR_LEN;
        wasm.decrypt_chunk_frame(retptr, ptr0, len0, ptr1, len1, ptr2, len2, index, is_last, format, ptr3, len3);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
        if (r3) {
            throw takeObject(r2);
        }
        var v5 = getArrayU8FromWasm0(r0, r1).slice();
        wasm.__wbindgen_export4(r0, r1 * 1, 1);
        return v5;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * Decrypt a sequence of encrypted chunks and return the concatenated plaintext.
 * Each chunk is a JS object `{ nonce: Uint8Array, ciphertext: Uint8Array }`.
 * Returns the full plaintext as `Uint8Array`.
 * @param {Uint8Array} key
 * @param {any} chunks
 * @returns {Uint8Array}
 */
export function decrypt_chunks(key, chunks) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArray8ToWasm0(key, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        wasm.decrypt_chunks(retptr, ptr0, len0, addHeapObject(chunks));
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
        if (r3) {
            throw takeObject(r2);
        }
        var v2 = getArrayU8FromWasm0(r0, r1).slice();
        wasm.__wbindgen_export4(r0, r1 * 1, 1);
        return v2;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * The metadata reader for FILES (task 1908 round 3): exactly
 * [`decrypt_name_metadata`], except that a plaintext (non-JSON)
 * `name_encrypted` is refused — a plaintext name carries no chunk-format pin.
 * Take every file-content reader's `chunk_format` from THIS;
 * `decrypt_name_metadata` stays for folders / display.
 * @param {Uint8Array} master_key
 * @param {string} file_id
 * @param {string} name_encrypted
 * @returns {any}
 */
export function decrypt_file_metadata(master_key, file_id, name_encrypted) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArray8ToWasm0(master_key, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(file_id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(name_encrypted, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len2 = WASM_VECTOR_LEN;
        wasm.decrypt_file_metadata(retptr, ptr0, len0, ptr1, len1, ptr2, len2);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        if (r2) {
            throw takeObject(r1);
        }
        return takeObject(r0);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * [`decrypt_file_metadata`] with an already-unwrapped 32-byte file key.
 * @param {Uint8Array} file_key
 * @param {string} name_encrypted
 * @returns {any}
 */
export function decrypt_file_metadata_with_key(file_key, name_encrypted) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArray8ToWasm0(file_key, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(name_encrypted, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len1 = WASM_VECTOR_LEN;
        wasm.decrypt_file_metadata_with_key(retptr, ptr0, len0, ptr1, len1);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        if (r2) {
            throw takeObject(r1);
        }
        return takeObject(r0);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * Decrypt a metadata blob back to a UTF-8 string.
 * @param {Uint8Array} key
 * @param {Uint8Array} nonce
 * @param {Uint8Array} ciphertext
 * @returns {string}
 */
export function decrypt_metadata(key, nonce, ciphertext) {
    let deferred5_0;
    let deferred5_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArray8ToWasm0(key, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(nonce, wasm.__wbindgen_export);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArray8ToWasm0(ciphertext, wasm.__wbindgen_export);
        const len2 = WASM_VECTOR_LEN;
        wasm.decrypt_metadata(retptr, ptr0, len0, ptr1, len1, ptr2, len2);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
        var ptr4 = r0;
        var len4 = r1;
        if (r3) {
            ptr4 = 0; len4 = 0;
            throw takeObject(r2);
        }
        deferred5_0 = ptr4;
        deferred5_1 = len4;
        return getStringFromWasm0(ptr4, len4);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        wasm.__wbindgen_export4(deferred5_0, deferred5_1, 1);
    }
}

/**
 * Decrypt a `name_encrypted` envelope (same format/key matrix as core
 * `decrypt_name`) into `{ name, mime_type, chunk_format }`. `chunk_format`
 * (0 = unrecorded, 2 = v2) is what every content reader of the file must be
 * given — task 1908.
 * @param {Uint8Array} master_key
 * @param {string} file_id
 * @param {string} name_encrypted
 * @returns {any}
 */
export function decrypt_name_metadata(master_key, file_id, name_encrypted) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArray8ToWasm0(master_key, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(file_id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(name_encrypted, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len2 = WASM_VECTOR_LEN;
        wasm.decrypt_name_metadata(retptr, ptr0, len0, ptr1, len1, ptr2, len2);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        if (r2) {
            throw takeObject(r1);
        }
        return takeObject(r0);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * [`decrypt_name_metadata`] with an already-unwrapped 32-byte file key (share
 * / shared-link recipients, file-request content keys).
 * @param {Uint8Array} file_key
 * @param {string} name_encrypted
 * @returns {any}
 */
export function decrypt_name_metadata_with_key(file_key, name_encrypted) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArray8ToWasm0(file_key, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(name_encrypted, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len1 = WASM_VECTOR_LEN;
        wasm.decrypt_name_metadata_with_key(retptr, ptr0, len0, ptr1, len1);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        if (r2) {
            throw takeObject(r1);
        }
        return takeObject(r0);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * Batch-decrypt file names in ONE WASM call (task 0806 — folder-load perf).
 *
 * `items` is a JS array of `{ fileId: string, nameEncrypted: string }`.
 * `master_key` is the 32 raw bytes. Returns a JS array (same order + length as
 * `items`) of `{ name: string|null, mimeType: string|null, error: string|null }`
 * — `name` set on success, `error` set on failure (bad blob / unparseable
 * fileId / wrong key). One bad item never fails the batch. Mirrors core
 * `decrypt_names` (string-UUID then legacy binary-UUID key attempt).
 * @param {Uint8Array} master_key
 * @param {any} items
 * @returns {any}
 */
export function decrypt_names(master_key, items) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArray8ToWasm0(master_key, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        wasm.decrypt_names(retptr, ptr0, len0, addHeapObject(items));
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        if (r2) {
            throw takeObject(r1);
        }
        return takeObject(r0);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * Open a `note_encrypted` envelope: the note subkey first, then the legacy
 * raw file key (notes stored before the switch). A plaintext value is an
 * error. The ONLY way to open a note — not `decryptFilename`.
 * @param {Uint8Array} file_key
 * @param {string} note_encrypted
 * @returns {string}
 */
export function decrypt_note(file_key, note_encrypted) {
    let deferred4_0;
    let deferred4_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArray8ToWasm0(file_key, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(note_encrypted, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len1 = WASM_VECTOR_LEN;
        wasm.decrypt_note(retptr, ptr0, len0, ptr1, len1);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
        var ptr3 = r0;
        var len3 = r1;
        if (r3) {
            ptr3 = 0; len3 = 0;
            throw takeObject(r2);
        }
        deferred4_0 = ptr3;
        deferred4_1 = len3;
        return getStringFromWasm0(ptr3, len3);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        wasm.__wbindgen_export4(deferred4_0, deferred4_1, 1);
    }
}

/**
 * Open a thumbnail frame: the thumbnail subkey first, then the legacy raw
 * file key (thumbnails stored before the switch).
 * @param {Uint8Array} file_key
 * @param {Uint8Array} frame
 * @returns {Uint8Array}
 */
export function decrypt_thumbnail(file_key, frame) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArray8ToWasm0(file_key, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(frame, wasm.__wbindgen_export);
        const len1 = WASM_VECTOR_LEN;
        wasm.decrypt_thumbnail(retptr, ptr0, len0, ptr1, len1);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
        if (r3) {
            throw takeObject(r2);
        }
        var v3 = getArrayU8FromWasm0(r0, r1).slice();
        wasm.__wbindgen_export4(r0, r1 * 1, 1);
        return v3;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * Stretch a folder-link passphrase (Argon2id over the canonical NFC form,
 * token-bound salt). Refuses an empty passphrase. Pass the result to
 * `combineFolderLinkKey`; never send it to the server.
 * @param {string} passphrase
 * @param {string} token
 * @returns {Uint8Array}
 */
export function deriveFolderLinkPassphraseStretch(passphrase, token) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passStringToWasm0(passphrase, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(token, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len1 = WASM_VECTOR_LEN;
        wasm.deriveFolderLinkPassphraseStretch(retptr, ptr0, len0, ptr1, len1);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
        if (r3) {
            throw takeObject(r2);
        }
        var v3 = getArrayU8FromWasm0(r0, r1).slice();
        wasm.__wbindgen_export4(r0, r1 * 1, 1);
        return v3;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * Derive one bucket key of a shared folder's encrypted search index (task
 * 2237b): `HKDF-SHA256(ikm = folder key, salt = none, info =
 * "beebeeb-shared-folder-index-v1" || bucket as u32 LE)`. Returns a 32-byte
 * `Uint8Array`. `bucket` must be below the index's shard count (64 in the
 * standard layout); values of 64 or more are rejected here.
 * @param {Uint8Array} folder_key
 * @param {number} bucket
 * @returns {Uint8Array}
 */
export function deriveSharedFolderIndexKey(folder_key, bucket) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArray8ToWasm0(folder_key, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        wasm.deriveSharedFolderIndexKey(retptr, ptr0, len0, bucket);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
        if (r3) {
            throw takeObject(r2);
        }
        var v2 = getArrayU8FromWasm0(r0, r1).slice();
        wasm.__wbindgen_export4(r0, r1 * 1, 1);
        return v2;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * Derive a per-file encryption key from a master key and file ID via
 * HKDF-SHA256. Both `master_key` and `file_id` are raw byte slices.
 * Returns the 32-byte file key as `Uint8Array`.
 * @param {Uint8Array} master_key
 * @param {Uint8Array} file_id
 * @returns {Uint8Array}
 */
export function derive_file_key(master_key, file_id) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArray8ToWasm0(master_key, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(file_id, wasm.__wbindgen_export);
        const len1 = WASM_VECTOR_LEN;
        wasm.derive_file_key(retptr, ptr0, len0, ptr1, len1);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
        if (r3) {
            throw takeObject(r2);
        }
        var v3 = getArrayU8FromWasm0(r0, r1).slice();
        wasm.__wbindgen_export4(r0, r1 * 1, 1);
        return v3;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * Derive a 32-byte master key from a password and salt (>= 16 bytes) via
 * Argon2id. Returns a JS object `{ key: Uint8Array }`.
 * @param {string} password
 * @param {Uint8Array} salt
 * @returns {any}
 */
export function derive_master_key(password, salt) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passStringToWasm0(password, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(salt, wasm.__wbindgen_export);
        const len1 = WASM_VECTOR_LEN;
        wasm.derive_master_key(retptr, ptr0, len0, ptr1, len1);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        if (r2) {
            throw takeObject(r1);
        }
        return takeObject(r0);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * Derive the per-request private-key-wrapping key from the owner's master key.
 * `master_key` is 32 bytes, `request_id` is arbitrary bytes. Returns 32-byte `Uint8Array`.
 * @param {Uint8Array} master_key
 * @param {Uint8Array} request_id
 * @returns {Uint8Array}
 */
export function derive_request_wrap_key(master_key, request_id) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArray8ToWasm0(master_key, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(request_id, wasm.__wbindgen_export);
        const len1 = WASM_VECTOR_LEN;
        wasm.derive_request_wrap_key(retptr, ptr0, len0, ptr1, len1);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
        if (r3) {
            throw takeObject(r2);
        }
        var v3 = getArrayU8FromWasm0(r0, r1).slice();
        wasm.__wbindgen_export4(r0, r1 * 1, 1);
        return v3;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * Derive a share key from a shared secret + file ID. Returns 32-byte `Uint8Array`.
 * @param {Uint8Array} shared_secret
 * @param {Uint8Array} file_id
 * @returns {Uint8Array}
 */
export function derive_share_key(shared_secret, file_id) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArray8ToWasm0(shared_secret, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(file_id, wasm.__wbindgen_export);
        const len1 = WASM_VECTOR_LEN;
        wasm.derive_share_key(retptr, ptr0, len0, ptr1, len1);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
        if (r3) {
            throw takeObject(r2);
        }
        var v3 = getArrayU8FromWasm0(r0, r1).slice();
        wasm.__wbindgen_export4(r0, r1 * 1, 1);
        return v3;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * Derive X25519 signing key from master key. Returns 32-byte `Uint8Array`.
 * @param {Uint8Array} master_key
 * @returns {Uint8Array}
 */
export function derive_x25519_private(master_key) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArray8ToWasm0(master_key, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        wasm.derive_x25519_private(retptr, ptr0, len0);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
        if (r3) {
            throw takeObject(r2);
        }
        var v2 = getArrayU8FromWasm0(r0, r1).slice();
        wasm.__wbindgen_export4(r0, r1 * 1, 1);
        return v2;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * Derive X25519 verification key from signing key. Returns 32-byte `Uint8Array`.
 * @param {Uint8Array} private_key
 * @returns {Uint8Array}
 */
export function derive_x25519_public(private_key) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArray8ToWasm0(private_key, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        wasm.derive_x25519_public(retptr, ptr0, len0);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
        if (r3) {
            throw takeObject(r2);
        }
        var v2 = getArrayU8FromWasm0(r0, r1).slice();
        wasm.__wbindgen_export4(r0, r1 * 1, 1);
        return v2;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * `/api/v1/files/{id}/download-grants` for `file_id`.
 * @param {string} file_id
 * @returns {string}
 */
export function directDownloadGrantsPath(file_id) {
    let deferred2_0;
    let deferred2_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passStringToWasm0(file_id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        wasm.directDownloadGrantsPath(retptr, ptr0, len0);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        deferred2_0 = r0;
        deferred2_1 = r1;
        return getStringFromWasm0(r0, r1);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        wasm.__wbindgen_export4(deferred2_0, deferred2_1, 1);
    }
}

/**
 * `{ cap_object_download_v1, cap_object_upload_v1, capabilities_header,
 * discovery_path, max_window, default_window, chunk_overhead,
 * max_discovery_body_bytes, max_grant_body_bytes, max_chunk_body_bytes,
 * storage_connect_timeout_ms, storage_get_idle_ms, discovery_timeout_ms,
 * api_call_timeout_ms, background_put_resource_timeout_ms }`: the contract's
 * names and numbers, the response caps and the time bounds every client applies,
 * so no client re-types them.
 * @returns {any}
 */
export function directTransferConstants() {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        wasm.directTransferConstants(retptr);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        if (r2) {
            throw takeObject(r1);
        }
        return takeObject(r0);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * Encrypt a plaintext chunk with AES-256-GCM. Returns a JS object
 * `{ cipher_suite: string, nonce: Uint8Array, ciphertext: Uint8Array }`.
 * @param {Uint8Array} key
 * @param {Uint8Array} plaintext
 * @returns {any}
 */
export function encrypt_chunk(key, plaintext) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArray8ToWasm0(key, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(plaintext, wasm.__wbindgen_export);
        const len1 = WASM_VECTOR_LEN;
        wasm.encrypt_chunk(retptr, ptr0, len0, ptr1, len1);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        if (r2) {
            throw takeObject(r1);
        }
        return takeObject(r0);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * Encrypt a UTF-8 metadata string (filename, path, etc.) with AES-256-GCM.
 * Returns the same JS object shape as `encrypt_chunk`.
 * @param {Uint8Array} key
 * @param {string} metadata
 * @returns {any}
 */
export function encrypt_metadata(key, metadata) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArray8ToWasm0(key, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(metadata, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len1 = WASM_VECTOR_LEN;
        wasm.encrypt_metadata(retptr, ptr0, len0, ptr1, len1);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        if (r2) {
            throw takeObject(r1);
        }
        return takeObject(r0);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

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
 * @param {Uint8Array} file_key
 * @param {string} filename
 * @param {string | null | undefined} mime_type
 * @param {number} recorded_pin
 * @returns {string}
 */
export function encrypt_name_for(file_key, filename, mime_type, recorded_pin) {
    let deferred5_0;
    let deferred5_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArray8ToWasm0(file_key, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(filename, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len1 = WASM_VECTOR_LEN;
        var ptr2 = isLikeNone(mime_type) ? 0 : passStringToWasm0(mime_type, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        var len2 = WASM_VECTOR_LEN;
        wasm.encrypt_name_for(retptr, ptr0, len0, ptr1, len1, ptr2, len2, recorded_pin);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
        var ptr4 = r0;
        var len4 = r1;
        if (r3) {
            ptr4 = 0; len4 = 0;
            throw takeObject(r2);
        }
        deferred5_0 = ptr4;
        deferred5_1 = len4;
        return getStringFromWasm0(ptr4, len4);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        wasm.__wbindgen_export4(deferred5_0, deferred5_1, 1);
    }
}

/**
 * Encrypt a filename (+ MIME) into a `name_encrypted` envelope that also
 * records the file's chunk format (task 1908): `chunk_format` 2 = every upload
 * of this file id is v2, 0 = record nothing (the pre-1908 shape). New file:
 * 2 only if its content was written as v2. Rename / replace: pass the value
 * `decrypt_file_metadata` returned — never upgrade a file with v1 history,
 * never drop a recorded 2.
 * @param {Uint8Array} master_key
 * @param {string} file_id
 * @param {string} filename
 * @param {string | null | undefined} mime_type
 * @param {number} chunk_format
 * @returns {string}
 */
export function encrypt_name_with_chunk_format(master_key, file_id, filename, mime_type, chunk_format) {
    let deferred6_0;
    let deferred6_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArray8ToWasm0(master_key, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(file_id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(filename, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len2 = WASM_VECTOR_LEN;
        var ptr3 = isLikeNone(mime_type) ? 0 : passStringToWasm0(mime_type, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        var len3 = WASM_VECTOR_LEN;
        wasm.encrypt_name_with_chunk_format(retptr, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, chunk_format);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
        var ptr5 = r0;
        var len5 = r1;
        if (r3) {
            ptr5 = 0; len5 = 0;
            throw takeObject(r2);
        }
        deferred6_0 = ptr5;
        deferred6_1 = len5;
        return getStringFromWasm0(ptr5, len5);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        wasm.__wbindgen_export4(deferred6_0, deferred6_1, 1);
    }
}

/**
 * Seal a file note for a file with no recorded pin yet (task 1908 round 5):
 * returns the canonical `EncryptedBlob` JSON to store in `note_encrypted` (the
 * shape `serializeEncryptedBlob` writes). Follows the gated seal switch, like
 * `encrypt_thumbnail`. For a note on an EXISTING file (the details panel) use
 * `encrypt_note_for` with the file's recorded pin. The ONLY way to seal a
 * note — not `encryptFilename` / `encrypt_metadata` under the file key (a
 * raw-key note can stand in for a v2 file's name and content).
 * @param {Uint8Array} file_key
 * @param {string} note
 * @returns {string}
 */
export function encrypt_note(file_key, note) {
    let deferred4_0;
    let deferred4_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArray8ToWasm0(file_key, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(note, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len1 = WASM_VECTOR_LEN;
        wasm.encrypt_note(retptr, ptr0, len0, ptr1, len1);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
        var ptr3 = r0;
        var len3 = r1;
        if (r3) {
            ptr3 = 0; len3 = 0;
            throw takeObject(r2);
        }
        deferred4_0 = ptr3;
        deferred4_1 = len3;
        return getStringFromWasm0(ptr3, len3);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        wasm.__wbindgen_export4(deferred4_0, deferred4_1, 1);
    }
}

/**
 * Seal a note of an EXISTING file under the rule of its recorded pin (task
 * 1908 round 5): `recordedPin` = the `chunk_format` from
 * `decrypt_file_metadata` of THIS file (0 = unrecorded, 2 = v2), never a
 * server field. A v2 pin is always sealed under the note subkey; 0 behaves
 * like `encrypt_note`.
 * @param {Uint8Array} file_key
 * @param {string} note
 * @param {number} recorded_pin
 * @returns {string}
 */
export function encrypt_note_for(file_key, note, recorded_pin) {
    let deferred4_0;
    let deferred4_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArray8ToWasm0(file_key, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(note, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len1 = WASM_VECTOR_LEN;
        wasm.encrypt_note_for(retptr, ptr0, len0, ptr1, len1, recorded_pin);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
        var ptr3 = r0;
        var len3 = r1;
        if (r3) {
            ptr3 = 0; len3 = 0;
            throw takeObject(r2);
        }
        deferred4_0 = ptr3;
        deferred4_1 = len3;
        return getStringFromWasm0(ptr3, len3);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        wasm.__wbindgen_export4(deferred4_0, deferred4_1, 1);
    }
}

/**
 * Seal a thumbnail (already-encoded image bytes) under a 32-byte file key:
 * `nonce(12) || ciphertext || tag(16)` (the existing thumbnail wire format).
 * The ONLY way to seal a thumbnail (task 1908 round 3) — after the gated seal
 * switch it uses the thumbnail subkey, so a thumbnail can never be served as
 * file content.
 * @param {Uint8Array} file_key
 * @param {Uint8Array} plaintext
 * @returns {Uint8Array}
 */
export function encrypt_thumbnail(file_key, plaintext) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArray8ToWasm0(file_key, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(plaintext, wasm.__wbindgen_export);
        const len1 = WASM_VECTOR_LEN;
        wasm.encrypt_thumbnail(retptr, ptr0, len0, ptr1, len1);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
        if (r3) {
            throw takeObject(r2);
        }
        var v3 = getArrayU8FromWasm0(r0, r1).slice();
        wasm.__wbindgen_export4(r0, r1 * 1, 1);
        return v3;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * Seal a thumbnail of an EXISTING file under the rule of its recorded pin
 * (task 1908 round 4): `recordedPin` = the `chunk_format` from
 * `decrypt_file_metadata` (0 = unrecorded, 2 = v2). A v2 pin is always sealed
 * under the thumbnail subkey; 0 behaves like `encrypt_thumbnail`.
 * @param {Uint8Array} file_key
 * @param {Uint8Array} plaintext
 * @param {number} recorded_pin
 * @returns {Uint8Array}
 */
export function encrypt_thumbnail_for(file_key, plaintext, recorded_pin) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArray8ToWasm0(file_key, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(plaintext, wasm.__wbindgen_export);
        const len1 = WASM_VECTOR_LEN;
        wasm.encrypt_thumbnail_for(retptr, ptr0, len0, ptr1, len1, recorded_pin);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
        if (r3) {
            throw takeObject(r2);
        }
        var v3 = getArrayU8FromWasm0(r0, r1).slice();
        wasm.__wbindgen_export4(r0, r1 * 1, 1);
        return v3;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * Evaluate a password against the server's `policy.password.min_length`
 * (clamped up to the core floor of 12). Returns
 * `{ length, min_length, missing_characters, meets_minimum, has_mixed_case,
 * has_number_or_symbol, strength, level, hint }`. Contains no part of the password.
 * @param {string} password
 * @param {number} min_length
 * @returns {any}
 */
export function evaluate_password(password, min_length) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passStringToWasm0(password, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        wasm.evaluate_password(retptr, ptr0, len0, min_length);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        if (r2) {
            throw takeObject(r1);
        }
        return takeObject(r0);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * A shared folder's key id (task 2133): a one-way id of the folder's 32-byte
 * key, for a server to compare folder keys without learning them (HKDF-SHA256,
 * info `beebeeb/folder-key-id/v1`). Returns a 32-byte `Uint8Array`; not secret,
 * and never a key. Wipes the copy of the key this function owns
 * (wasm-bindgen's own copy is freed without a wipe).
 * @param {Uint8Array} folder_key
 * @returns {Uint8Array}
 */
export function folder_key_id(folder_key) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArray8ToWasm0(folder_key, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        wasm.folder_key_id(retptr, ptr0, len0);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
        if (r3) {
            throw takeObject(r2);
        }
        var v2 = getArrayU8FromWasm0(r0, r1).slice();
        wasm.__wbindgen_export4(r0, r1 * 1, 1);
        return v2;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * Generate a recovery kit PDF with a title, recovery words, and metadata.
 *
 * `metadata_keys` and `metadata_values` are parallel arrays of key-value pairs.
 * Returns the raw PDF bytes as `Uint8Array`.
 * @param {string} title
 * @param {any} words
 * @param {any} metadata_keys
 * @param {any} metadata_values
 * @returns {Uint8Array}
 */
export function generate_recovery_pdf(title, words, metadata_keys, metadata_values) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passStringToWasm0(title, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        wasm.generate_recovery_pdf(retptr, ptr0, len0, addHeapObject(words), addHeapObject(metadata_keys), addHeapObject(metadata_values));
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
        if (r3) {
            throw takeObject(r2);
        }
        var v2 = getArrayU8FromWasm0(r0, r1).slice();
        wasm.__wbindgen_export4(r0, r1 * 1, 1);
        return v2;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * Generate a new 12-word BIP39 recovery phrase and the corresponding master
 * key. Returns `{ phrase: string, master_key: Uint8Array }`.
 * @returns {any}
 */
export function generate_recovery_phrase() {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        wasm.generate_recovery_phrase(retptr);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        if (r2) {
            throw takeObject(r1);
        }
        return takeObject(r0);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * Generate a canonical share token (task 0708): 20 bytes of OS randomness as
 * URL-safe-no-pad base64 (27 chars). Web mints this for A1 owner-recoverable
 * shares so the client-supplied `token` matches the server's format exactly
 * (single canonical impl shared with native/UniFFI via `beebeeb-core`).
 * @returns {string}
 */
export function generate_share_token() {
    let deferred1_0;
    let deferred1_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        wasm.generate_share_token(retptr);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        deferred1_0 = r0;
        deferred1_1 = r1;
        return getStringFromWasm0(r0, r1);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        wasm.__wbindgen_export4(deferred1_0, deferred1_1, 1);
    }
}

/**
 * Returns `true` if the given MIME type can be previewed in-app.
 * @param {string | null} [mime_type]
 * @returns {boolean}
 */
export function is_previewable(mime_type) {
    var ptr0 = isLikeNone(mime_type) ? 0 : passStringToWasm0(mime_type, wasm.__wbindgen_export, wasm.__wbindgen_export2);
    var len0 = WASM_VECTOR_LEN;
    const ret = wasm.is_previewable(ptr0, len0);
    return ret !== 0;
}

/**
 * Returns `true` if the file extension indicates a previewable file.
 * @param {string} filename
 * @returns {boolean}
 */
export function is_previewable_by_extension(filename) {
    const ptr0 = passStringToWasm0(filename, wasm.__wbindgen_export, wasm.__wbindgen_export2);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.is_previewable_by_extension(ptr0, len0);
    return ret !== 0;
}

/**
 * List entries in an archive, detecting format from the filename extension.
 * Supports `.tar`, `.gz`, `.tgz`, `.tar.gz`.
 * Returns a JS array of `{ name: string, size: number, is_directory: boolean }`.
 * @param {Uint8Array} data
 * @param {string} filename
 * @returns {any}
 */
export function list_archive(data, filename) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(filename, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len1 = WASM_VECTOR_LEN;
        wasm.list_archive(retptr, ptr0, len0, ptr1, len1);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        if (r2) {
            throw takeObject(r1);
        }
        return takeObject(r0);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * List entries in a TAR archive from raw bytes.
 * Returns a JS array of `{ name: string, size: number, is_directory: boolean }`.
 * @param {Uint8Array} data
 * @returns {any}
 */
export function list_tar_entries(data) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        wasm.list_tar_entries(retptr, ptr0, len0);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        if (r2) {
            throw takeObject(r1);
        }
        return takeObject(r0);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * The ciphertext bytes a process of `class` (`"native"`, `"browser"`, `"mobile_app"`,
 * `"mobile_extension"`) may hold at once. Throws `class_invalid` for any other string.
 * @param {string} _class
 * @returns {number}
 */
export function maxInFlightBytes(_class) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passStringToWasm0(_class, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        wasm.maxInFlightBytes(retptr, ptr0, len0);
        var r0 = getDataViewMemory0().getFloat64(retptr + 8 * 0, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
        if (r3) {
            throw takeObject(r2);
        }
        return r0;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * Finish OPAQUE client login. Returns `{ message: Uint8Array, session_key: Uint8Array, export_key: Uint8Array }`.
 *
 * `ksf_version` selects the KSF the account's password file was registered
 * under (0 = legacy Identity KSF, anything else = current Argon2id). The web
 * client reads it from the login-start response (`server_state` JSON) and
 * passes it through verbatim. The KSF must match or finish fails.
 * @param {Uint8Array} client_state
 * @param {Uint8Array} password
 * @param {Uint8Array} server_response
 * @param {number} ksf_version
 * @returns {any}
 */
export function opaque_login_finish(client_state, password, server_response, ksf_version) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArray8ToWasm0(client_state, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(password, wasm.__wbindgen_export);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArray8ToWasm0(server_response, wasm.__wbindgen_export);
        const len2 = WASM_VECTOR_LEN;
        wasm.opaque_login_finish(retptr, ptr0, len0, ptr1, len1, ptr2, len2, ksf_version);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        if (r2) {
            throw takeObject(r1);
        }
        return takeObject(r0);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * Start OPAQUE client login. Returns `{ message: Uint8Array, state: Uint8Array }`.
 * @param {Uint8Array} password
 * @returns {any}
 */
export function opaque_login_start(password) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArray8ToWasm0(password, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        wasm.opaque_login_start(retptr, ptr0, len0);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        if (r2) {
            throw takeObject(r1);
        }
        return takeObject(r0);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * Finish OPAQUE client registration. Returns `Uint8Array` (registration upload).
 * @param {Uint8Array} client_state
 * @param {Uint8Array} password
 * @param {Uint8Array} server_response
 * @returns {Uint8Array}
 */
export function opaque_registration_finish(client_state, password, server_response) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArray8ToWasm0(client_state, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(password, wasm.__wbindgen_export);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArray8ToWasm0(server_response, wasm.__wbindgen_export);
        const len2 = WASM_VECTOR_LEN;
        wasm.opaque_registration_finish(retptr, ptr0, len0, ptr1, len1, ptr2, len2);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
        if (r3) {
            throw takeObject(r2);
        }
        var v4 = getArrayU8FromWasm0(r0, r1).slice();
        wasm.__wbindgen_export4(r0, r1 * 1, 1);
        return v4;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * Start OPAQUE client registration. Returns `{ message: Uint8Array, state: Uint8Array }`.
 * @param {Uint8Array} password
 * @returns {any}
 */
export function opaque_registration_start(password) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArray8ToWasm0(password, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        wasm.opaque_registration_start(retptr, ptr0, len0);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        if (r2) {
            throw takeObject(r1);
        }
        return takeObject(r0);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * L9 (task 2255): open a LEGACY invite owner copy and return its key only when
 * core proves it over the folder's rows, in ONE call. `rows` are the server's
 * `GET /shares/invites/{id}/folder-keys` rows verbatim:
 * `[{ file_id: string, encrypted_file_key: string }]`, the key in standard base64.
 * They are read lazily, and core examines at most 64 distinct ids. Returns
 * `undefined` when the copy does not open, holds text, or is not proven; the
 * unproven candidate never reaches JS. Attack B (task 2255) is a named residual.
 * @param {Uint8Array} master_key
 * @param {string} folder_id
 * @param {Uint8Array} legacy_copy
 * @param {any} rows
 * @returns {Uint8Array | undefined}
 */
export function openLegacyInviteOwnerCopy(master_key, folder_id, legacy_copy, rows) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArray8ToWasm0(master_key, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(folder_id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArray8ToWasm0(legacy_copy, wasm.__wbindgen_export);
        const len2 = WASM_VECTOR_LEN;
        wasm.openLegacyInviteOwnerCopy(retptr, ptr0, len0, ptr1, len1, ptr2, len2, addHeapObject(rows));
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
        if (r3) {
            throw takeObject(r2);
        }
        let v4;
        if (r0 !== 0) {
            v4 = getArrayU8FromWasm0(r0, r1).slice();
            wasm.__wbindgen_export4(r0, r1 * 1, 1);
        }
        return v4;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * Open a sealed request upload (owner decrypt path). Recovers the content key.
 * `r_priv` and `e_pub` are 32 bytes; `file_id` is arbitrary bytes. Returns 32-byte `Uint8Array`.
 * @param {Uint8Array} r_priv
 * @param {Uint8Array} e_pub
 * @param {Uint8Array} file_id
 * @param {Uint8Array} wrapped_key
 * @returns {Uint8Array}
 */
export function open_request_upload(r_priv, e_pub, file_id, wrapped_key) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArray8ToWasm0(r_priv, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(e_pub, wasm.__wbindgen_export);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArray8ToWasm0(file_id, wasm.__wbindgen_export);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passArray8ToWasm0(wrapped_key, wasm.__wbindgen_export);
        const len3 = WASM_VECTOR_LEN;
        wasm.open_request_upload(retptr, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
        if (r3) {
            throw takeObject(r2);
        }
        var v5 = getArrayU8FromWasm0(r0, r1).slice();
        wasm.__wbindgen_export4(r0, r1 * 1, 1);
        return v5;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * When `wire_bytes` received since `start_ms` at `kbps` KiB/s lets the next storage
 * request start. The three counts cross as JS numbers (`f64`), like every other count.
 * `-Infinity` (`i64::MIN` in core) means there is no ceiling: a real deadline is a
 * finite number, so a caller only has to test `Number.isFinite`. Desktop's formula,
 * unchanged in value.
 * @param {number} start_ms
 * @param {number} wire_bytes
 * @param {number} kbps
 * @returns {number}
 */
export function pacedUntilMs(start_ms, wire_bytes, kbps) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        wasm.pacedUntilMs(retptr, start_ms, wire_bytes, kbps);
        var r0 = getDataViewMemory0().getFloat64(retptr + 8 * 0, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
        if (r3) {
            throw takeObject(r2);
        }
        return r0;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * May this client use the direct transport for `direction`? True only when discovery
 * offers it AND has at least one storage pair AND every pair in `discovery.storage_buckets`
 * is in `pairs` (an array of `{host, bucket}`). Hosts compare ASCII case-insensitively,
 * buckets exactly.
 * @param {any} discovery
 * @param {string} direction
 * @param {any} pairs
 * @returns {boolean}
 */
export function pairsAllowed(discovery, direction, pairs) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passStringToWasm0(direction, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        wasm.pairsAllowed(retptr, addHeapObject(discovery), ptr0, len0, addHeapObject(pairs));
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        if (r2) {
            throw takeObject(r1);
        }
        return r0 !== 0;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * Decode a discovery body (`GET /api/v1/transfer/capabilities`). Returns
 * `{ download, upload, storage_hosts, storage_buckets: [{host, bucket}],
 * max_window, url_ttl_seconds }`; unknown fields are ignored and missing lists
 * are empty. Throws an `Error` with `code` `discovery_too_large` or
 * `discovery_malformed`.
 * @param {Uint8Array} body
 * @returns {any}
 */
export function parseDirectDiscovery(body) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArray8ToWasm0(body, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        wasm.parseDirectDiscovery(retptr, ptr0, len0);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        if (r2) {
            throw takeObject(r1);
        }
        return takeObject(r0);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * The shared retry policy of the pinned per-chunk route (4 attempts, 150 s of waiting in all, a
 * stated `Retry-After` kept, otherwise 1 s doubling). `outcome` is what `classifyDirectAnswer`
 * returned for `call: "pinned_chunk"`; `attempt` is the 1-based number of the attempt that just
 * failed; `waitedMs` is the total waited so far.
 * @param {any} outcome
 * @param {number} attempt
 * @param {number} waited_ms
 * @returns {any}
 */
export function pinnedRetryDecision(outcome, attempt, waited_ms) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        wasm.pinnedRetryDecision(retptr, addHeapObject(outcome), attempt, waited_ms);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        if (r2) {
            throw takeObject(r1);
        }
        return takeObject(r0);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * Return the base storage quota (in bytes) for a plan slug.
 * @param {string} plan_slug
 * @returns {bigint}
 */
export function plan_base_storage_bytes(plan_slug) {
    const ptr0 = passStringToWasm0(plan_slug, wasm.__wbindgen_export, wasm.__wbindgen_export2);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.plan_base_storage_bytes(ptr0, len0);
    return ret;
}

/**
 * Whether the plan supports purchasing extra storage.
 * @param {string} plan_slug
 * @returns {boolean}
 */
export function plan_can_add_storage(plan_slug) {
    const ptr0 = passStringToWasm0(plan_slug, wasm.__wbindgen_export, wasm.__wbindgen_export2);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.plan_can_add_storage(ptr0, len0);
    return ret !== 0;
}

/**
 * Plan how to split a file into chunks for upload based on the client profile.
 *
 * `profile` must be one of: `"desktop"`, `"web"`, `"mobile"`, `"backup"`.
 * Returns `{ chunk_size_bytes: number, chunk_count: number }`.
 * @param {bigint} file_size_bytes
 * @param {string} profile
 * @returns {any}
 */
export function plan_chunks(file_size_bytes, profile) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passStringToWasm0(profile, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        wasm.plan_chunks(retptr, file_size_bytes, ptr0, len0);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        if (r2) {
            throw takeObject(r1);
        }
        return takeObject(r0);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * Compute the effective quota after add-ons and bonus bytes.
 * @param {string} plan_slug
 * @param {bigint} extra_tb
 * @param {bigint} bonus_bytes
 * @returns {bigint}
 */
export function plan_effective_quota(plan_slug, extra_tb, bonus_bytes) {
    const ptr0 = passStringToWasm0(plan_slug, wasm.__wbindgen_export, wasm.__wbindgen_export2);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.plan_effective_quota(ptr0, len0, extra_tb, bonus_bytes);
    return ret;
}

/**
 * Maximum additional TB a plan may purchase.
 * @param {string} plan_slug
 * @returns {bigint}
 */
export function plan_max_extra_tb(plan_slug) {
    const ptr0 = passStringToWasm0(plan_slug, wasm.__wbindgen_export, wasm.__wbindgen_export2);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.plan_max_extra_tb(ptr0, len0);
    return ret;
}

/**
 * Monthly cost in cents for a plan with optional add-ons.
 * @param {string} plan_slug
 * @param {bigint} extra_tb
 * @param {bigint} extra_users
 * @returns {bigint}
 */
export function plan_monthly_cost_cents(plan_slug, extra_tb, extra_users) {
    const ptr0 = passStringToWasm0(plan_slug, wasm.__wbindgen_export, wasm.__wbindgen_export2);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.plan_monthly_cost_cents(ptr0, len0, extra_tb, extra_users);
    return ret;
}

/**
 * Recover a master key from a 12-word BIP39 recovery phrase.
 * Returns the 32-byte master key as `Uint8Array`.
 * @param {string} phrase
 * @returns {Uint8Array}
 */
export function recover_from_phrase(phrase) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passStringToWasm0(phrase, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        wasm.recover_from_phrase(retptr, ptr0, len0);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
        if (r3) {
            throw takeObject(r2);
        }
        var v2 = getArrayU8FromWasm0(r0, r1).slice();
        wasm.__wbindgen_export4(r0, r1 * 1, 1);
        return v2;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * A URL for a log line: scheme and host only.
 * @param {string} url
 * @returns {string}
 */
export function redactUrl(url) {
    let deferred2_0;
    let deferred2_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passStringToWasm0(url, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        wasm.redactUrl(retptr, ptr0, len0);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        deferred2_0 = r0;
        deferred2_1 = r1;
        return getStringFromWasm0(r0, r1);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        wasm.__wbindgen_export4(deferred2_0, deferred2_1, 1);
    }
}

/**
 * What to do with an unfinished upload found on disk. `recorded` is `"api"` or `"direct"` (what the resume
 * record names); `discovery` is `{ kind, upload? }` with `kind` `"offers"` (and `upload: true | false`),
 * `"not_supported"` (a JSON 404), `"unknown"` (a 5xx, a timeout, a bare 404: no usable answer) or
 * `"unauthorized"` (401 or 403); `forcedApi` is the user's own switch. Returns `"continue_api"`,
 * `"continue_direct"`, `"abandon_to_api"`, `"keep_record_and_fail"` or `"keep_record_and_reauthenticate"`.
 * A recorded direct session is given up only on a definite no. Throws `recorded_invalid` or
 * `discovery_state_invalid`.
 * @param {string} recorded
 * @param {any} discovery
 * @param {boolean} forced_api
 * @returns {string}
 */
export function resumeTransport(recorded, discovery, forced_api) {
    let deferred3_0;
    let deferred3_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passStringToWasm0(recorded, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        wasm.resumeTransport(retptr, ptr0, len0, addHeapObject(discovery), forced_api);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
        var ptr2 = r0;
        var len2 = r1;
        if (r3) {
            ptr2 = 0; len2 = 0;
            throw takeObject(r2);
        }
        deferred3_0 = ptr2;
        deferred3_1 = len2;
        return getStringFromWasm0(ptr2, len2);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        wasm.__wbindgen_export4(deferred3_0, deferred3_1, 1);
    }
}

/**
 * Text that may contain URLs, made safe to print.
 * @param {string} text
 * @returns {string}
 */
export function scrubText(text) {
    let deferred2_0;
    let deferred2_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passStringToWasm0(text, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        wasm.scrubText(retptr, ptr0, len0);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        deferred2_0 = r0;
        deferred2_1 = r1;
        return getStringFromWasm0(r0, r1);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        wasm.__wbindgen_export4(deferred2_0, deferred2_1, 1);
    }
}

/**
 * Seal a content key to a request's public key (anonymous uploader path).
 * `r_pub` and `content_key` are 32 bytes; `file_id` is arbitrary bytes.
 * Returns `{ e_pub: Uint8Array, wrapped_key: Uint8Array }`.
 * @param {Uint8Array} r_pub
 * @param {Uint8Array} file_id
 * @param {Uint8Array} content_key
 * @returns {any}
 */
export function seal_to_request(r_pub, file_id, content_key) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArray8ToWasm0(r_pub, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(file_id, wasm.__wbindgen_export);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArray8ToWasm0(content_key, wasm.__wbindgen_export);
        const len2 = WASM_VECTOR_LEN;
        wasm.seal_to_request(retptr, ptr0, len0, ptr1, len1, ptr2, len2);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        if (r2) {
            throw takeObject(r1);
        }
        return takeObject(r0);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * Compute the shard sync plan to converge `local` (the client's shard set) with
 * `remote` (the server manifest from `GET /api/v1/search-index/shards`), LWW.
 * `local`/`remote` are arrays of `{ bucket, page, version }`; returns
 * `{ toPut, toGet, toDelete }` arrays of `{ bucket, page }`. See the core
 * `search_sync::diff_manifest` doc for the `localIsAuthoritative` semantics.
 * @param {any} local
 * @param {any} remote
 * @param {boolean} local_is_authoritative
 * @returns {any}
 */
export function searchIndexSyncPlan(local, remote, local_is_authoritative) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        wasm.searchIndexSyncPlan(retptr, addHeapObject(local), addHeapObject(remote), local_is_authoritative);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        if (r2) {
            throw takeObject(r1);
        }
        return takeObject(r0);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * The most a storage GET of `len` ciphertext bytes may take, in milliseconds (the same formula as a PUT).
 * Throws like `storagePutTotalMs`.
 * @param {number} len
 * @returns {number}
 */
export function storageGetTotalMs(len) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        wasm.storageGetTotalMs(retptr, len);
        var r0 = getDataViewMemory0().getFloat64(retptr + 8 * 0, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
        if (r3) {
            throw takeObject(r2);
        }
        return r0;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * The most a storage PUT of `len` ciphertext bytes may take, in milliseconds: a minute plus the
 * chunk at 1 Mbit/s (`60 s + ceil(len / 131072) s`). Throws an `Error` with `code` `length_invalid`
 * for a `len` that is not a whole, non-negative number.
 * @param {number} len
 * @returns {number}
 */
export function storagePutTotalMs(len) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        wasm.storagePutTotalMs(retptr, len);
        var r0 = getDataViewMemory0().getFloat64(retptr + 8 * 0, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
        if (r3) {
            throw takeObject(r2);
        }
        return r0;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * Format a byte count as a human-readable SI string (e.g. "5.0 TB").
 * @param {bigint} bytes
 * @returns {string}
 */
export function storage_format_si(bytes) {
    let deferred1_0;
    let deferred1_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        wasm.storage_format_si(retptr, bytes);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        deferred1_0 = r0;
        deferred1_1 = r1;
        return getStringFromWasm0(r0, r1);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        wasm.__wbindgen_export4(deferred1_0, deferred1_1, 1);
    }
}

/**
 * Decrypt a `nonce(12) || ciphertext` blob produced by `transfer_encrypt`.
 *
 * Delegates to `transfer::decrypt_transfer`.
 * @param {Uint8Array} key
 * @param {Uint8Array} blob
 * @returns {Uint8Array}
 */
export function transfer_decrypt(key, blob) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArray8ToWasm0(key, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(blob, wasm.__wbindgen_export);
        const len1 = WASM_VECTOR_LEN;
        wasm.transfer_decrypt(retptr, ptr0, len0, ptr1, len1);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
        if (r3) {
            throw takeObject(r2);
        }
        var v3 = getArrayU8FromWasm0(r0, r1).slice();
        wasm.__wbindgen_export4(r0, r1 * 1, 1);
        return v3;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * Derive the 32-byte AES-256 transfer key from a shared secret + session id.
 *
 * `HKDF-SHA256(ikm = shared_secret, salt = session_id, info = "beebeeb-transfer-v1")`.
 * SALTED with `session_id` — NOT the salt-less `derive_sas_bytes` derivation.
 * @param {Uint8Array} shared_secret
 * @param {Uint8Array} session_id
 * @returns {Uint8Array}
 */
export function transfer_derive_key(shared_secret, session_id) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArray8ToWasm0(shared_secret, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(session_id, wasm.__wbindgen_export);
        const len1 = WASM_VECTOR_LEN;
        wasm.transfer_derive_key(retptr, ptr0, len0, ptr1, len1);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
        if (r3) {
            throw takeObject(r2);
        }
        var v3 = getArrayU8FromWasm0(r0, r1).slice();
        wasm.__wbindgen_export4(r0, r1 * 1, 1);
        return v3;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * Derive the 4-byte SAS material from a shared secret + session id.
 *
 * `HKDF-SHA256(ikm = shared_secret, salt = session_id, info = "beebeeb-sas-v1")`.
 * SALTED with `session_id`. Both devices computing the same 4 bytes (and thus
 * the same 4 SAS words) is the MITM check. This is intentionally distinct from
 * the salt-less `derive_sas_bytes` exported elsewhere.
 * @param {Uint8Array} shared_secret
 * @param {Uint8Array} session_id
 * @returns {Uint8Array}
 */
export function transfer_derive_sas_bytes(shared_secret, session_id) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArray8ToWasm0(shared_secret, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(session_id, wasm.__wbindgen_export);
        const len1 = WASM_VECTOR_LEN;
        wasm.transfer_derive_sas_bytes(retptr, ptr0, len0, ptr1, len1);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
        if (r3) {
            throw takeObject(r2);
        }
        var v3 = getArrayU8FromWasm0(r0, r1).slice();
        wasm.__wbindgen_export4(r0, r1 * 1, 1);
        return v3;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * Encrypt a transfer payload under the transfer key.
 *
 * Returns `nonce(12) || AES-256-GCM ciphertext+tag` — the same wire format as
 * `encrypt_blob`. Delegates to `transfer::encrypt_transfer`.
 * @param {Uint8Array} key
 * @param {Uint8Array} plaintext
 * @returns {Uint8Array}
 */
export function transfer_encrypt(key, plaintext) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArray8ToWasm0(key, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(plaintext, wasm.__wbindgen_export);
        const len1 = WASM_VECTOR_LEN;
        wasm.transfer_encrypt(retptr, ptr0, len0, ptr1, len1);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
        if (r3) {
            throw takeObject(r2);
        }
        var v3 = getArrayU8FromWasm0(r0, r1).slice();
        wasm.__wbindgen_export4(r0, r1 * 1, 1);
        return v3;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

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
 * @returns {any}
 */
export function transfer_generate_keypair() {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        wasm.transfer_generate_keypair(retptr);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        if (r2) {
            throw takeObject(r1);
        }
        return takeObject(r0);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * Map 4 SAS bytes to 4 words from the canonical 256-word transfer wordlist.
 *
 * Returns a JS array of 4 strings. Keeps the wordlist as one source of truth
 * (core) so web and Swift render identical words for the same SAS bytes.
 * @param {Uint8Array} sas_bytes
 * @returns {any}
 */
export function transfer_sas_to_words(sas_bytes) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArray8ToWasm0(sas_bytes, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        wasm.transfer_sas_to_words(retptr, ptr0, len0);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        if (r2) {
            throw takeObject(r1);
        }
        return takeObject(r0);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * @param {Uint8Array} folder_key
 * @param {string} shared_folder_id
 * @param {string} item_id
 * @param {number} kind
 * @param {Uint8Array} wrapped
 * @returns {Uint8Array}
 */
export function unwrapFolderChild(folder_key, shared_folder_id, item_id, kind, wrapped) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArray8ToWasm0(folder_key, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(shared_folder_id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(item_id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passArray8ToWasm0(wrapped, wasm.__wbindgen_export);
        const len3 = WASM_VECTOR_LEN;
        wasm.unwrapFolderChild(retptr, ptr0, len0, ptr1, len1, ptr2, len2, kind, ptr3, len3);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
        if (r3) {
            throw takeObject(r2);
        }
        var v5 = getArrayU8FromWasm0(r0, r1).slice();
        wasm.__wbindgen_export4(r0, r1 * 1, 1);
        return v5;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * Open an L6 custody record. Never accepts a legacy (unbound) owner copy.
 * @param {Uint8Array} master_key
 * @param {string} folder_id
 * @param {Uint8Array} wrapped
 * @returns {Uint8Array}
 */
export function unwrapFolderCustody(master_key, folder_id, wrapped) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArray8ToWasm0(master_key, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(folder_id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArray8ToWasm0(wrapped, wasm.__wbindgen_export);
        const len2 = WASM_VECTOR_LEN;
        wasm.unwrapFolderCustody(retptr, ptr0, len0, ptr1, len1, ptr2, len2);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
        if (r3) {
            throw takeObject(r2);
        }
        var v4 = getArrayU8FromWasm0(r0, r1).slice();
        wasm.__wbindgen_export4(r0, r1 * 1, 1);
        return v4;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * Open a purpose-bound invite owner copy; never performs a legacy fallback.
 * @param {Uint8Array} master_key
 * @param {string} folder_id
 * @param {Uint8Array} wrapped
 * @returns {Uint8Array}
 */
export function unwrapInviteOwnerCopy(master_key, folder_id, wrapped) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArray8ToWasm0(master_key, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(folder_id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArray8ToWasm0(wrapped, wasm.__wbindgen_export);
        const len2 = WASM_VECTOR_LEN;
        wasm.unwrapInviteOwnerCopy(retptr, ptr0, len0, ptr1, len1, ptr2, len2);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
        if (r3) {
            throw takeObject(r2);
        }
        var v4 = getArrayU8FromWasm0(r0, r1).slice();
        wasm.__wbindgen_export4(r0, r1 * 1, 1);
        return v4;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * Open a link's owner copy of K_c. K_c is the deliberate export: JS puts it
 * in the link fragment. The master key never leaves the caller.
 * @param {Uint8Array} master_key
 * @param {string} share_id
 * @param {Uint8Array} wrapped
 * @returns {Uint8Array}
 */
export function unwrapLinkOwnerKey(master_key, share_id, wrapped) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArray8ToWasm0(master_key, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(share_id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArray8ToWasm0(wrapped, wasm.__wbindgen_export);
        const len2 = WASM_VECTOR_LEN;
        wasm.unwrapLinkOwnerKey(retptr, ptr0, len0, ptr1, len1, ptr2, len2);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
        if (r3) {
            throw takeObject(r2);
        }
        var v4 = getArrayU8FromWasm0(r0, r1).slice();
        wasm.__wbindgen_export4(r0, r1 * 1, 1);
        return v4;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * Open a link's owner copy of its token.
 * @param {Uint8Array} master_key
 * @param {string} share_id
 * @param {Uint8Array} wrapped
 * @returns {Uint8Array}
 */
export function unwrapLinkOwnerToken(master_key, share_id, wrapped) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArray8ToWasm0(master_key, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(share_id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArray8ToWasm0(wrapped, wasm.__wbindgen_export);
        const len2 = WASM_VECTOR_LEN;
        wasm.unwrapLinkOwnerToken(retptr, ptr0, len0, ptr1, len1, ptr2, len2);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
        if (r3) {
            throw takeObject(r2);
        }
        var v4 = getArrayU8FromWasm0(r0, r1).slice();
        wasm.__wbindgen_export4(r0, r1 * 1, 1);
        return v4;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * Open only an L8 owner file-key record, requiring exactly 32 plaintext bytes.
 * @param {Uint8Array} master_key
 * @param {string} item_id
 * @param {Uint8Array} wrapped
 * @returns {Uint8Array}
 */
export function unwrapOwnerFileKey(master_key, item_id, wrapped) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArray8ToWasm0(master_key, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(item_id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArray8ToWasm0(wrapped, wasm.__wbindgen_export);
        const len2 = WASM_VECTOR_LEN;
        wasm.unwrapOwnerFileKey(retptr, ptr0, len0, ptr1, len1, ptr2, len2);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
        if (r3) {
            throw takeObject(r2);
        }
        var v4 = getArrayU8FromWasm0(r0, r1).slice();
        wasm.__wbindgen_export4(r0, r1 * 1, 1);
        return v4;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * Unwrap a request's X25519 private key. Returns 32-byte `Uint8Array`.
 * @param {Uint8Array} master_key
 * @param {Uint8Array} request_id
 * @param {Uint8Array} wrapped
 * @param {Uint8Array} nonce
 * @returns {Uint8Array}
 */
export function unwrap_request_private(master_key, request_id, wrapped, nonce) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArray8ToWasm0(master_key, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(request_id, wasm.__wbindgen_export);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArray8ToWasm0(wrapped, wasm.__wbindgen_export);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passArray8ToWasm0(nonce, wasm.__wbindgen_export);
        const len3 = WASM_VECTOR_LEN;
        wasm.unwrap_request_private(retptr, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
        if (r3) {
            throw takeObject(r2);
        }
        var v5 = getArrayU8FromWasm0(r0, r1).slice();
        wasm.__wbindgen_export4(r0, r1 * 1, 1);
        return v5;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * L7 wire = nonce(12) || ciphertext+tag(48); UUID strings bind raw UUID bytes.
 * @param {Uint8Array} folder_key
 * @param {string} shared_folder_id
 * @param {string} item_id
 * @param {number} kind
 * @param {Uint8Array} child_key
 * @returns {Uint8Array}
 */
export function wrapFolderChild(folder_key, shared_folder_id, item_id, kind, child_key) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArray8ToWasm0(folder_key, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(shared_folder_id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(item_id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passArray8ToWasm0(child_key, wasm.__wbindgen_export);
        const len3 = WASM_VECTOR_LEN;
        wasm.wrapFolderChild(retptr, ptr0, len0, ptr1, len1, ptr2, len2, kind, ptr3, len3);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
        if (r3) {
            throw takeObject(r2);
        }
        var v5 = getArrayU8FromWasm0(r0, r1).slice();
        wasm.__wbindgen_export4(r0, r1 * 1, 1);
        return v5;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * Seal a shared folder's key to the owner's master key (L6 custody record).
 * @param {Uint8Array} master_key
 * @param {string} folder_id
 * @param {Uint8Array} folder_key
 * @returns {Uint8Array}
 */
export function wrapFolderCustody(master_key, folder_id, folder_key) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArray8ToWasm0(master_key, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(folder_id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArray8ToWasm0(folder_key, wasm.__wbindgen_export);
        const len2 = WASM_VECTOR_LEN;
        wasm.wrapFolderCustody(retptr, ptr0, len0, ptr1, len1, ptr2, len2);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
        if (r3) {
            throw takeObject(r2);
        }
        var v4 = getArrayU8FromWasm0(r0, r1).slice();
        wasm.__wbindgen_export4(r0, r1 * 1, 1);
        return v4;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * Seal a purpose-bound invite owner copy (L9).
 * @param {Uint8Array} master_key
 * @param {string} folder_id
 * @param {Uint8Array} folder_key
 * @returns {Uint8Array}
 */
export function wrapInviteOwnerCopy(master_key, folder_id, folder_key) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArray8ToWasm0(master_key, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(folder_id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArray8ToWasm0(folder_key, wasm.__wbindgen_export);
        const len2 = WASM_VECTOR_LEN;
        wasm.wrapInviteOwnerCopy(retptr, ptr0, len0, ptr1, len1, ptr2, len2);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
        if (r3) {
            throw takeObject(r2);
        }
        var v4 = getArrayU8FromWasm0(r0, r1).slice();
        wasm.__wbindgen_export4(r0, r1 * 1, 1);
        return v4;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * Seal a folder link's fragment key K_c to the owner's master key, bound to
 * the link's share id (so the owner can copy the link again later).
 * @param {Uint8Array} master_key
 * @param {string} share_id
 * @param {Uint8Array} link_key
 * @returns {Uint8Array}
 */
export function wrapLinkOwnerKey(master_key, share_id, link_key) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArray8ToWasm0(master_key, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(share_id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArray8ToWasm0(link_key, wasm.__wbindgen_export);
        const len2 = WASM_VECTOR_LEN;
        wasm.wrapLinkOwnerKey(retptr, ptr0, len0, ptr1, len1, ptr2, len2);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
        if (r3) {
            throw takeObject(r2);
        }
        var v4 = getArrayU8FromWasm0(r0, r1).slice();
        wasm.__wbindgen_export4(r0, r1 * 1, 1);
        return v4;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * Seal a folder link's raw token to the owner's master key, bound to the
 * link's share id.
 * @param {Uint8Array} master_key
 * @param {string} share_id
 * @param {Uint8Array} token
 * @returns {Uint8Array}
 */
export function wrapLinkOwnerToken(master_key, share_id, token) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArray8ToWasm0(master_key, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(share_id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArray8ToWasm0(token, wasm.__wbindgen_export);
        const len2 = WASM_VECTOR_LEN;
        wasm.wrapLinkOwnerToken(retptr, ptr0, len0, ptr1, len1, ptr2, len2);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
        if (r3) {
            throw takeObject(r2);
        }
        var v4 = getArrayU8FromWasm0(r0, r1).slice();
        wasm.__wbindgen_export4(r0, r1 * 1, 1);
        return v4;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * Seal an owner file-key adoption record with its own purpose key and AAD (L8).
 * Item IDs use the exact UTF-8 string bytes used by the L6 exports.
 * @param {Uint8Array} master_key
 * @param {string} item_id
 * @param {Uint8Array} file_key
 * @returns {Uint8Array}
 */
export function wrapOwnerFileKey(master_key, item_id, file_key) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArray8ToWasm0(master_key, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(item_id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArray8ToWasm0(file_key, wasm.__wbindgen_export);
        const len2 = WASM_VECTOR_LEN;
        wasm.wrapOwnerFileKey(retptr, ptr0, len0, ptr1, len1, ptr2, len2);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
        if (r3) {
            throw takeObject(r2);
        }
        var v4 = getArrayU8FromWasm0(r0, r1).slice();
        wasm.__wbindgen_export4(r0, r1 * 1, 1);
        return v4;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * Wrap a request's X25519 private key under the owner's master key.
 * Returns `{ wrapped: Uint8Array, nonce: Uint8Array }`.
 * @param {Uint8Array} master_key
 * @param {Uint8Array} request_id
 * @param {Uint8Array} r_priv
 * @returns {any}
 */
export function wrap_request_private(master_key, request_id, r_priv) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArray8ToWasm0(master_key, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(request_id, wasm.__wbindgen_export);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArray8ToWasm0(r_priv, wasm.__wbindgen_export);
        const len2 = WASM_VECTOR_LEN;
        wasm.wrap_request_private(retptr, ptr0, len0, ptr1, len1, ptr2, len2);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        if (r2) {
            throw takeObject(r1);
        }
        return takeObject(r0);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * Compute X25519 shared secret for sharing. Returns 32-byte `Uint8Array`.
 * @param {Uint8Array} my_private
 * @param {Uint8Array} their_public
 * @returns {Uint8Array}
 */
export function x25519_shared_secret(my_private, their_public) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArray8ToWasm0(my_private, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(their_public, wasm.__wbindgen_export);
        const len1 = WASM_VECTOR_LEN;
        wasm.x25519_shared_secret(retptr, ptr0, len0, ptr1, len1);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
        if (r3) {
            throw takeObject(r2);
        }
        var v3 = getArrayU8FromWasm0(r0, r1).slice();
        wasm.__wbindgen_export4(r0, r1 * 1, 1);
        return v3;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg_Error_960c155d3d49e4c2: function(arg0, arg1) {
            const ret = Error(getStringFromWasm0(arg0, arg1));
            return addHeapObject(ret);
        },
        __wbg_Number_32bf70a599af1d4b: function(arg0) {
            const ret = Number(getObject(arg0));
            return ret;
        },
        __wbg_String_8564e559799eccda: function(arg0, arg1) {
            const ret = String(getObject(arg1));
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg___wbindgen_bigint_get_as_i64_3d3aba5d616c6a51: function(arg0, arg1) {
            const v = getObject(arg1);
            const ret = typeof(v) === 'bigint' ? v : undefined;
            getDataViewMemory0().setBigInt64(arg0 + 8 * 1, isLikeNone(ret) ? BigInt(0) : ret, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, !isLikeNone(ret), true);
        },
        __wbg___wbindgen_boolean_get_6ea149f0a8dcc5ff: function(arg0) {
            const v = getObject(arg0);
            const ret = typeof(v) === 'boolean' ? v : undefined;
            return isLikeNone(ret) ? 0xFFFFFF : ret ? 1 : 0;
        },
        __wbg___wbindgen_debug_string_ab4b34d23d6778bd: function(arg0, arg1) {
            const ret = debugString(getObject(arg1));
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg___wbindgen_in_a5d8b22e52b24dd1: function(arg0, arg1) {
            const ret = getObject(arg0) in getObject(arg1);
            return ret;
        },
        __wbg___wbindgen_is_bigint_ec25c7f91b4d9e93: function(arg0) {
            const ret = typeof(getObject(arg0)) === 'bigint';
            return ret;
        },
        __wbg___wbindgen_is_function_3baa9db1a987f47d: function(arg0) {
            const ret = typeof(getObject(arg0)) === 'function';
            return ret;
        },
        __wbg___wbindgen_is_object_63322ec0cd6ea4ef: function(arg0) {
            const val = getObject(arg0);
            const ret = typeof(val) === 'object' && val !== null;
            return ret;
        },
        __wbg___wbindgen_is_string_6df3bf7ef1164ed3: function(arg0) {
            const ret = typeof(getObject(arg0)) === 'string';
            return ret;
        },
        __wbg___wbindgen_is_undefined_29a43b4d42920abd: function(arg0) {
            const ret = getObject(arg0) === undefined;
            return ret;
        },
        __wbg___wbindgen_jsval_eq_d3465d8a07697228: function(arg0, arg1) {
            const ret = getObject(arg0) === getObject(arg1);
            return ret;
        },
        __wbg___wbindgen_jsval_loose_eq_cac3565e89b4134c: function(arg0, arg1) {
            const ret = getObject(arg0) == getObject(arg1);
            return ret;
        },
        __wbg___wbindgen_number_get_c7f42aed0525c451: function(arg0, arg1) {
            const obj = getObject(arg1);
            const ret = typeof(obj) === 'number' ? obj : undefined;
            getDataViewMemory0().setFloat64(arg0 + 8 * 1, isLikeNone(ret) ? 0 : ret, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, !isLikeNone(ret), true);
        },
        __wbg___wbindgen_string_get_7ed5322991caaec5: function(arg0, arg1) {
            const obj = getObject(arg1);
            const ret = typeof(obj) === 'string' ? obj : undefined;
            var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            var len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg___wbindgen_throw_6b64449b9b9ed33c: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbg_call_14b169f759b26747: function() { return handleError(function (arg0, arg1) {
            const ret = getObject(arg0).call(getObject(arg1));
            return addHeapObject(ret);
        }, arguments); },
        __wbg_call_a24592a6f349a97e: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = getObject(arg0).call(getObject(arg1), getObject(arg2));
            return addHeapObject(ret);
        }, arguments); },
        __wbg_crypto_38df2bab126b63dc: function(arg0) {
            const ret = getObject(arg0).crypto;
            return addHeapObject(ret);
        },
        __wbg_done_9158f7cc8751ba32: function(arg0) {
            const ret = getObject(arg0).done;
            return ret;
        },
        __wbg_entries_e0b73aa8571ddb56: function(arg0) {
            const ret = Object.entries(getObject(arg0));
            return addHeapObject(ret);
        },
        __wbg_from_0dbf29f09e7fb200: function(arg0) {
            const ret = Array.from(getObject(arg0));
            return addHeapObject(ret);
        },
        __wbg_getRandomValues_c44a50d8cfdaebeb: function() { return handleError(function (arg0, arg1) {
            getObject(arg0).getRandomValues(getObject(arg1));
        }, arguments); },
        __wbg_get_1affdbdd5573b16a: function() { return handleError(function (arg0, arg1) {
            const ret = Reflect.get(getObject(arg0), getObject(arg1));
            return addHeapObject(ret);
        }, arguments); },
        __wbg_get_6011fa3a58f61074: function() { return handleError(function (arg0, arg1) {
            const ret = Reflect.get(getObject(arg0), getObject(arg1));
            return addHeapObject(ret);
        }, arguments); },
        __wbg_get_8360291721e2339f: function(arg0, arg1) {
            const ret = getObject(arg0)[arg1 >>> 0];
            return addHeapObject(ret);
        },
        __wbg_get_unchecked_17f53dad852b9588: function(arg0, arg1) {
            const ret = getObject(arg0)[arg1 >>> 0];
            return addHeapObject(ret);
        },
        __wbg_get_with_ref_key_6412cf3094599694: function(arg0, arg1) {
            const ret = getObject(arg0)[getObject(arg1)];
            return addHeapObject(ret);
        },
        __wbg_instanceof_ArrayBuffer_7c8433c6ed14ffe3: function(arg0) {
            let result;
            try {
                result = getObject(arg0) instanceof ArrayBuffer;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_Map_1b76fd4635be43eb: function(arg0) {
            let result;
            try {
                result = getObject(arg0) instanceof Map;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_Uint8Array_152ba1f289edcf3f: function(arg0) {
            let result;
            try {
                result = getObject(arg0) instanceof Uint8Array;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_isArray_c3109d14ffc06469: function(arg0) {
            const ret = Array.isArray(getObject(arg0));
            return ret;
        },
        __wbg_isSafeInteger_4fc213d1989d6d2a: function(arg0) {
            const ret = Number.isSafeInteger(getObject(arg0));
            return ret;
        },
        __wbg_iterator_013bc09ec998c2a7: function() {
            const ret = Symbol.iterator;
            return addHeapObject(ret);
        },
        __wbg_length_3d4ecd04bd8d22f1: function(arg0) {
            const ret = getObject(arg0).length;
            return ret;
        },
        __wbg_length_9f1775224cf1d815: function(arg0) {
            const ret = getObject(arg0).length;
            return ret;
        },
        __wbg_msCrypto_bd5a034af96bcba6: function(arg0) {
            const ret = getObject(arg0).msCrypto;
            return addHeapObject(ret);
        },
        __wbg_new_0c7403db6e782f19: function(arg0) {
            const ret = new Uint8Array(getObject(arg0));
            return addHeapObject(ret);
        },
        __wbg_new_34d45cc8e36aaead: function() {
            const ret = new Map();
            return addHeapObject(ret);
        },
        __wbg_new_5e360d2ff7b9e1c3: function(arg0, arg1) {
            const ret = new Error(getStringFromWasm0(arg0, arg1));
            return addHeapObject(ret);
        },
        __wbg_new_682678e2f47e32bc: function() {
            const ret = new Array();
            return addHeapObject(ret);
        },
        __wbg_new_aa8d0fa9762c29bd: function() {
            const ret = new Object();
            return addHeapObject(ret);
        },
        __wbg_new_from_slice_b5ea43e23f6008c0: function(arg0, arg1) {
            const ret = new Uint8Array(getArrayU8FromWasm0(arg0, arg1));
            return addHeapObject(ret);
        },
        __wbg_new_with_length_223c4ea248649e55: function(arg0) {
            const ret = new Array(arg0 >>> 0);
            return addHeapObject(ret);
        },
        __wbg_new_with_length_8c854e41ea4dae9b: function(arg0) {
            const ret = new Uint8Array(arg0 >>> 0);
            return addHeapObject(ret);
        },
        __wbg_next_0340c4ae324393c3: function() { return handleError(function (arg0) {
            const ret = getObject(arg0).next();
            return addHeapObject(ret);
        }, arguments); },
        __wbg_next_7646edaa39458ef7: function(arg0) {
            const ret = getObject(arg0).next;
            return addHeapObject(ret);
        },
        __wbg_node_84ea875411254db1: function(arg0) {
            const ret = getObject(arg0).node;
            return addHeapObject(ret);
        },
        __wbg_process_44c7a14e11e9f69e: function(arg0) {
            const ret = getObject(arg0).process;
            return addHeapObject(ret);
        },
        __wbg_prototypesetcall_a6b02eb00b0f4ce2: function(arg0, arg1, arg2) {
            Uint8Array.prototype.set.call(getArrayU8FromWasm0(arg0, arg1), getObject(arg2));
        },
        __wbg_push_471a5b068a5295f6: function(arg0, arg1) {
            const ret = getObject(arg0).push(getObject(arg1));
            return ret;
        },
        __wbg_randomFillSync_6c25eac9869eb53c: function() { return handleError(function (arg0, arg1) {
            getObject(arg0).randomFillSync(takeObject(arg1));
        }, arguments); },
        __wbg_require_b4edbdcf3e2a1ef0: function() { return handleError(function () {
            const ret = module.require;
            return addHeapObject(ret);
        }, arguments); },
        __wbg_set_022bee52d0b05b19: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = Reflect.set(getObject(arg0), getObject(arg1), getObject(arg2));
            return ret;
        }, arguments); },
        __wbg_set_3bf1de9fab0cd644: function(arg0, arg1, arg2) {
            getObject(arg0)[arg1 >>> 0] = takeObject(arg2);
        },
        __wbg_set_6be42768c690e380: function(arg0, arg1, arg2) {
            getObject(arg0)[takeObject(arg1)] = takeObject(arg2);
        },
        __wbg_set_fde2cec06c23692b: function(arg0, arg1, arg2) {
            const ret = getObject(arg0).set(getObject(arg1), getObject(arg2));
            return addHeapObject(ret);
        },
        __wbg_static_accessor_GLOBAL_8cfadc87a297ca02: function() {
            const ret = typeof global === 'undefined' ? null : global;
            return isLikeNone(ret) ? 0 : addHeapObject(ret);
        },
        __wbg_static_accessor_GLOBAL_THIS_602256ae5c8f42cf: function() {
            const ret = typeof globalThis === 'undefined' ? null : globalThis;
            return isLikeNone(ret) ? 0 : addHeapObject(ret);
        },
        __wbg_static_accessor_SELF_e445c1c7484aecc3: function() {
            const ret = typeof self === 'undefined' ? null : self;
            return isLikeNone(ret) ? 0 : addHeapObject(ret);
        },
        __wbg_static_accessor_WINDOW_f20e8576ef1e0f17: function() {
            const ret = typeof window === 'undefined' ? null : window;
            return isLikeNone(ret) ? 0 : addHeapObject(ret);
        },
        __wbg_subarray_f8ca46a25b1f5e0d: function(arg0, arg1, arg2) {
            const ret = getObject(arg0).subarray(arg1 >>> 0, arg2 >>> 0);
            return addHeapObject(ret);
        },
        __wbg_value_ee3a06f4579184fa: function(arg0) {
            const ret = getObject(arg0).value;
            return addHeapObject(ret);
        },
        __wbg_versions_276b2795b1c6a219: function(arg0) {
            const ret = getObject(arg0).versions;
            return addHeapObject(ret);
        },
        __wbg_wasmsignedurl_new: function(arg0) {
            const ret = WasmSignedUrl.__wrap(arg0);
            return addHeapObject(ret);
        },
        __wbindgen_cast_0000000000000001: function(arg0) {
            // Cast intrinsic for `F64 -> Externref`.
            const ret = arg0;
            return addHeapObject(ret);
        },
        __wbindgen_cast_0000000000000002: function(arg0) {
            // Cast intrinsic for `I64 -> Externref`.
            const ret = arg0;
            return addHeapObject(ret);
        },
        __wbindgen_cast_0000000000000003: function(arg0, arg1) {
            // Cast intrinsic for `Ref(Slice(U8)) -> NamedExternref("Uint8Array")`.
            const ret = getArrayU8FromWasm0(arg0, arg1);
            return addHeapObject(ret);
        },
        __wbindgen_cast_0000000000000004: function(arg0, arg1) {
            // Cast intrinsic for `Ref(String) -> Externref`.
            const ret = getStringFromWasm0(arg0, arg1);
            return addHeapObject(ret);
        },
        __wbindgen_cast_0000000000000005: function(arg0) {
            // Cast intrinsic for `U64 -> Externref`.
            const ret = BigInt.asUintN(64, arg0);
            return addHeapObject(ret);
        },
        __wbindgen_object_clone_ref: function(arg0) {
            const ret = getObject(arg0);
            return addHeapObject(ret);
        },
        __wbindgen_object_drop_ref: function(arg0) {
            takeObject(arg0);
        },
    };
    return {
        __proto__: null,
        "./beebeeb_wasm_bg.js": import0,
    };
}

const WasmBreachCheckFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmbreachcheck_free(ptr >>> 0, 1));
const WasmChunkDecryptorFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmchunkdecryptor_free(ptr >>> 0, 1));
const WasmChunkEncryptorFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmchunkencryptor_free(ptr >>> 0, 1));
const WasmDirectDiscoveryCacheFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmdirectdiscoverycache_free(ptr >>> 0, 1));
const WasmDirectHealthFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmdirecthealth_free(ptr >>> 0, 1));
const WasmDownloadPlannerFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmdownloadplanner_free(ptr >>> 0, 1));
const WasmSearchIndexFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmsearchindex_free(ptr >>> 0, 1));
const WasmSignedUrlFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmsignedurl_free(ptr >>> 0, 1));
const WasmSignupCeremonyFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmsignupceremony_free(ptr >>> 0, 1));

function addHeapObject(obj) {
    if (heap_next === heap.length) heap.push(heap.length + 1);
    const idx = heap_next;
    heap_next = heap[idx];

    heap[idx] = obj;
    return idx;
}

function _assertClass(instance, klass) {
    if (!(instance instanceof klass)) {
        throw new Error(`expected instance of ${klass.name}`);
    }
}

function debugString(val) {
    // primitive types
    const type = typeof val;
    if (type == 'number' || type == 'boolean' || val == null) {
        return  `${val}`;
    }
    if (type == 'string') {
        return `"${val}"`;
    }
    if (type == 'symbol') {
        const description = val.description;
        if (description == null) {
            return 'Symbol';
        } else {
            return `Symbol(${description})`;
        }
    }
    if (type == 'function') {
        const name = val.name;
        if (typeof name == 'string' && name.length > 0) {
            return `Function(${name})`;
        } else {
            return 'Function';
        }
    }
    // objects
    if (Array.isArray(val)) {
        const length = val.length;
        let debug = '[';
        if (length > 0) {
            debug += debugString(val[0]);
        }
        for(let i = 1; i < length; i++) {
            debug += ', ' + debugString(val[i]);
        }
        debug += ']';
        return debug;
    }
    // Test for built-in
    const builtInMatches = /\[object ([^\]]+)\]/.exec(toString.call(val));
    let className;
    if (builtInMatches && builtInMatches.length > 1) {
        className = builtInMatches[1];
    } else {
        // Failed to match the standard '[object ClassName]'
        return toString.call(val);
    }
    if (className == 'Object') {
        // we're a user defined class or Object
        // JSON.stringify avoids problems with cycles, and is generally much
        // easier than looping through ownProperties of `val`.
        try {
            return 'Object(' + JSON.stringify(val) + ')';
        } catch (_) {
            return 'Object';
        }
    }
    // errors
    if (val instanceof Error) {
        return `${val.name}: ${val.message}\n${val.stack}`;
    }
    // TODO we could test for more things here, like `Set`s and `Map`s.
    return className;
}

function dropObject(idx) {
    if (idx < 1028) return;
    heap[idx] = heap_next;
    heap_next = idx;
}

function getArrayJsValueFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    const mem = getDataViewMemory0();
    const result = [];
    for (let i = ptr; i < ptr + 4 * len; i += 4) {
        result.push(takeObject(mem.getUint32(i, true)));
    }
    return result;
}

function getArrayU32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachedDataViewMemory0 = null;
function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || (cachedDataViewMemory0.buffer.detached === undefined && cachedDataViewMemory0.buffer !== wasm.memory.buffer)) {
        cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
    }
    return cachedDataViewMemory0;
}

function getStringFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return decodeText(ptr, len);
}

let cachedUint32ArrayMemory0 = null;
function getUint32ArrayMemory0() {
    if (cachedUint32ArrayMemory0 === null || cachedUint32ArrayMemory0.byteLength === 0) {
        cachedUint32ArrayMemory0 = new Uint32Array(wasm.memory.buffer);
    }
    return cachedUint32ArrayMemory0;
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function getObject(idx) { return heap[idx]; }

function handleError(f, args) {
    try {
        return f.apply(this, args);
    } catch (e) {
        wasm.__wbindgen_export3(addHeapObject(e));
    }
}

let heap = new Array(1024).fill(undefined);
heap.push(undefined, null, true, false);

let heap_next = heap.length;

function isLikeNone(x) {
    return x === undefined || x === null;
}

function passArray32ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 4, 4) >>> 0;
    getUint32ArrayMemory0().set(arg, ptr / 4);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

function takeObject(idx) {
    const ret = getObject(idx);
    dropObject(idx);
    return ret;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    };
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasm;
function __wbg_finalize_init(instance, module) {
    wasm = instance.exports;
    wasmModule = module;
    cachedDataViewMemory0 = null;
    cachedUint32ArrayMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = module.ok && expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('beebeeb_wasm_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
