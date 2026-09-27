# Graph Report - web-1582  (2026-09-27)

## Corpus Check
- 619 files · ~623,308 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 3184 nodes · 4446 edges · 107 communities detected
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
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 46|Community 46]]
- [[_COMMUNITY_Community 47|Community 47]]
- [[_COMMUNITY_Community 48|Community 48]]
- [[_COMMUNITY_Community 49|Community 49]]
- [[_COMMUNITY_Community 56|Community 56]]
- [[_COMMUNITY_Community 58|Community 58]]
- [[_COMMUNITY_Community 60|Community 60]]
- [[_COMMUNITY_Community 62|Community 62]]
- [[_COMMUNITY_Community 64|Community 64]]
- [[_COMMUNITY_Community 65|Community 65]]
- [[_COMMUNITY_Community 66|Community 66]]
- [[_COMMUNITY_Community 74|Community 74]]
- [[_COMMUNITY_Community 75|Community 75]]
- [[_COMMUNITY_Community 76|Community 76]]
- [[_COMMUNITY_Community 77|Community 77]]
- [[_COMMUNITY_Community 78|Community 78]]
- [[_COMMUNITY_Community 80|Community 80]]
- [[_COMMUNITY_Community 81|Community 81]]
- [[_COMMUNITY_Community 82|Community 82]]
- [[_COMMUNITY_Community 85|Community 85]]
- [[_COMMUNITY_Community 86|Community 86]]
- [[_COMMUNITY_Community 89|Community 89]]
- [[_COMMUNITY_Community 90|Community 90]]
- [[_COMMUNITY_Community 91|Community 91]]
- [[_COMMUNITY_Community 92|Community 92]]
- [[_COMMUNITY_Community 93|Community 93]]
- [[_COMMUNITY_Community 94|Community 94]]
- [[_COMMUNITY_Community 95|Community 95]]
- [[_COMMUNITY_Community 96|Community 96]]
- [[_COMMUNITY_Community 97|Community 97]]
- [[_COMMUNITY_Community 98|Community 98]]
- [[_COMMUNITY_Community 102|Community 102]]
- [[_COMMUNITY_Community 103|Community 103]]
- [[_COMMUNITY_Community 104|Community 104]]
- [[_COMMUNITY_Community 107|Community 107]]
- [[_COMMUNITY_Community 109|Community 109]]
- [[_COMMUNITY_Community 111|Community 111]]
- [[_COMMUNITY_Community 113|Community 113]]
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
- [[_COMMUNITY_Community 136|Community 136]]
- [[_COMMUNITY_Community 137|Community 137]]
- [[_COMMUNITY_Community 144|Community 144]]
- [[_COMMUNITY_Community 145|Community 145]]
- [[_COMMUNITY_Community 152|Community 152]]
- [[_COMMUNITY_Community 155|Community 155]]
- [[_COMMUNITY_Community 156|Community 156]]
- [[_COMMUNITY_Community 159|Community 159]]
- [[_COMMUNITY_Community 167|Community 167]]
- [[_COMMUNITY_Community 168|Community 168]]
- [[_COMMUNITY_Community 169|Community 169]]
- [[_COMMUNITY_Community 182|Community 182]]
- [[_COMMUNITY_Community 184|Community 184]]
- [[_COMMUNITY_Community 187|Community 187]]
- [[_COMMUNITY_Community 192|Community 192]]
- [[_COMMUNITY_Community 203|Community 203]]
- [[_COMMUNITY_Community 208|Community 208]]
- [[_COMMUNITY_Community 209|Community 209]]
- [[_COMMUNITY_Community 210|Community 210]]
- [[_COMMUNITY_Community 211|Community 211]]
- [[_COMMUNITY_Community 213|Community 213]]
- [[_COMMUNITY_Community 216|Community 216]]
- [[_COMMUNITY_Community 218|Community 218]]
- [[_COMMUNITY_Community 221|Community 221]]

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
Nodes (207): expectedUserHeaders(), getClientInfo(), provenanceHeaders(), clearSessionConfirmed(), fireAccountDeleted(), fireAccountMismatch(), fireConnectionStatus(), fireErrorNotifier() (+199 more)

### Community 2 - "Community 2"
Cohesion: 0.02
Nodes (130): handleProceed(), validate(), handleResend(), handleVerify(), handleNewFolder(), handleSubmit(), savePermissions(), setExpiry() (+122 more)

