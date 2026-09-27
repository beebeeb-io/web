# Graph Report - web-file-list-stale-timer  (2026-09-27)

## Corpus Check
- 542 files · ~548,495 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2548 nodes · 3378 edges · 89 communities detected
- Extraction: 81% EXTRACTED · 19% INFERRED · 0% AMBIGUOUS · INFERRED: 640 edges (avg confidence: 0.8)
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
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 44|Community 44]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 51|Community 51]]
- [[_COMMUNITY_Community 52|Community 52]]
- [[_COMMUNITY_Community 54|Community 54]]
- [[_COMMUNITY_Community 57|Community 57]]
- [[_COMMUNITY_Community 59|Community 59]]
- [[_COMMUNITY_Community 67|Community 67]]
- [[_COMMUNITY_Community 68|Community 68]]
- [[_COMMUNITY_Community 69|Community 69]]
- [[_COMMUNITY_Community 71|Community 71]]
- [[_COMMUNITY_Community 72|Community 72]]
- [[_COMMUNITY_Community 73|Community 73]]
- [[_COMMUNITY_Community 76|Community 76]]
- [[_COMMUNITY_Community 77|Community 77]]
- [[_COMMUNITY_Community 80|Community 80]]
- [[_COMMUNITY_Community 81|Community 81]]
- [[_COMMUNITY_Community 82|Community 82]]
- [[_COMMUNITY_Community 83|Community 83]]
- [[_COMMUNITY_Community 84|Community 84]]
- [[_COMMUNITY_Community 86|Community 86]]
- [[_COMMUNITY_Community 87|Community 87]]
- [[_COMMUNITY_Community 88|Community 88]]
- [[_COMMUNITY_Community 89|Community 89]]
- [[_COMMUNITY_Community 93|Community 93]]
- [[_COMMUNITY_Community 94|Community 94]]
- [[_COMMUNITY_Community 95|Community 95]]
- [[_COMMUNITY_Community 98|Community 98]]
- [[_COMMUNITY_Community 102|Community 102]]
- [[_COMMUNITY_Community 103|Community 103]]
- [[_COMMUNITY_Community 106|Community 106]]
- [[_COMMUNITY_Community 107|Community 107]]
- [[_COMMUNITY_Community 108|Community 108]]
- [[_COMMUNITY_Community 109|Community 109]]
- [[_COMMUNITY_Community 110|Community 110]]
- [[_COMMUNITY_Community 111|Community 111]]
- [[_COMMUNITY_Community 112|Community 112]]
- [[_COMMUNITY_Community 122|Community 122]]
- [[_COMMUNITY_Community 128|Community 128]]
- [[_COMMUNITY_Community 129|Community 129]]
- [[_COMMUNITY_Community 134|Community 134]]
- [[_COMMUNITY_Community 137|Community 137]]
- [[_COMMUNITY_Community 138|Community 138]]
- [[_COMMUNITY_Community 139|Community 139]]
- [[_COMMUNITY_Community 141|Community 141]]
- [[_COMMUNITY_Community 149|Community 149]]
- [[_COMMUNITY_Community 161|Community 161]]
- [[_COMMUNITY_Community 163|Community 163]]
- [[_COMMUNITY_Community 166|Community 166]]
- [[_COMMUNITY_Community 171|Community 171]]
- [[_COMMUNITY_Community 183|Community 183]]
- [[_COMMUNITY_Community 184|Community 184]]
- [[_COMMUNITY_Community 185|Community 185]]
- [[_COMMUNITY_Community 186|Community 186]]
- [[_COMMUNITY_Community 190|Community 190]]
- [[_COMMUNITY_Community 192|Community 192]]
- [[_COMMUNITY_Community 194|Community 194]]

## God Nodes (most connected - your core abstractions)
1. `request()` - 140 edges
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
Nodes (202): expectedUserHeaders(), getClientInfo(), provenanceHeaders(), clearSessionConfirmed(), fireAccountDeleted(), fireAccountMismatch(), fireConnectionStatus(), fireErrorNotifier() (+194 more)

### Community 1 - "Community 1"
Cohesion: 0.02
Nodes (105): handleProceed(), validate(), handleResend(), decryptAll(), handleNewFolder(), handleSubmit(), handleCopy(), savePermissions() (+97 more)

### Community 2 - "Community 2"
Cohesion: 0.03
Nodes (105): handleRestore(), attachFreshToken(), buildRequest(), cleanName(), decryptActivitySnapshotName(), describeActivityEventWithFileName(), describeWithName(), hydrateActivityEventDescriptions() (+97 more)

