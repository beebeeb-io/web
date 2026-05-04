/// <reference types="vite/client" />

declare const __APP_VERSION__: string

interface ImportMetaEnv {
  readonly VITE_TURNSTILE_SITE_KEY?: string
  // Add other VITE_ vars here as needed
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
