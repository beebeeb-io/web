// Design-sync preview of BBInput for the Claude Design project.
import { BBInput, Icon } from '@beebeeb/shared'

export const Default = () => (
  <div className="w-80 bg-paper p-4">
    <BBInput label="Email" type="email" icon="mail" placeholder="you@example.com" />
  </div>
)

export const Filled = () => (
  <div className="w-80 bg-paper p-4">
    <BBInput label="Folder name" icon="folder" defaultValue="Tax returns" />
  </div>
)

export const WithError = () => (
  <div className="w-80 bg-paper p-4">
    <BBInput
      label="Password"
      type="password"
      icon="lock"
      defaultValue="correct-horse"
      error="Wrong password. Try again."
    />
  </div>
)

export const WithTrailing = () => (
  <div className="w-80 bg-paper p-4">
    <BBInput
      label="Recovery phrase"
      type="password"
      icon="key"
      defaultValue="amber orbit lantern"
      trailing={<Icon name="eye" size={16} className="shrink-0 text-ink-3" />}
    />
  </div>
)

export const Disabled = () => (
  <div className="w-80 bg-paper p-4">
    <BBInput label="New password" type="password" placeholder="At least 8 characters" disabled />
  </div>
)

export const Dark = () => (
  <div className="dark w-80 bg-paper p-4">
    <BBInput label="Search" icon="search" placeholder="Search this folder" />
  </div>
)
