// Cross-component signal that "a file was just decrypted in this tab".
// Used to drive the lock-chip pulse in the file row and the
// "Decrypted locally" subtitle in the preview chrome. Fired from the
// places that actually own the fileId (download, preview, share view).

const EVENT_NAME = 'beebeeb:decrypted'

interface DecryptDetail {
  fileId: string
}

export function dispatchDecrypted(fileId: string): void {
  window.dispatchEvent(
    new CustomEvent<DecryptDetail>(EVENT_NAME, { detail: { fileId } }),
  )
}

export function onDecrypted(
  handler: (fileId: string) => void,
): () => void {
  function listener(e: Event) {
    const ce = e as CustomEvent<DecryptDetail>
    if (ce.detail?.fileId) handler(ce.detail.fileId)
  }
  window.addEventListener(EVENT_NAME, listener)
  return () => window.removeEventListener(EVENT_NAME, listener)
}
