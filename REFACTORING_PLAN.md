# Siteboard リファクタリング計画

> 作業用ドキュメント（恒久仕様ではないため `docs/agents/` には置かない）。
> セッションをまたいで参照・更新する。完了したフェーズは「進捗トラッカー」にチェックを入れる。
> 最終更新: 2026-06-01 / レビュー: Claude + Explore agent + Codex(gpt-5.5) の3者所見を統合

---

## 背景と現状

コードベース全体は約13,000行（フロント TS/TSX 約10,200 + Rust 約3,100）。規模自体は巨大ではないが、**少数の巨大ファイルにロジックが極端に集中**している。

| ファイル | 行数 | 性質 |
|---|---|---|
| `src/components/Siteboard/Siteboard.tsx` | 1,634 | God Component |
| `src/hooks/siteboard/useSiteboardDisplayEngine.ts` | 1,443 | 暗黙の状態機械 |
| `src/store/tab-store.ts` | 1,044 | reducer+cache+history+placement 混在 |
| `src-tauri/src/lib.rs` | 884 | menu+app_exit+setup 混在 |
| `src-tauri/src/commands/store.rs` | 872 | document_manager+window+file+tab 混在 |
| `src-tauri/src/commands/webview.rs` | 742 | platform 分岐重複 |

**本質的な問題（3者一致）**: 巨大さそのものより、上記4者（Siteboard / DisplayEngine / store / Rust IPC）が **暗黙の状態遷移契約で密結合**している点。副作用を囲い込み、純粋関数化できる箇所から段階的に切り出すのが正攻法。

**最大の制約**: テストフレームワーク未導入（CLAUDE.md 明記）。特に Display Engine は手動でしか挙動保証できない。

---

## 設計原則（全フェーズ共通）

1. **挙動完全保存（behavior-preserving）**。各ステップ後に `npm run lint` / `npm run format` / `npm run typecheck` + 手動シナリオが green であること。
2. **1 PR = 1 責務抽出**。大きな一括変更はしない。単独で revert 可能に保つ。
3. **抽出は「移動」から**。まずシグネチャを変えずに移し、整理・最適化は別ステップ。
4. **低リスク → 高リスクの順**。Display Engine は最後。
5. **履歴あり/なしの変更を型で区別**（Codex 提案）。`updateNodeSizeWithoutHistory` 系の散在を型レベルで安全化する。
6. ドキュメント（`docs/agents`）は変更と同じコミットで更新（CLAUDE.md 規約）。

---

## フェーズ 0: 即時修正 & 安全網（着手前提）

### 0-1. 🔴 NUL バイト除去（最優先・1行・検証済みの実在負債）
- **場所**: `useSiteboardDisplayEngine.ts:1398`
  ```ts
  const selectionKey = selectedNodeIds.join('\x00'); // セパレータが生のNULバイト(0x00)
  ```
- **症状**: `file` が `charset=binary` 判定。git/grep/rg がこのファイルを**バイナリ扱い**し、検索・diff・静的解析を阻害。
- **修正**: UUID 結合のため区切りは安全。`join(' ')` か `join(',')` に変更（生 NUL を埋め込まない）。
- **リスク**: ほぼゼロ。

### 0-2. 🔴 z-order の Undo バグ修正（決定済み: バグとして修正）
- **場所**: `tab-store.ts:634-723`（`bringNodeToFront`/`sendNodeToBack`/`bringNodeForward`/`sendNodeBackward`）
- **事実**: これらは `pushHistory` を通さず直接 `set`。**重なり順変更が Undo/Redo 対象外**になっている。
- **根拠**: `domain-models.md:141` が「配列更新操作は基本的に履歴へ記録（例外は自動高さのみ）」と明記。同グループ（L57）の `pinWebNodeUrl` は履歴記録経由なのに z-order だけ外れており不整合。z-order は `nodes` 配列順を変え `.siteboard` に永続化される。
- **修正**: 4操作を `replaceProjectNodes`（既定 `'record'`）経由に切り替え、履歴記録 → Undo/Redo 可能化。
- **リスク**: 低。**回帰確認**: 重なり順変更 → Cmd+Z で元の順序に戻ること。

### 0-3. 回帰チェックリスト作成（一時ファイル、docs には残さない）
`siteboard-runtime.md` から手動検証手順を抽出。最低限のシナリオ:
1. ノード追加 → センタリングアニメ
2. pan / zoom 中のスクショ降格・復帰
3. リサイズ → native webview 復帰 + 再キャプチャ
4. ノード/エッジ右クリックメニュー
5. 複数選択ドラッグ + 単独ドラッグの位置補正
6. Undo / Redo（ノード・エッジ・サイズ）
7. タブ/ウィンドウ open / close / save / save-as
8. テーマ切替（Light/Dark/System）
9. 起動時スクショ復元・白画面が出ないこと

