# Graph Report - web-1563  (2026-09-26)

## Corpus Check
- 500 files · ~527,725 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2412 nodes · 3210 edges · 75 communities detected
- Extraction: 80% EXTRACTED · 20% INFERRED · 0% AMBIGUOUS · INFERRED: 627 edges (avg confidence: 0.8)
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
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 47|Community 47]]
- [[_COMMUNITY_Community 49|Community 49]]
- [[_COMMUNITY_Community 52|Community 52]]
- [[_COMMUNITY_Community 54|Community 54]]
- [[_COMMUNITY_Community 55|Community 55]]
- [[_COMMUNITY_Community 63|Community 63]]
- [[_COMMUNITY_Community 64|Community 64]]
- [[_COMMUNITY_Community 65|Community 65]]
- [[_COMMUNITY_Community 67|Community 67]]
- [[_COMMUNITY_Community 68|Community 68]]
- [[_COMMUNITY_Community 71|Community 71]]
- [[_COMMUNITY_Community 74|Community 74]]
- [[_COMMUNITY_Community 75|Community 75]]
- [[_COMMUNITY_Community 76|Community 76]]
- [[_COMMUNITY_Community 77|Community 77]]
- [[_COMMUNITY_Community 78|Community 78]]
- [[_COMMUNITY_Community 80|Community 80]]
- [[_COMMUNITY_Community 81|Community 81]]
- [[_COMMUNITY_Community 82|Community 82]]
- [[_COMMUNITY_Community 83|Community 83]]
- [[_COMMUNITY_Community 87|Community 87]]
- [[_COMMUNITY_Community 88|Community 88]]
- [[_COMMUNITY_Community 93|Community 93]]
- [[_COMMUNITY_Community 95|Community 95]]
- [[_COMMUNITY_Community 96|Community 96]]
- [[_COMMUNITY_Community 99|Community 99]]
- [[_COMMUNITY_Community 100|Community 100]]
- [[_COMMUNITY_Community 101|Community 101]]
- [[_COMMUNITY_Community 102|Community 102]]
- [[_COMMUNITY_Community 103|Community 103]]
- [[_COMMUNITY_Community 104|Community 104]]
- [[_COMMUNITY_Community 113|Community 113]]
- [[_COMMUNITY_Community 119|Community 119]]
- [[_COMMUNITY_Community 126|Community 126]]
- [[_COMMUNITY_Community 127|Community 127]]
- [[_COMMUNITY_Community 135|Community 135]]
- [[_COMMUNITY_Community 136|Community 136]]
- [[_COMMUNITY_Community 148|Community 148]]
- [[_COMMUNITY_Community 152|Community 152]]
- [[_COMMUNITY_Community 157|Community 157]]
- [[_COMMUNITY_Community 168|Community 168]]
- [[_COMMUNITY_Community 169|Community 169]]
- [[_COMMUNITY_Community 170|Community 170]]
- [[_COMMUNITY_Community 176|Community 176]]
- [[_COMMUNITY_Community 178|Community 178]]

## God Nodes (most connected - your core abstractions)
1. `request()` - 139 edges
2. `showToast()` - 62 edges
3. `withProxy()` - 53 edges
4. `getDataViewMemory0()` - 52 edges
5. `takeObject()` - 49 edges
6. `passArray8ToWasm0()` - 38 edges
7. `userFriendlyError()` - 26 edges
8. `getApiUrl()` - 24 edges
9. `getArrayU8FromWasm0()` - 23 edges
10. `encryptedUpload()` - 23 edges

## Surprising Connections (you probably didn't know these)
- `depsForAccount()` --calls--> `compute_recovery_check()`  [INFERRED]
  test/recovery-validation.test.ts → packages/beebeeb-wasm/beebeeb_wasm.js
- `resolveSessionToken()` --calls--> `handleAuthorize()`  [INFERRED]
  packages/shared/src/api/request.ts → src/pages/cli-auth.tsx
- `request()` --calls--> `opaqueRegisterStart()`  [INFERRED]
  packages/shared/src/api/request.ts → src/lib/api.ts
