# Graph Report - web  (2026-06-10)

## Corpus Check
- 320 files · ~342,345 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1740 nodes · 2430 edges · 56 communities detected
- Extraction: 78% EXTRACTED · 22% INFERRED · 0% AMBIGUOUS · INFERRED: 537 edges (avg confidence: 0.8)
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
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 53|Community 53]]
- [[_COMMUNITY_Community 54|Community 54]]
- [[_COMMUNITY_Community 56|Community 56]]
- [[_COMMUNITY_Community 57|Community 57]]
- [[_COMMUNITY_Community 58|Community 58]]
- [[_COMMUNITY_Community 61|Community 61]]
- [[_COMMUNITY_Community 62|Community 62]]
- [[_COMMUNITY_Community 63|Community 63]]
- [[_COMMUNITY_Community 64|Community 64]]
- [[_COMMUNITY_Community 65|Community 65]]
- [[_COMMUNITY_Community 67|Community 67]]
- [[_COMMUNITY_Community 68|Community 68]]
- [[_COMMUNITY_Community 72|Community 72]]
- [[_COMMUNITY_Community 73|Community 73]]
- [[_COMMUNITY_Community 75|Community 75]]
- [[_COMMUNITY_Community 76|Community 76]]
- [[_COMMUNITY_Community 79|Community 79]]
- [[_COMMUNITY_Community 80|Community 80]]
- [[_COMMUNITY_Community 81|Community 81]]
- [[_COMMUNITY_Community 90|Community 90]]
- [[_COMMUNITY_Community 91|Community 91]]
- [[_COMMUNITY_Community 93|Community 93]]
- [[_COMMUNITY_Community 95|Community 95]]
- [[_COMMUNITY_Community 96|Community 96]]
- [[_COMMUNITY_Community 99|Community 99]]
- [[_COMMUNITY_Community 100|Community 100]]
- [[_COMMUNITY_Community 107|Community 107]]
- [[_COMMUNITY_Community 119|Community 119]]
- [[_COMMUNITY_Community 122|Community 122]]
- [[_COMMUNITY_Community 127|Community 127]]

## God Nodes (most connected - your core abstractions)
1. `request()` - 119 edges
2. `showToast()` - 60 edges
3. `getDataViewMemory0()` - 36 edges
4. `takeObject()` - 36 edges
5. `withProxy()` - 35 edges
6. `passArray8ToWasm0()` - 29 edges
7. `encryptedUpload()` - 21 edges
8. `userFriendlyError()` - 21 edges
9. `getArrayU8FromWasm0()` - 19 edges
10. `SyncClient` - 19 edges

## Surprising Connections (you probably didn't know these)
- `opaqueRegisterStart()` --calls--> `request()`  [INFERRED]
  src/lib/api.ts → packages/shared/src/api/request.ts
- `opaqueLoginStart()` --calls--> `request()`  [INFERRED]
  src/lib/api.ts → packages/shared/src/api/request.ts
- `recoverOpaqueRegister()` --calls--> `request()`  [INFERRED]
  src/lib/api.ts → packages/shared/src/api/request.ts
- `setup2fa()` --calls--> `request()`  [INFERRED]
  src/lib/api.ts → packages/shared/src/api/request.ts
- `disable2fa()` --calls--> `request()`  [INFERRED]
  src/lib/api.ts → packages/shared/src/api/request.ts

## Communities

### Community 0 - "Community 0"
Cohesion: 0.02
Nodes (139): clearSessionConfirmed(), fireConnectionStatus(), fireErrorNotifier(), fireSessionExpired(), markSessionConfirmed(), wasSessionConfirmed(), delay(), paceIfNeeded() (+131 more)

### Community 1 - "Community 1"
Cohesion: 0.04
Nodes (78): handleResend(), handleVerify(), handleNewFolder(), handleSubmit(), createFolder(), deleteFile(), removeWorkspaceMember(), reportShareLink() (+70 more)

### Community 2 - "Community 2"
Cohesion: 0.04
Nodes (70): attachFreshToken(), handleCopy(), opaqueLoginFinish(), opaqueLoginStart(), autoUpgradeToV1(), computeRecoveryCheck(), decryptChunk(), decryptFileMetadata() (+62 more)

### Community 3 - "Community 3"
Cohesion: 0.08
Nodes (64): addHeapObject(), compute_recovery_check(), debugString(), decodeText(), decompress_gzip(), decrypt_chunk(), decrypt_chunks(), decrypt_metadata() (+56 more)

