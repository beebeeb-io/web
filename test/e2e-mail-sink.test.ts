// The e2e signup mail-sink helper reads the isolated API's console-mail log (e2e/helpers/mail-sink.ts).
// The server masks the recipient (task 1901: `<8 hex>~<domain>`) and words the code mail
// differently from when the helper was written; both log shapes must be read.
import { describe, expect, test } from 'bun:test'
import {
  blockIsTo,
  extractAllSignupCodes,
  extractSignupCode,
  extractSignupExistsEmail,
} from '../e2e/helpers/mail-sink'

const block = (to: string, subject: string, body: string) =>
  `INFO beebeeb_api::email\n--- EMAIL (console mode) ---\nFrom: Beebeeb <noreply@beebeeb.io>\nTo: ${to}\nSubject: ${subject}\nReply-To: support@beebeeb.io\n\n${body}\n--- END EMAIL ---\n`

const CURRENT_CODE = (to: string, code: string) =>
  block(
    to,
    'Verify your email for Beebeeb',
    `Verify your email\n\nEnter the code below to verify your Beebeeb account:\n\n${code}\n\nThis code expires in 15 minutes.`,
  )
const OLD_CODE = (to: string, code: string) =>
  block(to, 'Verify your email', `Enter this code to verify your Beebeeb account: ${code}`)

describe('e2e mail sink', () => {
  test('reads the current wording with a masked recipient', () => {
    const log = CURRENT_CODE('3fa9c01e~beebeeb.io', '48151623')
    expect(extractSignupCode(log, 'e2e-1-abc@beebeeb.io')).toBe('48151623')
  })

  test('reads the old wording with the full recipient', () => {
    const log = OLD_CODE('e2e-1-abc@beebeeb.io', '11223344')
    expect(extractSignupCode(log, 'e2e-1-abc@beebeeb.io')).toBe('11223344')
  })

  test('takes the most recent code for the address and lists every distinct one', () => {
    const log = CURRENT_CODE('3fa9c01e~beebeeb.io', '10000001') + CURRENT_CODE('3fa9c01e~beebeeb.io', '10000002')
    expect(extractSignupCode(log, 'e2e-1-abc@beebeeb.io')).toBe('10000002')
    expect(extractAllSignupCodes(log, 'e2e-1-abc@beebeeb.io')).toEqual(['10000001', '10000002'])
  })

  test('never matches another domain or a non-address', () => {
    const log = CURRENT_CODE('3fa9c01e~example.org', '48151623')
    expect(extractSignupCode(log, 'e2e-1-abc@beebeeb.io')).toBeNull()
    expect(blockIsTo(log, 'not-an-address')).toBe(false)
    // A domain is matched literally, not as a regex: `beebeeb.io` must not match `beebeebxio`.
    expect(blockIsTo(CURRENT_CODE('3fa9c01e~beebeebxio', '1'), 'a@beebeeb.io')).toBe(false)
  })

  test('reads the sign-in link of the "already have an account" mail in both wordings', () => {
    const current = block(
      '0badc0de~beebeeb.io',
      'You already have a Beebeeb account',
      "You already have an account\n\nSomeone (hopefully you) tried to sign up. You already have an account: sign in instead, or reset your password if you've forgotten it.\n\nSign in: http://localhost:5173/login?email=x\n",
    )
    expect(extractSignupExistsEmail(current, 'x@beebeeb.io')).toEqual({
      subject: 'You already have a Beebeeb account',
      signinUrl: 'http://localhost:5173/login?email=x',
    })
    const old = block(
      'x@beebeeb.io',
      'Sign-up attempt',
      'You already have an account. Sign in, or reset it if you have forgotten it: http://localhost:5173/login\n',
    )
    expect(extractSignupExistsEmail(old, 'x@beebeeb.io')?.signinUrl).toBe('http://localhost:5173/login')
  })
})
