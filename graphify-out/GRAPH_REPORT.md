# Graph Report - web  (2026-05-15)

## Corpus Check
- 279 files · ~276,521 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1533 nodes · 1987 edges · 48 communities detected
- Extraction: 78% EXTRACTED · 22% INFERRED · 0% AMBIGUOUS · INFERRED: 438 edges (avg confidence: 0.8)
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
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 44|Community 44]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 47|Community 47]]
- [[_COMMUNITY_Community 56|Community 56]]
- [[_COMMUNITY_Community 57|Community 57]]
- [[_COMMUNITY_Community 58|Community 58]]
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
- [[_COMMUNITY_Community 94|Community 94]]
- [[_COMMUNITY_Community 95|Community 95]]
- [[_COMMUNITY_Community 99|Community 99]]
- [[_COMMUNITY_Community 105|Community 105]]
- [[_COMMUNITY_Community 117|Community 117]]

## God Nodes (most connected - your core abstractions)
1. `request()` - 104 edges
2. `showToast()` - 69 edges
3. `takeFromExternrefTable0()` - 19 edges
4. `SyncClient` - 19 edges
5. `getProxy()` - 19 edges
6. `passArray8ToWasm0()` - 17 edges
7. `encryptedUpload()` - 17 edges
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
Nodes (123): fireConnectionStatus(), fireErrorNotifier(), fireSessionExpired(), delay(), reportConnection(), request(), load(), acceptWorkspaceInvite() (+115 more)

### Community 1 - "Community 1"
Cohesion: 0.03
Nodes (79): commitInlineRename(), handleTogglePin(), handleNewFolder(), loadNames(), handleSubmit(), handleDelete(), handleDownload(), handleRestore() (+71 more)

### Community 2 - "Community 2"
Cohesion: 0.09
Nodes (38): decryptOne(), computeRecoveryCheck(), decryptChunk(), decryptFilename(), deriveFileKey(), deriveKeys(), deriveShareKey(), deriveX25519Private() (+30 more)

### Community 3 - "Community 3"
Cohesion: 0.06
Nodes (23): getApiUrl(), decryptAll(), downloadSharedFile(), downloadVersion(), listFiles(), downloadAsZip(), expandToFiles(), decryptFileMetadata() (+15 more)

### Community 4 - "Community 4"
Cohesion: 0.07
Nodes (22): downloadDropboxFile(), expandDropboxPaths(), expandOne(), rateLimitedFetch(), sleepMs(), expandFolder(), expandGoogleDrivePaths(), GoogleAuthError (+14 more)

### Community 5 - "Community 5"
Cohesion: 0.16
Nodes (35): addToExternrefTable0(), compute_recovery_check(), debugString(), decodeText(), decrypt_chunk(), decrypt_metadata(), derive_file_key(), derive_master_key() (+27 more)

### Community 6 - "Community 6"
Cohesion: 0.06
Nodes (16): ContextMenu(), decryptAll(), displayName(), handleCheckboxClick(), handleRowClick(), if(), safeName(), toggleSelection() (+8 more)

### Community 7 - "Community 7"
Cohesion: 0.08
Nodes (12): load(), createEmptyIndex(), decryptIndex(), deriveIndexKey(), encryptIndex(), fetchIndex(), saveIndex(), commitQuery() (+4 more)

### Community 8 - "Community 8"
Cohesion: 0.14
Nodes (8): getSyncOps(), submitSyncOps(), getDeviceId(), payloadToNode(), saveLastSeq(), savePendingOps(), SyncClient, uuid()

### Community 9 - "Community 9"
Cohesion: 0.08
Nodes (12): NewFolderDialog(), RenameDialog(), SessionTimeoutWarning(), StepUpAuth(), useToast(), useFocusTrap(), logout(), consumePendingExport() (+4 more)

### Community 10 - "Community 10"
Cohesion: 0.11
Nodes (24): base64urlToBuffer(), bufferToBase64url(), credentialToAuthenticationJSON(), credentialToRegistrationJSON(), deletePasskey(), finishPasskeyLogin(), getVaultKeyEscrow(), listPasskeys() (+16 more)

### Community 11 - "Community 11"
Cohesion: 0.11
Nodes (16): uploadThumbnail(), encryptedUpload(), encryptAndUploadThumbnail(), fetchAndDecryptThumbnail(), generateThumbnail(), isImageType(), computeFingerprint(), findByFingerprint() (+8 more)

### Community 12 - "Community 12"
Cohesion: 0.1
Nodes (12): confirmAction(), getSharesForFile(), permanentDeleteFile(), restoreFile(), loadActivity(), buildDetailsMeta(), displayName(), handleRestore() (+4 more)

### Community 13 - "Community 13"
Cohesion: 0.11
Nodes (3): Row(), AndroidKeyboard(), IOSKeyboard()

### Community 14 - "Community 14"
Cohesion: 0.12
Nodes (8): createPortalSession(), formatBytes(), formatStorageSI(), handleCancelSubscription(), handleManageBilling(), handleReactivate(), upgradeCardFromFallback(), upgradeCardFromPlanMeta()

### Community 15 - "Community 15"
Cohesion: 0.18
Nodes (11): clearSession(), dbDelete(), dbGet(), dbPut(), deriveKey(), getVaultTTL(), openDB(), persistSession() (+3 more)

