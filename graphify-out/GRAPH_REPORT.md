# Graph Report - web-1582  (2026-09-27)

## Corpus Check
- 619 files · ~623,408 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 3185 nodes · 4449 edges · 108 communities detected
- Extraction: 86% EXTRACTED · 14% INFERRED · 0% AMBIGUOUS · INFERRED: 630 edges (avg confidence: 0.8)
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
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 44|Community 44]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 46|Community 46]]
- [[_COMMUNITY_Community 47|Community 47]]
- [[_COMMUNITY_Community 48|Community 48]]
- [[_COMMUNITY_Community 49|Community 49]]
- [[_COMMUNITY_Community 50|Community 50]]
- [[_COMMUNITY_Community 57|Community 57]]
- [[_COMMUNITY_Community 59|Community 59]]
- [[_COMMUNITY_Community 61|Community 61]]
- [[_COMMUNITY_Community 63|Community 63]]
- [[_COMMUNITY_Community 65|Community 65]]
- [[_COMMUNITY_Community 66|Community 66]]
- [[_COMMUNITY_Community 67|Community 67]]
- [[_COMMUNITY_Community 75|Community 75]]
- [[_COMMUNITY_Community 76|Community 76]]
- [[_COMMUNITY_Community 77|Community 77]]
- [[_COMMUNITY_Community 78|Community 78]]
- [[_COMMUNITY_Community 80|Community 80]]
- [[_COMMUNITY_Community 81|Community 81]]
- [[_COMMUNITY_Community 82|Community 82]]
- [[_COMMUNITY_Community 83|Community 83]]
- [[_COMMUNITY_Community 86|Community 86]]
- [[_COMMUNITY_Community 87|Community 87]]
- [[_COMMUNITY_Community 90|Community 90]]
- [[_COMMUNITY_Community 91|Community 91]]
- [[_COMMUNITY_Community 92|Community 92]]
- [[_COMMUNITY_Community 93|Community 93]]
- [[_COMMUNITY_Community 94|Community 94]]
- [[_COMMUNITY_Community 95|Community 95]]
- [[_COMMUNITY_Community 96|Community 96]]
- [[_COMMUNITY_Community 97|Community 97]]
- [[_COMMUNITY_Community 98|Community 98]]
- [[_COMMUNITY_Community 99|Community 99]]
- [[_COMMUNITY_Community 103|Community 103]]
- [[_COMMUNITY_Community 104|Community 104]]
- [[_COMMUNITY_Community 105|Community 105]]
- [[_COMMUNITY_Community 108|Community 108]]
- [[_COMMUNITY_Community 110|Community 110]]
- [[_COMMUNITY_Community 112|Community 112]]
- [[_COMMUNITY_Community 114|Community 114]]
- [[_COMMUNITY_Community 115|Community 115]]
- [[_COMMUNITY_Community 116|Community 116]]
- [[_COMMUNITY_Community 117|Community 117]]
- [[_COMMUNITY_Community 118|Community 118]]
- [[_COMMUNITY_Community 119|Community 119]]
- [[_COMMUNITY_Community 120|Community 120]]
- [[_COMMUNITY_Community 121|Community 121]]
- [[_COMMUNITY_Community 122|Community 122]]
- [[_COMMUNITY_Community 123|Community 123]]
- [[_COMMUNITY_Community 124|Community 124]]
- [[_COMMUNITY_Community 137|Community 137]]
- [[_COMMUNITY_Community 138|Community 138]]
- [[_COMMUNITY_Community 145|Community 145]]
- [[_COMMUNITY_Community 146|Community 146]]
- [[_COMMUNITY_Community 153|Community 153]]
- [[_COMMUNITY_Community 156|Community 156]]
- [[_COMMUNITY_Community 157|Community 157]]
- [[_COMMUNITY_Community 158|Community 158]]
- [[_COMMUNITY_Community 165|Community 165]]
- [[_COMMUNITY_Community 169|Community 169]]
- [[_COMMUNITY_Community 170|Community 170]]
- [[_COMMUNITY_Community 183|Community 183]]
- [[_COMMUNITY_Community 185|Community 185]]
- [[_COMMUNITY_Community 188|Community 188]]
- [[_COMMUNITY_Community 193|Community 193]]
- [[_COMMUNITY_Community 204|Community 204]]
- [[_COMMUNITY_Community 209|Community 209]]
- [[_COMMUNITY_Community 210|Community 210]]
- [[_COMMUNITY_Community 211|Community 211]]
- [[_COMMUNITY_Community 212|Community 212]]
- [[_COMMUNITY_Community 214|Community 214]]
- [[_COMMUNITY_Community 217|Community 217]]
- [[_COMMUNITY_Community 219|Community 219]]
- [[_COMMUNITY_Community 222|Community 222]]

