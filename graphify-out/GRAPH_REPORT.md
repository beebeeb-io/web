# Graph Report - web  (2026-06-30)

## Corpus Check
- 350 files · ~405,060 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1876 nodes · 2619 edges · 59 communities detected
- Extraction: 79% EXTRACTED · 21% INFERRED · 0% AMBIGUOUS · INFERRED: 560 edges (avg confidence: 0.8)
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
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 53|Community 53]]
- [[_COMMUNITY_Community 54|Community 54]]
- [[_COMMUNITY_Community 56|Community 56]]
- [[_COMMUNITY_Community 59|Community 59]]
- [[_COMMUNITY_Community 60|Community 60]]
- [[_COMMUNITY_Community 61|Community 61]]
- [[_COMMUNITY_Community 63|Community 63]]
- [[_COMMUNITY_Community 65|Community 65]]
- [[_COMMUNITY_Community 66|Community 66]]
- [[_COMMUNITY_Community 67|Community 67]]
- [[_COMMUNITY_Community 68|Community 68]]
- [[_COMMUNITY_Community 69|Community 69]]
- [[_COMMUNITY_Community 72|Community 72]]
- [[_COMMUNITY_Community 75|Community 75]]
- [[_COMMUNITY_Community 76|Community 76]]
- [[_COMMUNITY_Community 77|Community 77]]
- [[_COMMUNITY_Community 79|Community 79]]
- [[_COMMUNITY_Community 82|Community 82]]
- [[_COMMUNITY_Community 84|Community 84]]
- [[_COMMUNITY_Community 85|Community 85]]
- [[_COMMUNITY_Community 86|Community 86]]
- [[_COMMUNITY_Community 94|Community 94]]
- [[_COMMUNITY_Community 95|Community 95]]
- [[_COMMUNITY_Community 96|Community 96]]
- [[_COMMUNITY_Community 99|Community 99]]
- [[_COMMUNITY_Community 103|Community 103]]
- [[_COMMUNITY_Community 104|Community 104]]
- [[_COMMUNITY_Community 106|Community 106]]
- [[_COMMUNITY_Community 115|Community 115]]
- [[_COMMUNITY_Community 120|Community 120]]
- [[_COMMUNITY_Community 121|Community 121]]
- [[_COMMUNITY_Community 123|Community 123]]
- [[_COMMUNITY_Community 196|Community 196]]

## God Nodes (most connected - your core abstractions)
1. `request()` - 127 edges
2. `showToast()` - 61 edges
3. `getDataViewMemory0()` - 42 edges
4. `takeObject()` - 42 edges
5. `withProxy()` - 41 edges
6. `passArray8ToWasm0()` - 34 edges
7. `getArrayU8FromWasm0()` - 23 edges
8. `userFriendlyError()` - 22 edges
9. `encryptedUpload()` - 22 edges
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
Cohesion: 0.01
Nodes (156): clearSessionConfirmed(), fireConnectionStatus(), fireErrorNotifier(), fireSessionExpired(), markSessionConfirmed(), wasSessionConfirmed(), delay(), paceIfNeeded() (+148 more)

### Community 1 - "Community 1"
Cohesion: 0.03
Nodes (89): handleResend(), handleVerify(), handleNewFolder(), handleSubmit(), handleCopy(), handleConvert(), handleDelete(), handleDownload() (+81 more)

### Community 2 - "Community 2"
Cohesion: 0.04
Nodes (86): attachFreshToken(), buildRequest(), hexToBytes(), opaqueLoginFinish(), opaqueLoginStart(), verify2fa(), autoUpgradeToV1(), computeRecoveryCheck() (+78 more)

### Community 3 - "Community 3"
Cohesion: 0.07
Nodes (69): addHeapObject(), compute_recovery_check(), debugString(), decodeText(), decompress_gzip(), decrypt_chunk(), decrypt_chunks(), decrypt_metadata() (+61 more)

### Community 4 - "Community 4"
Cohesion: 0.03
Nodes (30): BillingBanner(), BillingSuspendedOverlay(), FileList(), if(), timeAgo(), IncidentBanner(), NewFolderDialog(), notificationIcon() (+22 more)

### Community 5 - "Community 5"
Cohesion: 0.05
Nodes (24): getApiUrl(), load(), onUpdated(), savePermissions(), setExpiry(), downloadVersion(), getFileRequestPublic(), uploadToFileRequest() (+16 more)