### Community 4 - "Community 4"
Cohesion: 0.03
Nodes (30): BillingBanner(), BillingSuspendedOverlay(), FileList(), if(), timeAgo(), IncidentBanner(), NewFolderDialog(), notificationIcon() (+22 more)

### Community 5 - "Community 5"
Cohesion: 0.06
Nodes (23): getApiUrl(), load(), downloadVersion(), getFileRequestPublic(), getSyncOps(), submitSyncOps(), uploadToFileRequest(), createEmptyIndex() (+15 more)

### Community 6 - "Community 6"
Cohesion: 0.07
Nodes (35): handleCodeSubmit(), handlePasskeyUnlock(), handleRestore(), base64urlToBuffer(), bufferToBase64url(), credentialToAuthenticationJSON(), credentialToRegistrationJSON(), deletePasskey() (+27 more)

### Community 7 - "Community 7"
Cohesion: 0.07
Nodes (22): downloadDropboxFile(), expandDropboxPaths(), expandOne(), rateLimitedFetch(), sleepMs(), expandFolder(), expandGoogleDrivePaths(), GoogleAuthError (+14 more)

### Community 8 - "Community 8"
Cohesion: 0.08
Nodes (29): handleDownload(), downloadSharedFile(), listFiles(), canStreamToServiceWorker(), createBlobSink(), createSwSink(), downloadAsZip(), expandToFiles() (+21 more)

### Community 9 - "Community 9"
Cohesion: 0.08
Nodes (25): uploadThumbnail(), uploadThumbnailLarge(), encryptedUpload(), withNetworkRetry(), encryptAndUploadLargeThumbnail(), encryptAndUploadThumbnail(), encryptThumbnailBlob(), fetchAndDecryptThumbnail() (+17 more)

### Community 10 - "Community 10"
Cohesion: 0.08
Nodes (15): handleDelete(), handleRestore(), timeAgo(), confirmAction(), getSharesForFile(), permanentDeleteFile(), restoreFile(), loadActivity() (+7 more)

### Community 11 - "Community 11"
Cohesion: 0.23
Nodes (18): cacheFileList(), cacheFilePreview(), enforceRowCap(), evictOldestPreviews(), fileListDelete(), fileListGet(), fileListGetAll(), fileListPut() (+10 more)

### Community 12 - "Community 12"
Cohesion: 0.11
Nodes (3): Row(), AndroidKeyboard(), IOSKeyboard()

### Community 13 - "Community 13"
Cohesion: 0.18
Nodes (11): clearSession(), dbDelete(), dbGet(), dbPut(), deriveKey(), getVaultTTL(), openDB(), persistSession() (+3 more)

### Community 14 - "Community 14"
Cohesion: 0.14
Nodes (4): commitQuery(), handleSubmit(), loadRecent(), saveRecent()

### Community 15 - "Community 15"
Cohesion: 0.15
Nodes (5): formatBytes(), formatStorageSI(), formatStorageSI(), upgradeCardFromFallback(), upgradeCardFromPlanMeta()

### Community 16 - "Community 16"
Cohesion: 0.36
Nodes (13): clearVault(), computeKeyCheck(), dbClear(), dbGet(), dbPut(), deriveWrappingKey(), hasVault(), importAesKey() (+5 more)

### Community 20 - "Community 20"
Cohesion: 0.17
Nodes (4): load(), handleDownloadCiphertext(), downloadFile(), handleLoadMore()

### Community 21 - "Community 21"
Cohesion: 0.32
Nodes (9): devAutoAuth(), cacheVaultKey(), clearVaultKey(), dbDelete(), dbGet(), dbPut(), getVaultKey(), initSessionVault() (+1 more)

### Community 23 - "Community 23"
Cohesion: 0.29
Nodes (6): escapeRe(), openImagePreview(), openPreview(), previewImage(), previewOverlay(), uploadAndWait()

### Community 24 - "Community 24"
Cohesion: 0.2
Nodes (2): dayLabel(), groupByDay()

### Community 29 - "Community 29"
Cohesion: 0.22
Nodes (2): formatEta(), formatSpeed()

### Community 39 - "Community 39"
Cohesion: 0.29
Nodes (3): savePermissions(), setExpiry(), patchInvite()

### Community 40 - "Community 40"
Cohesion: 0.25
Nodes (1): onRegionChanged()

### Community 41 - "Community 41"
Cohesion: 0.29
Nodes (4): copyToClipboard(), handleCopy(), handleRevoke(), revokeShare()

