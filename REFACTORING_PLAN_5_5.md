# 5-5 状態機械化 子プラン

> 作業用ドキュメント。`docs/agents/` には置かない。
> 完了したら親 `REFACTORING_PLAN.md` の 5-5 チェックを入れ、この子プランは削除する。
> 親プランの「設計原則（全フェーズ共通）」に従う（挙動保存・1 commit = 1 責務・低リスク→高リスク・TDD）。

---

## 1. 目的

`useSiteboardDisplayEngine.ts` に 9 個残る per-node / mode / dialog 系 ref を **flat record state + 純関数 reducer** に集約し、

- 全更新を `dispatch(action)` 経由に統一して暗黙の状態遷移を明示化する
- 複合更新（INTERACTION_END で関連フラグも一括クリア等）を **reducer 内で完結** させる
- reducer + selector を純関数として **vitest でテスト**できるようにする
- 5-2 / 5-3 で抽出したサブフックとの境界を保ちつつ、サブフックも `dispatch` API 経由で state machine に参加させる

挙動完全保存（behavior-preserving）。シグネチャは Q10 で決めた **未使用 export 4 つだけ削除**、それ以外は不変。

## 2. スコープ

### 2-1. state 化する 9 ref（`useSiteboardDisplayEngine.ts` 現在のメインフック内）

| ref | 性質 |
|---|---|
| `activeInteractionsRef: Set<InteractionType>` | 操作種別の同時セット |
| `contextMenuNodeIdRef: string \| null` | 右クリック中ノード |
| `unsavedChangesDialogOpenRef: boolean` | ダイアログ表示中 |
| `resizingNodeIdRef: string \| null` | リサイズ中ノード |
| `settlingNodeIdsRef: Set<string>` | 補正アニメ中ノード |
| `toolbarOccludedIdsRef: Set<string>` | ツールバー被り中 |
| `forceHiddenInteractionNodeIdsRef: Set<string>` | 操作開始直後の強制 hidden |
| `nativeHiddenByInteractionCaptureRef: Set<string>` | snapshot 要求直後の native 側 hide |
| `interactionCaptureRetryNodeIdsRef: Set<string>` | 取り損ねた capture の再試行待ち |

### 2-2. 不可侵リスト（5-5 のスコープ外。ref のまま残す）

| ref | 理由 |
|---|---|
| `computeDisplayModesRef` / `setNodeDisplayModeRef` / `hideNodeWebviewRef` | 関数参照（順序解決用） |
| `interactionRafRef` / `interactionCaptureRetryTimerRef` / `resizeObserverRafRef` | rAF / timer ID（キャンセル用ハンドル） |
| `containerRectRef` | per-frame DOM キャッシュ |
| `knownNodeIdsRef` | cleanup 用ライフサイクル管理 |
| `isMacOsRef`（サブフック内）/ `pendingNativeRevealRef` / `nativeRevealTimersRef` / `nativeRevealTokenRef` | `useNativeRevealController` 内部状態（境界維持） |
| `screenshotReadyRef` / `screenshotUrlsRef` / `presentedScreenshotUrlRef` / `screenshotPresentationWaitersRef` / `capturePromiseRef` / `pendingCaptureOptionsRef` / `queuedFreshCaptureRef` / `captureScreenshotRef` | `useScreenshotCaptureQueue` 内部状態（境界維持） |

---

## 3. State / Action 型定義

