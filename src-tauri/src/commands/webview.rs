mod macos_viewport;
mod scripts;
mod snapshot;

use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl};

use self::scripts::{SCROLL_DETECTION_SCRIPT, SPA_URL_DETECTION_SCRIPT};

#[cfg(target_os = "macos")]
use self::macos_viewport::{
    configure_new_webview_viewport, set_webview_alpha, update_existing_webview_viewport,
};

/// WKWebView のスクリーンショットをキャプチャし、base64 PNG Data URL として返す。
///
/// 現在は macOS のみサポート。WKWebView が表示中（native モード）の時に呼び出すこと。
/// hide 中は空白画像になる可能性がある。
#[tauri::command]
pub async fn capture_webview_screenshot(
    app: AppHandle,
    page_id: String,
) -> Result<String, String> {
    snapshot::capture_webview_base64(&app, &page_id).await
}

/// ページ Webview のブラウザ履歴を1つ戻る。
#[tauri::command]
pub async fn go_back_page_webview(app: AppHandle, page_id: String) -> Result<(), String> {
    let label = format!("page-{}", page_id);
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("Webview '{label}' が見つかりません"))?;
    webview
        .eval("history.back()")
        .map_err(|e| format!("history.back() の実行に失敗: {e}"))
}

/// ページ Webview のブラウザ履歴を1つ進める。
#[tauri::command]
pub async fn go_forward_page_webview(app: AppHandle, page_id: String) -> Result<(), String> {
    let label = format!("page-{}", page_id);
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("Webview '{label}' が見つかりません"))?;
    webview
        .eval("history.forward()")
        .map_err(|e| format!("history.forward() の実行に失敗: {e}"))
}

#[derive(serde::Serialize)]
pub struct NavigationState {
    pub can_go_back: bool,
    pub can_go_forward: bool,
}

/// ページ Webview の戻る/進み可否状態を取得する（macOS のみ正確）。
#[tauri::command]
pub async fn get_navigation_state_page_webview(
    app: AppHandle,
    page_id: String,
) -> Result<NavigationState, String> {
    get_navigation_state_impl(app, page_id).await
}

#[cfg(target_os = "macos")]
async fn get_navigation_state_impl(
    app: AppHandle,
    page_id: String,
) -> Result<NavigationState, String> {
    use std::sync::{Arc, Mutex};
    use tokio::sync::oneshot;

    let label = format!("page-{}", page_id);
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("Webview '{label}' が見つかりません"))?;

    let (tx, rx) = oneshot::channel::<Result<NavigationState, String>>();
    let tx = Arc::new(Mutex::new(Some(tx)));

    webview
        .with_webview(move |platform_wv| {
            let raw_ptr = platform_wv.inner() as *mut objc2::runtime::AnyObject;
            unsafe {
                let can_go_back: bool = objc2::msg_send![raw_ptr, canGoBack];
                let can_go_forward: bool = objc2::msg_send![raw_ptr, canGoForward];
                if let Ok(mut guard) = tx.lock() {
                    if let Some(sender) = guard.take() {
                        let _ = sender.send(Ok(NavigationState {
                            can_go_back,
                            can_go_forward,
                        }));
                    }
                }
            }
        })
        .map_err(|e| format!("with_webview エラー: {e}"))?;

    rx.await
        .map_err(|_| "ナビゲーション状態チャネルが閉じられました".to_string())?
}

#[cfg(not(target_os = "macos"))]
async fn get_navigation_state_impl(
    _app: AppHandle,
    _page_id: String,
) -> Result<NavigationState, String> {
    Ok(NavigationState {
        can_go_back: false,
        can_go_forward: false,
    })
}

/// ページの Webview を指定 URL にナビゲートする（追加時 URL へのリセットに使用）。
#[tauri::command]
pub async fn reload_page_webview(app: AppHandle, page_id: String, url: String) -> Result<(), String> {
    let label = format!("page-{}", page_id);
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("Webview '{label}' が見つかりません"))?;
    let parsed_url = url
        .parse::<tauri::Url>()
        .map_err(|e| format!("URL のパースに失敗しました: {e}"))?;
    webview
        .navigate(parsed_url)
        .map_err(|e| format!("ナビゲーションに失敗: {e}"))
}

