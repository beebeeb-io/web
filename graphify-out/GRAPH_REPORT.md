# Graph Report - web-1182  (2026-07-03)

## Corpus Check
- 366 files · ~391,563 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1980 nodes · 2790 edges · 62 communities detected
- Extraction: 79% EXTRACTED · 21% INFERRED · 0% AMBIGUOUS · INFERRED: 582 edges (avg confidence: 0.8)
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
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 44|Community 44]]
- [[_COMMUNITY_Community 55|Community 55]]
- [[_COMMUNITY_Community 56|Community 56]]
- [[_COMMUNITY_Community 57|Community 57]]
- [[_COMMUNITY_Community 59|Community 59]]
- [[_COMMUNITY_Community 62|Community 62]]
- [[_COMMUNITY_Community 63|Community 63]]
- [[_COMMUNITY_Community 64|Community 64]]
- [[_COMMUNITY_Community 66|Community 66]]
- [[_COMMUNITY_Community 68|Community 68]]
- [[_COMMUNITY_Community 69|Community 69]]
- [[_COMMUNITY_Community 70|Community 70]]
- [[_COMMUNITY_Community 71|Community 71]]
- [[_COMMUNITY_Community 72|Community 72]]
- [[_COMMUNITY_Community 75|Community 75]]
- [[_COMMUNITY_Community 78|Community 78]]
- [[_COMMUNITY_Community 80|Community 80]]
- [[_COMMUNITY_Community 83|Community 83]]
- [[_COMMUNITY_Community 85|Community 85]]
- [[_COMMUNITY_Community 86|Community 86]]
- [[_COMMUNITY_Community 87|Community 87]]
- [[_COMMUNITY_Community 88|Community 88]]
- [[_COMMUNITY_Community 96|Community 96]]
- [[_COMMUNITY_Community 97|Community 97]]
- [[_COMMUNITY_Community 98|Community 98]]
- [[_COMMUNITY_Community 101|Community 101]]
- [[_COMMUNITY_Community 102|Community 102]]
- [[_COMMUNITY_Community 107|Community 107]]
- [[_COMMUNITY_Community 109|Community 109]]
- [[_COMMUNITY_Community 119|Community 119]]
- [[_COMMUNITY_Community 124|Community 124]]
- [[_COMMUNITY_Community 125|Community 125]]
- [[_COMMUNITY_Community 126|Community 126]]
- [[_COMMUNITY_Community 129|Community 129]]
- [[_COMMUNITY_Community 140|Community 140]]

## God Nodes (most connected - your core abstractions)
1. `request()` - 134 edges
2. `showToast()` - 61 edges
3. `withProxy()` - 53 edges
4. `getDataViewMemory0()` - 52 edges
5. `takeObject()` - 49 edges
6. `passArray8ToWasm0()` - 38 edges
7. `userFriendlyError()` - 23 edges
8. `getArrayU8FromWasm0()` - 23 edges
9. `encryptedUpload()` - 22 edges
10. `getApiUrl()` - 22 edges

## Surprising Connections (you probably didn't know these)
- `depsForAccount()` --calls--> `compute_recovery_check()`  [INFERRED]
  test/recovery-validation.test.ts → packages/beebeeb-wasm/beebeeb_wasm.js
- `openPreview()` --calls--> `handleFileAction()`  [INFERRED]
  e2e/helpers/thumb-fixtures.ts → src/pages/recent.tsx
- `openPreview()` --calls--> `handleFileAction()`  [INFERRED]
  e2e/helpers/thumb-fixtures.ts → src/pages/drive.tsx
- `openPreview()` --calls--> `handleFileAction()`  [INFERRED]
  e2e/helpers/thumb-fixtures.ts → src/pages/starred.tsx
- `fetchAndDecryptLargeThumbnail()` --calls--> `getApiUrl()`  [INFERRED]
  src/lib/thumbnail.ts → packages/shared/src/api/config.ts

## Communities

