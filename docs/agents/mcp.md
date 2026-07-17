# Sheltie MCP

Sheltieがopen中のdocumentとWKWebViewを、local MCP clientから操作するための正本。初期releaseはmacOSのみ対応する。

実装の主入口:

- `src-tauri/src/mcp/lifecycle.rs`: 設定永続化、listener、session cancellation
- `src-tauri/src/mcp/service.rs`: board/browser tool router、schema/annotation、response/image block整形、session connection lease
- `src-tauri/src/mcp/types.rs`: tool・renderer間のJSON契約
- `src-tauri/src/mcp/broker.rs`: document rendererへのrequest routing
- `src-tauri/src/mcp/page_automation/{protocol,actor,images,uploads}.rs`: typed page operation、compact snapshot、page単位の直列actor、bounded PNG処理、upload読込
- `src-tauri/src/mcp/tools/browser.rs`: WebPage照合と18 browser tools

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

## Phase 2 browser tools

各toolは`documentId`と`pageNodeId`を必須とし、対象nodeがlive WebPageであることを確認してからWKWebViewへdispatchする。初期releaseではmacOSだけを実行対象とし、非macOSは`unsupported_platform`を返す。

```text
browser_snapshot
browser_navigate
browser_go_back
browser_go_forward
browser_reload
browser_click
browser_hover
browser_fill
browser_fill_form
browser_select_option
browser_press_key
browser_scroll
browser_wait
```

- `browser_snapshot`はread-only。他のbrowser toolsはpageのDOM・historyへ作用するため`destructiveHint=true`
- DOM actionは直前の`snapshotId`と`elementRef`を使う。新しいsnapshotを作るたびに以前のrefはstaleになる
- 同じpageの操作は1 actorで直列化し、異なるpageは並行動作する
- action成功時は250ms後に新しいcompact snapshotを返す。navigationは`PageLoadEvent::Finished`後のURL、epoch、新しい`documentToken`を照合する
- snapshotはpassword/OTP、hidden element、cookie、local/session storageを含めない
- descendant frameはtop frameが`postMessage`結果を集約する。応答しないframeはpage全体を失敗させず`unavailable`とする
- browser toolsはboard selection、viewport、Undo/Redo、dirty stateを変更せず、保存も実行しない

## Phase 3 browser tools

| Tool | Phase 2共通の必須input以外 | Effect |
|---|---|---|
| `browser_screenshot` | `mode`, `annotate`; element時は`snapshotId`, `elementRef` | `viewport` / `element` / `fullPage`のPNGを1 image blockで返す |
| `browser_click_coordinates` | `snapshotId`, `x`, `y`, `button`, `clickCount`; optional `highlight` | semantic refが無い場合にCSS viewport座標へsynthetic pointer/mouse eventを送る |
| `browser_evaluate` | `script` | page originでJavaScriptを評価し、JSON-safeな値と最新snapshotを返す |
| `browser_upload_file` | `snapshotId`, `elementRef`, `paths` | absolute regular fileをfile inputへ割り当てる |
| `browser_handle_dialog` | `action`; accept時はoptional `promptText` | 次のpage dialogに対するone-shot responseを設定する |

- `browser_screenshot`の`viewport`は`native`ならlive captureを試し、失敗時はcacheへfallbackする。`screenshot` / `hidden`ではcacheだけを使い、Webviewを表示しない。`element` / `fullPage`はlive `native` Webviewだけを対象にする
- PNGは最長辺4096px、16,777,216 pixels、8MiB、full-page 64 tilesを上限とする。element cropと任意annotationはCSS座標をcapture scaleへ変換し、annotationは薄いfillと色付き2px borderで描く
- coordinate clickとupload eventの`inputTrusted`は`false`。`highlight`はpageへ約180msだけ表示するvisual aidであり、入力targetを変更しない
- evaluateは10秒のasync timeoutと256KiBのJSON response上限を持つ。同期的にevent loopを占有するscriptはWebKitから強制中断できないため、trusted clientは非停止scriptを送らない
- uploadはcanonical absolute regular fileを最大10件、1件25MiB、合計100MiBまでreadする。errorやresultへcanonical pathを出さない
- dialog policyはbridgeが注入された各frameの次のdialogで消費される。`alert`は記録してreturnし、`confirm` / `prompt`は設定済みresponseまたは既定dismissを返す
- `target="_blank"`とpopup navigationは新規Webviewを作らず、同じ`pageNodeId`のWebviewでURLを開く
- Phase 3操作も既存page actorを共有し、第二のqueueや一般的なnative JavaScript評価endpointを作らない

