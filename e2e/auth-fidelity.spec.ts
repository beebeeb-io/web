import { test, expect } from '@playwright/test';
import { anonymousContext } from './helpers/auth';

const API = process.env.E2E_API_URL ?? 'http://localhost:3003';

/**
 * Fidelity guard (task 0740a). The e2e harness MUST reject anonymous requests
 * exactly like prod — otherwise every logged-out-behavior spec is silently
 * masked. That masking is how the 0741 anonymous-401→/login-bounce P0 passed
 * 6/6 e2e for months while broken on prod.
 *
 * The hole was NOT the server (it 401s a token-less request); it was that
 * `browser.newContext()` inherits the authenticated project's storageState, so
 * the "anonymous" context carried the authed `bb_session` cookie (domain bare
 * `localhost`, port-agnostic). `anonymousContext()` overrides that. If this ever
 * 200s again, the harness has regressed back to masking logged-out behavior.
 */
test('a truly-anonymous context gets 401 from /auth/me (prod parity, no masking)', async ({ browser }) => {
  const anon = await anonymousContext(browser);
  const res = await anon.request.get(`${API}/api/v1/auth/me`);
  expect(res.status()).toBe(401);
  await anon.close();
});
