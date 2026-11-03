/**
 * The invoice preferences panel: the delivery address and the save action.
 *
 * The invoice-preferences card of the change view: email toggle, address and
 * the save action. Moved verbatim out of the page (task W run 5).
 *
 * Must not: own state or call the API.
 */

import { BBButton, BBToggle, BBInput } from '@beebeeb/shared'
import { useBillingModel } from './model-context'

export function InvoicePreferencesPanel() {
  const {
    invoiceSendEmail,
    setInvoiceSendEmail,
    invoiceEmail,
    setInvoiceEmail,
    savingInvoicePrefs,
    handleSaveInvoicePrefs,
  } = useBillingModel()
  return (
    <>
        {/* ── Invoice preferences ────────────────────── */}
        <div className="border border-line rounded-xl overflow-hidden bg-paper">
          <div className="px-5 py-4 border-b border-line">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-4">
              Invoice preferences
            </div>
          </div>
          <div className="px-5 py-4 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[13px] font-medium text-ink">Send invoices via email</div>
                <div className="text-[11.5px] text-ink-3 mt-0.5">
                  Receive a PDF invoice for each payment.
                </div>
              </div>
              <BBToggle on={invoiceSendEmail} onChange={setInvoiceSendEmail} />
            </div>
            {invoiceSendEmail && (
              <div>
                <label className="text-[11.5px] text-ink-3 mb-1.5 block">
                  Invoice email
                </label>
                <BBInput
                  value={invoiceEmail}
                  onChange={(e) => setInvoiceEmail(e.target.value)}
                  placeholder="billing@company.com"
                  type="email"
                  className="max-w-[340px]"
                />
                <div className="text-[11px] text-ink-4 mt-1.5">
                  Defaults to your account email. Use a different address for a billing team.
                </div>
              </div>
            )}
            <div className="flex justify-end">
              <BBButton
                size="sm"
                variant="amber"
                onClick={() => void handleSaveInvoicePrefs()}
                disabled={savingInvoicePrefs}
              >
                {savingInvoicePrefs ? 'Saving...' : 'Save preferences'}
              </BBButton>
            </div>
          </div>
        </div>
    </>
  )
}
