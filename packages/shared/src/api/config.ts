/**
 * API base URL. Each consuming app is responsible for resolving its own URL
 * (via Vite env, runtime config, or a static fallback) and calling
 * `setApiUrl()` once at startup. Defaults to localhost so local dev tooling
 * works out of the box without configuration.
 */

let API_URL: string = 'http://localhost:3001'

export function setApiUrl(url: string): void {
  API_URL = url
}

export function getApiUrl(): string {
  return API_URL
}
