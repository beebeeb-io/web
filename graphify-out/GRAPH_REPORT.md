# Graph Report - web-1567-ship  (2026-09-27)

## Corpus Check
- 614 files · ~664,254 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 3498 nodes · 5263 edges · 99 communities detected
- Extraction: 87% EXTRACTED · 13% INFERRED · 0% AMBIGUOUS · INFERRED: 670 edges (avg confidence: 0.8)
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
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 44|Community 44]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 46|Community 46]]
- [[_COMMUNITY_Community 47|Community 47]]
- [[_COMMUNITY_Community 54|Community 54]]
- [[_COMMUNITY_Community 56|Community 56]]
- [[_COMMUNITY_Community 59|Community 59]]
- [[_COMMUNITY_Community 61|Community 61]]
- [[_COMMUNITY_Community 69|Community 69]]
- [[_COMMUNITY_Community 70|Community 70]]
- [[_COMMUNITY_Community 71|Community 71]]
- [[_COMMUNITY_Community 72|Community 72]]
- [[_COMMUNITY_Community 73|Community 73]]
- [[_COMMUNITY_Community 75|Community 75]]
- [[_COMMUNITY_Community 76|Community 76]]
- [[_COMMUNITY_Community 77|Community 77]]
- [[_COMMUNITY_Community 80|Community 80]]
- [[_COMMUNITY_Community 81|Community 81]]
- [[_COMMUNITY_Community 84|Community 84]]
- [[_COMMUNITY_Community 85|Community 85]]
- [[_COMMUNITY_Community 86|Community 86]]
- [[_COMMUNITY_Community 87|Community 87]]
- [[_COMMUNITY_Community 88|Community 88]]
- [[_COMMUNITY_Community 89|Community 89]]
- [[_COMMUNITY_Community 90|Community 90]]
- [[_COMMUNITY_Community 91|Community 91]]
- [[_COMMUNITY_Community 92|Community 92]]
- [[_COMMUNITY_Community 93|Community 93]]
- [[_COMMUNITY_Community 97|Community 97]]
- [[_COMMUNITY_Community 98|Community 98]]
- [[_COMMUNITY_Community 101|Community 101]]
- [[_COMMUNITY_Community 103|Community 103]]
- [[_COMMUNITY_Community 105|Community 105]]
- [[_COMMUNITY_Community 107|Community 107]]
- [[_COMMUNITY_Community 108|Community 108]]
- [[_COMMUNITY_Community 110|Community 110]]
- [[_COMMUNITY_Community 111|Community 111]]
- [[_COMMUNITY_Community 112|Community 112]]
- [[_COMMUNITY_Community 113|Community 113]]
- [[_COMMUNITY_Community 114|Community 114]]
- [[_COMMUNITY_Community 115|Community 115]]
- [[_COMMUNITY_Community 116|Community 116]]
- [[_COMMUNITY_Community 117|Community 117]]
- [[_COMMUNITY_Community 118|Community 118]]
- [[_COMMUNITY_Community 130|Community 130]]
- [[_COMMUNITY_Community 132|Community 132]]
- [[_COMMUNITY_Community 139|Community 139]]
- [[_COMMUNITY_Community 140|Community 140]]
- [[_COMMUNITY_Community 147|Community 147]]
- [[_COMMUNITY_Community 150|Community 150]]
- [[_COMMUNITY_Community 151|Community 151]]
- [[_COMMUNITY_Community 152|Community 152]]
- [[_COMMUNITY_Community 155|Community 155]]
- [[_COMMUNITY_Community 163|Community 163]]
- [[_COMMUNITY_Community 164|Community 164]]
- [[_COMMUNITY_Community 177|Community 177]]
- [[_COMMUNITY_Community 179|Community 179]]
- [[_COMMUNITY_Community 182|Community 182]]
- [[_COMMUNITY_Community 187|Community 187]]
- [[_COMMUNITY_Community 197|Community 197]]
- [[_COMMUNITY_Community 202|Community 202]]
- [[_COMMUNITY_Community 203|Community 203]]
- [[_COMMUNITY_Community 204|Community 204]]
- [[_COMMUNITY_Community 205|Community 205]]
- [[_COMMUNITY_Community 209|Community 209]]
- [[_COMMUNITY_Community 211|Community 211]]
- [[_COMMUNITY_Community 215|Community 215]]

