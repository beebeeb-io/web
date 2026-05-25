# Graph Report - web  (2026-05-26)

## Corpus Check
- 295 files · ~302,042 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1622 nodes · 2165 edges · 54 communities detected
- Extraction: 78% EXTRACTED · 22% INFERRED · 0% AMBIGUOUS · INFERRED: 474 edges (avg confidence: 0.8)
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
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 51|Community 51]]
- [[_COMMUNITY_Community 52|Community 52]]
- [[_COMMUNITY_Community 53|Community 53]]
- [[_COMMUNITY_Community 54|Community 54]]
- [[_COMMUNITY_Community 55|Community 55]]
- [[_COMMUNITY_Community 56|Community 56]]
- [[_COMMUNITY_Community 60|Community 60]]
- [[_COMMUNITY_Community 61|Community 61]]
- [[_COMMUNITY_Community 62|Community 62]]
- [[_COMMUNITY_Community 64|Community 64]]
- [[_COMMUNITY_Community 70|Community 70]]
- [[_COMMUNITY_Community 72|Community 72]]
- [[_COMMUNITY_Community 73|Community 73]]
- [[_COMMUNITY_Community 76|Community 76]]
- [[_COMMUNITY_Community 77|Community 77]]
- [[_COMMUNITY_Community 78|Community 78]]
- [[_COMMUNITY_Community 79|Community 79]]
- [[_COMMUNITY_Community 88|Community 88]]
- [[_COMMUNITY_Community 90|Community 90]]
- [[_COMMUNITY_Community 94|Community 94]]
- [[_COMMUNITY_Community 95|Community 95]]
- [[_COMMUNITY_Community 99|Community 99]]
- [[_COMMUNITY_Community 100|Community 100]]
- [[_COMMUNITY_Community 101|Community 101]]
- [[_COMMUNITY_Community 102|Community 102]]
- [[_COMMUNITY_Community 104|Community 104]]
- [[_COMMUNITY_Community 110|Community 110]]
- [[_COMMUNITY_Community 123|Community 123]]
- [[_COMMUNITY_Community 126|Community 126]]

## God Nodes (most connected - your core abstractions)
1. `request()` - 112 edges
2. `showToast()` - 59 edges
3. `withProxy()` - 23 edges
4. `userFriendlyError()` - 21 edges
5. `takeFromExternrefTable0()` - 20 edges
6. `SyncClient` - 19 edges
7. `passArray8ToWasm0()` - 18 edges
8. `encryptedUpload()` - 17 edges
9. `toBase64()` - 15 edges
10. `passStringToWasm0()` - 14 edges

## Surprising Connections (you probably didn't know these)
- `request()` --calls--> `opaqueRegisterStart()`  [INFERRED]
  packages/shared/src/api/request.ts → src/lib/api.ts
- `request()` --calls--> `opaqueRegisterStartExisting()`  [INFERRED]
  packages/shared/src/api/request.ts → src/lib/api.ts
- `request()` --calls--> `opaqueRegisterFinishExisting()`  [INFERRED]
  packages/shared/src/api/request.ts → src/lib/api.ts
- `request()` --calls--> `recoverOpaqueRegister()`  [INFERRED]
  packages/shared/src/api/request.ts → src/lib/api.ts
- `request()` --calls--> `verifyEmail()`  [INFERRED]
  packages/shared/src/api/request.ts → src/lib/api.ts

## Communities

### Community 0 - "Community 0"
Cohesion: 0.02
Nodes (135): fireConnectionStatus(), fireErrorNotifier(), fireSessionExpired(), delay(), reportConnection(), request(), load(), acceptWorkspaceInvite() (+127 more)

### Community 1 - "Community 1"
Cohesion: 0.02
Nodes (100): handleResend(), handleVerify(), handleNewFolder(), handleDelete(), handleDownload(), handleRestore(), createFolder(), deleteFile() (+92 more)

### Community 2 - "Community 2"
Cohesion: 0.06
Nodes (47): loadNames(), computeRecoveryCheck(), decryptChunk(), decryptFileMetadata(), decryptFilename(), decryptManyNames(), deriveFileKey(), deriveKeys() (+39 more)

