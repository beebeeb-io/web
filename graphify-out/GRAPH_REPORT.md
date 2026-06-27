# Graph Report - web  (2026-06-27)

## Corpus Check
- 344 files · ~379,210 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1846 nodes · 2594 edges · 56 communities detected
- Extraction: 78% EXTRACTED · 22% INFERRED · 0% AMBIGUOUS · INFERRED: 562 edges (avg confidence: 0.8)
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
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 52|Community 52]]
- [[_COMMUNITY_Community 53|Community 53]]
- [[_COMMUNITY_Community 55|Community 55]]
- [[_COMMUNITY_Community 58|Community 58]]
- [[_COMMUNITY_Community 59|Community 59]]
- [[_COMMUNITY_Community 60|Community 60]]
- [[_COMMUNITY_Community 62|Community 62]]
- [[_COMMUNITY_Community 64|Community 64]]
- [[_COMMUNITY_Community 65|Community 65]]
- [[_COMMUNITY_Community 66|Community 66]]
- [[_COMMUNITY_Community 67|Community 67]]
- [[_COMMUNITY_Community 70|Community 70]]
- [[_COMMUNITY_Community 72|Community 72]]
- [[_COMMUNITY_Community 74|Community 74]]
- [[_COMMUNITY_Community 77|Community 77]]
- [[_COMMUNITY_Community 79|Community 79]]
- [[_COMMUNITY_Community 80|Community 80]]
- [[_COMMUNITY_Community 81|Community 81]]
- [[_COMMUNITY_Community 89|Community 89]]
- [[_COMMUNITY_Community 90|Community 90]]
- [[_COMMUNITY_Community 91|Community 91]]
- [[_COMMUNITY_Community 94|Community 94]]
- [[_COMMUNITY_Community 97|Community 97]]
- [[_COMMUNITY_Community 98|Community 98]]
- [[_COMMUNITY_Community 100|Community 100]]
- [[_COMMUNITY_Community 101|Community 101]]
- [[_COMMUNITY_Community 109|Community 109]]
- [[_COMMUNITY_Community 114|Community 114]]
- [[_COMMUNITY_Community 115|Community 115]]
- [[_COMMUNITY_Community 117|Community 117]]
- [[_COMMUNITY_Community 190|Community 190]]

## God Nodes (most connected - your core abstractions)
1. `request()` - 125 edges
2. `showToast()` - 61 edges
3. `getDataViewMemory0()` - 42 edges
4. `takeObject()` - 42 edges
5. `withProxy()` - 41 edges
6. `passArray8ToWasm0()` - 34 edges
7. `getArrayU8FromWasm0()` - 23 edges
8. `encryptedUpload()` - 22 edges
9. `userFriendlyError()` - 21 edges
10. `toBase64()` - 21 edges

## Surprising Connections (you probably didn't know these)
- `openPreview()` --calls--> `handleFileAction()`  [INFERRED]
  e2e/helpers/thumb-fixtures.ts → src/pages/recent.tsx
- `openPreview()` --calls--> `handleFileAction()`  [INFERRED]
  e2e/helpers/thumb-fixtures.ts → src/pages/drive.tsx
- `openPreview()` --calls--> `handleFileAction()`  [INFERRED]
  e2e/helpers/thumb-fixtures.ts → src/pages/starred.tsx
- `fetchAndDecryptLargeThumbnail()` --calls--> `getApiUrl()`  [INFERRED]
  src/lib/thumbnail.ts → packages/shared/src/api/config.ts
- `fetchAndDecryptThumbnail()` --calls--> `getApiUrl()`  [INFERRED]
  src/lib/thumbnail.ts → packages/shared/src/api/config.ts

## Communities

### Community 0 - "Community 0"
Cohesion: 0.02
Nodes (149): clearSessionConfirmed(), fireConnectionStatus(), fireErrorNotifier(), fireSessionExpired(), markSessionConfirmed(), wasSessionConfirmed(), delay(), paceIfNeeded() (+141 more)

### Community 1 - "Community 1"
Cohesion: 0.03
Nodes (87): handleResend(), handleVerify(), handleNewFolder(), handleSubmit(), handleCopy(), handleConvert(), handleDelete(), handleDownload() (+79 more)

### Community 2 - "Community 2"
Cohesion: 0.04
Nodes (87): attachFreshToken(), buildRequest(), confirmAction(), confirmActionPlaintext(), listFiles(), listFilesPage(), opaqueLoginFinish(), opaqueLoginStart() (+79 more)