### Community 3 - "Community 3"
Cohesion: 0.03
Nodes (94): handleRestore(), attachFreshToken(), buildRequest(), handleCopy(), cleanName(), decryptActivitySnapshotName(), describeActivityEventWithFileName(), describeWithName() (+86 more)

### Community 4 - "Community 4"
Cohesion: 0.06
Nodes (77): addHeapObject(), compute_recovery_check(), debugString(), decodeText(), decompress_gzip(), decrypt_chunk(), decrypt_chunks(), decrypt_metadata() (+69 more)

### Community 5 - "Community 5"
Cohesion: 0.05
Nodes (36): dismissDevBanner(), enterEdit(), gotoAndSettle(), uploadWithoutReload(), dismissDevBanner(), openInOffice(), setup(), dismissDevBanner() (+28 more)

### Community 6 - "Community 6"
Cohesion: 0.05
Nodes (26): getApiUrl(), downloadVersion(), getFileRequestPublic(), revokeAccountSession(), uploadToFileRequest(), CoreSearchIndex, decryptIndex(), deriveIndexKey() (+18 more)

### Community 7 - "Community 7"
Cohesion: 0.06
Nodes (32): onRegionChanged(), resolveName(), decryptAll(), handleDownload(), downloadBundleItem(), downloadSharedFile(), canStreamToServiceWorker(), createBlobSink() (+24 more)

### Community 8 - "Community 8"
Cohesion: 0.06
Nodes (30): performUpload(), uploadThumbnail(), uploadThumbnailLarge(), encryptedUpload(), withNetworkRetry(), basename(), isLikelyAlbumArtOrIcon(), splitName() (+22 more)

### Community 9 - "Community 9"
Cohesion: 0.05
Nodes (18): BillingBanner(), BillingSuspendedOverlay(), FileList(), if(), timeAgo(), IncidentBanner(), notificationIcon(), toDisplay() (+10 more)

### Community 10 - "Community 10"
Cohesion: 0.09
Nodes (11): loadNames(), getSyncOps(), submitSyncOps(), classifyStreamFrame(), getDeviceId(), payloadToNode(), saveLastSeq(), savePendingOps() (+3 more)

### Community 11 - "Community 11"
Cohesion: 0.11
Nodes (30): devAutoAuth(), cacheKeyPersistent(), cacheKeySessionOnly(), anchorOf(), armExpiryTimer(), checkAndClearIfExpired(), clearExpiryTimer(), clearSession() (+22 more)

### Community 12 - "Community 12"
Cohesion: 0.13
Nodes (26): applyDocumentChrome(), closeOtherEmptyFrames(), doAddModifiedListener(), doAddSelectionListener(), doAddStatusListener(), doDebugChromeState(), doDispatch(), doGetDocStats() (+18 more)

### Community 13 - "Community 13"
Cohesion: 0.12
Nodes (11): resolveUpgradeCheckoutFailure(), startUpgradeCheckout(), billingResetNavigationState(), handleBillingResetTestMode(), isBillingResetTestModeError(), getPendingCheckout(), makePreState(), persistTrialConvertIntent() (+3 more)

### Community 14 - "Community 14"
Cohesion: 0.13
Nodes (12): ErrorBoundary, getTelemetryConsent(), initTelemetry(), installId(), parseDsn(), randomHex(), reportError(), setTelemetryConsent() (+4 more)

### Community 15 - "Community 15"
Cohesion: 0.1
Nodes (5): onMenuKeyDown(), onPointerDown(), pick(), close(), randomPassword()

### Community 16 - "Community 16"
Cohesion: 0.1
Nodes (6): useImpressChrome(), useImpressFitZoom(), useTheme(), OfficeEditor(), useOfficeEngine(), useCalcSelectionStats()

### Community 17 - "Community 17"
Cohesion: 0.15
Nodes (8): signUpToChecklist(), signUp(), signUp(), createAccount(), fillSignupForm(), reachPasswordStep(), signupAndUnlock(), uniqueEmail()

### Community 18 - "Community 18"
Cohesion: 0.23
Nodes (18): cacheFileList(), cacheFilePreview(), enforceRowCap(), evictOldestPreviews(), fileListDelete(), fileListGet(), fileListGetAll(), fileListPut() (+10 more)

