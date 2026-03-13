# フェーズ 2E: 統合テスト・微調整

> **ステータス: ✅ 実装済み・動作確認完了**

## 目的

フェーズ 2A-2D を統合した状態で end-to-end テストを行い、Display Engine と React Flow イベントの接続が正しく機能することを確認する。問題があれば修正する。

**前提**: フェーズ 2A-2D 全て完了済み。
**変更ファイル**: 検証で問題が発見された場合のみ修正。

## 検証チェックリスト

### Display Engine の基本動作

- [ ] pan 中に Webview が `native → screenshot → hidden` と遷移する
- [ ] zoom 中に display mode が正しく遷移する
- [ ] 操作終了後に Webview が native に復帰する（macOS: opacity フェードイン付き）
- [ ] スクリーンショットの撮影・キャッシュが動作する
- [ ] Webview の位置同期が pan 中にリアルタイムで追従する（`updateAllPositions` batch IPC）
- [ ] zoom 中の Webview サイズ同期が動作する（`updateAllBounds` batch IPC）
- [ ] `prepareInteractionStart` によるプリキャプチャが動作する（pan 開始時にスクリーンショットが表示される）
- [ ] 定期リフレッシュ（2000ms）が動作する
- [ ] macOS 白フラッシュ回避（opacity 遷移）が動作する

### エッジケース

- [ ] pan 中に別ウィンドウに切り替え（blur）→ `activeInteractionsRef.clear()` で全操作タイプがクリアされ、Webview が native に復帰する
- [ ] zoom リセットボタン（`handleResetZoom`）が正常に動作し、`scheduleZoomRestoreAfterReflow` で Webview が正しい位置に復帰する
- [ ] コンテキストメニュー → pan → コンテキストメニューの連続操作でクラッシュしない
- [ ] ノードドラッグ中に pan しようとしても pan が開始されない（ドラッグ中は pan 不可）
- [ ] zoom 後に pan → `isPanOnly` が `true` になる（zoom 後の状態が pan に影響しない）

### パフォーマンス

- [ ] ノード 5 個以上で pan 60fps 近辺を維持
- [ ] ノード 5 個以上で zoom 60fps 近辺を維持
- [ ] 高速 pan → 停止 → pan の繰り返しでちらつき・位置ずれがない
- [ ] スクリーンショット撮影中でも pan 操作が詰まらない

## パフォーマンス問題発生時の対策候補

### `computeInteractionModes` が重い場合
`scheduleInteractionUpdate` に最小実行間隔を追加することで rAF スロットリングを強化:

```ts
// useSiteboardDisplayEngine.ts を変更しない場合の Siteboard.tsx 側での対処
// ただし、コアロジック変更方針との兼ね合いで要判断
const lastInteractionUpdateRef = useRef(0);

// handleMove 内でスロットリングを追加してから scheduleInteractionUpdate を呼ぶ方法を検討
```

### `applyPreparedInteractionModes` が重い場合
ノード数が多い場合（10個以上）に初回 pan 開始が詰まる場合は、`requestIdleCallback` でのバッチ分割を検討。

### レイアウト thrashing が発生する場合
`getBoundingClientRect()` の呼び出しを1パスにまとめ、read→write の順序を守る形に `computeInteractionModes` を整理する。ただしこれはコアロジック変更になるため慎重に判断する。

## 完了条件

- フェーズ 2 ドキュメント（`phase-2-display-engine.md`）の検証チェックリスト全項目がパスすること
- pan/zoom の体感が React Flow 移行前と同等以上であること
- `npm run lint && npm run format && npm run typecheck` が通ること

## 次フェーズへの依存

フェーズ 3 以降でドラッグ/リサイズを React Flow ネイティブに移行する際、`onNodeDragStart` / `onNodeDragStop` から `handleInteractionChange(true/false, ...)` を呼ぶパターンがフェーズ 2B-2D で確立したものと同じになる。