## God Nodes (most connected - your core abstractions)
1. `request()` - 140 edges
2. `showToast()` - 62 edges
3. `withProxy()` - 53 edges
4. `getDataViewMemory0()` - 52 edges
5. `takeObject()` - 49 edges
6. `passArray8ToWasm0()` - 38 edges
7. `assert()` - 37 edges
8. `assert()` - 37 edges
9. `userFriendlyError()` - 26 edges
10. `lookupPath()` - 25 edges

## Surprising Connections (you probably didn't know these)
- `resolveSessionToken()` --calls--> `handleAuthorize()`  [INFERRED]
  packages/shared/src/api/request.ts → src/pages/cli-auth.tsx
- `depsForAccount()` --calls--> `compute_recovery_check()`  [INFERRED]
  test/recovery-validation.test.ts → packages/beebeeb-wasm/beebeeb_wasm.js
- `runIter()` --calls--> `pre()`  [INFERRED]
  office-bundle-staging/bb08258cec549226/soffice.js → test/checkout-reconcile-0957.test.ts
- `ensureWasm()` --calls--> `init()`  [INFERRED]
  src/lib/plan-pricing.ts → public/office/phase4-2026-09-27/soffice.js
- `runWorkerLoop()` --calls--> `updateStatus()`  [INFERRED]
  src/pages/settings/import.tsx → public/office/phase4-2026-09-27/soffice.js

## Communities

### Community 0 - "Community 0"
Cohesion: 0.01
Nodes (263): ensureWasm(), abort(), absolutePath(), accept(), addPeer(), addRunDependency(), allocateUnusedWorker(), analyzePath() (+255 more)

### Community 1 - "Community 1"
Cohesion: 0.01
Nodes (260): abort(), absolutePath(), accept(), addPeer(), addRunDependency(), allocateUnusedWorker(), analyzePath(), assert() (+252 more)

### Community 2 - "Community 2"
Cohesion: 0.01
Nodes (216): expectedUserHeaders(), getClientInfo(), provenanceHeaders(), clearSessionConfirmed(), fireAccountDeleted(), fireAccountMismatch(), fireConnectionStatus(), fireErrorNotifier() (+208 more)

### Community 3 - "Community 3"
Cohesion: 0.01
Nodes (142): handleProceed(), validate(), FileList(), if(), timeAgo(), decryptAll(), handleNewFolder(), handleSubmit() (+134 more)

### Community 4 - "Community 4"
Cohesion: 0.02
Nodes (102): handleRestore(), onRegionChanged(), resolveName(), attachFreshToken(), buildRequest(), cleanName(), decryptActivitySnapshotName(), describeActivityEventWithFileName() (+94 more)

### Community 5 - "Community 5"
Cohesion: 0.05
Nodes (80): addHeapObject(), compute_recovery_check(), debugString(), decodeText(), decompress_gzip(), decrypt_chunk(), decrypt_chunks(), decrypt_metadata() (+72 more)

### Community 6 - "Community 6"
Cohesion: 0.04
Nodes (46): getApiUrl(), downloadBundleItem(), downloadSharedFile(), downloadVersion(), getFileRequestPublic(), revokeAccountSession(), uploadToFileRequest(), dispatchDecrypted() (+38 more)

### Community 7 - "Community 7"
Cohesion: 0.05
Nodes (36): dismissDevBanner(), enterEdit(), gotoAndSettle(), uploadWithoutReload(), dismissDevBanner(), openInOffice(), setup(), dismissDevBanner() (+28 more)

### Community 8 - "Community 8"
Cohesion: 0.08
Nodes (47): devAutoAuth(), cacheKeyPersistent(), cacheKeySessionOnly(), anchorOf(), armExpiryTimer(), checkAndClearIfExpired(), clearExpiryTimer(), clearSession() (+39 more)

### Community 9 - "Community 9"
Cohesion: 0.06
Nodes (31): performUpload(), uploadThumbnail(), uploadThumbnailLarge(), encryptedUpload(), withNetworkRetry(), basename(), isLikelyAlbumArtOrIcon(), splitName() (+23 more)

### Community 10 - "Community 10"
Cohesion: 0.08
Nodes (12): QtLoader(), loadNames(), getSyncOps(), submitSyncOps(), classifyStreamFrame(), getDeviceId(), payloadToNode(), saveLastSeq() (+4 more)

