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
- Siteboard 内 UI のスケーリングは `--canvas-zoom` を使った CSS 計算で対応し、不要な再レンダーを避ける。
- コメントは「なぜ必要か」がコードだけで伝わらない箇所に限定する。

## Document App

- 1 document tab / window = 1 document を前提にする。ホーム画面やプロジェクト一覧は置かない。
- 表示名はファイル basename を正本にし、未保存時だけ `名称未設定` 系の仮名を使う。
- `project.title` のような表示名を永続状態の正本にしない。必要なら `filePath` から導出する。
- `main` のような固定 window label を前提にしない。window-local な処理は現在の window から解決する。
- macOS の document window は native tab group ごとに固有の `tabbingIdentifier` を共有する。`New Window` は新しい standalone group を開き、`New Tab` は hidden child を起動後、renderer ready 後に host 限定の explicit attach で同じ group に追加する。1 タブ状態で tab bar を強制表示しない。
- `File > New Tab/New Window/Open/Save/Save As` は document window のコマンドとして扱い、メニューやショートカットの実装を window-local に保つ。
- macOS の File ショートカットは `Cmd+T = New Tab`、`Cmd+N = New Window`、`Open` は別 document window を開く Finder 互換挙動にそろえる。
- 表示名の変更は `Save As` で行う。rename 専用 UI や project title 編集を増やさない。

## React Flow（フェーズ 1 以降）

### ノード位置管理と Flow ラッパー

- **位置は React Flow が管理**: React Flow ノードの `position: {x, y}` には常に node の座標を設定。React Flow が `.react-flow__node` の CSS transform で絶対配置を制御
- **ノードコンポーネントから絶対配置を削除**: `StickyNoteNode`/`WebPageNode` の root element から `position: absolute` クラスと `left`/`top` スタイルを削除。これらは React Flow が管理するため不要
- **Flow ラッパー**: `src/components/ReactFlowNodes/{StickyNoteFlowNode,WebPageFlowNode}.tsx` で `nopan` クラスのみ設定し、React Flow 標準のドラッグを有効化する
- **WebPage のドラッグ起点**: `dragHandle: '.node-drag-handle'` を `WebPageNode` 本体内の上下 chrome shell に付け、上下バーの空き領域からだけドラッグできるようにする
- **node 内ツールバー**: WebPage のツールバーは `NodeToolbar` を使わず、ノード本体と同じ DOM 階層に描く。重なり順はノード本体と一体で扱い、ポータル前提の click-through は使わない
- **ツールバーの固定サイズ**: canvas zoom 中も文字・ボタン・アイコンの画面上サイズを固定したい UI は `zoomPx()` と `AppButton scaleWithCanvasZoom` を使う。高さ、padding、gap、font-size、icon size、border 幅を world 座標へ直接ハードコードしない
- **付箋のドラッグ起点**: 付箋はノード本体をドラッグ可能にし、textarea などの操作要素だけを `nodrag` で保護する。スタイル変更は選択時に `NodeToolbar` で表示する
- **付箋本文の編集開始**: 付箋本文は未選択時のクリックで選択だけ行い、選択済みの本文エリアを再度クリックした時だけ編集を開始する。リサイズ操作やツールバー操作からは編集開始しない
- **自前ドラッグ実装の廃止**: 従来の `usePageDrag` 相当の自前実装は廃止。React Flow の `onNodeDragStart`/`onNodeDragStop`/`onNodesChange` を使用する。自前の `frameEl.style.left/top` 操作では React Flow の `transform: translate()` 座標系と不一致になり、ドラッグ後にノードが消える罠
- **Framer Motion との競合**: ノードコンポーネント内で `motion.div layout="position"` を使用しない。React Flow が CSS transform で位置を管理しているため、`layout="position"` のスプリングアニメーション（レイアウトシフト補正）がドラッグ方向を反転させる。Canvas や外側 UI の `motion.div` には使用可（ノード外）
- `nodeTypes` 定数は**モジュールスコープで定義**。コンポーネント内に定義するとレンダーのたびにノードが再マウント（unmount→mount）される
- `nodeTypes` の定義は `src/components/ReactFlowNodes/nodeTypes.ts` に一元化（循環依存防止）

### ドラッグ機能

