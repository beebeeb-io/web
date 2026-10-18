import { createContext, useContext, type ReactNode } from 'react'

/**
 * How dense the shared controls render (admin redesign 2018 / S1).
 *
 * - `comfortable` (default): the web app's controls, unchanged.
 * - `compact`: the admin "Component kit" (design/admin-redesign-2026-10/Kit-*.dc.html):
 *   denser type, explicit button sizes (sm 28 / md 34 / touch 44 px), and every
 *   button and switch at least 44 px tall below the `md` breakpoint. The admin app
 *   wraps its root in `<BBDensityProvider density="compact">`.
 *
 * A context, not a global stylesheet rule: each component renders its own classes,
 * so nothing has to restyle buttons by class name from outside.
 */
export type BBDensity = 'comfortable' | 'compact'

const DensityContext = createContext<BBDensity>('comfortable')

export function BBDensityProvider({ density, children }: { density: BBDensity; children: ReactNode }) {
  return <DensityContext.Provider value={density}>{children}</DensityContext.Provider>
}

export function useBBDensity(): BBDensity {
  return useContext(DensityContext)
}