### Community 19 - "Community 19"
Cohesion: 0.13
Nodes (9): restoreFile(), buildDetailsMeta(), decryptAll(), decryptOne(), displayName(), handleRestore(), handleRestoreAll(), handleRestoreSelected() (+1 more)

### Community 20 - "Community 20"
Cohesion: 0.11
Nodes (3): Row(), AndroidKeyboard(), IOSKeyboard()

### Community 21 - "Community 21"
Cohesion: 0.24
Nodes (16): findJpegExifTiffOffset(), findJpegSpans(), findLargestJpegSpan(), formatShutterSpeed(), jpegPixelCount(), mapExifToRawInfo(), parseTiffExifTags(), readAsciiValue() (+8 more)

### Community 22 - "Community 22"
Cohesion: 0.31
Nodes (17): clearEmptyPasswordVault(), clearVault(), computeKeyCheck(), dbClear(), dbDelete(), dbGet(), dbPut(), deriveWrappingKey() (+9 more)

### Community 23 - "Community 23"
Cohesion: 0.15
Nodes (4): FakeIDBDatabase, FakeIDBRequest, FakeObjectStore, FakeTransaction

### Community 24 - "Community 24"
Cohesion: 0.14
Nodes (4): commitQuery(), handleSubmit(), loadRecent(), saveRecent()

### Community 25 - "Community 25"
Cohesion: 0.14
Nodes (10): handleSubmit(), checkNewDocumentName(), defaultNewDocumentName(), getNewDocumentType(), NewDocumentNameClashError, splitExt(), uniqueFileName(), isOfficeLabsEnabled() (+2 more)

### Community 28 - "Community 28"
Cohesion: 0.21
Nodes (6): dismissDevBanner(), engineFrameHandle(), engineSave(), gotoDrive(), officeTabFrom(), reopen()

### Community 29 - "Community 29"
Cohesion: 0.18
Nodes (3): long_line(), longLine(), main()

### Community 31 - "Community 31"
Cohesion: 0.29
Nodes (9): asciiNul(), buildFakeJpeg(), buildJpegWithSof0(), buildMinimalBigEndianTiff(), buildSyntheticCanonTiff(), marker(), rationalLE(), u16le() (+1 more)

### Community 33 - "Community 33"
Cohesion: 0.18
Nodes (1): MemoryStorage

### Community 34 - "Community 34"
Cohesion: 0.33
Nodes (8): assertSameOrigin(), createCancellableOfficeLoad(), fetchAssetStreaming(), fetchOfficeManifest(), isAbortError(), loadOfficeBundle(), OfficeLoaderError, parseOfficeManifest()

### Community 35 - "Community 35"
Cohesion: 0.2
Nodes (2): dayLabel(), groupByDay()

### Community 40 - "Community 40"
Cohesion: 0.22
Nodes (2): formatEta(), formatSpeed()

### Community 41 - "Community 41"
Cohesion: 0.27
Nodes (4): exceedsQuota(), itemNetBytes(), requiredQuotaBytes(), UploadQuotaLedger

### Community 45 - "Community 45"
Cohesion: 0.22
Nodes (1): MemoryStorage

### Community 46 - "Community 46"
Cohesion: 0.25
Nodes (3): fileCreateFrame(), MemoryStorage, seededClient()

### Community 47 - "Community 47"
Cohesion: 0.28
Nodes (3): bbEnv(), bbLoginViaBrowser(), runBb()

### Community 48 - "Community 48"
Cohesion: 0.31
Nodes (6): shareLinkWithDashOrUnderscore(), openManageShares(), createShareLink(), dismissWelcomeTourIfOpen(), openRowMenu(), uploadTextFile()

### Community 49 - "Community 49"
Cohesion: 0.31
Nodes (5): findEocdInTail(), latin1Decode(), parseCentralDirectoryEntries(), readZipListing(), load()

### Community 56 - "Community 56"
Cohesion: 0.25
Nodes (1): ApiError

### Community 58 - "Community 58"
Cohesion: 0.25
Nodes (4): ApiError, IncorrectPasswordError, parseErrorBody(), SessionTooOldForConfirmationError

### Community 60 - "Community 60"
Cohesion: 0.25
Nodes (3): load(), handleDownloadCiphertext(), downloadFile()

### Community 62 - "Community 62"
Cohesion: 0.29
Nodes (2): pipelineStage(), stageLabel()

### Community 64 - "Community 64"
Cohesion: 0.25
Nodes (3): recoveredKeyMatchesAccount(), depsForAccount(), runGate()

