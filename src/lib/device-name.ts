// ─── Web source-device label (task 0824) ──────────────────────────────────
// Derives a short, human-readable device label from the browser so an upload
// can record "Uploaded from <device>" — e.g. "Chrome on macOS". CLI / desktop /
// mobile have a real machine/device name (hostname, Device.deviceName); the web
// app has no such identity, so we synthesise one from the user agent.
//
// The label is purely cosmetic and ZERO-KNOWLEDGE: it is encrypted with the
// per-file key before it ever leaves the browser (see encrypted-upload.ts). The
// server only stores the opaque ciphertext. We keep this deliberately simple and
// dependency-free — a coarse "Browser on OS" string is all the UI needs, and a
// heavyweight UA-parsing dependency is not worth the bundle cost or the larger
// fingerprint surface.

/**
 * A short "Browser on OS" device label (e.g. "Chrome on macOS",
 * "Firefox on Windows", "Safari on iOS"). Falls back gracefully:
 *  - unknown browser → just the OS ("macOS")
 *  - unknown OS → just the browser ("Chrome")
 *  - nothing recognisable / no `navigator` (SSR) → "Web browser"
 */
export function getWebDeviceLabel(): string {
  // `navigator` is absent under SSR / non-DOM environments.
  if (typeof navigator === 'undefined') return 'Web browser'

  const ua = navigator.userAgent || ''
  const browser = detectBrowser(ua)
  const os = detectOS(ua, navigator.platform || '')

  if (browser && os) return `${browser} on ${os}`
  if (os) return os
  if (browser) return browser
  return 'Web browser'
}

/**
 * Best-effort browser name from a user-agent string. Order matters — several
 * browsers masquerade as others in their UA (Edge/Opera/Brave all contain
 * "Chrome", Chrome contains "Safari"), so the more specific tokens are checked
 * first.
 */
function detectBrowser(ua: string): string | null {
  if (/\bEdg(?:e|A|iOS)?\//.test(ua)) return 'Edge'
  if (/\bOPR\/|\bOpera\b/.test(ua)) return 'Opera'
  if (/\bSamsungBrowser\//.test(ua)) return 'Samsung Internet'
  if (/\bFirefox\/|\bFxiOS\//.test(ua)) return 'Firefox'
  // Chrome must come before Safari (Chrome's UA also contains "Safari").
  if (/\bChrome\/|\bCriOS\//.test(ua)) return 'Chrome'
  // Safari's UA contains "Version/x Safari" and NOT "Chrome".
  if (/\bSafari\//.test(ua) && !/\bChrome\//.test(ua)) return 'Safari'
  return null
}

/**
 * Best-effort OS name from the user-agent string, with `navigator.platform` as a
 * secondary signal. iOS/iPadOS are checked before macOS because modern iPads
 * report a desktop-Safari UA ("Macintosh") while exposing a touch platform.
 */
function detectOS(ua: string, platform: string): string | null {
  // iPadOS 13+ presents as "Macintosh" in the UA but is a touch device.
  if (/\biPhone\b|\biPad\b|\biPod\b/.test(ua)) return 'iOS'
  if (platform === 'MacIntel' && typeof navigator !== 'undefined' && (navigator.maxTouchPoints ?? 0) > 1) {
    return 'iPadOS'
  }
  if (/\bAndroid\b/.test(ua)) return 'Android'
  if (/\bWindows\b/.test(ua) || /^Win/.test(platform)) return 'Windows'
  if (/\bMac OS X\b|\bMacintosh\b/.test(ua) || /^Mac/.test(platform)) return 'macOS'
  // CrOS = ChromeOS. Check before generic Linux (CrOS UAs also contain "Linux").
  if (/\bCrOS\b/.test(ua)) return 'ChromeOS'
  if (/\bLinux\b/.test(ua) || /^Linux/.test(platform)) return 'Linux'
  return null
}
