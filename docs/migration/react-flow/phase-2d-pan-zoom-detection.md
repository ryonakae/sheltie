# フェーズ 2D: pan/zoom 判定の導入

## 目的

React Flow の `onMoveStart`/`onMove`/`onMoveEnd` は pan と zoom を区別しない。`viewport.zoom` の変化を `onMove` で検出し、`activeInteractionsRef` を `'pan'` から `'zoom'` に昇格させることで `isPanOnly` 分岐を正しく動作させる。

**前提**: フェーズ 2B 完了済み（2C は独立）。
**変更ファイル**: `src/components/Siteboard/Siteboard.tsx` のみ。

## 背景: なぜ pan と zoom を区別する必要があるか

`computeInteractionModes` 内の `isPanOnly` 分岐:

```ts
const isPanOnly =
  activeInteractionsRef.current.has('pan') && !activeInteractionsRef.current.has('zoom');
```

| isPanOnly | 呼ぶ IPC | 用途 |
|---|---|---|
| `true` | `updateAllPositions()` | 位置のみ更新（zoom 変化なし）。軽量 |
| `false` | `updateAllBounds()` | フル更新（zoom 含む）。重いが必要 |

zoom 操作なのに `isPanOnly = true` のままだと `updateAllPositions` しか呼ばれず、Webview のサイズが更新されない。pan 操作なのに `isPanOnly = false` だと毎フレーム `updateAllBounds` が走り、不必要に重くなる。

また、`handleInteractionChange(false, ..., 'zoom')` は内部で `scheduleZoomRestoreAfterReflow()` を呼ぶ（`'pan'` の場合は呼ばない）。zoom 終了後のリフロー待ち復帰には `'zoom'` で終了することが必要。

## 作業内容

### 1. 新規 ref の追加

```ts
// onMoveStart 時点の zoom 値を記録（変化があれば zoom 操作と判定）
const lastMoveStartZoomRef = useRef(zoomRef.current);
// 現在の操作が pan か zoom か（handleMoveEnd で使用）
const currentInteractionTypeRef = useRef<'pan' | 'zoom'>('pan');
```

### 2. handleMoveStart の変更

`viewport` 引数（`FlowViewport`）を受け取り、開始時の zoom を記録する:

```ts
const handleMoveStart = useCallback(
  (_event: unknown, viewport: FlowViewport) => {
    lastMoveStartZoomRef.current = viewport.zoom;
    currentInteractionTypeRef.current = 'pan'; // 初期値は pan
    void prepareInteractionStart('pan');
    handleInteractionChange(true, 'grabbing', 'pan');
  },
  [prepareInteractionStart, handleInteractionChange],
);
```

### 3. handleMove の変更

zoom 変化を検出したら `activeInteractionsRef` を直接更新して `'pan'` → `'zoom'` に昇格:

```ts
const handleMove = useCallback(
  (_event: unknown, viewport: FlowViewport) => {
    if (
      currentInteractionTypeRef.current === 'pan' &&
      viewport.zoom !== lastMoveStartZoomRef.current
    ) {
      // pan → zoom に昇格（handleInteractionChange を再度呼ぶと applyPreparedInteractionModes が重複するため直接操作）
      currentInteractionTypeRef.current = 'zoom';
      activeInteractionsRef.current.delete('pan');
      activeInteractionsRef.current.add('zoom');
    }
    scheduleInteractionUpdate();
  },
  [activeInteractionsRef, scheduleInteractionUpdate],
);
```

`handleInteractionChange(true)` を2回呼ばない理由:
- `applyPreparedInteractionModes()` が重複実行される
- `setInteractionCursor` が2回 state 更新される
- `activeInteractionsRef` の直接操作は `useSiteboardDisplayEngine` の return 値に含まれており（L1184）、Siteboard.tsx から参照可能

### 4. handleMoveEnd の変更

操作終了時に記録した type を使って終了を通知:

```ts
const handleMoveEnd = useCallback(() => {
  const type = currentInteractionTypeRef.current;
  handleInteractionChange(false, 'default', type);
}, [handleInteractionChange]);
```

`type === 'zoom'` の場合、`handleInteractionChange` 内で `scheduleZoomRestoreAfterReflow()` が自動的に呼ばれる（追加コード不要）。

## 判定ロジックの設計判断

| 状況 | 判定 |
|---|---|
| onMoveStart 時点 | 常に `'pan'` と仮定（開始時点では不明） |
| onMove で zoom 変化を検出 | `'pan'` → `'zoom'` に昇格（一方向） |
| 一度 zoom になったら | 残りの操作全体を `'zoom'` として扱う（降格なし） |
| ホイールスクロール | zoom 値が変化するため `'zoom'` に昇格 |
| Space + ドラッグ | zoom 値が変化しないため `'pan'` のまま |
| ピンチ操作 | zoom 値が変化するため `'zoom'` に昇格 |

## 検証

- [ ] ホイール zoom → `isPanOnly === false` → `updateAllBounds` が呼ばれる
- [ ] Space + ドラッグ pan → `isPanOnly === true` → `updateAllPositions` が呼ばれる（軽量パス）
- [ ] ピンチ zoom → zoom として判定される
- [ ] zoom 終了後に `scheduleZoomRestoreAfterReflow` が呼ばれ native 復帰する
- [ ] zoom 後に pan して Webview 位置がずれていない
- [ ] 高速で zoom/pan を交互に繰り返しても状態が壊れない

## 次フェーズへの依存

フェーズ 2E（統合テスト）でフェーズ 2A-2D の全動作を確認する。
