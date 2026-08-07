# ドメインモデル

主な型定義は `src/types/index.ts`、状態管理の実装は `src/store/tab-store.ts` が正本。

## 型

- `DisplayMode = 'native' | 'screenshot' | 'hidden'`
- `BoardNodeType = 'webpage' | 'stickynote' | 'text'`
- `BoardNode`
  - 基本: `id`, `title`, `url`, `x`, `y`, `width`, `height`
  - `height` は content / Webview 本体の高さ。ノード外枠全体の高さではない
  - 任意: `type`, `addedUrl`, `content`, `colorIndex`, `tiptapContent`, `fontSizePreset`, `fontWeight`, `italic`, `strikethrough`, `textColorIndex`, `widthMode`
- `WebPageNode`
  - `BoardNode` を拡張した webpage 専用補助型
  - `type` は `'webpage' | undefined`
- `StickyNoteNode`
  - `BoardNode` を拡張した付箋専用補助型
  - `type` は `'stickynote'`
  - `content?: string`、`colorIndex?: number`、`fontSizePreset?: TextNodeFontSizePreset`
- `TextNode`
  - `BoardNode` を拡張したテキストノード専用補助型
  - `type` は `'text'`
  - `tiptapContent?: object`（Tiptap JSON ドキュメント）、`fontSizePreset?: TextNodeFontSizePreset`（0=S, 1=M, 2=L, 3=XL）、`fontWeight`、`italic`、`strikethrough`、`textColorIndex`、`widthMode`（`'auto' | 'fixed'`）
- `EdgeStrokeWidth = 3 | 6`
- `EdgeLineStyle = 'solid' | 'dashed'`
- `EdgeColorPreset = 'default' | 'foreground' | 'muted' | 'accent' | 'success' | 'warning' | 'danger'`
- `BoardEdgeStyle`: `strokeWidth`, `lineStyle`, `colorPreset`
- `BoardEdge`
  - `id`, `source`, `sourceHandle`, `target`, `targetHandle` + `BoardEdgeStyle`
  - WebPageNode 同士の接続を表現する。他のノード種別は接続対象外
- `SheltieDocumentEdge`
  - `.sheltie` に保存されるエッジ形式。`BoardEdge` と同じフィールドを必須で保存する
- `TextNodeFontSizePreset = 0 | 1 | 2 | 3`
- `ProjectWebviewRuntime`
  - document ごとの runtime-only state
  - `labelsByNodeId: Record<string, string>`
  - `screenshotUrlsByNodeId: Record<string, string>`
- `Viewport`: `zoom`, `panX`, `panY`
- `SheltieDocumentNode`
  - `.sheltie` に保存される node の union 型
  - `webpage` は `id`, `type`, `title`, `url`, `addedUrl?`, `x`, `y`, `width`, `height`
  - `stickynote` は `id`, `type`, `title`, `content`, `colorIndex`, `fontSizePreset`, `x`, `y`, `width`, `height`
  - `text` は `id`, `type`, `title`, `tiptapContent?`, `fontSizePreset`, `fontWeight`, `italic`, `strikethrough`, `textColorIndex`, `widthMode`, `x`, `y`, `width`, `height`
- `SheltieDocumentV2`
  - `schemaVersion: 2`
  - `projectId?`（スクリーンショットキャッシュのディレクトリキー。古いファイルには無い）
  - `nodes`, `edges?`（後方互換: `edges` が無い場合は空配列として扱う）
- `Project`
  - 1 document window 分のローカル状態
  - `id`, `nodes`, `edges`, `viewport`, `filePath?`, `untitledIndex`, `lastSavedDocument`
- `ProjectState`
  - document window ごとの単一 state
  - `project: Project | null`