### Community 16 - "Community 16"
Cohesion: 0.13
Nodes (5): onRegionChanged(), getPreference(), handleFilterChange(), handleLoadMore(), load()

### Community 17 - "Community 17"
Cohesion: 0.15
Nodes (6): notificationIcon(), toDisplay(), useNotifications(), useWebSocket(), useWsEvent(), WsProvider()

### Community 20 - "Community 20"
Cohesion: 0.18
Nodes (5): downloadAsHtml(), escapeHtml(), generateRecoveryKitPDF(), handlePrint(), formatBytes()

### Community 22 - "Community 22"
Cohesion: 0.27
Nodes (7): cacheFilePreview(), evictOldestPreviews(), getCachedFilePreview(), idbGet(), idbGetAll(), idbPut(), openPreviewDB()

### Community 23 - "Community 23"
Cohesion: 0.32
Nodes (9): devAutoAuth(), cacheVaultKey(), clearVaultKey(), dbDelete(), dbGet(), dbPut(), getVaultKey(), initSessionVault() (+1 more)

### Community 25 - "Community 25"
Cohesion: 0.4
Nodes (10): clearVault(), computeKeyCheck(), dbClear(), dbGet(), dbPut(), deriveWrappingKey(), hasVault(), openDB() (+2 more)

### Community 26 - "Community 26"
Cohesion: 0.18
Nodes (5): handleResend(), handleVerify(), resendVerification(), handleResend(), handleSubmit()

### Community 31 - "Community 31"
Cohesion: 0.22
Nodes (2): formatEta(), formatSpeed()

### Community 32 - "Community 32"
Cohesion: 0.22
Nodes (2): dayLabel(), groupByDay()

### Community 36 - "Community 36"
Cohesion: 0.28
Nodes (5): handleCodeSubmit(), handleRestore(), decryptFromQr(), deriveQrKey(), encryptForQr()

### Community 43 - "Community 43"
Cohesion: 0.29
Nodes (3): savePermissions(), setExpiry(), patchInvite()

### Community 44 - "Community 44"
Cohesion: 0.25
Nodes (3): load(), handleDownloadCiphertext(), downloadFile()

### Community 45 - "Community 45"
Cohesion: 0.29
Nodes (4): copyToClipboard(), handleCopy(), handleRevoke(), revokeShare()

### Community 47 - "Community 47"
Cohesion: 0.29
Nodes (2): pipelineStage(), stageLabel()

### Community 56 - "Community 56"
Cohesion: 0.29
Nodes (3): ApiError, IncorrectPasswordError, SessionTooOldForConfirmationError

### Community 57 - "Community 57"
Cohesion: 0.38
Nodes (3): getStored(), isValidDensity(), isValidFontSize()

### Community 58 - "Community 58"
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

### Community 117 - "Community 117"
Cohesion: 1.0
Nodes (2): deriveSasWords(), fnv1a()

## Knowledge Gaps
- **Thin community `Community 31`** (10 nodes): `barColor()`, `borderColor()`, `computeEta()`, `computeSpeed()`, `formatChunkSize()`, `formatEta()`, `formatSpeed()`, `phaseLabel()`, `regionLabel()`, `upload-progress-card.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 32`** (10 nodes): `actionText()`, `dayLabel()`, `DeviceBadge()`, `groupByDay()`, `loadingMore()`, `matchesFilter()`, `metaFor()`, `timeLabel()`, `wsToActivity()`, `activity.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 47`** (8 nodes): `computeEta()`, `computeSpeed()`, `formatBytes()`, `formatEta()`, `formatSpeed()`, `pipelineStage()`, `stageLabel()`, `upload-progress.tsx`
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
- **Thin community `Community 94`** (4 nodes): `colourFor()`, `initials()`, `poll()`, `presence-avatars.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 105`** (3 nodes): `ApiError`, `.constructor()`, `encrypted-upload-v2-contract.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 117`** (3 nodes): `deriveSasWords()`, `fnv1a()`, `sas-words.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `showToast()` connect `Community 1` to `Community 2`, `Community 4`, `Community 6`, `Community 43`, `Community 11`, `Community 45`, `Community 14`, `Community 12`, `Community 15`, `Community 26`?**
  _High betweenness centrality (0.072) - this node is a cross-community bridge._
- **Why does `request()` connect `Community 0` to `Community 1`, `Community 3`, `Community 8`, `Community 43`, `Community 26`?**
  _High betweenness centrality (0.028) - this node is a cross-community bridge._
- **Why does `getApiUrl()` connect `Community 3` to `Community 0`, `Community 8`, `Community 11`, `Community 7`?**
  _High betweenness centrality (0.024) - this node is a cross-community bridge._
- **Are the 101 inferred relationships involving `request()` (e.g. with `getApiUrl()` and `fireErrorNotifier()`) actually correct?**
  _`request()` has 101 INFERRED edges - model-reasoned connections that need verification._
- **Are the 65 inferred relationships involving `showToast()` (e.g. with `handleSubmit()` and `handleVerify()`) actually correct?**
  _`showToast()` has 65 INFERRED edges - model-reasoned connections that need verification._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.02 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.03 - nodes in this community are weakly interconnected._