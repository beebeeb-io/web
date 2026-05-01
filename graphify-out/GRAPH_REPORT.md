# Graph Report - web  (2026-05-01)

## Corpus Check
- 184 files · ~176,004 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 935 nodes · 1098 edges · 28 communities detected
- Extraction: 84% EXTRACTED · 16% INFERRED · 0% AMBIGUOUS · INFERRED: 174 edges (avg confidence: 0.8)
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
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 47|Community 47]]
- [[_COMMUNITY_Community 48|Community 48]]
- [[_COMMUNITY_Community 51|Community 51]]
- [[_COMMUNITY_Community 52|Community 52]]
- [[_COMMUNITY_Community 60|Community 60]]
- [[_COMMUNITY_Community 61|Community 61]]
- [[_COMMUNITY_Community 64|Community 64]]
- [[_COMMUNITY_Community 68|Community 68]]
- [[_COMMUNITY_Community 70|Community 70]]
- [[_COMMUNITY_Community 81|Community 81]]

## God Nodes (most connected - your core abstractions)
1. `request()` - 76 edges
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
- `handleQuickAccessDrop()` --calls--> `setPreference()`  [INFERRED]
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
Cohesion: 0.06
Nodes (14): handleInvite(), handleRemove(), handleQuickAccessDrop(), onRegionChanged(), togglePin(), handleCheckboxClick(), handleRowClick(), handleTogglePin() (+6 more)

### Community 4 - "Community 4"
Cohesion: 0.07
Nodes (11): notificationIcon(), toDisplay(), useNotifications(), useToast(), useKeyboardShortcuts(), useSearchIndex(), useWebSocket(), useWsEvent() (+3 more)

### Community 5 - "Community 5"
Cohesion: 0.1
Nodes (18): handleNewFolder(), deleteFile(), updateFile(), encryptFilename(), toBase64(), displayName(), handleBulkDownload(), handleFileAction() (+10 more)

### Community 6 - "Community 6"
Cohesion: 0.08
Nodes (7): Prompt(), removeWorkspaceMember(), updateMemberRole(), handleCreateWorkspace(), handleInvite(), handleRemove(), handleRoleChange()

### Community 7 - "Community 7"
Cohesion: 0.11
Nodes (3): Row(), AndroidKeyboard(), IOSKeyboard()

### Community 8 - "Community 8"
Cohesion: 0.14
Nodes (2): restoreFile(), handleRestore()

### Community 12 - "Community 12"
Cohesion: 0.4
Nodes (10): clearVault(), computeKeyCheck(), dbClear(), dbGet(), dbPut(), deriveWrappingKey(), hasVault(), openDB() (+2 more)

### Community 20 - "Community 20"
Cohesion: 0.28
Nodes (5): handleCodeSubmit(), handleRestore(), decryptFromQr(), deriveQrKey(), encryptForQr()

### Community 26 - "Community 26"
Cohesion: 0.29
Nodes (3): savePermissions(), setExpiry(), patchInvite()

### Community 34 - "Community 34"
Cohesion: 0.38
Nodes (4): getExtension(), getKindLabel(), loadAndDecrypt(), pickRenderer()

### Community 35 - "Community 35"
Cohesion: 0.38
Nodes (3): getStored(), isValidDensity(), isValidFontSize()

### Community 39 - "Community 39"
Cohesion: 0.33
Nodes (1): ErrorBoundary

### Community 40 - "Community 40"
Cohesion: 0.33
Nodes (3): NewFolderDialog(), RenameDialog(), useFocusTrap()

### Community 43 - "Community 43"
Cohesion: 0.73
Nodes (5): colorKeywords(), colorLine(), colorTokens(), esc(), isInsideString()

### Community 45 - "Community 45"
Cohesion: 0.4
Nodes (2): handleCancelSubscription(), handleManageBilling()

### Community 47 - "Community 47"
Cohesion: 0.33
Nodes (2): handleResend(), handleSubmit()

### Community 48 - "Community 48"
Cohesion: 0.33
Nodes (1): handleSetDefault()