### Community 6 - "Community 6"
Cohesion: 0.07
Nodes (29): uploadThumbnail(), uploadThumbnailLarge(), encryptedUpload(), withNetworkRetry(), basename(), isLikelyAlbumArtOrIcon(), splitName(), encryptAndUploadLargeThumbnail() (+21 more)

### Community 7 - "Community 7"
Cohesion: 0.07
Nodes (22): downloadDropboxFile(), expandDropboxPaths(), expandOne(), rateLimitedFetch(), sleepMs(), expandFolder(), expandGoogleDrivePaths(), GoogleAuthError (+14 more)

### Community 8 - "Community 8"
Cohesion: 0.08
Nodes (30): downloadBundleItem(), downloadSharedFile(), listFiles(), listFilesPage(), canStreamToServiceWorker(), createBlobSink(), createSwSink(), downloadAsZip() (+22 more)

### Community 9 - "Community 9"
Cohesion: 0.08
Nodes (31): handleCodeSubmit(), handlePasskeyUnlock(), handleRestore(), base64urlToBuffer(), bufferToBase64url(), credentialToAuthenticationJSON(), credentialToRegistrationJSON(), deletePasskey() (+23 more)

### Community 10 - "Community 10"
Cohesion: 0.11
Nodes (9): loadNames(), getSyncOps(), submitSyncOps(), getDeviceId(), payloadToNode(), saveLastSeq(), savePendingOps(), SyncClient (+1 more)

### Community 11 - "Community 11"
Cohesion: 0.11
Nodes (11): timeAgo(), getSharesForFile(), restoreFile(), loadActivity(), buildDetailsMeta(), displayName(), handleRestore(), handleRestoreAll() (+3 more)

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
Cohesion: 0.12
Nodes (3): onRegionChanged(), resolveName(), decryptAll()

### Community 16 - "Community 16"
Cohesion: 0.36
Nodes (13): clearVault(), computeKeyCheck(), dbClear(), dbGet(), dbPut(), deriveWrappingKey(), hasVault(), importAesKey() (+5 more)

### Community 20 - "Community 20"
Cohesion: 0.17
Nodes (4): load(), handleDownloadCiphertext(), downloadFile(), handleLoadMore()

### Community 21 - "Community 21"
Cohesion: 0.32
Nodes (9): devAutoAuth(), cacheVaultKey(), clearVaultKey(), dbDelete(), dbGet(), dbPut(), getVaultKey(), initSessionVault() (+1 more)

### Community 22 - "Community 22"
Cohesion: 0.23
Nodes (5): formatBytes(), formatStorageSI(), formatStorageSI(), upgradeCardFromFallback(), upgradeCardFromPlanMeta()

### Community 24 - "Community 24"
Cohesion: 0.29
Nodes (6): escapeRe(), openImagePreview(), openPreview(), previewImage(), previewOverlay(), uploadAndWait()

### Community 25 - "Community 25"
Cohesion: 0.2
Nodes (2): dayLabel(), groupByDay()

### Community 30 - "Community 30"
Cohesion: 0.22
Nodes (2): formatEta(), formatSpeed()

### Community 39 - "Community 39"
Cohesion: 0.25
Nodes (1): ApiError

### Community 41 - "Community 41"
Cohesion: 0.29
Nodes (2): pipelineStage(), stageLabel()

### Community 43 - "Community 43"
Cohesion: 0.29
Nodes (4): copyToClipboard(), handleCopy(), handleRevoke(), revokeShare()

### Community 53 - "Community 53"
Cohesion: 0.38
Nodes (3): getStored(), isValidDensity(), isValidFontSize()

### Community 54 - "Community 54"
Cohesion: 0.38
Nodes (5): allowsFunctional(), getConsent(), hasConsented(), setConsent(), update()

### Community 56 - "Community 56"
Cohesion: 0.29
Nodes (3): ApiError, IncorrectPasswordError, SessionTooOldForConfirmationError

### Community 59 - "Community 59"
Cohesion: 0.4
Nodes (3): openManageShares(), createShareLink(), openRowMenu()

### Community 60 - "Community 60"
Cohesion: 0.4
Nodes (2): blob(), createFolder()

### Community 61 - "Community 61"
Cohesion: 0.4
Nodes (2): computeStep(), writeLocalStep()

### Community 63 - "Community 63"
Cohesion: 0.4
Nodes (2): consumePendingExport(), hasPendingExport()

### Community 65 - "Community 65"
Cohesion: 0.4
Nodes (2): fromBase64url(), readRequestPublicKey()