```ts
// src/hooks/siteboard/display-engine/state-machine.ts

export interface DisplayEngineState {
  activeInteractions: ReadonlySet<InteractionType>;
  contextMenuNodeId: string | null;
  unsavedDialogOpen: boolean;
  resizingNodeId: string | null;
  settlingIds: ReadonlySet<string>;
  toolbarOccludedIds: ReadonlySet<string>;
  forceHiddenIds: ReadonlySet<string>;
  nativeHiddenByCaptureIds: ReadonlySet<string>;
  captureRetryIds: ReadonlySet<string>;
}

export const INITIAL_DISPLAY_ENGINE_STATE: DisplayEngineState = {
  activeInteractions: new Set(),
  contextMenuNodeId: null,
  unsavedDialogOpen: false,
  resizingNodeId: null,
  settlingIds: new Set(),
  toolbarOccludedIds: new Set(),
  forceHiddenIds: new Set(),
  nativeHiddenByCaptureIds: new Set(),
  captureRetryIds: new Set(),
};

export type DisplayEngineAction =
  | { type: 'INTERACTION_START'; interactionType: InteractionType }
  | { type: 'INTERACTION_END'; interactionType: InteractionType }
  | { type: 'INTERACTION_CLEAR_ALL' }                              // blur 時
  | { type: 'CONTEXT_MENU_OPEN'; nodeId: string }
  | { type: 'CONTEXT_MENU_CLOSE' }
  | { type: 'UNSAVED_DIALOG_OPEN' }
  | { type: 'UNSAVED_DIALOG_CLOSE' }
  | { type: 'RESIZE_START'; nodeId: string }
  | { type: 'RESIZE_END'; nodeId: string }
  | { type: 'SETTLE_NODE'; nodeId: string }
  | { type: 'RELEASE_NODE'; nodeId: string }
  | { type: 'TOOLBAR_OCCLUDED_IDS_SET'; ids: ReadonlySet<string> }
  | { type: 'FORCE_HIDDEN_ADD'; nodeId: string }
  | { type: 'FORCE_HIDDEN_REMOVE'; nodeId: string }
  | { type: 'NATIVE_HIDDEN_BY_CAPTURE_ADD'; nodeId: string }
  | { type: 'CAPTURE_RETRY_ADD'; nodeId: string }
  | { type: 'CAPTURE_RETRY_REMOVE'; nodeId: string }
  | { type: 'CAPTURE_RETRY_CLEAR_ALL' }
  | { type: 'CLEANUP_NODE'; nodeId: string };

export function displayEngineReducer(
  state: DisplayEngineState,
  action: DisplayEngineAction,
): DisplayEngineState;
```

Set は immutable に扱う（新 Set を返す）。これにより reducer は純関数として参照透過。

---

## 4. Action × Field 更新マトリクス（reducer 仕様の正本）

`—` = 変更なし。複合更新で size 判定が必要な場合は注記する。

| Action | activeInter | contextMenu | unsavedDialog | resizing | settling | toolbarOccluded | forceHidden | nativeHiddenByCapture | captureRetry |
|---|---|---|---|---|---|---|---|---|---|
| INTERACTION_START(t) | add(t) | — | — | — | — | — | — | — | — |
| INTERACTION_END(t) | delete(t) | — | — | clear-if-last¹ | — | — | clear-if-last¹ | clear-if-last¹ | — |
| INTERACTION_CLEAR_ALL | clear | — | — | null | clear | — | clear | clear | clear |
| CONTEXT_MENU_OPEN(id) | — | =id | — | — | — | — | — | — | — |
| CONTEXT_MENU_CLOSE | — | null | — | — | — | — | — | — | — |
| UNSAVED_DIALOG_OPEN | — | — | true | — | — | — | — | — | — |
| UNSAVED_DIALOG_CLOSE | — | — | false | — | — | — | — | — | — |
| RESIZE_START(id) | — | — | — | =id | — | — | — | — | — |
| RESIZE_END(id) | — | — | — | null-if-matches² | — | — | — | — | — |
| SETTLE_NODE(id) | — | — | — | — | add(id) | — | — | — | — |
| RELEASE_NODE(id) | — | — | — | — | delete(id) | — | — | — | — |
| TOOLBAR_OCCLUDED_IDS_SET(ids) | — | — | — | — | — | =ids | — | — | — |
| FORCE_HIDDEN_ADD(id) | — | — | — | — | — | — | add(id) | — | — |
| FORCE_HIDDEN_REMOVE(id) | — | — | — | — | — | — | delete(id) | — | — |
| NATIVE_HIDDEN_BY_CAPTURE_ADD(id) | — | — | — | — | — | — | — | add(id) | — |
| CAPTURE_RETRY_ADD(id) | — | — | — | — | — | — | — | — | add(id) |
| CAPTURE_RETRY_REMOVE(id) | — | — | — | — | — | — | — | — | delete(id) |
| CAPTURE_RETRY_CLEAR_ALL | — | — | — | — | — | — | — | — | clear |
| CLEANUP_NODE(id) | — | null-if-matches² | — | null-if-matches² | delete(id) | delete(id) | delete(id) | delete(id) | delete(id) |

注:
- ¹ **clear-if-last**: INTERACTION_END で `delete(t)` 後に `activeInteractions.size === 0` ならフィールドを clear / null。size > 0 なら変更なし。
- ² **null-if-matches**: 現在値が引数の `id` と一致する場合のみ null にする。一致しなければ変更なし。