- `request()` --calls--> `opaqueLoginStart()`  [INFERRED]
  packages/shared/src/api/request.ts → src/lib/api.ts
- `request()` --calls--> `setRecoveryCheckIfAbsent()`  [INFERRED]
  packages/shared/src/api/request.ts → src/lib/api.ts

## Communities

### Community 0 - "Community 0"
Cohesion: 0.01
Nodes (176): expectedUserHeaders(), getClientInfo(), provenanceHeaders(), clearSessionConfirmed(), fireAccountDeleted(), fireAccountMismatch(), fireConnectionStatus(), fireErrorNotifier() (+168 more)

### Community 1 - "Community 1"
Cohesion: 0.02
Nodes (131): handleResend(), handleVerify(), decryptAll(), handleNewFolder(), handleSubmit(), handleCopy(), savePermissions(), setExpiry() (+123 more)

### Community 2 - "Community 2"
Cohesion: 0.03
Nodes (105): handleRestore(), attachFreshToken(), buildRequest(), cleanName(), decryptActivitySnapshotName(), describeActivityEventWithFileName(), describeWithName(), hydrateActivityEventDescriptions() (+97 more)

### Community 3 - "Community 3"
Cohesion: 0.06
Nodes (77): addHeapObject(), compute_recovery_check(), debugString(), decodeText(), decompress_gzip(), decrypt_chunk(), decrypt_chunks(), decrypt_metadata() (+69 more)

### Community 4 - "Community 4"
Cohesion: 0.03
Nodes (51): getApiUrl(), downloadBundleItem(), downloadSharedFile(), downloadVersion(), getFileRequestPublic(), revokeAccountSession(), uploadToFileRequest(), canStreamToServiceWorker() (+43 more)

### Community 5 - "Community 5"
Cohesion: 0.04
Nodes (24): BillingBanner(), BillingSuspendedOverlay(), FileList(), if(), timeAgo(), IncidentBanner(), notificationIcon(), toDisplay() (+16 more)

### Community 6 - "Community 6"
Cohesion: 0.06
Nodes (31): performUpload(), uploadThumbnail(), uploadThumbnailLarge(), encryptedUpload(), withNetworkRetry(), basename(), isLikelyAlbumArtOrIcon(), splitName() (+23 more)

### Community 7 - "Community 7"
Cohesion: 0.11
Nodes (9): loadNames(), getSyncOps(), submitSyncOps(), getDeviceId(), payloadToNode(), saveLastSeq(), savePendingOps(), SyncClient (+1 more)

### Community 8 - "Community 8"
Cohesion: 0.15
Nodes (28): cacheKeyPersistent(), cacheKeySessionOnly(), cacheVaultKey(), clearVaultKey(), dbDelete(), dbGet(), dbPut(), getVaultKey() (+20 more)

### Community 9 - "Community 9"
Cohesion: 0.1
Nodes (23): deletePasskey(), finishPasskeyLogin(), getVaultKeyEscrow(), hexToBytes(), listPasskeys(), storeVaultKeyEscrow(), verify2fa(), base64ToBytes() (+15 more)

### Community 10 - "Community 10"
Cohesion: 0.11
Nodes (12): handleConvert(), resolveUpgradeCheckoutFailure(), startUpgradeCheckout(), billingResetNavigationState(), handleBillingResetTestMode(), isBillingResetTestModeError(), getPendingCheckout(), makePreState() (+4 more)

### Community 11 - "Community 11"
Cohesion: 0.22
Nodes (18): anchorOf(), armExpiryTimer(), checkAndClearIfExpired(), clearExpiryTimer(), clearSession(), dbDelete(), dbGet(), dbPut() (+10 more)

### Community 12 - "Community 12"
Cohesion: 0.13
Nodes (12): ErrorBoundary, getTelemetryConsent(), initTelemetry(), installId(), parseDsn(), randomHex(), reportError(), setTelemetryConsent() (+4 more)

