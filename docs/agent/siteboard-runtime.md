# Siteboard ランタイム仕様

この文書は Siteboard の表示制御と Webview ランタイムの正本。
対象実装は主に以下。

- `src/renderer/components/Siteboard/Siteboard.tsx`
- `src/renderer/hooks/siteboard/useSiteboardDisplayEngine.ts`
- `src/renderer/hooks/siteboard/useSiteboardViewportEngine.ts`
- `src/renderer/hooks/siteboard/useSiteboardNodeRuntime.ts`
- `src/renderer/components/Node/PageNode.tsx`

## 表示モード

`DisplayMode` は 3 種類。

- `native`: ネイティブ Webview を表示
- `screenshot`: スクリーンショット画像を表示
- `hidden`: 両方非表示

## しきい値・定数

- `NATIVE_SAFE_MARGIN_PX = 50`
- `HYSTERESIS_PX = 4`
- `SCREENSHOT_CLIPPING_ENABLED`（`useSiteboardDisplayEngine.ts` 内）

近接判定ではヒステリシスを使い、境界振動を防ぐ。

## 操作タイプ

`InteractionType = 'pan' | 'zoom' | 'drag' | 'resize'`

- `drag/resize`: 開始時に Webview を非表示化し、終了時に表示判定を再計算。
- `pan/zoom`: rAF 単位で `computeInteractionModes` を実行し、必要に応じて `native/screenshot/hidden` を切り替える。

## pan 専用最適化

- pan 中で zoom が変わらない場合は `updateAllPositions` を使う。
- zoom 変化を伴う場合は `updateAllBounds` を使う。

この分岐を壊すと追従遅延が再発しやすい。

## 遷移ルール

- 操作中は `native -> screenshot/hidden` 遷移を許可。
- 操作中の `screenshot/hidden -> native` は抑制し、終了後の最終計算で復帰。

## スクリーンショット撮影タイミング

- pan/zoom 操作開始時
- ナビゲーション後（遅延あり）
- 初回ロード完了時
- リサイズ終了時
- Webview 内スクロール完了時（`page-scroll-ended-{pageId}`）

## ちらつき回避（重要）

`screenshot -> native` への復帰時は以下を守る。

1. 先に `webviewApi.show()` を呼ぶ。
2. `requestAnimationFrame` で 1 フレーム待つ。
3. `data-display-mode='native'` と state 更新を行う。

即時に mode を戻すと OS 側描画が追いつかず、ちらつきが出る。

## Webview 生成・破棄の注意

- React StrictMode 二重マウント対策として、`PageNode` で作成競合をガードする。
- Webview API は例外時 no-op を許容する前提。
- 空フレーム（`url === ''`）は Webview を作成しない。

## スクロール完了通知チャネル

`commands/webview.rs` の `initialization_script` は `document.title` プレフィックスを使う。

- `\x01`: SPA URL 変更（`page-navigated-{pageId}`）
- `\x02`: スクロール完了（`page-scroll-ended-{pageId}`）

新しい通知を増やす場合はプレフィックス衝突を避ける。

## 変更時チェックリスト

- 表示モード変更時: `computeDisplayModes` と `computeInteractionModes` の両方を確認。
- しきい値変更時: pan/zoom 中と終了時で振動・ちらつきがないか確認。
- イベント変更時: Rust emit と JS listener の名前一致を確認。
