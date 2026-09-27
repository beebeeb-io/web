/**
 * Task 1585 item 2 — engine open errors cross the iframe boundary with a real
 * kind and an honest message.
 *
 * The bug: `bbOffice.open()` rejects with an Error from the engine iframe's
 * realm, so office-editor.tsx's `err instanceof Error` was always false and
 * every failure read "Failed to open this document". `vm.runInNewContext`
 * builds exactly that kind of value here: an Error from another realm.
 */
import { describe, test, expect } from 'bun:test'
import vm from 'node:vm'
import { OFFICE_OPEN_ERROR_MESSAGES, OfficeOpenError, asDecryptFailure, errorText, toOfficeOpenError } from '../src/lib/office/office-open-error'
import { ApiError } from '../src/lib/api'

/** An Error constructed in a separate realm, like one rejected from the engine iframe. */
function foreignError(message: string): unknown {
  return vm.runInNewContext('new Error(msg)', { msg: message })
}

describe('a foreign-realm Error', () => {
  test('is really not instanceof the host Error (the premise of the bug)', () => {
    const err = foreignError('x')
    expect(err instanceof Error).toBe(false)
    expect(errorText(err)).toBe('x')
  })
})

describe('toOfficeOpenError', () => {
  test('engine never booted → engine-not-loaded', () => {
    const e = toOfficeOpenError(foreignError('bb-office-api.js: Module.uno_main never appeared within 60000ms'))
    expect(e).toBeInstanceOf(OfficeOpenError)
    expect(e).toBeInstanceOf(Error)
    expect(e.kind).toBe('engine-not-loaded')
    expect(e.message).toBe(OFFICE_OPEN_ERROR_MESSAGES['engine-not-loaded'])
    expect(e.detail).toContain('Module.uno_main never appeared')
  })

  test('LibreOffice could not read the bytes → invalid-document', () => {
    const nullModel = toOfficeOpenError(foreignError('Error: loadComponentFromURL returned null for report.docx (filter MS Word 2007 XML)'))
    expect(nullModel.kind).toBe('invalid-document')
    expect(nullModel.message).toBe(OFFICE_OPEN_ERROR_MESSAGES['invalid-document'])
    expect(nullModel.detail).toContain('report.docx')

    const io = toOfficeOpenError(foreignError('com.sun.star.io.IOException: SfxBaseModel::impl_store'))
    expect(io.kind).toBe('invalid-document')
    const arg = toOfficeOpenError(foreignError('com.sun.star.lang.IllegalArgumentException: Unsupported URL <private:stream>'))
    expect(arg.kind).toBe('invalid-document')
  })

  test('any other engine failure → engine-failed, with the raw text kept as detail', () => {
    const e = toOfficeOpenError(foreignError('RuntimeError: memory access out of bounds'))
    expect(e.kind).toBe('engine-failed')
    expect(e.message).toBe(OFFICE_OPEN_ERROR_MESSAGES['engine-failed'])
    expect(e.detail).toBe('RuntimeError: memory access out of bounds')
  })

  test('never the generic "Failed to open this document" for a foreign-realm error', () => {
    for (const msg of ['Module.uno_main never appeared within 1ms', 'loadComponentFromURL returned null for a.odt (filter writer8)', 'boom']) {
      expect(toOfficeOpenError(foreignError(msg)).message).not.toBe('Failed to open this document')
    }
  })

  test('a kind carried on the rejection (a later bridge build) wins over the text', () => {
    const carried = vm.runInNewContext('Object.assign(new Error("anything"), { kind: "invalid-document" })')
    expect(toOfficeOpenError(carried).kind).toBe('invalid-document')
    // An unknown carried kind is ignored, not trusted.
    const bogus = vm.runInNewContext('Object.assign(new Error("boom"), { kind: "made-up" })')
    expect(toOfficeOpenError(bogus).kind).toBe('engine-failed')
  })

  test('plain strings and message-less values still classify', () => {
    expect(toOfficeOpenError('Module.uno_main never appeared within 5ms').kind).toBe('engine-not-loaded')
    const e = toOfficeOpenError({})
    expect(e.kind).toBe('engine-failed')
    expect(e.detail).toBe('')
  })

  test('an OfficeOpenError passes through unchanged (decrypt-failed from the page)', () => {
    const original = new OfficeOpenError('decrypt-failed', 'aead::Error')
    expect(toOfficeOpenError(original)).toBe(original)
    expect(original.message).toBe(OFFICE_OPEN_ERROR_MESSAGES['decrypt-failed'])
  })
})

describe('asDecryptFailure (the /office route: name metadata + content)', () => {
  test('a crypto failure becomes decrypt-failed with the raw text as detail', () => {
    const e = asDecryptFailure(new Error('aead::Error')) as OfficeOpenError
    expect(e).toBeInstanceOf(OfficeOpenError)
    expect(e.kind).toBe('decrypt-failed')
    expect(e.message).toBe(OFFICE_OPEN_ERROR_MESSAGES['decrypt-failed'])
    expect(e.detail).toBe('aead::Error')
    // A worker may post a bare string.
    expect((asDecryptFailure('OperationError') as OfficeOpenError).kind).toBe('decrypt-failed')
  })

  test('transport failures pass through unchanged: ApiError, network TypeError, abort', () => {
    const api = new ApiError('Not Found', 404)
    expect(asDecryptFailure(api)).toBe(api)
    const net = new TypeError('Failed to fetch')
    expect(asDecryptFailure(net)).toBe(net)
    const abort = new DOMException('aborted', 'AbortError')
    expect(asDecryptFailure(abort)).toBe(abort)
  })
})
