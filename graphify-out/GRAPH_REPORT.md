# Graph Report - web  (2026-05-01)

## Corpus Check
- 182 files · ~175,317 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 923 nodes · 1065 edges · 29 communities detected
- Extraction: 85% EXTRACTED · 15% INFERRED · 0% AMBIGUOUS · INFERRED: 159 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 44|Community 44]]
- [[_COMMUNITY_Community 47|Community 47]]
- [[_COMMUNITY_Community 48|Community 48]]
- [[_COMMUNITY_Community 49|Community 49]]
- [[_COMMUNITY_Community 52|Community 52]]
- [[_COMMUNITY_Community 53|Community 53]]
- [[_COMMUNITY_Community 64|Community 64]]
- [[_COMMUNITY_Community 65|Community 65]]
- [[_COMMUNITY_Community 66|Community 66]]
- [[_COMMUNITY_Community 68|Community 68]]
- [[_COMMUNITY_Community 69|Community 69]]
- [[_COMMUNITY_Community 70|Community 70]]

## God Nodes (most connected - your core abstractions)
1. `request()` - 71 edges
2. `getProxy()` - 18 edges
3. `encryptedUpload()` - 14 edges
4. `getToken()` - 12 edges
5. `fromBase64()` - 12 edges
6. `setToken()` - 10 edges
7. `decryptFilename()` - 10 edges
8. `zeroize()` - 10 edges
9. `decryptChunk()` - 9 edges
10. `getApiUrl()` - 8 edges

## Surprising Connections (you probably didn't know these)
- `IOSKeyboard()` --calls--> `Row()`  [INFERRED]
  design/hifi/ios-frame.jsx → src/components/share-activity.tsx
- `AndroidKeyboard()` --calls--> `Row()`  [INFERRED]
  design/hifi/android-frame.jsx → src/components/share-activity.tsx
- `Prompt()` --calls--> `handleCreateWorkspace()`  [INFERRED]
  design/hifi/hifi-cli.jsx → src/pages/team.tsx
- `ApiErrorWiring()` --calls--> `useToast()`  [INFERRED]
  src/app.tsx → src/components/toast.tsx
- `getApiUrl()` --calls--> `encryptedDownload()`  [INFERRED]
  src/lib/api.ts → src/lib/encrypted-download.ts

## Communities

### Community 0 - "Community 0"
Cohesion: 0.02
Nodes (101): acceptWorkspaceInvite(), addFolderKeys(), ApiError, approveInvite(), base64urlToBuffer(), bufferToBase64url(), cancelInvite(), changePassword() (+93 more)

### Community 1 - "Community 1"
Cohesion: 0.08
Nodes (45): decryptAll(), handleNewFolder(), listFiles(), computeRecoveryCheck(), decryptChunk(), decryptFilename(), deriveFileKey(), deriveKeys() (+37 more)

### Community 2 - "Community 2"
Cohesion: 0.07
Nodes (27): handleDelete(), handleDownload(), handleRestore(), downloadFile(), downloadVersion(), getApiUrl(), getToken(), uploadChunk() (+19 more)

### Community 3 - "Community 3"
Cohesion: 0.05
Nodes (15): notificationIcon(), toDisplay(), useNotifications(), useToast(), useKeyboardShortcuts(), useSearchIndex(), useWebSocket(), useWsEvent() (+7 more)

### Community 4 - "Community 4"
Cohesion: 0.08
Nodes (7): Prompt(), removeWorkspaceMember(), updateMemberRole(), handleCreateWorkspace(), handleInvite(), handleRemove(), handleRoleChange()

### Community 5 - "Community 5"
Cohesion: 0.11
Nodes (3): Row(), AndroidKeyboard(), IOSKeyboard()

### Community 6 - "Community 6"
Cohesion: 0.13
Nodes (2): restoreFile(), handleRestore()

### Community 7 - "Community 7"
Cohesion: 0.19
Nodes (10): deleteFile(), clearSelection(), displayName(), handleBulkDownload(), handleBulkTrash(), handleBulkUnstar(), handleContextAction(), handleFileDownload() (+2 more)

### Community 10 - "Community 10"
Cohesion: 0.18
Nodes (3): handleInvite(), handleRemove(), load()

### Community 12 - "Community 12"
Cohesion: 0.4
Nodes (10): clearVault(), computeKeyCheck(), dbClear(), dbGet(), dbPut(), deriveWrappingKey(), hasVault(), openDB() (+2 more)

### Community 13 - "Community 13"
Cohesion: 0.2
Nodes (2): handleCheckboxClick(), toggleSelection()

### Community 21 - "Community 21"
Cohesion: 0.28
Nodes (5): handleCodeSubmit(), handleRestore(), decryptFromQr(), deriveQrKey(), encryptForQr()

### Community 27 - "Community 27"
Cohesion: 0.25
Nodes (1): handleManageBilling()

### Community 28 - "Community 28"
Cohesion: 0.29
Nodes (3): savePermissions(), setExpiry(), patchInvite()

### Community 36 - "Community 36"
Cohesion: 0.38
Nodes (3): getStored(), isValidDensity(), isValidFontSize()

### Community 42 - "Community 42"
Cohesion: 0.33
Nodes (2): handleResend(), handleSubmit()

