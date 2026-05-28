# フェーズ 2B: pan/zoom 判定の統合接続

## 目的

React Flow の `onMoveStart`/`onMove`/`onMoveEnd` から pan と zoom を区別し、正確な操作タイプを `handleInteractionChange` に渡す。これにより以下を実現する:

1. pan 中: `isPanOnly = true` → `updateAllPositions()` 軽量 IPC で位置のみ追従（高速）
2. zoom 中: `isPanOnly = false` → `updateAllBounds()` でサイズも含めて同期
3. zoom 終了: `scheduleZoomRestoreAfterReflow()` を正しく呼んで native 復帰
4. zoom 操作中: `InteractionOverlay` を非表示（cursor falsy）でホイールイベント遮断を回避

**前提**: フェーズ 2A 完了済み。
**変更ファイル**: `src/components/Siteboard/Siteboard.tsx` のみ。
**ステータス**: ✅ 実装完了（`feature/react-flow2` ブランチ）

## 背景: なぜ pan と zoom を区別する必要があるか

### 根本原因（フェーズ 2D の教訓）

- React Flow の `onMoveStart/onMove/onMoveEnd` は **pan と zoom を区別しない**
- イベント引数（`event`）と `viewport.zoom` の変化から **event 開始時点で** 操作種別を即時判定する必要がある
- zoom 時は cursor を falsy にして `InteractionOverlay` を非表示にしないと、overlay が `pointer-events-auto` で画面全体を覆い、ホイールイベントが遮断される
- `handleMoveEnd` で `'pan'` ではなく `'zoom'` を渡すことで、内部の `scheduleZoomRestoreAfterReflow()` が正しく呼ばれて zoom 後の Webview 座標復帰が実行される

### isPanOnly 分岐の重要性

`computeInteractionModes` 内:

```ts
const isPanOnly =
  activeInteractionsRef.current.has('pan') && !activeInteractionsRef.current.has('zoom');
```

| isPanOnly | 呼ぶ IPC | 効果 |
|---|---|---|
| `true` | `updateAllPositions()` | 位置のみ更新（zoom 不変）。軽量で 60fps 維持 |
| `false` | `updateAllBounds()` | フル更新（zoom + size）。重いが必須 |

zoom 操作を `'pan'` として登録すると `isPanOnly = true` になり、`updateAllPositions` しか呼ばれず Webview サイズが未更新になる。結果、zoom 後に Webview 座標が狂う。

## 作業内容

### 1. moveInteractionTypeRef の追加

```ts
const moveInteractionTypeRef = useRef<'pan' | 'zoom' | null>(null);
```

現在の操作が pan か zoom か、および `handleMoveEnd` での正しいタイプ通知に使う。

### 2. handleMoveStart の変更

event 型から **開始時点で** 操作種別を即時判定:

```ts
const handleMoveStart = useCallback(
  (_event: MouseEvent | TouchEvent | null, _viewport: FlowViewport) => {
    // WheelEvent（zoom）か TouchEvent の多指（ピンチ zoom）か null（プログラマティック）は zoom として扱う
    const type: 'pan' | 'zoom' =
      _event === null
        ? 'zoom'
        : 'deltaY' in _event
          ? 'zoom'
          : _event instanceof TouchEvent && _event.touches.length >= 2
            ? 'zoom'
            : 'pan';

    moveInteractionTypeRef.current = type;
    // zoom 時は cursor を空文字（falsy）にして InteractionOverlay を非表示にする。
    // overlay が pointer-events-auto で画面全体を覆うとホイールイベントが遮断されるため。
    handleInteractionChange(true, type === 'pan' ? 'grabbing' : '', type);
  },
  [handleInteractionChange],
);
```

**判定ロジック**:
- `_event === null` → プログラマティック操作（ダブルクリック zoom など）→ `'zoom'`
- `'deltaY' in _event` → WheelEvent → `'zoom'`
- `_event instanceof TouchEvent && _event.touches.length >= 2` → ピンチ → `'zoom'`
- その他 → `'pan'`（マウスドラッグ、Space + ドラッグ）

### 3. handleMove の変更なし

```ts
const handleMove = useCallback(() => {
  scheduleInteractionUpdate();
}, [scheduleInteractionUpdate]);
```

`moveInteractionTypeRef.current` が既に設定されているため、`scheduleInteractionUpdate` → `computeInteractionModes()` → `activeInteractionsRef` 参照で正しく判定される。

### 4. handleMoveEnd の変更

記録した type を使い、zoom 時は `scheduleZoomRestoreAfterReflow()` を自動実行させる:

```ts
const handleMoveEnd = useCallback(() => {
  const type = moveInteractionTypeRef.current ?? 'pan';
  moveInteractionTypeRef.current = null;
  handleInteractionChange(false, 'default', type);
}, [handleInteractionChange]);
```

`handleInteractionChange(false, ..., 'zoom')` の場合、内部で自動的に `scheduleZoomRestoreAfterReflow()` が呼ばれ、zoom 後のリフロー完了後に Webview 座標を正しく復帰させる。

## 動作フロー

```
ホイール zoom (onMoveStart)
  → event に 'deltaY' → type = 'zoom'
  → moveInteractionTypeRef.current = 'zoom'
  → handleInteractionChange(true, '', 'zoom')  ← cursor 空文字で overlay 非表示
    → activeInteractionsRef.add('zoom')
    → interactionCursor 空文字 → InteractionOverlay 非表示（pointer-events 遮断なし）

zoom 中 (onMove)
  → scheduleInteractionUpdate()
    → computeInteractionModes()
      → isPanOnly = false（'zoom' in activeInteractionsRef）
      → updateAllBounds() (サイズ含むフル更新)

zoom 終了 (onMoveEnd)
  → type = 'zoom'
  → handleInteractionChange(false, 'default', 'zoom')
    → activeInteractionsRef.delete('zoom')
    → scheduleZoomRestoreAfterReflow() 実行 ✓
    → リフロー後に Webview 座標復帰

---

Space + ドラッグ pan (onMoveStart)
  → event は MouseEvent（deltaY なし）→ type = 'pan'
  → moveInteractionTypeRef.current = 'pan'
  → handleInteractionChange(true, 'grabbing', 'pan')
    → activeInteractionsRef.add('pan')
    → interactionCursor 'grabbing'

pan 中 (onMove)
  → scheduleInteractionUpdate()
    → computeInteractionModes()
      → isPanOnly = true（'pan' のみ）
      → updateAllPositions() (位置のみ軽量 IPC)

pan 終了 (onMoveEnd)
  → type = 'pan'
  → handleInteractionChange(false, 'default', 'pan')
    → activeInteractionsRef.delete('pan')
    → scheduleZoomRestoreAfterReflow() は呼ばない（'pan' のため）
    → computeDisplayModes() で native 復帰
```

## 検証

- [ ] ホイール zoom 中に `InteractionOverlay` が非表示（cursor 空文字）であること
- [ ] ホイール zoom で `updateAllBounds()` が呼ばれ、zoom 後に Webview サイズが正しく更新されること
- [ ] ホイール zoom 終了後に `scheduleZoomRestoreAfterReflow()` が呼ばれて native 復帰すること
- [ ] Space + ドラッグ pan で `updateAllPositions()` が呼ばれて軽量追従すること（60fps 近辺）
- [ ] ピンチ zoom で `'zoom'` として判定されること
- [ ] プログラマティック zoom でも `'zoom'` として判定されること
- [ ] zoom 後に pan して Webview 座標がずれていないこと

## 次フェーズへの依存

フェーズ 2C（プリキャプチャ）以降でスクリーンショット事前撮影を追加。