### Community 11 - "Community 11"
Cohesion: 0.05
Nodes (14): BillingBanner(), BillingSuspendedOverlay(), IncidentBanner(), notificationIcon(), toDisplay(), useNotifications(), useToast(), useWebSocket() (+6 more)

### Community 12 - "Community 12"
Cohesion: 0.18
Nodes (32): applyDocumentChrome(), closeOtherEmptyFrames(), doAddModifiedListener(), doAddSelectionListener(), doAddStatusListener(), doDebugChromeState(), doDispatch(), doGetDocStats() (+24 more)

### Community 13 - "Community 13"
Cohesion: 0.11
Nodes (12): handleConvert(), resolveUpgradeCheckoutFailure(), startUpgradeCheckout(), billingResetNavigationState(), handleBillingResetTestMode(), isBillingResetTestModeError(), getPendingCheckout(), makePreState() (+4 more)

### Community 14 - "Community 14"
Cohesion: 0.13
Nodes (12): ErrorBoundary, getTelemetryConsent(), initTelemetry(), installId(), parseDsn(), randomHex(), reportError(), setTelemetryConsent() (+4 more)

### Community 15 - "Community 15"
Cohesion: 0.1
Nodes (6): useImpressChrome(), useImpressFitZoom(), useTheme(), OfficeEditor(), useOfficeEngine(), useCalcSelectionStats()

### Community 16 - "Community 16"
Cohesion: 0.15
Nodes (8): signUpToChecklist(), signUp(), signUp(), createAccount(), fillSignupForm(), reachPasswordStep(), signupAndUnlock(), uniqueEmail()

### Community 17 - "Community 17"
Cohesion: 0.23
Nodes (18): cacheFileList(), cacheFilePreview(), enforceRowCap(), evictOldestPreviews(), fileListDelete(), fileListGet(), fileListGetAll(), fileListPut() (+10 more)

### Community 18 - "Community 18"
Cohesion: 0.11
Nodes (3): Row(), AndroidKeyboard(), IOSKeyboard()

### Community 19 - "Community 19"
Cohesion: 0.24
Nodes (16): findJpegExifTiffOffset(), findJpegSpans(), findLargestJpegSpan(), formatShutterSpeed(), jpegPixelCount(), mapExifToRawInfo(), parseTiffExifTags(), readAsciiValue() (+8 more)

### Community 20 - "Community 20"
Cohesion: 0.15
Nodes (4): FakeIDBDatabase, FakeIDBRequest, FakeObjectStore, FakeTransaction

### Community 21 - "Community 21"
Cohesion: 0.14
Nodes (4): commitQuery(), handleSubmit(), loadRecent(), saveRecent()

### Community 24 - "Community 24"
Cohesion: 0.18
Nodes (3): long_line(), longLine(), main()

### Community 26 - "Community 26"
Cohesion: 0.29
Nodes (9): asciiNul(), buildFakeJpeg(), buildJpegWithSof0(), buildMinimalBigEndianTiff(), buildSyntheticCanonTiff(), marker(), rationalLE(), u16le() (+1 more)

### Community 27 - "Community 27"
Cohesion: 0.17
Nodes (4): load(), handleDownloadCiphertext(), downloadFile(), handleLoadMore()

### Community 29 - "Community 29"
Cohesion: 0.18
Nodes (1): MemoryStorage

### Community 30 - "Community 30"
Cohesion: 0.33
Nodes (8): assertSameOrigin(), createCancellableOfficeLoad(), fetchAssetStreaming(), fetchOfficeManifest(), isAbortError(), loadOfficeBundle(), OfficeLoaderError, parseOfficeManifest()

### Community 31 - "Community 31"
Cohesion: 0.2
Nodes (2): dayLabel(), groupByDay()

### Community 32 - "Community 32"
Cohesion: 0.25
Nodes (5): formatBytes(), formatStorageSI(), formatStorageSI(), upgradeCardFromFallback(), upgradeCardFromPlanMeta()

### Community 38 - "Community 38"
Cohesion: 0.22
Nodes (2): formatEta(), formatSpeed()

### Community 39 - "Community 39"
Cohesion: 0.27
Nodes (4): exceedsQuota(), itemNetBytes(), requiredQuotaBytes(), UploadQuotaLedger

### Community 43 - "Community 43"
Cohesion: 0.22
Nodes (1): MemoryStorage

### Community 44 - "Community 44"
Cohesion: 0.25
Nodes (3): fileCreateFrame(), MemoryStorage, seededClient()

