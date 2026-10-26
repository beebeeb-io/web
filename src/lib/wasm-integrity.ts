export function requireWasmIntegrity(manifest: unknown): string {
  const integrity = (manifest as { integrity?: unknown })?.integrity
  // Unknown SRI algorithms can be ignored by the browser. Accept only the
  // complete SHA-384 digest our build emits, rather than a truthy string.
  if (typeof integrity !== 'string' || !/^sha384-[A-Za-z0-9+/]{64}$/.test(integrity)) {
    throw new Error('WASM integrity verification failed: SRI manifest requires a SHA-384 hash')
  }
  return integrity
}