### 0-4. Vitest 最小導入（決定済み: 導入する）
純ロジック（placement / viewport mode / history reducer / edge 操作）だけ単体テスト可能にする。**フェーズ1の純関数抽出と同時に**入れる（抽出した関数にそのままテストを付ける）。
- `vitest` を devDependency に追加、`vite.config.mts` に `test` 設定、`npm run test` スクリプト追加。
- まずは `siteboard-placement` / `project-history` / `display-engine/mode` の純関数からテスト作成。
- CLAUDE.md「テストフレームワーク未導入」の記述と `docs/agents/workflow.md` を同コミットで更新する。
- E2E（Playwright 等）は今回スコープ外（Tauri webview 環境のセットアップコストが高いため見送り）。

---

## フェーズ 1: 純粋関数抽出 + tab-store 分割（低リスク・最初の本格対象）

> Codex 推奨により tab-store を最初の本格対象に格上げ（純関数が多く最も安全）。

### 1-1. 横断的重複の除去
- **デバッグ utils 統合**: `roundDebugValue` / `serializeRect` / `readCanvasZoomDebugValue` / `logXxxDebug` が `useSiteboardDisplayEngine.ts` と `useWebPageWebviewLifecycle.ts` に**完全コピペ**。
  - 新規 `src/lib/webview-debug.ts` に集約。`createScopedLogger(scope)` でロガー生成。

### 1-2. tab-store の純粋関数抽出
- **`src/lib/siteboard-placement.ts`**（新規）: `findNonOverlappingPosition` / `isVerticalOverlapping` / `isHorizontalOverlapping`（現 `tab-store.ts:176-256`）を移動。純関数なので単体テスト可。
- **`src/store/project-history.ts`**（新規）: `pushHistory` / `cloneNodes` / `cloneEdges` / `cloneSnapshot` / 履歴 reducer（現 `tab-store.ts:137-270, 991-1036`）を移動。

### 1-3. tab-store のヘルパー集約 + 型による履歴区別
- **`patchNode(nodes, nodeId, patch)` 汎用ヘルパー**: 「changed フラグ + map + 該当 id 以外 return」パターン（15+ 箇所）を集約。
- **`omitKeys(record, ids)` ヘルパー**: `webviewRuntime` クリーンアップの `Object.fromEntries(filter)` 重複（`changeWebNodeUrl`/`removeNode`/`removeNodes`/`clearWebNodeWebviewLabel`/`clearProjectScreenshotUrl`）を置換。
- **履歴あり/なしを型で分離**: `replaceProjectNodes` の `historyMode: 'record' | 'skip'` を、呼び分けが型で強制される reducer 風 API に。`updateNodeSizeWithoutHistory` 系の事故を防ぐ。

### 1-4. tab-store の slice 分割（決定済み: 今回は行わない）
純関数抽出（1-2）とヘルパー集約（1-3）で tab-store は十分に痩せる（推定 -250〜300行）と判断。**Zustand slice 分割は store 構造変更のリスク・工数に見合わないため今回スコープ外**とする。将来必要になれば別途検討。

**完了基準**: tab-store 推定 -250〜300行。全シナリオ green。

---

## フェーズ 2: Rust の低リスク改善（フロントと並行可）

### 2-1. `webview.rs` の DRY 化
- `top_inset` 計算の**4箇所重複**（`create_page_webview` / `update_page_webview_bounds` / `batch_update_page_webview_bounds` / `batch_update_webview_positions` 付近）を
  `fn platform_top_inset(window: &Window) -> Result<f64, String>` に集約。

---

## フェーズ 3: `Siteboard.tsx` のフック抽出（中リスク・純リファクタ）

state/ref とハンドラをセットで移動。本体は `<ReactFlow>` 配線 + フック合成に縮小。依存の少ない順。

