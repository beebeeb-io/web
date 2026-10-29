/**
 * Copy and links for the account-stage Terms prompt and for steps this build
 * cannot draw (task 1822). Plain strings, no React: the drive banner and the
 * account page share them, and the unit tests pin them.
 */

/** Same pages `policy.terms.url` / `privacy_url` name in the pre-account document. */
export const TERMS_URL = 'https://beebeeb.io/terms'
export const PRIVACY_URL = 'https://beebeeb.io/privacy'

/**
 * What we say when the server lists a required account step this build cannot
 * draw. Honest and short: nothing is blocked, the step is named, and there is no
 * "Continue on the web" because this IS the web (the P0 of 2026-10-06).
 */
export function unsupportedStepNotice(ids: readonly string[]): string {
  const list = ids.join(', ')
  return ids.length === 1
    ? `Your account lists a step this version of Beebeeb cannot show yet (${list}). Your files are not affected. Reload the page to pick up the latest version.`
    : `Your account lists steps this version of Beebeeb cannot show yet (${list}). Your files are not affected. Reload the page to pick up the latest version.`
}
