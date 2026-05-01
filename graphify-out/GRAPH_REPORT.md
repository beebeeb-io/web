# Graph Report - web  (2026-05-01)

## Corpus Check
- 183 files · ~174,792 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 927 nodes · 1087 edges · 30 communities detected
- Extraction: 84% EXTRACTED · 16% INFERRED · 0% AMBIGUOUS · INFERRED: 172 edges (avg confidence: 0.8)
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
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 44|Community 44]]
- [[_COMMUNITY_Community 46|Community 46]]
- [[_COMMUNITY_Community 48|Community 48]]
- [[_COMMUNITY_Community 49|Community 49]]
- [[_COMMUNITY_Community 52|Community 52]]
- [[_COMMUNITY_Community 53|Community 53]]
- [[_COMMUNITY_Community 54|Community 54]]
- [[_COMMUNITY_Community 62|Community 62]]
- [[_COMMUNITY_Community 63|Community 63]]
- [[_COMMUNITY_Community 66|Community 66]]
- [[_COMMUNITY_Community 70|Community 70]]
- [[_COMMUNITY_Community 72|Community 72]]
- [[_COMMUNITY_Community 82|Community 82]]

## God Nodes (most connected - your core abstractions)
1. `request()` - 74 edges
2. `getProxy()` - 18 edges
3. `getToken()` - 14 edges
4. `encryptedUpload()` - 14 edges
5. `fromBase64()` - 12 edges
6. `decryptFilename()` - 10 edges
7. `zeroize()` - 10 edges
8. `getApiUrl()` - 10 edges
9. `setToken()` - 10 edges
10. `decryptChunk()` - 9 edges

## Surprising Connections (you probably didn't know these)
- `AndroidKeyboard()` --calls--> `Row()`  [INFERRED]
  design/hifi/android-frame.jsx → src/components/share-activity.tsx
- `IOSKeyboard()` --calls--> `Row()`  [INFERRED]
  design/hifi/ios-frame.jsx → src/components/share-activity.tsx
- `Prompt()` --calls--> `handleCreateWorkspace()`  [INFERRED]
  design/hifi/hifi-cli.jsx → src/pages/team.tsx
- `loadAndDecrypt()` --calls--> `decryptToBlob()`  [INFERRED]
  src/components/preview/file-preview.tsx → src/lib/encrypted-download.ts
- `togglePin()` --calls--> `setPreference()`  [INFERRED]
  src/components/drive-layout.tsx → src/lib/api.ts

## Communities

### Community 0 - "Community 0"
Cohesion: 0.03
Nodes (103): onPlanChanged(), acceptWorkspaceInvite(), addFolderKeys(), ApiError, approveInvite(), base64urlToBuffer(), bufferToBase64url(), cancelInvite() (+95 more)

### Community 1 - "Community 1"
Cohesion: 0.08
Nodes (40): decryptAll(), decryptAll(), listFiles(), computeRecoveryCheck(), decryptChunk(), decryptFilename(), deriveFileKey(), deriveKeys() (+32 more)

### Community 2 - "Community 2"
Cohesion: 0.06
Nodes (30): checkDpaStatus(), handleUpload(), load(), handleDelete(), handleDownload(), handleRestore(), downloadFile(), downloadVersion() (+22 more)

### Community 3 - "Community 3"
Cohesion: 0.07
Nodes (11): notificationIcon(), toDisplay(), useNotifications(), useToast(), useKeyboardShortcuts(), useSearchIndex(), useWebSocket(), useWsEvent() (+3 more)

### Community 4 - "Community 4"
Cohesion: 0.1
Nodes (18): handleNewFolder(), deleteFile(), updateFile(), encryptFilename(), toBase64(), displayName(), handleBulkDownload(), handleFileAction() (+10 more)

### Community 5 - "Community 5"
Cohesion: 0.08
Nodes (7): Prompt(), removeWorkspaceMember(), updateMemberRole(), handleCreateWorkspace(), handleInvite(), handleRemove(), handleRoleChange()

### Community 6 - "Community 6"
Cohesion: 0.11
Nodes (3): Row(), AndroidKeyboard(), IOSKeyboard()

### Community 7 - "Community 7"
Cohesion: 0.13
Nodes (6): handleInvite(), handleRemove(), onRegionChanged(), togglePin(), getPreference(), load()

### Community 8 - "Community 8"
Cohesion: 0.14
Nodes (2): restoreFile(), handleRestore()

### Community 10 - "Community 10"
Cohesion: 0.18
Nodes (3): handleCheckboxClick(), handleRowClick(), toggleSelection()

### Community 13 - "Community 13"
Cohesion: 0.4
Nodes (10): clearVault(), computeKeyCheck(), dbClear(), dbGet(), dbPut(), deriveWrappingKey(), hasVault(), openDB() (+2 more)

### Community 21 - "Community 21"
Cohesion: 0.28
Nodes (5): handleCodeSubmit(), handleRestore(), decryptFromQr(), deriveQrKey(), encryptForQr()

### Community 27 - "Community 27"
Cohesion: 0.29
Nodes (3): savePermissions(), setExpiry(), patchInvite()

### Community 35 - "Community 35"
Cohesion: 0.38
Nodes (4): getExtension(), getKindLabel(), loadAndDecrypt(), pickRenderer()

