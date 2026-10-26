export function forceApi(): boolean {
  try { return localStorage.getItem('bb.transport') === 'api' } catch { return false }
}
