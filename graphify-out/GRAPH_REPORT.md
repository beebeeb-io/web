# Graph Report - web  (2026-05-04)

## Corpus Check
- 198 files · ~987,787 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1967 nodes · 3930 edges · 31 communities detected
- Extraction: 93% EXTRACTED · 7% INFERRED · 0% AMBIGUOUS · INFERRED: 287 edges (avg confidence: 0.8)
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
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 47|Community 47]]
- [[_COMMUNITY_Community 48|Community 48]]
- [[_COMMUNITY_Community 49|Community 49]]
- [[_COMMUNITY_Community 55|Community 55]]
- [[_COMMUNITY_Community 56|Community 56]]
- [[_COMMUNITY_Community 64|Community 64]]
- [[_COMMUNITY_Community 67|Community 67]]
- [[_COMMUNITY_Community 77|Community 77]]
- [[_COMMUNITY_Community 84|Community 84]]
- [[_COMMUNITY_Community 86|Community 86]]

## God Nodes (most connected - your core abstractions)
1. `BE()` - 98 edges
2. `request()` - 89 edges
3. `Z6()` - 48 edges
4. `Gt()` - 31 edges
5. `f()` - 29 edges
6. `Rt()` - 29 edges
7. `Ie()` - 29 edges
8. `Rn()` - 27 edges
9. `Ut()` - 27 edges
10. `a()` - 26 edges

## Surprising Connections (you probably didn't know these)
- `AndroidKeyboard()` --calls--> `Row()`  [INFERRED]
  design/hifi/android-frame.jsx → src/components/share-activity.tsx
- `IOSKeyboard()` --calls--> `Row()`  [INFERRED]
  design/hifi/ios-frame.jsx → src/components/share-activity.tsx
- `Prompt()` --calls--> `handleCreateWorkspace()`  [INFERRED]
  design/hifi/hifi-cli.jsx → src/pages/team.tsx
- `If()` --calls--> `RoleChip()`  [INFERRED]
  beebeeb@178.104.187.126/assets/index-CMw3MU9g.js → src/pages/team.tsx
- `o()` --calls--> `yB()`  [INFERRED]
  beebeeb@178.104.187.126/assets/crypto.worker-Cv8WsXzL.js → beebeeb@178.104.187.126/assets/index-CMw3MU9g.js

## Communities

### Community 0 - "Community 0"
Cohesion: 0.01
Nodes (329): _2(), $3(), _7(), a2(), a3(), a4(), a8(), AA() (+321 more)

### Community 1 - "Community 1"
Cohesion: 0.01
Nodes (166): formatBytes(), handleCreatePool(), handleDecommission(), handleMigrateAll(), handleReconcile(), saveEdit(), applyAbuseDecision(), handleExport() (+158 more)

### Community 2 - "Community 2"
Cohesion: 0.03
Nodes (88): checkDpaStatus(), handleUpload(), load(), load(), decryptAll(), decryptAll(), handleNewFolder(), handleDownloadCiphertext() (+80 more)

### Community 3 - "Community 3"
Cohesion: 0.04
Nodes (64): $_(), _5, A5(), addPostProcessor(), AF(), aj, aT(), bt() (+56 more)

### Community 4 - "Community 4"
Cohesion: 0.06
Nodes (75): $(), a(), B(), C(), D(), E(), ee(), f() (+67 more)

### Community 5 - "Community 5"
Cohesion: 0.05
Nodes (25): ab(), bo(), cj(), Fo(), gj(), handle(), hb(), Ie() (+17 more)

### Community 6 - "Community 6"
Cohesion: 0.04
Nodes (75): AS(), av(), b3(), BE(), bs(), bv(), constructor(), cv() (+67 more)

### Community 7 - "Community 7"
Cohesion: 0.06
Nodes (20): _0(), _8(), bB(), EB(), ej(), Ex(), gB(), iv() (+12 more)

### Community 8 - "Community 8"
Cohesion: 0.06
Nodes (32): a(), bN(), cp, hA(), j8(), k4(), kA, lx() (+24 more)

### Community 9 - "Community 9"
Cohesion: 0.07
Nodes (11): notificationIcon(), toDisplay(), useNotifications(), useToast(), useKeyboardShortcuts(), useSearchIndex(), useWebSocket(), useWsEvent() (+3 more)

### Community 10 - "Community 10"
Cohesion: 0.14
Nodes (8): getSyncOps(), submitSyncOps(), getDeviceId(), payloadToNode(), saveLastSeq(), savePendingOps(), SyncClient, uuid()

### Community 11 - "Community 11"
Cohesion: 0.08
Nodes (6): restoreFile(), commitQuery(), handleSubmit(), loadRecent(), saveRecent(), handleRestore()