### Community 36 - "Community 36"
Cohesion: 0.38
Nodes (3): getStored(), isValidDensity(), isValidFontSize()

### Community 40 - "Community 40"
Cohesion: 0.33
Nodes (1): ErrorBoundary

### Community 41 - "Community 41"
Cohesion: 0.33
Nodes (3): NewFolderDialog(), RenameDialog(), useFocusTrap()

### Community 44 - "Community 44"
Cohesion: 0.73
Nodes (5): colorKeywords(), colorLine(), colorTokens(), esc(), isInsideString()

### Community 46 - "Community 46"
Cohesion: 0.4
Nodes (2): handleCancelSubscription(), handleManageBilling()

### Community 48 - "Community 48"
Cohesion: 0.33
Nodes (2): handleResend(), handleSubmit()

### Community 49 - "Community 49"
Cohesion: 0.33
Nodes (1): handleSetDefault()

### Community 52 - "Community 52"
Cohesion: 0.4
Nodes (2): ImpersonationBanner(), useImpersonation()

### Community 53 - "Community 53"
Cohesion: 0.5
Nodes (2): dayLabel(), groupByDay()

### Community 54 - "Community 54"
Cohesion: 0.4
Nodes (1): handleRevokeSession()

### Community 62 - "Community 62"
Cohesion: 0.83
Nodes (3): extractDroppedItems(), processEntries(), readDirectoryEntry()

### Community 63 - "Community 63"
Cohesion: 0.5
Nodes (2): handleSubmit(), reportShareLink()

### Community 66 - "Community 66"
Cohesion: 0.83
Nodes (3): getMenuItems(), getPendingItems(), SharedContextMenu()

### Community 70 - "Community 70"
Cohesion: 0.5
Nodes (1): applyDecision()

### Community 72 - "Community 72"
Cohesion: 0.5
Nodes (1): handleExportJson()

### Community 82 - "Community 82"
Cohesion: 1.0
Nodes (2): formatBytes(), formatStorageSI()

## Knowledge Gaps
- **Thin community `Community 8`** (14 nodes): `restoreFile()`, `ConfirmDeleteDialog()`, `daysUntilShred()`, `displayName()`, `executePermanentDelete()`, `getIconForName()`, `handleRestore()`, `handleRestoreAll()`, `requestDeleteSelected()`, `requestEmptyTrash()`, `requestPermanentDelete()`, `timeAgo()`, `toggleSelect()`, `trash.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 40`** (6 nodes): `ErrorBoundary`, `.componentDidCatch()`, `.constructor()`, `.getDerivedStateFromError()`, `.render()`, `error-boundary.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 46`** (6 nodes): `dismissSuccess()`, `formatDate()`, `handleCancelSubscription()`, `handleManageBilling()`, `openUpgrade()`, `billing.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 48`** (6 nodes): `handleInput()`, `handleKeyDown()`, `handlePaste()`, `handleResend()`, `handleSubmit()`, `verify-email.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 49`** (6 nodes): `formatBytes()`, `formatDate()`, `handleSetDefault()`, `statusColor()`, `UsageBar()`, `storage-pools.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 52`** (5 nodes): `ImpersonationBanner()`, `ImpersonationProvider()`, `useImpersonation()`, `impersonation-banner.tsx`, `impersonation-context.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 53`** (5 nodes): `dayLabel()`, `groupByDay()`, `metaFor()`, `timeLabel()`, `activity.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 54`** (5 nodes): `cancelProvisioning()`, `formatTime()`, `handleRevokeSession()`, `SecurityScoreRing()`, `security.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 63`** (4 nodes): `handleKeyDown()`, `handleSubmit()`, `reportShareLink()`, `report-dialog.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 70`** (4 nodes): `applyDecision()`, `formatTimestamp()`, `statusChip()`, `abuse-reports.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 72`** (4 nodes): `eventColor()`, `handleExportCsv()`, `handleExportJson()`, `audit-log.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 82`** (3 nodes): `formatBytes()`, `formatStorageSI()`, `format.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `request()` connect `Community 0` to `Community 2`, `Community 27`, `Community 4`?**
  _High betweenness centrality (0.034) - this node is a cross-community bridge._
- **Why does `getToken()` connect `Community 2` to `Community 0`, `Community 1`?**
  _High betweenness centrality (0.032) - this node is a cross-community bridge._
- **Why does `fromBase64()` connect `Community 1` to `Community 0`?**
  _High betweenness centrality (0.022) - this node is a cross-community bridge._
- **Are the 8 inferred relationships involving `getToken()` (e.g. with `fetchIndex()` and `saveIndex()`) actually correct?**
  _`getToken()` has 8 INFERRED edges - model-reasoned connections that need verification._
- **Are the 13 inferred relationships involving `encryptedUpload()` (e.g. with `encryptFilename()` and `toBase64()`) actually correct?**
  _`encryptedUpload()` has 13 INFERRED edges - model-reasoned connections that need verification._
- **Are the 11 inferred relationships involving `fromBase64()` (e.g. with `decryptAll()` and `decryptAll()`) actually correct?**
  _`fromBase64()` has 11 INFERRED edges - model-reasoned connections that need verification._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.03 - nodes in this community are weakly interconnected._