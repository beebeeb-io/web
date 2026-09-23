# Graph Report - web-1495  (2026-09-23)

## Corpus Check
- 400 files · ~429,416 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2102 nodes · 2912 edges · 68 communities detected
- Extraction: 79% EXTRACTED · 21% INFERRED · 0% AMBIGUOUS · INFERRED: 604 edges (avg confidence: 0.8)
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
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 47|Community 47]]
- [[_COMMUNITY_Community 55|Community 55]]
- [[_COMMUNITY_Community 56|Community 56]]
- [[_COMMUNITY_Community 57|Community 57]]
- [[_COMMUNITY_Community 58|Community 58]]
- [[_COMMUNITY_Community 60|Community 60]]
- [[_COMMUNITY_Community 61|Community 61]]
- [[_COMMUNITY_Community 64|Community 64]]
- [[_COMMUNITY_Community 65|Community 65]]
- [[_COMMUNITY_Community 67|Community 67]]
- [[_COMMUNITY_Community 69|Community 69]]
- [[_COMMUNITY_Community 70|Community 70]]
- [[_COMMUNITY_Community 71|Community 71]]
- [[_COMMUNITY_Community 72|Community 72]]
- [[_COMMUNITY_Community 74|Community 74]]
- [[_COMMUNITY_Community 75|Community 75]]
- [[_COMMUNITY_Community 76|Community 76]]
- [[_COMMUNITY_Community 80|Community 80]]
- [[_COMMUNITY_Community 84|Community 84]]
- [[_COMMUNITY_Community 86|Community 86]]
- [[_COMMUNITY_Community 87|Community 87]]
- [[_COMMUNITY_Community 90|Community 90]]
- [[_COMMUNITY_Community 91|Community 91]]
- [[_COMMUNITY_Community 92|Community 92]]
- [[_COMMUNITY_Community 93|Community 93]]
- [[_COMMUNITY_Community 94|Community 94]]
- [[_COMMUNITY_Community 103|Community 103]]
- [[_COMMUNITY_Community 111|Community 111]]
- [[_COMMUNITY_Community 112|Community 112]]
- [[_COMMUNITY_Community 113|Community 113]]
- [[_COMMUNITY_Community 114|Community 114]]
- [[_COMMUNITY_Community 118|Community 118]]
- [[_COMMUNITY_Community 120|Community 120]]
- [[_COMMUNITY_Community 132|Community 132]]
- [[_COMMUNITY_Community 133|Community 133]]
- [[_COMMUNITY_Community 138|Community 138]]
- [[_COMMUNITY_Community 148|Community 148]]
- [[_COMMUNITY_Community 149|Community 149]]
- [[_COMMUNITY_Community 150|Community 150]]
- [[_COMMUNITY_Community 154|Community 154]]

## God Nodes (most connected - your core abstractions)
1. `request()` - 136 edges
2. `showToast()` - 61 edges
3. `withProxy()` - 53 edges
4. `getDataViewMemory0()` - 52 edges
5. `takeObject()` - 49 edges
6. `passArray8ToWasm0()` - 38 edges
7. `userFriendlyError()` - 24 edges
8. `getArrayU8FromWasm0()` - 23 edges
9. `getApiUrl()` - 23 edges
10. `encryptedUpload()` - 22 edges

## Surprising Connections (you probably didn't know these)
- `depsForAccount()` --calls--> `compute_recovery_check()`  [INFERRED]
  test/recovery-validation.test.ts → packages/beebeeb-wasm/beebeeb_wasm.js
- `request()` --calls--> `opaqueRegisterStart()`  [INFERRED]
  packages/shared/src/api/request.ts → src/lib/api.ts
- `request()` --calls--> `opaqueLoginStart()`  [INFERRED]
  packages/shared/src/api/request.ts → src/lib/api.ts
- `request()` --calls--> `setRecoveryCheckIfAbsent()`  [INFERRED]
  packages/shared/src/api/request.ts → src/lib/api.ts
- `request()` --calls--> `recoverOpaqueRegister()`  [INFERRED]
  packages/shared/src/api/request.ts → src/lib/api.ts

## Communities

### Community 0 - "Community 0"
Cohesion: 0.01
Nodes (176): clearSessionConfirmed(), fireAccountDeleted(), fireConnectionStatus(), fireErrorNotifier(), fireSessionExpired(), markSessionConfirmed(), wasSessionConfirmed(), delay() (+168 more)