### Community 3 - "Community 3"
Cohesion: 0.09
Nodes (51): addToExternrefTable0(), compute_recovery_check(), debugString(), decodeText(), decrypt_chunk(), decrypt_chunks(), decrypt_metadata(), derive_file_key() (+43 more)

### Community 4 - "Community 4"
Cohesion: 0.04
Nodes (21): BillingBanner(), BillingSuspendedOverlay(), FileList(), if(), timeAgo(), IncidentBanner(), NewFolderDialog(), notificationIcon() (+13 more)

### Community 5 - "Community 5"
Cohesion: 0.07
Nodes (28): getApiUrl(), downloadSharedFile(), downloadVersion(), listFiles(), canStreamToServiceWorker(), createBlobSink(), createSwSink(), downloadAsZip() (+20 more)

### Community 6 - "Community 6"
Cohesion: 0.08
Nodes (31): handleCodeSubmit(), handlePasskeyUnlock(), handleRestore(), base64urlToBuffer(), bufferToBase64url(), credentialToAuthenticationJSON(), credentialToRegistrationJSON(), deletePasskey() (+23 more)

### Community 7 - "Community 7"
Cohesion: 0.09
Nodes (20): uploadThumbnail(), encryptedUpload(), encryptAndUploadThumbnail(), fetchAndDecryptThumbnail(), generateThumbnail(), getCachedBlob(), isImageType(), putCachedBlob() (+12 more)

### Community 8 - "Community 8"
Cohesion: 0.08
Nodes (12): load(), createEmptyIndex(), decryptIndex(), deriveIndexKey(), encryptIndex(), fetchIndex(), saveIndex(), commitQuery() (+4 more)

### Community 9 - "Community 9"
Cohesion: 0.14
Nodes (8): getSyncOps(), submitSyncOps(), getDeviceId(), payloadToNode(), saveLastSeq(), savePendingOps(), SyncClient, uuid()

### Community 10 - "Community 10"
Cohesion: 0.1
Nodes (12): confirmAction(), getSharesForFile(), permanentDeleteFile(), restoreFile(), loadActivity(), buildDetailsMeta(), displayName(), handleRestore() (+4 more)

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
Cohesion: 0.32
Nodes (9): devAutoAuth(), cacheVaultKey(), clearVaultKey(), dbDelete(), dbGet(), dbPut(), getVaultKey(), initSessionVault() (+1 more)

### Community 21 - "Community 21"
Cohesion: 0.2
Nodes (2): dayLabel(), groupByDay()

### Community 26 - "Community 26"
Cohesion: 0.22
Nodes (2): formatEta(), formatSpeed()

### Community 30 - "Community 30"
Cohesion: 0.33
Nodes (5): downloadDropboxFile(), expandDropboxPaths(), expandOne(), rateLimitedFetch(), sleepMs()

### Community 37 - "Community 37"
Cohesion: 0.29
Nodes (3): savePermissions(), setExpiry(), patchInvite()

### Community 38 - "Community 38"
Cohesion: 0.25
Nodes (1): onRegionChanged()

### Community 39 - "Community 39"
Cohesion: 0.29
Nodes (4): copyToClipboard(), handleCopy(), handleRevoke(), revokeShare()

### Community 41 - "Community 41"
Cohesion: 0.29
Nodes (2): pipelineStage(), stageLabel()

### Community 43 - "Community 43"
Cohesion: 0.25
Nodes (3): load(), handleDownloadCiphertext(), downloadFile()

### Community 51 - "Community 51"
Cohesion: 0.29
Nodes (3): ApiError, IncorrectPasswordError, SessionTooOldForConfirmationError

### Community 52 - "Community 52"
Cohesion: 0.38
Nodes (4): expandFolder(), expandGoogleDrivePaths(), GoogleAuthError, listGoogleDriveFolder()

### Community 53 - "Community 53"
Cohesion: 0.38
Nodes (3): getStored(), isValidDensity(), isValidFontSize()

