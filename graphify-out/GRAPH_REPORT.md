# Graph Report - web  (2026-05-12)

## Corpus Check
- 255 files · ~262,428 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1407 nodes · 1656 edges · 45 communities detected
- Extraction: 82% EXTRACTED · 18% INFERRED · 0% AMBIGUOUS · INFERRED: 294 edges (avg confidence: 0.8)
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
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 51|Community 51]]
- [[_COMMUNITY_Community 52|Community 52]]
- [[_COMMUNITY_Community 53|Community 53]]
- [[_COMMUNITY_Community 59|Community 59]]
- [[_COMMUNITY_Community 60|Community 60]]
- [[_COMMUNITY_Community 62|Community 62]]
- [[_COMMUNITY_Community 67|Community 67]]
- [[_COMMUNITY_Community 69|Community 69]]
- [[_COMMUNITY_Community 72|Community 72]]
- [[_COMMUNITY_Community 73|Community 73]]
- [[_COMMUNITY_Community 74|Community 74]]
- [[_COMMUNITY_Community 75|Community 75]]
- [[_COMMUNITY_Community 84|Community 84]]
- [[_COMMUNITY_Community 86|Community 86]]
- [[_COMMUNITY_Community 90|Community 90]]
- [[_COMMUNITY_Community 91|Community 91]]
- [[_COMMUNITY_Community 95|Community 95]]
- [[_COMMUNITY_Community 101|Community 101]]
- [[_COMMUNITY_Community 114|Community 114]]

## God Nodes (most connected - your core abstractions)
1. `showToast()` - 68 edges
2. `SyncClient` - 19 edges
3. `getProxy()` - 18 edges
4. `encryptedUpload()` - 16 edges
5. `toBase64()` - 14 edges
6. `encryptFilename()` - 11 edges
7. `decryptFileMetadata()` - 11 edges
8. `zeroize()` - 10 edges
9. `encryptedDownload()` - 9 edges
10. `decryptChunk()` - 8 edges

## Surprising Connections (you probably didn't know these)
- `AndroidKeyboard()` --calls--> `Row()`  [INFERRED]
  design/hifi/android-frame.jsx → src/components/share-activity.tsx
- `IOSKeyboard()` --calls--> `Row()`  [INFERRED]
  design/hifi/ios-frame.jsx → src/components/share-activity.tsx
- `decryptAll()` --calls--> `decryptFileMetadata()`  [INFERRED]
  src/components/move-modal.tsx → src/lib/crypto.ts
- `handleRestoreSelected()` --calls--> `showToast()`  [INFERRED]
  src/pages/trash.tsx → src/pages/shared.tsx
- `handleRestoreAll()` --calls--> `showToast()`  [INFERRED]
  src/pages/trash.tsx → src/pages/shared.tsx

## Communities

### Community 0 - "Community 0"
Cohesion: 0.01
Nodes (61): load(), acceptWorkspaceInvite(), ackTransfer(), base64urlToBuffer(), bufferToBase64url(), confirmAction(), createToken(), createTransferProof() (+53 more)

### Community 1 - "Community 1"
Cohesion: 0.03
Nodes (78): commitInlineRename(), handleTogglePin(), decryptAll(), handleNewFolder(), handleSubmit(), handleDelete(), handleDownload(), handleRestore() (+70 more)

### Community 2 - "Community 2"
Cohesion: 0.05
Nodes (51): downloadSharedFile(), listFiles(), downloadAsZip(), expandToFiles(), computeRecoveryCheck(), decryptChunk(), decryptFileMetadata(), decryptFilename() (+43 more)

### Community 3 - "Community 3"
Cohesion: 0.07
Nodes (22): downloadDropboxFile(), expandDropboxPaths(), expandOne(), rateLimitedFetch(), sleepMs(), expandFolder(), expandGoogleDrivePaths(), GoogleAuthError (+14 more)

### Community 4 - "Community 4"
Cohesion: 0.07
Nodes (18): decryptAll(), decryptOne(), displayName(), handleCheckboxClick(), handleRowClick(), if(), safeName(), toggleSelection() (+10 more)

### Community 5 - "Community 5"
Cohesion: 0.13
Nodes (10): getSnapshot(), getStreamToken(), getSyncOps(), submitSyncOps(), getDeviceId(), payloadToNode(), saveLastSeq(), savePendingOps() (+2 more)

### Community 6 - "Community 6"
Cohesion: 0.08
Nodes (12): load(), createEmptyIndex(), decryptIndex(), deriveIndexKey(), encryptIndex(), fetchIndex(), saveIndex(), commitQuery() (+4 more)

### Community 7 - "Community 7"
Cohesion: 0.1
Nodes (18): addFolderKeys(), completeUpload(), getUploadStatus(), uploadThumbnail(), encryptedUpload(), encryptAndUploadThumbnail(), generateThumbnail(), isImageType() (+10 more)