- `ProjectStore`（`tab-store.ts` 内部）
  - 単一 document window の `ProjectState` + actions + ランタイム状態
  - ランタイム状態: `isLoaded`, `history`, `webviewRuntime`
  - 初期化: `initializeProject`, `markProjectSaved`, `restoreProjectFromLastSaved`
  - ノード追加/削除: `addWebNode`, `setWebNodeUrl`, `changeWebNodeUrl`, `removeNode`, `removeNodes`, `addStickyNoteNode`, `addTextNode`, `insertBoardContent`
  - `insertBoardContent({ nodes, edges, screenshotSeedsByNodeId? })`: 準備済みノード/エッジを末尾へ追加し、履歴 1 件・スクリーンショットシードのマージをまとめて行う。ペースト・Cmd+D・alt ドラッグ複製が共用する。ノードが空、または既存 ID と衝突する場合は no-op
  - ノード更新: `updateNodePosition`, `updateNodePositions`, `updateNodeSize`, `updateNodeBounds`, `updateNodeSizeWithoutHistory`, `updateWebNodeUrl`, `updateNodeTitle`, `updateStickyNoteContent`, `updateStickyNoteStyle`, `updateTextNodeContent`, `updateTextNodeStyle`, `updateTextNodeWidthMode`
  - 複数操作の集約: `removeNodes` / `updateNodePositions` は複数ノードの削除・位置更新を 1 つの履歴エントリにまとめる。複数選択の一括削除・一括ドラッグ移動はこの経路を通し、Cmd+Z 1 回で全ての変更を巻き戻せるようにする
  - MCP batch: `applyMcpBoardBatch` は`BoardOperation[]`を純粋interpreterで全件検証してから1回のstore更新で反映する。成功したbatch全体が履歴1件になり、失敗/no-opはproject・history・webviewRuntimeを変更しない
  - エッジ: `addEdge`, `updateEdgeStyle`, `removeEdges`, `reverseEdge`（`removeNode` 時に関連エッジも自動削除。スタイル更新・反転・同じ2接続点の置換は各1履歴として記録）
  - 順序/選択: `bringNodeToFront`, `sendNodeToBack`, `bringNodeForward`, `sendNodeBackward`, `pinWebNodeUrl`, `updateViewport`
  - 履歴: `undoProject`, `redoProject`
  - runtime: `setWebNodeWebviewLabel`, `clearWebNodeWebviewLabel`, `hydrateProjectScreenshotUrls`, `setProjectScreenshotUrl`, `clearProjectScreenshotUrl`
- `ProjectHistory`（`store/project-history.ts`。clone/pushHistory/上限管理の純関数もここに集約）
  - `past`: 直前までの `ProjectSnapshot` 配列（`{ nodes: BoardNode[]; edges: BoardEdge[] }`）
  - `future`: Redo 用の `ProjectSnapshot` 配列
  - ノードとエッジを統合スナップショットとして管理し、Undo/Redo で両方が同時に復元される

## クリップボード payload

- `BoardClipboardPayload`（`src/lib/board-clipboard.ts`）
  - `type: 'application/x-sheltie-board-nodes'`, `version: 1`, `sourceProjectId`, `nodes: SheltieDocumentNode[]`, `edges: SheltieDocumentEdge[]`
  - ノード/エッジは `.sheltie` と同じ document 形式で、元の ID と座標をそのまま保持する
  - システムクリップボードはファイル同様に信頼できない入力として扱い、`parseDocumentNode` / `parseDocumentEdge`（`parseProjectDocument` と同じ検証点）を通す。1 つでも違反があれば payload 全体を破棄する
  - `materializeBoardClipboardPayload` が ID を全て再発行し、エッジの `source` / `target` をリマップする
- コピー対象は選択ノードと、両端が選択に含まれるエッジ。エッジ単体のコピーは対象外
- Cut はクリップボードへの書き込み成功を待ってからノードを削除する。書き込みが失敗したときにノードだけが消えるのを防ぐ
- ペースト位置の基準点は次の優先順で選び、いずれも「現在の viewport と交差するか」で判定する
  1. 直前ペーストしたノード群（同一 payload）→ 外接矩形左上 + 20px
  2. 生きている元ノード群 → 現在の外接矩形左上 + 20px
  3. payload の元座標 → そのまま（Cut / 削除後の「その場に戻す」）
  4. どれも不可 → 外接矩形の中心を viewport 中心に合わせる
