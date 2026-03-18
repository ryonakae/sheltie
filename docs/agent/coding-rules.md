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
- **Framer Motion との競合**: ノードコンポーネント内で `motion.div layout="position"` を使用しない。React Flow が CSS transform で位置を管理しているため、`layout="position"` のスプリングアニメーション（レイアウトシフト補正）がドラッグ方向を反転させる。Canvas や外側 UI の `motion.div` には使用可（ノード外）
- `nodeTypes` 定数は**モジュールスコープで定義**。コンポーネント内に定義するとレンダーのたびにノードが再マウント（unmount→mount）される
- `nodeTypes` の定義は `src/components/ReactFlowNodes/nodeTypes.ts` に一元化（循環依存防止）

### ドラッグ機能

- **ドラッグ中の位置管理**: `Siteboard.tsx` の `draggingNodePositions` state（React state）でドラッグ中の一時位置を管理。ストアへの書き込みは `onNodeDragStop` 完了時のみ（Undo/Redo 履歴の汚染防止）
- **ハンドル指定**: `dragHandle: '.node-drag-handle'` でタイトルバーのみをドラッグ起点に。ノード本体のドラッグはスキップ
- **DisplayEngine 連携**: `onNodeDragStart` で `prepareInteractionStart('drag', nodeId)` を呼び出してスクリーンショット準備（`useSiteboardDisplayEngine` 統合）
- **重なり補正**: `onNodeDragStop` で `handleRepositionOnDragEnd` を呼び出し、禁止された重なりを単軸補正（`siteboard-runtime.md` 参照）

### リサイズ機能（フェーズ 3 以降）

- **StickyNoteNode リサイズ**: React Flow の `NodeResizer` コンポーネント（`isVisible={selected}` で選択時のみ表示）。`onResizeEnd` コールバックで リサイズ完了時にストア更新。
  - `minHeight` は動的計算: `STICKY_NOTE_HEADER_HEIGHT / zoom + STICKY_NOTE_MIN_HEIGHT`（ズーム時にヘッダー高さが変わるため）
  - `onResizeEnd(params)` で受け取る高さは **全体高さ** なため、ストア保存前にボディ高さへ変換: `params.height - STICKY_NOTE_HEADER_HEIGHT / zoom`
  - ルート要素は `size-full` でレスポンシブ化。内部コンテンツは NodeResizer のラッパーに追従
  - Framer Motion `layout` prop は使用しない（React Flow 位置管理との競合）
  - ノード内部コンテンツが fixed width/height を持つと NodeResizer による resize に追従しないため、`flex` で内部を伸縮可能にする
- **React Flow controlled mode 必須設定**:
  - `flowNodes` 構築時に `selected: node.id === selectedNodeId` を必ず明示的に設定（無いと NodeResizer の `isVisible` が常に `false` になる）
  - `onNodesChange` の `dimensions` 変更を追跡して `rfMeasured` state に保存し、`flowNodes` の `measured` プロパティに付与（未初期化状態の防止）
- **WebPageNode リサイズ**（フェーズ 5）: React Flow の `NodeResizer` コンポーネント（StickyNote と同パターン）。Siteboard.tsx の `handleWebPageResize*` コールバックで状態管理。
  - リサイズ開始時に `onResizeStart` で `prepareInteractionStart('resize', nodeId)` を fire-and-forget で実行し、Webview スクリーンショット準備とスクリーンショット表示を非同期で開始
  - `onResize` で毎フレームの寸法を `webPageResizing` state に保持し、`flowNodes` useMemo で優先適用（スナップバック防止）
  - `onResizeEnd` でストア更新と `webPageResizing` クリア、DisplayEngine 復帰
  - **NodeResizer はコンテンツ要素の後に配置すること**: これにより stacking order が上になり、`size-full` で高さを埋めるコンテンツに覆われずポインターイベントを受け取れる。また visual stacking も正しく表示される
  - **ラッパー div と内部コンポーネント両方に `size-full` が必須**: ラッパーだけでなく内部の flex コンテナにも `size-full`（= `w-full h-full`）を付けること。`w-full` のみでは高さが intrinsic になり、`flex-1` で伸縮する子要素（placeholder など）が高さ 0 に潰れる

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

### WebPageNode（React Flow NodeResizer）

- React Flow の `NodeResizer` コンポーネントでリサイズ UI を提供（`isVisible={selected}` で選択時のみ表示）。
- e/w ハンドルはネイティブ Webview に覆われるため、CSS カスタムで **幅 16px に拡張** して Webview 外に突き出す。対応 CSS ルールは `src/index.css` で定義
- リサイズ中のカーソル管理は React Flow が自動実行。