### Community 43 - "Community 43"
Cohesion: 0.29
Nodes (2): pipelineStage(), stageLabel()

### Community 53 - "Community 53"
Cohesion: 0.29
Nodes (3): ApiError, IncorrectPasswordError, SessionTooOldForConfirmationError

### Community 54 - "Community 54"
Cohesion: 0.29
Nodes (1): decryptAll()

### Community 56 - "Community 56"
Cohesion: 0.38
Nodes (5): allowsFunctional(), getConsent(), hasConsented(), setConsent(), update()

### Community 57 - "Community 57"
Cohesion: 0.38
Nodes (3): getStored(), isValidDensity(), isValidFontSize()

### Community 58 - "Community 58"
Cohesion: 0.38
Nodes (3): consumePendingExport(), getPostLoginPath(), hasPendingExport()

### Community 61 - "Community 61"
Cohesion: 0.4
Nodes (3): openManageShares(), createShareLink(), openRowMenu()

### Community 62 - "Community 62"
Cohesion: 0.33
Nodes (1): ErrorBoundary

### Community 63 - "Community 63"
Cohesion: 0.33
Nodes (1): loadNames()

### Community 64 - "Community 64"
Cohesion: 0.4
Nodes (2): decodeAndConvert(), pcmToWavBlob()

### Community 65 - "Community 65"
Cohesion: 0.47
Nodes (4): ensureLang(), getHighlighter(), langLabel(), toShikiLang()

### Community 67 - "Community 67"
Cohesion: 0.4
Nodes (2): computeStep(), writeLocalStep()

### Community 68 - "Community 68"
Cohesion: 0.4
Nodes (2): fromBase64url(), readRequestPublicKey()

### Community 72 - "Community 72"
Cohesion: 0.4
Nodes (1): MemoryStorage

### Community 73 - "Community 73"
Cohesion: 0.4
Nodes (2): ImpersonationBanner(), useImpersonation()

### Community 75 - "Community 75"
Cohesion: 0.5
Nodes (2): hashString(), pickIndicesFromPhrase()

### Community 76 - "Community 76"
Cohesion: 0.5
Nodes (2): AnnouncementBanner(), severityClasses()

### Community 79 - "Community 79"
Cohesion: 0.5
Nodes (2): getExtension(), getMimeLabel()

### Community 80 - "Community 80"
Cohesion: 0.7
Nodes (4): FOLDER_COLOR_KEY(), getFolderColor(), getFolderColorDot(), setFolderColor()

### Community 81 - "Community 81"
Cohesion: 0.5
Nodes (2): Avatar(), getInitials()

### Community 90 - "Community 90"
Cohesion: 0.67
Nodes (2): signUp(), uniqueEmail()

### Community 91 - "Community 91"
Cohesion: 0.67
Nodes (2): signupAndUnlock(), uniqueEmail()

### Community 93 - "Community 93"
Cohesion: 0.83
Nodes (3): extractDroppedItems(), processEntries(), readDirectoryEntry()

### Community 95 - "Community 95"
Cohesion: 0.5
Nodes (1): poll()

### Community 96 - "Community 96"
Cohesion: 0.83
Nodes (3): getMenuItems(), getPendingItems(), SharedContextMenu()

### Community 99 - "Community 99"
Cohesion: 0.83
Nodes (3): clearTauriSession(), isTauri(), pushTauriSession()

### Community 100 - "Community 100"
Cohesion: 0.5
Nodes (2): ContextMenu(), isPreviewable()

### Community 107 - "Community 107"
Cohesion: 0.67
Nodes (1): ApiError

### Community 119 - "Community 119"
Cohesion: 1.0
Nodes (2): deriveSasWords(), fnv1a()

### Community 122 - "Community 122"
Cohesion: 1.0
Nodes (2): ch(), migratePreferences()

### Community 127 - "Community 127"
Cohesion: 1.0
Nodes (1): WasmChunkEncryptor