- **ドラッグ中の位置管理**: `Siteboard.tsx` の `draggingNodePositions` state（React state）でドラッグ中の一時位置を管理。ストアへの書き込みは `onNodeDragStop` 完了時のみ（Undo/Redo 履歴の汚染防止）
- **ハンドル指定**: WebPage は上下 chrome gutter に `dragHandle: '.node-drag-handle'` を使う。付箋はノード本体をドラッグ起点にする
- **DisplayEngine 連携**: `onNodeDragStart` で `prepareInteractionStart('drag', nodeId)` を呼び出してスクリーンショット準備（`useSiteboardDisplayEngine` 統合）
- **重なり補正**: `onNodeDragStop` で `handleRepositionOnDragEnd` を呼び出し、禁止された重なりを単軸補正（`siteboard-runtime.md` 参照）

### リサイズ機能（フェーズ 3 以降）

- **StickyNoteNode リサイズ**: React Flow の `NodeResizeControl` は四隅ハンドルだけを使い、選択枠の線は共通 `SelectionFrameOverlay` で外側に描く。手動リサイズは**横幅変更のみ**許可し、高さは入力内容に応じた自動調整に委譲する。
  - 付箋に chrome は無く、保存する `height` は本文エリアの高さそのもの
  - 手動リサイズの制約は `minWidth = STICKY_NOTE_MIN_WIDTH` のみを使う
  - 自動高さは `STICKY_NOTE_MIN_HEIGHT` を下限に `updateNodeSizeWithoutHistory` で反映し、Undo/Redo 履歴を積まない
  - ルート要素は `size-full` でレスポンシブ化。内部コンテンツは横方向の width 変更に追従する
  - Framer Motion `layout` prop は使用しない（React Flow 位置管理との競合）
  - ノード内部コンテンツが fixed width/height を持つと width リサイズ後の折り返しと自動高さが破綻するため、`flex` で内部を伸縮可能にする
- **React Flow controlled mode 必須設定**:
  - `flowNodes` 構築時に `selected: selectedNodeIdSet.has(node.id)` を必ず明示的に設定（無いと選択連動の枠表示や複数選択ドラッグが動かない）。リサイズハンドルなど単独選択時のみ表示したい UI は、`selected` ではなく `isActive`（`selectedNodeIds.length === 1` の場合のみ true）でゲートする
  - `onNodesChange` の `dimensions` 変更を追跡して `rfMeasured` state に保存し、`flowNodes` の `measured` プロパティに付与（未初期化状態の防止）
  - `onNodesChange` の `select` 変更は複数同時に届くため、Set でまとめて反映してから配列に戻す。React Flow の Shift+クリック / ドラッグ範囲選択も全てこの経路で多選択になる
- **WebPageNode リサイズ**（フェーズ 5）: React Flow の `NodeResizeControl` を 8 個明示配置する。可視の選択枠は共通 `SelectionFrameOverlay` で描き、line 4 本は上下左右リサイズ用の不可視 hit area、corner handle 4 個は付箋ノードと同じく選択線の交点基準に置く。見えている上下バー面とタイトル/操作 UI はどちらも `WebPageNode` 本体内に描く。Siteboard.tsx の `handleWebPageResize*` コールバックで状態管理。
  - リサイズ開始時に `onResizeStart` で `prepareInteractionStart('resize', nodeId)` を fire-and-forget で実行し、Webview スクリーンショット準備とスクリーンショット表示を非同期で開始
  - `onResize` で毎フレームの寸法を `webPageResizing` state に保持し、`flowNodes` useMemo で優先適用（スナップバック防止）
  - `onResizeEnd` でストア更新と `webPageResizing` クリア、DisplayEngine 復帰
  - **ラッパー div と内部コンポーネント両方に `size-full` が必須**: ラッパーだけでなく内部の flex コンテナにも `size-full`（= `w-full h-full`）を付けること。`w-full` のみでは高さが intrinsic になり、`flex-1` で伸縮する子要素（placeholder など）が高さ 0 に潰れる

### テキストノード

