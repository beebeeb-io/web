import type { BreachCheckProxy, BreachVerdict } from '../crypto'
import type { OnboardingPorts } from './ports'

/**
 * The one host-side call of the breach gate (task 1795). The prefix is read
 * ONCE and the same value goes into the request URL and into
 * `evaluate(requestedPrefix, ...)`: core compares them and throws
 * `breach_prefix_mismatch` (a `CeremonyError`, recorded as nothing) rather
 * than letting a body fetched for another prefix read as "clean".
 *
 * An invalid or missing endpoint counts as an outage: null body, and core
 * applies the document's fail_open (the ceremony enforces it).
 */
export async function runBreachCheck(
  ports: Pick<OnboardingPorts, 'fetchBreachBody'>,
  breach: Pick<BreachCheckProxy, 'prefix' | 'evaluate'>,
  bc: { endpoint?: string | null; failOpen: boolean },
): Promise<BreachVerdict> {
  const prefix = breach.prefix
  const body = bc.endpoint ? await ports.fetchBreachBody(bc.endpoint, prefix) : null
  return breach.evaluate(prefix, body, bc.failOpen)
}
