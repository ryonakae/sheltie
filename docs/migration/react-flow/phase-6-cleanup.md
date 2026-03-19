# フェーズ 6: クリーンアップ

## 目的

React Flow 移行で不要になった実装と途中経過の説明を取り除き、現行構成を正本ドキュメントに揃える。

## 完了条件

- 旧 pan / zoom / drag / resize 実装への参照が残っていない
- viewport 同期は `Siteboard.tsx` の `setViewport()` 経由に統一されている
- migration docs と `docs/agent/*.md` が現行コードと一致している

## フェーズ完了後の状態

### 削除済み

- `src/hooks/useSiteboardPan.ts`
- `src/hooks/useSiteboardZoom.ts`
- `src/hooks/siteboard/useSiteboardViewportEngine.ts`
- `src/hooks/usePageDrag.ts`
- `src/hooks/usePageResize.ts`
- `src/components/Node/NodeResizeHandle.tsx`
- `src/components/Siteboard/InteractionOverlay.tsx`
- `src/lib/reactflow-adapter.ts`

### 保持するもの

- `src/components/Node/WebPageNode.tsx`
- `src/components/Node/StickyNoteNode.tsx`

上記 2 つは「旧 UI」ではなく、React Flow カスタムノードの内部 UI として `WebPageFlowNode.tsx` / `StickyNoteFlowNode.tsx` から引き続き利用する。

## 最終構成

- pan / zoom / drag / resize は React Flow が担当する
- viewport は store に保存しつつ、`Siteboard.tsx` が `setViewport()` で React Flow 実体へ同期する
- WebPage は TopBar のみドラッグ可能
- 付箋はノード本体をドラッグ可能で、textarea や色ボタンだけ `nodrag` で保護する
- `InteractionType` は Display Engine の状態管理で継続利用し、未使用の resize 補助型だけ削除する

## 検証観点

- project 切り替え、Sidebar からの centering、新規ノード追加後の centering、起動時復元で viewport が同期する
- ホイールで pan、`CmdOrCtrl + ホイール` とピンチで zoom する
- WebPage / 付箋の drag / resize、Webview の表示切り替え、スクリーンショット復元が回帰していない
- `npm run typecheck` `npm run lint` `npm run format` が通る
