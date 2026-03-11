# コーディング規約

## MUST

- 既存コードの設計・記法・命名規則を優先する。
- コンポーネントは HeroUI v3 を優先し、不足時のみ独自実装する。
- ライブラリ/API 仕様の確認は Context7 を使う。
- import は `@/` エイリアスを使い、相対パス `../` は使わない。
- TypeScript の `strict` 前提で、未使用変数・引数を残さない。
- 実装完了時に `lint` / `format` / `typecheck` を実行する。

## SHOULD

- グローバル共有状態は Zustand、ローカル状態は `useState` を優先する。
- サイドバー幅変更のような高頻度更新は、レンダリング外の DOM 更新を使い確定時のみ store に反映する。
- Siteboard 内 UI のスケーリングは `--canvas-zoom` を使った CSS 計算で対応し、不要な再レンダーを避ける。
- コメントは「なぜ必要か」がコードだけで伝わらない箇所に限定する。

## React Flow（フェーズ 1 以降）

### ノード位置管理と Flow ラッパー

- **位置は React Flow が管理**: React Flow ノードの `position: {x, y}` には常に node の座標を設定。React Flow が `.react-flow__node` の CSS transform で絶対配置を制御
- **ノードコンポーネントから絶対配置を削除**: `StickyNoteNode`/`WebPageNode` の root element から `position: absolute` クラスと `left`/`top` スタイルを削除。これらは React Flow が管理するため不要
- **Flow ラッパー**: `src/components/ReactFlowNodes/{StickyNoteFlowNode,WebPageFlowNode}.tsx` で `nopan` クラスのみ設定し、React Flow 標準のドラッグを有効化。ドラッグハンドルは `dragHandle: '.node-drag-handle'` で タイトルバーに限定
- **自前ドラッグ実装の廃止**: 従来の `usePageDrag` 相当の自前実装は廃止。React Flow の `nodesDraggable={true}` + `onNodeDragStart`/`onNodeDragStop`/`onNodesChange` を使用。自前の `frameEl.style.left/top` 操作では React Flow の `transform: translate()` 座標系と不一致になり、ドラッグ後にノードが消える罠
- `nodeTypes` 定数は**モジュールスコープで定義**。コンポーネント内に定義するとレンダーのたびにノードが再マウント（unmount→mount）される
- `nodeTypes` の定義は `src/components/ReactFlowNodes/nodeTypes.ts` に一元化（循環依存防止）

### ドラッグ機能

- **ドラッグ中の位置管理**: `Siteboard.tsx` の `draggingNodePositions` state（React state）でドラッグ中の一時位置を管理。ストアへの書き込みは `onNodeDragStop` 完了時のみ（Undo/Redo 履歴の汚染防止）
- **ハンドル指定**: `dragHandle: '.node-drag-handle'` でタイトルバーのみをドラッグ起点に。ノード本体のドラッグはスキップ
- **DisplayEngine 連携**: `onNodeDragStart` で `prepareInteractionStart('drag', nodeId)` を呼び出してスクリーンショット準備（`useSiteboardDisplayEngine` 統合）
- **重なり補正**: `onNodeDragStop` で `handleRepositionOnDragEnd` を呼び出し、禁止された重なりを単軸補正（`siteboard-runtime.md` 参照）

### ビューポート管理

- **React Flow ネイティブ委譲**: `panActivationKeyCode="Space"`（スペースキーでパン）、`panOnDrag={[0, 1]}`（マウス左/中ボタンでパン）、`zoomOnScroll={true}`（ホイールズーム）
- `onViewportChange` で React Flow viewport を `zoomRef/panXRef/panYRef` に同期し、同時に `--canvas-zoom` CSS 変数を更新（`zoomPx()` calc 関数が UI スケーリングを計算するため必須）
- viewport 変更をプロジェクト state に反映する場合は debounce で遅延更新し、高頻度な setState を避ける

### ラッパー内部構造

- Flow ノードの `style` に `width`, `height`（ズーム補正後）をセット
- Flow ノードの `data` に `nodeProps` 構造体を格納し、ラッパー内で子コンポーネント（`StickyNoteNode`/`WebPageNode`）にスプレッド。位置（`x`, `y`）は `{x: 0, y: 0}` に正規化してコンポーネント側で無視させる

## Siteboard/Webview 変更時の必読

- 表示モード遷移・スクリーンショット切替・操作中の制約は `siteboard-runtime.md` を正本とする。
- IPC の追加・変更は `tauri-ipc.md` と実装を同時に更新する。