### Community 0 - "Community 0"
Cohesion: 0.01
Nodes (165): clearSessionConfirmed(), fireConnectionStatus(), fireErrorNotifier(), fireSessionExpired(), markSessionConfirmed(), wasSessionConfirmed(), delay(), formatRetryAfter() (+157 more)

### Community 1 - "Community 1"
Cohesion: 0.02
Nodes (106): handleNewFolder(), handleSubmit(), formatBytes(), handleDelete(), handleDownload(), handleRestore(), createFolder(), deleteFile() (+98 more)

### Community 2 - "Community 2"
Cohesion: 0.03
Nodes (95): handleRestore(), attachFreshToken(), buildRequest(), handleCopy(), cleanName(), decryptActivitySnapshotName(), describeActivityEventWithFileName(), describeWithName() (+87 more)

### Community 3 - "Community 3"
Cohesion: 0.06
Nodes (77): addHeapObject(), compute_recovery_check(), debugString(), decodeText(), decompress_gzip(), decrypt_chunk(), decrypt_chunks(), decrypt_metadata() (+69 more)

### Community 4 - "Community 4"
Cohesion: 0.03
Nodes (24): BillingBanner(), BillingSuspendedOverlay(), FileList(), if(), timeAgo(), IncidentBanner(), NewFolderDialog(), notificationIcon() (+16 more)

### Community 5 - "Community 5"
Cohesion: 0.05
Nodes (34): onRegionChanged(), resolveName(), decryptAll(), downloadBundleItem(), downloadSharedFile(), canStreamToServiceWorker(), createBlobSink(), createSwSink() (+26 more)

### Community 6 - "Community 6"
Cohesion: 0.07
Nodes (31): uploadThumbnail(), uploadThumbnailLarge(), planChunks(), startEncryptedStream(), startEncryptedStreamWithChunkSize(), encryptedUpload(), withNetworkRetry(), basename() (+23 more)

### Community 7 - "Community 7"
Cohesion: 0.07
Nodes (22): getApiUrl(), downloadVersion(), getFileRequestPublic(), uploadToFileRequest(), CoreSearchIndex, decryptIndex(), deriveIndexKey(), encryptIndex() (+14 more)

### Community 8 - "Community 8"
Cohesion: 0.07
Nodes (33): handleCodeSubmit(), handlePasskeyUnlock(), base64urlToBuffer(), bufferToBase64url(), credentialToAuthenticationJSON(), credentialToRegistrationJSON(), deletePasskey(), finishPasskeyLogin() (+25 more)

### Community 9 - "Community 9"
Cohesion: 0.11
Nodes (9): loadNames(), getSyncOps(), submitSyncOps(), getDeviceId(), payloadToNode(), saveLastSeq(), savePendingOps(), SyncClient (+1 more)

### Community 10 - "Community 10"
Cohesion: 0.08
Nodes (15): copyToClipboard(), handleCopy(), handleRevoke(), timeAgo(), getSharesForFile(), restoreFile(), revokeShare(), loadActivity() (+7 more)

### Community 11 - "Community 11"
Cohesion: 0.23
Nodes (18): cacheFileList(), cacheFilePreview(), enforceRowCap(), evictOldestPreviews(), fileListDelete(), fileListGet(), fileListGetAll(), fileListPut() (+10 more)

### Community 12 - "Community 12"
Cohesion: 0.18
Nodes (11): clearSession(), dbDelete(), dbGet(), dbPut(), deriveKey(), getVaultTTL(), openDB(), persistSession() (+3 more)

### Community 13 - "Community 13"
Cohesion: 0.11
Nodes (3): Row(), AndroidKeyboard(), IOSKeyboard()

### Community 14 - "Community 14"
Cohesion: 0.14
Nodes (4): commitQuery(), handleSubmit(), loadRecent(), saveRecent()

### Community 15 - "Community 15"
Cohesion: 0.36
Nodes (13): clearVault(), computeKeyCheck(), dbClear(), dbGet(), dbPut(), deriveWrappingKey(), hasVault(), importAesKey() (+5 more)