- Webview は重ねられないため、貼り付け群に webpage が含まれる場合は群全体を剛体として右下対角へ 20px 刻みでスライドし、「webpage vs 既存全ノード」「付箋/テキスト vs 既存 webpage」の 20px gap 制約を満たす最初の位置に置く。群内部の重なりは判定しない

## `.sheltie` とローカル状態の境界

- `.sheltie` は共有用ドキュメント形式
- 保存する: `schemaVersion`, `nodes`, `edges`
  - `title` は保存しない
  - `schemaVersion: 1` は読み込み互換用に受けるが、書き出しは `schemaVersion: 2` に統一する
  - 保存名は `.sheltie` の外側、つまりファイル名で表現する
- 共有ファイルは信頼できない入力として扱う。`parseProjectDocument` が唯一の検証点で、1 つでも違反があれば文書全体を読み込み失敗にする
  - `url` / `addedUrl` は `http` / `https` / 空文字のみ許可する（空文字は URL 未入力の WebPage ノード）
  - `colorIndex` / `textColorIndex` / `fontSizePreset` は対応するプリセット配列長で範囲検証する
  - `x` / `y` / `width` / `height` は有限数のみ許可する（`Infinity` を拒否）
  - `tiptapContent` は ProseMirror JSON の**構造**を検証する（object であること、`type` が非空文字列、`content` / `marks` が配列、`text` が文字列、入れ子も再帰的に同じ検査）。形が壊れたまま TextNode を描画すると ProseMirror が render 中に throw し、`BoardErrorBoundary` がボード全体を落として Undo にも到達できなくなる。node / mark 名の妥当性は editor の schema に委ねる
  - node / edge の件数、文字列長、Tiptap JSON の深さに上限は設けない。ファイル自体の byte 上限だけを Rust 側で見る
- ローカル状態は document window の再起動復元用
  - `Project` は renderer のメモリ上で `nodes`, `filePath`, `viewport`, `untitledIndex`, `lastSavedDocument` を保持する
  - backend から受ける window context は `filePath` と `untitledIndex` のみ
  - 起動時は filePath があれば `.sheltie` を読み、無ければ空 document を作る
  - `webviewRuntime` と `nodeHistory` は runtime-only のため永続化しない

## 未保存変更の判定

- 未保存判定は current document の `.sheltie` 相当内容（`nodes`, `edges`）と `lastSavedDocument` の差分で行う
- `viewport`, `filePath`, `untitledIndex` の差分は未保存確認の対象に含めない
- 新規未保存 document は作成時点の空 document を `lastSavedDocument` として持つ
- `restoreProjectFromLastSaved` は `nodes` と `edges` を `lastSavedDocument` に戻し、対応する `history` も破棄する

## ヘルパー

- `isNodeEmpty(node)`: `node.url === ''` で空フレーム判定
- `isStickyNoteNode(node)`: `node.type === 'stickynote'` の型ガード
- `isTextNode(node)`: `node.type === 'text'` の型ガード
- `isWebPageNode(node)`: webpage 判定の型ガード（`type` 未定義も webpage 扱い。`stickynote` と `text` を除外）
- `isTextNodeEmpty(node)`: `tiptapContent` が未設定、または抽出テキストが空白のみのときに true
- `isNodeMoved(node)`: `addedUrl` と現在 `url` の差分判定

## React Flow ノード構成

### Node 型と Flow ノード

- `WebPageFlowNodeData = { nodeProps: WebPageNodeProps; layoutZoom; onResizeStart; onResize; onResizeEnd; getZoom }`
- `StickyNoteFlowNodeData = { nodeProps: StickyNoteNodeProps & { onStyleChange }; onResize; onResizeEnd }`
- `TextFlowNodeData = { nodeProps: TextNodeProps & { onStyleChange; onWidthModeChange }; onResize; onResizeEnd }`
- `BoardNode[]` から React Flow `Node[]` を作る正本は `Sheltie.tsx` の `flowNodes` `useMemo`

実装規約（position / width / height の渡し方、インタラクション制御）は `coding-rules.md` の「React Flow」セクションを参照。

## 主要定数

`src/constants/project.ts`

