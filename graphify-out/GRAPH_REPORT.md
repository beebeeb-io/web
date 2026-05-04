# Graph Report - web  (2026-05-04)

## Corpus Check
- 208 files · ~997,379 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2007 nodes · 3980 edges · 30 communities detected
- Extraction: 93% EXTRACTED · 7% INFERRED · 0% AMBIGUOUS · INFERRED: 292 edges (avg confidence: 0.8)
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
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 46|Community 46]]
- [[_COMMUNITY_Community 47|Community 47]]
- [[_COMMUNITY_Community 48|Community 48]]
- [[_COMMUNITY_Community 53|Community 53]]
- [[_COMMUNITY_Community 56|Community 56]]
- [[_COMMUNITY_Community 65|Community 65]]
- [[_COMMUNITY_Community 66|Community 66]]
- [[_COMMUNITY_Community 69|Community 69]]
- [[_COMMUNITY_Community 85|Community 85]]
- [[_COMMUNITY_Community 87|Community 87]]

## God Nodes (most connected - your core abstractions)
1. `request()` - 103 edges
2. `BE()` - 98 edges
3. `Z6()` - 48 edges
4. `Gt()` - 31 edges
5. `f()` - 29 edges
6. `Rt()` - 29 edges
7. `Ie()` - 29 edges
8. `Rn()` - 27 edges
9. `Ut()` - 27 edges
10. `a()` - 26 edges

## Surprising Connections (you probably didn't know these)
- `withNetworkRetry()` --calls--> `FN()`  [INFERRED]
  src/lib/encrypted-upload.ts → beebeeb@178.104.187.126/assets/index-CMw3MU9g.js
- `AndroidKeyboard()` --calls--> `Row()`  [INFERRED]
  design/hifi/android-frame.jsx → src/components/share-activity.tsx
- `IOSKeyboard()` --calls--> `Row()`  [INFERRED]
  design/hifi/ios-frame.jsx → src/components/share-activity.tsx
- `Prompt()` --calls--> `handleCreateWorkspace()`  [INFERRED]
  design/hifi/hifi-cli.jsx → src/pages/team.tsx
- `If()` --calls--> `RoleChip()`  [INFERRED]
  beebeeb@178.104.187.126/assets/index-CMw3MU9g.js → src/pages/team.tsx

## Communities

### Community 0 - "Community 0"
Cohesion: 0.01
Nodes (304): _2(), $3(), _8(), a2(), a3(), a4(), a8(), AA() (+296 more)

### Community 1 - "Community 1"
Cohesion: 0.01
Nodes (179): formatBytes(), handleCreatePool(), handleReconcile(), saveEdit(), applyAbuseDecision(), handleExport(), handleInvite(), handleRemove() (+171 more)

### Community 2 - "Community 2"
Cohesion: 0.03
Nodes (95): checkDpaStatus(), handleUpload(), load(), load(), decryptAll(), decryptAll(), handleNewFolder(), handleDownloadCiphertext() (+87 more)

### Community 3 - "Community 3"
Cohesion: 0.03
Nodes (113): AS(), av(), BE(), bF(), bs(), bv(), c8(), constructor() (+105 more)

### Community 4 - "Community 4"
Cohesion: 0.03
Nodes (52): $_(), _0(), _5, A5(), addPostProcessor(), AF(), aj, Am() (+44 more)

### Community 5 - "Community 5"
Cohesion: 0.04
Nodes (30): ab(), bj(), bo(), cj(), fj, Fo(), gj(), handle() (+22 more)

### Community 6 - "Community 6"
Cohesion: 0.06
Nodes (81): $(), a(), B(), C(), D(), E(), ee(), f() (+73 more)

### Community 7 - "Community 7"
Cohesion: 0.06
Nodes (36): bk(), bN(), cp, D3(), gk(), hk(), kA, lx() (+28 more)

### Community 8 - "Community 8"
Cohesion: 0.06
Nodes (23): _7(), e2(), ek(), f7(), g2(), Hx(), If(), ik() (+15 more)

### Community 9 - "Community 9"
Cohesion: 0.07
Nodes (11): notificationIcon(), toDisplay(), useNotifications(), useToast(), useKeyboardShortcuts(), useSearchIndex(), useWebSocket(), useWsEvent() (+3 more)

### Community 10 - "Community 10"
Cohesion: 0.14
Nodes (8): getSyncOps(), submitSyncOps(), getDeviceId(), payloadToNode(), saveLastSeq(), savePendingOps(), SyncClient, uuid()

### Community 11 - "Community 11"
Cohesion: 0.11
Nodes (3): Row(), AndroidKeyboard(), IOSKeyboard()

### Community 12 - "Community 12"
Cohesion: 0.19
Nodes (13): A(), C(), d(), F(), H(), I(), j(), p() (+5 more)

