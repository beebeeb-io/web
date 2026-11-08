// @beebeeb/shared/drive-ui: the Drive UI shared by web and desktop, and the DriveSource contract behind it.
// Import rule: nothing under drive-ui imports ../api, ../telemetry, beebeeb-wasm or any app code; only react and ../design.
// Components arrive here batch by batch (desktop v2 BATCHES.md, batch B1); each keeps its web behaviour.
export { DriveSourceError } from './source'
export type {
  BinaryDocument,
  Crumb,
  DriveCapabilities,
  DriveEvent,
  DriveItem,
  DriveSource,
  DriveSourceErrorCode,
  ItemDetails,
  ItemId,
  Listing,
  LocalState,
  PhotoEntry,
  ShareEntry,
  SharedState,
  SortDir,
  SortKey,
  StorageSummary,
  SyncSummary,
  TextDocument,
  TrashEntry,
  UploadInput,
  VersionEntry,
} from './source'
export { DriveSourceProvider, useDriveSource } from './provider'

// Moved components (desktop v2 B01). Web keeps its old import paths as re-export stubs.
export * from './file-icon'
export * from './file-browser-row'
export * from './icons'
export * from './file-list/file-row'
export * from './file-list/file-list-header'
export * from './rename-dialog'
export * from './new-folder-dialog'
export * from './duplicate-file-dialog'
export * from './context-menu'
export * from './new-menu'
export * from './move-modal'
export * from './version-history'
export * from './file-details-panel'
export * from './file-list'
export * from './lib/pending-select-timer'
export * from './lib/mod-key'
export * from './upload-progress'
export * from './storage-usage-bar'
export * from './breadcrumb'
export * from './hooks/use-focus-trap'
export * from './lib/folder-colors'
export * from './lib/new-document'
export * from './lib/file-colors'
export * from './lib/format'
export * from './lib/preview'
export * from './lib/display-markers'
export * from './lib/storage-country'
export * from './link'
export * from './folder-viewer-badge'
export * from './empty-states/empty-activity'
export * from './empty-states/empty-drive'
export * from './empty-states/empty-photos'
export * from './empty-states/empty-recent'
export * from './empty-states/empty-search'
export * from './empty-states/empty-shared'
export * from './empty-states/empty-starred'
export * from './empty-states/empty-state'
export * from './empty-states/empty-trash'
export * from './empty-states/forgot-phrase'
export * from './empty-states/link-expired'
export * from './empty-states/offline-state'
export * from './empty-states/upload-error'
export { SORT_KEY_PREFIX, SORT_OPTIONS, typeGroupRank, type SortKey as FileListSortKey } from './file-list-sort'
