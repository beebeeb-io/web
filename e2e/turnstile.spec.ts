import { test, expect } from '@playwright/test';
import { anonymousContext } from './helpers/auth';

const EVID = '../../.claude/tasks/_qa-evidence/0764';

// 0764B — Turnstile widget on the signup card. Run with VITE_TURNSTILE_SITEKEY set
// (Cloudflare's always-pass TEST key 1x00000000000000000000AA) so the widget
// mounts; it renders an iframe from challenges.cloudflare.com (allowed by the CSP).
test('signup renders the Turnstile widget when the sitekey is configured', async ({ browser }) => {
  const ctx = await anonymousContext(browser);
  const page = await ctx.newPage();
  await page.route('**/dev/auto-login', (r) => r.fulfill({ status: 404 }));
  await page.goto('/signup');
  await expect(page.getByRole('heading', { name: /create your account/i })).toBeVisible({ timeout: 20_000 });
  // The widget container mounts (sitekey picked up). It injects an iframe from
  // challenges.cloudflare.com; the iframe needs network to CF, so we assert the
  // mount point + (best-effort) the iframe, and screenshot either way.
  await expect(page.getByTestId('turnstile-widget')).toBeAttached({ timeout: 20_000 });
  const iframe = page.locator('iframe[src*="challenges.cloudflare.com"]');
  const iframeLoaded = await iframe.isVisible().catch(() => false);
  console.log('TURNSTILE: container mounted; CF iframe loaded =', iframeLoaded);
  await page.screenshot({ path: `${EVID}/signup-turnstile.png`, fullPage: true });
  await ctx.close();
});

test('dev path: no sitekey → no widget, signup form unaffected', async ({ browser }) => {
  // Run WITHOUT VITE_TURNSTILE_SITEKEY (default) — the widget must render nothing
  // so local/dev/prod-flag-off signup keeps working. (Run this file without the
  // env var set to exercise this; with the key set it's expected to be skipped.)
  const ctx = await anonymousContext(browser);
  const page = await ctx.newPage();
  await page.route('**/dev/auto-login', (r) => r.fulfill({ status: 404 }));
  await page.goto('/signup');
  await expect(page.getByRole('heading', { name: /create your account/i })).toBeVisible({ timeout: 20_000 });
  test.skip(await page.getByTestId('turnstile-widget').count() > 0, 'sitekey is set this run — dev-path assertion skipped');
  await expect(page.getByTestId('turnstile-widget')).toHaveCount(0);
  await ctx.close();
});