### Community 1 - "Community 1"
Cohesion: 0.03
Nodes (98): handleResend(), handleVerify(), FileList(), if(), timeAgo(), handleNewFolder(), handleSubmit(), formatBytes() (+90 more)

### Community 2 - "Community 2"
Cohesion: 0.03
Nodes (89): attachFreshToken(), buildRequest(), handleCopy(), cleanName(), decryptActivitySnapshotName(), describeActivityEventWithFileName(), describeWithName(), hydrateActivityEventDescriptions() (+81 more)

### Community 3 - "Community 3"
Cohesion: 0.06
Nodes (77): addHeapObject(), compute_recovery_check(), debugString(), decodeText(), decompress_gzip(), decrypt_chunk(), decrypt_chunks(), decrypt_metadata() (+69 more)

### Community 4 - "Community 4"
Cohesion: 0.05
Nodes (33): onRegionChanged(), resolveName(), decryptAll(), downloadBundleItem(), downloadSharedFile(), canStreamToServiceWorker(), createBlobSink(), createSwSink() (+25 more)

### Community 5 - "Community 5"
Cohesion: 0.05
Nodes (24): getApiUrl(), getClientInfo(), provenanceHeaders(), downloadVersion(), getFileRequestPublic(), uploadToFileRequest(), CoreSearchIndex, decryptIndex() (+16 more)

### Community 6 - "Community 6"
Cohesion: 0.04
Nodes (19): BillingBanner(), BillingSuspendedOverlay(), IncidentBanner(), NewFolderDialog(), notificationIcon(), toDisplay(), useNotifications(), RenameDialog() (+11 more)

### Community 7 - "Community 7"
Cohesion: 0.06
Nodes (34): handleCodeSubmit(), handlePasskeyUnlock(), handleRestore(), consumeAccountDeletedNotice(), credentialToAuthenticationJSON(), finishPasskeyLogin(), getVaultKeyEscrow(), hexToBytes() (+26 more)

### Community 8 - "Community 8"
Cohesion: 0.07
Nodes (29): uploadThumbnail(), uploadThumbnailLarge(), encryptedUpload(), withNetworkRetry(), basename(), isLikelyAlbumArtOrIcon(), splitName(), decryptThumbnailBlob() (+21 more)

### Community 9 - "Community 9"
Cohesion: 0.07
Nodes (22): downloadDropboxFile(), expandDropboxPaths(), expandOne(), rateLimitedFetch(), sleepMs(), expandFolder(), expandGoogleDrivePaths(), GoogleAuthError (+14 more)

### Community 10 - "Community 10"
Cohesion: 0.11
Nodes (9): loadNames(), getSyncOps(), submitSyncOps(), getDeviceId(), payloadToNode(), saveLastSeq(), savePendingOps(), SyncClient (+1 more)

### Community 11 - "Community 11"
Cohesion: 0.13
Nodes (8): handleConvert(), startUpgradeCheckout(), getPendingCheckout(), makePreState(), persistTrialConvertIntent(), setPendingCheckout(), handleSelect(), startPlanCheckout()

### Community 12 - "Community 12"
Cohesion: 0.11
Nodes (11): timeAgo(), getSharesForFile(), restoreFile(), loadActivity(), buildDetailsMeta(), displayName(), handleRestore(), handleRestoreAll() (+3 more)

### Community 13 - "Community 13"
Cohesion: 0.23
Nodes (18): cacheFileList(), cacheFilePreview(), enforceRowCap(), evictOldestPreviews(), fileListDelete(), fileListGet(), fileListGetAll(), fileListPut() (+10 more)

### Community 14 - "Community 14"
Cohesion: 0.11
Nodes (3): Row(), AndroidKeyboard(), IOSKeyboard()

### Community 15 - "Community 15"
Cohesion: 0.18
Nodes (11): clearSession(), dbDelete(), dbGet(), dbPut(), deriveKey(), getVaultTTL(), openDB(), persistSession() (+3 more)

### Community 16 - "Community 16"
Cohesion: 0.14
Nodes (4): commitQuery(), handleSubmit(), loadRecent(), saveRecent()

