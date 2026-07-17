# Sheltie MCP

Sheltieがopen中のdocumentとWKWebViewを、local MCP clientから操作するための正本。初期releaseはmacOSのみ対応する。

実装の主入口:

- `src-tauri/src/mcp/lifecycle.rs`: 設定永続化、listener、session cancellation
- `src-tauri/src/mcp/service.rs`: 7 toolsのrouter、schema/annotation、response/image block整形、session connection lease
- `src-tauri/src/mcp/types.rs`: tool・renderer間のJSON契約
- `src-tauri/src/mcp/broker.rs`: document rendererへのrequest routing

## Trust boundary

- 接続できたlocal MCP clientを全面的に信頼する。認証、操作ごとの確認、MCP rootsによる制限は設けない。
- authenticated pageを含むSheltie内WebPageとboard内容は、server有効中に接続したclientから参照・操作できる。
- bind、Host validation、Origin validationはnetwork公開とDNS rebindingを防ぐ境界であり、同じuser権限で動くlocal process間の権限分離ではない。
- MCPはdocumentを保存しない。編集後のdirty stateとSave / Save Asはuserが管理する。

## Lifecycle

- serverは既定で無効。`sheltie.json`の`mcpEnabled` booleanを正本にする。値が無い場合やboolean以外の場合は`false`として扱う。
- enable時はsocket bindが成功してからlifecycleを`Running`へ進める。port競合などでstartに失敗した場合は設定とmenu checkを`false`へ戻し、native error dialogを表示する。
- disable時はStreamable HTTP serverのcancellation tokenをcancelし、`LocalSessionManager`の全sessionを明示closeしてからlistener taskを終了する。session serviceの最終cloneがdropされるとconnection leaseも減算される。document windowは閉じない。
- store saveはtransactionalに扱い、失敗時はin-memory値を直前値へ戻す。設定変更に失敗したgenerationがまだcurrentなら直前のenabled stateへmenu/runtimeを復帰し、より新しいuser intentがあれば古いfailureは何も変更しない。
- menu toggleごとに同期的にgeneration付きdesired stateを更新し、async処理はdocument全体で1本のoperation lockを通す。古いgenerationはstore/menuを更新せず、latest intentだけを適用する。
- start / stopの重複要求はidempotentに扱う。start処理中にdisableされた場合も即座にcancellationを通知し、bind済みlistenerをcancelして`Disabled`へ戻す。
- macOS以外ではserverをstartしない。

## Endpoint

- URL: `http://127.0.0.1:29978/mcp`
- bind: `127.0.0.1:29978`のみ
- transport: MCP Streamable HTTP (`rmcp 2.2.0`)
- auth / CORS header: なし
- 許可Host: `127.0.0.1:29978`, `localhost:29978`
- 許可Origin: Origin header無し、`http://127.0.0.1:29978`, `http://localhost:29978`
- 上記以外のHost / OriginはMCP transport layerで拒否する。

Client設定例:

```json
{
  "mcpServers": {
    "sheltie": {
      "type": "http",
      "url": "http://127.0.0.1:29978/mcp"
    }
  }
}
```

## Menu setting

macOSの`Sheltie > Settings`に次を置く。

- `MCP Server`: checked item。変更時に設定を永続化してserverをstart / stopする。
- `MCP Connections: N`: disabled item。active session数を表示する。

Theme項目とMCP項目はseparatorで分ける。setup時はplugin store初期化後に`mcpEnabled`を読み、checked stateとserver lifecycleを復元する。

## Renderer broker

- board stateはrenderer/Zustandを正本とするため、Rust tool handlerは`McpRequestBrokerState`を通して対象document windowへrequestを送る。
- request IDはUUID v4。pending entryにはexpected `documentId`とoneshot senderを保持し、renderer completionの呼び出し元`Window.label()`が一致する場合だけ完了する。
- 同一documentのrequestはdocument-local async mutexで直列化する。異なるdocumentは独立して進行できる。document存在確認はlock取得前と取得直後の両方で行い、queue待機中に閉じたwindowへemitしない。
- stopped stateとpending admissionは同じmutexで更新し、disableがdrainした後に新しいpending entryが入らないようにする。listener taskはadmission gateを開くまでHTTP requestを受けず、brokerをresumeしてからgateを開く。
- renderer timeoutは10秒。emit失敗は`renderer_unavailable`、timeoutは`renderer_timeout`、server disableは`server_stopped`を返し、いずれもpending entryを残さない。client cancellationでrequest futureがdropされた場合もRAII registration guardがentryを除去する。
- rendererは`mcp-renderer-request`をwindow-local listenerで受け、`complete_mcp_renderer_request`へ`{ requestId, result }`を返す。未登録commandも`renderer_unavailable`として完了し、requestを放置しない。

