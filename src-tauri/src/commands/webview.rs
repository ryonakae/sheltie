use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl};

/// ページ用のネイティブ Webview を作成しイベントハンドラーを登録する。
///
/// 作成後の位置・サイズ・表示制御は JS 側の Webview API で行う（IPC 不要）。
/// ナビゲーション/タイトル変更イベントは Rust から JS にイベント送信する。
#[tauri::command]
pub async fn create_page_webview(
    app: AppHandle,
    page_id: String,
    url: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<String, String> {
    let label = format!("page-{}", page_id);

    // 既存の同名 Webview があれば破棄（HMR / 異常系での再作成に対する防御策）
    if let Some(existing) = app.get_webview(&label) {
        let _ = existing.close();
    }

    // add_child は Window（WebviewWindow ではなく）のメソッドのため get_window を使用
    // unstable feature が必要
    let window = app
        .get_window("main")
        .ok_or("main ウィンドウが見つかりません")?;

    let app_handle = app.clone();
    let pid = page_id.clone();
    let label_clone = label.clone();

    let parsed_url = url
        .parse::<tauri::Url>()
        .map_err(|e| format!("URL のパースに失敗しました: {e}"))?;

    window
        .add_child(
            tauri::webview::WebviewBuilder::new(&label_clone, WebviewUrl::External(parsed_url))
                .on_navigation({
                    let ah = app_handle.clone();
                    let pid = pid.clone();
                    move |nav_url| {
                        ah.emit(
                            &format!("page-navigated-{pid}"),
                            serde_json::json!({ "url": nav_url.to_string() }),
                        )
                        .ok();
                        // ナビゲーションを許可
                        true
                    }
                })
                .on_document_title_changed({
                    let ah = app_handle.clone();
                    let pid = pid.clone();
                    move |_webview, title| {
                        ah.emit(
                            &format!("page-title-changed-{pid}"),
                            serde_json::json!({ "title": title }),
                        )
                        .ok();
                    }
                }),
            LogicalPosition::new(x, y),
            LogicalSize::new(width, height),
        )
        .map_err(|e| format!("Webview の作成に失敗しました: {e}"))?;

    Ok(label)
}