### Community 13 - "Community 13"
Cohesion: 0.15
Nodes (8): signUpToChecklist(), signUp(), signUp(), createAccount(), fillSignupForm(), reachPasswordStep(), signupAndUnlock(), uniqueEmail()

### Community 14 - "Community 14"
Cohesion: 0.23
Nodes (18): cacheFileList(), cacheFilePreview(), enforceRowCap(), evictOldestPreviews(), fileListDelete(), fileListGet(), fileListGetAll(), fileListPut() (+10 more)

### Community 15 - "Community 15"
Cohesion: 0.11
Nodes (3): Row(), AndroidKeyboard(), IOSKeyboard()

### Community 16 - "Community 16"
Cohesion: 0.15
Nodes (4): FakeIDBDatabase, FakeIDBRequest, FakeObjectStore, FakeTransaction

### Community 17 - "Community 17"
Cohesion: 0.17
Nodes (9): dismissDevBanner(), enterEdit(), gotoAndSettle(), escapeRe(), openImagePreview(), openPreview(), previewImage(), previewOverlay() (+1 more)

### Community 18 - "Community 18"
Cohesion: 0.14
Nodes (4): commitQuery(), handleSubmit(), loadRecent(), saveRecent()

### Community 22 - "Community 22"
Cohesion: 0.17
Nodes (4): load(), handleDownloadCiphertext(), downloadFile(), handleLoadMore()

### Community 24 - "Community 24"
Cohesion: 0.18
Nodes (1): MemoryStorage

### Community 25 - "Community 25"
Cohesion: 0.25
Nodes (5): formatBytes(), formatStorageSI(), formatStorageSI(), upgradeCardFromFallback(), upgradeCardFromPlanMeta()

### Community 26 - "Community 26"
Cohesion: 0.2
Nodes (2): dayLabel(), groupByDay()

### Community 32 - "Community 32"
Cohesion: 0.22
Nodes (2): formatEta(), formatSpeed()

### Community 33 - "Community 33"
Cohesion: 0.27
Nodes (4): exceedsQuota(), itemNetBytes(), requiredQuotaBytes(), UploadQuotaLedger

### Community 37 - "Community 37"
Cohesion: 0.22
Nodes (1): MemoryStorage

### Community 38 - "Community 38"
Cohesion: 0.28
Nodes (3): bbEnv(), bbLoginViaBrowser(), runBb()

### Community 39 - "Community 39"
Cohesion: 0.31
Nodes (6): shareLinkWithDashOrUnderscore(), openManageShares(), createShareLink(), dismissWelcomeTourIfOpen(), openRowMenu(), uploadTextFile()

### Community 40 - "Community 40"
Cohesion: 0.22
Nodes (2): onRegionChanged(), resolveName()

### Community 41 - "Community 41"
Cohesion: 0.33
Nodes (5): downloadDropboxFile(), expandDropboxPaths(), expandOne(), rateLimitedFetch(), sleepMs()

### Community 47 - "Community 47"
Cohesion: 0.25
Nodes (1): ApiError

### Community 49 - "Community 49"
Cohesion: 0.25
Nodes (4): ApiError, IncorrectPasswordError, parseErrorBody(), SessionTooOldForConfirmationError

### Community 52 - "Community 52"
Cohesion: 0.29
Nodes (2): pipelineStage(), stageLabel()

### Community 54 - "Community 54"
Cohesion: 0.25
Nodes (3): recoveredKeyMatchesAccount(), depsForAccount(), runGate()

### Community 55 - "Community 55"
Cohesion: 0.32
Nodes (4): guestRouteFallback(), parsePlanIntent(), postSignupDestination(), readPlanIntent()

### Community 63 - "Community 63"
Cohesion: 0.29
Nodes (1): MemoryStorage

### Community 64 - "Community 64"
Cohesion: 0.29
Nodes (1): MemoryStorage

### Community 65 - "Community 65"
Cohesion: 0.29
Nodes (1): MemoryStorage

### Community 67 - "Community 67"
Cohesion: 0.38
Nodes (3): getStored(), isValidDensity(), isValidFontSize()

