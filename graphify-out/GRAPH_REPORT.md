# Graph Report - web  (2026-05-12)

## Corpus Check
- 278 files · ~274,645 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1515 nodes · 1940 edges · 48 communities detected
- Extraction: 78% EXTRACTED · 22% INFERRED · 0% AMBIGUOUS · INFERRED: 422 edges (avg confidence: 0.8)
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
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 54|Community 54]]
- [[_COMMUNITY_Community 55|Community 55]]
- [[_COMMUNITY_Community 56|Community 56]]
- [[_COMMUNITY_Community 57|Community 57]]
- [[_COMMUNITY_Community 63|Community 63]]
- [[_COMMUNITY_Community 65|Community 65]]
- [[_COMMUNITY_Community 70|Community 70]]
- [[_COMMUNITY_Community 72|Community 72]]
- [[_COMMUNITY_Community 75|Community 75]]
- [[_COMMUNITY_Community 76|Community 76]]
- [[_COMMUNITY_Community 77|Community 77]]
- [[_COMMUNITY_Community 78|Community 78]]
- [[_COMMUNITY_Community 87|Community 87]]
- [[_COMMUNITY_Community 89|Community 89]]
- [[_COMMUNITY_Community 91|Community 91]]
- [[_COMMUNITY_Community 94|Community 94]]
- [[_COMMUNITY_Community 95|Community 95]]
- [[_COMMUNITY_Community 99|Community 99]]
- [[_COMMUNITY_Community 105|Community 105]]
- [[_COMMUNITY_Community 118|Community 118]]

## God Nodes (most connected - your core abstractions)
1. `request()` - 104 edges
2. `showToast()` - 68 edges
3. `SyncClient` - 19 edges
4. `takeFromExternrefTable0()` - 18 edges
5. `getProxy()` - 18 edges
6. `passArray8ToWasm0()` - 17 edges
7. `encryptedUpload()` - 16 edges
8. `toBase64()` - 15 edges
9. `getApiUrl()` - 13 edges
10. `getArrayU8FromWasm0()` - 12 edges

## Surprising Connections (you probably didn't know these)
- `getApiUrl()` --calls--> `fetchAndDecryptThumbnail()`  [INFERRED]
  packages/shared/src/api/config.ts → src/lib/thumbnail.ts
- `request()` --calls--> `opaqueRegisterStart()`  [INFERRED]
  packages/shared/src/api/request.ts → src/lib/api.ts
- `request()` --calls--> `opaqueRegisterStartExisting()`  [INFERRED]
  packages/shared/src/api/request.ts → src/lib/api.ts
- `request()` --calls--> `opaqueRegisterFinishExisting()`  [INFERRED]
  packages/shared/src/api/request.ts → src/lib/api.ts
- `request()` --calls--> `recoverOpaqueRegister()`  [INFERRED]
  packages/shared/src/api/request.ts → src/lib/api.ts

## Communities

### Community 0 - "Community 0"
Cohesion: 0.02
Nodes (124): fireConnectionStatus(), fireErrorNotifier(), fireSessionExpired(), delay(), reportConnection(), request(), load(), acceptWorkspaceInvite() (+116 more)

### Community 1 - "Community 1"
Cohesion: 0.02
Nodes (92): commitInlineRename(), handleTogglePin(), handleNewFolder(), savePermissions(), setExpiry(), handleDelete(), handleDownload(), handleRestore() (+84 more)

### Community 2 - "Community 2"
Cohesion: 0.06
Nodes (43): decryptAll(), loadNames(), listFiles(), downloadAsZip(), expandToFiles(), computeRecoveryCheck(), decryptChunk(), decryptFileMetadata() (+35 more)

### Community 3 - "Community 3"
Cohesion: 0.06
Nodes (23): getApiUrl(), load(), downloadSharedFile(), downloadVersion(), dispatchDecrypted(), decryptEncryptedBytes(), decryptToBlob(), decryptVersionToBlob() (+15 more)

### Community 4 - "Community 4"
Cohesion: 0.06
Nodes (18): ContextMenu(), decryptAll(), decryptOne(), displayName(), handleCheckboxClick(), handleRowClick(), if(), safeName() (+10 more)

### Community 5 - "Community 5"
Cohesion: 0.16
Nodes (34): addToExternrefTable0(), compute_recovery_check(), debugString(), decodeText(), decrypt_chunk(), decrypt_metadata(), derive_file_key(), derive_master_key() (+26 more)

### Community 6 - "Community 6"
Cohesion: 0.14
Nodes (8): getSyncOps(), submitSyncOps(), getDeviceId(), payloadToNode(), saveLastSeq(), savePendingOps(), SyncClient, uuid()

### Community 7 - "Community 7"
Cohesion: 0.11
Nodes (24): base64urlToBuffer(), bufferToBase64url(), credentialToAuthenticationJSON(), credentialToRegistrationJSON(), deletePasskey(), finishPasskeyLogin(), getVaultKeyEscrow(), listPasskeys() (+16 more)

