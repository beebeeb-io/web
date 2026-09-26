import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { InfoRail, CONTENT_CIPHER_LABEL } from '../src/components/preview/info-rail'

// The preview rail's CRYPTO block used to be hard-coded mock copy
// ("XChaCha20-Poly1305", a fixed "IV: 8f2e...91a3", "MAC verified") shown for
// every file. It must render the cipher it is given and only claim tag
// verification when the caller says this file really decrypted.
function render(props: Partial<Parameters<typeof InfoRail>[0]> = {}) {
  return renderToStaticMarkup(
    <InfoRail filename="a.txt" kind="Text" size="1 KB" cipher={CONTENT_CIPHER_LABEL} {...props} />,
  )
}

describe('InfoRail crypto block', () => {
  test('content cipher label is AES-256-GCM (core V1Aes256Gcm)', () => {
    expect(CONTENT_CIPHER_LABEL).toBe('AES-256-GCM')
  })

  test('renders the cipher from props, never the old mock literals', () => {
    const html = render({ cipher: 'TEST-CIPHER-X' })
    expect(html).toContain('TEST-CIPHER-X')
    expect(html).not.toContain('XChaCha20')
    expect(html).not.toContain('8f2e')
    expect(html).not.toContain('MAC verified')
  })

  test('claims GCM tag verification only when tagsVerified', () => {
    expect(render()).not.toContain('GCM tags verified')
    expect(render({ tagsVerified: false })).not.toContain('GCM tags verified')
    expect(render({ tagsVerified: true })).toContain('GCM tags verified on decrypt')
  })

  test('shows the real chunk count when known', () => {
    expect(render({ chunkCount: 3 })).toContain('3 chunks')
    expect(render({ chunkCount: 1 })).toContain('1 chunk<')
    expect(render({ chunkCount: 0 })).not.toContain('chunk')
  })
})