- **透明背景**: テキストノードは chrome なし（`getNodeChromeScreenHeight` が 0 を返す）。選択枠は付箋と同じく `SelectionFrameOverlay` で外側に描く（編集中も表示する）
- **ダブルクリックで編集モード**: シングルクリックで選択+ドラッグ可能、ダブルクリックで Tiptap エディタが `editable` になりテキスト入力可能。編集中は `nodrag` で移動を抑制
- **編集モード終了**: Escape キーまたはノード外クリック（blur）で終了。終了時に Tiptap JSON を store に保存し、Undo/Redo 用のスナップショットが積まれる
- **空ノードの自動削除**: 選択解除のタイミングで `isTextNodeEmpty(node)` が true ならノードを自動削除する（Siteboard.tsx の useEffect 経路）
- **NodeToolbar**: React Flow の `<NodeToolbar>` を使用して書式設定 UI を表示（選択時のみ）。ツールバー内のインタラクティブ要素には `nodrag` クラスを付与。付箋の `NodeToolbar` も同じ方針
- **幅モード**: 初期は `'auto'`（テキスト幅に追従、本文ラッパーが `display: inline-block; width: max-content; min-width: TEXT_NODE_MIN_WIDTH` で natural width を取る）。`NodeResizeControl` でドラッグすると `'fixed'` に切り替わり、ボックス幅で折り返す。リサイズハンドルは常に表示（左右辺の line 2 個 + 四隅の handle 4 個、付箋と同じ構成）し、いずれかをダブルクリックで `'auto'` に戻す
- **幅自動調整**: `widthMode === 'auto'` の間、本文ラッパーの `offsetWidth` を ResizeObserver + Tiptap `update` イベントで監視し、`onAutoWidthChange` 経由で `updateNodeSizeWithoutHistory` に反映する
- **高さ自動調整**: `contentRef.scrollHeight` を監視し、`updateNodeSizeWithoutHistory` で反映（Undo/Redo 履歴を積まない）
- **Tiptap 設定**: StarterKit から不要な Extension（blockquote, list, code 等）を除外。Placeholder Extension で空エディタにプレースホルダーを表示
- **Undo/Redo 2層構造**: 編集モード中は Tiptap 内部の History が Cmd+Z を処理。編集モード終了時に store にスナップショットが積まれ、ノードレベルの Undo/Redo と統合

### ビューポート管理

- **React Flow ネイティブ委譲**: `panOnDrag={[1]}`（ミドルドラッグでパン）、`panOnScroll={true}`（修飾なしホイールでパン）、`zoomOnScroll={true}`（`CmdOrCtrl + ホイール` でズーム）、`zoomOnPinch={true}`（ピンチズーム）
- `onViewportChange` で React Flow viewport を `zoomRef` と内部 viewport ref に同期し、同時に `--canvas-zoom` CSS 変数を更新する
- layout 用 zoom は `uiZoom` を正本にし、rAF スロットリング経由で `flowNodes` の高さ計算と Web resize control の `minHeight` 制約へ反映する
- project 切り替え・centering・復元で store 側 viewport が変わった時は `setViewport()` で React Flow 実体へ反映する
- viewport 変更をプロジェクト state に反映する場合は debounce で遅延更新し、高頻度な setState を避ける

### ラッパー内部構造

- Flow ノードの top-level `width`, `height` に寸法をセットする
- Flow ノードの `data` に `nodeProps` 構造体を格納し、ラッパー内で子コンポーネント（`StickyNoteNode`/`WebPageNode`）にスプレッド。位置（`x`, `y`）は `{x: 0, y: 0}` に正規化してコンポーネント側で無視させる

### エッジ接続