- `DEFAULT_VIEWPORT = { zoom: 1, panX: 0, panY: 0 }`
- `DEFAULT_PAGE_WIDTH = 393`
- `DEFAULT_PAGE_HEIGHT = 852`
- `WEB_PAGE_FRAME_PADDING = 16`（Webview の上下左右に取るフレーム余白。world 固定 px）
- `DEFAULT_STICKY_NOTE_WIDTH = 200`
- `DEFAULT_STICKY_NOTE_HEIGHT = 200`
- `DEFAULT_TEXT_NODE_WIDTH = 200`
- `DEFAULT_TEXT_NODE_HEIGHT = 32`
- `SIZE_PRESETS = [Mobile, Tablet, PC]`

`src/constants/sheltie.ts`

- ズーム: `MIN_ZOOM = 0.25`, `MAX_ZOOM = 1.5`, `ZOOM_STEPS = [0.25, 0.5, 1.0, 1.5]`（キーボードショートカットのステップ値）
- しきい値: `HYSTERESIS_PX = 4`, `NATIVE_SAFE_MARGIN_PX = 25`
- ドラッグ補正: `DRAG_REPOSITION_GAP = 20`
- テキストノード: `TEXT_NODE_MIN_WIDTH = 40`, `TEXT_NODE_FONT_SIZE_PRESETS = [12, 16, 24, 36]`, `TEXT_NODE_COLORS`（HeroUI セマンティックカラー: foreground / muted / accent / success / warning / danger の 6 色を `var(--...)` で参照し、light/dark テーマに追従）
- エッジ: `EDGE_STROKE_WIDTHS = [3, 6]`, `EDGE_LINE_STYLES = ['solid', 'dashed']`, `EDGE_COLOR_PRESETS`（Default + HeroUI セマンティックカラー 6色）、`DEFAULT_EDGE_STYLE = { strokeWidth: 3, lineStyle: 'solid', colorPreset: 'default' }`

`src/store/project-history.ts`

- `HISTORY_LIMIT = 100`（document ごとの統合履歴保持上限）

`src/lib/mcp/types.ts` / `src/lib/mcp/board-operations.ts`

- `BoardOperation`: `create_node` / `update_node` / `delete_node` / `create_edge` / `update_edge` / `delete_edge` / `reverse_edge` / `reorder_node`
- create operationはbatch内で一意な`tempId`を持ち、後続operationのnode/edge参照で利用できる。解決はoperation順で、宣言前参照・重複temp IDは`validation_failed`
- text nodeのMCP入力はplain `text`を受け、interpreterがTiptap JSONへ変換する。空文字は空paragraphにする
- 新規edgeのhandleは`top` / `right` / `bottom` / `left`だけを受け、WebPage同士のみ接続できる

## 不変条件