### Community 8 - "Community 8"
Cohesion: 0.08
Nodes (12): NewFolderDialog(), RenameDialog(), SessionTimeoutWarning(), StepUpAuth(), useToast(), useFocusTrap(), logout(), consumePendingExport() (+4 more)

### Community 9 - "Community 9"
Cohesion: 0.11
Nodes (16): uploadThumbnail(), encryptedUpload(), encryptAndUploadThumbnail(), fetchAndDecryptThumbnail(), generateThumbnail(), isImageType(), computeFingerprint(), findByFingerprint() (+8 more)

### Community 10 - "Community 10"
Cohesion: 0.1
Nodes (12): confirmAction(), getSharesForFile(), permanentDeleteFile(), restoreFile(), loadActivity(), buildDetailsMeta(), displayName(), handleRestore() (+4 more)

### Community 11 - "Community 11"
Cohesion: 0.11
Nodes (3): Row(), AndroidKeyboard(), IOSKeyboard()

### Community 12 - "Community 12"
Cohesion: 0.12
Nodes (8): createPortalSession(), formatBytes(), formatStorageSI(), handleCancelSubscription(), handleManageBilling(), handleReactivate(), upgradeCardFromFallback(), upgradeCardFromPlanMeta()

### Community 13 - "Community 13"
Cohesion: 0.14
Nodes (4): commitQuery(), handleSubmit(), loadRecent(), saveRecent()

### Community 14 - "Community 14"
Cohesion: 0.13
Nodes (5): onRegionChanged(), getPreference(), handleFilterChange(), handleLoadMore(), load()

### Community 15 - "Community 15"
Cohesion: 0.15
Nodes (6): notificationIcon(), toDisplay(), useNotifications(), useWebSocket(), useWsEvent(), WsProvider()

### Community 19 - "Community 19"
Cohesion: 0.27
Nodes (7): cacheFilePreview(), evictOldestPreviews(), getCachedFilePreview(), idbGet(), idbGetAll(), idbPut(), openPreviewDB()

### Community 20 - "Community 20"
Cohesion: 0.2
Nodes (4): downloadAsHtml(), escapeHtml(), generateRecoveryKitPDF(), handlePrint()

### Community 21 - "Community 21"
Cohesion: 0.32
Nodes (9): devAutoAuth(), cacheVaultKey(), clearVaultKey(), dbDelete(), dbGet(), dbPut(), getVaultKey(), initSessionVault() (+1 more)

### Community 23 - "Community 23"
Cohesion: 0.4
Nodes (10): clearVault(), computeKeyCheck(), dbClear(), dbGet(), dbPut(), deriveWrappingKey(), hasVault(), openDB() (+2 more)

### Community 24 - "Community 24"
Cohesion: 0.18
Nodes (5): handleResend(), handleVerify(), verifyEmail(), handleResend(), handleSubmit()

### Community 29 - "Community 29"
Cohesion: 0.22
Nodes (2): formatEta(), formatSpeed()

### Community 30 - "Community 30"
Cohesion: 0.22
Nodes (2): dayLabel(), groupByDay()

### Community 34 - "Community 34"
Cohesion: 0.33
Nodes (5): downloadDropboxFile(), expandDropboxPaths(), expandOne(), rateLimitedFetch(), sleepMs()

### Community 35 - "Community 35"
Cohesion: 0.28
Nodes (5): handleCodeSubmit(), handleRestore(), decryptFromQr(), deriveQrKey(), encryptForQr()

### Community 42 - "Community 42"
Cohesion: 0.25
Nodes (3): load(), handleDownloadCiphertext(), downloadFile()

### Community 43 - "Community 43"
Cohesion: 0.29
Nodes (4): copyToClipboard(), handleCopy(), handleRevoke(), revokeShare()

### Community 45 - "Community 45"
Cohesion: 0.29
Nodes (2): pipelineStage(), stageLabel()

### Community 54 - "Community 54"
Cohesion: 0.29
Nodes (3): ApiError, IncorrectPasswordError, SessionTooOldForConfirmationError

### Community 55 - "Community 55"
Cohesion: 0.38
Nodes (4): expandFolder(), expandGoogleDrivePaths(), GoogleAuthError, listGoogleDriveFolder()

### Community 56 - "Community 56"
Cohesion: 0.38
Nodes (3): getStored(), isValidDensity(), isValidFontSize()

### Community 57 - "Community 57"
Cohesion: 0.38
Nodes (5): allowsFunctional(), getConsent(), hasConsented(), setConsent(), update()

### Community 63 - "Community 63"
Cohesion: 0.33
Nodes (1): ErrorBoundary

### Community 65 - "Community 65"
Cohesion: 0.4
Nodes (2): computeStep(), writeLocalStep()

### Community 70 - "Community 70"
Cohesion: 0.4
Nodes (1): MemoryStorage

### Community 72 - "Community 72"
Cohesion: 0.5
Nodes (2): AnnouncementBanner(), severityClasses()

### Community 75 - "Community 75"
Cohesion: 0.5
Nodes (2): langLabel(), toShikiLang()