- **Handle は WebPageFlowNode のみ**に配置。StickyNote / TextNode には Handle を追加しない
- Handle 自身は透明な 16px のヒット領域。視覚的な丸は Handle の子として「外側の辺の中点」に絶対配置する。React Flow の端点計算（非 center モード）は handle の外側の辺を使うため、ここに丸の中心を揃えることで「線の始点 = 丸の中心」が一致する
- 4 方向（top, right, bottom, left）に `type="source"` の Handle を常時レンダリング。`pointerEvents` は無効化しない（接続ドラッグの target 検出に必要）
- 丸（子要素）の表示条件: `selected` または「接続ドラッグ中かつこのノードに pointer がある」。前者は React Flow の `selected` prop、後者は `useConnection` の `inProgress` + 自前の `onPointerEnter/Leave` で判定する。`useConnection` の `toNode` は handle 近接時しか更新されないため、ノード本体ホバー検出には使えない
- `connectionMode="loose"` で source 同士の接続を許可、`isValidConnection` で自己接続を禁止
- エッジは `components/ReactFlowEdges/ArrowEdge.tsx` のカスタムエッジ。ベジェ path（`BaseEdge`）+ 始点ドット + 終端矢じり（SVG）を自前で描画。色は `selected` で `var(--accent)` / `var(--border)` を出し分け（HeroUI v3 テーマ追従）
- ドラッグ中の接続線は `ArrowConnectionLine` を `connectionLineComponent` に登録。完成エッジと同じ見た目で描き、`fromX/fromY`（React Flow が返す handle 幾何中心）を `Position` 方向に `(WEBPAGE_HANDLE_HIT_SIZE / 2) / zoom` シフトして ArrowEdge の端点（handle 外側の辺 = 視覚的な丸の中心）と一致させる。矢印形状と Handle サイズの定数は `arrowGeometry.ts` で共有
- WebPageFlowNode の Handle は当たり判定（`WEBPAGE_HANDLE_HIT_SIZE`、透明）と視覚の丸（`WEBPAGE_HANDLE_VISUAL_DOT_SIZE`、青）を分離する。ヒット領域を視覚より大きく取り、ドラッグ開始と吸着のクリック判定を広げる。両者ともズーム非依存（`--canvas-zoom` で割る）。Handle 中心から外側の辺（=丸の中心）までの距離は `HIT_SIZE / 2` の前提で `ArrowConnectionLine` のオフセットを揃える
- 吸着スナップ範囲は ReactFlow の `connectionRadius`（既定 20）で調整する。Handle のヒット領域より広めに取って近接時の吸着を出やすくする
- エッジの選択状態は controlled mode のため Siteboard 側で自前同期する（`selectedEdgeIds` Set を `onEdgesChange` の `select` 変更で更新し、`flowEdges` に `selected` を反映）。これを行わないと選択時のスタイル変化が出ない
- エッジの削除は選択 + `Backspace` / `Delete` キー（`onEdgesChange` で `remove` タイプを処理）
- エッジの永続化は `Project.edges` / `SiteboardDocumentV2.edges` に保存。Undo/Redo はノードと統合スナップショットで管理

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

### マウスカーソル

- 既定はすべて `default`。ボタン・リンク・ノード・パン・接続ドラッグなどでも `pointer` / `grab` / `crosshair` を出さない。`src/index.css` で HeroUI の `--cursor-interactive` と React Flow の各 cursor を `default` に上書きしている。
- 例外は 2 つ:
  - **リサイズハンドル**: React Flow の `.react-flow__resize-control.handle` 系の既定 cursor（`ew/ns/nwse/nesw-resize`）をそのまま維持する。
  - **テキスト編集中**: StickyNote / TextNode は編集時にコンテナへ `cursor-text` クラスを付与する。新しい編集 UI を追加する場合も同じ方針で明示的に `cursor: text` を付ける。

## タイトルバー制御

- document window は `TitleBarStyle::Visible` を使う（標準の macOS タイトルバー）。
- Tauri v2 では `data-tauri-drag-region` を利用する。
- ドラッグ可能領域は要素ごとに明示する（暗黙継承を前提にしない）。

## テーマ切り替え

- ウィンドウ内にテーマボタンは置かない。テーマ切り替えはアプリメニュー `Siteboard > Settings > Theme` の Light / Dark / System から行う（macOS のみ。`lib.rs` の `insert_settings_submenu`）。
- 各項目は `CheckMenuItem` で、現在モードにチェックを付ける。クリック時は `update_theme_check_state` で他項目のチェックを外し、`theme-command` イベントを focused window へ emit する。
- フロント側は `setupThemeListener` で `theme-command` を受信し、`useThemeStore.setMode` を呼ぶ（`src/store/theme-store.ts`）。

## ノード操作 UI

- ノード右上の閉じるボタン（インライン Xmark）は設けない。削除は以下の 3 経路に統一する:
  1. Delete / Backspace キー（`useSiteboardKeyboard` で処理。テキスト入力フォーカス中はスキップ）
  2. メニューバー `Edit -> Delete`（Tauri メニューイベントを `edit-command` として受信）
  3. ノードの右クリック → コンテキストメニュー「ノードを削除」
- ノードの重なり順変更は付箋・テキストノードのみ対象（WebPageNode は重なれないため除外）。配列順で管理し、WebPageNode をスキップして付箋/テキスト同士の順序を操作する。操作経路:
  1. コンテキストメニュー「最前面へ / 1つ前面へ / 1つ背面へ / 最背面へ」（配列の端にいる場合は disabled）
  2. キーボードショートカット `Cmd+Alt+]` / `Cmd+]` / `Cmd+[` / `Cmd+Alt+[`（Figma 準拠）
