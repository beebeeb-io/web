# Graph Report - web  (2026-06-05)

## Corpus Check
- 306 files · ~321,623 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1711 nodes · 2394 edges · 48 communities detected
- Extraction: 78% EXTRACTED · 22% INFERRED · 0% AMBIGUOUS · INFERRED: 520 edges (avg confidence: 0.8)
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
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 49|Community 49]]
- [[_COMMUNITY_Community 50|Community 50]]
- [[_COMMUNITY_Community 51|Community 51]]
- [[_COMMUNITY_Community 53|Community 53]]
- [[_COMMUNITY_Community 57|Community 57]]
- [[_COMMUNITY_Community 60|Community 60]]
- [[_COMMUNITY_Community 61|Community 61]]
- [[_COMMUNITY_Community 62|Community 62]]
- [[_COMMUNITY_Community 63|Community 63]]
- [[_COMMUNITY_Community 66|Community 66]]
- [[_COMMUNITY_Community 67|Community 67]]
- [[_COMMUNITY_Community 68|Community 68]]
- [[_COMMUNITY_Community 70|Community 70]]
- [[_COMMUNITY_Community 73|Community 73]]
- [[_COMMUNITY_Community 75|Community 75]]
- [[_COMMUNITY_Community 76|Community 76]]
- [[_COMMUNITY_Community 84|Community 84]]
- [[_COMMUNITY_Community 85|Community 85]]
- [[_COMMUNITY_Community 88|Community 88]]
- [[_COMMUNITY_Community 89|Community 89]]
- [[_COMMUNITY_Community 92|Community 92]]
- [[_COMMUNITY_Community 93|Community 93]]
- [[_COMMUNITY_Community 102|Community 102]]
- [[_COMMUNITY_Community 106|Community 106]]
- [[_COMMUNITY_Community 108|Community 108]]
- [[_COMMUNITY_Community 175|Community 175]]

## God Nodes (most connected - your core abstractions)
1. `request()` - 117 edges
2. `showToast()` - 59 edges
3. `takeObject()` - 36 edges
4. `getDataViewMemory0()` - 35 edges
5. `withProxy()` - 34 edges
6. `passArray8ToWasm0()` - 29 edges
7. `userFriendlyError()` - 21 edges
8. `encryptedUpload()` - 21 edges
9. `SyncClient` - 19 edges
10. `getArrayU8FromWasm0()` - 19 edges

## Surprising Connections (you probably didn't know these)
- `fetchAndDecryptLargeThumbnail()` --calls--> `getApiUrl()`  [INFERRED]
  src/lib/thumbnail.ts → packages/shared/src/api/config.ts
- `fetchAndDecryptThumbnail()` --calls--> `getApiUrl()`  [INFERRED]
  src/lib/thumbnail.ts → packages/shared/src/api/config.ts
- `opaqueRegisterStart()` --calls--> `request()`  [INFERRED]
  src/lib/api.ts → packages/shared/src/api/request.ts
- `opaqueLoginStart()` --calls--> `request()`  [INFERRED]
  src/lib/api.ts → packages/shared/src/api/request.ts
- `recoverOpaqueRegister()` --calls--> `request()`  [INFERRED]
  src/lib/api.ts → packages/shared/src/api/request.ts

## Communities

### Community 0 - "Community 0"
Cohesion: 0.02
Nodes (136): fireConnectionStatus(), fireErrorNotifier(), fireSessionExpired(), delay(), paceIfNeeded(), reportConnection(), request(), updateRateLimitState() (+128 more)

### Community 1 - "Community 1"
Cohesion: 0.02
Nodes (115): handleResend(), handleVerify(), handleNewFolder(), handleSubmit(), savePermissions(), setExpiry(), copyToClipboard(), handleCopy() (+107 more)

### Community 2 - "Community 2"
Cohesion: 0.05
Nodes (62): opaqueLoginFinish(), opaqueLoginStart(), autoUpgradeToV1(), computeRecoveryCheck(), decryptChunk(), decryptFilename(), decryptManyNames(), deriveFileKey() (+54 more)

### Community 3 - "Community 3"
Cohesion: 0.08
Nodes (63): addHeapObject(), compute_recovery_check(), debugString(), decodeText(), decompress_gzip(), decrypt_chunk(), decrypt_chunks(), decrypt_metadata() (+55 more)

### Community 4 - "Community 4"
Cohesion: 0.03
Nodes (27): BillingBanner(), BillingSuspendedOverlay(), FileList(), if(), timeAgo(), IncidentBanner(), NewFolderDialog(), notificationIcon() (+19 more)

### Community 5 - "Community 5"
Cohesion: 0.05
Nodes (37): getApiUrl(), decryptAll(), loadNames(), downloadSharedFile(), downloadVersion(), getFileRequestPublic(), listFiles(), uploadToFileRequest() (+29 more)

### Community 6 - "Community 6"
Cohesion: 0.07
Nodes (22): downloadDropboxFile(), expandDropboxPaths(), expandOne(), rateLimitedFetch(), sleepMs(), expandFolder(), expandGoogleDrivePaths(), GoogleAuthError (+14 more)