### Community 45 - "Community 45"
Cohesion: 0.31
Nodes (6): shareLinkWithDashOrUnderscore(), openManageShares(), createShareLink(), dismissWelcomeTourIfOpen(), openRowMenu(), uploadTextFile()

### Community 46 - "Community 46"
Cohesion: 0.28
Nodes (3): bbEnv(), bbLoginViaBrowser(), runBb()

### Community 47 - "Community 47"
Cohesion: 0.31
Nodes (5): findEocdInTail(), latin1Decode(), parseCentralDirectoryEntries(), readZipListing(), load()

### Community 54 - "Community 54"
Cohesion: 0.25
Nodes (1): ApiError

### Community 56 - "Community 56"
Cohesion: 0.25
Nodes (4): ApiError, IncorrectPasswordError, parseErrorBody(), SessionTooOldForConfirmationError

### Community 59 - "Community 59"
Cohesion: 0.29
Nodes (2): pipelineStage(), stageLabel()

### Community 61 - "Community 61"
Cohesion: 0.32
Nodes (4): guestRouteFallback(), parsePlanIntent(), postSignupDestination(), readPlanIntent()

### Community 69 - "Community 69"
Cohesion: 0.29
Nodes (1): MemoryStorage

### Community 70 - "Community 70"
Cohesion: 0.29
Nodes (1): MemoryStorage

### Community 71 - "Community 71"
Cohesion: 0.29
Nodes (1): MemoryStorage

### Community 72 - "Community 72"
Cohesion: 0.33
Nodes (2): isOfficeAssetPath(), officeVersionFromPath()

### Community 73 - "Community 73"
Cohesion: 0.29
Nodes (2): deriveButtonState(), RibbonButton()

### Community 75 - "Community 75"
Cohesion: 0.43
Nodes (3): BracketColorPlugin, buildVisibleDecorations(), computeBracketDepths()

### Community 76 - "Community 76"
Cohesion: 0.38
Nodes (3): getStored(), isValidDensity(), isValidFontSize()

### Community 77 - "Community 77"
Cohesion: 0.38
Nodes (5): allowsFunctional(), getConsent(), hasConsented(), setConsent(), update()

### Community 80 - "Community 80"
Cohesion: 0.6
Nodes (5): ascii(), buildZip(), u16le(), u32le(), utf8()

### Community 81 - "Community 81"
Cohesion: 0.33
Nodes (1): MemoryStorage

### Community 84 - "Community 84"
Cohesion: 0.4
Nodes (2): blob(), createFolder()

### Community 85 - "Community 85"
Cohesion: 0.33
Nodes (3): NewFolderDialog(), SessionTimeoutWarning(), useFocusTrap()

### Community 86 - "Community 86"
Cohesion: 0.4
Nodes (2): decodeAndConvert(), pcmToWavBlob()

### Community 87 - "Community 87"
Cohesion: 0.47
Nodes (4): ensureLang(), getHighlighter(), langLabel(), toShikiLang()

### Community 88 - "Community 88"
Cohesion: 0.4
Nodes (2): statusLabel(), statusVariant()

### Community 89 - "Community 89"
Cohesion: 0.53
Nodes (4): clearPendingSelectTimer(), handleRowClick(), handleRowDoubleClick(), handleRowInteractionCapture()

### Community 90 - "Community 90"
Cohesion: 0.4
Nodes (2): consumePendingExport(), hasPendingExport()

### Community 91 - "Community 91"
Cohesion: 0.4
Nodes (3): buildOnboardingState(), pilotKeyBlocksSubmit(), handleSubmit()

### Community 92 - "Community 92"
Cohesion: 0.4
Nodes (2): computeStep(), writeLocalStep()

### Community 93 - "Community 93"
Cohesion: 0.4
Nodes (2): fromBase64url(), readRequestPublicKey()

### Community 97 - "Community 97"
Cohesion: 0.4
Nodes (1): MemoryStorage

### Community 98 - "Community 98"
Cohesion: 0.5
Nodes (2): b64(), sealed()

### Community 101 - "Community 101"
Cohesion: 0.5
Nodes (2): dismissFirstRunOverlays(), dismissIfShown()

### Community 103 - "Community 103"
Cohesion: 0.6
Nodes (3): clickRowStar(), dismissFirstRunOverlays(), rowFor()

### Community 105 - "Community 105"
Cohesion: 0.4
Nodes (2): ImpersonationBanner(), useImpersonation()