- Undo/Redo は `CmdOrCtrl+Z` / `CmdOrCtrl+Shift+Z` とメニューバー `Edit -> Undo / Redo` を同じ `edit-command` 経路で処理する。
- キーボードショートカットとメニューイベントは `lib/edit-commands.ts` に集約し、各画面コンポーネントへ分散実装しない。
- コンテキストメニューは `@tauri-apps/api/menu` の `Menu.new()` + `popup()` で macOS ネイティブメニューとして表示する。
- node 削除の呼び出しは `screens/Project.tsx` に集約し、`Siteboard` には `onRemoveNode` 相当の handler として渡す。
- エッジ（矢印）の右クリック → コンテキストメニュー「矢印の向きを入れ替え / 矢印を削除」。`onEdgeContextMenu` でそのエッジを選択状態にしてからネイティブメニューを表示する。Webview 表示制御（`handleContextMenuOpen`）はノード向けの仕組みなので呼ばない。
- エッジの Delete / Backspace 削除は `useSiteboardKeyboard` で扱う（選択中ノードがあればノード削除を優先、なければ選択中エッジを削除）。React Flow の `deleteKeyCode` は `null` で無効化する。組み込みの delete を有効にすると、ノード削除時に「connected edges の remove イベント → `store.removeEdges`」と「キーハンドラ → `store.removeNode`（edges を cascade 削除）」が二重に履歴へ積まれ、Cmd+Z 1 回で edges が復元されない。
- File メニューの `new-tab` / `new-window` / `open` / `save` / `save-as` 処理は `lib/file-commands.ts` に集約し、画面コンポーネントへ分散実装しない。
- View メニューの `fit-view` / `reset-zoom` / `zoom-in` / `zoom-out` 処理は `lib/view-commands.ts` に集約する。ハンドラの登録は `Siteboard.tsx` 内の `registerViewCommandHandlers` で行う。
- `Cmd+=` は macOS が `Cmd+Shift+=` として解釈するためネイティブメニューショートカットでは拾えない。`useSiteboardKeyboard` 内で `e.key === '='` を検出して `runViewCommand('zoom-in')` を直接呼ぶことで補完する。
- **Edit / File / View コマンドのリスナー登録時は `api.onEditCommand()` / `api.onFileCommand()` / `api.onViewCommand()` を使う**（内部で `getCurrentWebviewWindow().listen()` を使用）。グローバル `listen()` を直接使うと、複数の document window が存在する場合に各ウィンドウで重複実行される
- document window 関連のコマンドや IPC は window-local に閉じ、`main` 固定の参照を増やさない。
- child webview の label は `page-{windowLabel}-{pageId}` のように親 document window を含めて一意化する。

## リサイズハンドルとカーソル制御

### WebPageNode（React Flow `NodeResizeControl` を 8 方向で明示配置）

- React Flow の `NodeResizeControl` を 8 個配置し、選択時のみ表示する。
- 見えている上下バー面とタイトル/ボタンなどの操作 UI はどちらも `WebPageNode` 本体内に描く。
- 可視の青い選択線は共通 `SelectionFrameOverlay` が描き、Web の line 要素は `src/index.css` で選択線をまたぐ resize hit area とカーソルを持たせる。
- 角ハンドルは付箋ノードと同じく選択線の交点に中心が乗る配置を使う。
- リサイズカーソルは inline style ではなく `NodeResizeControl` の class と `src/index.css` で管理する。
- top / bottom chrome は `dragHandle: '.node-drag-handle'` を維持し、ボタン類は `nodrag` と `onMouseDown` で drag 開始を止める。

### StickyNoteNode（React Flow `NodeResizeControl` で左右辺 + 四隅ハンドルを表示）

- React Flow の `NodeResizeControl` は左右辺の line 2 個と四隅の handle 4 個を配置し、すべて左右幅リサイズとして扱う。
- 選択枠の四辺の青線は `NodeResizeControl` の line ではなく、共通 `SelectionFrameOverlay` がノード外側に描く。
- **リアルタイム追従（controlled mode）**: 四隅ハンドルの `onResize` コールバックで毎フレームの座標・寸法を state に保持し、`flowNodes` useMemo で即座に反映する（スナップバック防止）。左側ハンドル使用時は `params.x` で位置も同期する。
- `onResizeEnd` コールバックで横幅だけをストア更新し、高さは現在の本文高さをそのまま維持する。
- `minWidth` 制約は `STICKY_NOTE_MIN_WIDTH` のみを指定し、`minHeight` は使わない。
- 本文高さはテキスト内容と現在幅から自動計測し、`STICKY_NOTE_MIN_HEIGHT` を下限に `updateNodeSizeWithoutHistory` で反映する。
- top/bottom 中央は interactive にせず、左右辺と四隅だけに `ew-resize` を与える。カーソル管理は `NodeResizeControl` の class と `src/index.css` で統一する。
- **選択時のフォーカス表示は React Flow のリサイズ UI のみに依存**: React Flow 移行前の独自 `outline` スタイル（`isActive` で CSS outline を制御）は削除する。独自 outline を重ねると二重表示になる。

