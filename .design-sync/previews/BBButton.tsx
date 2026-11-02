// Design-sync preview of BBButton for the Claude Design project.
import { BBButton, Icon } from '@beebeeb/shared'

export const Variants = () => (
  <div className="flex flex-wrap items-center gap-3 bg-paper p-4">
    <BBButton variant="amber">Update payment method</BBButton>
    <BBButton variant="default">Keep both</BBButton>
    <BBButton variant="ghost">Start over</BBButton>
    <BBButton variant="danger">Delete permanently</BBButton>
  </div>
)

export const Sizes = () => (
  <div className="flex flex-wrap items-center gap-3 bg-paper p-4">
    <BBButton variant="amber" size="sm">I've saved these codes</BBButton>
    <BBButton variant="amber" size="md">Upgrade</BBButton>
    <BBButton variant="amber" size="lg">Save as a new version anyway</BBButton>
  </div>
)

export const WithIcon = () => (
  <div className="flex flex-wrap items-center gap-3 bg-paper p-4">
    <BBButton variant="amber">
      <Icon name="upload" size={16} className="mr-2" />
      Upload files
    </BBButton>
    <BBButton variant="default">
      <Icon name="share" size={16} className="mr-2" />
      Share
    </BBButton>
    <BBButton variant="ghost" size="sm">
      <Icon name="download" size={14} className="mr-1.5" />
      Download
    </BBButton>
  </div>
)

export const Disabled = () => (
  <div className="flex flex-wrap items-center gap-3 bg-paper p-4">
    <BBButton variant="amber" disabled>Saving…</BBButton>
    <BBButton variant="default" disabled>Retry</BBButton>
    <BBButton variant="danger" disabled>Deleting…</BBButton>
  </div>
)

export const Dark = () => (
  <div className="dark flex flex-wrap items-center gap-3 bg-paper p-4">
    <BBButton variant="amber">Update payment method</BBButton>
    <BBButton variant="default">Keep both</BBButton>
    <BBButton variant="ghost">Start over</BBButton>
    <BBButton variant="danger">Delete permanently</BBButton>
  </div>
)