### Community 66 - "Community 66"
Cohesion: 0.33
Nodes (1): ErrorBoundary

### Community 67 - "Community 67"
Cohesion: 0.4
Nodes (2): statusLabel(), statusVariant()

### Community 68 - "Community 68"
Cohesion: 0.4
Nodes (2): decodeAndConvert(), pcmToWavBlob()

### Community 69 - "Community 69"
Cohesion: 0.47
Nodes (4): ensureLang(), getHighlighter(), langLabel(), toShikiLang()

### Community 72 - "Community 72"
Cohesion: 0.4
Nodes (1): MemoryStorage

### Community 75 - "Community 75"
Cohesion: 0.7
Nodes (4): FOLDER_COLOR_KEY(), getFolderColor(), getFolderColorDot(), setFolderColor()

### Community 76 - "Community 76"
Cohesion: 0.4
Nodes (1): handleResend()

### Community 77 - "Community 77"
Cohesion: 0.5
Nodes (2): handleProceed(), validate()

### Community 79 - "Community 79"
Cohesion: 0.5
Nodes (2): Avatar(), getInitials()

### Community 82 - "Community 82"
Cohesion: 0.5
Nodes (2): AnnouncementBanner(), severityClasses()

### Community 84 - "Community 84"
Cohesion: 0.5
Nodes (2): hashString(), pickIndicesFromPhrase()

### Community 85 - "Community 85"
Cohesion: 0.4
Nodes (2): ImpersonationBanner(), useImpersonation()

### Community 86 - "Community 86"
Cohesion: 0.5
Nodes (2): getExtension(), getMimeLabel()

### Community 94 - "Community 94"
Cohesion: 0.67
Nodes (2): signUp(), uniqueEmail()

### Community 95 - "Community 95"
Cohesion: 0.67
Nodes (2): signUp(), uniqueEmail()

### Community 96 - "Community 96"
Cohesion: 0.67
Nodes (2): signupAndUnlock(), uniqueEmail()

### Community 99 - "Community 99"
Cohesion: 0.83
Nodes (3): clearTauriSession(), isTauri(), pushTauriSession()

### Community 103 - "Community 103"
Cohesion: 0.83
Nodes (3): extractDroppedItems(), processEntries(), readDirectoryEntry()

### Community 104 - "Community 104"
Cohesion: 0.5
Nodes (2): ContextMenu(), isPreviewable()

### Community 106 - "Community 106"
Cohesion: 0.83
Nodes (3): getMenuItems(), getPendingItems(), SharedContextMenu()

### Community 115 - "Community 115"
Cohesion: 1.0
Nodes (2): createBundleShareLink(), selectRow()

### Community 120 - "Community 120"
Cohesion: 1.0
Nodes (2): checkPasswordPwned(), sha1Hex()

### Community 121 - "Community 121"
Cohesion: 1.0
Nodes (2): deriveSasWords(), fnv1a()

### Community 123 - "Community 123"
Cohesion: 1.0
Nodes (2): ch(), migratePreferences()

### Community 196 - "Community 196"
Cohesion: 1.0
Nodes (1): WasmChunkEncryptor