### Community 68 - "Community 68"
Cohesion: 0.38
Nodes (5): allowsFunctional(), getConsent(), hasConsented(), setConsent(), update()

### Community 71 - "Community 71"
Cohesion: 0.33
Nodes (1): MemoryStorage

### Community 74 - "Community 74"
Cohesion: 0.4
Nodes (2): blob(), createFolder()

### Community 75 - "Community 75"
Cohesion: 0.4
Nodes (2): decodeAndConvert(), pcmToWavBlob()

### Community 76 - "Community 76"
Cohesion: 0.47
Nodes (4): ensureLang(), getHighlighter(), langLabel(), toShikiLang()

### Community 77 - "Community 77"
Cohesion: 0.4
Nodes (2): statusLabel(), statusVariant()

### Community 78 - "Community 78"
Cohesion: 0.33
Nodes (3): NewFolderDialog(), SessionTimeoutWarning(), useFocusTrap()

### Community 80 - "Community 80"
Cohesion: 0.4
Nodes (2): consumePendingExport(), hasPendingExport()

### Community 81 - "Community 81"
Cohesion: 0.4
Nodes (2): computeStep(), writeLocalStep()

### Community 82 - "Community 82"
Cohesion: 0.4
Nodes (3): buildOnboardingState(), pilotKeyBlocksSubmit(), handleSubmit()

### Community 83 - "Community 83"
Cohesion: 0.4
Nodes (2): fromBase64url(), readRequestPublicKey()

### Community 87 - "Community 87"
Cohesion: 0.4
Nodes (1): MemoryStorage

### Community 88 - "Community 88"
Cohesion: 0.5
Nodes (2): b64(), sealed()

### Community 93 - "Community 93"
Cohesion: 0.4
Nodes (2): ImpersonationBanner(), useImpersonation()

### Community 95 - "Community 95"
Cohesion: 0.5
Nodes (2): hashString(), pickIndicesFromPhrase()

### Community 96 - "Community 96"
Cohesion: 0.5
Nodes (2): AnnouncementBanner(), severityClasses()

### Community 99 - "Community 99"
Cohesion: 0.5
Nodes (2): getExtension(), getMimeLabel()

### Community 100 - "Community 100"
Cohesion: 0.5
Nodes (2): handleProceed(), validate()

### Community 101 - "Community 101"
Cohesion: 0.7
Nodes (4): FOLDER_COLOR_KEY(), getFolderColor(), getFolderColorDot(), setFolderColor()

### Community 102 - "Community 102"
Cohesion: 0.6
Nodes (3): checkEditability(), isValidUtf8(), looksBinary()

### Community 103 - "Community 103"
Cohesion: 0.6
Nodes (3): decryptFromQr(), deriveQrKey(), encryptForQr()

### Community 104 - "Community 104"
Cohesion: 0.5
Nodes (2): Avatar(), getInitials()

### Community 113 - "Community 113"
Cohesion: 0.67
Nodes (2): intent(), pre()

### Community 119 - "Community 119"
Cohesion: 0.67
Nodes (2): dismissOverlays(), openRowMenu()

### Community 126 - "Community 126"
Cohesion: 0.83
Nodes (3): extractDroppedItems(), processEntries(), readDirectoryEntry()

### Community 127 - "Community 127"
Cohesion: 0.83
Nodes (3): getMenuItems(), getPendingItems(), SharedContextMenu()

### Community 135 - "Community 135"
Cohesion: 0.67
Nodes (2): reconcileSignalOutcome(), reflectsUpgrade()

### Community 136 - "Community 136"
Cohesion: 0.5
Nodes (2): ContextMenu(), isPreviewable()

### Community 148 - "Community 148"
Cohesion: 0.67
Nodes (2): WasmChunkEncryptor, WasmSearchIndex

### Community 152 - "Community 152"
Cohesion: 1.0
Nodes (2): totp(), wrongCode()

### Community 157 - "Community 157"
Cohesion: 1.0
Nodes (2): createBundleShareLink(), selectRow()