### Community 19 - "Community 19"
Cohesion: 0.17
Nodes (4): load(), handleDownloadCiphertext(), downloadFile(), handleLoadMore()

### Community 21 - "Community 21"
Cohesion: 0.29
Nodes (6): escapeRe(), openImagePreview(), openPreview(), previewImage(), previewOverlay(), uploadAndWait()

### Community 22 - "Community 22"
Cohesion: 0.18
Nodes (5): handleResend(), handleVerify(), resendVerification(), handleResend(), handleSubmit()

### Community 23 - "Community 23"
Cohesion: 0.2
Nodes (2): dayLabel(), groupByDay()

### Community 24 - "Community 24"
Cohesion: 0.25
Nodes (5): formatBytes(), formatStorageSI(), formatStorageSI(), upgradeCardFromFallback(), upgradeCardFromPlanMeta()

### Community 29 - "Community 29"
Cohesion: 0.22
Nodes (2): formatEta(), formatSpeed()

### Community 33 - "Community 33"
Cohesion: 0.33
Nodes (5): downloadDropboxFile(), expandDropboxPaths(), expandOne(), rateLimitedFetch(), sleepMs()

### Community 39 - "Community 39"
Cohesion: 0.25
Nodes (1): ApiError

### Community 40 - "Community 40"
Cohesion: 0.29
Nodes (3): savePermissions(), setExpiry(), patchInvite()

### Community 41 - "Community 41"
Cohesion: 0.32
Nodes (4): handleConvert(), getPendingCheckout(), makePreState(), setPendingCheckout()

### Community 42 - "Community 42"
Cohesion: 0.25
Nodes (3): recoveredKeyMatchesAccount(), depsForAccount(), runGate()

### Community 44 - "Community 44"
Cohesion: 0.29
Nodes (2): pipelineStage(), stageLabel()

### Community 55 - "Community 55"
Cohesion: 0.38
Nodes (5): allowsFunctional(), getConsent(), hasConsented(), setConsent(), update()

### Community 56 - "Community 56"
Cohesion: 0.38
Nodes (3): getStored(), isValidDensity(), isValidFontSize()

### Community 57 - "Community 57"
Cohesion: 0.38
Nodes (4): expandFolder(), expandGoogleDrivePaths(), GoogleAuthError, listGoogleDriveFolder()

### Community 59 - "Community 59"
Cohesion: 0.29
Nodes (3): ApiError, IncorrectPasswordError, SessionTooOldForConfirmationError

### Community 62 - "Community 62"
Cohesion: 0.4
Nodes (3): openManageShares(), createShareLink(), openRowMenu()

### Community 63 - "Community 63"
Cohesion: 0.4
Nodes (2): blob(), createFolder()

### Community 64 - "Community 64"
Cohesion: 0.4
Nodes (2): computeStep(), writeLocalStep()

### Community 66 - "Community 66"
Cohesion: 0.4
Nodes (2): consumePendingExport(), hasPendingExport()

### Community 68 - "Community 68"
Cohesion: 0.4
Nodes (2): fromBase64url(), readRequestPublicKey()

### Community 69 - "Community 69"
Cohesion: 0.33
Nodes (1): ErrorBoundary

### Community 70 - "Community 70"
Cohesion: 0.4
Nodes (2): statusLabel(), statusVariant()

### Community 71 - "Community 71"
Cohesion: 0.4
Nodes (2): decodeAndConvert(), pcmToWavBlob()

### Community 72 - "Community 72"
Cohesion: 0.47
Nodes (4): ensureLang(), getHighlighter(), langLabel(), toShikiLang()

### Community 75 - "Community 75"
Cohesion: 0.4
Nodes (1): MemoryStorage

### Community 78 - "Community 78"
Cohesion: 0.7
Nodes (4): FOLDER_COLOR_KEY(), getFolderColor(), getFolderColorDot(), setFolderColor()

### Community 80 - "Community 80"
Cohesion: 0.5
Nodes (2): Avatar(), getInitials()

