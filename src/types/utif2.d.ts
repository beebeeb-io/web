// Minimal type declaration for utif2 (no @types/utif2 available). Covers
// only the three functions task 1574's TIFF decoder actually calls — the
// package is photopea's "UTIF.js" (published to npm as utif2); see its own
// README for the full, much larger, API this does not attempt to type.
declare module 'utif2' {
  interface IFD {
    // Populated only AFTER `decodeImage()` runs — `decode()` alone parses
    // the tag dictionary (t256/t257/… below) but does not set these. A
    // real bug this task hit: checking `ifd.width` right after `decode()`
    // (before ever calling `decodeImage`) always reads `undefined`, even
    // for a perfectly valid TIFF.
    width?: number
    height?: number
    // Raw tag dictionary, keyed "t<tagNumber>" — e.g. t256 = ImageWidth,
    // t257 = ImageLength (height), both IFD0 standard tags. These ARE
    // populated by `decode()` alone, before `decodeImage()` runs — read
    // them directly for a pre-decode pixel-count safety check.
    [tag: string]: unknown
  }

  function decode(buffer: ArrayBuffer): IFD[]
  function decodeImage(buffer: ArrayBuffer, ifd: IFD, ifds?: IFD[]): void
  function toRGBA8(ifd: IFD): Uint8Array

  const UTIF: { decode: typeof decode; decodeImage: typeof decodeImage; toRGBA8: typeof toRGBA8 }
  export default UTIF
}
