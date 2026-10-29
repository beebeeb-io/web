/**
 * Task 1713 FIX A — the email-based reset entry on the /forgot-password
 * chooser.
 *
 * The 1704 slice-2 browser walk (task 1713, lead evidence 2026-10-02) found
 * the chooser offering only the phrase card (SOON), the other-device card
 * ('Coming soon') and 'I have neither' — NO way to self-serve the email
 * password reset the server already ships (POST /api/v1/auth/forgot-password,
 * verified live: 200 enumeration-safe). This suite pins the new entry:
 *
 *   1. the chooser renders an email input + submit alongside the three
 *      existing cards (which stay byte-for-byte as they are);
 *   2. submitting actually posts {email} to the endpoint — proven at the
 *      HTTP level with a capturing fetch (what leaves the browser), same
 *      pattern as test/1704-set-password-page.test.ts;
 *   3. the success copy is the server's enumeration-safe message VERBATIM,
 *      plus the honest 60-minute set-password-link explanation (server truth:
 *      SET_PASSWORD_TOKEN_TTL_MINUTES = 60, repos/server/beebeeb-api/src/
 *      routes/password.rs:323) and the vault-stays-locked reality;
 *   4. regression pin: the three existing chooser cards are untouched.
 *
 * Harness: renderToStaticMarkup over the real components (this repo has no
 * jsdom/@testing-library — see test/1471's header note). Click wiring and
 * rate-limit UX stay browser-verified (lead-gated rung).
 */
import { afterEach, describe, expect, test } from 'bun:test'
import React from 'react'

// ── capturing fetch — assert at the HTTP level (pattern: 1704 set-password) ──
interface CapturedCall {
  url: string
  method?: string
  headers: Record<string, string>
  body: unknown
}

function capturingFetch(
  calls: CapturedCall[],
  responder: (url: string) => { status: number; body: unknown },
) {
  return (async (url: string, init?: RequestInit) => {
    const headers = (init?.headers as Record<string, string> | undefined) ?? {}
    const body = init?.body ? JSON.parse(init.body as string) : undefined
    calls.push({ url: String(url), method: init?.method, headers, body })
    const { status, body: respBody } = responder(String(url))
    return new Response(JSON.stringify(respBody), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  }) as unknown as typeof fetch
}

const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
})

/** The server's real enumeration-safe 200 body, as verified live in the
 *  1704 walk (task 1713 task file, Notes). */
const ENUM_SAFE_MESSAGE =
  'if an account with that email exists, recovery instructions have been sent'

async function renderChooser(): Promise<string> {
  const { ForgotPassword } = (await import('../src/pages/forgot-password')) as unknown as {
    ForgotPassword: React.FC
  }
  const rr = (await import('react-router-dom')) as unknown as { MemoryRouter: React.FC<{ children?: React.ReactNode }> }
  const { renderToStaticMarkup } = (await import('react-dom/server')) as unknown as {
    renderToStaticMarkup: (n: React.ReactNode) => string
  }
  // Minimal window/document stubs for the modules that touch globals at
  // import/render time (pattern: test/1704-vault-locked-no-key.test.tsx).
  const g = globalThis as Record<string, unknown>
  if (!g.window) {
    g.window = {
      addEventListener() {}, removeEventListener() {},
      location: { href: 'http://localhost/', pathname: '/', search: '', hash: '', origin: 'http://localhost' },
      navigator: { onLine: true, userAgent: 'bun-test' },
      matchMedia: () => ({ matches: false, media: '', addEventListener() {}, removeEventListener() {} }),
    }
    g.navigator = { onLine: true, userAgent: 'bun-test' }
  }
  const html = renderToStaticMarkup(
    React.createElement(rr.MemoryRouter, null, React.createElement(ForgotPassword)),
  )
  return html
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

describe('task 1713 FIX A: the /forgot-password chooser exposes the email reset entry', () => {
  test('the chooser renders the email entry: email input + submit with honest framing', async () => {
    const html = await renderChooser()
    // The entry exists as a real card on the chooser:
    expect(html).toContain('I know my email address')
    expect(html).toContain('type="email"')
    expect(html).toContain('placeholder="you@example.com"')
    expect(html).toContain('Send reset link')
    // Honest framing: a one-time link, and it does NOT decrypt anything.
    expect(html).toContain('one-time link')
    expect(html).toContain('does not decrypt your files')
  })

  test('submitting the email posts {email} to POST /api/v1/auth/forgot-password', async () => {
    const { submitEmailReset } = (await import('../src/pages/forgot-password')) as unknown as {
      submitEmailReset: (email: string) => Promise<string>
    }
    const calls: CapturedCall[] = []
    globalThis.fetch = capturingFetch(calls, () => ({
      status: 200,
      body: { message: ENUM_SAFE_MESSAGE },
    }))

    const message = await submitEmailReset('user@example.com')

    // Exactly one call, to the shipped endpoint, with the email and nothing else.
    expect(calls.length).toBe(1)
    expect(calls[0].url).toContain('/api/v1/auth/forgot-password')
    expect(calls[0].method).toBe('POST')
    expect(calls[0].body).toEqual({ email: 'user@example.com' })
    // The server's enumeration-safe message comes back verbatim — it is the
    // only honest thing to show.
    expect(message).toBe(ENUM_SAFE_MESSAGE)
  })

  test('success copy: the enumeration-safe message verbatim + the 60-minute set-password link + vault-stays-locked reality', async () => {
    const { EmailResetSuccess } = (await import('../src/pages/forgot-password')) as unknown as {
      EmailResetSuccess: React.FC<{ message: string }>
    }
    const rr = (await import('react-router-dom')) as unknown as { MemoryRouter: React.FC<{ children?: React.ReactNode }> }
    const { renderToStaticMarkup } = (await import('react-dom/server')) as unknown as {
      renderToStaticMarkup: (n: React.ReactNode) => string
    }
    const html = renderToStaticMarkup(
      React.createElement(
        rr.MemoryRouter,
        null,
        React.createElement(EmailResetSuccess, { message: ENUM_SAFE_MESSAGE }),
      ),
    )
      .replace(/&#x27;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')

    // The server's message is shown VERBATIM (never paraphrased into a promise):
    expect(html).toContain(ENUM_SAFE_MESSAGE)
    // The link is a one-time set-password page and it expires in 60 minutes
    // (server truth: SET_PASSWORD_TOKEN_TTL_MINUTES = 60):
    expect(html).toContain('60 minutes')
    expect(html).toContain('set a new password')
    // Honest reality: the reset does NOT unlock the vault — the phrase does.
    expect(html).toContain('recovery phrase')
    expect(html).toContain('does not unlock your vault')
    // A way back to sign in:
    expect(html).toContain('href="/login"')
  })

  test('regression pin: the three existing chooser cards are untouched', async () => {
    const html = await renderChooser()
    expect(html).toContain('I have my recovery phrase')
    expect(html).toContain('Recover with phrase')
    expect(html).toContain('Coming soon')
    expect(html).toContain('I have neither')
    expect(html).toContain('Show my options')
    expect(html).toContain('Trouble signing in?')
    expect(html).toContain('Back to sign in')
  })
})