### Community 3 - "Community 3"
Cohesion: 0.06
Nodes (77): addHeapObject(), compute_recovery_check(), debugString(), decodeText(), decompress_gzip(), decrypt_chunk(), decrypt_chunks(), decrypt_metadata() (+69 more)

### Community 4 - "Community 4"
Cohesion: 0.04
Nodes (46): getApiUrl(), downloadBundleItem(), downloadSharedFile(), downloadVersion(), getFileRequestPublic(), revokeAccountSession(), uploadToFileRequest(), dispatchDecrypted() (+38 more)

### Community 5 - "Community 5"
Cohesion: 0.04
Nodes (24): BillingBanner(), BillingSuspendedOverlay(), FileList(), if(), timeAgo(), IncidentBanner(), notificationIcon(), toDisplay() (+16 more)

### Community 6 - "Community 6"
Cohesion: 0.06
Nodes (31): performUpload(), uploadThumbnail(), uploadThumbnailLarge(), encryptedUpload(), withNetworkRetry(), basename(), isLikelyAlbumArtOrIcon(), splitName() (+23 more)

### Community 7 - "Community 7"
Cohesion: 0.07
Nodes (22): downloadDropboxFile(), expandDropboxPaths(), expandOne(), rateLimitedFetch(), sleepMs(), expandFolder(), expandGoogleDrivePaths(), GoogleAuthError (+14 more)

### Community 8 - "Community 8"
Cohesion: 0.11
Nodes (9): loadNames(), getSyncOps(), submitSyncOps(), getDeviceId(), payloadToNode(), saveLastSeq(), savePendingOps(), SyncClient (+1 more)

### Community 9 - "Community 9"
Cohesion: 0.15
Nodes (28): cacheKeyPersistent(), cacheKeySessionOnly(), cacheVaultKey(), clearVaultKey(), dbDelete(), dbGet(), dbPut(), getVaultKey() (+20 more)

### Community 10 - "Community 10"
Cohesion: 0.1
Nodes (20): dismissDevBanner(), enterEdit(), gotoAndSettle(), uploadWithoutReload(), createFolder(), dismissFirstRunOverlays(), dismissIfShown(), classifyOutcome() (+12 more)

### Community 11 - "Community 11"
Cohesion: 0.11
Nodes (12): handleConvert(), resolveUpgradeCheckoutFailure(), startUpgradeCheckout(), billingResetNavigationState(), handleBillingResetTestMode(), isBillingResetTestModeError(), getPendingCheckout(), makePreState() (+4 more)

### Community 12 - "Community 12"
Cohesion: 0.09
Nodes (14): timeAgo(), bulkPermanentDelete(), getSharesForFile(), permanentDeleteFile(), restoreFile(), loadActivity(), buildDetailsMeta(), displayName() (+6 more)

### Community 13 - "Community 13"
Cohesion: 0.22
Nodes (18): anchorOf(), armExpiryTimer(), checkAndClearIfExpired(), clearExpiryTimer(), clearSession(), dbDelete(), dbGet(), dbPut() (+10 more)

### Community 14 - "Community 14"
Cohesion: 0.13
Nodes (12): ErrorBoundary, getTelemetryConsent(), initTelemetry(), installId(), parseDsn(), randomHex(), reportError(), setTelemetryConsent() (+4 more)

### Community 15 - "Community 15"
Cohesion: 0.15
Nodes (8): signUpToChecklist(), signUp(), signUp(), createAccount(), fillSignupForm(), reachPasswordStep(), signupAndUnlock(), uniqueEmail()

### Community 16 - "Community 16"
Cohesion: 0.23
Nodes (18): cacheFileList(), cacheFilePreview(), enforceRowCap(), evictOldestPreviews(), fileListDelete(), fileListGet(), fileListGetAll(), fileListPut() (+10 more)

### Community 17 - "Community 17"
Cohesion: 0.11
Nodes (3): Row(), AndroidKeyboard(), IOSKeyboard()

### Community 18 - "Community 18"
Cohesion: 0.24
Nodes (16): findJpegExifTiffOffset(), findJpegSpans(), findLargestJpegSpan(), formatShutterSpeed(), jpegPixelCount(), mapExifToRawInfo(), parseTiffExifTags(), readAsciiValue() (+8 more)

