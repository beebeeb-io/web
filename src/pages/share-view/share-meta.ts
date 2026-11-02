import { useEffect } from 'react'

// ─── Meta tag helpers ─────────────────────────────────────────────────────────

/** Beebeeb lock icon as a data URI for og:image fallback. */
const OG_IMAGE_DATA_URI =
  'data:image/svg+xml,%3Csvg xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22 width%3D%221200%22 height%3D%22630%22 viewBox%3D%220 0 1200 630%22%3E%3Crect width%3D%221200%22 height%3D%22630%22 fill%3D%22%23fdf8f0%22%2F%3E%3Crect x%3D%22480%22 y%3D%22160%22 width%3D%22240%22 height%3D%22240%22 rx%3D%2240%22 fill%3D%22%23f5b800%22 opacity%3D%220.15%22%2F%3E%3Cpath d%3D%22M600 240 a60 60 0 0 1 60 60v70a10 10 0 0 1-10 10H550a10 10 0 0 1-10-10v-70a60 60 0 0 1 60-60z%22 fill%3D%22none%22 stroke%3D%22%23f5b800%22 stroke-width%3D%228%22%2F%3E%3Crect x%3D%22564%22 y%3D%22310%22 width%3D%2272%22 height%3D%2250%22 rx%3D%228%22 fill%3D%22%23f5b800%22%2F%3E%3Ccircle cx%3D%22600%22 cy%3D%22336%22 r%3D%228%22 fill%3D%22%23fdf8f0%22%2F%3E%3Ctext x%3D%22600%22 y%3D%22470%22 text-anchor%3D%22middle%22 font-family%3D%22Inter%2C sans-serif%22 font-size%3D%2232%22 font-weight%3D%22600%22 fill%3D%22%234a3f2f%22%3EEnd-to-end encrypted%3C%2Ftext%3E%3Ctext x%3D%22600%22 y%3D%22520%22 text-anchor%3D%22middle%22 font-family%3D%22Inter%2C sans-serif%22 font-size%3D%2224%22 fill%3D%22%238a7a62%22%3EBeebeeb%3C%2Ftext%3E%3C%2Fsvg%3E'

function setMetaTag(property: string, content: string, attr: 'name' | 'property' = 'name'): void {
  const selector = `meta[${attr}="${property}"]`
  let el = document.querySelector<HTMLMetaElement>(selector)
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute(attr, property)
    document.head.appendChild(el)
  }
  el.setAttribute('content', content)
}

function removeMetaTag(property: string, attr: 'name' | 'property' = 'name'): void {
  const selector = `meta[${attr}="${property}"]`
  document.querySelector(selector)?.remove()
}

/**
 * Sets share-specific meta tags on mount and restores defaults on unmount.
 *
 * The title is intentionally generic — anonymous recipients must not learn
 * any identifier of the share creator (task 0452).
 */
export function useShareMetaTags() {
  useEffect(() => {
    const prevTitle = document.title
    const title = 'Shared file — Beebeeb'
    const description = 'End-to-end encrypted file. Only you can decrypt it.'

    document.title = title
    setMetaTag('description', description)
    setMetaTag('og:title', title, 'property')
    setMetaTag('og:description', description, 'property')
    setMetaTag('og:image', OG_IMAGE_DATA_URI, 'property')
    setMetaTag('og:type', 'website', 'property')
    setMetaTag('twitter:card', 'summary_large_image')
    setMetaTag('twitter:title', title)
    setMetaTag('twitter:description', description)

    return () => {
      document.title = prevTitle
      setMetaTag('description', 'End-to-end encrypted cloud storage. Made in Europe.')
      removeMetaTag('og:title', 'property')
      removeMetaTag('og:description', 'property')
      removeMetaTag('og:image', 'property')
      removeMetaTag('og:type', 'property')
      removeMetaTag('twitter:card')
      removeMetaTag('twitter:title')
      removeMetaTag('twitter:description')
    }
  }, [])
}


export function formatExpiry(expiresAt: string | null | undefined): string {
  if (!expiresAt) return 'Never'
  const exp = new Date(expiresAt)
  const now = Date.now()
  const diff = exp.getTime() - now
  if (diff <= 0) return 'Expired'
  const hours = Math.floor(diff / (1000 * 60 * 60))
  if (hours < 1) {
    const minutes = Math.floor(diff / (1000 * 60))
    return `${minutes}m remaining`
  }
  if (hours < 24) return `${hours}h remaining`
  const days = Math.floor(hours / 24)
  return `${days}d remaining`
}