| 順 | 抽出先（新規フック） | 移動対象（現 Siteboard.tsx の主な箇所） | リスク |
|---|---|---|---|
| 3-1 | `useSiteboardViewportController` | `handleViewportChange`(1092) / `syncViewportFromStore`(1128) / zoom/fit/reset 群(1255-1316) / move 系(1200-1227) / `--canvas-zoom` 初期化(1153) / `registerViewCommandHandlers`(1327)。**`uiZoom`/`getZoom` を返す** | 中 |
| 3-2 | `useSiteboardContextMenus` | `handleNodeContextMenu`(857, 約110行) / `handleEdgeContextMenu`(821) | 中 |
| 3-3 | `useSiteboardResize` | `stickyResizing`/`webPageResizing`/`textResizing` state と各 `handleXxxResize*` | 中 |
| 3-4 | `useSiteboardTextEditing` | `editingTextNodeId`/`editingUrlNodeId` / autoEdit effect / 空テキスト自動削除 effect / `handleTextNode*` / `handleChangeUrlSubmit` | 中 |
| 3-5 | `useSiteboardDrag` | `draggingNodePositions` / `positionCorrectionAnimations`(+ref+seq) / `handleNodeDragStart/Stop` / `handleTitlePointerDown`(1001, 手動ドラッグ約90行) / `handleNodeActivate` | 中〜高 |
| 3-6 | `buildFlowNodes()` 純関数 + `useSiteboardSelection` | `flowNodes` useMemo(1338, 約150行) を `buildStickyFlowNode`/`buildTextFlowNode`/`buildWebPageFlowNode` に分割。`flowEdges`/`handleNodesChange`/`handleEdgesChange`/`selectedEdgeIds` | 高（top-level width/height・measured のちらつき罠あり。`coding-rules.md` 参照） |

**完了後の `Siteboard.tsx`**: 推定 300〜400行。

---

## フェーズ 4: Rust モジュール分割（中リスク・フロントと独立）

```
src-tauri/src/
  app_exit.rs                    … AppExitCoordinatorState + 終了フロー（現 lib.rs:56-123 等）
  setup.rs                       … app setup / invoke_handler 登録（現 lib.rs:719-）
  menus/{app,file,edit,view,theme}.rs … メニュー構築・イベント配信
  menus/helpers.rs               … find_submenu / remove_items_matching を predicate ベースに統一
  menus/macos.rs                 … #[cfg(macos)] NSMenuItem/About/Hide 操作

  commands/store/document_manager.rs … ウィンドウレコード・ラベル採番・untitled_index
  commands/store/document_window.rs  … window factory（reserve→build→configure→present）
  commands/store/file_io.rs          … load/save .siteboard、filePath 競合チェック
  commands/store/macos_tabs.rs       … #[cfg(macos)] タブ attach

  commands/webview/navigation.rs … back/forward/reload/nav state
  commands/webview/bounds.rs     … bounds/opacity/batch 更新
  commands/webview/screenshots.rs … capture/save/delete/get_existing（既存 snapshot.rs と統合検討）
  commands/webview/labels.rs     … scoped_page_label / resolve_page_webview
```
- `tauri-ipc.md` を同コミットで更新。
- IPC コマンド粒度の見直し（bounds 更新が3コマンド、screenshot が4コマンド）は別途検討。

---

## フェーズ 5: Display Engine の段階的再設計（最高リスク・最後）

> 前提: フェーズ0のチェックリストが揃い、フェーズ1・3が安定していること。
> ここだけ「移動」でなく構造変更を伴う。20個超の ref で状態機械が未表現なのが核心。

### 5-1. 純粋判定の拡充（まず安全な所から）
- `display-engine/mode.ts` の `resolveViewportDisplayMode` 系のような**純粋判定関数を増やす**。表示モード決定ロジックを ref 依存から引き剥がす。

### 5-2. ScreenshotCaptureQueue 抽出
- `captureScreenshot`(805) のキュー制御、`screenshotUrls`/`screenshotReadyRef`/`presentedScreenshotUrlRef`/`waitForScreenshotPresentation`/`handleScreenshotPresented`/復元 effect を `useScreenshotCaptureQueue` へ。シグネチャ不変で切り出し。

### 5-3. NativeRevealController 抽出
- native reveal 系（`cancelNativeReveal`/`cancelAllNativeReveals`/トークン管理）、`hideNodeWebview`、opacity 制御を `nativeRevealController` へ。macOS 白フラッシュ回避を一箇所に集約。

### 5-4. DisplayModeResolver の共通化
- `computeDisplayModes`(449) / `applyPreparedInteractionModes`(661) / `computeInteractionModes`(719) の**同型構造（label→rect→mode→hide）を1コアに集約**し、差分（操作中か否か・降格条件）をパラメータ化。

### 5-5. （任意・要相談）状態機械化
- ref 散在状態を `displayModeReducer` / 型付き遷移へ。回帰リスク最大。**5-1〜5-4 が安定し、テストが入ってから判断**。現時点では推奨しない。

---

## 推奨実施順序とリスクマップ