### Community 54 - "Community 54"
Cohesion: 0.29
Nodes (1): decryptAll()

### Community 55 - "Community 55"
Cohesion: 0.38
Nodes (3): consumePendingExport(), getPostLoginPath(), hasPendingExport()

### Community 56 - "Community 56"
Cohesion: 0.38
Nodes (5): allowsFunctional(), getConsent(), hasConsented(), setConsent(), update()

### Community 60 - "Community 60"
Cohesion: 0.33
Nodes (1): ErrorBoundary

### Community 61 - "Community 61"
Cohesion: 0.4
Nodes (2): decodeAndConvert(), pcmToWavBlob()

### Community 62 - "Community 62"
Cohesion: 0.47
Nodes (4): ensureLang(), getHighlighter(), langLabel(), toShikiLang()

### Community 64 - "Community 64"
Cohesion: 0.4
Nodes (2): computeStep(), writeLocalStep()

### Community 70 - "Community 70"
Cohesion: 0.4
Nodes (1): MemoryStorage

### Community 72 - "Community 72"
Cohesion: 0.5
Nodes (2): hashString(), pickIndicesFromPhrase()

### Community 73 - "Community 73"
Cohesion: 0.5
Nodes (2): AnnouncementBanner(), severityClasses()

### Community 76 - "Community 76"
Cohesion: 0.5
Nodes (2): getExtension(), getMimeLabel()

### Community 77 - "Community 77"
Cohesion: 0.4
Nodes (2): ImpersonationBanner(), useImpersonation()

### Community 78 - "Community 78"
Cohesion: 0.7
Nodes (4): FOLDER_COLOR_KEY(), getFolderColor(), getFolderColorDot(), setFolderColor()

### Community 79 - "Community 79"
Cohesion: 0.5
Nodes (2): Avatar(), getInitials()

### Community 88 - "Community 88"
Cohesion: 0.67
Nodes (2): signupAndUnlock(), uniqueEmail()

### Community 90 - "Community 90"
Cohesion: 0.83
Nodes (3): extractDroppedItems(), processEntries(), readDirectoryEntry()

### Community 94 - "Community 94"
Cohesion: 0.5
Nodes (1): poll()

### Community 95 - "Community 95"
Cohesion: 0.83
Nodes (3): getMenuItems(), getPendingItems(), SharedContextMenu()

### Community 99 - "Community 99"
Cohesion: 0.83
Nodes (3): clearTauriSession(), isTauri(), pushTauriSession()

### Community 100 - "Community 100"
Cohesion: 0.5
Nodes (2): handleSubmit(), reportShareLink()

### Community 101 - "Community 101"
Cohesion: 0.5
Nodes (2): ContextMenu(), isPreviewable()

### Community 102 - "Community 102"
Cohesion: 0.83
Nodes (3): downloadAsHtml(), escapeHtml(), generateRecoveryKitPDF()

### Community 104 - "Community 104"
Cohesion: 0.5
Nodes (1): handleLoadMore()

### Community 110 - "Community 110"
Cohesion: 0.67
Nodes (1): ApiError

### Community 123 - "Community 123"
Cohesion: 1.0
Nodes (2): deriveSasWords(), fnv1a()

### Community 126 - "Community 126"
Cohesion: 1.0
Nodes (2): ch(), migratePreferences()