### Community 65 - "Community 65"
Cohesion: 0.32
Nodes (4): guestRouteFallback(), parsePlanIntent(), postSignupDestination(), readPlanIntent()

### Community 66 - "Community 66"
Cohesion: 0.32
Nodes (3): formatStorageSI(), upgradeCardFromFallback(), upgradeCardFromPlanMeta()

### Community 74 - "Community 74"
Cohesion: 0.29
Nodes (1): MemoryStorage

### Community 75 - "Community 75"
Cohesion: 0.29
Nodes (1): MemoryStorage

### Community 76 - "Community 76"
Cohesion: 0.29
Nodes (1): MemoryStorage

### Community 77 - "Community 77"
Cohesion: 0.33
Nodes (2): isOfficeAssetPath(), officeVersionFromPath()

### Community 78 - "Community 78"
Cohesion: 0.29
Nodes (2): deriveButtonState(), RibbonButton()

### Community 80 - "Community 80"
Cohesion: 0.43
Nodes (3): BracketColorPlugin, buildVisibleDecorations(), computeBracketDepths()

### Community 81 - "Community 81"
Cohesion: 0.38
Nodes (3): getStored(), isValidDensity(), isValidFontSize()

### Community 82 - "Community 82"
Cohesion: 0.38
Nodes (5): allowsFunctional(), getConsent(), hasConsented(), setConsent(), update()

### Community 85 - "Community 85"
Cohesion: 0.6
Nodes (5): ascii(), buildZip(), u16le(), u32le(), utf8()

### Community 86 - "Community 86"
Cohesion: 0.33
Nodes (1): MemoryStorage

### Community 89 - "Community 89"
Cohesion: 0.4
Nodes (2): blob(), createFolder()

### Community 90 - "Community 90"
Cohesion: 0.4
Nodes (2): decodeAndConvert(), pcmToWavBlob()

### Community 91 - "Community 91"
Cohesion: 0.47
Nodes (4): ensureLang(), getHighlighter(), langLabel(), toShikiLang()

### Community 92 - "Community 92"
Cohesion: 0.4
Nodes (2): statusLabel(), statusVariant()

### Community 93 - "Community 93"
Cohesion: 0.33
Nodes (3): NewFolderDialog(), SessionTimeoutWarning(), useFocusTrap()

### Community 94 - "Community 94"
Cohesion: 0.53
Nodes (4): clearPendingSelectTimer(), handleRowClick(), handleRowDoubleClick(), handleRowInteractionCapture()

### Community 95 - "Community 95"
Cohesion: 0.4
Nodes (2): consumePendingExport(), hasPendingExport()

### Community 96 - "Community 96"
Cohesion: 0.4
Nodes (3): buildOnboardingState(), pilotKeyBlocksSubmit(), handleSubmit()

### Community 97 - "Community 97"
Cohesion: 0.4
Nodes (2): computeStep(), writeLocalStep()

### Community 98 - "Community 98"
Cohesion: 0.4
Nodes (2): fromBase64url(), readRequestPublicKey()

### Community 102 - "Community 102"
Cohesion: 0.4
Nodes (2): discardInFlightUpload(), abandon()

### Community 103 - "Community 103"
Cohesion: 0.4
Nodes (1): MemoryStorage

### Community 104 - "Community 104"
Cohesion: 0.5
Nodes (2): b64(), sealed()

### Community 107 - "Community 107"
Cohesion: 0.5
Nodes (2): dismissFirstRunOverlays(), dismissIfShown()

### Community 109 - "Community 109"
Cohesion: 0.6
Nodes (3): clickRowStar(), dismissFirstRunOverlays(), rowFor()

### Community 111 - "Community 111"
Cohesion: 0.4
Nodes (2): ImpersonationBanner(), useImpersonation()

### Community 113 - "Community 113"
Cohesion: 0.5
Nodes (2): hashString(), pickIndicesFromPhrase()

### Community 114 - "Community 114"
Cohesion: 0.5
Nodes (2): AnnouncementBanner(), severityClasses()

### Community 115 - "Community 115"
Cohesion: 0.5
Nodes (2): getExtension(), getMimeLabel()

### Community 116 - "Community 116"
Cohesion: 0.7
Nodes (4): FOLDER_COLOR_KEY(), getFolderColor(), getFolderColorDot(), setFolderColor()

