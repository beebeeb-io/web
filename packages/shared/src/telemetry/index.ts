// The shared telemetry entry: error reporting hooks used by web and admin.
export { scrubText, scrubFrames, type Frame } from './scrub'
export { SCRUB_VECTORS, type ScrubVector } from './scrub.fixture'
export {
  initTelemetry, reportError, getTelemetryConsent, setTelemetryConsent, isTelemetryConfigured,
  type TelemetryInit,
} from './reporter'
