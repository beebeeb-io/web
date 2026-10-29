import { useMemo } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { OnboardingRenderer } from '../components/onboarding/renderer'
import { AccountCreatedSetupFailed } from '../components/onboarding/signup-flow'
import { coreCeremonyPorts, ActionError, type OnboardingPorts } from '../lib/onboarding/ports'
import { parseOnboardingDocument } from '../lib/onboarding/parse'

/**
 * Dev-only fixture harness for the onboarding renderer (task 1745).
 *
 * `/dev/onboarding/<fixture-name>` renders one golden document from
 * `src/contracts/onboarding/fixtures/` through the SAME `OnboardingRenderer`
 * the live signup uses. Side effects are stubbed, with one exception: the
 * password policy, breach gate and recovery-phrase ceremony run on the real
 * core WASM, so a screenshot of the phrase step shows a real phrase from core.
 *
 * Fixture behaviour (documented because a spec relies on it):
 *   - email-start always succeeds (identical 202, spec 5.9);
 *   - the email code `12345678` is accepted, anything else is `wrong_code`;
 *   - the breach endpoint answers offline from a one-password corpus: the
 *     password `Breached-Password-1` is listed (4242 hits), everything else is
 *     clean. `?breach=down` makes the endpoint fail instead (an outage, so the
 *     document's fail_open decides). `?failopen=0` rewrites the document to
 *     `fail_open: false` (the fixtures all say true), to exercise the blocking path;
 *   - register-start fails with `fixture_mode`: there is no server here;
 *   - `?client=update_required` rewrites the document's client status (an
 *     account-stage document then shows Sign out, which logs `sign_out`);
 *   - `?screen=account_created_setup_failed` draws the post-commit recovery
 *     screen directly (it needs a server-side failure to reach for real; the
 *     branch itself is covered by test/1745-onboarding-create-account.test.ts).
 *
 * Mounted only under `import.meta.env.DEV` (see `app.tsx`), never in a build.
 */

const FIXTURES = import.meta.glob('../contracts/onboarding/fixtures/*.json', {
  eager: true,
  import: 'default',
}) as Record<string, unknown>

export function fixtureNames(): string[] {
  return Object.keys(FIXTURES).map((p) => p.split('/').pop()!.replace(/\.json$/, ''))
}

/** Test corpus: the one breached password this page knows about. */
const BREACHED_PASSWORD = 'Breached-Password-1'

async function sha1Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase()
}

async function fixtureBreachBody(prefix: string, down: boolean): Promise<string | null> {
  if (down) return null
  const hash = await sha1Hex(BREACHED_PASSWORD)
  const lines = ['0000000000000000000000000000000000A:0']
  if (hash.startsWith(prefix)) lines.push(`${hash.slice(5)}:4242`)
  return lines.join('\r\n') + '\r\n'
}

function fixturePorts(breachDown: boolean, withSignOut: boolean): OnboardingPorts {
  // One array per page load, shared by any instance React builds (StrictMode
  // invokes useMemo twice in dev; a fresh array per call would orphan the one
  // the spec reads).
  const w = window as unknown as { __onboardingEvents?: string[] }
  const events = (w.__onboardingEvents ??= [])
  return {
    actions: {
      async emailStart(email) {
        events.push(`email_start:${email}`)
      },
      async emailVerify(_email, code) {
        if (code !== '12345678') throw new ActionError('wrong_code', 'wrong code')
        return { ticket: 'fixture-ticket' }
      },
      async registerStart() {
        events.push('register_start')
        throw new ActionError('fixture_mode', 'There is no server on the fixture page.')
      },
      async registerFinish() {
        throw new ActionError('fixture_mode', 'There is no server on the fixture page.')
      },
      async verifyEmail() {
        events.push('verify_email')
      },
      async acceptTerms(version) {
        events.push(`accept_terms:${version}`)
      },
      async startTrial(endpoint) {
        events.push(`start_trial:${endpoint}`)
      },
      async refresh() {
        events.push('refresh')
      },
    },
    ceremony: coreCeremonyPorts,
    fetchBreachBody: async (_endpoint, prefix) => fixtureBreachBody(prefix, breachDown),
    onAccountCreated: async () => {
      events.push('account_created')
    },
    ...(withSignOut
      ? {
          signOut: async () => {
            events.push('sign_out')
          },
        }
      : {}),
  }
}

export function DevOnboardingFixtures() {
  const { fixture } = useParams<{ fixture: string }>()
  const [query] = useSearchParams()
  const breachDown = query.get('breach') === 'down'
  const forceUpdate = query.get('client') === 'update_required'
  const ports = useMemo(() => fixturePorts(breachDown, true), [breachDown])
  const key = Object.keys(FIXTURES).find((p) => p.endsWith(`/${fixture}.json`))
  const parsed = key ? parseOnboardingDocument(FIXTURES[key]) : null

  if (!key || !parsed) {
    return <p data-testid="fixture-missing">No fixture named {fixture}. Known: {fixtureNames().join(', ')}</p>
  }
  if (parsed.ok && query.get('failopen') === '0' && parsed.doc.policy?.password.breachCheck) {
    parsed.doc.policy.password.breachCheck.failOpen = false
  }
  if (query.get('screen') === 'account_created_setup_failed') {
    return (
      <div data-testid="fixture-root" data-fixture={fixture}>
        <AccountCreatedSetupFailed />
      </div>
    )
  }
  if (parsed.ok && forceUpdate) {
    parsed.doc.client = { ...parsed.doc.client, status: 'update_required', minVersion: parsed.doc.client.minVersion ?? '9.9.9' }
  }
  if (!parsed.ok) {
    return (
      <p data-testid="fixture-unparsed" data-reason={parsed.reason}>
        Fixture {fixture} did not parse: {parsed.reason}
      </p>
    )
  }
  return (
    <div data-testid="fixture-root" data-fixture={fixture}>
      <OnboardingRenderer doc={parsed.doc} ports={ports} />
    </div>
  )
}
