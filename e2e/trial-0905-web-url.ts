/**
 * Single source of truth for the web URL `trial-0905.config.ts` and
 * `trial-0905.spec.ts` both need (task 1604 review thread
 * PRRT_kwDOSLX6Nc6nC4VK).
 *
 * Before this file existed, the config computed its OWN default
 * (`http://localhost:5199`, to avoid colliding with a developer's `bun dev`
 * on :5173) while the spec independently defaulted to `http://localhost:5173`
 * and used that absolute URL for every `page.goto()`. With no `E2E_WEB_URL`
 * set, the documented default command (`bunx playwright test
 * --config=e2e/trial-0905.config.ts`) started/waited-on Vite on :5199 (the
 * config's `webServer`) but then navigated the browser to :5173 — either
 * `ERR_CONNECTION_REFUSED` (nothing listening there) or, worse, silently
 * testing whatever unrelated dev server happened to already be running on
 * :5173 (this is exactly what happened during this task's own Playwright
 * run — see the task file's Notes for the root-cause trace).
 *
 * Both files now import `WEB_URL` from here, so there is exactly one place
 * that can drift, and it can't: they read the same constant by construction.
 */
export const WEB_URL = process.env.E2E_WEB_URL ?? 'http://localhost:5199'