## God Nodes (most connected - your core abstractions)
1. `request()` - 139 edges
2. `showToast()` - 61 edges
3. `withProxy()` - 53 edges
4. `getDataViewMemory0()` - 52 edges
5. `takeObject()` - 49 edges
6. `passArray8ToWasm0()` - 38 edges
7. `assert()` - 37 edges
8. `userFriendlyError()` - 26 edges
9. `lookupPath()` - 25 edges
10. `SyncClient` - 24 edges

## Surprising Connections (you probably didn't know these)
- `depsForAccount()` --calls--> `compute_recovery_check()`  [INFERRED]
  test/recovery-validation.test.ts → packages/beebeeb-wasm/beebeeb_wasm.js
- `resolveSessionToken()` --calls--> `handleAuthorize()`  [INFERRED]
  packages/shared/src/api/request.ts → src/pages/cli-auth.tsx
- `init()` --calls--> `ensureWasm()`  [INFERRED]
  public/office/phase4-2026-09-27/soffice.js → src/lib/plan-pricing.ts
- `open()` --calls--> `write_ts_module()`  [INFERRED]
  public/office/phase4-2026-09-27/soffice.js → scripts/generate-blank-office-files.py
- `updateStatus()` --calls--> `runWorkerLoop()`  [INFERRED]
  public/office/phase4-2026-09-27/soffice.js → src/pages/settings/import.tsx

## Communities

### Community 0 - "Community 0"
Cohesion: 0.01
Nodes (263): ensureWasm(), abort(), absolutePath(), accept(), addPeer(), addRunDependency(), allocateUnusedWorker(), analyzePath() (+255 more)

### Community 1 - "Community 1"
Cohesion: 0.01
Nodes (201): expectedUserHeaders(), getClientInfo(), provenanceHeaders(), clearSessionConfirmed(), fireAccountDeleted(), fireAccountMismatch(), fireConnectionStatus(), fireErrorNotifier() (+193 more)

### Community 2 - "Community 2"
Cohesion: 0.02
Nodes (127): handleProceed(), validate(), decryptAll(), handleNewFolder(), handleSubmit(), handleCopy(), savePermissions(), setExpiry() (+119 more)

### Community 3 - "Community 3"
Cohesion: 0.02
Nodes (106): handleRestore(), attachFreshToken(), buildRequest(), cleanName(), decryptActivitySnapshotName(), describeActivityEventWithFileName(), describeWithName(), hydrateActivityEventDescriptions() (+98 more)

### Community 4 - "Community 4"
Cohesion: 0.06
Nodes (77): addHeapObject(), compute_recovery_check(), debugString(), decodeText(), decompress_gzip(), decrypt_chunk(), decrypt_chunks(), decrypt_metadata() (+69 more)

### Community 5 - "Community 5"
Cohesion: 0.04
Nodes (40): getApiUrl(), downloadBundleItem(), downloadSharedFile(), downloadVersion(), getFileRequestPublic(), revokeAccountSession(), uploadToFileRequest(), dispatchDecrypted() (+32 more)

### Community 6 - "Community 6"
Cohesion: 0.05
Nodes (37): performUpload(), uploadThumbnail(), uploadThumbnailLarge(), encryptedUpload(), withNetworkRetry(), basename(), isLikelyAlbumArtOrIcon(), splitName() (+29 more)

### Community 7 - "Community 7"
Cohesion: 0.05
Nodes (36): dismissDevBanner(), enterEdit(), gotoAndSettle(), uploadWithoutReload(), dismissDevBanner(), openInOffice(), setup(), dismissDevBanner() (+28 more)