### Community 17 - "Community 17"
Cohesion: 0.36
Nodes (13): clearVault(), computeKeyCheck(), dbClear(), dbGet(), dbPut(), deriveWrappingKey(), hasVault(), importAesKey() (+5 more)

### Community 20 - "Community 20"
Cohesion: 0.28
Nodes (7): signUp(), signUp(), createAccount(), fillSignupForm(), reachPasswordStep(), signupAndUnlock(), uniqueEmail()

### Community 22 - "Community 22"
Cohesion: 0.17
Nodes (4): load(), handleDownloadCiphertext(), downloadFile(), handleLoadMore()

### Community 23 - "Community 23"
Cohesion: 0.32
Nodes (9): devAutoAuth(), cacheVaultKey(), clearVaultKey(), dbDelete(), dbGet(), dbPut(), getVaultKey(), initSessionVault() (+1 more)

### Community 25 - "Community 25"
Cohesion: 0.29
Nodes (6): escapeRe(), openImagePreview(), openPreview(), previewImage(), previewOverlay(), uploadAndWait()

### Community 26 - "Community 26"
Cohesion: 0.2
Nodes (2): dayLabel(), groupByDay()

### Community 27 - "Community 27"
Cohesion: 0.25
Nodes (5): formatBytes(), formatStorageSI(), formatStorageSI(), upgradeCardFromFallback(), upgradeCardFromPlanMeta()

### Community 32 - "Community 32"
Cohesion: 0.22
Nodes (2): formatEta(), formatSpeed()

### Community 41 - "Community 41"
Cohesion: 0.25
Nodes (1): ApiError

### Community 43 - "Community 43"
Cohesion: 0.29
Nodes (3): savePermissions(), setExpiry(), patchInvite()

### Community 45 - "Community 45"
Cohesion: 0.29
Nodes (2): pipelineStage(), stageLabel()

### Community 47 - "Community 47"
Cohesion: 0.29
Nodes (4): copyToClipboard(), handleCopy(), handleRevoke(), revokeShare()

### Community 55 - "Community 55"
Cohesion: 0.29
Nodes (1): MemoryStorage

### Community 56 - "Community 56"
Cohesion: 0.29
Nodes (1): MemoryStorage

### Community 57 - "Community 57"
Cohesion: 0.29
Nodes (1): MemoryStorage

### Community 58 - "Community 58"
Cohesion: 0.29
Nodes (3): ApiError, IncorrectPasswordError, SessionTooOldForConfirmationError

### Community 60 - "Community 60"
Cohesion: 0.38
Nodes (5): allowsFunctional(), getConsent(), hasConsented(), setConsent(), update()

### Community 61 - "Community 61"
Cohesion: 0.38
Nodes (3): getStored(), isValidDensity(), isValidFontSize()

### Community 64 - "Community 64"
Cohesion: 0.33
Nodes (1): MemoryStorage

### Community 65 - "Community 65"
Cohesion: 0.4
Nodes (3): openManageShares(), createShareLink(), openRowMenu()

### Community 67 - "Community 67"
Cohesion: 0.4
Nodes (2): blob(), createFolder()

### Community 69 - "Community 69"
Cohesion: 0.33
Nodes (1): ErrorBoundary

### Community 70 - "Community 70"
Cohesion: 0.4
Nodes (2): decodeAndConvert(), pcmToWavBlob()

### Community 71 - "Community 71"
Cohesion: 0.47
Nodes (4): ensureLang(), getHighlighter(), langLabel(), toShikiLang()

### Community 72 - "Community 72"
Cohesion: 0.4
Nodes (2): statusLabel(), statusVariant()

### Community 74 - "Community 74"
Cohesion: 0.4
Nodes (2): consumePendingExport(), hasPendingExport()

### Community 75 - "Community 75"
Cohesion: 0.4
Nodes (2): computeStep(), writeLocalStep()

### Community 76 - "Community 76"
Cohesion: 0.4
Nodes (2): fromBase64url(), readRequestPublicKey()

### Community 80 - "Community 80"
Cohesion: 0.4
Nodes (1): MemoryStorage

### Community 84 - "Community 84"
Cohesion: 0.4
Nodes (1): handleResend()

### Community 86 - "Community 86"
Cohesion: 0.5
Nodes (2): hashString(), pickIndicesFromPhrase()

### Community 87 - "Community 87"
Cohesion: 0.5
Nodes (2): AnnouncementBanner(), severityClasses()

