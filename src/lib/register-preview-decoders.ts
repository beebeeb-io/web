// Hands web's worker-backed decoders to the shared RAW and TIFF previews (desktop v2 B01).
import { registerPreviewDecoders } from '@beebeeb/shared/drive-ui'
import { decodeTiffToPng } from './tiff-decode-worker-client'
import { extractRawPreview } from './raw-preview-worker-client'

registerPreviewDecoders({ decodeTiffToPng, extractRawPreview })