## Phase 1 tools

| Tool | Required input | Optional input | Effect |
|---|---|---|---|
| `list_documents` | - | - | open documentを作成順で返し、focused documentをmetadataで示す |
| `get_editor_state` | `documentId` | - | selected node/edge IDsとlive viewportを読む |
| `get_board` | `documentId` | `nodeIds`, `nodeTypes`, `includeEdges` | node/edgeをboard順で読む。`includeEdges`既定値は`true` |
| `batch_edit_board` | `documentId`, `operations` | - | 宣言的batchをall-or-nothingで適用し、1 Undo snapshotを作る |
| `focus_nodes` | `documentId`, `nodeIds` | - | 指定live nodeを選択・fitし、edge選択を解除する |
| `get_webpage_screenshots` | `documentId` | `pageNodeIds` | cached/missing metadataと、cached pageごとのimage blockをboard順で返す |
| `get_board_screenshot` | `documentId` | `nodeIds` | board全景/subset metadataと1 PNG image blockを返す |

`nodeTypes`は`webpage` / `stickynote` / `text`。`nodeIds`で絞った`get_board`のedgeは、両endpointが返却node集合に含まれる場合だけ返す。optional ID listを省略すると全対象、明示した空配列はboard screenshotでは`validation_failed`になる。

## Result convention

- JSON tool resultは同じobjectをMCP `structuredContent`と後方互換text contentの両方へ入れる。
- image toolの先頭contentはbase64を含まないmetadata text。`structuredContent`も同じmetadata objectとし、その後へ`image/png` content blockを並べる。
- `get_webpage_screenshots`のmetadataは`documentId`と`{ pageNodeId, freshness, mimeType?, width?, height?, capturedAt?, capturedUrl? }[]`。`missing`にはimage blockを付けない。
- `get_board_screenshot`のmetadataは`documentId`, `mimeType`, `width`, `height`, `worldBounds`, `includedNodeIds`, `missingScreenshotNodeIds`。PNG base64はimage blockだけに置く。
- read toolは`readOnlyHint=true`、`destructiveHint=false`、`openWorldHint=false`。`batch_edit_board`だけ`destructiveHint=true`、`focus_nodes`は`idempotentHint=true`。

## Stable errors

| Code | Meaning / retry |
|---|---|
| `document_not_found` | `documentId`がopenでない。`list_documents`から再取得する |
| `renderer_unavailable` | renderer未mount、event emit失敗、response contract不一致 |
| `renderer_timeout` | 10秒以内にrenderer completionが無い |
| `validation_failed` | tool inputまたはbatch operationが不正。batchは未変更 |
| `server_stopped` | disable/stopがpending requestを終了した |
| `screenshot_failed` | cache assetの取得・decode・PNG生成に失敗した |

error resultも`{ code, message, retry? }`をstructured/textの両方へ返す。tool parameter、board/page内容、base64、local file pathをRust logへ出さない。

## Tool routing rules

- document-scoped toolはruntime `documentId` (`document-*` window label)を必須にする。
- WebPage-scoped toolは`documentId`と`pageNodeId`を必須にする。
- tool開始後にfocused windowから対象を推測しない。focusはread metadataとしてだけ扱う。
- `list_documents`はRustのdocument managerからwindow作成順に返し、focused windowはmetadataとして示す。renderer-localな`Project.id`は外部へ出さない。
- board stateはrenderer/Zustandを正本とし、Rust serviceは内容をmirrorしない。
- stable errorは`{ code, message, retry? }`を返す。
- `batch_edit_board`後もSave / Save Asを呼ばない。dirty indicatorと保存操作は通常のdocument UIに任せる。
- `get_board` / batchはselectionとviewportを変えない。これらを変更できるMCP経路は`focus_nodes`だけ。

## Client verification

Claude Code、Codex、Cursor / VS Codeでは同じStreamable HTTP endpointを登録し、tool discoveryが上記7件だけであることを確認する。最低限、2 documentの列挙、valid/invalid batchと1回Undo、dirty/no-auto-save、explicit focus、cached multi-site画像、offscreen board画像、disable時disconnect、foreign Host / OriginのHTTP 403を確認する。
