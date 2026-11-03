// WebAuthn passkey helpers: base64url and credential conversion.
import { request, setToken } from '@beebeeb/shared'
import type { LoginResult, PasskeyInfo, PasskeyLoginStartResponse, PasskeyRegisterStartResponse } from '@beebeeb/shared'

// ─── WebAuthn base64url helpers ──────────────────

/** Decode a base64url string to an ArrayBuffer. */
export function base64urlToBuffer(base64url: string): ArrayBuffer {
  // Restore standard base64 characters and padding
  let base64 = base64url.replace(/-/g, '+').replace(/_/g, '/')
  while (base64.length % 4 !== 0) base64 += '='
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes.buffer
}

/** Encode an ArrayBuffer to a base64url string (no padding). */
export function bufferToBase64url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * The server (webauthn-rs) serialises binary fields as base64url strings.
 * The browser WebAuthn API expects ArrayBuffers. This converts the server's
 * CreationChallengeResponse.publicKey into a browser-compatible object.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function serverOptsToCreateOptions(publicKey: any): PublicKeyCredentialCreationOptions {
  // webauthn-rs wraps options in a publicKey field; unwrap if present
  const pk = publicKey.challenge ? publicKey : publicKey.publicKey
  const opts: PublicKeyCredentialCreationOptions = {
    ...pk,
    challenge: base64urlToBuffer(pk.challenge),
    user: {
      ...pk.user,
      id: base64urlToBuffer(pk.user.id),
    },
  }
  if (pk.excludeCredentials) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    opts.excludeCredentials = pk.excludeCredentials.map((cred: any) => ({
      ...cred,
      id: base64urlToBuffer(cred.id),
    }))
  }
  return opts
}

/**
 * The server (webauthn-rs) serialises binary fields as base64url strings.
 * The browser WebAuthn API expects ArrayBuffers. This converts the server's
 * RequestChallengeResponse.publicKey into a browser-compatible object.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function serverOptsToGetOptions(publicKey: any): PublicKeyCredentialRequestOptions {
  // webauthn-rs wraps options in a publicKey field; unwrap if present
  const pk = publicKey.challenge ? publicKey : publicKey.publicKey
  const opts: PublicKeyCredentialRequestOptions = {
    ...pk,
    challenge: base64urlToBuffer(pk.challenge),
  }
  if (pk.allowCredentials) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    opts.allowCredentials = pk.allowCredentials.map((cred: any) => ({
      ...cred,
      id: base64urlToBuffer(cred.id),
    }))
  }
  return opts
}

/**
 * Convert a browser PublicKeyCredential (from navigator.credentials.create)
 * into the JSON shape expected by webauthn-rs RegisterPublicKeyCredential.
 */
export function credentialToRegistrationJSON(credential: PublicKeyCredential): {
  id: string
  rawId: string
  type: string
  response: {
    attestationObject: string
    clientDataJSON: string
  }
  extensions: AuthenticationExtensionsClientOutputs
} {
  const response = credential.response as AuthenticatorAttestationResponse
  return {
    id: credential.id,
    rawId: bufferToBase64url(credential.rawId),
    type: credential.type,
    response: {
      attestationObject: bufferToBase64url(response.attestationObject),
      clientDataJSON: bufferToBase64url(response.clientDataJSON),
    },
    extensions: credential.getClientExtensionResults(),
  }
}

/**
 * Convert a browser PublicKeyCredential (from navigator.credentials.get)
 * into the JSON shape expected by webauthn-rs PublicKeyCredential.
 */
export function credentialToAuthenticationJSON(credential: PublicKeyCredential): {
  id: string
  rawId: string
  type: string
  response: {
    authenticatorData: string
    clientDataJSON: string
    signature: string
    userHandle: string | null
  }
  extensions: AuthenticationExtensionsClientOutputs
} {
  const response = credential.response as AuthenticatorAssertionResponse
  return {
    id: credential.id,
    rawId: bufferToBase64url(credential.rawId),
    type: credential.type,
    response: {
      authenticatorData: bufferToBase64url(response.authenticatorData),
      clientDataJSON: bufferToBase64url(response.clientDataJSON),
      signature: bufferToBase64url(response.signature),
      userHandle: response.userHandle ? bufferToBase64url(response.userHandle) : null,
    },
    extensions: credential.getClientExtensionResults(),
  }
}

/**
 * POST /api/v1/auth/passkey/register-start — task 1493 (P0 security fix):
 * the server now requires a FRESH step-up proof before it will issue a
 * registration challenge at all (a bare session can no longer add a
 * persistent sign-in passkey on its own). `confirmToken` is the single-use
 * `X-Confirm-Token` minted by `confirmAction()` (password/OPAQUE) or
 * `confirmPasskey()` (for passkey-only accounts) — same header pattern as
 * `requestDataExport`. Without it the server 403s
 * `{"error":"confirmation_required"}`.
 */
export async function startPasskeyRegistration(confirmToken: string): Promise<PasskeyRegisterStartResponse> {
  return request<PasskeyRegisterStartResponse>('/api/v1/auth/passkey/register-start', {
    method: 'POST',
    headers: { 'X-Confirm-Token': confirmToken },
  })
}

/**
 * POST /api/v1/auth/passkey/register-finish — task 1493: the server holds
 * the registration challenge itself now (single-use, bound to the caller),
 * so the client sends back only the opaque `reg_id` it got from
 * `startPasskeyRegistration`, never the WebAuthn state itself (was
 * `reg_state: string`).
 */
export async function finishPasskeyRegistration(
  credential: ReturnType<typeof credentialToRegistrationJSON>,
  regId: string,
  name?: string,
): Promise<PasskeyInfo> {
  return request<PasskeyInfo>('/api/v1/auth/passkey/register-finish', {
    method: 'POST',
    body: JSON.stringify({ credential, reg_id: regId, name }),
  })
}

export async function startPasskeyLogin(email: string): Promise<PasskeyLoginStartResponse> {
  return request<PasskeyLoginStartResponse>('/api/v1/auth/passkey/login-start', {
    method: 'POST',
    body: JSON.stringify({ email }),
  })
}

export async function finishPasskeyLogin(
  credential: ReturnType<typeof credentialToAuthenticationJSON>,
  authState: string,
  userId: string,
): Promise<LoginResult> {
  const data = await request<LoginResult>('/api/v1/auth/passkey/login-finish', {
    method: 'POST',
    body: JSON.stringify({ credential, auth_state: authState, user_id: userId }),
  })
  if (data.session_token) {
    setToken(data.session_token)
  }
  return data
}

// ─── Passkey management endpoints ────────────────

export async function listPasskeys(): Promise<PasskeyInfo[]> {
  const data = await request<{ passkeys: PasskeyInfo[] }>('/api/v1/auth/passkeys')
  return data.passkeys
}

export async function deletePasskey(id: string): Promise<void> {
  await request<void>(`/api/v1/auth/passkeys/${id}`, { method: 'DELETE' })
}