### Community 107 - "Community 107"
Cohesion: 0.5
Nodes (2): hashString(), pickIndicesFromPhrase()

### Community 108 - "Community 108"
Cohesion: 0.5
Nodes (2): AnnouncementBanner(), severityClasses()

### Community 110 - "Community 110"
Cohesion: 0.5
Nodes (2): getExtension(), getMimeLabel()

### Community 111 - "Community 111"
Cohesion: 0.7
Nodes (4): FOLDER_COLOR_KEY(), getFolderColor(), getFolderColorDot(), setFolderColor()

### Community 112 - "Community 112"
Cohesion: 0.6
Nodes (3): checkEditability(), isValidUtf8(), looksBinary()

### Community 113 - "Community 113"
Cohesion: 0.4
Nodes (2): discardInFlightUpload(), abandon()

### Community 114 - "Community 114"
Cohesion: 0.6
Nodes (3): decryptFromQr(), deriveQrKey(), encryptForQr()

### Community 115 - "Community 115"
Cohesion: 0.7
Nodes (4): applyTemplate(), newPara(), paragraphStyle(), text()

### Community 116 - "Community 116"
Cohesion: 0.5
Nodes (2): parseClipboardStats(), parseNumericToken()

### Community 117 - "Community 117"
Cohesion: 0.5
Nodes (2): getExtension(), resolveOfficeFileKind()

### Community 118 - "Community 118"
Cohesion: 0.5
Nodes (2): Avatar(), getInitials()

### Community 130 - "Community 130"
Cohesion: 0.83
Nodes (3): call(), getPort(), waitForModule()

### Community 132 - "Community 132"
Cohesion: 0.83
Nodes (3): call(), getPort(), waitForModule()

### Community 139 - "Community 139"
Cohesion: 0.83
Nodes (3): bbEnv(), bbLoginViaBrowser(), runBb()

### Community 140 - "Community 140"
Cohesion: 0.67
Nodes (2): dismissOverlays(), openRowMenu()

### Community 147 - "Community 147"
Cohesion: 0.5
Nodes (1): Sample

### Community 150 - "Community 150"
Cohesion: 0.83
Nodes (3): extractDroppedItems(), processEntries(), readDirectoryEntry()

### Community 151 - "Community 151"
Cohesion: 0.83
Nodes (3): getMenuItems(), getPendingItems(), SharedContextMenu()

### Community 152 - "Community 152"
Cohesion: 0.5
Nodes (2): ContextMenu(), isPreviewable()

### Community 155 - "Community 155"
Cohesion: 0.5
Nodes (2): resolveSafeMarkdownHref(), MarkdownSafeLink()

### Community 163 - "Community 163"
Cohesion: 0.67
Nodes (2): reconcileSignalOutcome(), reflectsUpgrade()

### Community 164 - "Community 164"
Cohesion: 0.67
Nodes (2): formatMegabytes(), officeLoadByteLabel()

### Community 177 - "Community 177"
Cohesion: 0.67
Nodes (2): WasmChunkEncryptor, WasmSearchIndex

### Community 179 - "Community 179"
Cohesion: 1.0
Nodes (2): dismissFirstRunOverlays(), dismissIfShown()

### Community 182 - "Community 182"
Cohesion: 1.0
Nodes (2): totp(), wrongCode()

### Community 187 - "Community 187"
Cohesion: 1.0
Nodes (2): createBundleShareLink(), selectRow()

### Community 197 - "Community 197"
Cohesion: 1.0
Nodes (2): formatClock(), OfficeStatusBar()

### Community 202 - "Community 202"
Cohesion: 1.0
Nodes (2): decodeTiffToPng(), getProxy()

### Community 203 - "Community 203"
Cohesion: 1.0
Nodes (2): mergeRecentlyChangedFiles(), updatedAtMs()

### Community 204 - "Community 204"
Cohesion: 1.0
Nodes (2): checkPasswordBreached(), sha1Hex()

### Community 205 - "Community 205"
Cohesion: 1.0
Nodes (2): deriveSasWords(), fnv1a()

### Community 209 - "Community 209"
Cohesion: 1.0
Nodes (2): extractRawPreview(), getProxy()

### Community 211 - "Community 211"
Cohesion: 1.0
Nodes (2): isKeyBoundToUser(), KeyProvider()

### Community 215 - "Community 215"
Cohesion: 1.0
Nodes (2): ch(), migratePreferences()