/// ページ用のネイティブ Webview を作成しイベントハンドラーを登録する。
///
/// 作成後の位置・サイズ・表示制御は JS 側の Webview API で行う（IPC 不要）。
/// ナビゲーション/タイトル変更イベントは Rust から JS にイベント送信する。
///
/// zoom は WKWebView の _viewScale として設定する。
/// _WKLayoutModeDynamicSizeComputedFromViewScale（layoutMode=2）と組み合わせることで
/// CSS viewport = frame.size / viewScale となり、frame が縮小されても
/// WKWebView は常に論理サイズを認識し、最小フォントサイズ問題も回避できる。
/// 併せて set_css_viewport_unit_sizes で svh/lvh/dvh/vh の基準サイズを論理サイズに同期し、
/// 物理 frame サイズからの乖離を防ぐ（新旧 API の両方をサポート）。
#[tauri::command]
pub async fn create_page_webview(
    app: AppHandle,
    page_id: String,
    url: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    zoom: f64,
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
                .initialization_script(SPA_URL_DETECTION_SCRIPT)
                .initialization_script(SCROLL_DETECTION_SCRIPT)
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
                        // \x01: initialization_script からの SPA URL 変更通知
                        // \x02: initialization_script からのスクロール完了通知
                        if let Some(url) = title.strip_prefix('\u{0001}') {
                            ah.emit(
                                &format!("page-navigated-{pid}"),
                                serde_json::json!({ "url": url }),
                            )
                            .ok();
                        } else if title.starts_with('\u{0002}') {
                            ah.emit(
                                &format!("page-scroll-ended-{pid}"),
                                serde_json::json!({}),
                            )
                            .ok();
                        } else {
                            ah.emit(
                                &format!("page-title-changed-{pid}"),
                                serde_json::json!({ "title": title }),
                            )
                            .ok();
                        }
                    }
                }),
            LogicalPosition::new(x, y),
            LogicalSize::new(width, height),
        )
        .map_err(|e| format!("Webview の作成に失敗しました: {e}"))?;

    // macOS: _WKLayoutModeDynamicSizeComputedFromViewScale（layoutMode=2）+ _setViewScale: zoom を設定。
    // これにより CSS viewport = frame.size / viewScale となり、frame が物理的に縮小されても
    // WKWebView が認識するレイアウトサイズは論理サイズ（page.width/height）を維持できる。
    // setBoundsSize: と異なり、この方式では CSS レベルではなくコンポジティング段階でスケーリングされるため
    // 最小フォントサイズ制約が発動しない。
    // さらに set_css_viewport_unit_sizes で svh/lvh の基準も CSS viewport に揃える。
    // layoutMode は作成時のみ設定し、update 時は viewScale + viewport insets を更新する。
    #[cfg(target_os = "macos")]
    {
        if let Some(wv) = app.get_webview(&label) {
            wv.with_webview(move |platform_wv| {
                let raw = platform_wv.inner() as *mut objc2::runtime::AnyObject;
                configure_new_webview_viewport(raw, width, height, zoom);
            })
            .ok();
        }
    }

    Ok(label)
}

/// ページ Webview の位置・サイズ（frame）と viewScale をアトミックに更新する。
///
/// frame は画面上の物理的な表示領域（zoom 済みサイズ）。
/// _setViewScale により CSS viewport = frame.size / zoom となるため、
/// zoom < 1.0 の時もレイアウト崩れなくページを縮小表示できる。
/// 同時に set_css_viewport_unit_sizes で svh/lvh/dvh/vh の基準サイズを論理サイズへ更新し、
/// frame の物理サイズとの乖離を防ぐ（新旧 API の両方をサポート）。
#[tauri::command]
pub async fn update_page_webview_bounds(
    app: AppHandle,
    page_id: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    zoom: f64,
) -> Result<(), String> {
    update_bounds_impl(&app, &page_id, x, y, width, height, zoom).await
}

/// ページ Webview の不透明度を設定する。
///
/// show/hide は setHidden ベースで表示復帰時の描画揺れが発生しやすいため、
/// macOS では alpha 値を操作して表示状態を維持したままフェード復帰を可能にする。
#[tauri::command]
pub async fn set_page_webview_opacity(
    app: AppHandle,
    page_id: String,
    opacity: f64,
) -> Result<(), String> {
    set_opacity_impl(app, page_id, opacity.clamp(0.0, 1.0)).await
}

#[cfg(target_os = "macos")]
async fn set_opacity_impl(
    app: AppHandle,
    page_id: String,
    opacity: f64,
) -> Result<(), String> {
    let label = format!("page-{}", page_id);
    let wv = app
        .get_webview(&label)
        .ok_or_else(|| format!("Webview '{label}' が見つかりません"))?;

    wv.with_webview(move |platform_wv| {
        let raw = platform_wv.inner() as *mut objc2::runtime::AnyObject;
        set_webview_alpha(raw, opacity);
    })
    .map_err(|e| format!("with_webview エラー: {e}"))?;

    Ok(())
}

#[cfg(not(target_os = "macos"))]
async fn set_opacity_impl(
    _app: AppHandle,
    _page_id: String,
    _opacity: f64,
) -> Result<(), String> {
    Ok(())
}

#[cfg(target_os = "macos")]
async fn update_bounds_impl(
    app: &AppHandle,
    page_id: &str,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    zoom: f64,
) -> Result<(), String> {
    use tauri::Manager;

    let label = format!("page-{}", page_id);
    let wv = app
        .get_webview(&label)
        .ok_or_else(|| format!("Webview '{label}' が見つかりません"))?;

    wv.set_position(LogicalPosition::new(x, y))
        .map_err(|e| format!("setPosition エラー: {e}"))?;
    wv.set_size(LogicalSize::new(width, height))
        .map_err(|e| format!("setSize エラー: {e}"))?;

    wv.with_webview(move |platform_wv| {
        let raw = platform_wv.inner() as *mut objc2::runtime::AnyObject;
        update_existing_webview_viewport(raw, width, height, zoom);
    })
    .map_err(|e| format!("with_webview エラー: {e}"))?;

    Ok(())
}

