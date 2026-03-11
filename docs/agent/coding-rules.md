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
  1. Delete / Backspace キー（`useSiteboardKeyboard` で処理。選択中の node 群があれば node 群、無ければ edge 群を削除する）
  2. メニューバー `Edit -> Delete`（Tauri メニューイベントを `edit-command` として受信）
  3. ノード / edge / サイドバーアイテムの右クリック → コンテキストメニューから削除
- Undo/Redo は `CmdOrCtrl+Z` / `CmdOrCtrl+Shift+Z` とメニューバー `Edit -> Undo / Redo` を同じ `edit-command` 経路で処理する。
- キーボードショートカットとメニューイベントは `lib/edit-commands.ts` に集約し、各画面コンポーネントへ分散実装しない。
- コンテキストメニューは `components/Common/ContextMenu` を使い createPortal で body 直下に描画する。
- node 削除の呼び出しは `screens/Project.tsx` に集約し、`Sidebar` と `Siteboard` には `onRemoveNode` prop として渡す。
- File メニューの `open` / `save` / `save-as` 処理は `lib/file-commands.ts` に集約し、画面コンポーネントへ分散実装しない。

## リサイズハンドルとカーソル制御

- React Flow のリサイズは `NodeResizeControl` を使い、ハンドルのヒット領域やカーソルは **inline style** で上書きする（CSS 優先度問題の回避）。
- e/w ハンドルや source / target handle はネイティブ Webview に覆われるため、ヒット領域を **外側に張り出す** 形で置く。
- リサイズ中の `InteractionOverlay` カーソルは `Siteboard.tsx` から `useSiteboardDisplayEngine.handleInteractionChange()` へ渡し、必要に応じて `RESIZE_CURSOR_MAP` 相当の cursor を明示する。
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

## 高頻度更新での React state Bailout 回避

rAF 毎フレームで更新が必要な値（カーソルスタイル、表示モード属性等）は React state で管理すると、state 更新 → レンダリング → React の内部 Bailout チェック（前フレームと同じ値なら描画スキップ）という処理が毎フレーム走り、CPU 消費が増える。

**パターン**: 高頻度な値は `useState` ではなく DOM 属性（`element.setAttribute()`）で直接操作し、必要に応じて CSS で参照する。

```typescript
// ❌ 避ける（毎フレーム state 更新 → Bailout チェック）
const [cursor, setCursor] = useState('default');
return <div style={{ cursor }} />;

// ✅ 推奨（DOM 属性で直接制御）
const containerRef = useRef<HTMLDivElement>(null);
containerRef.current?.setAttribute('data-interaction-cursor', 'resize-ew');
// CSS: [data-interaction-cursor='resize-ew'] { cursor: ew-resize; }
```

## react-flow 統合パターン

### 全 change の処理と ResizeObserver ループ対策

**基本原則**: `onNodesChange` で受け取った全ての change（position・dimensions）を適用する必要がある。ただし **操作中（drag/resize/zoom/pan）の場合は例外** である。

**操作中の特別処理** (`handleNodesChange` in `Siteboard.tsx`):
- zoom 操作中に `--canvas-zoom` CSS が毎フレーム更新されると、その値を参照する `calc()` 式のノードサイズが変化し、ResizeObserver が自動的に dimensions change を発火させる
- このイベントが `applyNodeChanges` で state 更新されるとチラつきと layout thrashing が発生
- **対策**: 操作中（`activeInteractionsRef.current.size > 0`）は `applyNodeChanges` を完全スキップし、position change のみ手動で flow node 上に適用。dimensions は操作終了後の確定タイミングで state に反映

```typescript
// ❌ 避ける（ResizeObserver フィードバックループ）
const updatedFlowNodes = applyNodeChanges(changes, flowNodesRef.current);

// ✅ zoom 中の処理パターン
if (activeInteractionsRef.current.size > 0) {
  // position change のみ手動適用
  const positionChanges = changes.filter((c) => c.type === 'position');
  // ... 手動で flowNodesRef を更新
} else {
  // 操作終了時は全ての change を applyNodeChanges で処理
  const updatedFlowNodes = applyNodeChanges(changes, flowNodesRef.current);
}
```