### Community 43 - "Community 43"
Cohesion: 0.33
Nodes (1): handleSetDefault()

### Community 44 - "Community 44"
Cohesion: 0.33
Nodes (1): ErrorBoundary

### Community 47 - "Community 47"
Cohesion: 0.33
Nodes (3): NewFolderDialog(), RenameDialog(), useFocusTrap()

### Community 48 - "Community 48"
Cohesion: 0.73
Nodes (5): colorKeywords(), colorLine(), colorTokens(), esc(), isInsideString()

### Community 49 - "Community 49"
Cohesion: 0.47
Nodes (3): getExtension(), getKindLabel(), pickRenderer()

### Community 52 - "Community 52"
Cohesion: 0.4
Nodes (2): ImpersonationBanner(), useImpersonation()

### Community 53 - "Community 53"
Cohesion: 0.5
Nodes (2): dayLabel(), groupByDay()

### Community 64 - "Community 64"
Cohesion: 0.5
Nodes (1): handleExportJson()

### Community 65 - "Community 65"
Cohesion: 0.5
Nodes (1): applyDecision()

### Community 66 - "Community 66"
Cohesion: 0.83
Nodes (3): extractDroppedItems(), processEntries(), readDirectoryEntry()

### Community 68 - "Community 68"
Cohesion: 0.5
Nodes (2): handleSubmit(), reportShareLink()

### Community 69 - "Community 69"
Cohesion: 0.5
Nodes (1): togglePin()

### Community 70 - "Community 70"
Cohesion: 0.83
Nodes (3): getMenuItems(), getPendingItems(), SharedContextMenu()

## Knowledge Gaps
- **Thin community `Community 6`** (15 nodes): `restoreFile()`, `ConfirmDeleteDialog()`, `daysUntilShred()`, `displayName()`, `executePermanentDelete()`, `formatBytes()`, `getIconForName()`, `handleRestore()`, `handleRestoreAll()`, `requestDeleteSelected()`, `requestEmptyTrash()`, `requestPermanentDelete()`, `timeAgo()`, `toggleSelect()`, `trash.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 13`** (11 nodes): `displayName()`, `formatBytes()`, `handleBulkCancelInvites()`, `handleBulkRemove()`, `handleBulkRevoke()`, `handleCheckboxClick()`, `LoadingSkeleton()`, `selectAllInTab()`, `timeAgo()`, `toggleSelection()`, `shared.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 27`** (8 nodes): `dismissSuccess()`, `formatBytes()`, `formatBytesShort()`, `formatDate()`, `formatStorage()`, `handleManageBilling()`, `openUpgrade()`, `billing.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 42`** (6 nodes): `handleInput()`, `handleKeyDown()`, `handlePaste()`, `handleResend()`, `handleSubmit()`, `verify-email.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 43`** (6 nodes): `formatBytes()`, `formatDate()`, `handleSetDefault()`, `statusColor()`, `UsageBar()`, `storage-pools.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 44`** (6 nodes): `ErrorBoundary`, `.componentDidCatch()`, `.constructor()`, `.getDerivedStateFromError()`, `.render()`, `error-boundary.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 52`** (5 nodes): `ImpersonationBanner()`, `ImpersonationProvider()`, `useImpersonation()`, `impersonation-banner.tsx`, `impersonation-context.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 53`** (5 nodes): `dayLabel()`, `groupByDay()`, `metaFor()`, `timeLabel()`, `activity.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 64`** (4 nodes): `eventColor()`, `handleExportCsv()`, `handleExportJson()`, `audit-log.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 65`** (4 nodes): `applyDecision()`, `formatTimestamp()`, `statusChip()`, `abuse-reports.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 68`** (4 nodes): `handleKeyDown()`, `handleSubmit()`, `reportShareLink()`, `report-dialog.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 69`** (4 nodes): `formatStorage()`, `regionLabel()`, `togglePin()`, `drive-layout.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `request()` connect `Community 0` to `Community 2`, `Community 28`?**
  _High betweenness centrality (0.030) - this node is a cross-community bridge._
- **Why does `getToken()` connect `Community 2` to `Community 0`, `Community 1`?**
  _High betweenness centrality (0.028) - this node is a cross-community bridge._
- **Why does `encryptedDownload()` connect `Community 1` to `Community 2`, `Community 7`?**
  _High betweenness centrality (0.020) - this node is a cross-community bridge._
- **Are the 13 inferred relationships involving `encryptedUpload()` (e.g. with `encryptFilename()` and `toBase64()`) actually correct?**
  _`encryptedUpload()` has 13 INFERRED edges - model-reasoned connections that need verification._
- **Are the 6 inferred relationships involving `getToken()` (e.g. with `encryptAndUploadThumbnail()` and `fetchAndDecryptThumbnail()`) actually correct?**
  _`getToken()` has 6 INFERRED edges - model-reasoned connections that need verification._
- **Are the 11 inferred relationships involving `fromBase64()` (e.g. with `encryptedDownload()` and `decryptToBlob()`) actually correct?**
  _`fromBase64()` has 11 INFERRED edges - model-reasoned connections that need verification._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.02 - nodes in this community are weakly interconnected._