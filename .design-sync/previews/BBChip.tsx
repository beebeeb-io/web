import { BBChip } from '@beebeeb/shared'

export const Variants = () => (
  <div className="flex flex-wrap items-center gap-2 bg-paper p-4">
    <BBChip>Member</BBChip>
    <BBChip variant="amber">End-to-end encrypted</BBChip>
    <BBChip variant="green">Paid</BBChip>
    <BBChip variant="red">Failed</BBChip>
  </div>
)

export const Roles = () => (
  <div className="flex flex-wrap items-center gap-2 bg-paper p-4">
    <BBChip>Admin</BBChip>
    <BBChip>Member</BBChip>
    <BBChip>Viewer</BBChip>
    <BBChip>Monthly</BBChip>
    <BBChip>Priced in EUR, billed in EUR</BBChip>
  </div>
)

export const BillingStatus = () => (
  <div className="flex flex-wrap items-center gap-2 bg-paper p-4">
    <BBChip variant="green">Paid</BBChip>
    <BBChip variant="amber">Pending</BBChip>
    <BBChip variant="red">Failed</BBChip>
  </div>
)

export const InARow = () => (
  <div className="flex w-72 items-center justify-between rounded-md border border-line bg-paper px-4 py-3">
    <div>
      <div className="text-sm font-medium text-ink">Shared folder</div>
      <div className="font-mono text-xs text-ink-3">anna@example.com</div>
    </div>
    <BBChip>Viewer</BBChip>
  </div>
)

export const Dark = () => (
  <div className="dark flex flex-wrap items-center gap-2 bg-paper p-4">
    <BBChip>Member</BBChip>
    <BBChip variant="amber">End-to-end encrypted</BBChip>
    <BBChip variant="green">Paid</BBChip>
    <BBChip variant="red">Failed</BBChip>
  </div>
)