### Community 13 - "Community 13"
Cohesion: 0.18
Nodes (4): commitQuery(), handleSubmit(), loadRecent(), saveRecent()

### Community 14 - "Community 14"
Cohesion: 0.14
Nodes (2): restoreFile(), handleRestore()

### Community 16 - "Community 16"
Cohesion: 0.18
Nodes (3): handleCheckboxClick(), handleRowClick(), toggleSelection()

### Community 19 - "Community 19"
Cohesion: 0.4
Nodes (10): clearVault(), computeKeyCheck(), dbClear(), dbGet(), dbPut(), deriveWrappingKey(), hasVault(), openDB() (+2 more)

### Community 27 - "Community 27"
Cohesion: 0.28
Nodes (5): handleCodeSubmit(), handleRestore(), decryptFromQr(), deriveQrKey(), encryptForQr()

### Community 33 - "Community 33"
Cohesion: 0.29
Nodes (2): pipelineStage(), stageLabel()

### Community 42 - "Community 42"
Cohesion: 0.38
Nodes (3): getStored(), isValidDensity(), isValidFontSize()

### Community 46 - "Community 46"
Cohesion: 0.33
Nodes (1): ErrorBoundary

### Community 47 - "Community 47"
Cohesion: 0.33
Nodes (3): NewFolderDialog(), RenameDialog(), useFocusTrap()

### Community 48 - "Community 48"
Cohesion: 0.73
Nodes (5): colorKeywords(), colorLine(), colorTokens(), esc(), isInsideString()

### Community 53 - "Community 53"
Cohesion: 0.4
Nodes (2): ImpersonationBanner(), useImpersonation()

### Community 56 - "Community 56"
Cohesion: 0.5
Nodes (2): dayLabel(), groupByDay()

### Community 65 - "Community 65"
Cohesion: 0.67
Nodes (2): signupAndUnlock(), uniqueEmail()

### Community 66 - "Community 66"
Cohesion: 0.83
Nodes (3): extractDroppedItems(), processEntries(), readDirectoryEntry()

### Community 69 - "Community 69"
Cohesion: 0.83
Nodes (3): getMenuItems(), getPendingItems(), SharedContextMenu()

### Community 85 - "Community 85"
Cohesion: 1.0
Nodes (2): deriveSasWords(), fnv1a()

### Community 87 - "Community 87"
Cohesion: 1.0
Nodes (2): formatBytes(), formatStorageSI()

## Knowledge Gaps
- **Thin community `Community 14`** (14 nodes): `restoreFile()`, `ConfirmDeleteDialog()`, `daysUntilShred()`, `displayName()`, `executePermanentDelete()`, `getIconForName()`, `handleRestore()`, `handleRestoreAll()`, `requestDeleteSelected()`, `requestEmptyTrash()`, `requestPermanentDelete()`, `timeAgo()`, `toggleSelect()`, `trash.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 33`** (8 nodes): `computeEta()`, `computeSpeed()`, `formatBytes()`, `formatEta()`, `formatSpeed()`, `pipelineStage()`, `stageLabel()`, `upload-progress.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 46`** (6 nodes): `ErrorBoundary`, `.componentDidCatch()`, `.constructor()`, `.getDerivedStateFromError()`, `.render()`, `error-boundary.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 53`** (5 nodes): `ImpersonationBanner()`, `ImpersonationProvider()`, `useImpersonation()`, `impersonation-banner.tsx`, `impersonation-context.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 56`** (5 nodes): `dayLabel()`, `groupByDay()`, `metaFor()`, `timeLabel()`, `activity.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 65`** (4 nodes): `escapeRegex()`, `signupAndUnlock()`, `refresh-stability.spec.ts`, `uniqueEmail()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 85`** (3 nodes): `deriveSasWords()`, `fnv1a()`, `sas-words.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 87`** (3 nodes): `formatBytes()`, `formatStorageSI()`, `format.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `encryptedUpload()` connect `Community 2` to `Community 1`?**
  _High betweenness centrality (0.229) - this node is a cross-community bridge._
- **Why does `FN()` connect `Community 0` to `Community 2`, `Community 5`, `Community 6`?**
  _High betweenness centrality (0.225) - this node is a cross-community bridge._
- **Why does `withNetworkRetry()` connect `Community 2` to `Community 0`?**
  _High betweenness centrality (0.224) - this node is a cross-community bridge._
- **Are the 8 inferred relationships involving `Z6()` (e.g. with `V()` and `H()`) actually correct?**
  _`Z6()` has 8 INFERRED edges - model-reasoned connections that need verification._
- **Are the 12 inferred relationships involving `f()` (e.g. with `X6()` and `J6()`) actually correct?**
  _`f()` has 12 INFERRED edges - model-reasoned connections that need verification._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.01 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.01 - nodes in this community are weakly interconnected._