/// <reference types="vite/client" />

declare const __APP_VERSION__: string

interface ImportMetaEnv {
  // Add VITE_ vars here as needed
  /** Error-reporting DSN for @beebeeb/shared's telemetry reporter. Deliberately
   *  unset in every committed env file — see src/main.tsx. */
  readonly VITE_ERROR_REPORTING_DSN?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