## ファイルシステム / アセットプロトコル

- `convertFileSrc(filePath)` でローカルファイルパスを `asset://` URL に変換してフロントエンドから読み込める。
- **前提条件**: `Cargo.toml` に `protocol-asset` feature、`tauri.conf.json` に `app.security.assetProtocol.enable = true` と scope の両方が必要。片方欠けても動作しない。
- `core:asset:default` は Tauri v2 の有効な capabilities パーミッションではないため使わない。
- キャッシュバスティングが必要な場合は `convertFileSrc(path) + '?t=' + Date.now()` を使う。

## UI/スタイル

- スタイルは Tailwind CSS v4 を利用する。
- クラス順序は ESLint/Prettier の整形結果に従う。

## タイトルバー制御

- Tauri v2 では `data-tauri-drag-region` を利用する。
- ドラッグ可能領域は要素ごとに明示する（暗黙継承を前提にしない）。

## ノード操作 UI

- ノード右上の閉じるボタン（インライン Xmark）は設けない。削除は以下の 3 経路に統一する:
  1. Delete / Backspace キー（`useSiteboardKeyboard` で処理。テキスト入力フォーカス中はスキップ）
  2. メニューバー `Edit -> Delete`（Tauri メニューイベントを `edit-command` として受信）
  3. ノードまたはサイドバーアイテムの右クリック → コンテキストメニュー「ノードを削除」
- Undo/Redo は `CmdOrCtrl+Z` / `CmdOrCtrl+Shift+Z` とメニューバー `Edit -> Undo / Redo` を同じ `edit-command` 経路で処理する。
- キーボードショートカットとメニューイベントは `lib/edit-commands.ts` に集約し、各画面コンポーネントへ分散実装しない。
- コンテキストメニューは `components/Common/ContextMenu` を使い createPortal で body 直下に描画する。
- node 削除の呼び出しは `screens/Project.tsx` に集約し、`Sidebar` と `Siteboard` には `onRemoveNode` prop として渡す。
- File メニューの `open` / `save` / `save-as` 処理は `lib/file-commands.ts` に集約し、画面コンポーネントへ分散実装しない。

## リサイズハンドルとカーソル制御

- `NodeResizeHandle` のカーソルは Tailwind cursor クラスでなく **inline style** で設定する（CSS 優先度問題の回避）。
- e/w ハンドルはネイティブ Webview に覆われるため、ハンドル要素を **外側 -4px 拡張**（16px 幅）して Webview 外に突き出す。
- リサイズ中の `InteractionOverlay` カーソルは `useSiteboardViewportEngine` が `onInteractionChange(direction)` 経由で `RESIZE_CURSOR_MAP` から解決して渡す。
- `overflow-hidden` + `border-radius` をノード外側 div に設定するとコーナーハンドルがクリッピングされる。**`overflow-hidden` は TopBar/BottomBar などの子要素側に移動し、外側 div には設定しない。**
- `onMouseDown` で `e.stopPropagation()` を呼ぶハンドラーには **必ず `if (e.button !== 0) return;` を先頭に置く**。右クリック（button=2）時に伝播を止めると `contextmenu` イベントが親コンポーネントに届かなくなる。`startDrag` / `startResize` も同様。

## アニメーション

- `AnimatePresence mode="wait"` + `key={value}` パターンは高頻度更新（ズームレベル・カウンター等）に使わない。exit アニメーション（120ms）完了待ちにより中間値がすべてスキップされ表示がフリーズする。
- リアルタイム表示が必要な値は単一の `motion.*` 要素で直接レンダリングし、操作完了後（例: 200ms のデバウンス）にアニメーションを発火するパターンを使う。

## useEffect と setState

- `useEffect` 本体内での同期 `setState` は `react-hooks/set-state-in-effect` ESLint エラーになる。リセット処理はクリーンアップ関数（`return () => { setState(false) }`）に移動する。

## React 18 自動バッチングと requestAnimationFrame

- React 18 は Promise の `.then()` 内の `setState` を自動バッチングし、同一レンダーサイクルに合流させる。
- 「DOM 状態 A の React レンダー → ブラウザ描画 → DOM 状態 B の React レンダー」という順序が必要な場合は、A の `setState` の後に `requestAnimationFrame` を挟んでから B の `setState` を呼ぶ。
- 具体例: コンテキストメニュー表示フローで `setDisplayModes`（スクリーンショット差し替え）完了後に `requestAnimationFrame(() => setContextMenu(...))` でメニューを表示（`siteboard-runtime.md` 参照）。