## 既知の罠（Pitfalls）

### アニメーション

- `AnimatePresence mode="wait"` + `key={value}` パターンは高頻度更新（ズームレベル・カウンター等）に使わない。exit アニメーション（120ms）完了待ちにより中間値がすべてスキップされ表示がフリーズする。
- リアルタイム表示が必要な値は単一の `motion.*` 要素で直接レンダリングし、操作完了後（例: 200ms のデバウンス）にアニメーションを発火するパターンを使う。

### useEffect と setState

- `useEffect` 本体内での同期 `setState` は `react-hooks/set-state-in-effect` ESLint エラーになる。リセット処理はクリーンアップ関数（`return () => { setState(false) }`）に移動する。

### React 18 自動バッチングと requestAnimationFrame

- React 18 は Promise の `.then()` 内の `setState` を自動バッチングし、同一レンダーサイクルに合流させる。
- 「DOM 状態 A の React レンダー → ブラウザ描画 → DOM 状態 B の React レンダー」という順序が必要な場合は、A の `setState` の後に `requestAnimationFrame` を挟んでから B の `setState` を呼ぶ。
- 具体例: コンテキストメニュー表示フローで `setDisplayModes`（スクリーンショット差し替え）完了後に `requestAnimationFrame(() => setContextMenu(...))` でメニューを表示（`siteboard-runtime.md` 参照）。

### rAF スロットリングで高頻度 setState を抑制

- `onViewportChange` など毎フレーム呼ばれるイベントハンドラー内で `setState` を直呼び出しすると、React が毎フレーム再レンダリングする。
- 高頻度更新のうち「フレームごとに1回の更新で十分」な場合は、`useRef<number | null>` で rAF ID を保持し、既に進行中なら呼び出しをスキップする。
  - パターン: ref が `null` なら `requestAnimationFrame` で callback 登録（ref に ID 保存）、callback 内で `ref = null` にリセットしてから `setState` 実行
  - **重要**: クリーンアップ effect で `cancelAnimationFrame()` を忘れずに（コンポーネント unmount 時にメモリリーク防止）
  - 具体例: `Siteboard.tsx` の `uiZoomRafRef`（パン/ズーム中の `setUiZoom` スロットリング）
- ref パターンで 1-2 フレーム遅延が許容される用途（インジケーター更新等）に適用。即座の反映が必須な場合（ドラッグ追従等）は state 直更新が必要。

### React Flow ノードには top-level `width`/`height` を必ず指定する

- React Flow は `adoptUserNodes` 内で `userNode === internalNode?.internals.userNode` の参照等価チェックを行う。
- `flowNodes` useMemo が再計算されると全ノードが新参照になりチェックが失敗し、新しい internal node が作成される。
- このとき `node.width` / `node.height`（top-level）がなければ `nodeHasDimensions()` が `false` を返し、ノードが `visibility: hidden` になる。ResizeObserver が再計測するまで1フレーム非表示になり**全ノードちらつき**が発生する。
- **対策**: `flowNodes` の各 Node オブジェクトに必ず top-level `width` と `height` を指定する。`style.width/height` ではなく Node 直下のプロパティ。
  - WebPage ノード: `width: contentWidth, height: getNodeFrameHeight({ type: 'webpage', height: contentHeight }, uiZoom)`
  - StickyNote ノード: `width: node.width, height: getNodeFrameHeight({ type: 'stickynote', height: node.height }, uiZoom)`
  - `getNodeFrameHeight` は chrome（WebPage の top/bottom bar）込みの論理高さを返す（`src/lib/siteboard-node-frame.ts`）。StickyNote / Text は chrome 0 で本文高さそのもの
  - `uiZoom` は layout 用の reactive 値、`zoomRef.current` はイベント中の即時計算用として役割を分ける