#[cfg(not(target_os = "macos"))]
async fn update_bounds_impl(
    app: &AppHandle,
    page_id: &str,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    _zoom: f64,
) -> Result<(), String> {
    let label = format!("page-{}", page_id);
    let wv = app
        .get_webview(&label)
        .ok_or_else(|| format!("Webview '{label}' が見つかりません"))?;
    wv.set_position(LogicalPosition::new(x, y))
        .map_err(|e| format!("setPosition エラー: {e}"))?;
    wv.set_size(LogicalSize::new(width, height))
        .map_err(|e| format!("setSize エラー: {e}"))?;
    Ok(())
}

/// 複数ページ Webview の frame + viewScale を一括更新する（操作中のリアルタイム同期用）。
#[derive(serde::Deserialize)]
pub struct BoundsEntry {
    pub page_id: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub zoom: f64,
}

#[tauri::command]
pub async fn batch_update_page_webview_bounds(
    app: AppHandle,
    entries: Vec<BoundsEntry>,
) -> Result<(), String> {
    // エラーは個別に無視（一括更新中の孤児 Webview 対策）
    for e in entries {
        let _ = update_bounds_impl(
            &app,
            &e.page_id,
            e.x,
            e.y,
            e.width,
            e.height,
            e.zoom,
        )
        .await;
    }
    Ok(())
}

/// パン操作専用: 複数 Webview の位置のみを一括更新する。
///
/// パン中は size や zoom は変化しないため set_size / _setViewScale をスキップし
/// IPC メッセージ数を削減することで追従遅延を軽減する。
#[derive(serde::Deserialize)]
pub struct PositionEntry {
    pub page_id: String,
    pub x: f64,
    pub y: f64,
}

#[tauri::command]
pub async fn batch_update_webview_positions(
    app: AppHandle,
    entries: Vec<PositionEntry>,
) -> Result<(), String> {
    for e in entries {
        let label = format!("page-{}", e.page_id);
        if let Some(wv) = app.get_webview(&label) {
            wv.set_position(LogicalPosition::new(e.x, e.y)).ok();
        }
    }
    Ok(())
}

/// WKWebView のスクリーンショットを PNG ファイルに保存し、ファイルパスを返す。
///
/// 保存先: app_data_dir/screenshots/{project_id}/{page_id}.png（既存ファイルは上書き）
/// macOS のみサポート。WKWebView が表示中（native モード）の時に呼び出すこと。
#[tauri::command]
pub async fn save_webview_screenshot(
    app: AppHandle,
    page_id: String,
    project_id: String,
) -> Result<String, String> {
    save_screenshot_impl(app, page_id, project_id).await
}

#[cfg(target_os = "macos")]
async fn save_screenshot_impl(
    app: AppHandle,
    page_id: String,
    project_id: String,
) -> Result<String, String> {
    let png_bytes = snapshot::capture_webview_png_bytes(&app, &page_id).await?;

    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir 取得エラー: {e}"))?;
    let screenshots_dir = data_dir.join("screenshots").join(&project_id);
    std::fs::create_dir_all(&screenshots_dir)
        .map_err(|e| format!("ディレクトリ作成エラー: {e}"))?;
    let file_path = screenshots_dir.join(format!("{page_id}.png"));
    std::fs::write(&file_path, &png_bytes)
        .map_err(|e| format!("ファイル保存エラー: {e}"))?;

    Ok(file_path.to_string_lossy().to_string())
}

#[cfg(not(target_os = "macos"))]
async fn save_screenshot_impl(
    _app: AppHandle,
    _page_id: String,
    _project_id: String,
) -> Result<String, String> {
    Err("この OS ではサポートされていません".to_string())
}

/// 複数ページの既存スクリーンショットパスを一括取得する（起動時の復元用）。
///
/// 存在するファイルのみ `(page_id, absolute_path)` のペアで返す。
#[tauri::command]
pub async fn get_existing_screenshot_paths(
    app: AppHandle,
    project_id: String,
    page_ids: Vec<String>,
) -> Result<Vec<(String, String)>, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir 取得エラー: {e}"))?;
    let screenshots_dir = data_dir.join("screenshots").join(&project_id);
    let mut results = Vec::new();
    for page_id in page_ids {
        let path = screenshots_dir.join(format!("{page_id}.png"));
        if path.exists() {
            results.push((page_id, path.to_string_lossy().to_string()));
        }
    }
    Ok(results)
}

/// ページのスクリーンショットファイルを削除する（ページ削除時のクリーンアップ用）。
#[tauri::command]
pub async fn delete_screenshot(
    app: AppHandle,
    page_id: String,
    project_id: String,
) -> Result<(), String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir 取得エラー: {e}"))?;
    let file_path = data_dir
        .join("screenshots")
        .join(&project_id)
        .join(format!("{page_id}.png"));
    if file_path.exists() {
        std::fs::remove_file(&file_path)
            .map_err(|e| format!("ファイル削除エラー: {e}"))?;
    }
    Ok(())
}
