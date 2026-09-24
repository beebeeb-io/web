import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { initTelemetry } from '@beebeeb/shared'
import { App } from './app'
import './lib/i18n'
import './index.css'

// Opt-in error reporting to our own GlitchTip in Falkenstein. `VITE_ERROR_REPORTING_DSN`
// is deliberately UNSET in every committed env file — errors.beebeeb.io has no DNS record
// yet (task 1369), and `initTelemetry` treats an empty DSN as "stay off": no network calls,
// no init, ever. There is no hardcoded fallback DSN here; that would defeat the point.
initTelemetry({
  dsn: import.meta.env.VITE_ERROR_REPORTING_DSN ?? '',
  client: 'web',
  release: `web@${__APP_VERSION__}`,
  environment: import.meta.env.PROD ? 'production' : 'development',
})

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {})
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
