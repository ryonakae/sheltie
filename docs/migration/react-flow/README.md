# React Flow (@xyflow/react) 移行計画

## 概要

現在のアートボード実装（独自の pan/zoom/drag/resize + CSS transform 管理）を `@xyflow/react` に段階的に移行する計画。

各フェーズが独立して動作確認できるように設計されており、問題が起きた際にすぐ気付けるようにする。

## フェーズ一覧

| フェーズ | ファイル | 内容 | 難易度 | 状態 |
|---|---|---|---|---|
| 0 | [phase-0-install.md](./phase-0-install.md) | パッケージ導入 + アダプター層 | 低 | ✅ 完了 |
| 1 | [phase-1-reactflow-container.md](./phase-1-reactflow-container.md) | ReactFlow コンテナに切り替え（pan/zoom のみ） | 中 | ✅ 完了 |
| 2 | [phase-2-display-engine.md](./phase-2-display-engine.md) | Display Engine を React Flow イベントに接続 | 高 | ✅ 完了 |

**フェーズ 2 サブフェーズ一覧**

| サブフェーズ | ファイル | 内容 | 状態 |
|---|---|---|---|
| 2A | [phase-2a-throttle-ui-zoom.md](./phase-2a-throttle-ui-zoom.md) | setUiZoom の rAF スロットリング | ✅ 完了 |
| 2B | [phase-2b-pan-connection.md](./phase-2b-pan-connection.md) | pan 操作の基本接続 | ✅ 完了 |
| 2C | [phase-2c-pre-capture.md](./phase-2c-pre-capture.md) | prepareInteractionStart の接続 | ✅ 完了 |
| 2D | [phase-2d-pan-zoom-detection.md](./phase-2d-pan-zoom-detection.md) | pan/zoom 判定の導入 | ✅ 完了 |
| 2E | [phase-2e-integration-test.md](./phase-2e-integration-test.md) | 統合テスト・微調整 | ✅ 完了 |

| 3 | [phase-3-stickynote-drag-resize.md](./phase-3-stickynote-drag-resize.md) | 付箋のドラッグ/リサイズを React Flow ネイティブに | 中 | ✅ 完了 |
| 4 | [phase-4-webpage-drag.md](./phase-4-webpage-drag.md) | WebPageNode のドラッグを React Flow ネイティブに | 高 | ✅ 完了 |
| 5 | [phase-5-webpage-resize.md](./phase-5-webpage-resize.md) | WebPageNode のリサイズを React Flow ネイティブに | 中 | ✅ 完了 |
| 6 | [phase-6-cleanup.md](./phase-6-cleanup.md) | 旧コード削除 + ドキュメント更新 | 低 | ✅ 完了 |

## 移行方針

### 維持するもの（触らない）

- `useSiteboardDisplayEngine.ts` のコアロジック（mode.ts / dom.ts 含む）
- `useWebPageWebviewLifecycle.ts`（Webview 作成/破棄/イベント）
- `useSiteboardNodeRuntime.ts`（ナビゲーション状態）
- `useSiteboardKeyboard.ts`（Delete/Undo/Redo）
- `tauri-bridge.ts`（IPC 層）
- `tab-store.ts`（Zustand ストア）
- `siteboard-node-placement.ts`（重なり補正ロジック）
- `siteboard-node-frame.ts`（フレーム計算）
- `canvas-zoom.ts`（`zoomPx()` ヘルパー）

### 置き換えるもの

| 旧実装 | 移行先 |
|---|---|
| `useSiteboardPan.ts` | React Flow 組み込み pan |
| `useSiteboardZoom.ts` | React Flow 組み込み zoom |
| `useSiteboardViewportEngine.ts` | React Flow ビューポート + `onViewportChange` |
| `usePageDrag.ts` | React Flow ノードドラッグ (`onNodeDragStart/Stop`) |
| `usePageResize.ts` + `NodeResizeHandle.tsx` | React Flow `NodeResizer` |
| `InteractionOverlay.tsx` | React Flow のカーソル管理 |

## 最終状態

- pan / zoom / drag / resize は React Flow ベースに統一済み
- WebPage は TopBar のみドラッグ可能、付箋はノード本体をドラッグ可能
- viewport は Zustand に永続化しつつ、`Siteboard.tsx` の `setViewport()` 同期で project 切り替え・センタリング・復元を同じ経路で反映する
- migration 完了後の正本は `docs/agent/*.md` と現行実装

## 重要な設計決定

### 仮想化の無効化
`onlyRenderVisibleElements={false}` を設定し、React Flow の仮想化（ビューポート外ノードのアンマウント）を無効化する。Tauri ネイティブ Webview はマウント時に Webview を作成し、アンマウント時に破棄するため、仮想化があるとスクロールのたびに Webview の生成/破棄コストが発生する。

### `--canvas-zoom` CSS 変数の同期
`zoomPx()` ヘルパー（タイトルバー等のズーム補正 UI）は `--canvas-zoom` CSS 変数に依存する。`onViewportChange` 内で `containerRef.current?.style.setProperty('--canvas-zoom', viewport.zoom)` をリアルタイム更新することで引き続き動作させる。

### フェーズ 1 での薄いラッパー方式
フェーズ 1 では既存の `WebPageNode` / `StickyNoteNode` を `nodrag nopan` クラス付きのラッパーに包むだけにする。ドラッグ/リサイズは既存 hook のままにすることで、pan/zoom の移行だけを先に検証できる。