### Community 8 - "Community 8"
Cohesion: 0.05
Nodes (18): BillingBanner(), BillingSuspendedOverlay(), FileList(), if(), timeAgo(), IncidentBanner(), notificationIcon(), toDisplay() (+10 more)

### Community 9 - "Community 9"
Cohesion: 0.09
Nodes (11): loadNames(), getSyncOps(), submitSyncOps(), classifyStreamFrame(), getDeviceId(), payloadToNode(), saveLastSeq(), savePendingOps() (+3 more)

### Community 10 - "Community 10"
Cohesion: 0.12
Nodes (29): cacheKeyPersistent(), cacheKeySessionOnly(), anchorOf(), armExpiryTimer(), checkAndClearIfExpired(), clearExpiryTimer(), clearSession(), dbDelete() (+21 more)

### Community 11 - "Community 11"
Cohesion: 0.13
Nodes (26): applyDocumentChrome(), closeOtherEmptyFrames(), doAddModifiedListener(), doAddSelectionListener(), doAddStatusListener(), doDebugChromeState(), doDispatch(), doGetDocStats() (+18 more)

### Community 12 - "Community 12"
Cohesion: 0.12
Nodes (11): resolveUpgradeCheckoutFailure(), startUpgradeCheckout(), billingResetNavigationState(), handleBillingResetTestMode(), isBillingResetTestModeError(), getPendingCheckout(), makePreState(), persistTrialConvertIntent() (+3 more)

### Community 13 - "Community 13"
Cohesion: 0.13
Nodes (12): ErrorBoundary, getTelemetryConsent(), initTelemetry(), installId(), parseDsn(), randomHex(), reportError(), setTelemetryConsent() (+4 more)

### Community 14 - "Community 14"
Cohesion: 0.1
Nodes (5): onMenuKeyDown(), onPointerDown(), pick(), close(), randomPassword()

### Community 15 - "Community 15"
Cohesion: 0.1
Nodes (6): useImpressChrome(), useImpressFitZoom(), useTheme(), OfficeEditor(), useOfficeEngine(), useCalcSelectionStats()

### Community 16 - "Community 16"
Cohesion: 0.11
Nodes (11): bulkPermanentDelete(), restoreFile(), buildDetailsMeta(), decryptAll(), decryptOne(), displayName(), handleRestore(), handleRestoreAll() (+3 more)

### Community 17 - "Community 17"
Cohesion: 0.15
Nodes (8): signUpToChecklist(), signUp(), signUp(), createAccount(), fillSignupForm(), reachPasswordStep(), signupAndUnlock(), uniqueEmail()

### Community 18 - "Community 18"
Cohesion: 0.23
Nodes (18): cacheFileList(), cacheFilePreview(), enforceRowCap(), evictOldestPreviews(), fileListDelete(), fileListGet(), fileListGetAll(), fileListPut() (+10 more)

### Community 19 - "Community 19"
Cohesion: 0.11
Nodes (3): Row(), AndroidKeyboard(), IOSKeyboard()

### Community 20 - "Community 20"
Cohesion: 0.31
Nodes (17): clearEmptyPasswordVault(), clearVault(), computeKeyCheck(), dbClear(), dbDelete(), dbGet(), dbPut(), deriveWrappingKey() (+9 more)

### Community 21 - "Community 21"
Cohesion: 0.24
Nodes (16): findJpegExifTiffOffset(), findJpegSpans(), findLargestJpegSpan(), formatShutterSpeed(), jpegPixelCount(), mapExifToRawInfo(), parseTiffExifTags(), readAsciiValue() (+8 more)

### Community 22 - "Community 22"
Cohesion: 0.15
Nodes (4): FakeIDBDatabase, FakeIDBRequest, FakeObjectStore, FakeTransaction

### Community 23 - "Community 23"
Cohesion: 0.15
Nodes (11): handleSubmit(), checkNewDocumentName(), defaultNewDocumentName(), foldName(), getNewDocumentType(), NewDocumentNameClashError, splitExt(), uniqueFileName() (+3 more)

### Community 24 - "Community 24"
Cohesion: 0.14
Nodes (4): commitQuery(), handleSubmit(), loadRecent(), saveRecent()