### Community 19 - "Community 19"
Cohesion: 0.15
Nodes (4): FakeIDBDatabase, FakeIDBRequest, FakeObjectStore, FakeTransaction

### Community 20 - "Community 20"
Cohesion: 0.14
Nodes (4): commitQuery(), handleSubmit(), loadRecent(), saveRecent()

### Community 23 - "Community 23"
Cohesion: 0.18
Nodes (3): long_line(), longLine(), main()

### Community 25 - "Community 25"
Cohesion: 0.29
Nodes (9): asciiNul(), buildFakeJpeg(), buildJpegWithSof0(), buildMinimalBigEndianTiff(), buildSyntheticCanonTiff(), marker(), rationalLE(), u16le() (+1 more)

### Community 26 - "Community 26"
Cohesion: 0.17
Nodes (4): load(), handleDownloadCiphertext(), downloadFile(), handleLoadMore()

### Community 28 - "Community 28"
Cohesion: 0.18
Nodes (1): MemoryStorage

### Community 29 - "Community 29"
Cohesion: 0.2
Nodes (2): dayLabel(), groupByDay()

### Community 30 - "Community 30"
Cohesion: 0.25
Nodes (5): formatBytes(), formatStorageSI(), formatStorageSI(), upgradeCardFromFallback(), upgradeCardFromPlanMeta()

### Community 36 - "Community 36"
Cohesion: 0.22
Nodes (2): formatEta(), formatSpeed()

### Community 37 - "Community 37"
Cohesion: 0.27
Nodes (4): exceedsQuota(), itemNetBytes(), requiredQuotaBytes(), UploadQuotaLedger

### Community 41 - "Community 41"
Cohesion: 0.22
Nodes (1): MemoryStorage

### Community 42 - "Community 42"
Cohesion: 0.28
Nodes (3): bbEnv(), bbLoginViaBrowser(), runBb()

### Community 43 - "Community 43"
Cohesion: 0.31
Nodes (6): shareLinkWithDashOrUnderscore(), openManageShares(), createShareLink(), dismissWelcomeTourIfOpen(), openRowMenu(), uploadTextFile()

### Community 44 - "Community 44"
Cohesion: 0.22
Nodes (2): onRegionChanged(), resolveName()

### Community 45 - "Community 45"
Cohesion: 0.31
Nodes (5): findEocdInTail(), latin1Decode(), parseCentralDirectoryEntries(), readZipListing(), load()

### Community 51 - "Community 51"
Cohesion: 0.25
Nodes (3): recoveredKeyMatchesAccount(), depsForAccount(), runGate()

### Community 52 - "Community 52"
Cohesion: 0.25
Nodes (1): ApiError

### Community 54 - "Community 54"
Cohesion: 0.25
Nodes (4): ApiError, IncorrectPasswordError, parseErrorBody(), SessionTooOldForConfirmationError

### Community 57 - "Community 57"
Cohesion: 0.29
Nodes (2): pipelineStage(), stageLabel()

### Community 59 - "Community 59"
Cohesion: 0.32
Nodes (4): guestRouteFallback(), parsePlanIntent(), postSignupDestination(), readPlanIntent()

### Community 67 - "Community 67"
Cohesion: 0.29
Nodes (1): MemoryStorage

### Community 68 - "Community 68"
Cohesion: 0.29
Nodes (1): MemoryStorage

### Community 69 - "Community 69"
Cohesion: 0.29
Nodes (1): MemoryStorage

### Community 71 - "Community 71"
Cohesion: 0.43
Nodes (3): BracketColorPlugin, buildVisibleDecorations(), computeBracketDepths()

### Community 72 - "Community 72"
Cohesion: 0.38
Nodes (5): allowsFunctional(), getConsent(), hasConsented(), setConsent(), update()

### Community 73 - "Community 73"
Cohesion: 0.38
Nodes (3): getStored(), isValidDensity(), isValidFontSize()

### Community 76 - "Community 76"
Cohesion: 0.6
Nodes (5): ascii(), buildZip(), u16le(), u32le(), utf8()

### Community 77 - "Community 77"
Cohesion: 0.33
Nodes (1): MemoryStorage

### Community 80 - "Community 80"
Cohesion: 0.4
Nodes (2): blob(), createFolder()

### Community 81 - "Community 81"
Cohesion: 0.4
Nodes (2): decodeAndConvert(), pcmToWavBlob()

### Community 82 - "Community 82"
Cohesion: 0.47
Nodes (4): ensureLang(), getHighlighter(), langLabel(), toShikiLang()

