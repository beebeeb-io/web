// Minimal type declaration for mammoth (no @types/mammoth available).
// https://github.com/mwilliamson/mammoth.js
declare module 'mammoth' {
  interface ConversionResult {
    value: string
    messages: Array<{ type: string; message: string }>
  }

  interface ConversionOptions {
    arrayBuffer: ArrayBuffer
  }

  function convertToHtml(options: ConversionOptions): Promise<ConversionResult>
}