### Community 3 - "Community 3"
Cohesion: 0.07
Nodes (71): addHeapObject(), compute_recovery_check(), debugString(), decodeText(), decompress_gzip(), decrypt_chunk(), decrypt_chunks(), decrypt_metadata() (+63 more)

### Community 4 - "Community 4"
Cohesion: 0.03
Nodes (28): BillingBanner(), BillingSuspendedOverlay(), FileList(), if(), timeAgo(), IncidentBanner(), NewFolderDialog(), notificationIcon() (+20 more)

### Community 5 - "Community 5"
Cohesion: 0.05
Nodes (33): onRegionChanged(), resolveName(), decryptAll(), downloadBundleItem(), downloadSharedFile(), canStreamToServiceWorker(), createBlobSink(), createSwSink() (+25 more)

### Community 6 - "Community 6"
Cohesion: 0.05
Nodes (24): getApiUrl(), load(), onUpdated(), savePermissions(), setExpiry(), downloadVersion(), getFileRequestPublic(), uploadToFileRequest() (+16 more)

### Community 7 - "Community 7"
Cohesion: 0.08
Nodes (28): uploadThumbnail(), uploadThumbnailLarge(), encryptedUpload(), withNetworkRetry(), basename(), isLikelyAlbumArtOrIcon(), splitName(), encryptAndUploadLargeThumbnail() (+20 more)

### Community 8 - "Community 8"
Cohesion: 0.07
Nodes (34): handleCodeSubmit(), handlePasskeyUnlock(), handleRestore(), base64urlToBuffer(), bufferToBase64url(), credentialToAuthenticationJSON(), credentialToRegistrationJSON(), deletePasskey() (+26 more)

### Community 9 - "Community 9"
Cohesion: 0.07
Nodes (22): downloadDropboxFile(), expandDropboxPaths(), expandOne(), rateLimitedFetch(), sleepMs(), expandFolder(), expandGoogleDrivePaths(), GoogleAuthError (+14 more)

### Community 10 - "Community 10"
Cohesion: 0.11
Nodes (9): loadNames(), getSyncOps(), submitSyncOps(), getDeviceId(), payloadToNode(), saveLastSeq(), savePendingOps(), SyncClient (+1 more)

### Community 11 - "Community 11"
Cohesion: 0.09
Nodes (14): timeAgo(), bulkPermanentDelete(), getSharesForFile(), permanentDeleteFile(), restoreFile(), loadActivity(), buildDetailsMeta(), displayName() (+6 more)

### Community 12 - "Community 12"
Cohesion: 0.23
Nodes (18): cacheFileList(), cacheFilePreview(), enforceRowCap(), evictOldestPreviews(), fileListDelete(), fileListGet(), fileListGetAll(), fileListPut() (+10 more)

### Community 13 - "Community 13"
Cohesion: 0.18
Nodes (11): clearSession(), dbDelete(), dbGet(), dbPut(), deriveKey(), getVaultTTL(), openDB(), persistSession() (+3 more)

### Community 14 - "Community 14"
Cohesion: 0.11
Nodes (3): Row(), AndroidKeyboard(), IOSKeyboard()

### Community 15 - "Community 15"
Cohesion: 0.16
Nodes (5): formatBytes(), formatStorageSI(), formatStorageSI(), upgradeCardFromFallback(), upgradeCardFromPlanMeta()

### Community 16 - "Community 16"
Cohesion: 0.36
Nodes (13): clearVault(), computeKeyCheck(), dbClear(), dbGet(), dbPut(), deriveWrappingKey(), hasVault(), importAesKey() (+5 more)

### Community 20 - "Community 20"
Cohesion: 0.32
Nodes (9): devAutoAuth(), cacheVaultKey(), clearVaultKey(), dbDelete(), dbGet(), dbPut(), getVaultKey(), initSessionVault() (+1 more)

### Community 21 - "Community 21"
Cohesion: 0.17
Nodes (4): load(), handleDownloadCiphertext(), downloadFile(), handleLoadMore()

### Community 23 - "Community 23"
Cohesion: 0.29
Nodes (6): escapeRe(), openImagePreview(), openPreview(), previewImage(), previewOverlay(), uploadAndWait()

### Community 24 - "Community 24"
Cohesion: 0.2
Nodes (2): dayLabel(), groupByDay()

### Community 29 - "Community 29"
Cohesion: 0.22
Nodes (2): formatEta(), formatSpeed()

### Community 38 - "Community 38"
Cohesion: 0.25
Nodes (1): ApiError

### Community 40 - "Community 40"
Cohesion: 0.29
Nodes (2): pipelineStage(), stageLabel()

### Community 42 - "Community 42"
Cohesion: 0.29
Nodes (4): copyToClipboard(), handleCopy(), handleRevoke(), revokeShare()