### Community 83 - "Community 83"
Cohesion: 0.4
Nodes (2): statusLabel(), statusVariant()

### Community 84 - "Community 84"
Cohesion: 0.33
Nodes (3): NewFolderDialog(), SessionTimeoutWarning(), useFocusTrap()

### Community 86 - "Community 86"
Cohesion: 0.4
Nodes (2): consumePendingExport(), hasPendingExport()

### Community 87 - "Community 87"
Cohesion: 0.4
Nodes (2): computeStep(), writeLocalStep()

### Community 88 - "Community 88"
Cohesion: 0.4
Nodes (3): buildOnboardingState(), pilotKeyBlocksSubmit(), handleSubmit()

### Community 89 - "Community 89"
Cohesion: 0.4
Nodes (2): fromBase64url(), readRequestPublicKey()

### Community 93 - "Community 93"
Cohesion: 0.4
Nodes (2): discardInFlightUpload(), abandon()

### Community 94 - "Community 94"
Cohesion: 0.4
Nodes (1): MemoryStorage

### Community 95 - "Community 95"
Cohesion: 0.5
Nodes (2): b64(), sealed()

### Community 98 - "Community 98"
Cohesion: 0.5
Nodes (2): dismissFirstRunOverlays(), dismissIfShown()

### Community 102 - "Community 102"
Cohesion: 0.5
Nodes (2): hashString(), pickIndicesFromPhrase()

### Community 103 - "Community 103"
Cohesion: 0.5
Nodes (2): AnnouncementBanner(), severityClasses()

### Community 106 - "Community 106"
Cohesion: 0.5
Nodes (2): getExtension(), getMimeLabel()

### Community 107 - "Community 107"
Cohesion: 0.6
Nodes (3): clearPendingSelectTimer(), handleRowClick(), handleRowDoubleClick()

### Community 108 - "Community 108"
Cohesion: 0.4
Nodes (2): ImpersonationBanner(), useImpersonation()

### Community 109 - "Community 109"
Cohesion: 0.7
Nodes (4): FOLDER_COLOR_KEY(), getFolderColor(), getFolderColorDot(), setFolderColor()

### Community 110 - "Community 110"
Cohesion: 0.6
Nodes (3): checkEditability(), isValidUtf8(), looksBinary()

### Community 111 - "Community 111"
Cohesion: 0.6
Nodes (3): decryptFromQr(), deriveQrKey(), encryptForQr()

### Community 112 - "Community 112"
Cohesion: 0.5
Nodes (2): Avatar(), getInitials()

### Community 122 - "Community 122"
Cohesion: 0.67
Nodes (2): intent(), pre()

### Community 128 - "Community 128"
Cohesion: 0.83
Nodes (3): bbEnv(), bbLoginViaBrowser(), runBb()

### Community 129 - "Community 129"
Cohesion: 0.67
Nodes (2): dismissOverlays(), openRowMenu()

### Community 134 - "Community 134"
Cohesion: 0.5
Nodes (1): Sample

### Community 137 - "Community 137"
Cohesion: 0.83
Nodes (3): extractDroppedItems(), processEntries(), readDirectoryEntry()

### Community 138 - "Community 138"
Cohesion: 0.83
Nodes (3): getMenuItems(), getPendingItems(), SharedContextMenu()

### Community 139 - "Community 139"
Cohesion: 0.5
Nodes (2): ContextMenu(), isPreviewable()

### Community 141 - "Community 141"
Cohesion: 0.5
Nodes (2): resolveSafeMarkdownHref(), MarkdownSafeLink()

### Community 149 - "Community 149"
Cohesion: 0.67
Nodes (2): reconcileSignalOutcome(), reflectsUpgrade()

### Community 161 - "Community 161"
Cohesion: 0.67
Nodes (2): WasmChunkEncryptor, WasmSearchIndex

### Community 163 - "Community 163"
Cohesion: 1.0
Nodes (2): dismissFirstRunOverlays(), dismissIfShown()

### Community 166 - "Community 166"
Cohesion: 1.0
Nodes (2): totp(), wrongCode()

### Community 171 - "Community 171"
Cohesion: 1.0
Nodes (2): createBundleShareLink(), selectRow()

### Community 183 - "Community 183"
Cohesion: 1.0
Nodes (2): decodeTiffToPng(), getProxy()

### Community 184 - "Community 184"
Cohesion: 1.0
Nodes (2): mergeRecentlyChangedFiles(), updatedAtMs()

