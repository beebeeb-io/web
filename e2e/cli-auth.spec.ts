import { test, expect } from '@playwright/test';
import { authenticator } from 'otplib';

// These come from CI secrets. For local runs, export them in your shell.
const TEST_EMAIL = process.env.CLI_AUTH_TEST_EMAIL ?? 'cli-auth-test@beebeeb.io';
const TEST_PASSWORD = process.env.CLI_AUTH_TEST_PASSWORD ?? '';
const TEST_TOTP_SECRET = process.env.CLI_AUTH_TEST_TOTP_SECRET ?? '';

test.describe('CLI auth — TOTP gate', () => {
  test.skip(
    !TEST_PASSWORD || !TEST_TOTP_SECRET,
    'Set CLI_AUTH_TEST_PASSWORD and CLI_AUTH_TEST_TOTP_SECRET to run this spec.',
  );

  test('redirects unsigned visitor through TOTP back to /cli-auth?code=...', async ({
    page,
    baseURL,
  }) => {
    // We use a synthetic code value that the server has never issued. The
    // confirmation page should still render up to the point where it would
    // POST to /api/v1/auth/cli-authorize, which is where we stop (that POST
    // requires a real CLI-issued code).
    const code = 'TEST-DUMMY';

    await page.goto(`${baseURL}/cli-auth?code=${code}`);

    // Unauthenticated → bounce to /login with a redirect param.
    await expect(page).toHaveURL(/\/login(\?.*)?$/);

    // Step 1: email + password.
    await page.getByLabel(/email/i).fill(TEST_EMAIL);
    await page.getByLabel(/password/i).fill(TEST_PASSWORD);
    await page.getByRole('button', { name: /sign in|log in/i }).click();

    // Step 2: TOTP prompt.
    const otp = authenticator.generate(TEST_TOTP_SECRET);
    await page.getByLabel(/code|two-factor|2fa|totp/i).fill(otp);
    await page.getByRole('button', { name: /verify|continue/i }).click();

    // Step 3: redirected back to the CLI confirmation page.
    await page.waitForURL(new RegExp(`/cli-auth\\?code=${code}`));
    await expect(page.getByText(code)).toBeVisible();
  });
});