### Community 117 - "Community 117"
Cohesion: 0.6
Nodes (3): checkEditability(), isValidUtf8(), looksBinary()

### Community 118 - "Community 118"
Cohesion: 0.6
Nodes (3): decryptFromQr(), deriveQrKey(), encryptForQr()

### Community 119 - "Community 119"
Cohesion: 0.7
Nodes (4): applyTemplate(), newPara(), paragraphStyle(), text()

### Community 120 - "Community 120"
Cohesion: 0.5
Nodes (3): blankDocumentBytes(), decodeBase64(), shipped()

### Community 121 - "Community 121"
Cohesion: 0.5
Nodes (2): parseClipboardStats(), parseNumericToken()

### Community 122 - "Community 122"
Cohesion: 0.5
Nodes (2): getExtension(), resolveOfficeFileKind()

### Community 123 - "Community 123"
Cohesion: 0.5
Nodes (2): Avatar(), getInitials()

### Community 136 - "Community 136"
Cohesion: 0.83
Nodes (3): call(), getPort(), waitForModule()

### Community 137 - "Community 137"
Cohesion: 0.83
Nodes (3): main(), prop(), write_ts_module()

### Community 144 - "Community 144"
Cohesion: 0.83
Nodes (3): bbEnv(), bbLoginViaBrowser(), runBb()

### Community 145 - "Community 145"
Cohesion: 0.67
Nodes (2): dismissOverlays(), openRowMenu()

### Community 152 - "Community 152"
Cohesion: 0.5
Nodes (1): Sample

### Community 155 - "Community 155"
Cohesion: 0.83
Nodes (3): extractDroppedItems(), processEntries(), readDirectoryEntry()

### Community 156 - "Community 156"
Cohesion: 0.83
Nodes (3): getMenuItems(), getPendingItems(), SharedContextMenu()

### Community 159 - "Community 159"
Cohesion: 0.5
Nodes (2): resolveSafeMarkdownHref(), MarkdownSafeLink()

### Community 167 - "Community 167"
Cohesion: 0.67
Nodes (2): reconcileSignalOutcome(), reflectsUpgrade()

### Community 168 - "Community 168"
Cohesion: 0.5
Nodes (2): ContextMenu(), isPreviewable()

### Community 169 - "Community 169"
Cohesion: 0.67
Nodes (2): formatMegabytes(), officeLoadByteLabel()

### Community 182 - "Community 182"
Cohesion: 0.67
Nodes (2): WasmChunkEncryptor, WasmSearchIndex

### Community 184 - "Community 184"
Cohesion: 1.0
Nodes (2): dismissFirstRunOverlays(), dismissIfShown()

### Community 187 - "Community 187"
Cohesion: 1.0
Nodes (2): totp(), wrongCode()

### Community 192 - "Community 192"
Cohesion: 1.0
Nodes (2): createBundleShareLink(), selectRow()

### Community 203 - "Community 203"
Cohesion: 1.0
Nodes (2): formatClock(), OfficeStatusBar()

### Community 208 - "Community 208"
Cohesion: 1.0
Nodes (2): decodeTiffToPng(), getProxy()

### Community 209 - "Community 209"
Cohesion: 1.0
Nodes (2): mergeRecentlyChangedFiles(), updatedAtMs()

### Community 210 - "Community 210"
Cohesion: 1.0
Nodes (2): checkPasswordBreached(), sha1Hex()

### Community 211 - "Community 211"
Cohesion: 1.0
Nodes (2): deriveSasWords(), fnv1a()

### Community 213 - "Community 213"
Cohesion: 1.0
Nodes (2): formatBytes(), formatStorageSI()

### Community 216 - "Community 216"
Cohesion: 1.0
Nodes (2): extractRawPreview(), getProxy()

### Community 218 - "Community 218"
Cohesion: 1.0
Nodes (2): isKeyBoundToUser(), KeyProvider()

### Community 221 - "Community 221"
Cohesion: 1.0
Nodes (2): ch(), migratePreferences()