**重要**: CSS Custom Property と flow state の二重対策が揃って初めてループが断ち切られる。片方だけでは不充分。

### FlowNode data の簡素化（重要）

ハンドラ関数を FlowNode の `data` に埋め込まない。

```typescript
// ❌ 避ける
interface WebPageFlowNodeData {
  node: WebPageNodeModel;
  onGoBack: (nodeId: string) => void;
  onGoForward: (nodeId: string) => void;
  // ...
}

// ✅ 推奨
interface WebPageFlowNodeData {
  node: WebPageNodeModel;
}
```

理由: `data` オブジェクトが毎回新規生成されると、react-flow の shallow comparison で「変更あり」と判定され全ノードが再レンダリングされる。ハンドラは `useSiteboardNodeHandlers()` Context hook で取得する。

### ハンドラ Context 配信パターン

`SiteboardNodeHandlersProvider` で全ハンドラを Context 経由で配信し、ノードコンポーネント側は `useSiteboardNodeHandlers()` フックで取得。

```typescript
// Siteboard.tsx
const stableNodeDataHandlers = useMemo(() => ({
  onGoBack: (nodeId) => nodeDataHandlersRef.current.handleGoBack(nodeId),
  // ...
}), []);

return (
  <SiteboardNodeHandlersProvider handlers={stableNodeDataHandlers}>
    <ReactFlow nodes={flowNodes} onNodesChange={handleNodesChange} ... />
  </SiteboardNodeHandlersProvider>
);

// WebPageNode.tsx
const handlers = useSiteboardNodeHandlers();
handlers.onGoBack(node.id);
```

### framer-motion との干渉回避

React Flow ノード内で framer-motion を使う場合、`layout="position"` は避ける。react-flow と framer-motion が両者とも transform を操作するため干渉して重複したアニメーション / チラつきが発生する。

```typescript
// ❌ React Flow ノード内では避ける
<motion.div layout="position" />

// ✅ 通常の div を使う
<div />
```

## ハンドラ安定化パターン（ref + useMemo）

**背景**:
- Siteboard では 20+ のハンドラが `buildFlowNode` の依存配列に含まれると、1つハンドラが変わるだけで全ノード再構築のカスケードが発生して性能劣化する。

**実装パターン（`Siteboard.tsx` 参照）**:
1. 全ハンドラを `useRef` に保持し、毎レンダー後に最新値で更新
   ```javascript
   const nodeDataHandlersRef = useRef({ handleGoBack, handleGoForward, ... });
   useLayoutEffect(() => {
     nodeDataHandlersRef.current = { handleGoBack, handleGoForward, ... };
   });
   ```
   - `useLayoutEffect` を使用（レンダー後・ペイント前に ref が最新化される）

2. ref 経由で最新ハンドラを呼ぶ安定したラッパーを `useMemo` で作成
   ```javascript
   const stableNodeDataHandlers = useMemo(
     () => ({
       onGoBack: (nodeId) => nodeDataHandlersRef.current.handleGoBack(nodeId),
       onGoForward: (nodeId) => nodeDataHandlersRef.current.handleGoForward(nodeId),
       // ...
     }),
     [], // ← 依存配列は空（参照が変わらない）
   );
   ```

3. `buildFlowNode` の依存配列を `[stableNodeDataHandlers]` に削減
   - 実質変わらない参照なので依存配列の変更がなく、全ノード再構築が発生しない
   - ハンドラ自体の変更は ref 経由で最新値が伝わる

**注意点**:
- `useLayoutEffect` で ref 更新を行わないと ESLint の "ref during render" エラーになる
- 依存配列は **絶対に空** にする。ハンドラを依存に入れるとパターンの意味が失われる