### Community 83 - "Community 83"
Cohesion: 0.5
Nodes (2): AnnouncementBanner(), severityClasses()

### Community 85 - "Community 85"
Cohesion: 0.5
Nodes (2): hashString(), pickIndicesFromPhrase()

### Community 86 - "Community 86"
Cohesion: 0.4
Nodes (2): ImpersonationBanner(), useImpersonation()

### Community 87 - "Community 87"
Cohesion: 0.5
Nodes (2): handleProceed(), validate()

### Community 88 - "Community 88"
Cohesion: 0.5
Nodes (2): getExtension(), getMimeLabel()

### Community 96 - "Community 96"
Cohesion: 0.67
Nodes (2): signUp(), uniqueEmail()

### Community 97 - "Community 97"
Cohesion: 0.67
Nodes (2): signUp(), uniqueEmail()

### Community 98 - "Community 98"
Cohesion: 0.67
Nodes (2): signupAndUnlock(), uniqueEmail()

### Community 101 - "Community 101"
Cohesion: 0.83
Nodes (3): clearTauriSession(), isTauri(), pushTauriSession()

### Community 102 - "Community 102"
Cohesion: 0.5
Nodes (2): ContextMenu(), isPreviewable()

### Community 107 - "Community 107"
Cohesion: 0.83
Nodes (3): extractDroppedItems(), processEntries(), readDirectoryEntry()

### Community 109 - "Community 109"
Cohesion: 0.83
Nodes (3): getMenuItems(), getPendingItems(), SharedContextMenu()

### Community 119 - "Community 119"
Cohesion: 1.0
Nodes (2): createBundleShareLink(), selectRow()

### Community 124 - "Community 124"
Cohesion: 1.0
Nodes (2): checkPasswordPwned(), sha1Hex()

### Community 125 - "Community 125"
Cohesion: 1.0
Nodes (2): deriveSasWords(), fnv1a()

### Community 126 - "Community 126"
Cohesion: 1.0
Nodes (2): mergeRecentlyChangedFiles(), updatedAtMs()

### Community 129 - "Community 129"
Cohesion: 1.0
Nodes (2): ch(), migratePreferences()

### Community 140 - "Community 140"
Cohesion: 0.67
Nodes (2): WasmChunkEncryptor, WasmSearchIndex