### Community 27 - "Community 27"
Cohesion: 0.21
Nodes (6): dismissDevBanner(), engineFrameHandle(), engineSave(), gotoDrive(), officeTabFrom(), reopen()

### Community 28 - "Community 28"
Cohesion: 0.18
Nodes (3): long_line(), longLine(), main()

### Community 30 - "Community 30"
Cohesion: 0.29
Nodes (9): asciiNul(), buildFakeJpeg(), buildJpegWithSof0(), buildMinimalBigEndianTiff(), buildSyntheticCanonTiff(), marker(), rationalLE(), u16le() (+1 more)

### Community 32 - "Community 32"
Cohesion: 0.18
Nodes (1): MemoryStorage

### Community 33 - "Community 33"
Cohesion: 0.33
Nodes (8): assertSameOrigin(), createCancellableOfficeLoad(), fetchAssetStreaming(), fetchOfficeManifest(), isAbortError(), loadOfficeBundle(), OfficeLoaderError, parseOfficeManifest()

### Community 34 - "Community 34"
Cohesion: 0.2
Nodes (2): dayLabel(), groupByDay()

### Community 39 - "Community 39"
Cohesion: 0.22
Nodes (2): formatEta(), formatSpeed()

### Community 40 - "Community 40"
Cohesion: 0.27
Nodes (4): exceedsQuota(), itemNetBytes(), requiredQuotaBytes(), UploadQuotaLedger

### Community 44 - "Community 44"
Cohesion: 0.22
Nodes (1): MemoryStorage

### Community 45 - "Community 45"
Cohesion: 0.25
Nodes (3): fileCreateFrame(), MemoryStorage, seededClient()

### Community 46 - "Community 46"
Cohesion: 0.28
Nodes (3): bbEnv(), bbLoginViaBrowser(), runBb()

### Community 47 - "Community 47"
Cohesion: 0.31
Nodes (6): shareLinkWithDashOrUnderscore(), openManageShares(), createShareLink(), dismissWelcomeTourIfOpen(), openRowMenu(), uploadTextFile()

### Community 48 - "Community 48"
Cohesion: 0.22
Nodes (2): onRegionChanged(), resolveName()

### Community 49 - "Community 49"
Cohesion: 0.31
Nodes (5): findEocdInTail(), latin1Decode(), parseCentralDirectoryEntries(), readZipListing(), load()

### Community 50 - "Community 50"
Cohesion: 0.33
Nodes (5): downloadDropboxFile(), expandDropboxPaths(), expandOne(), rateLimitedFetch(), sleepMs()

### Community 57 - "Community 57"
Cohesion: 0.25
Nodes (1): ApiError

### Community 59 - "Community 59"
Cohesion: 0.25
Nodes (4): ApiError, IncorrectPasswordError, parseErrorBody(), SessionTooOldForConfirmationError

### Community 61 - "Community 61"
Cohesion: 0.25
Nodes (3): load(), handleDownloadCiphertext(), downloadFile()

### Community 63 - "Community 63"
Cohesion: 0.29
Nodes (2): pipelineStage(), stageLabel()

### Community 65 - "Community 65"
Cohesion: 0.25
Nodes (3): recoveredKeyMatchesAccount(), depsForAccount(), runGate()

### Community 66 - "Community 66"
Cohesion: 0.32
Nodes (4): guestRouteFallback(), parsePlanIntent(), postSignupDestination(), readPlanIntent()

### Community 67 - "Community 67"
Cohesion: 0.32
Nodes (3): formatStorageSI(), upgradeCardFromFallback(), upgradeCardFromPlanMeta()

### Community 75 - "Community 75"
Cohesion: 0.29
Nodes (1): MemoryStorage

### Community 76 - "Community 76"
Cohesion: 0.29
Nodes (1): MemoryStorage

### Community 77 - "Community 77"
Cohesion: 0.29
Nodes (1): MemoryStorage

### Community 78 - "Community 78"
Cohesion: 0.33
Nodes (2): isOfficeAssetPath(), officeVersionFromPath()

### Community 80 - "Community 80"
Cohesion: 0.43
Nodes (3): BracketColorPlugin, buildVisibleDecorations(), computeBracketDepths()

