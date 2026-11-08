// Web wrapper: the shared bar, with react-router links (moved to @beebeeb/shared/drive-ui, desktop v2 B01).
import type { ComponentProps } from 'react'
import { Link } from 'react-router-dom'
import { StorageUsageBar as SharedStorageUsageBar } from '@beebeeb/shared/drive-ui'

export function StorageUsageBar(props: ComponentProps<typeof SharedStorageUsageBar>) {
  return <SharedStorageUsageBar renderLink={({ to, className, children }) => <Link to={to} className={className}>{children}</Link>} {...props} />
}