## Knowledge Gaps
- **2 isolated node(s):** `WasmChunkEncryptor`, `WasmSearchIndex`
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 23`** (11 nodes): `actionText()`, `dayLabel()`, `DeviceBadge()`, `groupByDay()`, `isAlarmingEvent()`, `isSecurityEvent()`, `loadingMore()`, `metaFor()`, `timeLabel()`, `wsToActivity()`, `activity.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 29`** (10 nodes): `barColor()`, `borderColor()`, `computeEta()`, `computeSpeed()`, `formatChunkSize()`, `formatEta()`, `formatSpeed()`, `phaseLabel()`, `regionLabel()`, `upload-progress-card.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 39`** (8 nodes): `ApiError`, `.constructor()`, `installMocks()`, `pageImpl()`, `resetCaptures()`, `setListPage()`, `stubStream()`, `upload-share-mocks.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 44`** (8 nodes): `computeEta()`, `computeSpeed()`, `formatBytes()`, `formatEta()`, `formatSpeed()`, `pipelineStage()`, `stageLabel()`, `upload-progress.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 63`** (6 nodes): `blob()`, `createFolder()`, `deleteFile()`, `listChildIds()`, `listRootFolderIds()`, `folder-pagination.spec.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 64`** (6 nodes): `computeStep()`, `OnboardingProvider()`, `readLocalStep()`, `useOnboarding()`, `writeLocalStep()`, `onboarding-context.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 66`** (6 nodes): `browserStorage()`, `consumePendingExport()`, `dataExportDownloadFilename()`, `hasPendingExport()`, `markPendingExport()`, `export-intent.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 68`** (6 nodes): `formatBytes()`, `fromBase64url()`, `onDrop()`, `prevent()`, `readRequestPublicKey()`, `upload-request.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 69`** (6 nodes): `ErrorBoundary`, `.componentDidCatch()`, `.constructor()`, `.getDerivedStateFromError()`, `.render()`, `error-boundary.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 70`** (6 nodes): `formatCents()`, `formatDate()`, `methodLabel()`, `statusLabel()`, `statusVariant()`, `TransactionList.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 71`** (6 nodes): `decodeAndConvert()`, `formatTime()`, `handleSeek()`, `pcmToWavBlob()`, `togglePlay()`, `audio-preview.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 75`** (5 nodes): `MemoryStorage`, `.getItem()`, `.removeItem()`, `.setItem()`, `export-intent.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 80`** (5 nodes): `Avatar()`, `formatRelativeDate()`, `getInitials()`, `SecuredBadge()`, `public-profile.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 83`** (5 nodes): `AnnouncementBanner()`, `readDismissed()`, `severityClasses()`, `writeDismissed()`, `announcement-banner.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 85`** (5 nodes): `handleChange()`, `handleVerify()`, `hashString()`, `pickIndicesFromPhrase()`, `mnemonic-verify.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 86`** (5 nodes): `ImpersonationBanner()`, `ImpersonationProvider()`, `useImpersonation()`, `impersonation-banner.tsx`, `impersonation-context.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 87`** (5 nodes): `eur()`, `handleProceed()`, `validate()`, `viesStateFromVerdict()`, `BillingInfoStep.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 88`** (5 nodes): `formatSize()`, `getExtension()`, `getMimeLabel()`, `handleDownload()`, `unsupported-preview.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 96`** (4 nodes): `blockDevAutoLogin()`, `signUp()`, `cli-auth-redirect.spec.ts`, `uniqueEmail()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 97`** (4 nodes): `blockDevAutoLogin()`, `signUp()`, `export-resume.spec.ts`, `uniqueEmail()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 98`** (4 nodes): `escapeRegex()`, `signupAndUnlock()`, `refresh-stability.spec.ts`, `uniqueEmail()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 102`** (4 nodes): `ContextMenu()`, `isPreviewable()`, `context-menu.tsx`, `preview.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 119`** (3 nodes): `createBundleShareLink()`, `selectRow()`, `bundle-share.spec.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 124`** (3 nodes): `checkPasswordPwned()`, `sha1Hex()`, `hibp.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 125`** (3 nodes): `deriveSasWords()`, `fnv1a()`, `sas-words.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 126`** (3 nodes): `mergeRecentlyChangedFiles()`, `updatedAtMs()`, `recent-files.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 129`** (3 nodes): `ch()`, `migratePreferences()`, `notifications.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 140`** (3 nodes): `WasmChunkEncryptor`, `WasmSearchIndex`, `beebeeb_wasm.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `showToast()` connect `Community 1` to `Community 0`, `Community 2`, `Community 4`, `Community 6`, `Community 40`, `Community 41`, `Community 10`, `Community 12`, `Community 22`?**
  _High betweenness centrality (0.062) - this node is a cross-community bridge._
- **Why does `recoveredKeyMatchesAccount()` connect `Community 42` to `Community 2`?**
  _High betweenness centrality (0.046) - this node is a cross-community bridge._
- **Why does `handleRestore()` connect `Community 2` to `Community 8`, `Community 42`?**
  _High betweenness centrality (0.045) - this node is a cross-community bridge._
- **Are the 128 inferred relationships involving `request()` (e.g. with `opaqueRegisterStart()` and `opaqueLoginStart()`) actually correct?**
  _`request()` has 128 INFERRED edges - model-reasoned connections that need verification._
- **Are the 57 inferred relationships involving `showToast()` (e.g. with `doEncryptedUpload()` and `handleDownload()`) actually correct?**
  _`showToast()` has 57 INFERRED edges - model-reasoned connections that need verification._
- **What connects `WasmChunkEncryptor`, `WasmSearchIndex` to the rest of the system?**
  _2 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.01 - nodes in this community are weakly interconnected._