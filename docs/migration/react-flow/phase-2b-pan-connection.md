# フェーズ 2B: pan 操作の基本接続

## 目的

`handleInteractionChange(true, ..., 'pan')` を `onMoveStart` から呼ぶことで、`activeInteractionsRef` に `'pan'` を登録し `containerRectRef` をキャッシュする。これにより `computeInteractionModes()` が実際に動作し、pan 中に Webview が位置追従できるようになる。

**前提**: フェーズ 2A 完了済み。
**変更ファイル**: `src/components/Siteboard/Siteboard.tsx` のみ。

## 背景: なぜ現状は no-op なのか

フェーズ 1 完了時点の接続:

```ts
const handleMoveStart = useCallback(() => {
  scheduleInteractionUpdate();  // ← 実質 no-op
}, [scheduleInteractionUpdate]);
```

`scheduleInteractionUpdate` 内で `computeInteractionModes()` を呼ぶが、`computeInteractionModes` の先頭に次のガードがある:

```ts
const computeInteractionModes = useCallback(() => {
  const containerRect = containerRectRef.current;
  if (!containerRect || !canvasRef.current) return;  // ← containerRectRef が null なので即 return
  // ...
}, [...]);
```

`containerRectRef.current` は `handleInteractionChange(true, ..., 'pan' | 'zoom')` を呼んで初めてキャッシュされる。現状ではこれが呼ばれていないため、pan/zoom 中に Webview は追従しない。

## 作業内容

### 1. handleMoveStart の変更

```ts
// 変更前:
const handleMoveStart = useCallback(() => {
  scheduleInteractionUpdate();
}, [scheduleInteractionUpdate]);

// 変更後:
const handleMoveStart = useCallback(() => {
  handleInteractionChange(true, 'grabbing', 'pan');
}, [handleInteractionChange]);
```

`handleInteractionChange(true, 'grabbing', 'pan')` が実行すること:
1. `activeInteractionsRef.current.add('pan')`
2. `setInteractionCursor('grabbing')` でカーソル変更
3. `applyPreparedInteractionModes()` で既存スクリーンショットがあるノードを screenshot/hidden に切り替え（プリキャプチャは 2C で追加）
4. `containerRectRef.current = containerRef.current.getBoundingClientRect()`
5. `computeInteractionModes()` を即時呼び出し → 初回の位置更新

### 2. handleMoveEnd の変更

```ts
// 変更前:
const handleMoveEnd = useCallback(() => {
  computeDisplayModes();
}, [computeDisplayModes]);

// 変更後:
const handleMoveEnd = useCallback(() => {
  handleInteractionChange(false, 'default', 'pan');
}, [handleInteractionChange]);
```

`handleInteractionChange(false, 'default', 'pan')` が実行すること:
1. `activeInteractionsRef.current.delete('pan')`
2. `size === 0` になるため:
   - `containerRectRef.current = null` をクリア
   - rAF をキャンセル
   - カーソルをリセット
   - `computeDisplayModes()` で全ノードの native 復帰

### 3. handleMove は変更なし

`scheduleInteractionUpdate()` のまま。`activeInteractionsRef` に `'pan'` が入った状態で呼ばれると:
- `computeInteractionModes()` が `containerRectRef !== null` で正常に動作
- `isPanOnly = activeInteractionsRef.has('pan') && !activeInteractionsRef.has('zoom') = true`
- `updateAllPositions()` 軽量バッチ IPC で位置のみ更新

## 動作フロー（接続後）

```
pan 開始 (onMoveStart)
  → handleInteractionChange(true, 'grabbing', 'pan')
    → activeInteractionsRef.add('pan')
    → applyPreparedInteractionModes() でスクリーンショット/hidden に切替
    → containerRectRef キャッシュ
    → computeInteractionModes() 初回実行

pan 中 (onMove, 毎フレーム)
  → scheduleInteractionUpdate()
    → rAF → computeInteractionModes()
      → isPanOnly = true
      → updateAllPositions() (位置のみ batch IPC)

pan 終了 (onMoveEnd)
  → handleInteractionChange(false, 'default', 'pan')
    → activeInteractionsRef.delete('pan')
    → containerRectRef = null
    → computeDisplayModes() で native 復帰
```

## 検証

- [ ] pan 開始時に Webview が screenshot/hidden に切り替わる
- [ ] pan 中に native Webview がリアルタイムで位置追従する
- [ ] pan 終了後に Webview が native に復帰し正しい位置に表示される
- [ ] カーソルが pan 中 `grabbing`、終了後 `default` に戻る
- [ ] Chrome DevTools Performance タブで pan 中のフレームレートが 60fps 近辺であること

### パフォーマンスが重い場合の対策

`computeInteractionModes` が毎 rAF フレームで全ノードの `getBoundingClientRect()` を呼ぶことがボトルネックになる場合は、`scheduleInteractionUpdate` に最小実行間隔（例: 8ms）を追加する:

```ts
// scheduleInteractionUpdate 内に追加（useSiteboardDisplayEngine.ts は変更せず、Siteboard.tsx 側で対処する場合）
// ただしコアロジックを変更しない方針のため、まず素の実装を計測してから判断する
```

## 次フェーズへの依存

フェーズ 2C でプリキャプチャを追加するまで、`applyPreparedInteractionModes()` はスクリーンショットが既にあるノードのみ切り替える（スクリーンショットがなければ native のまま）。