### Community 52 - "Community 52"
Cohesion: 0.38
Nodes (5): allowsFunctional(), getConsent(), hasConsented(), setConsent(), update()

### Community 53 - "Community 53"
Cohesion: 0.38
Nodes (3): getStored(), isValidDensity(), isValidFontSize()

### Community 55 - "Community 55"
Cohesion: 0.29
Nodes (3): ApiError, IncorrectPasswordError, SessionTooOldForConfirmationError

### Community 58 - "Community 58"
Cohesion: 0.4
Nodes (2): blob(), createFolder()

### Community 59 - "Community 59"
Cohesion: 0.4
Nodes (3): openManageShares(), createShareLink(), openRowMenu()

### Community 60 - "Community 60"
Cohesion: 0.4
Nodes (2): computeStep(), writeLocalStep()

### Community 62 - "Community 62"
Cohesion: 0.4
Nodes (2): consumePendingExport(), hasPendingExport()

### Community 64 - "Community 64"
Cohesion: 0.4
Nodes (2): fromBase64url(), readRequestPublicKey()

### Community 65 - "Community 65"
Cohesion: 0.33
Nodes (1): ErrorBoundary

### Community 66 - "Community 66"
Cohesion: 0.4
Nodes (2): decodeAndConvert(), pcmToWavBlob()

### Community 67 - "Community 67"
Cohesion: 0.47
Nodes (4): ensureLang(), getHighlighter(), langLabel(), toShikiLang()

### Community 70 - "Community 70"
Cohesion: 0.4
Nodes (1): MemoryStorage

### Community 72 - "Community 72"
Cohesion: 0.7
Nodes (4): FOLDER_COLOR_KEY(), getFolderColor(), getFolderColorDot(), setFolderColor()

### Community 74 - "Community 74"
Cohesion: 0.5
Nodes (2): Avatar(), getInitials()

### Community 77 - "Community 77"
Cohesion: 0.5
Nodes (2): AnnouncementBanner(), severityClasses()

### Community 79 - "Community 79"
Cohesion: 0.5
Nodes (2): hashString(), pickIndicesFromPhrase()

### Community 80 - "Community 80"
Cohesion: 0.4
Nodes (2): ImpersonationBanner(), useImpersonation()

### Community 81 - "Community 81"
Cohesion: 0.5
Nodes (2): getExtension(), getMimeLabel()

### Community 89 - "Community 89"
Cohesion: 0.67
Nodes (2): signUp(), uniqueEmail()

### Community 90 - "Community 90"
Cohesion: 0.67
Nodes (2): signUp(), uniqueEmail()

### Community 91 - "Community 91"
Cohesion: 0.67
Nodes (2): signupAndUnlock(), uniqueEmail()

### Community 94 - "Community 94"
Cohesion: 0.83
Nodes (3): clearTauriSession(), isTauri(), pushTauriSession()

### Community 97 - "Community 97"
Cohesion: 0.83
Nodes (3): extractDroppedItems(), processEntries(), readDirectoryEntry()

### Community 98 - "Community 98"
Cohesion: 0.5
Nodes (2): ContextMenu(), isPreviewable()

### Community 100 - "Community 100"
Cohesion: 0.5
Nodes (1): poll()

### Community 101 - "Community 101"
Cohesion: 0.83
Nodes (3): getMenuItems(), getPendingItems(), SharedContextMenu()

### Community 109 - "Community 109"
Cohesion: 1.0
Nodes (2): createBundleShareLink(), selectRow()

### Community 114 - "Community 114"
Cohesion: 1.0
Nodes (2): checkPasswordPwned(), sha1Hex()

### Community 115 - "Community 115"
Cohesion: 1.0
Nodes (2): deriveSasWords(), fnv1a()

### Community 117 - "Community 117"
Cohesion: 1.0
Nodes (2): ch(), migratePreferences()

### Community 190 - "Community 190"
Cohesion: 1.0
Nodes (1): WasmChunkEncryptor