## Knowledge Gaps
- **6 isolated node(s):** `PureVirtualError`, `UnboundTypeError`, `PureVirtualError`, `UnboundTypeError`, `WasmChunkEncryptor` (+1 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 29`** (11 nodes): `flush()`, `MemoryStorage`, `.clear()`, `.getItem()`, `.removeItem()`, `.setItem()`, `patchLastActivityAt()`, `randomKey()`, `rawEntry()`, `releaseHold()`, `1532-session-sliding-expiry.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 31`** (11 nodes): `actionText()`, `dayLabel()`, `DeviceBadge()`, `groupByDay()`, `isAlarmingEvent()`, `isSecurityEvent()`, `loadingMore()`, `metaFor()`, `timeLabel()`, `wsToActivity()`, `activity.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 38`** (10 nodes): `barColor()`, `borderColor()`, `computeEta()`, `computeSpeed()`, `formatChunkSize()`, `formatEta()`, `formatSpeed()`, `phaseLabel()`, `regionLabel()`, `upload-progress-card.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 43`** (9 nodes): `MemoryStorage`, `.clear()`, `.getItem()`, `.removeItem()`, `.setItem()`, `randomKey()`, `stripUserId()`, `1531-account-binding.test.ts`, `writeUntaggedVaultEntry()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 54`** (8 nodes): `ApiError`, `.constructor()`, `installMocks()`, `pageImpl()`, `resetCaptures()`, `setListPage()`, `stubStream()`, `upload-share-mocks.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 59`** (8 nodes): `computeEta()`, `computeSpeed()`, `formatBytes()`, `formatEta()`, `formatSpeed()`, `pipelineStage()`, `stageLabel()`, `upload-progress.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 69`** (7 nodes): `MemoryStorage`, `.clear()`, `.getItem()`, `.removeItem()`, `.setItem()`, `sub()`, `pricing-checkout-intent-1469.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 70`** (7 nodes): `MemoryStorage`, `.clear()`, `.getItem()`, `.removeItem()`, `.setItem()`, `sub()`, `upgrade-nudge-checkout-intent-1469.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 71`** (7 nodes): `cookieUser()`, `MemoryStorage`, `.clear()`, `.getItem()`, `.removeItem()`, `.setItem()`, `1471-isloggedin-auth-context.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 72`** (7 nodes): `isCacheableOfficeResponse()`, `isOfficeAssetPath()`, `office-cache-logic.js`, `officeCacheName()`, `officeCacheNamesToDelete()`, `officeVersionFromPath()`, `parseManifestVersion()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 73`** (7 nodes): `deriveButtonState()`, `filterPaletteEntries()`, `toPaletteEntry()`, `Divider()`, `RibbonButton()`, `ribbon.tsx`, `ribbon-commands.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 81`** (6 nodes): `MemoryStorage`, `.clear()`, `.getItem()`, `.removeItem()`, `.setItem()`, `pending-checkout-0957.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 84`** (6 nodes): `blob()`, `createFolder()`, `deleteFile()`, `listChildIds()`, `listRootFolderIds()`, `folder-pagination.spec.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 86`** (6 nodes): `decodeAndConvert()`, `formatTime()`, `handleSeek()`, `pcmToWavBlob()`, `togglePlay()`, `audio-preview.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 88`** (6 nodes): `formatCents()`, `formatDate()`, `methodLabel()`, `statusLabel()`, `statusVariant()`, `TransactionList.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 90`** (6 nodes): `browserStorage()`, `consumePendingExport()`, `dataExportDownloadFilename()`, `hasPendingExport()`, `markPendingExport()`, `export-intent.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 92`** (6 nodes): `computeStep()`, `OnboardingProvider()`, `readLocalStep()`, `useOnboarding()`, `writeLocalStep()`, `onboarding-context.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 93`** (6 nodes): `formatBytes()`, `fromBase64url()`, `onDrop()`, `prevent()`, `readRequestPublicKey()`, `upload-request.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 97`** (5 nodes): `MemoryStorage`, `.getItem()`, `.removeItem()`, `.setItem()`, `export-intent.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 98`** (5 nodes): `b64()`, `invite()`, `ports()`, `sealed()`, `folder-invite-recipient-key.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 101`** (5 nodes): `dismissFirstRunOverlays()`, `dismissIfShown()`, `installTourDismisser()`, `1565-preview-matrix.matrix.ts`, `uploadNameFor()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 105`** (5 nodes): `ImpersonationBanner()`, `ImpersonationProvider()`, `useImpersonation()`, `impersonation-banner.tsx`, `impersonation-context.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 107`** (5 nodes): `handleChange()`, `handleVerify()`, `hashString()`, `pickIndicesFromPhrase()`, `mnemonic-verify.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 108`** (5 nodes): `AnnouncementBanner()`, `readDismissed()`, `severityClasses()`, `writeDismissed()`, `announcement-banner.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 110`** (5 nodes): `formatSize()`, `getExtension()`, `getMimeLabel()`, `handleDownload()`, `unsupported-preview.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 113`** (5 nodes): `discardInFlightUpload()`, `upload-discard.ts`, `abandon()`, `deferred()`, `1571-discard-in-flight-upload.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 116`** (5 nodes): `formatCalcCurrency()`, `formatCalcNumber()`, `parseClipboardStats()`, `parseNumericToken()`, `calc-selection-stats.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 117`** (5 nodes): `defaultExtensionFor()`, `getExtension()`, `officeAppLabel()`, `resolveOfficeFileKind()`, `office-file-kind.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 118`** (5 nodes): `Avatar()`, `formatRelativeDate()`, `getInitials()`, `SecuredBadge()`, `public-profile.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 140`** (4 nodes): `dismissOverlays()`, `freshContext()`, `openRowMenu()`, `folder-invite-recipient-decrypt.spec.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 147`** (4 nodes): `Sample`, `.Main()`, `sample.cs`, `sample.java`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 152`** (4 nodes): `ContextMenu()`, `isPreviewable()`, `context-menu.tsx`, `preview.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 155`** (4 nodes): `resolveSafeMarkdownHref()`, `MarkdownSafeLink()`, `markdown-safe-link.tsx`, `markdown-link.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 163`** (4 nodes): `reconcileSignalOutcome()`, `reflectsUpgrade()`, `reflectsUpgradeNoIntent()`, `checkout-reconcile.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 164`** (4 nodes): `formatMegabytes()`, `officeLoadByteLabel()`, `officeLoadPercent()`, `progress-format.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 177`** (3 nodes): `WasmChunkEncryptor`, `WasmSearchIndex`, `beebeeb_wasm.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 179`** (3 nodes): `dismissFirstRunOverlays()`, `dismissIfShown()`, `1565-code-ext-regression.spec.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 182`** (3 nodes): `totp()`, `2fa-wrong-code-feedback.spec.ts`, `wrongCode()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 187`** (3 nodes): `createBundleShareLink()`, `selectRow()`, `bundle-share.spec.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 197`** (3 nodes): `formatClock()`, `OfficeStatusBar()`, `office-status-bar.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 202`** (3 nodes): `decodeTiffToPng()`, `getProxy()`, `tiff-decode-worker-client.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 203`** (3 nodes): `mergeRecentlyChangedFiles()`, `updatedAtMs()`, `recent-files.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 204`** (3 nodes): `checkPasswordBreached()`, `sha1Hex()`, `breach-check.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 205`** (3 nodes): `deriveSasWords()`, `fnv1a()`, `sas-words.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 209`** (3 nodes): `extractRawPreview()`, `getProxy()`, `raw-preview-worker-client.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 211`** (3 nodes): `isKeyBoundToUser()`, `KeyProvider()`, `key-context.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 215`** (3 nodes): `ch()`, `migratePreferences()`, `notifications.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `runWorkerLoop()` connect `Community 3` to `Community 9`, `Community 4`?**
  _High betweenness centrality (0.128) - this node is a cross-community bridge._
- **Why does `updateStatus()` connect `Community 3` to `Community 0`?**
  _High betweenness centrality (0.127) - this node is a cross-community bridge._
- **Are the 134 inferred relationships involving `request()` (e.g. with `provenanceHeaders()` and `expectedUserHeaders()`) actually correct?**
  _`request()` has 134 INFERRED edges - model-reasoned connections that need verification._
- **Are the 58 inferred relationships involving `showToast()` (e.g. with `handleCopy()` and `handleSubmit()`) actually correct?**
  _`showToast()` has 58 INFERRED edges - model-reasoned connections that need verification._
- **What connects `PureVirtualError`, `UnboundTypeError`, `PureVirtualError` to the rest of the system?**
  _6 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.01 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.01 - nodes in this community are weakly interconnected._