### Community 185 - "Community 185"
Cohesion: 1.0
Nodes (2): checkPasswordBreached(), sha1Hex()

### Community 186 - "Community 186"
Cohesion: 1.0
Nodes (2): deriveSasWords(), fnv1a()

### Community 190 - "Community 190"
Cohesion: 1.0
Nodes (2): extractRawPreview(), getProxy()

### Community 192 - "Community 192"
Cohesion: 1.0
Nodes (2): isKeyBoundToUser(), KeyProvider()

### Community 194 - "Community 194"
Cohesion: 1.0
Nodes (2): ch(), migratePreferences()

## Knowledge Gaps
- **2 isolated node(s):** `WasmChunkEncryptor`, `WasmSearchIndex`
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 28`** (11 nodes): `flush()`, `MemoryStorage`, `.clear()`, `.getItem()`, `.removeItem()`, `.setItem()`, `patchLastActivityAt()`, `randomKey()`, `rawEntry()`, `releaseHold()`, `1532-session-sliding-expiry.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 29`** (11 nodes): `actionText()`, `dayLabel()`, `DeviceBadge()`, `groupByDay()`, `isAlarmingEvent()`, `isSecurityEvent()`, `loadingMore()`, `metaFor()`, `timeLabel()`, `wsToActivity()`, `activity.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 36`** (10 nodes): `barColor()`, `borderColor()`, `computeEta()`, `computeSpeed()`, `formatChunkSize()`, `formatEta()`, `formatSpeed()`, `phaseLabel()`, `regionLabel()`, `upload-progress-card.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 41`** (9 nodes): `MemoryStorage`, `.clear()`, `.getItem()`, `.removeItem()`, `.setItem()`, `randomKey()`, `stripUserId()`, `1531-account-binding.test.ts`, `writeUntaggedVaultEntry()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 44`** (9 nodes): `formatStorageSI()`, `onDown()`, `onFileUploaded()`, `onKey()`, `onRegionChanged()`, `pruned()`, `PwaInstallBanner()`, `resolveName()`, `drive-layout.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 52`** (8 nodes): `ApiError`, `.constructor()`, `installMocks()`, `pageImpl()`, `resetCaptures()`, `setListPage()`, `stubStream()`, `upload-share-mocks.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 57`** (8 nodes): `computeEta()`, `computeSpeed()`, `formatBytes()`, `formatEta()`, `formatSpeed()`, `pipelineStage()`, `stageLabel()`, `upload-progress.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 67`** (7 nodes): `MemoryStorage`, `.clear()`, `.getItem()`, `.removeItem()`, `.setItem()`, `sub()`, `pricing-checkout-intent-1469.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 68`** (7 nodes): `MemoryStorage`, `.clear()`, `.getItem()`, `.removeItem()`, `.setItem()`, `sub()`, `upgrade-nudge-checkout-intent-1469.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 69`** (7 nodes): `cookieUser()`, `MemoryStorage`, `.clear()`, `.getItem()`, `.removeItem()`, `.setItem()`, `1471-isloggedin-auth-context.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 77`** (6 nodes): `MemoryStorage`, `.clear()`, `.getItem()`, `.removeItem()`, `.setItem()`, `pending-checkout-0957.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 80`** (6 nodes): `blob()`, `createFolder()`, `deleteFile()`, `listChildIds()`, `listRootFolderIds()`, `folder-pagination.spec.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 81`** (6 nodes): `decodeAndConvert()`, `formatTime()`, `handleSeek()`, `pcmToWavBlob()`, `togglePlay()`, `audio-preview.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 83`** (6 nodes): `formatCents()`, `formatDate()`, `methodLabel()`, `statusLabel()`, `statusVariant()`, `TransactionList.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 86`** (6 nodes): `browserStorage()`, `consumePendingExport()`, `dataExportDownloadFilename()`, `hasPendingExport()`, `markPendingExport()`, `export-intent.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 87`** (6 nodes): `computeStep()`, `OnboardingProvider()`, `readLocalStep()`, `useOnboarding()`, `writeLocalStep()`, `onboarding-context.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 89`** (6 nodes): `formatBytes()`, `fromBase64url()`, `onDrop()`, `prevent()`, `readRequestPublicKey()`, `upload-request.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 93`** (5 nodes): `discardInFlightUpload()`, `upload-discard.ts`, `abandon()`, `deferred()`, `1571-discard-in-flight-upload.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 94`** (5 nodes): `MemoryStorage`, `.getItem()`, `.removeItem()`, `.setItem()`, `export-intent.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 95`** (5 nodes): `b64()`, `invite()`, `ports()`, `sealed()`, `folder-invite-recipient-key.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 98`** (5 nodes): `dismissFirstRunOverlays()`, `dismissIfShown()`, `installTourDismisser()`, `1565-preview-matrix.matrix.ts`, `uploadNameFor()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 102`** (5 nodes): `handleChange()`, `handleVerify()`, `hashString()`, `pickIndicesFromPhrase()`, `mnemonic-verify.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 103`** (5 nodes): `AnnouncementBanner()`, `readDismissed()`, `severityClasses()`, `writeDismissed()`, `announcement-banner.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 106`** (5 nodes): `formatSize()`, `getExtension()`, `getMimeLabel()`, `handleDownload()`, `unsupported-preview.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 108`** (5 nodes): `ImpersonationBanner()`, `ImpersonationProvider()`, `useImpersonation()`, `impersonation-banner.tsx`, `impersonation-context.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 112`** (5 nodes): `Avatar()`, `formatRelativeDate()`, `getInitials()`, `SecuredBadge()`, `public-profile.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 122`** (4 nodes): `intent()`, `pre()`, `sub()`, `checkout-reconcile-0957.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 129`** (4 nodes): `dismissOverlays()`, `freshContext()`, `openRowMenu()`, `folder-invite-recipient-decrypt.spec.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 134`** (4 nodes): `Sample`, `.Main()`, `sample.cs`, `sample.java`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 139`** (4 nodes): `ContextMenu()`, `isPreviewable()`, `context-menu.tsx`, `preview.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 141`** (4 nodes): `resolveSafeMarkdownHref()`, `MarkdownSafeLink()`, `markdown-safe-link.tsx`, `markdown-link.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 149`** (4 nodes): `reconcileSignalOutcome()`, `reflectsUpgrade()`, `reflectsUpgradeNoIntent()`, `checkout-reconcile.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 161`** (3 nodes): `WasmChunkEncryptor`, `WasmSearchIndex`, `beebeeb_wasm.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 163`** (3 nodes): `dismissFirstRunOverlays()`, `dismissIfShown()`, `1565-code-ext-regression.spec.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 166`** (3 nodes): `totp()`, `2fa-wrong-code-feedback.spec.ts`, `wrongCode()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 171`** (3 nodes): `createBundleShareLink()`, `selectRow()`, `bundle-share.spec.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 183`** (3 nodes): `decodeTiffToPng()`, `getProxy()`, `tiff-decode-worker-client.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 184`** (3 nodes): `mergeRecentlyChangedFiles()`, `updatedAtMs()`, `recent-files.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 185`** (3 nodes): `checkPasswordBreached()`, `sha1Hex()`, `breach-check.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 186`** (3 nodes): `deriveSasWords()`, `fnv1a()`, `sas-words.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 190`** (3 nodes): `extractRawPreview()`, `getProxy()`, `raw-preview-worker-client.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 192`** (3 nodes): `isKeyBoundToUser()`, `KeyProvider()`, `key-context.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 194`** (3 nodes): `ch()`, `migratePreferences()`, `notifications.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `showToast()` connect `Community 1` to `Community 0`, `Community 2`, `Community 6`, `Community 7`, `Community 11`, `Community 12`, `Community 13`?**
  _High betweenness centrality (0.057) - this node is a cross-community bridge._
- **Why does `handleRestore()` connect `Community 2` to `Community 51`?**
  _High betweenness centrality (0.039) - this node is a cross-community bridge._
- **Why does `recoveredKeyMatchesAccount()` connect `Community 51` to `Community 2`?**
  _High betweenness centrality (0.039) - this node is a cross-community bridge._
- **Are the 134 inferred relationships involving `request()` (e.g. with `provenanceHeaders()` and `expectedUserHeaders()`) actually correct?**
  _`request()` has 134 INFERRED edges - model-reasoned connections that need verification._
- **Are the 58 inferred relationships involving `showToast()` (e.g. with `handleCopy()` and `handleSubmit()`) actually correct?**
  _`showToast()` has 58 INFERRED edges - model-reasoned connections that need verification._
- **What connects `WasmChunkEncryptor`, `WasmSearchIndex` to the rest of the system?**
  _2 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.01 - nodes in this community are weakly interconnected._