| 順 | 内容 | リスク | 独立性 |
|---|---|---|---|
| 1 | 0-1 NUL バイト除去 | 極小 | 高 |
| 2 | 0-2 z-order Undo バグ修正 | 低 | 高 |
| 3 | 0-3 チェックリスト + 0-4 Vitest 最小導入 | 低 | 高 |
| 4 | 1-1 横断重複除去 | 低 | 高 |
| 5 | 1-2/1-3 tab-store 純関数抽出+ヘルパー（+テスト） | 低 | 高 |
| 6 | 2-1 Rust top_inset | 低 | 高 |
| 7 | 3-1 ViewportController | 中 | 高 |
| 8 | 3-2/3-3/3-4 ContextMenu/Resize/TextEditing | 中 | 中 |
| 9 | 3-5 Drag | 中高 | 中 |
| 10 | 3-6 buildFlowNodes/Selection | 高 | 低 |
| 11 | 4 Rust モジュール分割 | 中 | 高 |
| 12 | 5 Display Engine 再設計 | 最高 | 低 |

---

## 進捗トラッカー（セッションをまたいで更新）

- [x] 0-1 NUL バイト除去 ✅ `useSiteboardDisplayEngine.ts:1398` の生NUL→空白
- [x] 0-2 z-order Undo バグ修正 ✅ 4操作を replaceProjectNodes 経由に + domain-models.md 更新
- [x] 0-3 回帰チェックリスト作成 ✅ 本計画 0-3 を正本とする
- [x] 0-4 Vitest 最小導入 ✅ vitest@2.1.9 / vitest.config.mts / `npm run test`
- [x] 1-1 デバッグ utils 統合 ✅ `src/lib/webview-debug.ts` に集約（2ファイルの重複除去）
- [x] 1-2 tab-store 純関数抽出 ✅ `siteboard-placement.ts` / `project-history.ts` + テスト計8件
- [x] 1-3 patchNode / omitKeys / 履歴型分離 ✅ tab-store 1044→852行。replaceProjectNodes を record/without-history に分離
- [x] ~~1-4 tab-store slice 分割~~ → 今回スコープ外（決定済み）

### 検証ログ
- 0-1〜1-2（commit 9cf112e）: test 8 / typecheck / lint / format すべて OK。push 済み。
- 1-3（未コミット）: test 15 / typecheck / lint / format すべて OK。
- ⚠️ 手動シナリオ（0-3 チェックリスト）は未実施。`npm run dev` でのビルド系挙動確認が必要。
- 📝 ブランチ: `refactor/siteboard-cleanup`
- [x] 2-1 Rust top_inset ヘルパー ✅ platform_top_inset に集約（4箇所の cfg 分岐 + adjusted_y 分岐を解消）。cargo check OK
- [x] 3-1 useSiteboardViewportController ✅ viewport 管理を抽出。Siteboard.tsx 1634→1395行。typecheck/lint/test/format OK（要実機確認: pan/zoom/fit/reset）
- [x] 3-2 useSiteboardContextMenus ✅ ノード/エッジ右クリックメニューを抽出。Siteboard.tsx 1395→1265行（要実機確認: 右クリックメニュー各種）
- [x] 3-3 useSiteboardResize ✅ WebPage/付箋/テキストのリサイズ中間状態+ハンドラを抽出。Siteboard.tsx 1265→1174行（要実機確認: 各ノードのリサイズ）
- [x] 3-4 useSiteboardTextEditing ✅ テキスト/URL編集状態・autoEdit・空テキスト自動削除を抽出。Siteboard.tsx 1174→1090行。autoEdit を queueMicrotask 化（set-state-in-effect 対応）（要実機確認: 新規テキスト/付箋の自動編集、空テキスト削除、URL編集）
- [ ] 3-5 useSiteboardDrag
- [ ] 3-6 buildFlowNodes + useSiteboardSelection
- [ ] 4 Rust モジュール分割（lib.rs / store.rs / webview.rs）
- [ ] 5-1 Display Engine 純粋判定拡充
- [ ] 5-2 ScreenshotCaptureQueue 抽出
- [ ] 5-3 NativeRevealController 抽出
- [ ] 5-4 DisplayModeResolver 共通化
- [ ] 5-5 状態機械化（任意・要相談）

---

## 決定事項（2026-06-01 確定）

1. **z-order 変更の Undo** → **バグとして修正**。`replaceProjectNodes` 経由で履歴記録し Undo/Redo 可能化（0-2）。
2. **Vitest 導入** → **最小導入する**。フェーズ1の純関数抽出と同時に、純ロジックの単体テストを付ける。E2E は今回見送り（0-4）。
3. **tab-store 分割の深さ** → **純関数抽出まで**。Zustand slice 分割は今回スコープ外（1-4）。

> 現時点でオーナー判断待ちの未確定事項なし。実装はフェーズ0-1から着手可能。
