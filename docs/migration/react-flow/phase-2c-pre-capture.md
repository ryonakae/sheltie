# フェーズ 2C: prepareInteractionStart の接続

> **ステータス: ✅ 実装済み**

## 目的

pan 開始時にビューポート内の WebPage ノードのスクリーンショットを事前撮影し、操作中の screenshot モード表示品質を向上させる。

**前提**: フェーズ 2B 完了済み。
**変更ファイル**: `src/components/Siteboard/Siteboard.tsx` のみ。

## 背景

フェーズ 2B で `handleInteractionChange(true, ..., 'pan')` を接続したが、`applyPreparedInteractionModes()` の前に `prepareInteractionStart` を呼ばないとプリキャプチャが行われない。

`prepareInteractionStart('pan')` は:
1. ビューポート内にある全 WebPage ノードの ID を取得
2. 各ノードの `ensureScreenshotReady()` を並列実行
3. スクリーンショット未取得のノードは `captureScreenshot` で撮影（await）
4. スクリーンショット取得に失敗したノードは `forceHiddenInteractionNodeIdsRef` に追加

drag の `handleNodeDragStart` では `await prepareInteractionStart('drag', nodeId)` で待機しているが、pan では全可視ノードが対象のため **await しない（fire-and-forget）**。

## 作業内容

### handleMoveStart に prepareInteractionStart を追加

```ts
// 変更前（フェーズ 2B 後）:
const handleMoveStart = useCallback(() => {
  handleInteractionChange(true, 'grabbing', 'pan');
}, [handleInteractionChange]);

// 変更後:
const handleMoveStart = useCallback(() => {
  void prepareInteractionStart('pan');
  handleInteractionChange(true, 'grabbing', 'pan');
}, [prepareInteractionStart, handleInteractionChange]);
```

`prepareInteractionStart` の前に `handleInteractionChange` を呼ばない理由:
- `applyPreparedInteractionModes()` が `handleInteractionChange` の中で呼ばれる
- プリキャプチャ完了前に `applyPreparedInteractionModes()` が走ってもスクリーンショットは既存のものが使われる（未取得のものは hidden になる）
- `prepareInteractionStart` を先に呼ぶ（fire-and-forget）ことで、スクリーンショット撮影をできるだけ早く開始する

## 検証

- [ ] 複数 WebPage ノードが表示された状態で pan 開始 → スクリーンショットが表示される
- [ ] スクリーンショットが取れていないノードが hidden になる
- [ ] pan 開始に体感遅延がない（fire-and-forget のため遅延ゼロが期待値）
- [ ] pan 中にバックグラウンドでスクリーンショット撮影が完了し、次回 pan 開始時には即座に表示される

## 実際の実装（計画との差異）

本ドキュメントは常に `'pan'` を渡す設計だったが、フェーズ 2D と統合する形で実装された。`beginViewportInteraction` 内で `resolveViewportInteractionType(event)` が先に type を決定し、その type（'pan' または 'zoom'）を `prepareInteractionStart` に渡す:

```ts
const beginViewportInteraction = useCallback(
  (event: MouseEvent | TouchEvent | null) => {
    const type = resolveViewportInteractionType(event);
    moveInteractionTypeRef.current = type;
    void prepareInteractionStart(type);          // ← pan/zoom どちらも正しく渡す
    handleInteractionChange(true, type === 'pan' ? 'grabbing' : '', type);
    return type;
  },
  [resolveViewportInteractionType, prepareInteractionStart, handleInteractionChange],
);
```

この方式により、2C（プリキャプチャ）と 2D（型判定）が統合され、別々のステップなく一度に機能する。