### Community 8 - "Community 8"
Cohesion: 0.1
Nodes (8): NewFolderDialog(), RenameDialog(), SessionTimeoutWarning(), StepUpAuth(), useToast(), useFocusTrap(), logout(), DataExportCard()

### Community 9 - "Community 9"
Cohesion: 0.11
Nodes (10): cancelSubscription(), createPortalSession(), reactivateSubscription(), formatBytes(), formatStorageSI(), handleCancelSubscription(), handleManageBilling(), handleReactivate() (+2 more)

### Community 10 - "Community 10"
Cohesion: 0.11
Nodes (10): getSharesForFile(), listVersions(), restoreFile(), loadActivity(), buildDetailsMeta(), displayName(), handleRestore(), handleRestoreAll() (+2 more)

### Community 11 - "Community 11"
Cohesion: 0.11
Nodes (3): Row(), AndroidKeyboard(), IOSKeyboard()

### Community 12 - "Community 12"
Cohesion: 0.12
Nodes (7): onRegionChanged(), getMyProfile(), getPreference(), getTrackingPreference(), handleFilterChange(), handleLoadMore(), load()

### Community 13 - "Community 13"
Cohesion: 0.15
Nodes (6): notificationIcon(), toDisplay(), useNotifications(), useWebSocket(), useWsEvent(), WsProvider()

### Community 17 - "Community 17"
Cohesion: 0.27
Nodes (7): cacheFilePreview(), evictOldestPreviews(), getCachedFilePreview(), idbGet(), idbGetAll(), idbPut(), openPreviewDB()

### Community 18 - "Community 18"
Cohesion: 0.2
Nodes (4): downloadAsHtml(), escapeHtml(), generateRecoveryKitPDF(), handlePrint()

### Community 19 - "Community 19"
Cohesion: 0.32
Nodes (9): devAutoAuth(), cacheVaultKey(), clearVaultKey(), dbDelete(), dbGet(), dbPut(), getVaultKey(), initSessionVault() (+1 more)

### Community 20 - "Community 20"
Cohesion: 0.18
Nodes (6): handleResend(), handleVerify(), resendVerification(), verifyEmail(), handleResend(), handleSubmit()

### Community 22 - "Community 22"
Cohesion: 0.4
Nodes (10): clearVault(), computeKeyCheck(), dbClear(), dbGet(), dbPut(), deriveWrappingKey(), hasVault(), openDB() (+2 more)

### Community 27 - "Community 27"
Cohesion: 0.22
Nodes (2): formatEta(), formatSpeed()

### Community 28 - "Community 28"
Cohesion: 0.22
Nodes (2): dayLabel(), groupByDay()

### Community 32 - "Community 32"
Cohesion: 0.28
Nodes (5): handleCodeSubmit(), handleRestore(), decryptFromQr(), deriveQrKey(), encryptForQr()

### Community 38 - "Community 38"
Cohesion: 0.29
Nodes (3): savePermissions(), setExpiry(), patchInvite()

### Community 39 - "Community 39"
Cohesion: 0.25
Nodes (3): load(), handleDownloadCiphertext(), downloadFile()

### Community 40 - "Community 40"
Cohesion: 0.29
Nodes (4): copyToClipboard(), handleCopy(), handleRevoke(), revokeShare()

### Community 42 - "Community 42"
Cohesion: 0.29
Nodes (2): pipelineStage(), stageLabel()

### Community 51 - "Community 51"
Cohesion: 0.38
Nodes (3): getStored(), isValidDensity(), isValidFontSize()

### Community 52 - "Community 52"
Cohesion: 0.38
Nodes (5): allowsFunctional(), getConsent(), hasConsented(), setConsent(), update()

### Community 53 - "Community 53"
Cohesion: 0.29
Nodes (2): loadNames(), getFile()

### Community 59 - "Community 59"
Cohesion: 0.33
Nodes (1): ErrorBoundary

### Community 60 - "Community 60"
Cohesion: 0.33
Nodes (3): poll(), getFolderMembers(), resolveViewerCounts()

### Community 62 - "Community 62"
Cohesion: 0.4
Nodes (2): computeStep(), writeLocalStep()

### Community 67 - "Community 67"
Cohesion: 0.4
Nodes (2): ImpersonationBanner(), useImpersonation()

### Community 69 - "Community 69"
Cohesion: 0.5
Nodes (2): AnnouncementBanner(), severityClasses()

### Community 72 - "Community 72"
Cohesion: 0.5
Nodes (2): langLabel(), toShikiLang()

### Community 73 - "Community 73"
Cohesion: 0.7
Nodes (4): FOLDER_COLOR_KEY(), getFolderColor(), getFolderColorDot(), setFolderColor()

### Community 74 - "Community 74"
Cohesion: 0.4
Nodes (2): createCheckoutSession(), handleSelect()

