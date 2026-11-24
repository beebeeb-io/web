/* @ts-self-types="./beebeeb_wasm.d.ts" */

export class AccountFlow {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        AccountFlowFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_accountflow_free(ptr, 0);
    }
    abandon() {
        wasm.accountflow_abandon(this.__wbg_ptr);
    }
    /**
     * @param {string} new_email
     * @param {string} password
     * @param {string} recovery_check_b64
     * @param {string} x25519_public_b64
     * @returns {any}
     */
    changeEmail(new_email, password, recovery_check_b64, x25519_public_b64) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(new_email, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(password, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len1 = WASM_VECTOR_LEN;
            const ptr2 = passStringToWasm0(recovery_check_b64, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len2 = WASM_VECTOR_LEN;
            const ptr3 = passStringToWasm0(x25519_public_b64, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len3 = WASM_VECTOR_LEN;
            wasm.accountflow_changeEmail(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3);
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
     * `onboardingStatus` / `onboardingBody`: the server's `GET /api/v1/onboarding` answer (its
     * password policy). `breachCheck`: a `WasmBreachCheck` made for `newPassword` and answered,
     * required when that policy declares a breach check (sign-up's gate).
     * @param {string} current
     * @param {string} new_password
     * @param {string} recovery_check_b64
     * @param {string} x25519_public_b64
     * @param {number} onboarding_status
     * @param {string} onboarding_body
     * @param {WasmBreachCheck | null} [breach_check]
     * @returns {any}
     */
    changePassword(current, new_password, recovery_check_b64, x25519_public_b64, onboarding_status, onboarding_body, breach_check) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(current, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(new_password, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len1 = WASM_VECTOR_LEN;
            const ptr2 = passStringToWasm0(recovery_check_b64, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len2 = WASM_VECTOR_LEN;
            const ptr3 = passStringToWasm0(x25519_public_b64, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len3 = WASM_VECTOR_LEN;
            const ptr4 = passStringToWasm0(onboarding_body, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len4 = WASM_VECTOR_LEN;
            let ptr5 = 0;
            if (!isLikeNone(breach_check)) {
                _assertClass(breach_check, WasmBreachCheck);
                ptr5 = breach_check.__destroy_into_raw();
            }
            wasm.accountflow_changePassword(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, onboarding_status, ptr4, len4, ptr5);
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
     * @param {string | null} [code]
     * @returns {any}
     */
    deleteAccount(password, code) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(password, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            var ptr1 = isLikeNone(code) ? 0 : passStringToWasm0(code, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            var len1 = WASM_VECTOR_LEN;
            wasm.accountflow_deleteAccount(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1);
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
     * @param {string} link_token
     * @returns {any}
     */
    deleteCancel(link_token) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(link_token, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.accountflow_deleteCancel(retptr, this.__wbg_ptr, ptr0, len0);
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
     * @param {string} link_token
     * @returns {any}
     */
    deleteConfirm(link_token) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(link_token, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.accountflow_deleteConfirm(retptr, this.__wbg_ptr, ptr0, len0);
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
        const ret = wasm.accountflow_new();
        this.__wbg_ptr = ret >>> 0;
        AccountFlowFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @param {string} code
     * @returns {any}
     */
    regenerateBackupCodes(code) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(code, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.accountflow_regenerateBackupCodes(retptr, this.__wbg_ptr, ptr0, len0);
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
     * @param {number} status
     * @param {string} body_text
     * @returns {any}
     */
    resume(status, body_text) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(body_text, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.accountflow_resume(retptr, this.__wbg_ptr, status, ptr0, len0);
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
     * @returns {any}
     */
    revokeOtherSessions() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.accountflow_revokeOtherSessions(retptr, this.__wbg_ptr);
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
     * @param {string} session_id
     * @returns {any}
     */
    revokeSession(session_id) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(session_id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.accountflow_revokeSession(retptr, this.__wbg_ptr, ptr0, len0);
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
     * Turning it off takes the password (a step-up inside); turning it on ignores it.
     * @param {boolean} on
     * @param {string | null} [password]
     * @returns {any}
     */
    setActivityLogging(on, password) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            var ptr0 = isLikeNone(password) ? 0 : passStringToWasm0(password, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            var len0 = WASM_VECTOR_LEN;
            wasm.accountflow_setActivityLogging(retptr, this.__wbg_ptr, on, ptr0, len0);
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
     * @param {string} name
     * @returns {any}
     */
    setDisplayName(name) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(name, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.accountflow_setDisplayName(retptr, this.__wbg_ptr, ptr0, len0);
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
     * @param {string} code
     * @returns {any}
     */
    totpConfirm(code) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(code, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.accountflow_totpConfirm(retptr, this.__wbg_ptr, ptr0, len0);
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
     * @param {string} code
     * @returns {any}
     */
    totpDisable(code) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(code, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.accountflow_totpDisable(retptr, this.__wbg_ptr, ptr0, len0);
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
     * @param {string | null} [password]
     * @param {string | null} [current_code]
     * @returns {any}
     */
    totpSetup(password, current_code) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            var ptr0 = isLikeNone(password) ? 0 : passStringToWasm0(password, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            var len0 = WASM_VECTOR_LEN;
            var ptr1 = isLikeNone(current_code) ? 0 : passStringToWasm0(current_code, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            var len1 = WASM_VECTOR_LEN;
            wasm.accountflow_totpSetup(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1);
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
     * @param {string} code
     * @returns {any}
     */
    verifyEmail(code) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(code, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.accountflow_verifyEmail(retptr, this.__wbg_ptr, ptr0, len0);
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
     * @returns {any}
     */
    verifyPassword(password) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(password, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.accountflow_verifyPassword(retptr, this.__wbg_ptr, ptr0, len0);
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
if (Symbol.dispose) AccountFlow.prototype[Symbol.dispose] = AccountFlow.prototype.free;

/**
 * The approving side: `new AuthApproval(code)`, `start()`, `onLookupResponse(...)` (the facts),
 * `codeMatches(typed)`, `approve(typed, password, masterKey)`, then `onResponse(...)` until
 * `{kind: "approved"}`.
 */
export class AuthApproval {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        AuthApprovalFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_authapproval_free(ptr, 0);
    }
    /**
     * @param {string} typed_code
     * @param {string} password
     * @param {Uint8Array} master_key
     * @returns {any}
     */
    approve(typed_code, password, master_key) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(typed_code, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(password, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len1 = WASM_VECTOR_LEN;
            const ptr2 = passArray8ToWasm0(master_key, wasm.__wbindgen_export);
            const len2 = WASM_VECTOR_LEN;
            wasm.authapproval_approve(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2);
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
     * @param {string} typed
     * @returns {boolean}
     */
    codeMatches(typed) {
        const ptr0 = passStringToWasm0(typed, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.authapproval_codeMatches(this.__wbg_ptr, ptr0, len0);
        return ret !== 0;
    }
    /**
     * Deny the request shown for review (DW-A09); send the request, then `onDenyResponse`.
     * @returns {any}
     */
    deny() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.authapproval_deny(retptr, this.__wbg_ptr);
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
     * @param {string} code
     */
    constructor(code) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(code, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.authapproval_new(retptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            this.__wbg_ptr = r0 >>> 0;
            AuthApprovalFinalization.register(this, this.__wbg_ptr, this);
            return this;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * @param {number} status
     * @param {string} body
     * @param {number | null} [retry_after_secs]
     */
    onDenyResponse(status, body, retry_after_secs) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(body, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.authapproval_onDenyResponse(retptr, this.__wbg_ptr, status, ptr0, len0, isLikeNone(retry_after_secs) ? 0x100000001 : (retry_after_secs) >>> 0);
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
     * @param {number} status
     * @param {string} body
     * @param {number | null} [retry_after_secs]
     * @returns {any}
     */
    onLookupResponse(status, body, retry_after_secs) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(body, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.authapproval_onLookupResponse(retptr, this.__wbg_ptr, status, ptr0, len0, isLikeNone(retry_after_secs) ? 0x100000001 : (retry_after_secs) >>> 0);
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
     * @param {number} status
     * @param {string} body
     * @param {number | null} [retry_after_secs]
     * @returns {any}
     */
    onResponse(status, body, retry_after_secs) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(body, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.authapproval_onResponse(retptr, this.__wbg_ptr, status, ptr0, len0, isLikeNone(retry_after_secs) ? 0x100000001 : (retry_after_secs) >>> 0);
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
     * @returns {any}
     */
    start() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.authapproval_start(retptr, this.__wbg_ptr);
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
if (Symbol.dispose) AuthApproval.prototype[Symbol.dispose] = AuthApproval.prototype.free;

/**
 * The requesting side of sign in with another device: `initFrame(...)` is the first socket
 * frame, `onFrame(text)` reads each server frame.
 */
export class AuthDeviceRequest {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        AuthDeviceRequestFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_authdevicerequest_free(ptr, 0);
    }
    /**
     * @param {string | null | undefined} device_name
     * @param {string} client
     * @param {string} client_version
     * @param {string} os
     * @returns {string}
     */
    initFrame(device_name, client, client_version, os) {
        let deferred5_0;
        let deferred5_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            var ptr0 = isLikeNone(device_name) ? 0 : passStringToWasm0(device_name, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            var len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(client, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len1 = WASM_VECTOR_LEN;
            const ptr2 = passStringToWasm0(client_version, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len2 = WASM_VECTOR_LEN;
            const ptr3 = passStringToWasm0(os, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len3 = WASM_VECTOR_LEN;
            wasm.authdevicerequest_initFrame(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred5_0 = r0;
            deferred5_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred5_0, deferred5_1, 1);
        }
    }
    constructor() {
        const ret = wasm.authdevicerequest_new();
        this.__wbg_ptr = ret >>> 0;
        AuthDeviceRequestFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * `{kind: "waiting", userCode, verificationUri, expiresIn}` or
     * `{kind: "approved", sessionToken, masterKey: Uint8Array}`.
     * @param {string} text
     * @returns {any}
     */
    onFrame(text) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(text, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.authdevicerequest_onFrame(retptr, this.__wbg_ptr, ptr0, len0);
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
if (Symbol.dispose) AuthDeviceRequest.prototype[Symbol.dispose] = AuthDeviceRequest.prototype.free;

/**
 * `new AuthSignIn(email, password)`; `start()` then `onResponse(...)` until
 * `{kind: "signed_in", sessionToken}` or `{kind: "second_factor"}`, then `verifyRequest(code)` /
 * `onVerifyResponse(...)`.
 */
export class AuthSignIn {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        AuthSignInFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_authsignin_free(ptr, 0);
    }
    /**
     * @param {string} email
     * @param {string} password
     */
    constructor(email, password) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(email, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(password, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len1 = WASM_VECTOR_LEN;
            wasm.authsignin_new(retptr, ptr0, len0, ptr1, len1);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            this.__wbg_ptr = r0 >>> 0;
            AuthSignInFinalization.register(this, this.__wbg_ptr, this);
            return this;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * @param {number} status
     * @param {string} body
     * @param {number | null} [retry_after_secs]
     * @returns {any}
     */
    onResponse(status, body, retry_after_secs) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(body, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.authsignin_onResponse(retptr, this.__wbg_ptr, status, ptr0, len0, isLikeNone(retry_after_secs) ? 0x100000001 : (retry_after_secs) >>> 0);
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
     * The session token; throws `wrong_code` and stays ready for the next code.
     * @param {number} status
     * @param {string} body
     * @param {number | null} [retry_after_secs]
     * @returns {string}
     */
    onVerifyResponse(status, body, retry_after_secs) {
        let deferred3_0;
        let deferred3_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(body, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.authsignin_onVerifyResponse(retptr, this.__wbg_ptr, status, ptr0, len0, isLikeNone(retry_after_secs) ? 0x100000001 : (retry_after_secs) >>> 0);
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
     * @returns {any}
     */
    start() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.authsignin_start(retptr, this.__wbg_ptr);
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
     * @param {string} code
     * @returns {any}
     */
    verifyRequest(code) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(code, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.authsignin_verifyRequest(retptr, this.__wbg_ptr, ptr0, len0);
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
if (Symbol.dispose) AuthSignIn.prototype[Symbol.dispose] = AuthSignIn.prototype.free;

/**
 * `new AuthStepUp(password, purpose?, cliCode?)`; `start()`, `onResponse(...)` until
 * `{kind: "confirmed"}`, then `attachConfirmToken(path, body)` gives the consuming request.
 */
export class AuthStepUp {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        AuthStepUpFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_authstepup_free(ptr, 0);
    }
    /**
     * @param {string} path
     * @param {any} body
     * @returns {any}
     */
    attachConfirmToken(path, body) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(path, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.authstepup_attachConfirmToken(retptr, this.__wbg_ptr, ptr0, len0, addHeapObject(body));
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
     * @param {string | null} [purpose]
     * @param {string | null} [cli_code]
     */
    constructor(password, purpose, cli_code) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(password, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            var ptr1 = isLikeNone(purpose) ? 0 : passStringToWasm0(purpose, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            var len1 = WASM_VECTOR_LEN;
            var ptr2 = isLikeNone(cli_code) ? 0 : passStringToWasm0(cli_code, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            var len2 = WASM_VECTOR_LEN;
            wasm.authstepup_new(retptr, ptr0, len0, ptr1, len1, ptr2, len2);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            this.__wbg_ptr = r0 >>> 0;
            AuthStepUpFinalization.register(this, this.__wbg_ptr, this);
            return this;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * @param {number} status
     * @param {string} body
     * @param {number | null} [retry_after_secs]
     * @returns {any}
     */
    onResponse(status, body, retry_after_secs) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(body, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.authstepup_onResponse(retptr, this.__wbg_ptr, status, ptr0, len0, isLikeNone(retry_after_secs) ? 0x100000001 : (retry_after_secs) >>> 0);
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
     * @returns {any}
     */
    start() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.authstepup_start(retptr, this.__wbg_ptr);
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
if (Symbol.dispose) AuthStepUp.prototype[Symbol.dispose] = AuthStepUp.prototype.free;

/**
 * Opaque handle holding ONLY the derived client-metadata key (task 1922).
 *
 * Make it once when the vault unlocks, free it on lock. List views and SSE
 * frames call `seal` / `open` / `openMany` on the handle, so the master key is
 * not copied into WASM memory on every frame. The derived key never leaves
 * Rust; the handle is zeroized on drop and `free()` is wasm-bindgen's own.
 */
export class ClientMetaKey {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        ClientMetaKeyFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_clientmetakey_free(ptr, 0);
    }
    /**
     * Derive the key from a 32-byte master key. The bytes are taken into a
     * `Zeroizing` buffer and the master key is dropped before returning.
     * @param {Uint8Array} master_key
     */
    constructor(master_key) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passArray8ToWasm0(master_key, wasm.__wbindgen_export);
            const len0 = WASM_VECTOR_LEN;
            wasm.clientmetakey_new(retptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            this.__wbg_ptr = r0 >>> 0;
            ClientMetaKeyFinalization.register(this, this.__wbg_ptr, this);
            return this;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Open one field's `bbcm1.` envelope.
     * @param {string} record_key
     * @param {string | null | undefined} device_key
     * @param {number} field
     * @param {string} envelope
     * @returns {string}
     */
    open(record_key, device_key, field, envelope) {
        let deferred5_0;
        let deferred5_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(record_key, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            var ptr1 = isLikeNone(device_key) ? 0 : passStringToWasm0(device_key, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            var len1 = WASM_VECTOR_LEN;
            const ptr2 = passStringToWasm0(envelope, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len2 = WASM_VECTOR_LEN;
            wasm.clientmetakey_open(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1, field, ptr2, len2);
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
     * Open many rows in one call: `items` is
     * `[{ recordKey, deviceKey?, field, envelope? }]`; the result is
     * `[{ ok: bool, value?: string }]`. One bad row never fails the batch: a
     * null envelope, a bad field or UUID, a malformed row and a failed open
     * each yield `{ ok: false }` for that row only.
     * @param {any} items
     * @returns {any}
     */
    openMany(items) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.clientmetakey_openMany(retptr, this.__wbg_ptr, addHeapObject(items));
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
     * Seal one field. `device_key` must be `null` for field 1 and set for 2-4.
     * @param {string} record_key
     * @param {string | null | undefined} device_key
     * @param {number} field
     * @param {string} plaintext
     * @returns {string}
     */
    seal(record_key, device_key, field, plaintext) {
        let deferred5_0;
        let deferred5_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(record_key, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            var ptr1 = isLikeNone(device_key) ? 0 : passStringToWasm0(device_key, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            var len1 = WASM_VECTOR_LEN;
            const ptr2 = passStringToWasm0(plaintext, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len2 = WASM_VECTOR_LEN;
            wasm.clientmetakey_seal(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1, field, ptr2, len2);
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
}
if (Symbol.dispose) ClientMetaKey.prototype[Symbol.dispose] = ClientMetaKey.prototype.free;

/**
 * `new PhraseRecovery(policyStatus, policyBody, email, phrase)`; `start()` then
 * `onStartResponse`, `evaluate`, `breachRequest` / `onBreachResponse`, `setPassword` (a request),
 * `onRegisterResponse` (a request), `onFinalizeResponse` (`{kind: "signed_in", sessionToken,
 * masterKey}` or `{kind: "sign_in_required"}`).
 */
export class PhraseRecovery {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        PhraseRecoveryFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_phraserecovery_free(ptr, 0);
    }
    /**
     * @param {string} password
     * @returns {any}
     */
    breachRequest(password) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(password, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.phraserecovery_breachRequest(retptr, this.__wbg_ptr, ptr0, len0);
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
     * @returns {any}
     */
    evaluate(password) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(password, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.phraserecovery_evaluate(retptr, this.__wbg_ptr, ptr0, len0);
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
     * @param {number} policy_status
     * @param {string} policy_body
     * @param {string} email
     * @param {string} phrase
     */
    constructor(policy_status, policy_body, email, phrase) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(policy_body, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(email, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len1 = WASM_VECTOR_LEN;
            const ptr2 = passStringToWasm0(phrase, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len2 = WASM_VECTOR_LEN;
            wasm.phraserecovery_new(retptr, policy_status, ptr0, len0, ptr1, len1, ptr2, len2);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            this.__wbg_ptr = r0 >>> 0;
            PhraseRecoveryFinalization.register(this, this.__wbg_ptr, this);
            return this;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * @param {number | null | undefined} status
     * @param {string} body
     * @returns {any}
     */
    onBreachResponse(status, body) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(body, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.phraserecovery_onBreachResponse(retptr, this.__wbg_ptr, isLikeNone(status) ? 0xFFFFFF : status, ptr0, len0);
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
     * The last step; the object is spent afterwards.
     * @param {number} status
     * @param {string} body
     * @param {number | null} [retry_after_secs]
     * @returns {any}
     */
    onFinalizeResponse(status, body, retry_after_secs) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(body, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.phraserecovery_onFinalizeResponse(retptr, this.__wbg_ptr, status, ptr0, len0, isLikeNone(retry_after_secs) ? 0x100000001 : (retry_after_secs) >>> 0);
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
     * @param {number} status
     * @param {string} body
     * @param {number | null} [retry_after_secs]
     * @returns {any}
     */
    onRegisterResponse(status, body, retry_after_secs) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(body, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.phraserecovery_onRegisterResponse(retptr, this.__wbg_ptr, status, ptr0, len0, isLikeNone(retry_after_secs) ? 0x100000001 : (retry_after_secs) >>> 0);
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
     * @param {number} status
     * @param {string} body
     * @param {number | null} [retry_after_secs]
     */
    onStartResponse(status, body, retry_after_secs) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(body, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.phraserecovery_onStartResponse(retptr, this.__wbg_ptr, status, ptr0, len0, isLikeNone(retry_after_secs) ? 0x100000001 : (retry_after_secs) >>> 0);
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
     * @param {string} password
     * @param {string} confirmation
     * @returns {any}
     */
    setPassword(password, confirmation) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(password, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(confirmation, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len1 = WASM_VECTOR_LEN;
            wasm.phraserecovery_setPassword(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1);
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
     * @returns {any}
     */
    start() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.phraserecovery_start(retptr, this.__wbg_ptr);
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
if (Symbol.dispose) PhraseRecovery.prototype[Symbol.dispose] = PhraseRecovery.prototype.free;

/**
 * `new ShareCreateLink(appUrl, fileId, masterKey, fileKey, expiresInHours?, maxOpens?, passphrase?)`;
 * `start()`, then `onResponse(...)` until `{kind: "created", shareId, link, display}`.
 */
export class ShareCreateLink {
    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(ShareCreateLink.prototype);
        obj.__wbg_ptr = ptr;
        ShareCreateLinkFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        ShareCreateLinkFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_sharecreatelink_free(ptr, 0);
    }
    /**
     * @param {string} app_url
     * @param {string} file_id
     * @param {Uint8Array} master_key
     * @param {Uint8Array} file_key
     * @param {number | null} [expires_in_hours]
     * @param {number | null} [max_opens]
     * @param {string | null} [passphrase]
     */
    constructor(app_url, file_id, master_key, file_key, expires_in_hours, max_opens, passphrase) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(app_url, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(file_id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len1 = WASM_VECTOR_LEN;
            const ptr2 = passArray8ToWasm0(master_key, wasm.__wbindgen_export);
            const len2 = WASM_VECTOR_LEN;
            const ptr3 = passArray8ToWasm0(file_key, wasm.__wbindgen_export);
            const len3 = WASM_VECTOR_LEN;
            var ptr4 = isLikeNone(passphrase) ? 0 : passStringToWasm0(passphrase, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            var len4 = WASM_VECTOR_LEN;
            wasm.sharecreatelink_new(retptr, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, isLikeNone(expires_in_hours) ? 0x100000001 : (expires_in_hours) >>> 0, isLikeNone(max_opens) ? 0x100000001 : (max_opens) >>> 0, ptr4, len4);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            this.__wbg_ptr = r0 >>> 0;
            ShareCreateLinkFinalization.register(this, this.__wbg_ptr, this);
            return this;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * @param {number} status
     * @param {string} body
     * @param {number | null} [retry_after_secs]
     * @returns {any}
     */
    onResponse(status, body, retry_after_secs) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(body, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.sharecreatelink_onResponse(retptr, this.__wbg_ptr, status, ptr0, len0, isLikeNone(retry_after_secs) ? 0x100000001 : (retry_after_secs) >>> 0);
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
     * @returns {any}
     */
    start() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.sharecreatelink_start(retptr, this.__wbg_ptr);
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
if (Symbol.dispose) ShareCreateLink.prototype[Symbol.dispose] = ShareCreateLink.prototype.free;

/**
 * `new ShareCreateRequest(appUrl, title, description?, targetFolderId?, maxFiles?, maxTotalBytes?,
 * expiresInSecs?, masterKey)`; `start()`, then `onResponse(...)` → `{id, link, display}`.
 */
export class ShareCreateRequest {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        ShareCreateRequestFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_sharecreaterequest_free(ptr, 0);
    }
    /**
     * @param {string} app_url
     * @param {string} title
     * @param {string | null | undefined} description
     * @param {string | null | undefined} target_folder_id
     * @param {number | null | undefined} max_files
     * @param {number | null | undefined} max_total_bytes
     * @param {number | null | undefined} expires_in_secs
     * @param {Uint8Array} master_key
     */
    constructor(app_url, title, description, target_folder_id, max_files, max_total_bytes, expires_in_secs, master_key) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(app_url, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(title, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len1 = WASM_VECTOR_LEN;
            var ptr2 = isLikeNone(description) ? 0 : passStringToWasm0(description, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            var len2 = WASM_VECTOR_LEN;
            var ptr3 = isLikeNone(target_folder_id) ? 0 : passStringToWasm0(target_folder_id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            var len3 = WASM_VECTOR_LEN;
            const ptr4 = passArray8ToWasm0(master_key, wasm.__wbindgen_export);
            const len4 = WASM_VECTOR_LEN;
            wasm.sharecreaterequest_new(retptr, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, isLikeNone(max_files) ? 0x100000001 : (max_files) >>> 0, !isLikeNone(max_total_bytes), isLikeNone(max_total_bytes) ? 0 : max_total_bytes, !isLikeNone(expires_in_secs), isLikeNone(expires_in_secs) ? 0 : expires_in_secs, ptr4, len4);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            this.__wbg_ptr = r0 >>> 0;
            ShareCreateRequestFinalization.register(this, this.__wbg_ptr, this);
            return this;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * @param {number} status
     * @param {string} body
     * @param {number | null} [retry_after_secs]
     * @returns {any}
     */
    onResponse(status, body, retry_after_secs) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(body, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.sharecreaterequest_onResponse(retptr, this.__wbg_ptr, status, ptr0, len0, isLikeNone(retry_after_secs) ? 0x100000001 : (retry_after_secs) >>> 0);
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
     * @returns {any}
     */
    start() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.sharecreaterequest_start(retptr, this.__wbg_ptr);
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
if (Symbol.dispose) ShareCreateRequest.prototype[Symbol.dispose] = ShareCreateRequest.prototype.free;

/**
 * `new ShareFolderInvite(folderId, email, expectedPeerFingerprint, sharedFoldersWrite, custodySeen,
 * custodyUnreadable, masterKey)` (`expectedPeerFingerprint` REQUIRED: 32 bytes, or empty = not compared)
 * or `ShareFolderInvite.link(folderId, appUrl, accessLevel, label?, expiresInHours?, capBytes?,
 * maxOpens?, passphrase?, custodySeen, custodyUnreadable, masterKey)`; `start()`, then
 * `onResponse(...)` until `{kind: "shared" | "invited" | "awaiting_approval" | "link_created"}`. A
 * `{kind: "send", markCustodySeen}` with an id: persist the id BEFORE sending the request.
 */
export class ShareFolderInvite {
    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(ShareFolderInvite.prototype);
        obj.__wbg_ptr = ptr;
        ShareFolderInviteFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        ShareFolderInviteFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_sharefolderinvite_free(ptr, 0);
    }
    /**
     * A live folder link (web `createFolderLinkWithKeys`).
     * @param {string} folder_id
     * @param {string} app_url
     * @param {string} access_level
     * @param {string | null | undefined} label
     * @param {number | null | undefined} expires_in_hours
     * @param {number | null | undefined} cap_bytes
     * @param {number | null | undefined} max_opens
     * @param {string | null | undefined} passphrase
     * @param {string[]} custody_seen
     * @param {boolean} custody_unreadable
     * @param {Uint8Array} master_key
     * @returns {ShareFolderInvite}
     */
    static link(folder_id, app_url, access_level, label, expires_in_hours, cap_bytes, max_opens, passphrase, custody_seen, custody_unreadable, master_key) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(folder_id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(app_url, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len1 = WASM_VECTOR_LEN;
            const ptr2 = passStringToWasm0(access_level, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len2 = WASM_VECTOR_LEN;
            var ptr3 = isLikeNone(label) ? 0 : passStringToWasm0(label, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            var len3 = WASM_VECTOR_LEN;
            var ptr4 = isLikeNone(passphrase) ? 0 : passStringToWasm0(passphrase, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            var len4 = WASM_VECTOR_LEN;
            const ptr5 = passArrayJsValueToWasm0(custody_seen, wasm.__wbindgen_export);
            const len5 = WASM_VECTOR_LEN;
            const ptr6 = passArray8ToWasm0(master_key, wasm.__wbindgen_export);
            const len6 = WASM_VECTOR_LEN;
            wasm.sharefolderinvite_link(retptr, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, isLikeNone(expires_in_hours) ? 0x100000001 : (expires_in_hours) >>> 0, !isLikeNone(cap_bytes), isLikeNone(cap_bytes) ? 0 : cap_bytes, isLikeNone(max_opens) ? 0x100000001 : (max_opens) >>> 0, ptr4, len4, ptr5, len5, custody_unreadable, ptr6, len6);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            return ShareFolderInvite.__wrap(r0);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * @param {string} folder_id
     * @param {string} email
     * @param {Uint8Array} expected_peer_fingerprint
     * @param {boolean} shared_folders_write
     * @param {string[]} custody_seen
     * @param {boolean} custody_unreadable
     * @param {Uint8Array} master_key
     */
    constructor(folder_id, email, expected_peer_fingerprint, shared_folders_write, custody_seen, custody_unreadable, master_key) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(folder_id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(email, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len1 = WASM_VECTOR_LEN;
            const ptr2 = passArray8ToWasm0(expected_peer_fingerprint, wasm.__wbindgen_export);
            const len2 = WASM_VECTOR_LEN;
            const ptr3 = passArrayJsValueToWasm0(custody_seen, wasm.__wbindgen_export);
            const len3 = WASM_VECTOR_LEN;
            const ptr4 = passArray8ToWasm0(master_key, wasm.__wbindgen_export);
            const len4 = WASM_VECTOR_LEN;
            wasm.sharefolderinvite_new(retptr, ptr0, len0, ptr1, len1, ptr2, len2, shared_folders_write, ptr3, len3, custody_unreadable, ptr4, len4);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            this.__wbg_ptr = r0 >>> 0;
            ShareFolderInviteFinalization.register(this, this.__wbg_ptr, this);
            return this;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * @param {number} status
     * @param {string} body
     * @param {number | null} [retry_after_secs]
     * @returns {any}
     */
    onResponse(status, body, retry_after_secs) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(body, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.sharefolderinvite_onResponse(retptr, this.__wbg_ptr, status, ptr0, len0, isLikeNone(retry_after_secs) ? 0x100000001 : (retry_after_secs) >>> 0);
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
     * @returns {any}
     */
    start() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.sharefolderinvite_start(retptr, this.__wbg_ptr);
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
if (Symbol.dispose) ShareFolderInvite.prototype[Symbol.dispose] = ShareFolderInvite.prototype.free;

/**
 * `new ShareMemberInvite(itemId, isFolder, email, expectedPeerFingerprint, masterKey, fileKey)`;
 * `start()`, then `onResponse(...)` until
 * `{kind: "shared" | "invited" | "awaiting_approval" | "peer_key_changed", inviteId}`.
 * `expectedPeerFingerprint` is REQUIRED: 32 bytes (the compared mark's fingerprint) or an empty
 * `Uint8Array` (not compared). `peer_key_changed`: nothing was sealed.
 */
export class ShareMemberInvite {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        ShareMemberInviteFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_sharememberinvite_free(ptr, 0);
    }
    /**
     * @param {string} item_id
     * @param {boolean} is_folder
     * @param {string} email
     * @param {Uint8Array} expected_peer_fingerprint
     * @param {Uint8Array} master_key
     * @param {Uint8Array} file_key
     */
    constructor(item_id, is_folder, email, expected_peer_fingerprint, master_key, file_key) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(item_id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(email, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len1 = WASM_VECTOR_LEN;
            const ptr2 = passArray8ToWasm0(expected_peer_fingerprint, wasm.__wbindgen_export);
            const len2 = WASM_VECTOR_LEN;
            const ptr3 = passArray8ToWasm0(master_key, wasm.__wbindgen_export);
            const len3 = WASM_VECTOR_LEN;
            const ptr4 = passArray8ToWasm0(file_key, wasm.__wbindgen_export);
            const len4 = WASM_VECTOR_LEN;
            wasm.sharememberinvite_new(retptr, ptr0, len0, is_folder, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            this.__wbg_ptr = r0 >>> 0;
            ShareMemberInviteFinalization.register(this, this.__wbg_ptr, this);
            return this;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * @param {number} status
     * @param {string} body
     * @param {number | null} [retry_after_secs]
     * @returns {any}
     */
    onResponse(status, body, retry_after_secs) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(body, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.sharememberinvite_onResponse(retptr, this.__wbg_ptr, status, ptr0, len0, isLikeNone(retry_after_secs) ? 0x100000001 : (retry_after_secs) >>> 0);
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
     * @returns {any}
     */
    start() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.sharememberinvite_start(retptr, this.__wbg_ptr);
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
if (Symbol.dispose) ShareMemberInvite.prototype[Symbol.dispose] = ShareMemberInvite.prototype.free;

/**
 * `new SignupFlow(policyStatus, policyBody)`; then the steps in order: `sendCode` /
 * `onCodeSent`, `verifyCode` / `onCodeVerified`, `evaluate`, `breachRequest` / `onBreachResponse`,
 * `setPassword`, `phraseWords`, `acknowledgePhrase`, `challengePositions`, `confirmPhrase`,
 * `registerStart` / `onRegisterStart` / `onRegisterFinish` (`{sessionToken, userId, masterKey}`),
 * `termsRequest`.
 */
export class SignupFlow {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        SignupFlowFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_signupflow_free(ptr, 0);
    }
    acknowledgePhrase() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.signupflow_acknowledgePhrase(retptr, this.__wbg_ptr);
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
     * Take an existing master key instead of a new one; counts as confirmed.
     * @param {string} phrase
     */
    adoptPhrase(phrase) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(phrase, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.signupflow_adoptPhrase(retptr, this.__wbg_ptr, ptr0, len0);
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
     * The breach request for this password, or `null` when the policy declares no check.
     * @param {string} password
     * @returns {any}
     */
    breachRequest(password) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(password, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.signupflow_breachRequest(retptr, this.__wbg_ptr, ptr0, len0);
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
     * 1-based word positions to ask for.
     * @returns {Uint32Array}
     */
    challengePositions() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.signupflow_challengePositions(retptr, this.__wbg_ptr);
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
     * @param {string[]} answers
     */
    confirmPhrase(answers) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passArrayJsValueToWasm0(answers, wasm.__wbindgen_export);
            const len0 = WASM_VECTOR_LEN;
            wasm.signupflow_confirmPhrase(retptr, this.__wbg_ptr, ptr0, len0);
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
     * @param {string} password
     * @returns {any}
     */
    evaluate(password) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(password, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.signupflow_evaluate(retptr, this.__wbg_ptr, ptr0, len0);
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
     * @param {number} policy_status
     * @param {string} policy_body
     */
    constructor(policy_status, policy_body) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(policy_body, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.signupflow_new(retptr, policy_status, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            this.__wbg_ptr = r0 >>> 0;
            SignupFlowFinalization.register(this, this.__wbg_ptr, this);
            return this;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * `status` is `undefined` when the endpoint gave no answer. `{kind, count}` or `null`.
     * @param {number | null | undefined} status
     * @param {string} body
     * @returns {any}
     */
    onBreachResponse(status, body) {
        const ptr0 = passStringToWasm0(body, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.signupflow_onBreachResponse(this.__wbg_ptr, isLikeNone(status) ? 0xFFFFFF : status, ptr0, len0);
        return takeObject(ret);
    }
    /**
     * @param {number} status
     * @param {string} body
     * @param {number | null} [retry_after_secs]
     */
    onCodeSent(status, body, retry_after_secs) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(body, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.signupflow_onCodeSent(retptr, this.__wbg_ptr, status, ptr0, len0, isLikeNone(retry_after_secs) ? 0x100000001 : (retry_after_secs) >>> 0);
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
     * @param {number} status
     * @param {string} body
     * @param {number | null} [retry_after_secs]
     */
    onCodeVerified(status, body, retry_after_secs) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(body, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.signupflow_onCodeVerified(retptr, this.__wbg_ptr, status, ptr0, len0, isLikeNone(retry_after_secs) ? 0x100000001 : (retry_after_secs) >>> 0);
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
     * `{sessionToken, userId, masterKey: Uint8Array}`: store, then drop.
     * @param {number} status
     * @param {string} body
     * @param {number | null} [retry_after_secs]
     * @returns {any}
     */
    onRegisterFinish(status, body, retry_after_secs) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(body, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.signupflow_onRegisterFinish(retptr, this.__wbg_ptr, status, ptr0, len0, isLikeNone(retry_after_secs) ? 0x100000001 : (retry_after_secs) >>> 0);
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
     * @param {number} status
     * @param {string} body
     * @param {number | null} [retry_after_secs]
     * @returns {any}
     */
    onRegisterStart(status, body, retry_after_secs) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(body, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.signupflow_onRegisterStart(retptr, this.__wbg_ptr, status, ptr0, len0, isLikeNone(retry_after_secs) ? 0x100000001 : (retry_after_secs) >>> 0);
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
     * The 12 words, for the one-time display.
     * @returns {string[]}
     */
    phraseWords() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.signupflow_phraseWords(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            if (r3) {
                throw takeObject(r2);
            }
            var v1 = getArrayJsValueFromWasm0(r0, r1).slice();
            wasm.__wbindgen_export4(r0, r1 * 4, 4);
            return v1;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * @returns {any}
     */
    registerStart() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.signupflow_registerStart(retptr, this.__wbg_ptr);
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
     * @param {string} email
     * @returns {any}
     */
    sendCode(email) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(email, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.signupflow_sendCode(retptr, this.__wbg_ptr, ptr0, len0);
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
     * @param {string} confirmation
     * @returns {any}
     */
    setPassword(password, confirmation) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(password, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(confirmation, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len1 = WASM_VECTOR_LEN;
            wasm.signupflow_setPassword(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1);
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
     * @returns {any}
     */
    termsRequest() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.signupflow_termsRequest(retptr, this.__wbg_ptr);
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
     * @param {string} code
     * @returns {any}
     */
    verifyCode(code) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(code, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.signupflow_verifyCode(retptr, this.__wbg_ptr, ptr0, len0);
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
    wipe() {
        wasm.signupflow_wipe(this.__wbg_ptr);
    }
}
if (Symbol.dispose) SignupFlow.prototype[Symbol.dispose] = SignupFlow.prototype.free;

/**
 * Account key material stays opaque after device approval. It can answer a
 * proof but has no byte getter.
 */
export class WasmAccountKeyMaterial {
    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(WasmAccountKeyMaterial.prototype);
        obj.__wbg_ptr = ptr;
        WasmAccountKeyMaterialFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmAccountKeyMaterialFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmaccountkeymaterial_free(ptr, 0);
    }
    /**
     * @param {Uint8Array} nonce
     * @param {Uint8Array} server_public
     * @param {Uint8Array} canonical_email
     * @returns {Uint8Array}
     */
    answerRecoveryKeyProof(nonce, server_public, canonical_email) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passArray8ToWasm0(nonce, wasm.__wbindgen_export);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passArray8ToWasm0(server_public, wasm.__wbindgen_export);
            const len1 = WASM_VECTOR_LEN;
            const ptr2 = passArray8ToWasm0(canonical_email, wasm.__wbindgen_export);
            const len2 = WASM_VECTOR_LEN;
            wasm.wasmaccountkeymaterial_answerRecoveryKeyProof(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2);
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
     * @param {Uint8Array} nonce
     * @param {Uint8Array} server_public
     * @param {Uint8Array} session_id
     * @param {Uint8Array} account_id
     * @returns {Uint8Array}
     */
    answerSessionKeyProof(nonce, server_public, session_id, account_id) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passArray8ToWasm0(nonce, wasm.__wbindgen_export);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passArray8ToWasm0(server_public, wasm.__wbindgen_export);
            const len1 = WASM_VECTOR_LEN;
            const ptr2 = passArray8ToWasm0(session_id, wasm.__wbindgen_export);
            const len2 = WASM_VECTOR_LEN;
            const ptr3 = passArray8ToWasm0(account_id, wasm.__wbindgen_export);
            const len3 = WASM_VECTOR_LEN;
            wasm.wasmaccountkeymaterial_answerSessionKeyProof(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3);
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
}
if (Symbol.dispose) WasmAccountKeyMaterial.prototype[Symbol.dispose] = WasmAccountKeyMaterial.prototype.free;

/**
 * One extraction run. The driver acts on each step (create the folder,
 * stage and upload the file, supply bytes, ask for the password) and
 * reports back.
 */
export class WasmArchiveExtraction {
    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(WasmArchiveExtraction.prototype);
        obj.__wbg_ptr = ptr;
        WasmArchiveExtractionFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmArchiveExtractionFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmarchiveextraction_free(ptr, 0);
    }
    cancel() {
        wasm.wasmarchiveextraction_cancel(this.__wbg_ptr);
    }
    /**
     * The folder for `create_folder`'s `node` exists, with this id.
     * @param {number} node
     * @param {string} id
     */
    folderCreated(node, id) {
        const ptr0 = passStringToWasm0(id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        wasm.wasmarchiveextraction_folderCreated(this.__wbg_ptr, node, ptr0, len0);
    }
    /**
     * The server answered 409 for `node`'s name: core numbers it again.
     * @param {number} node
     */
    folderNameTaken(node) {
        wasm.wasmarchiveextraction_folderNameTaken(this.__wbg_ptr, node);
    }
    /**
     * The archive as the server lists it now (`{file_id,
     * object_version_id}`): another version stops the run.
     * @param {any} identity_js
     */
    identitySeen(identity_js) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.wasmarchiveextraction_identitySeen(retptr, this.__wbg_ptr, addHeapObject(identity_js));
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
     * The preview model while the run goes and after it ends; `input` as
     * for the session.
     * @param {any} input
     * @returns {any}
     */
    preview(input) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.wasmarchiveextraction_preview(retptr, this.__wbg_ptr, addHeapObject(input));
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
     * @param {bigint} offset
     */
    releaseBefore(offset) {
        wasm.wasmarchiveextraction_releaseBefore(this.__wbg_ptr, offset);
    }
    /**
     * The run cannot go on: `"storage_full"`, `"network"`, `"damaged"`,
     * `"changed"` or `"account_blocked"`.
     * @param {string} reason
     */
    runFailed(reason) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(reason, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.wasmarchiveextraction_runFailed(retptr, this.__wbg_ptr, ptr0, len0);
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
     * The next step: `{kind}` is `need_bytes`, `need_password`,
     * `create_folder`, `file_begin`, `file_data` (`bytes` a `Uint8Array`,
     * not yet verified), `file_end`, `file_skipped`, `progress`, `waiting`
     * or `finished`.
     * @returns {any}
     */
    step() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.wasmarchiveextraction_step(retptr, this.__wbg_ptr);
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
     * The bytes at `offset`, as for the session.
     * @param {bigint} offset
     * @param {Uint8Array} bytes
     */
    supply(offset, bytes) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_export);
            const len0 = WASM_VECTOR_LEN;
            wasm.wasmarchiveextraction_supply(retptr, this.__wbg_ptr, offset, ptr0, len0);
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
     * The password the person entered for `need_password`. Supplied at
     * any other time it is dropped.
     * @param {string} password
     */
    supplyPassword(password) {
        const ptr0 = passStringToWasm0(password, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        wasm.wasmarchiveextraction_supplyPassword(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * `node`'s upload finished (`ok`) or failed.
     * @param {number} node
     * @param {boolean} ok
     */
    uploadFinished(node, ok) {
        wasm.wasmarchiveextraction_uploadFinished(this.__wbg_ptr, node, ok);
    }
}
if (Symbol.dispose) WasmArchiveExtraction.prototype[Symbol.dispose] = WasmArchiveExtraction.prototype.free;

/**
 * One archive being listed, previewed and opened. The driver answers each
 * `need_bytes` with `supply` and asks again.
 */
export class WasmArchiveSession {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmArchiveSessionFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmarchivesession_free(ptr, 0);
    }
    /**
     * Whether `password` opens entry `index`: `{kind: "need_bytes", start,
     * end}`, `"accepted"`, `"wrong"`, `"damaged"` (the entry's headers
     * are damaged: the password cannot be judged), `"not_needed"` or
     * `{kind: "io", message}`.
     * @param {number} index
     * @param {string} password
     * @returns {any}
     */
    checkPassword(index, password) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(password, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.wasmarchivesession_checkPassword(retptr, this.__wbg_ptr, index, ptr0, len0);
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
     * The listing (`{format, entries, totals, protection, uses_zipcrypto,
     * complete}`), or `null` before `listed`.
     * @returns {any}
     */
    listing() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.wasmarchivesession_listing(retptr, this.__wbg_ptr);
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
     * A session for an archive of `len` bytes on `platform` (`"native"`,
     * `"browser"` or `"mobile_app"`).
     * @param {bigint} len
     * @param {string} platform
     */
    constructor(len, platform) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(platform, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.wasmarchivesession_new(retptr, len, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            this.__wbg_ptr = r0 >>> 0;
            WasmArchiveSessionFinalization.register(this, this.__wbg_ptr, this);
            return this;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Read entry `index` whole, to open it: `{kind: "need_bytes", start,
     * end}` (supply, then call again with the same index), `{kind:
     * "bytes", bytes}` once its check passed, `"corrupt"`, `"wrong"`,
     * `{kind: "skipped", reason}`, `"too_large"` (over the platform's
     * open budget) or `{kind: "io", message}`. `password` is used when a
     * read starts.
     * @param {number} index
     * @param {string | null} [password]
     * @returns {any}
     */
    openEntry(index, password) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            var ptr0 = isLikeNone(password) ? 0 : passStringToWasm0(password, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            var len0 = WASM_VECTOR_LEN;
            wasm.wasmarchivesession_openEntry(retptr, this.__wbg_ptr, index, ptr0, len0);
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
     * Plan an extraction of the listed archive: a `WasmExtractionPlan`, or
     * `{kind: "refused", refusal, text}`. `request`: `{archive_name,
     * selection: "all" | [path], destination: {siblings, backup_position,
     * writable}, server_free_bytes, device_free_bytes}`.
     * @param {any} request
     * @returns {any}
     */
    plan(request) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.wasmarchivesession_plan(retptr, this.__wbg_ptr, addHeapObject(request));
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
     * The preview model. `input`: `{archive_name, folder, selection,
     * destination: "next_to" | "choose_folder", password: null | boolean}`.
     * @param {any} input
     * @returns {any}
     */
    preview(input) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.wasmarchivesession_preview(retptr, this.__wbg_ptr, addHeapObject(input));
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
     * The preview model with a plan's notes (renamed entries, the browser's
     * size limit).
     * @param {any} input
     * @param {WasmExtractionPlan} plan
     * @returns {any}
     */
    previewWithPlan(input, plan) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            _assertClass(plan, WasmExtractionPlan);
            wasm.wasmarchivesession_previewWithPlan(retptr, this.__wbg_ptr, addHeapObject(input), plan.__wbg_ptr);
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
     * Bytes before `offset` are no longer needed.
     * @param {bigint} offset
     */
    releaseBefore(offset) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.wasmarchivesession_releaseBefore(retptr, this.__wbg_ptr, offset);
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
     * Start extracting `plan`, bound to `identity` (`{file_id,
     * object_version_id}`); a password from the preview is passed on. The
     * session moves into the extraction: every later call on it throws.
     * @param {any} identity_js
     * @param {WasmExtractionPlan} plan
     * @param {string | null} [password]
     * @returns {WasmArchiveExtraction}
     */
    startExtraction(identity_js, plan, password) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            _assertClass(plan, WasmExtractionPlan);
            var ptr0 = isLikeNone(password) ? 0 : passStringToWasm0(password, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            var len0 = WASM_VECTOR_LEN;
            wasm.wasmarchivesession_startExtraction(retptr, this.__wbg_ptr, addHeapObject(identity_js), plan.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            return WasmArchiveExtraction.__wrap(r0);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * `{kind: "need_bytes", start, end}`, `{kind: "listed"}`,
     * `{kind: "refused", refusal, format, text}` or `{kind: "io", message}`.
     * @returns {any}
     */
    step() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.wasmarchivesession_step(retptr, this.__wbg_ptr);
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
     * The bytes at `offset`. Throws when they fall outside the archive or
     * differ from bytes already supplied there.
     * @param {bigint} offset
     * @param {Uint8Array} bytes
     */
    supply(offset, bytes) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_export);
            const len0 = WASM_VECTOR_LEN;
            wasm.wasmarchivesession_supply(retptr, this.__wbg_ptr, offset, ptr0, len0);
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
if (Symbol.dispose) WasmArchiveSession.prototype[Symbol.dispose] = WasmArchiveSession.prototype.free;

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
     * Protected current or historical read. Supply the fields from that
     * version's own decrypted metadata record.
     * @param {Uint8Array} master_key
     * @param {string} file_id
     * @param {number} expected_chunk_format
     * @param {Uint8Array} version_id
     * @param {number} version_counter
     * @returns {WasmChunkDecryptor}
     */
    static forVersion(master_key, file_id, expected_chunk_format, version_id, version_counter) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passArray8ToWasm0(master_key, wasm.__wbindgen_export);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(file_id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len1 = WASM_VECTOR_LEN;
            const ptr2 = passArray8ToWasm0(version_id, wasm.__wbindgen_export);
            const len2 = WASM_VECTOR_LEN;
            wasm.wasmchunkdecryptor_forVersion(retptr, ptr0, len0, ptr1, len1, expected_chunk_format, ptr2, len2, version_counter);
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
     * recipients). `file_id` must be the id the file was uploaded under;
     * `metadata` is what `decrypt_file_metadata_with_key` returned.
     * @param {Uint8Array} file_key
     * @param {string} file_id
     * @param {any} metadata
     * @returns {WasmChunkDecryptor}
     */
    static fromFileKey(file_key, file_id, metadata) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passArray8ToWasm0(file_key, wasm.__wbindgen_export);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(file_id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len1 = WASM_VECTOR_LEN;
            wasm.wasmchunkdecryptor_fromFileKey(retptr, ptr0, len0, ptr1, len1, addHeapObject(metadata));
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
     * 32-byte master key and `file_id`. `metadata` is what
     * `decrypt_file_metadata` returned for this version.
     * @param {Uint8Array} master_key
     * @param {string} file_id
     * @param {any} metadata
     */
    constructor(master_key, file_id, metadata) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passArray8ToWasm0(master_key, wasm.__wbindgen_export);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(file_id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len1 = WASM_VECTOR_LEN;
            wasm.wasmchunkdecryptor_new(retptr, ptr0, len0, ptr1, len1, addHeapObject(metadata));
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
     * Create a push-form encryptor for a NEW row minted by
     * `newOwnerItemId`/`newForeignItemId` (task 2275, L13).
     *
     * The id comes from the handle; the content key is core's derivation under
     * that id, which is also the member's rule for a new foreign item.
     * @param {WasmNewItemId} item_id
     * @param {bigint} file_size
     * @param {string} profile
     * @returns {WasmChunkEncryptor}
     */
    static forNewItem(item_id, file_size, profile) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            _assertClass(item_id, WasmNewItemId);
            const ptr0 = passStringToWasm0(profile, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.wasmchunkencryptor_forNewItem(retptr, item_id.__wbg_ptr, file_size, ptr0, len0);
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
     * Create a push-form replacement encryptor for a resolved row (task 2275,
     * L13). The key, the id and the recorded chunk-format pin all come from the
     * `WasmWriteTarget`, so a caller cannot drop a recorded v2 pin.
     * @param {WasmWriteTarget} target
     * @param {bigint} file_size
     * @param {string} profile
     * @returns {WasmChunkEncryptor}
     */
    static forTarget(target, file_size, profile) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            _assertClass(target, WasmWriteTarget);
            const ptr0 = passStringToWasm0(profile, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.wasmchunkencryptor_forTarget(retptr, target.__wbg_ptr, file_size, ptr0, len0);
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
     * The chunk format this encryptor writes: 2 = v2. Record it at upload via
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
     * Protected metadata values after frame 0 has been emitted. The previous
     * counter is omitted for a new file and supplied for a replacement.
     * @param {number | null} [previous_counter]
     * @returns {any}
     */
    versionCommitment(previous_counter) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.wasmchunkencryptor_versionCommitment(retptr, this.__wbg_ptr, !isLikeNone(previous_counter), isLikeNone(previous_counter) ? 0 : previous_counter);
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
     * Both supported pins produce v2 output; 0 preserves compatibility with
     * legacy history. Before the first `pushChunk` only; other codes throw. Consumes
     * the old JS object — use the returned one.
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
 * A plan from `WasmArchiveSession.plan`, for `startExtraction` and the
 * preview.
 */
export class WasmExtractionPlan {
    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(WasmExtractionPlan.prototype);
        obj.__wbg_ptr = ptr;
        WasmExtractionPlanFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmExtractionPlanFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmextractionplan_free(ptr, 0);
    }
    /**
     * `"planned"`, to tell it from a refusal.
     * @returns {string}
     */
    get kind() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.wasmextractionplan_kind(retptr, this.__wbg_ptr);
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
     * The plan as data: `{target, nodes, skipped, renamed, totals, notices}`.
     * @returns {any}
     */
    view() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.wasmextractionplan_view(retptr, this.__wbg_ptr);
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
if (Symbol.dispose) WasmExtractionPlan.prototype[Symbol.dispose] = WasmExtractionPlan.prototype.free;

/**
 * The new device's side of a link. Send `publicFields().session_id`,
 * `public_key` and `device_name` (the canonical form) to `start_device_link`;
 * render `qr_payload` as the QR and show `typedCode()` next to it.
 */
export class WasmNewDeviceLink {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmNewDeviceLinkFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmnewdevicelink_free(ptr, 0);
    }
    /**
     * Typed-code path: answer the approver's message (relayed under role
     * `approver`). Relay the receiver's `message` under role `new_device`,
     * then open the approval with it. The attempt consumes this link.
     * @param {Uint8Array} approver_message
     * @returns {WasmTypedReceiver}
     */
    answerTypedCode(approver_message) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passArray8ToWasm0(approver_message, wasm.__wbindgen_export);
            const len0 = WASM_VECTOR_LEN;
            wasm.wasmnewdevicelink_answerTypedCode(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            return WasmTypedReceiver.__wrap(r0);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * @param {Uint8Array} session_id
     * @param {string} device_name
     */
    constructor(session_id, device_name) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passArray8ToWasm0(session_id, wasm.__wbindgen_export);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(device_name, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len1 = WASM_VECTOR_LEN;
            wasm.wasmnewdevicelink_new(retptr, ptr0, len0, ptr1, len1);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            this.__wbg_ptr = r0 >>> 0;
            WasmNewDeviceLinkFinalization.register(this, this.__wbg_ptr, this);
            return this;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * QR path: open the approval relayed for this link. The link supplies its
     * own session id and public key; the attempt consumes it.
     * @param {Uint8Array} approver_public
     * @param {Uint8Array} nonce
     * @param {Uint8Array} ciphertext
     * @returns {WasmAccountKeyMaterial}
     */
    open(approver_public, nonce, ciphertext) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passArray8ToWasm0(approver_public, wasm.__wbindgen_export);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passArray8ToWasm0(nonce, wasm.__wbindgen_export);
            const len1 = WASM_VECTOR_LEN;
            const ptr2 = passArray8ToWasm0(ciphertext, wasm.__wbindgen_export);
            const len2 = WASM_VECTOR_LEN;
            wasm.wasmnewdevicelink_open(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            return WasmAccountKeyMaterial.__wrap(r0);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * @returns {any}
     */
    publicFields() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.wasmnewdevicelink_publicFields(retptr, this.__wbg_ptr);
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
     * @returns {string}
     */
    typedCode() {
        let deferred2_0;
        let deferred2_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.wasmnewdevicelink_typedCode(retptr, this.__wbg_ptr);
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
}
if (Symbol.dispose) WasmNewDeviceLink.prototype[Symbol.dispose] = WasmNewDeviceLink.prototype.free;

/**
 * An opaque new-item id minted by core for one master key (task 2275, L13).
 *
 * There is no constructor from text and no export that turns arbitrary id text
 * into a sealer input: a new-item write can only use an id core minted (or
 * resumed from a persisted id + tag) for this master key. `idText` is the wire
 * form; `tag` is the resume tag to persist with the upload session.
 */
export class WasmNewItemId {
    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(WasmNewItemId.prototype);
        obj.__wbg_ptr = ptr;
        WasmNewItemIdFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmNewItemIdFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmnewitemid_free(ptr, 0);
    }
    /**
     * The canonical id text to send on the wire.
     * @returns {string}
     */
    get idText() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.wasmnewitemid_idText(retptr, this.__wbg_ptr);
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
     * The resume tag to persist with the upload session (32 bytes).
     * @returns {Uint8Array}
     */
    get tag() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.wasmnewitemid_tag(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var v1 = getArrayU8FromWasm0(r0, r1).slice();
            wasm.__wbindgen_export4(r0, r1 * 1, 1);
            return v1;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
}
if (Symbol.dispose) WasmNewItemId.prototype[Symbol.dispose] = WasmNewItemId.prototype.free;

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
    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(WasmRequestContentReader.prototype);
        obj.__wbg_ptr = ptr;
        WasmRequestContentReaderFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmRequestContentReaderFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmrequestcontentreader_free(ptr, 0);
    }
    /**
     * The row's recorded chunk-format pin: 0 = unrecorded, 2 = v2.
     * @returns {number}
     */
    get chunkFormat() {
        const ret = wasm.wasmrequestcontentreader_chunkFormat(this.__wbg_ptr);
        return ret;
    }
    /**
     * A FRESH sequential decryptor at chunk 0. Call again after any error.
     *
     * Retry contract: discard EVERYTHING the failed attempt produced; never
     * splice attempt 1's prefix with attempt 2's suffix (after a replace that
     * splices two uploads of one id). The failed cursor is not poisoned
     * (`open_next` does not advance `next_index` on an error), but the output
     * must still be rebuilt from frame 0.
     * @returns {WasmChunkDecryptor}
     */
    decryptor() {
        const ret = wasm.wasmrequestcontentreader_decryptor(this.__wbg_ptr);
        return WasmChunkDecryptor.__wrap(ret);
    }
    /**
     * The file id every frame of this row must be bound to.
     * @returns {string}
     */
    get fileId() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.wasmrequestcontentreader_fileId(retptr, this.__wbg_ptr);
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
     * Open ONE content frame at `index` without the frames before it (seek /
     * range read). `isLast = index == chunkCount - 1`. `format` (1 = v1,
     * 2 = v2) and `versionId` (12 bytes, v2 only) must come from authenticated
     * data. When the row is pinned to v2, `format: 1` is refused.
     * @param {Uint8Array} version_id
     * @param {number} index
     * @param {boolean} is_last
     * @param {number} format
     * @param {Uint8Array} frame
     * @returns {Uint8Array}
     */
    openFrame(version_id, index, is_last, format, frame) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passArray8ToWasm0(version_id, wasm.__wbindgen_export);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passArray8ToWasm0(frame, wasm.__wbindgen_export);
            const len1 = WASM_VECTOR_LEN;
            wasm.wasmrequestcontentreader_openFrame(retptr, this.__wbg_ptr, ptr0, len0, index, is_last, format, ptr1, len1);
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
}
if (Symbol.dispose) WasmRequestContentReader.prototype[Symbol.dispose] = WasmRequestContentReader.prototype.free;

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
 * Holds the password, the master key (12 words) and the key derived from it inside WASM
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
     * Take an existing master key instead of generating one; counts as confirmed.
     * Throws `crypto` for an invalid phrase, `invalid_state` once confirmed or registering.
     * @param {string} phrase
     */
    adoptPhrase(phrase) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(phrase, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.wasmsignupceremony_adoptPhrase(retptr, this.__wbg_ptr, ptr0, len0);
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
     * Generate the master key (12 words) and the key derived from it (Argon2id, about a second).
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
     * The canonical order of the pre-account ceremony (master key first, then the password), as
     * `[{ step, spec_step_id }]`. Same as the order `pendingSteps` lists in.
     * @returns {any}
     */
    static ceremonyStepOrder() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.wasmsignupceremony_ceremonyStepOrder(retptr);
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
 * A storage GET's body as the bytes arrive, counted in core so no client counts its own.
 * `WasmStorageBody.fromHead(status, contentLength, expected)` starts it; `push(n)` counts the bytes
 * read and throws as soon as they would pass the grant; `finish()` gives `{ kind: "stored" }` or
 * `{ kind: "failed", status: 200 }` and consumes the handle. Every count crosses as a JS number.
 * Because `finish()` takes the handle by value, a JS `push` after `finish` throws wasm-bindgen's
 * moved-value error, which has no `code` (the count was consumed; there is nothing left to count).
 */
export class WasmStorageBody {
    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(WasmStorageBody.prototype);
        obj.__wbg_ptr = ptr;
        WasmStorageBodyFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmStorageBodyFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmstoragebody_free(ptr, 0);
    }
    /**
     * The body's answer; the handle is consumed.
     * @returns {DirectStorageGet}
     */
    finish() {
        try {
            const ptr = this.__destroy_into_raw();
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.wasmstoragebody_finish(retptr, ptr);
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
     * Start counting. `status` is the head's HTTP status and must be a whole number that fits a
     * `u16`; `content_length` is the head's `Content-Length` (or `null`). Throws `status_invalid`
     * for a status that is not one, and `failed` (with its `status`) when the head is not a `200`
     * whose length is exactly `expected`.
     * @param {number} status
     * @param {number | null | undefined} content_length
     * @param {number} expected
     * @returns {WasmStorageBody}
     */
    static fromHead(status, content_length, expected) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.wasmstoragebody_fromHead(retptr, status, !isLikeNone(content_length), isLikeNone(content_length) ? 0 : content_length, expected);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            return WasmStorageBody.__wrap(r0);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Count `n` more bytes read. Throws `failed` (with its `status`) as soon as they would pass
     * `expected`, so the caller stops reading.
     * @param {number} n
     */
    push(n) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.wasmstoragebody_push(retptr, this.__wbg_ptr, n);
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
if (Symbol.dispose) WasmStorageBody.prototype[Symbol.dispose] = WasmStorageBody.prototype.free;

/**
 * The approver's side of a typed-code attempt, for a browser without a camera.
 * Construct it with the code the person typed and the link detail's
 * `session_id` and `device_name`; relay `message` under role `approver`; pass
 * the new device's answer to `confirm`, and only then `seal`. Show
 * `deviceName` while the person types: `confirm` proves the new device
 * reported it.
 */
export class WasmTypedApproval {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmTypedApprovalFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmtypedapproval_free(ptr, 0);
    }
    /**
     * Check the new device's answer (relayed under role `new_device`). Throws
     * `confirmation_failed` for a wrong code or a changed device name, and
     * `malformed_answer` for anything that is not an answer; the attempt is
     * spent either way, so deny the link and start again.
     * @param {Uint8Array} new_device_message
     */
    confirm(new_device_message) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passArray8ToWasm0(new_device_message, wasm.__wbindgen_export);
            const len0 = WASM_VECTOR_LEN;
            wasm.wasmtypedapproval_confirm(retptr, this.__wbg_ptr, ptr0, len0);
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
     * @returns {string}
     */
    get deviceName() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.wasmtypedapproval_deviceName(retptr, this.__wbg_ptr);
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
     * The message to relay under role `approver`.
     * @returns {Uint8Array}
     */
    get message() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.wasmtypedapproval_message(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var v1 = getArrayU8FromWasm0(r0, r1).slice();
            wasm.__wbindgen_export4(r0, r1 * 1, 1);
            return v1;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * @param {string} typed_code
     * @param {Uint8Array} session_id
     * @param {string} device_name
     */
    constructor(typed_code, session_id, device_name) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(typed_code, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passArray8ToWasm0(session_id, wasm.__wbindgen_export);
            const len1 = WASM_VECTOR_LEN;
            const ptr2 = passStringToWasm0(device_name, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len2 = WASM_VECTOR_LEN;
            wasm.wasmtypedapproval_new(retptr, ptr0, len0, ptr1, len1, ptr2, len2);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            this.__wbg_ptr = r0 >>> 0;
            WasmTypedApprovalFinalization.register(this, this.__wbg_ptr, this);
            return this;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Seal the account key for the confirmed new device: `{ nonce, ciphertext }`
     * for `approve_device_link` (with no `approver_public`). Throws before
     * `confirm` succeeded.
     * @param {Uint8Array} master_key
     * @returns {any}
     */
    seal(master_key) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passArray8ToWasm0(master_key, wasm.__wbindgen_export);
            const len0 = WASM_VECTOR_LEN;
            wasm.wasmtypedapproval_seal(retptr, this.__wbg_ptr, ptr0, len0);
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
if (Symbol.dispose) WasmTypedApproval.prototype[Symbol.dispose] = WasmTypedApproval.prototype.free;

/**
 * The new device after it answered a typed-code attempt.
 */
export class WasmTypedReceiver {
    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(WasmTypedReceiver.prototype);
        obj.__wbg_ptr = ptr;
        WasmTypedReceiverFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmTypedReceiverFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmtypedreceiver_free(ptr, 0);
    }
    /**
     * The message to relay under role `new_device`.
     * @returns {Uint8Array}
     */
    get message() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.wasmtypedreceiver_message(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var v1 = getArrayU8FromWasm0(r0, r1).slice();
            wasm.__wbindgen_export4(r0, r1 * 1, 1);
            return v1;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Open the relayed typed-code approval (`nonce`, `ciphertext` from the
     * link result). The approver's tag is checked first; one attempt.
     * @param {Uint8Array} nonce
     * @param {Uint8Array} ciphertext
     * @returns {WasmAccountKeyMaterial}
     */
    open(nonce, ciphertext) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passArray8ToWasm0(nonce, wasm.__wbindgen_export);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passArray8ToWasm0(ciphertext, wasm.__wbindgen_export);
            const len1 = WASM_VECTOR_LEN;
            wasm.wasmtypedreceiver_open(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            return WasmAccountKeyMaterial.__wrap(r0);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
}
if (Symbol.dispose) WasmTypedReceiver.prototype[Symbol.dispose] = WasmTypedReceiver.prototype.free;

/**
 * An opaque write target issued by `resolveOwnedKey` (task 2275, L13).
 *
 * A replacement is sealed through this handle only: the id, the key and the
 * chunk-format pin all come from core's resolution, so a caller cannot point a
 * write at another row or drop a recorded v2 pin.
 */
export class WasmWriteTarget {
    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(WasmWriteTarget.prototype);
        obj.__wbg_ptr = ptr;
        WasmWriteTargetFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmWriteTargetFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmwritetarget_free(ptr, 0);
    }
    /**
     * The row id the write must target.
     * @returns {string}
     */
    get itemId() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.wasmwritetarget_itemId(retptr, this.__wbg_ptr);
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
     * The chunk-format pin the write must keep (0 = unrecorded, 2 = v2).
     * @returns {number}
     */
    get pin() {
        const ret = wasm.wasmwritetarget_pin(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number | undefined}
     */
    get versionCounter() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.wasmwritetarget_versionCounter(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r2 = getDataViewMemory0().getFloat64(retptr + 8 * 1, true);
            return r0 === 0 ? undefined : r2;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * @returns {Uint8Array | undefined}
     */
    get versionId() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.wasmwritetarget_versionId(retptr, this.__wbg_ptr);
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
if (Symbol.dispose) WasmWriteTarget.prototype[Symbol.dispose] = WasmWriteTarget.prototype.free;

/**
 * @param {Uint8Array} master_key
 * @param {Uint8Array} nonce
 * @param {Uint8Array} server_public
 * @param {Uint8Array} session_id
 * @param {Uint8Array} account_id
 * @returns {Uint8Array}
 */
export function answerSessionKeyProof(master_key, nonce, server_public, session_id, account_id) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArray8ToWasm0(master_key, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(nonce, wasm.__wbindgen_export);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArray8ToWasm0(server_public, wasm.__wbindgen_export);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passArray8ToWasm0(session_id, wasm.__wbindgen_export);
        const len3 = WASM_VECTOR_LEN;
        const ptr4 = passArray8ToWasm0(account_id, wasm.__wbindgen_export);
        const len4 = WASM_VECTOR_LEN;
        wasm.answerSessionKeyProof(retptr, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
        if (r3) {
            throw takeObject(r2);
        }
        var v6 = getArrayU8FromWasm0(r0, r1).slice();
        wasm.__wbindgen_export4(r0, r1 * 1, 1);
        return v6;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * @param {string} name
 * @param {string | null} [id]
 * @returns {any}
 */
export function apiDescriptor(name, id) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passStringToWasm0(name, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        var ptr1 = isLikeNone(id) ? 0 : passStringToWasm0(id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        var len1 = WASM_VECTOR_LEN;
        wasm.apiDescriptor(retptr, ptr0, len0, ptr1, len1);
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
 * A count as the archive words show it (`1,234`).
 * @param {bigint} n
 * @returns {string}
 */
export function archiveCountLabel(n) {
    let deferred1_0;
    let deferred1_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        wasm.archiveCountLabel(retptr, n);
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
 * The archive/extract rule: [`path_safety::archive_component`], the portable
 * sanitizer above. Named for the caller that extracts entries, so the intent is
 * on the call site; it never drops a name silently.
 * @param {string} name
 * @returns {string}
 */
export function archiveEntryName(name) {
    let deferred3_0;
    let deferred3_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passStringToWasm0(name, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        wasm.archiveEntryName(retptr, ptr0, len0);
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
 * A size as the archive words show it (`3.4 MB`).
 * @param {bigint} bytes
 * @returns {string}
 */
export function archiveSizeLabel(bytes) {
    let deferred1_0;
    let deferred1_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        wasm.archiveSizeLabel(retptr, bytes);
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
 * Core's words for `key` with `args` (`{name: value}`, values already
 * formatted): `{key, text, args}`. An unknown key throws.
 * @param {string} key
 * @param {any} args
 * @returns {any}
 */
export function archiveText(key, args) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passStringToWasm0(key, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        wasm.archiveText(retptr, ptr0, len0, addHeapObject(args));
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
 * The action every stopped backup offers: `"Back up again"`.
 * @returns {string}
 */
export function backupAgainAction() {
    let deferred1_0;
    let deferred1_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        wasm.backupAgainAction(retptr);
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
 * The app rule (spec Amendment 8): the words to show when `mutation` of a row
 * at `position` (`"root" | "device_folder" | "manifest" | "category_folder" |
 * "inside" | "outside"`, from `backupPositionAtDepth`; for `"create"`, the
 * folder the new item goes into) is refused, or `undefined`. A move checks
 * the row with `"move"` and the destination folder with `"create"`.
 * @param {string} position
 * @param {string} mutation
 * @returns {string | undefined}
 */
export function backupCheckAppMutation(position, mutation) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passStringToWasm0(position, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(mutation, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len1 = WASM_VECTOR_LEN;
        wasm.backupCheckAppMutation(retptr, ptr0, len0, ptr1, len1);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
        if (r3) {
            throw takeObject(r2);
        }
        let v3;
        if (r0 !== 0) {
            v3 = getStringFromWasm0(r0, r1).slice();
            wasm.__wbindgen_export4(r0, r1 * 1, 1);
        }
        return v3;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * The drive rule (Explorer, Finder, the iOS Files app), with the same words:
 * nothing at or under the root is changed in a drive surface. `undefined`
 * when allowed. `ownActiveSource`: the original's path when the row is this
 * device's own backup of a folder still being backed up.
 * @param {string} position
 * @param {string | null | undefined} own_active_source
 * @param {string} mutation
 * @returns {string | undefined}
 */
export function backupCheckDriveMutation(position, own_active_source, mutation) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passStringToWasm0(position, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        var ptr1 = isLikeNone(own_active_source) ? 0 : passStringToWasm0(own_active_source, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        var len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(mutation, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len2 = WASM_VECTOR_LEN;
        wasm.backupCheckDriveMutation(retptr, ptr0, len0, ptr1, len1, ptr2, len2);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
        if (r3) {
            throw takeObject(r2);
        }
        let v4;
        if (r0 !== 0) {
            v4 = getStringFromWasm0(r0, r1).slice();
            wasm.__wbindgen_export4(r0, r1 * 1, 1);
        }
        return v4;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * The words when the notices could not be read: "Couldn't check — will
 * retry."
 * @returns {string}
 */
export function backupCheckFailedWords() {
    let deferred1_0;
    let deferred1_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        wasm.backupCheckFailedWords(retptr);
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
 * The server's root rule: the words to show when `mutation` (`"trash" |
 * "delete" | "rename" | "move" | "create" | "write"`) of a row with `role` is
 * refused, or `undefined` when it is allowed. Only the root's trash, delete,
 * rename and move are refused; the web's own views use
 * `backupCheckAppMutation`.
 * @param {string | null | undefined} role
 * @param {string} mutation
 * @returns {string | undefined}
 */
export function backupCheckRootMutation(role, mutation) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        var ptr0 = isLikeNone(role) ? 0 : passStringToWasm0(role, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        var len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(mutation, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len1 = WASM_VECTOR_LEN;
        wasm.backupCheckRootMutation(retptr, ptr0, len0, ptr1, len1);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
        if (r3) {
            throw takeObject(r2);
        }
        let v3;
        if (r0 !== 0) {
            v3 = getStringFromWasm0(r0, r1).slice();
            wasm.__wbindgen_export4(r0, r1 * 1, 1);
        }
        return v3;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * The `lastPassAtMs` of a device with none under this engine yet (spec
 * Amendment 12c): `setupAtMs`, the moment backups were set up on this device,
 * or `legacyLastBackupMs`, an upgraded device's last successful backup under
 * the old engine; with both, the earlier; with neither, 0 (any removal notice
 * stops the backup). Both on the server's clock; a value that is not a whole
 * number of milliseconds throws.
 * @param {number | null} [setup_at_ms]
 * @param {number | null} [legacy_last_backup_ms]
 * @returns {number}
 */
export function backupFirstPassBaseline(setup_at_ms, legacy_last_backup_ms) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        wasm.backupFirstPassBaseline(retptr, !isLikeNone(setup_at_ms), isLikeNone(setup_at_ms) ? 0 : setup_at_ms, !isLikeNone(legacy_last_backup_ms), isLikeNone(legacy_last_backup_ms) ? 0 : legacy_last_backup_ms);
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
 * `true` for a row no listing ever shows (a device folder's `.device.json`);
 * `depth` and `name` as for `backupPositionAtDepth`.
 * @param {number | null | undefined} depth
 * @param {string} name
 * @returns {boolean}
 */
export function backupIsHiddenItem(depth, name) {
    const ptr0 = passStringToWasm0(name, wasm.__wbindgen_export, wasm.__wbindgen_export2);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.backupIsHiddenItem(isLikeNone(depth) ? 0x100000001 : (depth) >>> 0, ptr0, len0);
    return ret !== 0;
}

/**
 * How far before `lastPassAtMs` a notice still counts, in milliseconds:
 * 600000 (10 minutes). A notice's `created_at` is the start of the server
 * transaction that wrote it, not its commit.
 * @returns {number}
 */
export function backupNoticeOverlapMs() {
    const ret = wasm.backupNoticeOverlapMs();
    return ret;
}

/**
 * The reason a `notifications` row (`type`, `data`) gives, or `undefined` for
 * a row that is not a backup notice: to show the notification with
 * `backupStopWords`. A removal whose reason this build does not know is
 * `"unknown_removal"` (its own words, never the "deleted" ones).
 * @param {string} kind
 * @param {any} data
 * @returns {string | undefined}
 */
export function backupNoticeReason(kind, data) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passStringToWasm0(kind, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        wasm.backupNoticeReason(retptr, ptr0, len0, addHeapObject(data));
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        let v2;
        if (r0 !== 0) {
            v2 = getStringFromWasm0(r0, r1).slice();
            wasm.__wbindgen_export4(r0, r1 * 1, 1);
        }
        return v2;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * The `since` to send to `GET /api/v1/notifications` (integer milliseconds,
 * inclusive): `lastPassAtMs` minus the overlap, never below 0. A value that
 * is not a whole number of milliseconds throws.
 * @param {number} last_pass_at_ms
 * @returns {number}
 */
export function backupNoticesSince(last_pass_at_ms) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        wasm.backupNoticesSince(retptr, last_pass_at_ms);
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
 * Parse a decrypted `.device.json` into a plain object: the known fields and
 * every unknown one, as core keeps them.
 * @param {string} json
 * @returns {any}
 */
export function backupParseManifest(json) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passStringToWasm0(json, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        wasm.backupParseManifest(retptr, ptr0, len0);
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
 * @param {boolean} notices_fetch_ok
 * @param {any} notices
 * @param {number} last_pass_at_ms
 * @param {any} listing
 * @returns {any}
 */
export function backupPassGate(notices_fetch_ok, notices, last_pass_at_ms, listing) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        wasm.backupPassGate(retptr, notices_fetch_ok, addHeapObject(notices), last_pass_at_ms, addHeapObject(listing));
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
 * What one pass does before it uploads anything (spec Amendments 12, 12c,
 * 12d): `{outcome: "run", stopped, acknowledged}` when the notices were read
 * (as `backupStopV2`), or `{outcome: "check_failed"}` when `noticesFetchOk`
 * is false: upload nothing, turn nothing off, show `backupCheckFailedWords()`,
 * retry at the next scheduled pass, and keep both `lastPassAtMs` and the
 * acknowledged set. `notices` is not read when the fetch failed.
 * @param {boolean} notices_fetch_ok
 * @param {any} notices
 * @param {number} last_pass_at_ms
 * @param {any} acknowledged
 * @param {any} listing
 * @returns {any}
 */
export function backupPassGateV2(notices_fetch_ok, notices, last_pass_at_ms, acknowledged, listing) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        wasm.backupPassGateV2(retptr, notices_fetch_ok, addHeapObject(notices), last_pass_at_ms, addHeapObject(acknowledged), addHeapObject(listing));
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
 * The position of the row `name`, `depth` folders below the flagged root
 * (`null` or `undefined`: not under it): `"outside"`, `"root"` (0),
 * `"device_folder"` (1), `"manifest"` (2, a device folder's `.device.json`),
 * `"category_folder"` (2) or `"inside"` (3 or more).
 * @param {number | null | undefined} depth
 * @param {string} name
 * @returns {string}
 */
export function backupPositionAtDepth(depth, name) {
    let deferred2_0;
    let deferred2_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passStringToWasm0(name, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        wasm.backupPositionAtDepth(retptr, isLikeNone(depth) ? 0x100000001 : (depth) >>> 0, ptr0, len0);
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
 * One byte per row of a listing (its `system_role`, `""` for none): 1 when
 * the row is the protected root (no trash, delete, rename or move), else 0. A role this
 * build does not know is protected (1), never an error: it fails safe, and the
 * rest of the listing still renders.
 * @param {string[]} roles
 * @returns {Uint8Array}
 */
export function backupProtectionMany(roles) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArrayJsValueToWasm0(roles, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        wasm.backupProtectionMany(retptr, ptr0, len0);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var v2 = getArrayU8FromWasm0(r0, r1).slice();
        wasm.__wbindgen_export4(r0, r1 * 1, 1);
        return v2;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * The badge every client shows on the Backups root (`"Read-only"`).
 * @returns {string}
 */
export function backupRootBadge() {
    let deferred1_0;
    let deferred1_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        wasm.backupRootBadge(retptr);
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
 * @param {any} notices
 * @param {number} last_pass_at_ms
 * @param {any} listing
 * @returns {any}
 */
export function backupStop(notices, last_pass_at_ms, listing) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        wasm.backupStop(retptr, addHeapObject(notices), last_pass_at_ms, addHeapObject(listing));
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
 * Which backups turn off on this pass, and why (spec Amendments 12 and
 * 12d): `{stopped: [{category, reason}], acknowledged: [id]}`. A notice
 * counts when its `created_at_ms` is after `lastPassAtMs` minus the overlap
 * and its `id` is not in `acknowledged` (the ids the previous pass returned;
 * empty on a first pass). `acknowledged` in the answer replaces the stored
 * set: store it with the stops and the new `lastPassAtMs`, and keep it when
 * the person chooses "Back up again". `notices`: the rows (`{id, type, data,
 * created_at_ms}`) from `backupNoticesSince(lastPassAtMs)` on, read as for
 * `backupStop`; `listing` as for `backupStop`.
 * @param {any} notices
 * @param {number} last_pass_at_ms
 * @param {any} acknowledged
 * @param {any} listing
 * @returns {any}
 */
export function backupStopV2(notices, last_pass_at_ms, acknowledged, listing) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        wasm.backupStopV2(retptr, addHeapObject(notices), last_pass_at_ms, addHeapObject(acknowledged), addHeapObject(listing));
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
 * The words a stopped backup shows (spec Amendment 12), followed by the
 * action `backupAgainAction()`. `device` is the device's name and `folder`
 * the folder's display name; the four account-wide reasons name neither. An
 * unknown reason throws.
 * @param {string} reason
 * @param {string} device
 * @param {string} folder
 * @returns {string}
 */
export function backupStopWords(reason, device, folder) {
    let deferred5_0;
    let deferred5_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passStringToWasm0(reason, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(device, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(folder, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len2 = WASM_VECTOR_LEN;
        wasm.backupStopWords(retptr, ptr0, len0, ptr1, len1, ptr2, len2);
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
 * Build `{app_url}/{s|f}/{token}#key={key}`. `route` is `"s"` (the default
 * when omitted or `null`) or `"f"`.
 * @param {string} app_url
 * @param {string} token
 * @param {string} key
 * @param {string | null} [route]
 * @returns {string}
 */
export function buildShareLink(app_url, token, key, route) {
    let deferred6_0;
    let deferred6_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passStringToWasm0(app_url, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(token, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(key, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len2 = WASM_VECTOR_LEN;
        var ptr3 = isLikeNone(route) ? 0 : passStringToWasm0(route, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        var len3 = WASM_VECTOR_LEN;
        wasm.buildShareLink(retptr, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3);
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
 * Check one server-provided name (a single component, never a path).
 *
 * `portable` selects the strict cross-platform rule set (what a pulled tree or
 * an archive must satisfy); `windows` says the caller will write it with
 * Windows path semantics. Returns normally when the name is safe, throws the
 * user-facing reason otherwise (e.g. `contains a path separator`).
 * @param {string} name
 * @param {boolean} portable
 * @param {boolean} windows
 */
export function checkPathComponent(name, portable, windows) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passStringToWasm0(name, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        wasm.checkPathComponent(retptr, ptr0, len0, portable, windows);
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
 * `{ kind: "failed", status }`; a caller with no HTTP answer passes status `0` (exactly what
 * `WasmStorageBody.fromHead` reports for it). Only a `200` whose `Content-Length` is exactly
 * `expected` is `stored`.
 * `status` crosses as a JS number and is validated exactly as `WasmStorageBody.fromHead` validates
 * it: a whole number in `0..=65535`, else `status_invalid`. `undefined` is not a number and throws
 * `status_invalid` too, so a caller cannot omit the answer it means to report.
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
 * L14: does this row's L7 wrap open to exactly `expectedKey`?
 * @param {Uint8Array} folder_key
 * @param {string} shared_folder_id
 * @param {string} item_id
 * @param {number} kind
 * @param {Uint8Array} wrapped
 * @param {Uint8Array} expected_key
 * @returns {boolean}
 */
export function childWrapMatches(folder_key, shared_folder_id, item_id, kind, wrapped, expected_key) {
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
        const ptr4 = passArray8ToWasm0(expected_key, wasm.__wbindgen_export);
        const len4 = WASM_VECTOR_LEN;
        wasm.childWrapMatches(retptr, ptr0, len0, ptr1, len1, ptr2, len2, kind, ptr3, len3, ptr4, len4);
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
 * Decode any accepted stored form of the metadata envelope.
 *
 * Throws an `Error` whose message starts with `invalid input:` — the core
 * error's own text — for invalid JSON, a missing/non-byte field, an unknown
 * cipher suite, or a `null` field. Fields core does not know are ignored.
 * @param {string} payload
 * @returns {any}
 */
export function decodeMetadataEnvelope(payload) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passStringToWasm0(payload, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        wasm.decodeMetadataEnvelope(retptr, ptr0, len0);
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
 * lies about the count fails the tag. `metadata` is what
 * `decrypt_file_metadata` returned for this version, never a server field:
 * with a version commitment only that upload's v2 frames open; a record
 * without one opens v1 frames only, and a `chunk_format: 2` record without
 * one is refused (the ruling of 2026-11-07).
 * @param {Uint8Array} file_key
 * @param {string} file_id
 * @param {any} metadata
 * @param {number} index
 * @param {boolean} is_last
 * @param {Uint8Array} frame
 * @returns {Uint8Array}
 */
export function decrypt_chunk_frame(file_key, file_id, metadata, index, is_last, frame) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArray8ToWasm0(file_key, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(file_id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArray8ToWasm0(frame, wasm.__wbindgen_export);
        const len2 = WASM_VECTOR_LEN;
        wasm.decrypt_chunk_frame(retptr, ptr0, len0, ptr1, len1, addHeapObject(metadata), index, is_last, ptr2, len2);
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
 * @param {Uint8Array} nonce
 * @param {Uint8Array} ciphertext
 * @returns {string}
 */
export function encodeMetadataEnvelope(nonce, ciphertext) {
    let deferred4_0;
    let deferred4_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArray8ToWasm0(nonce, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(ciphertext, wasm.__wbindgen_export);
        const len1 = WASM_VECTOR_LEN;
        wasm.encodeMetadataEnvelope(retptr, ptr0, len0, ptr1, len1);
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
 * Seal a name for a NEW row minted by `newOwnerItemId`/`newForeignItemId`.
 *
 * The id handle decides the key (L12): an owner id derives it. A new foreign
 * id is refused (an F id never derives its name key) — an F name is sealed
 * through the `writeTarget` it gets after adoption; only its content goes
 * through `WasmChunkEncryptor.forNewItem`.
 * @param {WasmNewItemId} item_id
 * @param {string} filename
 * @param {string | null | undefined} mime_type
 * @param {number} pin
 * @returns {string}
 */
export function encryptNameForNewItem(item_id, filename, mime_type, pin) {
    let deferred4_0;
    let deferred4_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        _assertClass(item_id, WasmNewItemId);
        const ptr0 = passStringToWasm0(filename, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        var ptr1 = isLikeNone(mime_type) ? 0 : passStringToWasm0(mime_type, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        var len1 = WASM_VECTOR_LEN;
        wasm.encryptNameForNewItem(retptr, item_id.__wbg_ptr, ptr0, len0, ptr1, len1, pin);
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
 * Protected name metadata for a NEW row after frame 0 was emitted.
 * @param {WasmNewItemId} item_id
 * @param {string} filename
 * @param {string | null | undefined} mime_type
 * @param {number} pin
 * @param {Uint8Array} version_id
 * @param {number} version_counter
 * @returns {string}
 */
export function encryptNameForNewItemVersion(item_id, filename, mime_type, pin, version_id, version_counter) {
    let deferred5_0;
    let deferred5_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        _assertClass(item_id, WasmNewItemId);
        const ptr0 = passStringToWasm0(filename, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        var ptr1 = isLikeNone(mime_type) ? 0 : passStringToWasm0(mime_type, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        var len1 = WASM_VECTOR_LEN;
        const ptr2 = passArray8ToWasm0(version_id, wasm.__wbindgen_export);
        const len2 = WASM_VECTOR_LEN;
        wasm.encryptNameForNewItemVersion(retptr, item_id.__wbg_ptr, ptr0, len0, ptr1, len1, pin, ptr2, len2, version_counter);
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
 * Seal a replacement name through the resolved row's write target. The key and
 * the pin come from the target, so a caller cannot substitute either.
 * @param {WasmWriteTarget} target
 * @param {string} filename
 * @param {string | null} [mime_type]
 * @returns {string}
 */
export function encryptNameForTarget(target, filename, mime_type) {
    let deferred4_0;
    let deferred4_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        _assertClass(target, WasmWriteTarget);
        const ptr0 = passStringToWasm0(filename, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        var ptr1 = isLikeNone(mime_type) ? 0 : passStringToWasm0(mime_type, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        var len1 = WASM_VECTOR_LEN;
        wasm.encryptNameForTarget(retptr, target.__wbg_ptr, ptr0, len0, ptr1, len1);
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
 * Protected metadata for a replacement version through the resolved target.
 * @param {WasmWriteTarget} target
 * @param {string} filename
 * @param {string | null | undefined} mime_type
 * @param {Uint8Array} version_id
 * @param {number} version_counter
 * @returns {string}
 */
export function encryptNameForTargetVersion(target, filename, mime_type, version_id, version_counter) {
    let deferred5_0;
    let deferred5_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        _assertClass(target, WasmWriteTarget);
        const ptr0 = passStringToWasm0(filename, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        var ptr1 = isLikeNone(mime_type) ? 0 : passStringToWasm0(mime_type, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        var len1 = WASM_VECTOR_LEN;
        const ptr2 = passArray8ToWasm0(version_id, wasm.__wbindgen_export);
        const len2 = WASM_VECTOR_LEN;
        wasm.encryptNameForTargetVersion(retptr, target.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2, version_counter);
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
 * Seal a note for a NEW row minted by `newOwnerItemId`/`newForeignItemId`.
 * @param {WasmNewItemId} item_id
 * @param {string} note
 * @param {number} pin
 * @returns {string}
 */
export function encryptNoteForNewItem(item_id, note, pin) {
    let deferred3_0;
    let deferred3_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        _assertClass(item_id, WasmNewItemId);
        const ptr0 = passStringToWasm0(note, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        wasm.encryptNoteForNewItem(retptr, item_id.__wbg_ptr, ptr0, len0, pin);
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
 * Seal a replacement note through the resolved row's write target.
 * @param {WasmWriteTarget} target
 * @param {string} note
 * @returns {string}
 */
export function encryptNoteForTarget(target, note) {
    let deferred3_0;
    let deferred3_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        _assertClass(target, WasmWriteTarget);
        const ptr0 = passStringToWasm0(note, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        wasm.encryptNoteForTarget(retptr, target.__wbg_ptr, ptr0, len0);
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
 * Seal a thumbnail for a NEW row minted by `newOwnerItemId`/`newForeignItemId`.
 * @param {WasmNewItemId} item_id
 * @param {Uint8Array} plaintext
 * @param {number} pin
 * @returns {Uint8Array}
 */
export function encryptThumbnailForNewItem(item_id, plaintext, pin) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        _assertClass(item_id, WasmNewItemId);
        const ptr0 = passArray8ToWasm0(plaintext, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        wasm.encryptThumbnailForNewItem(retptr, item_id.__wbg_ptr, ptr0, len0, pin);
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
 * Seal a replacement thumbnail through the resolved row's write target.
 * @param {WasmWriteTarget} target
 * @param {Uint8Array} plaintext
 * @returns {Uint8Array}
 */
export function encryptThumbnailForTarget(target, plaintext) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        _assertClass(target, WasmWriteTarget);
        const ptr0 = passArray8ToWasm0(plaintext, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        wasm.encryptThumbnailForTarget(retptr, target.__wbg_ptr, ptr0, len0);
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
 * Seal protected metadata for a newly written version.
 * @param {Uint8Array} master_key
 * @param {string} file_id
 * @param {string} filename
 * @param {string | null | undefined} mime_type
 * @param {number} chunk_format
 * @param {Uint8Array} version_id
 * @param {number} version_counter
 * @returns {string}
 */
export function encrypt_name_with_version(master_key, file_id, filename, mime_type, chunk_format, version_id, version_counter) {
    let deferred7_0;
    let deferred7_1;
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
        const ptr4 = passArray8ToWasm0(version_id, wasm.__wbindgen_export);
        const len4 = WASM_VECTOR_LEN;
        wasm.encrypt_name_with_version(retptr, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, chunk_format, ptr4, len4, version_counter);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
        var ptr6 = r0;
        var len6 = r1;
        if (r3) {
            ptr6 = 0; len6 = 0;
            throw takeObject(r2);
        }
        deferred7_0 = ptr6;
        deferred7_1 = len6;
        return getStringFromWasm0(ptr6, len6);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        wasm.__wbindgen_export4(deferred7_0, deferred7_1, 1);
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
 * Web `handleCopyExisting` in core: the request's link, or `undefined`.
 * @param {string} app_url
 * @param {Uint8Array} master_key
 * @param {string | null} [token]
 * @param {string | null} [wrapped_private_key]
 * @param {string | null} [wrap_nonce]
 * @returns {string | undefined}
 */
export function fileRequestRebuildLink(app_url, master_key, token, wrapped_private_key, wrap_nonce) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passStringToWasm0(app_url, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(master_key, wasm.__wbindgen_export);
        const len1 = WASM_VECTOR_LEN;
        var ptr2 = isLikeNone(token) ? 0 : passStringToWasm0(token, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        var len2 = WASM_VECTOR_LEN;
        var ptr3 = isLikeNone(wrapped_private_key) ? 0 : passStringToWasm0(wrapped_private_key, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        var len3 = WASM_VECTOR_LEN;
        var ptr4 = isLikeNone(wrap_nonce) ? 0 : passStringToWasm0(wrap_nonce, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        var len4 = WASM_VECTOR_LEN;
        wasm.fileRequestRebuildLink(retptr, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
        if (r3) {
            throw takeObject(r2);
        }
        let v6;
        if (r0 !== 0) {
            v6 = getStringFromWasm0(r0, r1).slice();
            wasm.__wbindgen_export4(r0, r1 * 1, 1);
        }
        return v6;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * Shorten a client-metadata string for sealing: over 1024 UTF-8 bytes, keep
 * the last 1021 bytes on a char boundary behind a leading `…`.
 * @param {string} s
 * @returns {string}
 */
export function fitForSeal(s) {
    let deferred2_0;
    let deferred2_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passStringToWasm0(s, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        wasm.fitForSeal(retptr, ptr0, len0);
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
 * Format a byte count with binary units and IEC labels: `1 KiB` (1,024),
 * `1 MiB`, `1.0 TiB`. Same ladder and precision rule as the SI formatter; a
 * negative count keeps its sign and never scales (`-1500 B`).
 * @param {bigint} bytes
 * @returns {string}
 */
export function formatBinary(bytes) {
    let deferred1_0;
    let deferred1_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        wasm.formatBinary(retptr, bytes);
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
 * Format a byte count in decimal units with `decimals` decimals (0, 1 or 2),
 * carrying a value that rounds up into the next unit (`999.6 KB` with one
 * decimal prints `1.0 MB`). Counts below 1,000 always print as `N B`.
 * @param {bigint} bytes
 * @param {number} decimals
 * @returns {string}
 */
export function formatCompact(bytes, decimals) {
    let deferred2_0;
    let deferred2_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        wasm.formatCompact(retptr, bytes, decimals);
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
 * Generate a recovery kit PDF with a title, master key words, and metadata.
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
 * Generate a new master key (12 BIP39 words) and the corresponding derived
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
 * True when `item_id` is a canonical foreign (F) id; InvalidInput (a JS throw)
 * when the text is not canonical at all.
 * @param {string} item_id
 * @returns {boolean}
 */
export function isForeignItemId(item_id) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passStringToWasm0(item_id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        wasm.isForeignItemId(retptr, ptr0, len0);
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
 * Mint a guest (F) item id with NO master key (task 2275 §15). The anonymous
 * uploader path uses this; the id is a canonical RFC 9562 UUID v8 and core's
 * class check classifies it as foreign. The server has no T2 F-class check
 * yet (future server work), so only the core check protects this id today.
 * @returns {string}
 */
export function mintGuestItemId() {
    let deferred2_0;
    let deferred2_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        wasm.mintGuestItemId(retptr);
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
 * Mint a new foreign (F) item id (RFC 9562 UUID v8) for `master_key`.
 * @param {Uint8Array} master_key
 * @returns {WasmNewItemId}
 */
export function newForeignItemId(master_key) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArray8ToWasm0(master_key, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        wasm.newForeignItemId(retptr, ptr0, len0);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        if (r2) {
            throw takeObject(r1);
        }
        return WasmNewItemId.__wrap(r0);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * Mint a new owner (O) item id (random UUID v4) for `master_key`.
 * @param {Uint8Array} master_key
 * @returns {WasmNewItemId}
 */
export function newOwnerItemId(master_key) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArray8ToWasm0(master_key, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        wasm.newOwnerItemId(retptr, ptr0, len0);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        if (r2) {
            throw takeObject(r1);
        }
        return WasmNewItemId.__wrap(r0);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * An account email in the server's stored form (Rust `str::trim`, then
 * Unicode lower case). Use it for every email that names a contact or a pin.
 * @param {string} raw
 * @returns {string}
 */
export function normalizeEmail(raw) {
    let deferred2_0;
    let deferred2_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passStringToWasm0(raw, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        wasm.normalizeEmail(retptr, ptr0, len0);
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
 * Finish OPAQUE client login. Returns `{ message: Uint8Array, session_key: Uint8Array, export_key: Uint8Array }`.
 *
 * Normal login accepts only the current KSF version (1). A server-supplied
 * legacy or unknown version is rejected; legacy accounts require the explicit
 * migration path in core.
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
 * Open a guest's display name. The envelope must be a JSON object with
 * exactly the keys `cipher_suite`, `nonce` and `ciphertext` (any key order,
 * any whitespace) that opens under the one actor-name key; the plaintext then
 * goes through the same `sanitize_actor_name` rule as the writer and is
 * returned sanitized. Every refusal is a decryption failure.
 * @param {Uint8Array} folder_key
 * @param {string} shared_folder_id
 * @param {string} envelope
 * @returns {string}
 */
export function openFolderActorName(folder_key, shared_folder_id, envelope) {
    let deferred5_0;
    let deferred5_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArray8ToWasm0(folder_key, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(shared_folder_id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(envelope, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len2 = WASM_VECTOR_LEN;
        wasm.openFolderActorName(retptr, ptr0, len0, ptr1, len1, ptr2, len2);
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
 * The one legacy (unbound) child opener: a 60-byte frame under the folder
 * key, refused when its 32-byte plaintext is valid UTF-8 (L9 rule 1).
 * Returns `undefined` when the frame is not a legacy child wrap.
 * @param {Uint8Array} folder_key
 * @param {Uint8Array} wrapped
 * @returns {Uint8Array | undefined}
 */
export function openLegacyChildKey(folder_key, wrapped) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArray8ToWasm0(folder_key, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(wrapped, wasm.__wbindgen_export);
        const len1 = WASM_VECTOR_LEN;
        wasm.openLegacyChildKey(retptr, ptr0, len0, ptr1, len1);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
        if (r3) {
            throw takeObject(r2);
        }
        let v3;
        if (r0 !== 0) {
            v3 = getArrayU8FromWasm0(r0, r1).slice();
            wasm.__wbindgen_export4(r0, r1 * 1, 1);
        }
        return v3;
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
 * `r_priv` and `e_pub` are 32 bytes; `file_id` is arbitrary bytes. Returns
 * 32-byte `Uint8Array`.
 *
 * **DECRYPT-ONLY.** This is a request row's content key `C`, and the
 * anonymous uploader holds it. Use it to read the row's content; never seal a
 * name, note or thumbnail under this key. For a request row the owner's rename
 * goes through `seal_request_rename` / `sealRequestRename` (the §15
 * string-derived key), never `C`.
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
 * @param {Uint8Array} master_key
 * @param {string} file_id
 * @param {Uint8Array} first_chunk_frame
 * @returns {any}
 */
export function ownerFileKeyForContent(master_key, file_id, first_chunk_frame) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArray8ToWasm0(master_key, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(file_id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArray8ToWasm0(first_chunk_frame, wasm.__wbindgen_export);
        const len2 = WASM_VECTOR_LEN;
        wasm.ownerFileKeyForContent(retptr, ptr0, len0, ptr1, len1, ptr2, len2);
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
 * @param {Uint8Array} master_key
 * @param {string} file_id
 * @param {string} name_encrypted
 * @returns {any}
 */
export function ownerFileKeyForName(master_key, file_id, name_encrypted) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArray8ToWasm0(master_key, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(file_id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(name_encrypted, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len2 = WASM_VECTOR_LEN;
        wasm.ownerFileKeyForName(retptr, ptr0, len0, ptr1, len1, ptr2, len2);
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
 * Parse a `Retry-After` delta-seconds header: the number of seconds, or `null`
 * for anything else (empty, negative, fractional, an HTTP date), so the caller
 * falls back to the ladder.
 * @param {string} value
 * @returns {any}
 */
export function parseRetryAfter(value) {
    const ptr0 = passStringToWasm0(value, wasm.__wbindgen_export, wasm.__wbindgen_export2);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.parseRetryAfter(ptr0, len0);
    return takeObject(ret);
}

/**
 * Parse a share link on either route and on any `https` host (legacy hosts
 * included; plain `http` only for loopback). Returns
 * `{ base_url, route, token, key }`; `key` is the percent-decoded fragment
 * value, not yet decoded as bytes — use `shareKeyBytes(key)` for that.
 *
 * The thrown message starts with core's stable code, so a caller can branch:
 * `missing_fragment`, `missing_key`, `missing_token`, `not_a_share_link`.
 * @param {string} url
 * @returns {any}
 */
export function parseShareLink(url) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passStringToWasm0(url, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        wasm.parseShareLink(retptr, ptr0, len0);
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
 * The `vault-key-escrow` body for a credential id and a blob.
 * @param {Uint8Array} credential_id
 * @param {Uint8Array} blob
 * @returns {string}
 */
export function passkeyEscrowBody(credential_id, blob) {
    let deferred3_0;
    let deferred3_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArray8ToWasm0(credential_id, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(blob, wasm.__wbindgen_export);
        const len1 = WASM_VECTOR_LEN;
        wasm.passkeyEscrowBody(retptr, ptr0, len0, ptr1, len1);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        deferred3_0 = r0;
        deferred3_1 = r1;
        return getStringFromWasm0(r0, r1);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        wasm.__wbindgen_export4(deferred3_0, deferred3_1, 1);
    }
}

/**
 * `login-start`'s answer → `AssertionStart` JSON. The server's `rpId` must equal `expectedRpId`
 * (`passkey_rp_mismatch` otherwise); `allowLocalhost` is the explicit development flag.
 * @param {string} answer_json
 * @param {string} expected_rp_id
 * @param {boolean} allow_localhost
 * @returns {string}
 */
export function passkeyParseAssertionStart(answer_json, expected_rp_id, allow_localhost) {
    let deferred4_0;
    let deferred4_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passStringToWasm0(answer_json, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(expected_rp_id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len1 = WASM_VECTOR_LEN;
        wasm.passkeyParseAssertionStart(retptr, ptr0, len0, ptr1, len1, allow_localhost);
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
 * `register-start`'s answer → `RegistrationStart` JSON. The server's `rp.id` must equal `expectedRpId`
 * (`passkey_rp_mismatch` otherwise); `allowLocalhost` is the explicit development flag.
 * @param {string} answer_json
 * @param {string} expected_rp_id
 * @param {boolean} allow_localhost
 * @returns {string}
 */
export function passkeyParseRegistrationStart(answer_json, expected_rp_id, allow_localhost) {
    let deferred4_0;
    let deferred4_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passStringToWasm0(answer_json, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(expected_rp_id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len1 = WASM_VECTOR_LEN;
        wasm.passkeyParseRegistrationStart(retptr, ptr0, len0, ptr1, len1, allow_localhost);
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
 * The PRF eval input web passes as `prf.eval.first`.
 * @returns {Uint8Array}
 */
export function passkeyPrfEvalInput() {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        wasm.passkeyPrfEvalInput(retptr);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var v1 = getArrayU8FromWasm0(r0, r1).slice();
        wasm.__wbindgen_export4(r0, r1 * 1, 1);
        return v1;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * Open an escrow blob with a PRF output. Returns the 32-byte vault key (the WASM boundary's raw-key convention).
 * @param {Uint8Array} prf_output
 * @param {Uint8Array} blob
 * @returns {Uint8Array}
 */
export function passkeyUnwrapVaultKey(prf_output, blob) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArray8ToWasm0(prf_output, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(blob, wasm.__wbindgen_export);
        const len1 = WASM_VECTOR_LEN;
        wasm.passkeyUnwrapVaultKey(retptr, ptr0, len0, ptr1, len1);
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
 * Wrap the vault key under a PRF output: the escrow blob (`nonce || ct || tag`).
 * @param {Uint8Array} prf_output
 * @param {Uint8Array} master_key
 * @returns {Uint8Array}
 */
export function passkeyWrapVaultKey(prf_output, master_key) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArray8ToWasm0(prf_output, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(master_key, wasm.__wbindgen_export);
        const len1 = WASM_VECTOR_LEN;
        wasm.passkeyWrapVaultKey(retptr, ptr0, len0, ptr1, len1);
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
 * @param {string[]} names
 * @param {string} platform
 * @returns {Uint8Array}
 */
export function previewableBatchFor(names, platform) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArrayJsValueToWasm0(names, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(platform, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len1 = WASM_VECTOR_LEN;
        wasm.previewableBatchFor(retptr, ptr0, len0, ptr1, len1);
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
 * Recover the derived key from the 12 words of a master key.
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
 * 0-based positions of words that are not BIP39 words (DW-A47's per-word hint).
 * @param {string[]} words
 * @returns {Uint32Array}
 */
export function recoveryUnknownWordPositions(words) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArrayJsValueToWasm0(words, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        wasm.recoveryUnknownWordPositions(retptr, ptr0, len0);
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
 * @param {Uint8Array} master_key
 * @param {string} item_id
 * @param {number} kind
 * @param {Uint8Array | null | undefined} owner_wrap
 * @param {string} name_encrypted
 * @param {string | null} [shared_folder_id]
 * @param {Uint8Array | null} [folder_key]
 * @param {Uint8Array | null} [folder_wrap]
 * @param {Uint8Array | null} [first_chunk_frame]
 * @returns {any}
 */
export function resolveOwnedKey(master_key, item_id, kind, owner_wrap, name_encrypted, shared_folder_id, folder_key, folder_wrap, first_chunk_frame) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArray8ToWasm0(master_key, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(item_id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len1 = WASM_VECTOR_LEN;
        var ptr2 = isLikeNone(owner_wrap) ? 0 : passArray8ToWasm0(owner_wrap, wasm.__wbindgen_export);
        var len2 = WASM_VECTOR_LEN;
        const ptr3 = passStringToWasm0(name_encrypted, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len3 = WASM_VECTOR_LEN;
        var ptr4 = isLikeNone(shared_folder_id) ? 0 : passStringToWasm0(shared_folder_id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        var len4 = WASM_VECTOR_LEN;
        var ptr5 = isLikeNone(folder_key) ? 0 : passArray8ToWasm0(folder_key, wasm.__wbindgen_export);
        var len5 = WASM_VECTOR_LEN;
        var ptr6 = isLikeNone(folder_wrap) ? 0 : passArray8ToWasm0(folder_wrap, wasm.__wbindgen_export);
        var len6 = WASM_VECTOR_LEN;
        var ptr7 = isLikeNone(first_chunk_frame) ? 0 : passArray8ToWasm0(first_chunk_frame, wasm.__wbindgen_export);
        var len7 = WASM_VECTOR_LEN;
        wasm.resolveOwnedKey(retptr, ptr0, len0, ptr1, len1, kind, ptr2, len2, ptr3, len3, ptr4, len4, ptr5, len5, ptr6, len6, ptr7, len7);
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
 * @param {Uint8Array} master_key
 * @param {string} item_id
 * @param {Uint8Array} request_wrap_context
 * @param {Uint8Array} wrapped_request_private
 * @param {Uint8Array} wrap_nonce
 * @param {Uint8Array} sender_ephemeral_pubkey
 * @param {Uint8Array} wrapped_content_key
 * @param {string} name_encrypted
 * @returns {any}
 */
export function resolveRequestRow(master_key, item_id, request_wrap_context, wrapped_request_private, wrap_nonce, sender_ephemeral_pubkey, wrapped_content_key, name_encrypted) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArray8ToWasm0(master_key, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(item_id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArray8ToWasm0(request_wrap_context, wasm.__wbindgen_export);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passArray8ToWasm0(wrapped_request_private, wasm.__wbindgen_export);
        const len3 = WASM_VECTOR_LEN;
        const ptr4 = passArray8ToWasm0(wrap_nonce, wasm.__wbindgen_export);
        const len4 = WASM_VECTOR_LEN;
        const ptr5 = passArray8ToWasm0(sender_ephemeral_pubkey, wasm.__wbindgen_export);
        const len5 = WASM_VECTOR_LEN;
        const ptr6 = passArray8ToWasm0(wrapped_content_key, wasm.__wbindgen_export);
        const len6 = WASM_VECTOR_LEN;
        const ptr7 = passStringToWasm0(name_encrypted, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len7 = WASM_VECTOR_LEN;
        wasm.resolveRequestRow(retptr, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4, ptr5, len5, ptr6, len6, ptr7, len7);
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
 * Resume a minted id from the id text and tag persisted with an upload session
 * (task 2275, L13). The tag is re-checked in constant time; a tampered tag, a
 * different id or a server-echoed id is refused, so an interrupted upload can
 * continue but a substituted id cannot be sealed.
 * @param {Uint8Array} master_key
 * @param {string} item_id
 * @param {Uint8Array} tag
 * @returns {WasmNewItemId}
 */
export function resumeNewItemId(master_key, item_id, tag) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArray8ToWasm0(master_key, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(item_id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArray8ToWasm0(tag, wasm.__wbindgen_export);
        const len2 = WASM_VECTOR_LEN;
        wasm.resumeNewItemId(retptr, ptr0, len0, ptr1, len1, ptr2, len2);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        if (r2) {
            throw takeObject(r1);
        }
        return WasmNewItemId.__wrap(r0);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
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
 * The decision after `attempts_made` attempts: the delay in milliseconds to
 * wait before the next attempt, or `null` to surface the last error. A server
 * `Retry-After` (`retry_after_seconds`, a number of seconds or `null`)
 * replaces the ladder exactly.
 *
 * `outcome` is `"success"`, `"network"`, `"fatal"`, or `{ status: 503 }`.
 * @param {any} policy
 * @param {number} attempts_made
 * @param {any} outcome
 * @param {any} retry_after_seconds
 * @returns {any}
 */
export function retryDecide(policy, attempts_made, outcome, retry_after_seconds) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        wasm.retryDecide(retptr, addHeapObject(policy), attempts_made, addHeapObject(outcome), addHeapObject(retry_after_seconds));
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
 * The un-jittered ladder delay before retry number `retry` (1-based; retry 0
 * means "no retry" and is 0 ms), capped at the policy's `cap_ms`.
 * @param {any} policy
 * @param {number} retry
 * @returns {number}
 */
export function retryDelayMs(policy, retry) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        wasm.retryDelayMs(retptr, addHeapObject(policy), retry);
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
 * The ladder delay shortened per the policy's jitter, with a caller-supplied
 * sample in permille (`0..=1000`; larger values are clamped). A `"none"`
 * policy ignores the sample.
 * @param {any} policy
 * @param {number} retry
 * @param {number} sample_permille
 * @returns {number}
 */
export function retryJitteredDelayMs(policy, retry, sample_permille) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        wasm.retryJitteredDelayMs(retptr, addHeapObject(policy), retry, sample_permille);
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
 * The shipped policy: six requests in all (one try plus five retries), 500 ms
 * base, a 30 s cap, no jitter, and a server `Retry-After` honoured.
 * @returns {any}
 */
export function retryPolicy() {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        wasm.retryPolicy(retptr);
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
 * Rewrite one name so it is safe under the strictest (Windows) rule set:
 * `: < > " | ? *` become `_`, trailing dots/spaces become `_`, a reserved
 * device name gets a leading `_`, and bidi controls are removed. A name that
 * is structurally unsafe (separator, `.`/`..`, control character, drive
 * prefix) is still refused, never rewritten.
 * @param {string} name
 * @returns {string}
 */
export function sanitizePathComponent(name) {
    let deferred3_0;
    let deferred3_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passStringToWasm0(name, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        wasm.sanitizePathComponent(retptr, ptr0, len0);
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
 * QR path, approver side: the new device's name as its scanned QR carries
 * it. Show this name while the person confirms, never the relay's
 * `device_name`. Throws for text that is not a Beebeeb device-link QR.
 * @param {string} scanned_qr
 * @returns {string}
 */
export function scannedDeviceLinkName(scanned_qr) {
    let deferred3_0;
    let deferred3_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passStringToWasm0(scanned_qr, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        wasm.scannedDeviceLinkName(retptr, ptr0, len0);
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
 * QR path, approver side. `scanned_qr` is the raw text the camera read from
 * the new device's screen; core parses it, so no fingerprint or name bytes
 * come from JavaScript. Never build that text from server data: the typed
 * code gives no protection against a substituted key on this path. Without a
 * camera, use `WasmTypedApproval`. `relayed_device_name` is the name the
 * relay reports for the link: a name that differs from the scanned one
 * throws `device_name_changed` before anything is sealed; deny the link.
 * @param {Uint8Array} master_key
 * @param {string} scanned_qr
 * @param {Uint8Array} relayed_public
 * @param {string} relayed_device_name
 * @param {string} typed_code
 * @returns {any}
 */
export function sealDeviceLink(master_key, scanned_qr, relayed_public, relayed_device_name, typed_code) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArray8ToWasm0(master_key, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(scanned_qr, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArray8ToWasm0(relayed_public, wasm.__wbindgen_export);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passStringToWasm0(relayed_device_name, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len3 = WASM_VECTOR_LEN;
        const ptr4 = passStringToWasm0(typed_code, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len4 = WASM_VECTOR_LEN;
        wasm.sealDeviceLink(retptr, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4);
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
 * Seal a guest's display name under the folder key, bound to the shared root.
 * Seals `sanitize_actor_name(name)` (core `kdf::sanitize_actor_name`): NFC;
 * controls, bidi controls and the other display controls of its strip table
 * removed (ZWNJ, ZWJ, variation selectors and tag characters are kept); NFC
 * again; then a leading combining mark, a result outside 1..64 Unicode scalar
 * values and a visibly blank name are refused (invalid input). Returns the
 * envelope: a JSON object with exactly the keys `cipher_suite`, `nonce` and
 * `ciphertext`.
 * @param {Uint8Array} folder_key
 * @param {string} shared_folder_id
 * @param {string} name
 * @returns {string}
 */
export function sealFolderActorName(folder_key, shared_folder_id, name) {
    let deferred5_0;
    let deferred5_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArray8ToWasm0(folder_key, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(shared_folder_id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(name, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len2 = WASM_VECTOR_LEN;
        wasm.sealFolderActorName(retptr, ptr0, len0, ptr1, len1, ptr2, len2);
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
 * @param {Uint8Array} master_key
 * @param {string} item_id
 * @param {number} pin
 * @param {string} filename
 * @param {string | null} [mime_type]
 * @returns {string}
 */
export function sealRequestRename(master_key, item_id, pin, filename, mime_type) {
    let deferred6_0;
    let deferred6_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArray8ToWasm0(master_key, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(item_id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(filename, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len2 = WASM_VECTOR_LEN;
        var ptr3 = isLikeNone(mime_type) ? 0 : passStringToWasm0(mime_type, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        var len3 = WASM_VECTOR_LEN;
        wasm.sealRequestRename(retptr, ptr0, len0, ptr1, len1, pin, ptr2, len2, ptr3, len3);
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
 * Protected request-row rename preserving the resolver's version fields.
 * @param {Uint8Array} master_key
 * @param {string} item_id
 * @param {number} pin
 * @param {Uint8Array} version_id
 * @param {number} version_counter
 * @param {string} filename
 * @param {string | null} [mime_type]
 * @returns {string}
 */
export function sealRequestRenameWithVersion(master_key, item_id, pin, version_id, version_counter, filename, mime_type) {
    let deferred7_0;
    let deferred7_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArray8ToWasm0(master_key, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(item_id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArray8ToWasm0(version_id, wasm.__wbindgen_export);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passStringToWasm0(filename, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len3 = WASM_VECTOR_LEN;
        var ptr4 = isLikeNone(mime_type) ? 0 : passStringToWasm0(mime_type, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        var len4 = WASM_VECTOR_LEN;
        wasm.sealRequestRenameWithVersion(retptr, ptr0, len0, ptr1, len1, pin, ptr2, len2, version_counter, ptr3, len3, ptr4, len4);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
        var ptr6 = r0;
        var len6 = r1;
        if (r3) {
            ptr6 = 0; len6 = 0;
            throw takeObject(r2);
        }
        deferred7_0 = ptr6;
        deferred7_1 = len6;
        return getStringFromWasm0(ptr6, len6);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        wasm.__wbindgen_export4(deferred7_0, deferred7_1, 1);
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
 * Approve a claimed file invite later: `shareApproveFileInviteRequest(inviteId, fileId,
 * recipientPublicKeyB64, masterKey, fileKey, expectedPeerFingerprint)` returns
 * `{request, recipientPublicKey}` (hex: the exact key sealed to). `expectedPeerFingerprint` is
 * REQUIRED (32 bytes, or empty = not compared). After `peer_key_changed` and "share anyway", pass
 * the key the refusal carried and the fingerprint of those bytes, never a re-fetched key.
 * @param {string} invite_id
 * @param {string} file_id
 * @param {string} recipient_public_key_b64
 * @param {Uint8Array} master_key
 * @param {Uint8Array} file_key
 * @param {Uint8Array} expected_peer_fingerprint
 * @returns {any}
 */
export function shareApproveFileInviteRequest(invite_id, file_id, recipient_public_key_b64, master_key, file_key, expected_peer_fingerprint) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passStringToWasm0(invite_id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(file_id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(recipient_public_key_b64, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passArray8ToWasm0(master_key, wasm.__wbindgen_export);
        const len3 = WASM_VECTOR_LEN;
        const ptr4 = passArray8ToWasm0(file_key, wasm.__wbindgen_export);
        const len4 = WASM_VECTOR_LEN;
        const ptr5 = passArray8ToWasm0(expected_peer_fingerprint, wasm.__wbindgen_export);
        const len5 = WASM_VECTOR_LEN;
        wasm.shareApproveFileInviteRequest(retptr, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4, ptr5, len5);
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
 * `shareCreateBundle(appUrl, fileIds, positions, fileKeys, masterKey, expiresInHours?, maxOpens?, passphrase?)`:
 * a `ShareCreateLink` over an ordered set of files (web's bundle branch). `fileKeys` is the
 * concatenation of each item's 32-byte key, in the order of `fileIds`.
 * @param {string} app_url
 * @param {string[]} file_ids
 * @param {Uint32Array} positions
 * @param {Uint8Array} file_keys
 * @param {Uint8Array} master_key
 * @param {number | null} [expires_in_hours]
 * @param {number | null} [max_opens]
 * @param {string | null} [passphrase]
 * @returns {ShareCreateLink}
 */
export function shareCreateBundle(app_url, file_ids, positions, file_keys, master_key, expires_in_hours, max_opens, passphrase) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passStringToWasm0(app_url, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayJsValueToWasm0(file_ids, wasm.__wbindgen_export);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArray32ToWasm0(positions, wasm.__wbindgen_export);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passArray8ToWasm0(file_keys, wasm.__wbindgen_export);
        const len3 = WASM_VECTOR_LEN;
        const ptr4 = passArray8ToWasm0(master_key, wasm.__wbindgen_export);
        const len4 = WASM_VECTOR_LEN;
        var ptr5 = isLikeNone(passphrase) ? 0 : passStringToWasm0(passphrase, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        var len5 = WASM_VECTOR_LEN;
        wasm.shareCreateBundle(retptr, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4, isLikeNone(expires_in_hours) ? 0x100000001 : (expires_in_hours) >>> 0, isLikeNone(max_opens) ? 0x100000001 : (max_opens) >>> 0, ptr5, len5);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        if (r2) {
            throw takeObject(r1);
        }
        return ShareCreateLink.__wrap(r0);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * Decode a `#key=` value as bytes, accepting standard base64 (legacy links) and
 * base64url (current links), padded or unpadded; `null` when it is neither.
 * @param {string} key
 * @returns {any}
 */
export function shareKeyBytes(key) {
    const ptr0 = passStringToWasm0(key, wasm.__wbindgen_export, wasm.__wbindgen_export2);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.shareKeyBytes(ptr0, len0);
    return takeObject(ret);
}

/**
 * The recipient side of a person share.
 * @param {Uint8Array} master_key
 * @param {Uint8Array} owner_public_key
 * @param {string} file_id
 * @param {Uint8Array} sealed
 * @returns {Uint8Array}
 */
export function shareOpenMemberFileKey(master_key, owner_public_key, file_id, sealed) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArray8ToWasm0(master_key, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(owner_public_key, wasm.__wbindgen_export);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(file_id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passArray8ToWasm0(sealed, wasm.__wbindgen_export);
        const len3 = WASM_VECTOR_LEN;
        wasm.shareOpenMemberFileKey(retptr, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3);
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
 * [`share_rebuild_link`] for a bundle (no single wrapped file key).
 * @param {string} app_url
 * @param {Uint8Array} master_key
 * @param {string | null} [owner_wrapped_key]
 * @param {string | null} [owner_wrapped_token]
 * @returns {string | undefined}
 */
export function shareRebuildBundleLink(app_url, master_key, owner_wrapped_key, owner_wrapped_token) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passStringToWasm0(app_url, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(master_key, wasm.__wbindgen_export);
        const len1 = WASM_VECTOR_LEN;
        var ptr2 = isLikeNone(owner_wrapped_key) ? 0 : passStringToWasm0(owner_wrapped_key, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        var len2 = WASM_VECTOR_LEN;
        var ptr3 = isLikeNone(owner_wrapped_token) ? 0 : passStringToWasm0(owner_wrapped_token, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        var len3 = WASM_VECTOR_LEN;
        wasm.shareRebuildBundleLink(retptr, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
        if (r3) {
            throw takeObject(r2);
        }
        let v5;
        if (r0 !== 0) {
            v5 = getStringFromWasm0(r0, r1).slice();
            wasm.__wbindgen_export4(r0, r1 * 1, 1);
        }
        return v5;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * Web `rebuildFolderLinkUrl` in core: the owner's folder link, or `undefined`.
 * @param {string} app_url
 * @param {Uint8Array} master_key
 * @param {string} share_id
 * @param {string | null | undefined} owner_wrapped_key
 * @param {string | null | undefined} owner_wrapped_token
 * @param {string | null | undefined} wrapped_folder_key
 * @param {boolean} passphrase_protected
 * @returns {string | undefined}
 */
export function shareRebuildFolderLink(app_url, master_key, share_id, owner_wrapped_key, owner_wrapped_token, wrapped_folder_key, passphrase_protected) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passStringToWasm0(app_url, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(master_key, wasm.__wbindgen_export);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(share_id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len2 = WASM_VECTOR_LEN;
        var ptr3 = isLikeNone(owner_wrapped_key) ? 0 : passStringToWasm0(owner_wrapped_key, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        var len3 = WASM_VECTOR_LEN;
        var ptr4 = isLikeNone(owner_wrapped_token) ? 0 : passStringToWasm0(owner_wrapped_token, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        var len4 = WASM_VECTOR_LEN;
        var ptr5 = isLikeNone(wrapped_folder_key) ? 0 : passStringToWasm0(wrapped_folder_key, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        var len5 = WASM_VECTOR_LEN;
        wasm.shareRebuildFolderLink(retptr, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4, ptr5, len5, passphrase_protected);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
        if (r3) {
            throw takeObject(r2);
        }
        let v7;
        if (r0 !== 0) {
            v7 = getStringFromWasm0(r0, r1).slice();
            wasm.__wbindgen_export4(r0, r1 * 1, 1);
        }
        return v7;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * The owner's working link from a share's owner blobs; `undefined` when it can't be rebuilt.
 * `wrappedFileKey` (the link's stored `wrapped_file_key`, required) must open under the rebuilt link
 * key. A bundle uses `shareRebuildBundleLink`.
 * @param {string} app_url
 * @param {Uint8Array} master_key
 * @param {string | null | undefined} owner_wrapped_key
 * @param {string | null | undefined} owner_wrapped_token
 * @param {string} wrapped_file_key
 * @returns {string | undefined}
 */
export function shareRebuildLink(app_url, master_key, owner_wrapped_key, owner_wrapped_token, wrapped_file_key) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passStringToWasm0(app_url, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(master_key, wasm.__wbindgen_export);
        const len1 = WASM_VECTOR_LEN;
        var ptr2 = isLikeNone(owner_wrapped_key) ? 0 : passStringToWasm0(owner_wrapped_key, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        var len2 = WASM_VECTOR_LEN;
        var ptr3 = isLikeNone(owner_wrapped_token) ? 0 : passStringToWasm0(owner_wrapped_token, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        var len3 = WASM_VECTOR_LEN;
        const ptr4 = passStringToWasm0(wrapped_file_key, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len4 = WASM_VECTOR_LEN;
        wasm.shareRebuildLink(retptr, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
        if (r3) {
            throw takeObject(r2);
        }
        let v6;
        if (r0 !== 0) {
            v6 = getStringFromWasm0(r0, r1).slice();
            wasm.__wbindgen_export4(r0, r1 * 1, 1);
        }
        return v6;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * `shareSafetyNumber(masterKey, ownUserId, peerUserId, peerPublicKey)` →
 * `{ digits: "60 digits", peerFingerprint: "<SHA-256 of the peer key, hex>" }`. The own sharing
 * key is derived from the master key in core; `peerPublicKey` is the key the share was sealed to.
 * @param {Uint8Array} master_key
 * @param {string} own_user_id
 * @param {string} peer_user_id
 * @param {Uint8Array} peer_public_key
 * @returns {any}
 */
export function shareSafetyNumber(master_key, own_user_id, peer_user_id, peer_public_key) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArray8ToWasm0(master_key, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(own_user_id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(peer_user_id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passArray8ToWasm0(peer_public_key, wasm.__wbindgen_export);
        const len3 = WASM_VECTOR_LEN;
        wasm.shareSafetyNumber(retptr, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3);
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
 * @param {Uint8Array} wrap_key
 * @param {Uint8Array} wrapped
 * @returns {Uint8Array}
 */
export function shareUnwrapKey(wrap_key, wrapped) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArray8ToWasm0(wrap_key, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(wrapped, wasm.__wbindgen_export);
        const len1 = WASM_VECTOR_LEN;
        wasm.shareUnwrapKey(retptr, ptr0, len0, ptr1, len1);
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
 * Web's `wrapKeyForShare` in core: `nonce(12) || ciphertext`, no AAD.
 * @param {Uint8Array} wrap_key
 * @param {Uint8Array} plaintext
 * @returns {Uint8Array}
 */
export function shareWrapKey(wrap_key, plaintext) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArray8ToWasm0(wrap_key, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(plaintext, wasm.__wbindgen_export);
        const len1 = WASM_VECTOR_LEN;
        wasm.shareWrapKey(retptr, ptr0, len0, ptr1, len1);
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
 * The request for the server's sign-up policy (`GET /api/v1/onboarding`).
 * @returns {any}
 */
export function signupPolicyRequest() {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        wasm.signupPolicyRequest(retptr);
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
 * Where `bytes` falls against one variant's budgets: `"target"` (at or below
 * `target_bytes`, stop the ladder), `"fallback"` (above target but at or below
 * `max_bytes`, keep it and keep trying) or `"rejected"` (above `max_bytes`).
 * @param {string} variant
 * @param {number} bytes
 * @returns {string}
 */
export function thumbnailBudget(variant, bytes) {
    let deferred3_0;
    let deferred3_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passStringToWasm0(variant, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        wasm.thumbnailBudget(retptr, ptr0, len0, bytes);
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
 * The encoder output a variant asks for on `platform`: `"heic"` on iOS and
 * macOS (the OS owns the encoder), `"webp"` everywhere else.
 * @param {string} variant
 * @param {string} platform
 * @returns {string}
 */
export function thumbnailFormat(variant, platform) {
    let deferred4_0;
    let deferred4_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passStringToWasm0(variant, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(platform, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len1 = WASM_VECTOR_LEN;
        wasm.thumbnailFormat(retptr, ptr0, len0, ptr1, len1);
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
 * The policy for one variant (`small`, `medium`, `large`):
 * `{ variant, target_px, target_bytes, max_bytes, steps }`, where each step is
 * `{ max_dimension, quality }`.
 * @param {string} variant
 * @returns {any}
 */
export function thumbnailPolicy(variant) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passStringToWasm0(variant, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        wasm.thumbnailPolicy(retptr, ptr0, len0);
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
 * Open a link label; one key, one shape. Returns the label in NFC (a non-NFC
 * plaintext is normalized, not refused); invalid UTF-8 or a label outside
 * 1..40 Unicode scalar values after NFC is a decryption failure.
 * @param {Uint8Array} master_key
 * @param {string} share_id
 * @param {Uint8Array} wrapped
 * @returns {string}
 */
export function unwrapLinkLabel(master_key, share_id, wrapped) {
    let deferred5_0;
    let deferred5_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArray8ToWasm0(master_key, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(share_id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArray8ToWasm0(wrapped, wasm.__wbindgen_export);
        const len2 = WASM_VECTOR_LEN;
        wasm.unwrapLinkLabel(retptr, ptr0, len0, ptr1, len1, ptr2, len2);
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
 * Seal a link label to the owner's master key, bound to the 16-byte share id.
 * Wire = nonce(12) || ciphertext+tag, like the L6 wraps.
 * @param {Uint8Array} master_key
 * @param {string} share_id
 * @param {string} label
 * @returns {Uint8Array}
 */
export function wrapLinkLabel(master_key, share_id, label) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArray8ToWasm0(master_key, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(share_id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(label, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len2 = WASM_VECTOR_LEN;
        wasm.wrapLinkLabel(retptr, ptr0, len0, ptr1, len1, ptr2, len2);
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
        __wbg___wbindgen_is_null_52ff4ec04186736f: function(arg0) {
            const ret = getObject(arg0) === null;
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
        __wbg_getRandomValues_199b54f9af05e3df: function() { return handleError(function (arg0, arg1) {
            globalThis.crypto.getRandomValues(getArrayU8FromWasm0(arg0, arg1));
        }, arguments); },
        __wbg_getRandomValues_76dfc69825c9c552: function() { return handleError(function (arg0, arg1) {
            globalThis.crypto.getRandomValues(getArrayU8FromWasm0(arg0, arg1));
        }, arguments); },
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
        __wbg_wasmextractionplan_new: function(arg0) {
            const ret = WasmExtractionPlan.__wrap(arg0);
            return addHeapObject(ret);
        },
        __wbg_wasmrequestcontentreader_new: function(arg0) {
            const ret = WasmRequestContentReader.__wrap(arg0);
            return addHeapObject(ret);
        },
        __wbg_wasmsignedurl_new: function(arg0) {
            const ret = WasmSignedUrl.__wrap(arg0);
            return addHeapObject(ret);
        },
        __wbg_wasmwritetarget_new: function(arg0) {
            const ret = WasmWriteTarget.__wrap(arg0);
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

const AccountFlowFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_accountflow_free(ptr >>> 0, 1));
const AuthApprovalFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_authapproval_free(ptr >>> 0, 1));
const AuthDeviceRequestFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_authdevicerequest_free(ptr >>> 0, 1));
const AuthSignInFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_authsignin_free(ptr >>> 0, 1));
const AuthStepUpFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_authstepup_free(ptr >>> 0, 1));
const ClientMetaKeyFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_clientmetakey_free(ptr >>> 0, 1));
const PhraseRecoveryFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_phraserecovery_free(ptr >>> 0, 1));
const ShareCreateLinkFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_sharecreatelink_free(ptr >>> 0, 1));
const ShareCreateRequestFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_sharecreaterequest_free(ptr >>> 0, 1));
const ShareFolderInviteFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_sharefolderinvite_free(ptr >>> 0, 1));
const ShareMemberInviteFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_sharememberinvite_free(ptr >>> 0, 1));
const SignupFlowFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_signupflow_free(ptr >>> 0, 1));
const WasmAccountKeyMaterialFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmaccountkeymaterial_free(ptr >>> 0, 1));
const WasmArchiveExtractionFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmarchiveextraction_free(ptr >>> 0, 1));
const WasmArchiveSessionFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmarchivesession_free(ptr >>> 0, 1));
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
const WasmExtractionPlanFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmextractionplan_free(ptr >>> 0, 1));
const WasmNewDeviceLinkFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmnewdevicelink_free(ptr >>> 0, 1));
const WasmNewItemIdFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmnewitemid_free(ptr >>> 0, 1));
const WasmRequestContentReaderFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmrequestcontentreader_free(ptr >>> 0, 1));
const WasmSearchIndexFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmsearchindex_free(ptr >>> 0, 1));
const WasmSignedUrlFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmsignedurl_free(ptr >>> 0, 1));
const WasmSignupCeremonyFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmsignupceremony_free(ptr >>> 0, 1));
const WasmStorageBodyFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmstoragebody_free(ptr >>> 0, 1));
const WasmTypedApprovalFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmtypedapproval_free(ptr >>> 0, 1));
const WasmTypedReceiverFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmtypedreceiver_free(ptr >>> 0, 1));
const WasmWriteTargetFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmwritetarget_free(ptr >>> 0, 1));

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

function passArrayJsValueToWasm0(array, malloc) {
    const ptr = malloc(array.length * 4, 4) >>> 0;
    const mem = getDataViewMemory0();
    for (let i = 0; i < array.length; i++) {
        mem.setUint32(ptr + 4 * i, addHeapObject(array[i]), true);
    }
    WASM_VECTOR_LEN = array.length;
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