### Community 168 - "Community 168"
Cohesion: 1.0
Nodes (2): mergeRecentlyChangedFiles(), updatedAtMs()

### Community 169 - "Community 169"
Cohesion: 1.0
Nodes (2): checkPasswordBreached(), sha1Hex()

### Community 170 - "Community 170"
Cohesion: 1.0
Nodes (2): deriveSasWords(), fnv1a()

### Community 176 - "Community 176"
Cohesion: 1.0
Nodes (2): isKeyBoundToUser(), KeyProvider()

### Community 178 - "Community 178"
Cohesion: 1.0
Nodes (2): ch(), migratePreferences()

## Knowledge Gaps
- **2 isolated node(s):** `WasmChunkEncryptor`, `WasmSearchIndex`
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 24`** (11 nodes): `flush()`, `MemoryStorage`, `.clear()`, `.getItem()`, `.removeItem()`, `.setItem()`, `patchLastActivityAt()`, `randomKey()`, `rawEntry()`, `releaseHold()`, `1532-session-sliding-expiry.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 26`** (11 nodes): `actionText()`, `dayLabel()`, `DeviceBadge()`, `groupByDay()`, `isAlarmingEvent()`, `isSecurityEvent()`, `loadingMore()`, `metaFor()`, `timeLabel()`, `wsToActivity()`, `activity.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 32`** (10 nodes): `barColor()`, `borderColor()`, `computeEta()`, `computeSpeed()`, `formatChunkSize()`, `formatEta()`, `formatSpeed()`, `phaseLabel()`, `regionLabel()`, `upload-progress-card.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 37`** (9 nodes): `MemoryStorage`, `.clear()`, `.getItem()`, `.removeItem()`, `.setItem()`, `randomKey()`, `stripUserId()`, `1531-account-binding.test.ts`, `writeUntaggedVaultEntry()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 40`** (9 nodes): `formatStorageSI()`, `onDown()`, `onFileUploaded()`, `onKey()`, `onRegionChanged()`, `pruned()`, `PwaInstallBanner()`, `resolveName()`, `drive-layout.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 47`** (8 nodes): `ApiError`, `.constructor()`, `installMocks()`, `pageImpl()`, `resetCaptures()`, `setListPage()`, `stubStream()`, `upload-share-mocks.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 52`** (8 nodes): `computeEta()`, `computeSpeed()`, `formatBytes()`, `formatEta()`, `formatSpeed()`, `pipelineStage()`, `stageLabel()`, `upload-progress.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 63`** (7 nodes): `MemoryStorage`, `.clear()`, `.getItem()`, `.removeItem()`, `.setItem()`, `sub()`, `pricing-checkout-intent-1469.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 64`** (7 nodes): `MemoryStorage`, `.clear()`, `.getItem()`, `.removeItem()`, `.setItem()`, `sub()`, `upgrade-nudge-checkout-intent-1469.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 65`** (7 nodes): `cookieUser()`, `MemoryStorage`, `.clear()`, `.getItem()`, `.removeItem()`, `.setItem()`, `1471-isloggedin-auth-context.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 71`** (6 nodes): `MemoryStorage`, `.clear()`, `.getItem()`, `.removeItem()`, `.setItem()`, `pending-checkout-0957.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 74`** (6 nodes): `blob()`, `createFolder()`, `deleteFile()`, `listChildIds()`, `listRootFolderIds()`, `folder-pagination.spec.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 75`** (6 nodes): `decodeAndConvert()`, `formatTime()`, `handleSeek()`, `pcmToWavBlob()`, `togglePlay()`, `audio-preview.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 77`** (6 nodes): `formatCents()`, `formatDate()`, `methodLabel()`, `statusLabel()`, `statusVariant()`, `TransactionList.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 80`** (6 nodes): `browserStorage()`, `consumePendingExport()`, `dataExportDownloadFilename()`, `hasPendingExport()`, `markPendingExport()`, `export-intent.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 81`** (6 nodes): `computeStep()`, `OnboardingProvider()`, `readLocalStep()`, `useOnboarding()`, `writeLocalStep()`, `onboarding-context.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 83`** (6 nodes): `formatBytes()`, `fromBase64url()`, `onDrop()`, `prevent()`, `readRequestPublicKey()`, `upload-request.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 87`** (5 nodes): `MemoryStorage`, `.getItem()`, `.removeItem()`, `.setItem()`, `export-intent.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 88`** (5 nodes): `b64()`, `invite()`, `ports()`, `sealed()`, `folder-invite-recipient-key.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 93`** (5 nodes): `ImpersonationBanner()`, `ImpersonationProvider()`, `useImpersonation()`, `impersonation-banner.tsx`, `impersonation-context.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 95`** (5 nodes): `handleChange()`, `handleVerify()`, `hashString()`, `pickIndicesFromPhrase()`, `mnemonic-verify.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 96`** (5 nodes): `AnnouncementBanner()`, `readDismissed()`, `severityClasses()`, `writeDismissed()`, `announcement-banner.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 99`** (5 nodes): `formatSize()`, `getExtension()`, `getMimeLabel()`, `handleDownload()`, `unsupported-preview.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 100`** (5 nodes): `eur()`, `handleProceed()`, `validate()`, `viesStateFromVerdict()`, `BillingInfoStep.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 104`** (5 nodes): `Avatar()`, `formatRelativeDate()`, `getInitials()`, `SecuredBadge()`, `public-profile.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 113`** (4 nodes): `intent()`, `pre()`, `sub()`, `checkout-reconcile-0957.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 119`** (4 nodes): `dismissOverlays()`, `freshContext()`, `openRowMenu()`, `folder-invite-recipient-decrypt.spec.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 135`** (4 nodes): `reconcileSignalOutcome()`, `reflectsUpgrade()`, `reflectsUpgradeNoIntent()`, `checkout-reconcile.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 136`** (4 nodes): `ContextMenu()`, `isPreviewable()`, `context-menu.tsx`, `preview.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 148`** (3 nodes): `WasmChunkEncryptor`, `WasmSearchIndex`, `beebeeb_wasm.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 152`** (3 nodes): `totp()`, `2fa-wrong-code-feedback.spec.ts`, `wrongCode()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 157`** (3 nodes): `createBundleShareLink()`, `selectRow()`, `bundle-share.spec.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 168`** (3 nodes): `mergeRecentlyChangedFiles()`, `updatedAtMs()`, `recent-files.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 169`** (3 nodes): `checkPasswordBreached()`, `sha1Hex()`, `breach-check.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 170`** (3 nodes): `deriveSasWords()`, `fnv1a()`, `sas-words.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 176`** (3 nodes): `isKeyBoundToUser()`, `KeyProvider()`, `key-context.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 178`** (3 nodes): `ch()`, `migratePreferences()`, `notifications.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `showToast()` connect `Community 1` to `Community 11`, `Community 10`, `Community 2`, `Community 6`?**
  _High betweenness centrality (0.062) - this node is a cross-community bridge._
- **Why does `handleRestore()` connect `Community 2` to `Community 54`?**
  _High betweenness centrality (0.030) - this node is a cross-community bridge._
- **Why does `recoveredKeyMatchesAccount()` connect `Community 54` to `Community 2`?**
  _High betweenness centrality (0.029) - this node is a cross-community bridge._
- **Are the 133 inferred relationships involving `request()` (e.g. with `provenanceHeaders()` and `expectedUserHeaders()`) actually correct?**
  _`request()` has 133 INFERRED edges - model-reasoned connections that need verification._
- **Are the 58 inferred relationships involving `showToast()` (e.g. with `handleCopy()` and `handleSubmit()`) actually correct?**
  _`showToast()` has 58 INFERRED edges - model-reasoned connections that need verification._
- **What connects `WasmChunkEncryptor`, `WasmSearchIndex` to the rest of the system?**
  _2 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.01 - nodes in this community are weakly interconnected._