### Community 51 - "Community 51"
Cohesion: 0.4
Nodes (2): ImpersonationBanner(), useImpersonation()

### Community 52 - "Community 52"
Cohesion: 0.5
Nodes (2): dayLabel(), groupByDay()

### Community 60 - "Community 60"
Cohesion: 0.83
Nodes (3): extractDroppedItems(), processEntries(), readDirectoryEntry()

### Community 61 - "Community 61"
Cohesion: 0.5
Nodes (2): handleSubmit(), reportShareLink()

### Community 64 - "Community 64"
Cohesion: 0.83
Nodes (3): getMenuItems(), getPendingItems(), SharedContextMenu()

### Community 68 - "Community 68"
Cohesion: 0.5
Nodes (1): applyDecision()

### Community 70 - "Community 70"
Cohesion: 0.5
Nodes (1): handleExportJson()

### Community 81 - "Community 81"
Cohesion: 1.0
Nodes (2): formatBytes(), formatStorageSI()

## Knowledge Gaps
- **Thin community `Community 8`** (14 nodes): `restoreFile()`, `ConfirmDeleteDialog()`, `daysUntilShred()`, `displayName()`, `executePermanentDelete()`, `getIconForName()`, `handleRestore()`, `handleRestoreAll()`, `requestDeleteSelected()`, `requestEmptyTrash()`, `requestPermanentDelete()`, `timeAgo()`, `toggleSelect()`, `trash.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 39`** (6 nodes): `ErrorBoundary`, `.componentDidCatch()`, `.constructor()`, `.getDerivedStateFromError()`, `.render()`, `error-boundary.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 45`** (6 nodes): `dismissSuccess()`, `formatDate()`, `handleCancelSubscription()`, `handleManageBilling()`, `openUpgrade()`, `billing.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 47`** (6 nodes): `handleInput()`, `handleKeyDown()`, `handlePaste()`, `handleResend()`, `handleSubmit()`, `verify-email.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 48`** (6 nodes): `formatBytes()`, `formatDate()`, `handleSetDefault()`, `statusColor()`, `UsageBar()`, `storage-pools.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 51`** (5 nodes): `ImpersonationBanner()`, `ImpersonationProvider()`, `useImpersonation()`, `impersonation-banner.tsx`, `impersonation-context.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 52`** (5 nodes): `dayLabel()`, `groupByDay()`, `metaFor()`, `timeLabel()`, `activity.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 61`** (4 nodes): `handleKeyDown()`, `handleSubmit()`, `reportShareLink()`, `report-dialog.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 68`** (4 nodes): `applyDecision()`, `formatTimestamp()`, `statusChip()`, `abuse-reports.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 70`** (4 nodes): `eventColor()`, `handleExportCsv()`, `handleExportJson()`, `audit-log.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 81`** (3 nodes): `formatBytes()`, `formatStorageSI()`, `format.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `request()` connect `Community 0` to `Community 3`, `Community 2`, `Community 26`, `Community 5`?**
  _High betweenness centrality (0.033) - this node is a cross-community bridge._
- **Why does `getToken()` connect `Community 2` to `Community 0`, `Community 1`?**
  _High betweenness centrality (0.029) - this node is a cross-community bridge._
- **Why does `getApiUrl()` connect `Community 2` to `Community 0`, `Community 1`?**
  _High betweenness centrality (0.019) - this node is a cross-community bridge._
- **Are the 8 inferred relationships involving `getToken()` (e.g. with `fetchIndex()` and `saveIndex()`) actually correct?**
  _`getToken()` has 8 INFERRED edges - model-reasoned connections that need verification._
- **Are the 13 inferred relationships involving `encryptedUpload()` (e.g. with `encryptFilename()` and `toBase64()`) actually correct?**
  _`encryptedUpload()` has 13 INFERRED edges - model-reasoned connections that need verification._
- **Are the 11 inferred relationships involving `fromBase64()` (e.g. with `decryptAll()` and `decryptAll()`) actually correct?**
  _`fromBase64()` has 11 INFERRED edges - model-reasoned connections that need verification._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.03 - nodes in this community are weakly interconnected._