### Community 90 - "Community 90"
Cohesion: 0.5
Nodes (2): getExtension(), getMimeLabel()

### Community 91 - "Community 91"
Cohesion: 0.5
Nodes (2): handleProceed(), validate()

### Community 92 - "Community 92"
Cohesion: 0.4
Nodes (2): ImpersonationBanner(), useImpersonation()

### Community 93 - "Community 93"
Cohesion: 0.7
Nodes (4): FOLDER_COLOR_KEY(), getFolderColor(), getFolderColorDot(), setFolderColor()

### Community 94 - "Community 94"
Cohesion: 0.5
Nodes (2): Avatar(), getInitials()

### Community 103 - "Community 103"
Cohesion: 0.67
Nodes (2): intent(), pre()

### Community 111 - "Community 111"
Cohesion: 0.83
Nodes (3): extractDroppedItems(), processEntries(), readDirectoryEntry()

### Community 112 - "Community 112"
Cohesion: 0.5
Nodes (1): poll()

### Community 113 - "Community 113"
Cohesion: 0.83
Nodes (3): getMenuItems(), getPendingItems(), SharedContextMenu()

### Community 114 - "Community 114"
Cohesion: 0.5
Nodes (2): ContextMenu(), isPreviewable()

### Community 118 - "Community 118"
Cohesion: 0.83
Nodes (3): downloadAsHtml(), escapeHtml(), generateRecoveryKitPDF()

### Community 120 - "Community 120"
Cohesion: 0.67
Nodes (2): reconcileSignalOutcome(), reflectsUpgrade()

### Community 132 - "Community 132"
Cohesion: 0.67
Nodes (2): WasmChunkEncryptor, WasmSearchIndex

### Community 133 - "Community 133"
Cohesion: 1.0
Nodes (2): scrubFrames(), scrubText()

### Community 138 - "Community 138"
Cohesion: 1.0
Nodes (2): createBundleShareLink(), selectRow()

### Community 148 - "Community 148"
Cohesion: 1.0
Nodes (2): mergeRecentlyChangedFiles(), updatedAtMs()

### Community 149 - "Community 149"
Cohesion: 1.0
Nodes (2): checkPasswordBreached(), sha1Hex()

### Community 150 - "Community 150"
Cohesion: 1.0
Nodes (2): deriveSasWords(), fnv1a()

### Community 154 - "Community 154"
Cohesion: 1.0
Nodes (2): ch(), migratePreferences()