### StickyNoteNode（React Flow `NodeResizer` でリサイズ）

- React Flow の `NodeResizer` コンポーネントでリサイズ UI を提供（`isVisible={selected}` で選択時のみ表示）。
- **リアルタイム追従（controlled mode）**: `NodeResizer` の `onResize` コールバックで毎フレームの座標・寸法を state に保持し、`flowNodes` useMemo で即座に反映する（スナップバック防止）。上辺・左辺リサイズ時も `params.x / params.y` で位置を同期する。
- `onResizeEnd` コールバックで リサイズ完了時にストアを更新。
- `minWidth` / `minHeight` 制約は `NodeResizer` の props で指定（150px）。
- リサイズ中のカーソル管理は React Flow が自動実行。
- **選択時のフォーカス表示は NodeResizer のハンドル（青枠線）のみに依存**: React Flow 移行前の独自 `outline` スタイル（`isActive` で CSS outline を制御）は削除する。NodeResizer は選択時に自動的にリサイズハンドル（取得可能な8方向ハンドル）を表示するため、独自 outline は二重表示になる。

## アニメーション

- `AnimatePresence mode="wait"` + `key={value}` パターンは高頻度更新（ズームレベル・カウンター等）に使わない。exit アニメーション（120ms）完了待ちにより中間値がすべてスキップされ表示がフリーズする。
- リアルタイム表示が必要な値は単一の `motion.*` 要素で直接レンダリングし、操作完了後（例: 200ms のデバウンス）にアニメーションを発火するパターンを使う。

## useEffect と setState

- `useEffect` 本体内での同期 `setState` は `react-hooks/set-state-in-effect` ESLint エラーになる。リセット処理はクリーンアップ関数（`return () => { setState(false) }`）に移動する。

## React 18 自動バッチングと requestAnimationFrame

- React 18 は Promise の `.then()` 内の `setState` を自動バッチングし、同一レンダーサイクルに合流させる。
- 「DOM 状態 A の React レンダー → ブラウザ描画 → DOM 状態 B の React レンダー」という順序が必要な場合は、A の `setState` の後に `requestAnimationFrame` を挟んでから B の `setState` を呼ぶ。
- 具体例: コンテキストメニュー表示フローで `setDisplayModes`（スクリーンショット差し替え）完了後に `requestAnimationFrame(() => setContextMenu(...))` でメニューを表示（`siteboard-runtime.md` 参照）。

## rAF スロットリングで高頻度 setState を抑制

- `onViewportChange` など毎フレーム呼ばれるイベントハンドラー内で `setState` を直呼び出しすると、React が毎フレーム再レンダリングする。
- 高頻度更新のうち「フレームごとに1回の更新で十分」な場合は、`useRef<number | null>` で rAF ID を保持し、既に進行中なら呼び出しをスキップする。
  - パターン: ref が `null` なら `requestAnimationFrame` で callback 登録（ref に ID 保存）、callback 内で `ref = null` にリセットしてから `setState` 実行
  - **重要**: クリーンアップ effect で `cancelAnimationFrame()` を忘れずに（コンポーネント unmount 時にメモリリーク防止）
  - 具体例: `Siteboard.tsx` の `uiZoomRafRef`（パン/ズーム中の `setUiZoom` スロットリング）
- ref パターンで 1-2 フレーム遅延が許容される用途（インジケーター更新等）に適用。即座の反映が必須な場合（ドラッグ追従等）は state 直更新が必要。

## React Flow ノードには top-level `width`/`height` を必ず指定する

- React Flow は `adoptUserNodes` 内で `userNode === internalNode?.internals.userNode` の参照等価チェックを行う。
- `flowNodes` useMemo が再計算されると全ノードが新参照になりチェックが失敗し、新しい internal node が作成される。
- このとき `node.width` / `node.height`（top-level）がなければ `nodeHasDimensions()` が `false` を返し、ノードが `visibility: hidden` になる。ResizeObserver が再計測するまで1フレーム非表示になり**全ノードちらつき**が発生する。
- **対策**: `flowNodes` の各 Node オブジェクトに必ず top-level `width` と `height` を指定する。`style.width/height` ではなく Node 直下のプロパティ。
  - WebPage ノード: `width: contentWidth, height: getNodeFrameHeight({ type: 'webpage', height: contentHeight }, zoomRef.current)`
  - StickyNote ノード: `width: node.width, height: getNodeFrameHeight({ type: 'stickynote', height: node.height }, zoomRef.current)`
  - `getNodeFrameHeight` は chrome（top/bottom bar / header）込みの論理高さを返す（`src/lib/siteboard-node-frame.ts`）