## Knowledge Gaps
- **Thin community `Community 21`** (11 nodes): `actionText()`, `dayLabel()`, `DeviceBadge()`, `groupByDay()`, `isAlarmingEvent()`, `isSecurityEvent()`, `loadingMore()`, `metaFor()`, `timeLabel()`, `wsToActivity()`, `activity.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 26`** (10 nodes): `barColor()`, `borderColor()`, `computeEta()`, `computeSpeed()`, `formatChunkSize()`, `formatEta()`, `formatSpeed()`, `phaseLabel()`, `regionLabel()`, `upload-progress-card.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 38`** (8 nodes): `formatStorageSI()`, `onDown()`, `onFileUploaded()`, `onKey()`, `onRegionChanged()`, `pruned()`, `PwaInstallBanner()`, `drive-layout.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 41`** (8 nodes): `computeEta()`, `computeSpeed()`, `formatBytes()`, `formatEta()`, `formatSpeed()`, `pipelineStage()`, `stageLabel()`, `upload-progress.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 54`** (7 nodes): `decryptAll()`, `displayName()`, `handleBreadcrumbNav()`, `handleConfirm()`, `handleFolderOpen()`, `handleKey()`, `move-modal.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 60`** (6 nodes): `ErrorBoundary`, `.componentDidCatch()`, `.constructor()`, `.getDerivedStateFromError()`, `.render()`, `error-boundary.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 61`** (6 nodes): `decodeAndConvert()`, `formatTime()`, `handleSeek()`, `pcmToWavBlob()`, `togglePlay()`, `audio-preview.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 64`** (6 nodes): `computeStep()`, `OnboardingProvider()`, `readLocalStep()`, `useOnboarding()`, `writeLocalStep()`, `onboarding-context.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 70`** (5 nodes): `MemoryStorage`, `.getItem()`, `.removeItem()`, `.setItem()`, `export-intent.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 72`** (5 nodes): `handleChange()`, `handleVerify()`, `hashString()`, `pickIndicesFromPhrase()`, `mnemonic-verify.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 73`** (5 nodes): `AnnouncementBanner()`, `readDismissed()`, `severityClasses()`, `writeDismissed()`, `announcement-banner.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 76`** (5 nodes): `formatSize()`, `getExtension()`, `getMimeLabel()`, `handleDownload()`, `unsupported-preview.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 77`** (5 nodes): `ImpersonationBanner()`, `ImpersonationProvider()`, `useImpersonation()`, `impersonation-banner.tsx`, `impersonation-context.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 79`** (5 nodes): `Avatar()`, `formatRelativeDate()`, `getInitials()`, `SecuredBadge()`, `public-profile.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 88`** (4 nodes): `escapeRegex()`, `signupAndUnlock()`, `refresh-stability.spec.ts`, `uniqueEmail()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 94`** (4 nodes): `colourFor()`, `initials()`, `poll()`, `presence-avatars.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 100`** (4 nodes): `handleKeyDown()`, `handleSubmit()`, `reportShareLink()`, `report-dialog.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 101`** (4 nodes): `ContextMenu()`, `isPreviewable()`, `context-menu.tsx`, `preview.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 104`** (4 nodes): `actionMeta()`, `handleLoadMore()`, `relativeTime()`, `activity.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 110`** (3 nodes): `ApiError`, `.constructor()`, `encrypted-upload-v2-contract.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 123`** (3 nodes): `deriveSasWords()`, `fnv1a()`, `sas-words.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 126`** (3 nodes): `ch()`, `migratePreferences()`, `notifications.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `formatBytes()` connect `Community 1` to `Community 4`?**
  _High betweenness centrality (0.077) - this node is a cross-community bridge._
- **Why does `FileList()` connect `Community 4` to `Community 1`?**
  _High betweenness centrality (0.075) - this node is a cross-community bridge._
- **Why does `handleFolderFilesSelected()` connect `Community 1` to `Community 7`?**
  _High betweenness centrality (0.063) - this node is a cross-community bridge._
- **Are the 109 inferred relationships involving `request()` (e.g. with `getApiUrl()` and `fireErrorNotifier()`) actually correct?**
  _`request()` has 109 INFERRED edges - model-reasoned connections that need verification._
- **Are the 55 inferred relationships involving `showToast()` (e.g. with `handleSubmit()` and `handleVerify()`) actually correct?**
  _`showToast()` has 55 INFERRED edges - model-reasoned connections that need verification._
- **Are the 18 inferred relationships involving `userFriendlyError()` (e.g. with `handleResend()` and `handleToggleStar()`) actually correct?**
  _`userFriendlyError()` has 18 INFERRED edges - model-reasoned connections that need verification._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.02 - nodes in this community are weakly interconnected._