## Knowledge Gaps
- **1 isolated node(s):** `WasmChunkEncryptor`
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 24`** (11 nodes): `actionText()`, `dayLabel()`, `DeviceBadge()`, `groupByDay()`, `isAlarmingEvent()`, `isSecurityEvent()`, `loadingMore()`, `metaFor()`, `timeLabel()`, `wsToActivity()`, `activity.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 29`** (10 nodes): `barColor()`, `borderColor()`, `computeEta()`, `computeSpeed()`, `formatChunkSize()`, `formatEta()`, `formatSpeed()`, `phaseLabel()`, `regionLabel()`, `upload-progress-card.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 40`** (8 nodes): `formatStorageSI()`, `onDown()`, `onFileUploaded()`, `onKey()`, `onRegionChanged()`, `pruned()`, `PwaInstallBanner()`, `drive-layout.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 43`** (8 nodes): `computeEta()`, `computeSpeed()`, `formatBytes()`, `formatEta()`, `formatSpeed()`, `pipelineStage()`, `stageLabel()`, `upload-progress.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 54`** (7 nodes): `decryptAll()`, `displayName()`, `handleBreadcrumbNav()`, `handleConfirm()`, `handleFolderOpen()`, `handleKey()`, `move-modal.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 62`** (6 nodes): `ErrorBoundary`, `.componentDidCatch()`, `.constructor()`, `.getDerivedStateFromError()`, `.render()`, `error-boundary.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 63`** (6 nodes): `handleDragLeave()`, `handleDragOver()`, `handleDrop()`, `loadNames()`, `onColorChanged()`, `quick-access.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 64`** (6 nodes): `decodeAndConvert()`, `formatTime()`, `handleSeek()`, `pcmToWavBlob()`, `togglePlay()`, `audio-preview.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 67`** (6 nodes): `computeStep()`, `OnboardingProvider()`, `readLocalStep()`, `useOnboarding()`, `writeLocalStep()`, `onboarding-context.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 68`** (6 nodes): `formatBytes()`, `fromBase64url()`, `onDrop()`, `prevent()`, `readRequestPublicKey()`, `upload-request.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 72`** (5 nodes): `MemoryStorage`, `.getItem()`, `.removeItem()`, `.setItem()`, `export-intent.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 73`** (5 nodes): `ImpersonationBanner()`, `ImpersonationProvider()`, `useImpersonation()`, `impersonation-banner.tsx`, `impersonation-context.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 75`** (5 nodes): `handleChange()`, `handleVerify()`, `hashString()`, `pickIndicesFromPhrase()`, `mnemonic-verify.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 76`** (5 nodes): `AnnouncementBanner()`, `readDismissed()`, `severityClasses()`, `writeDismissed()`, `announcement-banner.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 79`** (5 nodes): `formatSize()`, `getExtension()`, `getMimeLabel()`, `handleDownload()`, `unsupported-preview.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 81`** (5 nodes): `Avatar()`, `formatRelativeDate()`, `getInitials()`, `SecuredBadge()`, `public-profile.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 90`** (4 nodes): `blockDevAutoLogin()`, `signUp()`, `cli-auth-redirect.spec.ts`, `uniqueEmail()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 91`** (4 nodes): `escapeRegex()`, `signupAndUnlock()`, `refresh-stability.spec.ts`, `uniqueEmail()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 95`** (4 nodes): `colourFor()`, `initials()`, `poll()`, `presence-avatars.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 100`** (4 nodes): `ContextMenu()`, `isPreviewable()`, `context-menu.tsx`, `preview.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 107`** (3 nodes): `ApiError`, `.constructor()`, `encrypted-upload-v2-contract.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 119`** (3 nodes): `deriveSasWords()`, `fnv1a()`, `sas-words.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 122`** (3 nodes): `ch()`, `migratePreferences()`, `notifications.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 127`** (2 nodes): `WasmChunkEncryptor`, `beebeeb_wasm.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `handleFolderFilesSelected()` connect `Community 1` to `Community 9`, `Community 4`?**
  _High betweenness centrality (0.072) - this node is a cross-community bridge._
- **Why does `showToast()` connect `Community 1` to `Community 2`, `Community 4`, `Community 39`, `Community 8`, `Community 41`, `Community 10`, `Community 9`, `Community 7`, `Community 13`?**
  _High betweenness centrality (0.066) - this node is a cross-community bridge._
- **Are the 114 inferred relationships involving `request()` (e.g. with `getApiUrl()` and `fireErrorNotifier()`) actually correct?**
  _`request()` has 114 INFERRED edges - model-reasoned connections that need verification._
- **Are the 56 inferred relationships involving `showToast()` (e.g. with `handleCopy()` and `handleSubmit()`) actually correct?**
  _`showToast()` has 56 INFERRED edges - model-reasoned connections that need verification._
- **What connects `WasmChunkEncryptor` to the rest of the system?**
  _1 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.02 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.04 - nodes in this community are weakly interconnected._