### Community 81 - "Community 81"
Cohesion: 0.38
Nodes (5): allowsFunctional(), getConsent(), hasConsented(), setConsent(), update()

### Community 82 - "Community 82"
Cohesion: 0.38
Nodes (3): getStored(), isValidDensity(), isValidFontSize()

### Community 83 - "Community 83"
Cohesion: 0.29
Nodes (2): deriveButtonState(), RibbonButton()

### Community 86 - "Community 86"
Cohesion: 0.6
Nodes (5): ascii(), buildZip(), u16le(), u32le(), utf8()

### Community 87 - "Community 87"
Cohesion: 0.33
Nodes (1): MemoryStorage

### Community 90 - "Community 90"
Cohesion: 0.4
Nodes (2): blob(), createFolder()

### Community 91 - "Community 91"
Cohesion: 0.4
Nodes (2): decodeAndConvert(), pcmToWavBlob()

### Community 92 - "Community 92"
Cohesion: 0.47
Nodes (4): ensureLang(), getHighlighter(), langLabel(), toShikiLang()

### Community 93 - "Community 93"
Cohesion: 0.4
Nodes (2): statusLabel(), statusVariant()

### Community 94 - "Community 94"
Cohesion: 0.33
Nodes (3): NewFolderDialog(), SessionTimeoutWarning(), useFocusTrap()

### Community 95 - "Community 95"
Cohesion: 0.53
Nodes (4): clearPendingSelectTimer(), handleRowClick(), handleRowDoubleClick(), handleRowInteractionCapture()

### Community 96 - "Community 96"
Cohesion: 0.4
Nodes (2): consumePendingExport(), hasPendingExport()

### Community 97 - "Community 97"
Cohesion: 0.4
Nodes (3): buildOnboardingState(), pilotKeyBlocksSubmit(), handleSubmit()

### Community 98 - "Community 98"
Cohesion: 0.4
Nodes (2): computeStep(), writeLocalStep()

### Community 99 - "Community 99"
Cohesion: 0.4
Nodes (2): fromBase64url(), readRequestPublicKey()

### Community 103 - "Community 103"
Cohesion: 0.4
Nodes (2): discardInFlightUpload(), abandon()

### Community 104 - "Community 104"
Cohesion: 0.4
Nodes (1): MemoryStorage

### Community 105 - "Community 105"
Cohesion: 0.5
Nodes (2): b64(), sealed()

### Community 108 - "Community 108"
Cohesion: 0.5
Nodes (2): dismissFirstRunOverlays(), dismissIfShown()

### Community 110 - "Community 110"
Cohesion: 0.6
Nodes (3): clickRowStar(), dismissFirstRunOverlays(), rowFor()

### Community 112 - "Community 112"
Cohesion: 0.4
Nodes (2): ImpersonationBanner(), useImpersonation()

### Community 114 - "Community 114"
Cohesion: 0.5
Nodes (2): hashString(), pickIndicesFromPhrase()

### Community 115 - "Community 115"
Cohesion: 0.5
Nodes (2): AnnouncementBanner(), severityClasses()

### Community 116 - "Community 116"
Cohesion: 0.5
Nodes (2): getExtension(), getMimeLabel()

### Community 117 - "Community 117"
Cohesion: 0.7
Nodes (4): FOLDER_COLOR_KEY(), getFolderColor(), getFolderColorDot(), setFolderColor()

### Community 118 - "Community 118"
Cohesion: 0.6
Nodes (3): checkEditability(), isValidUtf8(), looksBinary()

### Community 119 - "Community 119"
Cohesion: 0.6
Nodes (3): decryptFromQr(), deriveQrKey(), encryptForQr()

### Community 120 - "Community 120"
Cohesion: 0.7
Nodes (4): applyTemplate(), newPara(), paragraphStyle(), text()

### Community 121 - "Community 121"
Cohesion: 0.5
Nodes (3): blankDocumentBytes(), decodeBase64(), shipped()

### Community 122 - "Community 122"
Cohesion: 0.5
Nodes (2): parseClipboardStats(), parseNumericToken()

### Community 123 - "Community 123"
Cohesion: 0.5
Nodes (2): getExtension(), resolveOfficeFileKind()

