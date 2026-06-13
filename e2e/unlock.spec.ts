import { test, expect } from '@playwright/test';
import { anonymousContext } from './helpers/auth';

const EVID = '../../.claude/tasks/_qa-evidence/0764';

// 0764A — the public /unlock/:token page. A locked-out user is logged OUT, so we
// use anonymousContext (empty storageState — also avoids the 0740a authed-cookie
// inheritance) + block /dev/auto-login so the harness can't silently re-auth.

test('invalid/expired unlock token → honest non-enumerating failure state', async ({ browser }) => {
  const ctx = await anonymousContext(browser);
  const page = await ctx.newPage();
  await page.route('**/dev/auto-login', (r) => r.fulfill({ status: 404 }));
  // Real POST to the harness backend: an unknown token redeems to {unlocked:false}.
  await page.goto('/unlock/definitely-not-a-real-unlock-token');
  await expect(page.getByText(/unlock link didn.?t work/i)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/lifts on its own/i)).toBeVisible();
  await expect(page.getByRole('link', { name: /sign in/i })).toBeVisible();
  await page.screenshot({ path: `${EVID}/unlock-failed.png` });
  await ctx.close();
});

test('valid unlock token → unlocked state + sign-in link', async ({ browser }) => {
  const ctx = await anonymousContext(browser);
  const page = await ctx.newPage();
  await page.route('**/dev/auto-login', (r) => r.fulfill({ status: 404 }));
  // The redeem-success path: server returns {unlocked:true}. (Minting a real
  // lockout token is the server's redeem_unlock_token integration test; here we
  // assert the page POSTs and renders the success branch.)
  await page.route('**/api/v1/auth/unlock', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{"unlocked":true}' }));
  await page.goto('/unlock/a-valid-token');
  await expect(page.getByText(/your account is unlocked/i)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('link', { name: /^sign in$/i })).toBeVisible();
  await page.screenshot({ path: `${EVID}/unlock-success.png` });
  await ctx.close();
});