## Result convention

- JSON tool resultは同じobjectをMCP `structuredContent`と後方互換text contentの両方へ入れる。
- image toolの先頭contentはbase64を含まないmetadata text。`structuredContent`も同じmetadata objectとし、その後へ`image/png` content blockを並べる。
- `get_webpage_screenshots`のmetadataは`documentId`と`{ pageNodeId, freshness, mimeType?, width?, height?, capturedAt?, capturedUrl? }[]`。`missing`にはimage blockを付けない。
- `get_board_screenshot`のmetadataは`documentId`, `mimeType`, `width`, `height`, `worldBounds`, `includedNodeIds`, `missingScreenshotNodeIds`。PNG base64はimage blockだけに置く。
- `browser_screenshot`のmetadataは`documentId`, `pageNodeId`, `mode`, `source`, `mimeType`, `width`, `height`, `annotated`とoptional capture/warning field。PNG base64は唯一のimage blockだけに置く。
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
| `unsupported_platform` | browser toolをmacOS以外で呼んだ |
| `page_not_found` | `pageNodeId`が存在しないかWebPageではない |
| `webview_not_ready` | 対象pageのlive child Webviewが無い、または破棄された |
| `request_timeout` | page bridgeが応答しない、またはnavigation settlement中にURL・epoch・document tokenが期限内に確定しない |
| `bridge_rejected` | completionのrequest/document/page/window/Webview identityがpending requestと一致しない、または通常snapshotのURL・epoch・document tokenがactor stateと一致しない |
| `stale_element` | snapshot更新後の古いelement refを使った |
| `element_not_found` | current snapshotにrefが無い |
| `element_not_interactable` | hidden、disabled、inertなどで操作できない |
| `invalid_argument` | browser toolのURL、値、件数、文字数などが不正 |
| `wait_timeout` | browser waitのconditionが期限内に成立しない |
| `snapshot_too_large` | page snapshotが要素数・UTF-16文字数制限を超えた |
| `live_webview_required` | cacheでは実行できないelement/full-page captureを非native pageへ要求した |
| `screenshot_target_not_visible` | elementのCSS rectが現在のnative viewport内に収まらない |
| `page_changed_during_capture` | full-page capture中にnavigation、document token、epoch、geometryが変わった |
| `screenshot_too_large` | edge、pixel、PNG byte、tile上限内で画像を生成できない |
| `evaluate_not_json` | evaluate結果がJSON-safeでない、またはcycleを含む |
| `evaluate_timeout` | evaluateのasync resultが10秒以内にsettleしない |
| `evaluate_result_too_large` | evaluateのJSON responseが256KiBを超えた |
| `upload_file_invalid` | upload path/file type/readability/count/sizeが契約外 |
| `upload_target_not_file_input` | element refが現在snapshotのfile inputを指さない |

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

Claude Code、Codex、Cursor / VS Codeでは同じStreamable HTTP endpointを登録し、tool discoveryがboard 7件とbrowser 18件の計25件であることを確認する。最低限、2 documentの列挙、valid/invalid batchと1回Undo、dirty/no-auto-save、explicit focus、cached multi-site画像、offscreen board画像、semantic/ref更新、viewport/element/full-page画像、coordinate/evaluate/upload/dialog/popup、disable時disconnect、foreign Host / OriginのHTTP 403を確認する。