- `BoardNode` は永続化対象だけを持ち、Webview 接続状態は含めない
- `webviewRuntime.labelsByNodeId[nodeId]` は「現在接続済みのネイティブ Webview がある」間だけ設定する。再マウント開始時に `clearWebNodeWebviewLabel` で外し、再生成完了後に `setWebNodeWebviewLabel` で付け直す。
- `webviewRuntime.screenshotUrlsByNodeId[nodeId]` は最後に表示可能だった screenshot の asset URL を保持し、同一セッション内の再マウントと起動直後の open tab preload で使い回す。node 削除時にだけ破棄する。
- 付箋ノードは `type: 'stickynote'` と `content` / `colorIndex` / `fontSizePreset` を利用する
- テキストノードは `type: 'text'` と `tiptapContent` / `fontSizePreset` / `fontWeight` / `italic` / `strikethrough` / `textColorIndex` / `widthMode` を利用する
- 空フレーム（`url === ''`）は Webview 未作成状態を許容する
- `history` はランタイム専用で永続化しない
- `webviewRuntime` はランタイム専用で永続化しない
- Undo/Redo は現在の document window にのみ適用する
- `batch_edit_board`は最初のvalidation failureで全operationを破棄し、成功時だけnode/edge統合snapshotを履歴へ1件積む。store actionを個別に連結しない
- MCPによるWebPage削除とURL変更は、staleなwebview label/screenshot runtime entryを同じstore更新で除去する
- MCPの`reorder_node`は付箋・textだけを対象とし、WebPageは`validation_failed`にする
- node / edge 配列を更新する操作は基本的に履歴へ記録するが、付箋の自動高さ調整は `updateNodeSizeWithoutHistory` を使って履歴を積まない
- エッジの接続点は `(nodeId, handleId)` で識別し、同じ2接続点を順不同で比較したペアは1本だけ保持する。後から追加したエッジのID/向きへ置換し、既存の太さ・線種・色を継承する。置換全体は1履歴とする
- `reverseEdge` はIDとスタイルを維持し、source/targetのnode IDとhandle IDを入れ替える
- schema version 2 のエッジスタイル3項目は必須で、未リリース版の旧edge形式向けfallbackは持たない
- 重なり順変更（`bringNodeToFront` / `sendNodeToBack` / `bringNodeForward` / `sendNodeBackward`）は nodes 配列順＝永続状態を変えるため履歴へ記録し、Undo/Redo で元の順序に戻せる。順序が変わらない場合（端のノードなど）は no-op で履歴を積まない
- ドラッグ終了時の重なり補正は webpage 優先で行う。webpage は他ノードと `20px` 未満まで近づけず、stickynote は webpage にだけ同じ制約を適用する
- 重なり補正・新規ノード自動配置・センタリング fallback は、content サイズではなくノード外枠（フレーム外周）を基準にする。WebPage のフレーム padding は world 固定 16px なので、外枠サイズは zoom に依存しない
- WebPage / StickyNote / Text のいずれもツールバーは `NodeToolbar` を使い、ノード外枠の上部に配置する。WebPage はさらに常時表示のタイトル段（`[Moved] Title`、左寄せ）を追加で `NodeToolbar` で重ねる
- エッジツールバーは `EdgeToolbar` を使い、ノード/エッジを合わせて1要素だけが選択された場合にベジェpath境界の左右中央・上端上部へ表示する。選択中の線自体は変えず、始点/終点リングだけを追加する
- 同一 `filePath` の `.sheltie` を複数のローカル document に関連付けない
- `.sheltie` の `schemaVersion` は整数で管理し、現行実装は `2` を正本にする
- `lastSavedDocument` はローカル state 専用であり、`.sheltie` へは書き出さない
- `projectId` は dirty 判定に含めない。ボード内容ではなくキャッシュキーなので、`projectId` を持たないファイルを開いた直後に未保存扱いになってはいけない
- ペースト / Cmd+D / alt ドラッグ複製は `insertBoardContent` を通し、ノード・エッジ・スクリーンショットシードをまとめて履歴 1 件にする。操作後は新規ノード群を選択状態にする
- alt ドラッグ複製ではドラッグしていた側が新ノードになる。元ノードの位置は store へ書かないため元位置に留まり、元ノードに繋がる既存エッジも元ノード側に残る。ドラッグ対象内で閉じたエッジだけを複製する
- alt ドラッグの残像クローン（ghost node）は描画専用の runtime 表現で、`nodes` 配列にも `.sheltie` にも現れない
- ghost は flowNodes 配列で複製元ノードの直前に差し込む。配列順がそのまま重なり順になるため、先頭や末尾へまとめると残像だけが複製元と違う重なりになり、ドラッグ中に手前のノードへ潜って見える
- alt ドロップの重なり補正は、単独なら通常ドラッグ終了と同じ `resolveDraggedNodePosition`（最近傍 1 軸）、複数同時なら相対レイアウトを保つためペーストと同じ `resolveNonOverlappingGroupOffset`（剛体を右下対角へ）を使う。複数選択でも webpage の重なりは許さない
- 複製時のスクリーンショットシードは `payload.sourceProjectId` が現在の `project.id` と一致するときだけ行う。別 window の screenshot ファイルは prune / 削除で寿命が読めないため使い回さない
- 読み込みに失敗した `.sheltie` は `Project` を初期化しない。`filePath` を保持したまま空文書で開くと、ユーザーが気付かず保存した時点で元ファイルを空文書で上書きしてしまう