### Community 76 - "Community 76"
Cohesion: 0.4
Nodes (2): ImpersonationBanner(), useImpersonation()

### Community 77 - "Community 77"
Cohesion: 0.7
Nodes (4): FOLDER_COLOR_KEY(), getFolderColor(), getFolderColorDot(), setFolderColor()

### Community 78 - "Community 78"
Cohesion: 0.5
Nodes (2): Avatar(), getInitials()

### Community 87 - "Community 87"
Cohesion: 0.67
Nodes (2): signupAndUnlock(), uniqueEmail()

### Community 89 - "Community 89"
Cohesion: 0.83
Nodes (3): extractDroppedItems(), processEntries(), readDirectoryEntry()

### Community 91 - "Community 91"
Cohesion: 0.5
Nodes (2): handleSubmit(), reportShareLink()

### Community 94 - "Community 94"
Cohesion: 0.5
Nodes (1): poll()

### Community 95 - "Community 95"
Cohesion: 0.83
Nodes (3): getMenuItems(), getPendingItems(), SharedContextMenu()

### Community 99 - "Community 99"
Cohesion: 0.83
Nodes (3): clearTauriSession(), isTauri(), pushTauriSession()

### Community 105 - "Community 105"
Cohesion: 0.67
Nodes (1): ApiError

### Community 118 - "Community 118"
Cohesion: 1.0
Nodes (2): deriveSasWords(), fnv1a()

## Knowledge Gaps
- **Thin community `Community 29`** (10 nodes): `barColor()`, `borderColor()`, `computeEta()`, `computeSpeed()`, `formatChunkSize()`, `formatEta()`, `formatSpeed()`, `phaseLabel()`, `regionLabel()`, `upload-progress-card.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 30`** (10 nodes): `actionText()`, `dayLabel()`, `DeviceBadge()`, `groupByDay()`, `loadingMore()`, `matchesFilter()`, `metaFor()`, `timeLabel()`, `wsToActivity()`, `activity.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 45`** (8 nodes): `computeEta()`, `computeSpeed()`, `formatBytes()`, `formatEta()`, `formatSpeed()`, `pipelineStage()`, `stageLabel()`, `upload-progress.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 63`** (6 nodes): `ErrorBoundary`, `.componentDidCatch()`, `.constructor()`, `.getDerivedStateFromError()`, `.render()`, `error-boundary.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 65`** (6 nodes): `computeStep()`, `OnboardingProvider()`, `readLocalStep()`, `useOnboarding()`, `writeLocalStep()`, `onboarding-context.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 70`** (5 nodes): `MemoryStorage`, `.getItem()`, `.removeItem()`, `.setItem()`, `export-intent.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 72`** (5 nodes): `AnnouncementBanner()`, `readDismissed()`, `severityClasses()`, `writeDismissed()`, `announcement-banner.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 75`** (5 nodes): `langLabel()`, `loadShiki()`, `tokenStyle()`, `toShikiLang()`, `text-preview.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 76`** (5 nodes): `ImpersonationBanner()`, `ImpersonationProvider()`, `useImpersonation()`, `impersonation-banner.tsx`, `impersonation-context.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 78`** (5 nodes): `Avatar()`, `formatRelativeDate()`, `getInitials()`, `SecuredBadge()`, `public-profile.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 87`** (4 nodes): `escapeRegex()`, `signupAndUnlock()`, `refresh-stability.spec.ts`, `uniqueEmail()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 91`** (4 nodes): `handleKeyDown()`, `handleSubmit()`, `reportShareLink()`, `report-dialog.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 94`** (4 nodes): `colourFor()`, `initials()`, `poll()`, `presence-avatars.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 105`** (3 nodes): `ApiError`, `.constructor()`, `encrypted-upload-v2-contract.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 118`** (3 nodes): `deriveSasWords()`, `fnv1a()`, `sas-words.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `showToast()` connect `Community 1` to `Community 2`, `Community 4`, `Community 9`, `Community 10`, `Community 43`, `Community 12`, `Community 24`, `Community 91`?**
  _High betweenness centrality (0.058) - this node is a cross-community bridge._
- **Why does `request()` connect `Community 0` to `Community 24`, `Community 1`, `Community 3`, `Community 6`?**
  _High betweenness centrality (0.027) - this node is a cross-community bridge._
- **Why does `getApiUrl()` connect `Community 3` to `Community 0`, `Community 9`, `Community 6`?**
  _High betweenness centrality (0.020) - this node is a cross-community bridge._
- **Are the 101 inferred relationships involving `request()` (e.g. with `getApiUrl()` and `fireErrorNotifier()`) actually correct?**
  _`request()` has 101 INFERRED edges - model-reasoned connections that need verification._
- **Are the 64 inferred relationships involving `showToast()` (e.g. with `handleSubmit()` and `handleVerify()`) actually correct?**
  _`showToast()` has 64 INFERRED edges - model-reasoned connections that need verification._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.02 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.02 - nodes in this community are weakly interconnected._