## Knowledge Gaps
- **4 isolated node(s):** `PureVirtualError`, `UnboundTypeError`, `WasmChunkEncryptor`, `WasmSearchIndex`
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 33`** (11 nodes): `flush()`, `MemoryStorage`, `.clear()`, `.getItem()`, `.removeItem()`, `.setItem()`, `patchLastActivityAt()`, `randomKey()`, `rawEntry()`, `releaseHold()`, `1532-session-sliding-expiry.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 35`** (11 nodes): `actionText()`, `dayLabel()`, `DeviceBadge()`, `groupByDay()`, `isAlarmingEvent()`, `isSecurityEvent()`, `loadingMore()`, `metaFor()`, `timeLabel()`, `wsToActivity()`, `activity.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 40`** (10 nodes): `barColor()`, `borderColor()`, `computeEta()`, `computeSpeed()`, `formatChunkSize()`, `formatEta()`, `formatSpeed()`, `phaseLabel()`, `regionLabel()`, `upload-progress-card.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 45`** (9 nodes): `MemoryStorage`, `.clear()`, `.getItem()`, `.removeItem()`, `.setItem()`, `randomKey()`, `stripUserId()`, `1531-account-binding.test.ts`, `writeUntaggedVaultEntry()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 56`** (8 nodes): `ApiError`, `.constructor()`, `installMocks()`, `pageImpl()`, `resetCaptures()`, `setListPage()`, `stubStream()`, `upload-share-mocks.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 62`** (8 nodes): `computeEta()`, `computeSpeed()`, `formatBytes()`, `formatEta()`, `formatSpeed()`, `pipelineStage()`, `stageLabel()`, `upload-progress.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 74`** (7 nodes): `MemoryStorage`, `.clear()`, `.getItem()`, `.removeItem()`, `.setItem()`, `sub()`, `pricing-checkout-intent-1469.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 75`** (7 nodes): `MemoryStorage`, `.clear()`, `.getItem()`, `.removeItem()`, `.setItem()`, `sub()`, `upgrade-nudge-checkout-intent-1469.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 76`** (7 nodes): `cookieUser()`, `MemoryStorage`, `.clear()`, `.getItem()`, `.removeItem()`, `.setItem()`, `1471-isloggedin-auth-context.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 77`** (7 nodes): `isCacheableOfficeResponse()`, `isOfficeAssetPath()`, `office-cache-logic.js`, `officeCacheName()`, `officeCacheNamesToDelete()`, `officeVersionFromPath()`, `parseManifestVersion()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 78`** (7 nodes): `deriveButtonState()`, `filterPaletteEntries()`, `toPaletteEntry()`, `Divider()`, `RibbonButton()`, `ribbon.tsx`, `ribbon-commands.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 86`** (6 nodes): `MemoryStorage`, `.clear()`, `.getItem()`, `.removeItem()`, `.setItem()`, `pending-checkout-0957.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 89`** (6 nodes): `blob()`, `createFolder()`, `deleteFile()`, `listChildIds()`, `listRootFolderIds()`, `folder-pagination.spec.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 90`** (6 nodes): `decodeAndConvert()`, `formatTime()`, `handleSeek()`, `pcmToWavBlob()`, `togglePlay()`, `audio-preview.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 92`** (6 nodes): `formatCents()`, `formatDate()`, `methodLabel()`, `statusLabel()`, `statusVariant()`, `TransactionList.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 95`** (6 nodes): `browserStorage()`, `consumePendingExport()`, `dataExportDownloadFilename()`, `hasPendingExport()`, `markPendingExport()`, `export-intent.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 97`** (6 nodes): `computeStep()`, `OnboardingProvider()`, `readLocalStep()`, `useOnboarding()`, `writeLocalStep()`, `onboarding-context.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 98`** (6 nodes): `formatBytes()`, `fromBase64url()`, `onDrop()`, `prevent()`, `readRequestPublicKey()`, `upload-request.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 102`** (5 nodes): `discardInFlightUpload()`, `upload-discard.ts`, `abandon()`, `deferred()`, `1571-discard-in-flight-upload.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 103`** (5 nodes): `MemoryStorage`, `.getItem()`, `.removeItem()`, `.setItem()`, `export-intent.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 104`** (5 nodes): `b64()`, `invite()`, `ports()`, `sealed()`, `folder-invite-recipient-key.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 107`** (5 nodes): `dismissFirstRunOverlays()`, `dismissIfShown()`, `installTourDismisser()`, `1565-preview-matrix.matrix.ts`, `uploadNameFor()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 111`** (5 nodes): `ImpersonationBanner()`, `ImpersonationProvider()`, `useImpersonation()`, `impersonation-banner.tsx`, `impersonation-context.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 113`** (5 nodes): `handleChange()`, `handleVerify()`, `hashString()`, `pickIndicesFromPhrase()`, `mnemonic-verify.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 114`** (5 nodes): `AnnouncementBanner()`, `readDismissed()`, `severityClasses()`, `writeDismissed()`, `announcement-banner.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 115`** (5 nodes): `formatSize()`, `getExtension()`, `getMimeLabel()`, `handleDownload()`, `unsupported-preview.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 121`** (5 nodes): `formatCalcCurrency()`, `formatCalcNumber()`, `parseClipboardStats()`, `parseNumericToken()`, `calc-selection-stats.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 122`** (5 nodes): `defaultExtensionFor()`, `getExtension()`, `officeAppLabel()`, `resolveOfficeFileKind()`, `office-file-kind.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 123`** (5 nodes): `Avatar()`, `formatRelativeDate()`, `getInitials()`, `SecuredBadge()`, `public-profile.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 145`** (4 nodes): `dismissOverlays()`, `freshContext()`, `openRowMenu()`, `folder-invite-recipient-decrypt.spec.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 152`** (4 nodes): `Sample`, `.Main()`, `sample.cs`, `sample.java`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 159`** (4 nodes): `resolveSafeMarkdownHref()`, `MarkdownSafeLink()`, `markdown-safe-link.tsx`, `markdown-link.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 167`** (4 nodes): `reconcileSignalOutcome()`, `reflectsUpgrade()`, `reflectsUpgradeNoIntent()`, `checkout-reconcile.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 168`** (4 nodes): `ContextMenu()`, `isPreviewable()`, `context-menu.tsx`, `preview.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 169`** (4 nodes): `formatMegabytes()`, `officeLoadByteLabel()`, `officeLoadPercent()`, `progress-format.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 182`** (3 nodes): `WasmChunkEncryptor`, `WasmSearchIndex`, `beebeeb_wasm.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 184`** (3 nodes): `dismissFirstRunOverlays()`, `dismissIfShown()`, `1565-code-ext-regression.spec.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 187`** (3 nodes): `totp()`, `2fa-wrong-code-feedback.spec.ts`, `wrongCode()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 192`** (3 nodes): `createBundleShareLink()`, `selectRow()`, `bundle-share.spec.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 203`** (3 nodes): `formatClock()`, `OfficeStatusBar()`, `office-status-bar.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 208`** (3 nodes): `decodeTiffToPng()`, `getProxy()`, `tiff-decode-worker-client.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 209`** (3 nodes): `mergeRecentlyChangedFiles()`, `updatedAtMs()`, `recent-files.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 210`** (3 nodes): `checkPasswordBreached()`, `sha1Hex()`, `breach-check.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 211`** (3 nodes): `deriveSasWords()`, `fnv1a()`, `sas-words.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 213`** (3 nodes): `formatBytes()`, `formatStorageSI()`, `format.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 216`** (3 nodes): `extractRawPreview()`, `getProxy()`, `raw-preview-worker-client.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 218`** (3 nodes): `isKeyBoundToUser()`, `KeyProvider()`, `key-context.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 221`** (3 nodes): `ch()`, `migratePreferences()`, `notifications.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `runWorkerLoop()` connect `Community 2` to `Community 8`, `Community 3`?**
  _High betweenness centrality (0.094) - this node is a cross-community bridge._
- **Why does `updateStatus()` connect `Community 2` to `Community 0`?**
  _High betweenness centrality (0.092) - this node is a cross-community bridge._
- **Why does `showToast()` connect `Community 2` to `Community 1`, `Community 3`, `Community 7`, `Community 8`, `Community 11`, `Community 13`, `Community 19`?**
  _High betweenness centrality (0.082) - this node is a cross-community bridge._
- **Are the 133 inferred relationships involving `request()` (e.g. with `provenanceHeaders()` and `expectedUserHeaders()`) actually correct?**
  _`request()` has 133 INFERRED edges - model-reasoned connections that need verification._
- **Are the 57 inferred relationships involving `showToast()` (e.g. with `handleCopy()` and `handleSubmit()`) actually correct?**
  _`showToast()` has 57 INFERRED edges - model-reasoned connections that need verification._
- **What connects `PureVirtualError`, `UnboundTypeError`, `WasmChunkEncryptor` to the rest of the system?**
  _4 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.01 - nodes in this community are weakly interconnected._