### Community 124 - "Community 124"
Cohesion: 0.5
Nodes (2): Avatar(), getInitials()

### Community 137 - "Community 137"
Cohesion: 0.83
Nodes (3): main(), prop(), write_ts_module()

### Community 138 - "Community 138"
Cohesion: 0.83
Nodes (3): call(), getPort(), waitForModule()

### Community 145 - "Community 145"
Cohesion: 0.83
Nodes (3): bbEnv(), bbLoginViaBrowser(), runBb()

### Community 146 - "Community 146"
Cohesion: 0.67
Nodes (2): dismissOverlays(), openRowMenu()

### Community 153 - "Community 153"
Cohesion: 0.5
Nodes (1): Sample

### Community 156 - "Community 156"
Cohesion: 0.83
Nodes (3): extractDroppedItems(), processEntries(), readDirectoryEntry()

### Community 157 - "Community 157"
Cohesion: 0.83
Nodes (3): getMenuItems(), getPendingItems(), SharedContextMenu()

### Community 158 - "Community 158"
Cohesion: 0.5
Nodes (2): ContextMenu(), isPreviewable()

### Community 165 - "Community 165"
Cohesion: 0.5
Nodes (2): resolveSafeMarkdownHref(), MarkdownSafeLink()

### Community 169 - "Community 169"
Cohesion: 0.67
Nodes (2): reconcileSignalOutcome(), reflectsUpgrade()

### Community 170 - "Community 170"
Cohesion: 0.67
Nodes (2): formatMegabytes(), officeLoadByteLabel()

### Community 183 - "Community 183"
Cohesion: 0.67
Nodes (2): WasmChunkEncryptor, WasmSearchIndex

### Community 185 - "Community 185"
Cohesion: 1.0
Nodes (2): dismissFirstRunOverlays(), dismissIfShown()

### Community 188 - "Community 188"
Cohesion: 1.0
Nodes (2): totp(), wrongCode()

### Community 193 - "Community 193"
Cohesion: 1.0
Nodes (2): createBundleShareLink(), selectRow()

### Community 204 - "Community 204"
Cohesion: 1.0
Nodes (2): formatClock(), OfficeStatusBar()

### Community 209 - "Community 209"
Cohesion: 1.0
Nodes (2): decodeTiffToPng(), getProxy()

### Community 210 - "Community 210"
Cohesion: 1.0
Nodes (2): mergeRecentlyChangedFiles(), updatedAtMs()

### Community 211 - "Community 211"
Cohesion: 1.0
Nodes (2): checkPasswordBreached(), sha1Hex()

### Community 212 - "Community 212"
Cohesion: 1.0
Nodes (2): deriveSasWords(), fnv1a()

### Community 214 - "Community 214"
Cohesion: 1.0
Nodes (2): formatBytes(), formatStorageSI()

### Community 217 - "Community 217"
Cohesion: 1.0
Nodes (2): extractRawPreview(), getProxy()

### Community 219 - "Community 219"
Cohesion: 1.0
Nodes (2): isKeyBoundToUser(), KeyProvider()

### Community 222 - "Community 222"
Cohesion: 1.0
Nodes (2): ch(), migratePreferences()