### Community 75 - "Community 75"
Cohesion: 0.5
Nodes (2): Avatar(), getInitials()

### Community 84 - "Community 84"
Cohesion: 0.67
Nodes (2): signupAndUnlock(), uniqueEmail()

### Community 86 - "Community 86"
Cohesion: 0.83
Nodes (3): extractDroppedItems(), processEntries(), readDirectoryEntry()

### Community 90 - "Community 90"
Cohesion: 0.83
Nodes (3): getMenuItems(), getPendingItems(), SharedContextMenu()

### Community 91 - "Community 91"
Cohesion: 0.5
Nodes (2): ContextMenu(), isPreviewable()

### Community 95 - "Community 95"
Cohesion: 0.83
Nodes (3): clearTauriSession(), isTauri(), pushTauriSession()

### Community 101 - "Community 101"
Cohesion: 0.67
Nodes (1): ApiError

### Community 114 - "Community 114"
Cohesion: 1.0
Nodes (2): deriveSasWords(), fnv1a()

## Knowledge Gaps
- **Thin community `Community 27`** (10 nodes): `barColor()`, `borderColor()`, `computeEta()`, `computeSpeed()`, `formatChunkSize()`, `formatEta()`, `formatSpeed()`, `phaseLabel()`, `regionLabel()`, `upload-progress-card.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 28`** (10 nodes): `actionText()`, `dayLabel()`, `DeviceBadge()`, `groupByDay()`, `loadingMore()`, `matchesFilter()`, `metaFor()`, `timeLabel()`, `wsToActivity()`, `activity.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 42`** (8 nodes): `computeEta()`, `computeSpeed()`, `formatBytes()`, `formatEta()`, `formatSpeed()`, `pipelineStage()`, `stageLabel()`, `upload-progress.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 53`** (7 nodes): `handleDragLeave()`, `handleDragOver()`, `handleDrop()`, `loadNames()`, `onColorChanged()`, `getFile()`, `quick-access.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 59`** (6 nodes): `ErrorBoundary`, `.componentDidCatch()`, `.constructor()`, `.getDerivedStateFromError()`, `.render()`, `error-boundary.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 62`** (6 nodes): `computeStep()`, `OnboardingProvider()`, `readLocalStep()`, `useOnboarding()`, `writeLocalStep()`, `onboarding-context.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 67`** (5 nodes): `ImpersonationBanner()`, `ImpersonationProvider()`, `useImpersonation()`, `impersonation-banner.tsx`, `impersonation-context.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 69`** (5 nodes): `AnnouncementBanner()`, `readDismissed()`, `severityClasses()`, `writeDismissed()`, `announcement-banner.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 72`** (5 nodes): `langLabel()`, `loadShiki()`, `tokenStyle()`, `toShikiLang()`, `text-preview.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 74`** (5 nodes): `createCheckoutSession()`, `formatEur()`, `handleSelect()`, `yearlySavings()`, `pricing.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 75`** (5 nodes): `Avatar()`, `formatRelativeDate()`, `getInitials()`, `SecuredBadge()`, `public-profile.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 84`** (4 nodes): `escapeRegex()`, `signupAndUnlock()`, `refresh-stability.spec.ts`, `uniqueEmail()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 91`** (4 nodes): `ContextMenu()`, `isPreviewable()`, `context-menu.tsx`, `preview.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 101`** (3 nodes): `ApiError`, `.constructor()`, `encrypted-upload-v2-contract.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 114`** (3 nodes): `deriveSasWords()`, `fnv1a()`, `sas-words.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `showToast()` connect `Community 1` to `Community 0`, `Community 2`, `Community 3`, `Community 4`, `Community 38`, `Community 7`, `Community 40`, `Community 9`, `Community 74`, `Community 10`, `Community 20`?**
  _High betweenness centrality (0.059) - this node is a cross-community bridge._
- **Why does `createFolder()` connect `Community 1` to `Community 0`?**
  _High betweenness centrality (0.017) - this node is a cross-community bridge._
- **Why does `toBase64()` connect `Community 1` to `Community 0`, `Community 2`?**
  _High betweenness centrality (0.014) - this node is a cross-community bridge._
- **Are the 64 inferred relationships involving `showToast()` (e.g. with `handleSubmit()` and `handleVerify()`) actually correct?**
  _`showToast()` has 64 INFERRED edges - model-reasoned connections that need verification._
- **Are the 15 inferred relationships involving `encryptedUpload()` (e.g. with `computeFingerprint()` and `findByFingerprint()`) actually correct?**
  _`encryptedUpload()` has 15 INFERRED edges - model-reasoned connections that need verification._
- **Are the 12 inferred relationships involving `toBase64()` (e.g. with `handleNewFolder()` and `commitInlineRename()`) actually correct?**
  _`toBase64()` has 12 INFERRED edges - model-reasoned connections that need verification._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.01 - nodes in this community are weakly interconnected._