### Community 7 - "Community 7"
Cohesion: 0.08
Nodes (31): handleCodeSubmit(), handlePasskeyUnlock(), handleRestore(), base64urlToBuffer(), bufferToBase64url(), credentialToAuthenticationJSON(), credentialToRegistrationJSON(), deletePasskey() (+23 more)

### Community 8 - "Community 8"
Cohesion: 0.09
Nodes (25): uploadThumbnail(), uploadThumbnailLarge(), encryptedUpload(), withNetworkRetry(), encryptAndUploadLargeThumbnail(), encryptAndUploadThumbnail(), encryptThumbnailBlob(), fetchAndDecryptLargeThumbnail() (+17 more)

### Community 9 - "Community 9"
Cohesion: 0.08
Nodes (12): load(), createEmptyIndex(), decryptIndex(), deriveIndexKey(), encryptIndex(), fetchIndex(), saveIndex(), commitQuery() (+4 more)

### Community 10 - "Community 10"
Cohesion: 0.14
Nodes (8): getSyncOps(), submitSyncOps(), getDeviceId(), payloadToNode(), saveLastSeq(), savePendingOps(), SyncClient, uuid()

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
Cohesion: 0.15
Nodes (5): formatBytes(), formatStorageSI(), formatStorageSI(), upgradeCardFromFallback(), upgradeCardFromPlanMeta()

### Community 15 - "Community 15"
Cohesion: 0.36
Nodes (13): clearVault(), computeKeyCheck(), dbClear(), dbGet(), dbPut(), deriveWrappingKey(), hasVault(), importAesKey() (+5 more)

### Community 19 - "Community 19"
Cohesion: 0.17
Nodes (4): load(), handleDownloadCiphertext(), downloadFile(), handleLoadMore()

### Community 20 - "Community 20"
Cohesion: 0.32
Nodes (9): devAutoAuth(), cacheVaultKey(), clearVaultKey(), dbDelete(), dbGet(), dbPut(), getVaultKey(), initSessionVault() (+1 more)

### Community 22 - "Community 22"
Cohesion: 0.2
Nodes (2): dayLabel(), groupByDay()

### Community 27 - "Community 27"
Cohesion: 0.22
Nodes (2): formatEta(), formatSpeed()

### Community 37 - "Community 37"
Cohesion: 0.29
Nodes (2): pipelineStage(), stageLabel()

### Community 39 - "Community 39"
Cohesion: 0.25
Nodes (1): onRegionChanged()

### Community 49 - "Community 49"
Cohesion: 0.38
Nodes (3): getStored(), isValidDensity(), isValidFontSize()

### Community 50 - "Community 50"
Cohesion: 0.38
Nodes (3): consumePendingExport(), getPostLoginPath(), hasPendingExport()

### Community 51 - "Community 51"
Cohesion: 0.38
Nodes (5): allowsFunctional(), getConsent(), hasConsented(), setConsent(), update()

### Community 53 - "Community 53"
Cohesion: 0.29
Nodes (3): ApiError, IncorrectPasswordError, SessionTooOldForConfirmationError

### Community 57 - "Community 57"
Cohesion: 0.4
Nodes (2): computeStep(), writeLocalStep()

### Community 60 - "Community 60"
Cohesion: 0.4
Nodes (2): fromBase64url(), readRequestPublicKey()

### Community 61 - "Community 61"
Cohesion: 0.33
Nodes (1): ErrorBoundary

### Community 62 - "Community 62"
Cohesion: 0.4
Nodes (2): decodeAndConvert(), pcmToWavBlob()

### Community 63 - "Community 63"
Cohesion: 0.47
Nodes (4): ensureLang(), getHighlighter(), langLabel(), toShikiLang()

### Community 66 - "Community 66"
Cohesion: 0.4
Nodes (1): MemoryStorage

### Community 67 - "Community 67"
Cohesion: 0.7
Nodes (4): FOLDER_COLOR_KEY(), getFolderColor(), getFolderColorDot(), setFolderColor()

### Community 68 - "Community 68"
Cohesion: 0.4
Nodes (2): ImpersonationBanner(), useImpersonation()

### Community 70 - "Community 70"
Cohesion: 0.5
Nodes (2): Avatar(), getInitials()

### Community 73 - "Community 73"
Cohesion: 0.5
Nodes (2): AnnouncementBanner(), severityClasses()

### Community 75 - "Community 75"
Cohesion: 0.5
Nodes (2): hashString(), pickIndicesFromPhrase()

### Community 76 - "Community 76"
Cohesion: 0.5
Nodes (2): getExtension(), getMimeLabel()

### Community 84 - "Community 84"
Cohesion: 0.67
Nodes (2): signupAndUnlock(), uniqueEmail()

### Community 85 - "Community 85"
Cohesion: 0.83
Nodes (3): clearTauriSession(), isTauri(), pushTauriSession()

### Community 88 - "Community 88"
Cohesion: 0.83
Nodes (3): extractDroppedItems(), processEntries(), readDirectoryEntry()