## Knowledge Gaps
- **4 isolated node(s):** `PureVirtualError`, `UnboundTypeError`, `WasmChunkEncryptor`, `WasmSearchIndex`
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 32`** (11 nodes): `flush()`, `MemoryStorage`, `.clear()`, `.getItem()`, `.removeItem()`, `.setItem()`, `patchLastActivityAt()`, `randomKey()`, `rawEntry()`, `releaseHold()`, `1532-session-sliding-expiry.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 34`** (11 nodes): `actionText()`, `dayLabel()`, `DeviceBadge()`, `groupByDay()`, `isAlarmingEvent()`, `isSecurityEvent()`, `loadingMore()`, `metaFor()`, `timeLabel()`, `wsToActivity()`, `activity.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 39`** (10 nodes): `barColor()`, `borderColor()`, `computeEta()`, `computeSpeed()`, `formatChunkSize()`, `formatEta()`, `formatSpeed()`, `phaseLabel()`, `regionLabel()`, `upload-progress-card.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 44`** (9 nodes): `MemoryStorage`, `.clear()`, `.getItem()`, `.removeItem()`, `.setItem()`, `randomKey()`, `stripUserId()`, `1531-account-binding.test.ts`, `writeUntaggedVaultEntry()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 48`** (9 nodes): `formatStorageSI()`, `onDown()`, `onFileUploaded()`, `onKey()`, `onRegionChanged()`, `pruned()`, `PwaInstallBanner()`, `resolveName()`, `drive-layout.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 57`** (8 nodes): `ApiError`, `.constructor()`, `installMocks()`, `pageImpl()`, `resetCaptures()`, `setListPage()`, `stubStream()`, `upload-share-mocks.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 63`** (8 nodes): `computeEta()`, `computeSpeed()`, `formatBytes()`, `formatEta()`, `formatSpeed()`, `pipelineStage()`, `stageLabel()`, `upload-progress.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 75`** (7 nodes): `MemoryStorage`, `.clear()`, `.getItem()`, `.removeItem()`, `.setItem()`, `sub()`, `pricing-checkout-intent-1469.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 76`** (7 nodes): `MemoryStorage`, `.clear()`, `.getItem()`, `.removeItem()`, `.setItem()`, `sub()`, `upgrade-nudge-checkout-intent-1469.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 77`** (7 nodes): `cookieUser()`, `MemoryStorage`, `.clear()`, `.getItem()`, `.removeItem()`, `.setItem()`, `1471-isloggedin-auth-context.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 78`** (7 nodes): `isCacheableOfficeResponse()`, `isOfficeAssetPath()`, `office-cache-logic.js`, `officeCacheName()`, `officeCacheNamesToDelete()`, `officeVersionFromPath()`, `parseManifestVersion()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 83`** (7 nodes): `deriveButtonState()`, `filterPaletteEntries()`, `toPaletteEntry()`, `Divider()`, `RibbonButton()`, `ribbon.tsx`, `ribbon-commands.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 87`** (6 nodes): `MemoryStorage`, `.clear()`, `.getItem()`, `.removeItem()`, `.setItem()`, `pending-checkout-0957.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 90`** (6 nodes): `blob()`, `createFolder()`, `deleteFile()`, `listChildIds()`, `listRootFolderIds()`, `folder-pagination.spec.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 91`** (6 nodes): `decodeAndConvert()`, `formatTime()`, `handleSeek()`, `pcmToWavBlob()`, `togglePlay()`, `audio-preview.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 93`** (6 nodes): `formatCents()`, `formatDate()`, `methodLabel()`, `statusLabel()`, `statusVariant()`, `TransactionList.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 96`** (6 nodes): `browserStorage()`, `consumePendingExport()`, `dataExportDownloadFilename()`, `hasPendingExport()`, `markPendingExport()`, `export-intent.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 98`** (6 nodes): `computeStep()`, `OnboardingProvider()`, `readLocalStep()`, `useOnboarding()`, `writeLocalStep()`, `onboarding-context.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 99`** (6 nodes): `formatBytes()`, `fromBase64url()`, `onDrop()`, `prevent()`, `readRequestPublicKey()`, `upload-request.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 103`** (5 nodes): `discardInFlightUpload()`, `upload-discard.ts`, `abandon()`, `deferred()`, `1571-discard-in-flight-upload.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 104`** (5 nodes): `MemoryStorage`, `.getItem()`, `.removeItem()`, `.setItem()`, `export-intent.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 105`** (5 nodes): `b64()`, `invite()`, `ports()`, `sealed()`, `folder-invite-recipient-key.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 108`** (5 nodes): `dismissFirstRunOverlays()`, `dismissIfShown()`, `installTourDismisser()`, `1565-preview-matrix.matrix.ts`, `uploadNameFor()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 112`** (5 nodes): `ImpersonationBanner()`, `ImpersonationProvider()`, `useImpersonation()`, `impersonation-banner.tsx`, `impersonation-context.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 114`** (5 nodes): `handleChange()`, `handleVerify()`, `hashString()`, `pickIndicesFromPhrase()`, `mnemonic-verify.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 115`** (5 nodes): `AnnouncementBanner()`, `readDismissed()`, `severityClasses()`, `writeDismissed()`, `announcement-banner.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 116`** (5 nodes): `formatSize()`, `getExtension()`, `getMimeLabel()`, `handleDownload()`, `unsupported-preview.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 122`** (5 nodes): `formatCalcCurrency()`, `formatCalcNumber()`, `parseClipboardStats()`, `parseNumericToken()`, `calc-selection-stats.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 123`** (5 nodes): `defaultExtensionFor()`, `getExtension()`, `officeAppLabel()`, `resolveOfficeFileKind()`, `office-file-kind.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 124`** (5 nodes): `Avatar()`, `formatRelativeDate()`, `getInitials()`, `SecuredBadge()`, `public-profile.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 146`** (4 nodes): `dismissOverlays()`, `freshContext()`, `openRowMenu()`, `folder-invite-recipient-decrypt.spec.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 153`** (4 nodes): `Sample`, `.Main()`, `sample.cs`, `sample.java`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 158`** (4 nodes): `ContextMenu()`, `isPreviewable()`, `context-menu.tsx`, `preview.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 165`** (4 nodes): `resolveSafeMarkdownHref()`, `MarkdownSafeLink()`, `markdown-safe-link.tsx`, `markdown-link.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 169`** (4 nodes): `reconcileSignalOutcome()`, `reflectsUpgrade()`, `reflectsUpgradeNoIntent()`, `checkout-reconcile.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 170`** (4 nodes): `formatMegabytes()`, `officeLoadByteLabel()`, `officeLoadPercent()`, `progress-format.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 183`** (3 nodes): `WasmChunkEncryptor`, `WasmSearchIndex`, `beebeeb_wasm.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 185`** (3 nodes): `dismissFirstRunOverlays()`, `dismissIfShown()`, `1565-code-ext-regression.spec.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 188`** (3 nodes): `totp()`, `2fa-wrong-code-feedback.spec.ts`, `wrongCode()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 193`** (3 nodes): `createBundleShareLink()`, `selectRow()`, `bundle-share.spec.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 204`** (3 nodes): `formatClock()`, `OfficeStatusBar()`, `office-status-bar.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 209`** (3 nodes): `decodeTiffToPng()`, `getProxy()`, `tiff-decode-worker-client.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 210`** (3 nodes): `mergeRecentlyChangedFiles()`, `updatedAtMs()`, `recent-files.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 211`** (3 nodes): `checkPasswordBreached()`, `sha1Hex()`, `breach-check.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 212`** (3 nodes): `deriveSasWords()`, `fnv1a()`, `sas-words.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 214`** (3 nodes): `formatBytes()`, `formatStorageSI()`, `format.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 217`** (3 nodes): `extractRawPreview()`, `getProxy()`, `raw-preview-worker-client.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 219`** (3 nodes): `isKeyBoundToUser()`, `KeyProvider()`, `key-context.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 222`** (3 nodes): `ch()`, `migratePreferences()`, `notifications.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `runWorkerLoop()` connect `Community 2` to `Community 3`, `Community 6`?**
  _High betweenness centrality (0.093) - this node is a cross-community bridge._
- **Why does `updateStatus()` connect `Community 2` to `Community 0`?**
  _High betweenness centrality (0.091) - this node is a cross-community bridge._
- **Why does `showToast()` connect `Community 2` to `Community 1`, `Community 3`, `Community 6`, `Community 10`, `Community 12`, `Community 16`?**
  _High betweenness centrality (0.069) - this node is a cross-community bridge._
- **Are the 133 inferred relationships involving `request()` (e.g. with `provenanceHeaders()` and `expectedUserHeaders()`) actually correct?**
  _`request()` has 133 INFERRED edges - model-reasoned connections that need verification._
- **Are the 57 inferred relationships involving `showToast()` (e.g. with `handleCopy()` and `handleSubmit()`) actually correct?**
  _`showToast()` has 57 INFERRED edges - model-reasoned connections that need verification._
- **What connects `PureVirtualError`, `UnboundTypeError`, `WasmChunkEncryptor` to the rest of the system?**
  _4 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.01 - nodes in this community are weakly interconnected._