### Community 12 - "Community 12"
Cohesion: 0.08
Nodes (9): If(), Prompt(), removeWorkspaceMember(), updateMemberRole(), handleCreateWorkspace(), handleInvite(), handleRemove(), handleRoleChange() (+1 more)

### Community 13 - "Community 13"
Cohesion: 0.19
Nodes (9): bF(), dz(), ew(), fF(), Mx(), Nf(), qT(), tp() (+1 more)

### Community 14 - "Community 14"
Cohesion: 0.11
Nodes (3): Row(), AndroidKeyboard(), IOSKeyboard()

### Community 15 - "Community 15"
Cohesion: 0.19
Nodes (13): A(), C(), d(), F(), H(), I(), j(), p() (+5 more)

### Community 17 - "Community 17"
Cohesion: 0.18
Nodes (3): handleCheckboxClick(), handleRowClick(), toggleSelection()

### Community 20 - "Community 20"
Cohesion: 0.4
Nodes (10): clearVault(), computeKeyCheck(), dbClear(), dbGet(), dbPut(), deriveWrappingKey(), hasVault(), openDB() (+2 more)

### Community 28 - "Community 28"
Cohesion: 0.28
Nodes (5): handleCodeSubmit(), handleRestore(), decryptFromQr(), deriveQrKey(), encryptForQr()

### Community 34 - "Community 34"
Cohesion: 0.29
Nodes (2): pipelineStage(), stageLabel()

### Community 43 - "Community 43"
Cohesion: 0.38
Nodes (3): getStored(), isValidDensity(), isValidFontSize()

### Community 47 - "Community 47"
Cohesion: 0.33
Nodes (1): ErrorBoundary

### Community 48 - "Community 48"
Cohesion: 0.33
Nodes (3): NewFolderDialog(), RenameDialog(), useFocusTrap()

### Community 49 - "Community 49"
Cohesion: 0.73
Nodes (5): colorKeywords(), colorLine(), colorTokens(), esc(), isInsideString()

### Community 55 - "Community 55"
Cohesion: 0.4
Nodes (2): ImpersonationBanner(), useImpersonation()

### Community 56 - "Community 56"
Cohesion: 0.5
Nodes (2): dayLabel(), groupByDay()

### Community 64 - "Community 64"
Cohesion: 0.83
Nodes (3): extractDroppedItems(), processEntries(), readDirectoryEntry()

### Community 67 - "Community 67"
Cohesion: 0.83
Nodes (3): getMenuItems(), getPendingItems(), SharedContextMenu()

### Community 77 - "Community 77"
Cohesion: 0.67
Nodes (1): wA

### Community 84 - "Community 84"
Cohesion: 1.0
Nodes (2): deriveSasWords(), fnv1a()

### Community 86 - "Community 86"
Cohesion: 1.0
Nodes (2): formatBytes(), formatStorageSI()

## Knowledge Gaps
- **Thin community `Community 34`** (8 nodes): `computeEta()`, `computeSpeed()`, `formatBytes()`, `formatEta()`, `formatSpeed()`, `pipelineStage()`, `stageLabel()`, `upload-progress.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 47`** (6 nodes): `ErrorBoundary`, `.componentDidCatch()`, `.constructor()`, `.getDerivedStateFromError()`, `.render()`, `error-boundary.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 55`** (5 nodes): `ImpersonationBanner()`, `ImpersonationProvider()`, `useImpersonation()`, `impersonation-banner.tsx`, `impersonation-context.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 56`** (5 nodes): `dayLabel()`, `groupByDay()`, `metaFor()`, `timeLabel()`, `activity.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 77`** (3 nodes): `wA`, `.constructor()`, `.setup()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 84`** (3 nodes): `deriveSasWords()`, `fnv1a()`, `sas-words.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 86`** (3 nodes): `formatBytes()`, `formatStorageSI()`, `format.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `If()` connect `Community 12` to `Community 0`, `Community 6`?**
  _High betweenness centrality (0.211) - this node is a cross-community bridge._
- **Why does `handleCreateWorkspace()` connect `Community 12` to `Community 1`?**
  _High betweenness centrality (0.078) - this node is a cross-community bridge._
- **Are the 8 inferred relationships involving `Z6()` (e.g. with `V()` and `H()`) actually correct?**
  _`Z6()` has 8 INFERRED edges - model-reasoned connections that need verification._
- **Are the 12 inferred relationships involving `f()` (e.g. with `X6()` and `J6()`) actually correct?**
  _`f()` has 12 INFERRED edges - model-reasoned connections that need verification._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.01 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.01 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.03 - nodes in this community are weakly interconnected._