現コード対応:
- `INTERACTION_END` の `clear-if-last` 群（forceHidden / nativeHiddenByCapture / resizing）は現 `handleInteractionChange` の `active === false` ブロックの最後の `if (activeInteractionsRef.current.size === 0)` 内の処理を再現
- `INTERACTION_CLEAR_ALL` は現 `blur handler` 内のフラグクリアを再現（`containerRectRef` / rAF キャンセルは reducer 外、callsite で実行）
- `CLEANUP_NODE` は現 `cleanupPageArtifacts` 内の Set/null クリアを再現（webview API 呼び出し・cancelNativeReveal・cleanupScreenshot は reducer 外）

---

## 5. Selector 一覧

`state-machine.ts` に純関数として同居。`mode.ts` の `isToolbarOccluded(nodeId, nodeRect, toolbarRects)` と衝突するため、こちらは `isInOccludedSet` 等にする。

```ts
hasAnyInteraction(s): boolean                  // s.activeInteractions.size > 0
isInteractionActive(s, type): boolean          // s.activeInteractions.has(type)
isPanOrZoomActive(s): boolean                  // pan or zoom
isDragOrResizeActive(s): boolean               // drag or resize
isContextMenuTarget(s, nodeId): boolean
isSettling(s, nodeId): boolean
isInOccludedSet(s, nodeId): boolean            // toolbarOccludedIds（mode.ts の isToolbarOccluded と区別）
isForceHidden(s, nodeId): boolean
isNativeHiddenByCapture(s, nodeId): boolean
hasPendingCaptureRetry(s): boolean             // captureRetryIds.size > 0
```

---

## 6. 9 commit の段階分割

| # | 段階 | 内容 | 主な検証 |
|---|---|---|---|
| 1 | 枠導入 + テスト網羅 | `state-machine.ts` / `state-machine.test.ts` を新規作成。reducer 全 action（複合は全パス、単純は代表 1 ケース）+ selector 全件をテスト。メインフックに `stateRef`/`dispatch` 追加（**読み書きは既存 ref のまま、stateRef は空回り**） | reducer/selector の vitest 100% pass。既存挙動は完全不変（既存 ref が真実の状態） |
| 2 | 単一値フラグ移行 | `contextMenuNodeIdRef` / `unsavedChangesDialogOpenRef` / `resizingNodeIdRef` を state に移し、対応する callsite を dispatch 化。3 ref 削除 | シナリオ 4（右クリックメニュー）/ 7（save 時 unsaved-dialog）/ 3（リサイズ） |
| 3 | activeInteractions 移行 | `activeInteractionsRef` を state に移行。INTERACTION_START/END/CLEAR_ALL を導入。`handleInteractionChange`/`blur handler`/`captureScreenshot` 内のチェックを selector へ。ref 削除 | シナリオ 2（pan/zoom）/ 5（ドラッグ）/ blur 時の状態リセット |
| 4a | forceHiddenIds 移行 | `forceHiddenInteractionNodeIdsRef` を state に。**サブフック (`useScreenshotCaptureQueue`) 内の `sharedRefs.forceHiddenInteractionNodeIdsRef.current.delete(nodeId)` も dispatch 化**。`sharedRefs` 型から該当 ref を削除、`{ stateRef, dispatch }` を渡す形に切り替える初回 | シナリオ 2 / 3 |
| 4b | nativeHiddenByCaptureIds 移行 | `nativeHiddenByInteractionCaptureRef` を state に。サブフック内の `.add(nodeId)` を dispatch 化 | シナリオ 2 / 3 |
| 4c | captureRetryIds 移行 | `interactionCaptureRetryNodeIdsRef` を state に。サブフック内の `.add(nodeId)` / `.delete(nodeId)` を dispatch 化。メインフックの `scheduleInteractionCaptureRetry` / `cancelInteractionCaptureRetry` も dispatch 化 | シナリオ 2 / 3 |
| 4d | settlingIds 移行 | `settlingNodeIdsRef` を state に。`holdNodeDuringPositionSettle` / `releaseNodeAfterPositionSettle` を dispatch 化 | シナリオ 5（位置補正アニメ） |
| 4e | toolbarOccludedIds 移行 | `toolbarOccludedIdsRef` を state に。`computeDisplayModes` 内の比較・更新を dispatch 化。`mode.ts` の `isToolbarOccluded` 名と区別するため selector は `isInOccludedSet` を使う | シナリオ 4 周辺（ツールバー被り判定） |
| 5 | cleanup 集約 + 未使用 export 削除 | `cleanupPageArtifacts` 内の per-node 削除を `dispatch({ type: 'CLEANUP_NODE', nodeId })` 1 発に集約。未使用 export 4 つ（`activeInteractionsRef` / `computeDisplayModes` / `computeInteractionModes` / `cleanupPageArtifacts`）を削除（cleanupPageArtifacts は内部関数として残し、戻り値からのみ削除） | シナリオ 7（タブ close で cleanup）/ 9（起動時復元） |