### Community 89 - "Community 89"
Cohesion: 0.5
Nodes (2): ContextMenu(), isPreviewable()

### Community 92 - "Community 92"
Cohesion: 0.5
Nodes (1): poll()

### Community 93 - "Community 93"
Cohesion: 0.83
Nodes (3): getMenuItems(), getPendingItems(), SharedContextMenu()

### Community 102 - "Community 102"
Cohesion: 0.67
Nodes (1): ApiError

### Community 106 - "Community 106"
Cohesion: 1.0
Nodes (2): deriveSasWords(), fnv1a()

### Community 108 - "Community 108"
Cohesion: 1.0
Nodes (2): ch(), migratePreferences()

### Community 175 - "Community 175"
Cohesion: 1.0
Nodes (1): WasmChunkEncryptor

## Knowledge Gaps
- **1 isolated node(s):** `WasmChunkEncryptor`
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 22`** (11 nodes): `actionText()`, `dayLabel()`, `DeviceBadge()`, `groupByDay()`, `isAlarmingEvent()`, `isSecurityEvent()`, `loadingMore()`, `metaFor()`, `timeLabel()`, `wsToActivity()`, `activity.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 27`** (10 nodes): `barColor()`, `borderColor()`, `computeEta()`, `computeSpeed()`, `formatChunkSize()`, `formatEta()`, `formatSpeed()`, `phaseLabel()`, `regionLabel()`, `upload-progress-card.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 37`** (8 nodes): `computeEta()`, `computeSpeed()`, `formatBytes()`, `formatEta()`, `formatSpeed()`, `pipelineStage()`, `stageLabel()`, `upload-progress.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 39`** (8 nodes): `formatStorageSI()`, `onDown()`, `onFileUploaded()`, `onKey()`, `onRegionChanged()`, `pruned()`, `PwaInstallBanner()`, `drive-layout.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 57`** (6 nodes): `computeStep()`, `OnboardingProvider()`, `readLocalStep()`, `useOnboarding()`, `writeLocalStep()`, `onboarding-context.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 60`** (6 nodes): `formatBytes()`, `fromBase64url()`, `onDrop()`, `prevent()`, `readRequestPublicKey()`, `upload-request.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 61`** (6 nodes): `ErrorBoundary`, `.componentDidCatch()`, `.constructor()`, `.getDerivedStateFromError()`, `.render()`, `error-boundary.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 62`** (6 nodes): `decodeAndConvert()`, `formatTime()`, `handleSeek()`, `pcmToWavBlob()`, `togglePlay()`, `audio-preview.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 66`** (5 nodes): `MemoryStorage`, `.getItem()`, `.removeItem()`, `.setItem()`, `export-intent.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 68`** (5 nodes): `ImpersonationBanner()`, `ImpersonationProvider()`, `useImpersonation()`, `impersonation-banner.tsx`, `impersonation-context.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 70`** (5 nodes): `Avatar()`, `formatRelativeDate()`, `getInitials()`, `SecuredBadge()`, `public-profile.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 73`** (5 nodes): `AnnouncementBanner()`, `readDismissed()`, `severityClasses()`, `writeDismissed()`, `announcement-banner.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 75`** (5 nodes): `handleChange()`, `handleVerify()`, `hashString()`, `pickIndicesFromPhrase()`, `mnemonic-verify.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 76`** (5 nodes): `formatSize()`, `getExtension()`, `getMimeLabel()`, `handleDownload()`, `unsupported-preview.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 84`** (4 nodes): `escapeRegex()`, `signupAndUnlock()`, `refresh-stability.spec.ts`, `uniqueEmail()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 89`** (4 nodes): `ContextMenu()`, `isPreviewable()`, `context-menu.tsx`, `preview.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 92`** (4 nodes): `colourFor()`, `initials()`, `poll()`, `presence-avatars.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 102`** (3 nodes): `ApiError`, `.constructor()`, `encrypted-upload-v2-contract.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 106`** (3 nodes): `deriveSasWords()`, `fnv1a()`, `sas-words.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 108`** (3 nodes): `ch()`, `migratePreferences()`, `notifications.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 175`** (2 nodes): `WasmChunkEncryptor`, `beebeeb_wasm.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `handleFolderFilesSelected()` connect `Community 1` to `Community 8`, `Community 4`?**
  _High betweenness centrality (0.070) - this node is a cross-community bridge._
- **Why does `Billing()` connect `Community 3` to `Community 4`, `Community 14`?**
  _High betweenness centrality (0.059) - this node is a cross-community bridge._
- **Are the 112 inferred relationships involving `request()` (e.g. with `opaqueRegisterStart()` and `opaqueLoginStart()`) actually correct?**
  _`request()` has 112 INFERRED edges - model-reasoned connections that need verification._
- **Are the 55 inferred relationships involving `showToast()` (e.g. with `doEncryptedUpload()` and `handleDownload()`) actually correct?**
  _`showToast()` has 55 INFERRED edges - model-reasoned connections that need verification._
- **What connects `WasmChunkEncryptor` to the rest of the system?**
  _1 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.02 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.02 - nodes in this community are weakly interconnected._