/**
 * IosAppBanner — sticky amber banner shown only on iPhone/iPad Safari.
 *
 * Prompts iOS users to download the native Beebeeb app for camera backup
 * and offline access. Dismissed per session via sessionStorage.
 *
 * Detection: navigator.userAgent iPhone or iPad string.
 * Placement: rendered above the main content in DriveLayout.
 */

import { useState, useEffect } from 'react'
import { Icon } from '@beebeeb/shared'

const DISMISS_KEY = 'beebeeb_ios_banner_dismissed'
const APP_STORE_URL = 'https://apps.apple.com/app/id6766666400'

function isIos(): boolean {
  const ua = navigator.userAgent
  return ua.includes('iPhone') || ua.includes('iPad')
}

function isDismissed(): boolean {
  try {
    return sessionStorage.getItem(DISMISS_KEY) === '1'
  } catch {
    return false
  }
}

function dismiss(): void {
  try {
    sessionStorage.setItem(DISMISS_KEY, '1')
  } catch {
    // sessionStorage unavailable — ignore
  }
}

export function IosAppBanner() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (isIos() && !isDismissed()) {
      setVisible(true)
    }
  }, [])

  if (!visible) return null

  function handleDismiss() {
    dismiss()
    setVisible(false)
  }

  return (
    <div
      role="status"
      data-tour="mobile"
      className="flex items-center gap-2.5 px-4 py-2.5 border-b border-amber/30 bg-amber-bg sticky top-0 z-30"
    >
      <Icon name="image" size={14} className="shrink-0 text-amber-deep" />
      <p className="flex-1 text-[13px] text-amber-deep leading-snug">
        You&apos;re on iPhone.{' '}
        <a
          href={APP_STORE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold underline underline-offset-2 hover:opacity-80 transition-opacity"
        >
          Get the Beebeeb app
        </a>
        {' '}for camera backup and offline access.
      </p>
      <button
        type="button"
        onClick={handleDismiss}
        className="shrink-0 p-1 rounded-md hover:bg-amber/20 transition-colors text-amber-deep"
        aria-label="Dismiss"
      >
        <Icon name="x" size={12} />
      </button>
    </div>
  )
}