各 commit 後に `npm run lint && npm run format && npm run typecheck && npm run test` を通す（pre-commit hook で自動実行される）。

---

## 7. サブフック内 `sharedRefs` 参照箇所一覧（段階 4 用）

`src/hooks/siteboard/useScreenshotCaptureQueue.ts` 内の現参照箇所（grep 確認済み、行番号は変動する可能性あり）:

| 行 | 操作 | 移行後 |
|---|---|---|
| L222-223 | read: `activeInteractionsRef.current.has('drag' \| 'resize')` | `isDragOrResizeActive(stateRef.current)` |
| L228 | write: `nativeHiddenByInteractionCaptureRef.current.add(nodeId)` | `dispatch({ type: 'NATIVE_HIDDEN_BY_CAPTURE_ADD', nodeId })` |
| L236 | write: `interactionCaptureRetryNodeIdsRef.current.add(nodeId)` | `dispatch({ type: 'CAPTURE_RETRY_ADD', nodeId })` |
| L241-242 | read: 同 L222-223 | 同 |
| L258 | write: `forceHiddenInteractionNodeIdsRef.current.delete(nodeId)` | `dispatch({ type: 'FORCE_HIDDEN_REMOVE', nodeId })` |
| L259 | write: `interactionCaptureRetryNodeIdsRef.current.delete(nodeId)` | `dispatch({ type: 'CAPTURE_RETRY_REMOVE', nodeId })` |
| L273-275 | read: `unsavedChangesDialogOpenRef.current \|\| contextMenuNodeIdRef.current === nodeId \|\| activeInteractionsRef.current.size > 0` | `stateRef.current.unsavedDialogOpen \|\| isContextMenuTarget(stateRef.current, nodeId) \|\| hasAnyInteraction(stateRef.current)` |
| L284 | read: `activeInteractionsRef.current.size === 0` | `!hasAnyInteraction(stateRef.current)` |
| L337 | read: 同 L284 | 同 |

段階 4 では「該当する ref が消えた commit でその ref 経由の参照も dispatch / selector に置換する」を厳守。read 系は段階 2（contextMenu/unsavedDialog）と段階 3（activeInteractions）で先に消えるので、段階 4 開始時点では write 系のみが残っている前提。

`sharedRefs` の型は段階 4a の冒頭で `{ stateRef, dispatch }` に置換し、以降 4b-4e は中身を 1 つずつ移行するだけ。

---

## 8. 各 commit 後の手動シナリオ

親 `REFACTORING_PLAN.md` の **0-3 回帰チェックリスト 9 シナリオ** を段階別にマッピング:

| 段階 | 必須シナリオ |
|---|---|
| 1 | （挙動不変なので最小限。`npm run dev` で起動 → ボード操作が壊れていないか確認） |
| 2 | 4, 7, 3 |
| 3 | 2, 5, 加えて開発者ツールで blur イベント発火 |
| 4a-4e | 2, 3（screenshot capture を伴う操作全般） |
| 5 | 7（タブ close → cleanup）, 9（起動時復元） |

全段階完了後に 9 シナリオ全件を通す。

---

## 9. 完了基準

- [ ] 9 commit すべて green（lint / format / typecheck / test）
- [ ] `useSiteboardDisplayEngine.ts` から 9 ref の `useRef` 宣言が消えている
- [ ] `state-machine.ts` の `displayEngineReducer` が exported された純関数で、25〜35 テストが通っている
- [ ] `useScreenshotCaptureQueue.ts` の `sharedRefs` が `{ stateRef, dispatch }` 型になっている
- [ ] 未使用 export 4 つが削除されている
- [ ] 9 シナリオ全件の手動回帰確認が完了
- [ ] 親 `REFACTORING_PLAN.md` の 5-5 にチェックを入れ、この子プランを削除

---

## 10. 中止判断基準

途中で以下が起きたら 5-5 を中止し、それまでに完了した commit までで止める判断を行う:

- 段階 3（activeInteractions 移行）後の手動シナリオ 2 / 5 で挙動破壊が確認され、原因特定に 2 時間以上かかる
- 段階 4 のサブフック書き換えで、screenshot capture が再現可能な形で壊れる
- reducer/selector のテスト追加が間に合わず、段階 1 で 50 テストを超える

中止時は、未完了の段階の ref を ref のまま残し、`REFACTORING_PLAN.md` 5-5 を「部分完了」状態で記録する（どの段階まで終わったかと、残り段階の見送り理由を明記）。