## Knowledge Gaps
- **1 isolated node(s):** `WasmChunkEncryptor`
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 24`** (11 nodes): `actionText()`, `dayLabel()`, `DeviceBadge()`, `groupByDay()`, `isAlarmingEvent()`, `isSecurityEvent()`, `loadingMore()`, `metaFor()`, `timeLabel()`, `wsToActivity()`, `activity.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 29`** (10 nodes): `barColor()`, `borderColor()`, `computeEta()`, `computeSpeed()`, `formatChunkSize()`, `formatEta()`, `formatSpeed()`, `phaseLabel()`, `regionLabel()`, `upload-progress-card.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 38`** (8 nodes): `ApiError`, `.constructor()`, `installMocks()`, `pageImpl()`, `resetCaptures()`, `setListPage()`, `stubStream()`, `upload-share-mocks.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 40`** (8 nodes): `computeEta()`, `computeSpeed()`, `formatBytes()`, `formatEta()`, `formatSpeed()`, `pipelineStage()`, `stageLabel()`, `upload-progress.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 58`** (6 nodes): `blob()`, `createFolder()`, `deleteFile()`, `listChildIds()`, `listRootFolderIds()`, `folder-pagination.spec.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 60`** (6 nodes): `computeStep()`, `OnboardingProvider()`, `readLocalStep()`, `useOnboarding()`, `writeLocalStep()`, `onboarding-context.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 62`** (6 nodes): `browserStorage()`, `consumePendingExport()`, `dataExportDownloadFilename()`, `hasPendingExport()`, `markPendingExport()`, `export-intent.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 64`** (6 nodes): `formatBytes()`, `fromBase64url()`, `onDrop()`, `prevent()`, `readRequestPublicKey()`, `upload-request.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 65`** (6 nodes): `ErrorBoundary`, `.componentDidCatch()`, `.constructor()`, `.getDerivedStateFromError()`, `.render()`, `error-boundary.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 66`** (6 nodes): `decodeAndConvert()`, `formatTime()`, `handleSeek()`, `pcmToWavBlob()`, `togglePlay()`, `audio-preview.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 70`** (5 nodes): `MemoryStorage`, `.getItem()`, `.removeItem()`, `.setItem()`, `export-intent.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 74`** (5 nodes): `Avatar()`, `formatRelativeDate()`, `getInitials()`, `SecuredBadge()`, `public-profile.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 77`** (5 nodes): `AnnouncementBanner()`, `readDismissed()`, `severityClasses()`, `writeDismissed()`, `announcement-banner.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 79`** (5 nodes): `handleChange()`, `handleVerify()`, `hashString()`, `pickIndicesFromPhrase()`, `mnemonic-verify.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 80`** (5 nodes): `ImpersonationBanner()`, `ImpersonationProvider()`, `useImpersonation()`, `impersonation-banner.tsx`, `impersonation-context.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 81`** (5 nodes): `formatSize()`, `getExtension()`, `getMimeLabel()`, `handleDownload()`, `unsupported-preview.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 89`** (4 nodes): `blockDevAutoLogin()`, `signUp()`, `cli-auth-redirect.spec.ts`, `uniqueEmail()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 90`** (4 nodes): `blockDevAutoLogin()`, `signUp()`, `export-resume.spec.ts`, `uniqueEmail()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 91`** (4 nodes): `escapeRegex()`, `signupAndUnlock()`, `refresh-stability.spec.ts`, `uniqueEmail()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 98`** (4 nodes): `ContextMenu()`, `isPreviewable()`, `context-menu.tsx`, `preview.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 100`** (4 nodes): `colourFor()`, `initials()`, `poll()`, `presence-avatars.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 109`** (3 nodes): `createBundleShareLink()`, `selectRow()`, `bundle-share.spec.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 114`** (3 nodes): `checkPasswordPwned()`, `sha1Hex()`, `hibp.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 115`** (3 nodes): `deriveSasWords()`, `fnv1a()`, `sas-words.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 117`** (3 nodes): `ch()`, `migratePreferences()`, `notifications.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 190`** (2 nodes): `WasmChunkEncryptor`, `beebeeb_wasm.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `showToast()` connect `Community 1` to `Community 2`, `Community 6`, `Community 7`, `Community 9`, `Community 42`, `Community 11`, `Community 13`?**
  _High betweenness centrality (0.053) - this node is a cross-community bridge._
- **Why does `handleFolderFilesSelected()` connect `Community 1` to `Community 2`, `Community 4`, `Community 7`?**
  _High betweenness centrality (0.052) - this node is a cross-community bridge._
- **Are the 120 inferred relationships involving `request()` (e.g. with `opaqueRegisterStart()` and `opaqueLoginStart()`) actually correct?**
  _`request()` has 120 INFERRED edges - model-reasoned connections that need verification._
- **Are the 57 inferred relationships involving `showToast()` (e.g. with `doEncryptedUpload()` and `handleDownload()`) actually correct?**
  _`showToast()` has 57 INFERRED edges - model-reasoned connections that need verification._
- **What connects `WasmChunkEncryptor` to the rest of the system?**
  _1 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.02 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.03 - nodes in this community are weakly interconnected._