/// <reference types="vite/client" />

declare const __APP_VERSION__: string

interface ImportMetaEnv {
  // Add VITE_ vars here as needed
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
