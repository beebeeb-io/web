// Forces the API transport for the rest of a session when direct fails.
export function forceApi(): boolean {
  try { return localStorage.getItem('bb.transport') === 'api' } catch { return false }
}