## Knowledge Gaps
- **1 isolated node(s):** `WasmChunkEncryptor`
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 25`** (11 nodes): `actionText()`, `dayLabel()`, `DeviceBadge()`, `groupByDay()`, `isAlarmingEvent()`, `isSecurityEvent()`, `loadingMore()`, `metaFor()`, `timeLabel()`, `wsToActivity()`, `activity.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 30`** (10 nodes): `barColor()`, `borderColor()`, `computeEta()`, `computeSpeed()`, `formatChunkSize()`, `formatEta()`, `formatSpeed()`, `phaseLabel()`, `regionLabel()`, `upload-progress-card.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 39`** (8 nodes): `ApiError`, `.constructor()`, `installMocks()`, `pageImpl()`, `resetCaptures()`, `setListPage()`, `stubStream()`, `upload-share-mocks.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 41`** (8 nodes): `computeEta()`, `computeSpeed()`, `formatBytes()`, `formatEta()`, `formatSpeed()`, `pipelineStage()`, `stageLabel()`, `upload-progress.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 60`** (6 nodes): `blob()`, `createFolder()`, `deleteFile()`, `listChildIds()`, `listRootFolderIds()`, `folder-pagination.spec.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 61`** (6 nodes): `computeStep()`, `OnboardingProvider()`, `readLocalStep()`, `useOnboarding()`, `writeLocalStep()`, `onboarding-context.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 63`** (6 nodes): `browserStorage()`, `consumePendingExport()`, `dataExportDownloadFilename()`, `hasPendingExport()`, `markPendingExport()`, `export-intent.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 65`** (6 nodes): `formatBytes()`, `fromBase64url()`, `onDrop()`, `prevent()`, `readRequestPublicKey()`, `upload-request.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 66`** (6 nodes): `ErrorBoundary`, `.componentDidCatch()`, `.constructor()`, `.getDerivedStateFromError()`, `.render()`, `error-boundary.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 67`** (6 nodes): `formatCents()`, `formatDate()`, `methodLabel()`, `statusLabel()`, `statusVariant()`, `TransactionList.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 68`** (6 nodes): `decodeAndConvert()`, `formatTime()`, `handleSeek()`, `pcmToWavBlob()`, `togglePlay()`, `audio-preview.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 72`** (5 nodes): `MemoryStorage`, `.getItem()`, `.removeItem()`, `.setItem()`, `export-intent.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 76`** (5 nodes): `handleInput()`, `handleKeyDown()`, `handlePaste()`, `handleResend()`, `verify-email.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 77`** (5 nodes): `eur()`, `handleProceed()`, `validate()`, `viesStateFromVerdict()`, `BillingInfoStep.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 79`** (5 nodes): `Avatar()`, `formatRelativeDate()`, `getInitials()`, `SecuredBadge()`, `public-profile.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 82`** (5 nodes): `AnnouncementBanner()`, `readDismissed()`, `severityClasses()`, `writeDismissed()`, `announcement-banner.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 84`** (5 nodes): `handleChange()`, `handleVerify()`, `hashString()`, `pickIndicesFromPhrase()`, `mnemonic-verify.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 85`** (5 nodes): `ImpersonationBanner()`, `ImpersonationProvider()`, `useImpersonation()`, `impersonation-banner.tsx`, `impersonation-context.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 86`** (5 nodes): `formatSize()`, `getExtension()`, `getMimeLabel()`, `handleDownload()`, `unsupported-preview.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 94`** (4 nodes): `blockDevAutoLogin()`, `signUp()`, `cli-auth-redirect.spec.ts`, `uniqueEmail()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 95`** (4 nodes): `blockDevAutoLogin()`, `signUp()`, `export-resume.spec.ts`, `uniqueEmail()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 96`** (4 nodes): `escapeRegex()`, `signupAndUnlock()`, `refresh-stability.spec.ts`, `uniqueEmail()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 104`** (4 nodes): `ContextMenu()`, `isPreviewable()`, `context-menu.tsx`, `preview.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 115`** (3 nodes): `createBundleShareLink()`, `selectRow()`, `bundle-share.spec.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 120`** (3 nodes): `checkPasswordPwned()`, `sha1Hex()`, `hibp.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 121`** (3 nodes): `deriveSasWords()`, `fnv1a()`, `sas-words.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 123`** (3 nodes): `ch()`, `migratePreferences()`, `notifications.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 196`** (2 nodes): `WasmChunkEncryptor`, `beebeeb_wasm.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `showToast()` connect `Community 1` to `Community 0`, `Community 2`, `Community 4`, `Community 5`, `Community 6`, `Community 7`, `Community 11`, `Community 43`, `Community 13`?**
  _High betweenness centrality (0.048) - this node is a cross-community bridge._
- **Why does `request()` connect `Community 0` to `Community 1`, `Community 2`, `Community 5`, `Community 9`, `Community 10`?**
  _High betweenness centrality (0.046) - this node is a cross-community bridge._
- **Why does `getApiUrl()` connect `Community 5` to `Community 0`, `Community 8`, `Community 10`, `Community 6`?**
  _High betweenness centrality (0.038) - this node is a cross-community bridge._
- **Are the 122 inferred relationships involving `request()` (e.g. with `opaqueRegisterStart()` and `opaqueLoginStart()`) actually correct?**
  _`request()` has 122 INFERRED edges - model-reasoned connections that need verification._
- **Are the 57 inferred relationships involving `showToast()` (e.g. with `doEncryptedUpload()` and `handleDownload()`) actually correct?**
  _`showToast()` has 57 INFERRED edges - model-reasoned connections that need verification._
- **What connects `WasmChunkEncryptor` to the rest of the system?**
  _1 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.01 - nodes in this community are weakly interconnected._