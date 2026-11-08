// Display markers derived from what THIS client has proven (spec 2275). The pure logic moved to
// @beebeeb/shared/drive-ui (desktop v2 B01); web plugs in its own custody proofs here.
import { registerDisplayProofs } from '@beebeeb/shared/drive-ui'
import { hasSeenCustody } from './custody-memory'
import { isForeignItemById } from './owner-adoption'

export {
  FOREIGN_ROW_LABEL,
  SHARED_ROOT_SUFFIX,
  BREADCRUMB_MAX_VISIBLE,
  isSharedRootById,
  sharedRootSuffix,
  pickerFolderLabel,
  foreignRowMarker,
  visibleCrumbs,
  type CrumbItem,
  type DisplayCrumb,
} from '@beebeeb/shared/drive-ui'
registerDisplayProofs({ sharedRoot: hasSeenCustody, foreign: isForeignItemById })