## Knowledge Gaps
- **2 isolated node(s):** `WasmChunkEncryptor`, `WasmSearchIndex`
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 26`** (11 nodes): `actionText()`, `dayLabel()`, `DeviceBadge()`, `groupByDay()`, `isAlarmingEvent()`, `isSecurityEvent()`, `loadingMore()`, `metaFor()`, `timeLabel()`, `wsToActivity()`, `activity.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 32`** (10 nodes): `barColor()`, `borderColor()`, `computeEta()`, `computeSpeed()`, `formatChunkSize()`, `formatEta()`, `formatSpeed()`, `phaseLabel()`, `regionLabel()`, `upload-progress-card.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 41`** (8 nodes): `ApiError`, `.constructor()`, `installMocks()`, `pageImpl()`, `resetCaptures()`, `setListPage()`, `stubStream()`, `upload-share-mocks.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 45`** (8 nodes): `computeEta()`, `computeSpeed()`, `formatBytes()`, `formatEta()`, `formatSpeed()`, `pipelineStage()`, `stageLabel()`, `upload-progress.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 55`** (7 nodes): `MemoryStorage`, `.clear()`, `.getItem()`, `.removeItem()`, `.setItem()`, `sub()`, `pricing-checkout-intent-1469.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 56`** (7 nodes): `MemoryStorage`, `.clear()`, `.getItem()`, `.removeItem()`, `.setItem()`, `sub()`, `upgrade-nudge-checkout-intent-1469.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 57`** (7 nodes): `cookieUser()`, `MemoryStorage`, `.clear()`, `.getItem()`, `.removeItem()`, `.setItem()`, `1471-isloggedin-auth-context.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 64`** (6 nodes): `MemoryStorage`, `.clear()`, `.getItem()`, `.removeItem()`, `.setItem()`, `pending-checkout-0957.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 67`** (6 nodes): `blob()`, `createFolder()`, `deleteFile()`, `listChildIds()`, `listRootFolderIds()`, `folder-pagination.spec.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 69`** (6 nodes): `ErrorBoundary`, `.componentDidCatch()`, `.constructor()`, `.getDerivedStateFromError()`, `.render()`, `error-boundary.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 70`** (6 nodes): `decodeAndConvert()`, `formatTime()`, `handleSeek()`, `pcmToWavBlob()`, `togglePlay()`, `audio-preview.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 72`** (6 nodes): `formatCents()`, `formatDate()`, `methodLabel()`, `statusLabel()`, `statusVariant()`, `TransactionList.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 74`** (6 nodes): `browserStorage()`, `consumePendingExport()`, `dataExportDownloadFilename()`, `hasPendingExport()`, `markPendingExport()`, `export-intent.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 75`** (6 nodes): `computeStep()`, `OnboardingProvider()`, `readLocalStep()`, `useOnboarding()`, `writeLocalStep()`, `onboarding-context.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 76`** (6 nodes): `formatBytes()`, `fromBase64url()`, `onDrop()`, `prevent()`, `readRequestPublicKey()`, `upload-request.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 80`** (5 nodes): `MemoryStorage`, `.getItem()`, `.removeItem()`, `.setItem()`, `export-intent.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 84`** (5 nodes): `handleInput()`, `handleKeyDown()`, `handlePaste()`, `handleResend()`, `verify-email.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 86`** (5 nodes): `handleChange()`, `handleVerify()`, `hashString()`, `pickIndicesFromPhrase()`, `mnemonic-verify.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 87`** (5 nodes): `AnnouncementBanner()`, `readDismissed()`, `severityClasses()`, `writeDismissed()`, `announcement-banner.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 90`** (5 nodes): `formatSize()`, `getExtension()`, `getMimeLabel()`, `handleDownload()`, `unsupported-preview.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 91`** (5 nodes): `eur()`, `handleProceed()`, `validate()`, `viesStateFromVerdict()`, `BillingInfoStep.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 92`** (5 nodes): `ImpersonationBanner()`, `ImpersonationProvider()`, `useImpersonation()`, `impersonation-banner.tsx`, `impersonation-context.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 94`** (5 nodes): `Avatar()`, `formatRelativeDate()`, `getInitials()`, `SecuredBadge()`, `public-profile.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 103`** (4 nodes): `intent()`, `pre()`, `sub()`, `checkout-reconcile-0957.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 112`** (4 nodes): `colourFor()`, `initials()`, `poll()`, `presence-avatars.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 114`** (4 nodes): `ContextMenu()`, `isPreviewable()`, `context-menu.tsx`, `preview.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 120`** (4 nodes): `reconcileSignalOutcome()`, `reflectsUpgrade()`, `reflectsUpgradeNoIntent()`, `checkout-reconcile.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 132`** (3 nodes): `WasmChunkEncryptor`, `WasmSearchIndex`, `beebeeb_wasm.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 133`** (3 nodes): `scrub.ts`, `scrubFrames()`, `scrubText()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 138`** (3 nodes): `createBundleShareLink()`, `selectRow()`, `bundle-share.spec.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 148`** (3 nodes): `mergeRecentlyChangedFiles()`, `updatedAtMs()`, `recent-files.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 149`** (3 nodes): `checkPasswordBreached()`, `sha1Hex()`, `breach-check.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 150`** (3 nodes): `deriveSasWords()`, `fnv1a()`, `sas-words.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 154`** (3 nodes): `ch()`, `migratePreferences()`, `notifications.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `handleRestore()` connect `Community 7` to `Community 2`?**
  _High betweenness centrality (0.053) - this node is a cross-community bridge._
- **Are the 130 inferred relationships involving `request()` (e.g. with `provenanceHeaders()` and `getApiUrl()`) actually correct?**
  _`request()` has 130 INFERRED edges - model-reasoned connections that need verification._
- **Are the 57 inferred relationships involving `showToast()` (e.g. with `handleCopy()` and `handleSubmit()`) actually correct?**
  _`showToast()` has 57 INFERRED edges - model-reasoned connections that need verification._
- **What connects `WasmChunkEncryptor`, `WasmSearchIndex` to the rest of the system?**
  _2 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.01 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.03 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.03 - nodes in this community are weakly interconnected._