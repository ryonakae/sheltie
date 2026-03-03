use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl};

/// WKWebView のスクリーンショットをキャプチャし、base64 PNG Data URL として返す。
///
/// 現在は macOS のみサポート。WKWebView が表示中（native モード）の時に呼び出すこと。
/// hide 中は空白画像になる可能性がある。
#[tauri::command]
pub async fn capture_webview_screenshot(
    app: AppHandle,
    page_id: String,
) -> Result<String, String> {
    capture_impl(app, page_id).await
}

#[cfg(target_os = "macos")]
async fn capture_impl(app: AppHandle, page_id: String) -> Result<String, String> {
    use std::sync::{Arc, Mutex};
    use tokio::sync::oneshot;

    let label = format!("page-{}", page_id);
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("Webview '{label}' が見つかりません"))?;

    let (tx, rx) = oneshot::channel::<Result<String, String>>();
    let tx = Arc::new(Mutex::new(Some(tx)));

    webview
        .with_webview(move |platform_wv| {
            // inner() は *mut c_void を返すため AnyObject にキャスト
            let raw_ptr = platform_wv.inner() as *mut objc2::runtime::AnyObject;
            take_wkwebview_snapshot(raw_ptr, tx);
        })
        .map_err(|e| format!("with_webview エラー: {e}"))?;

    rx.await
        .map_err(|_| "スクリーンショットチャネルが閉じられました".to_string())?
}

#[cfg(not(target_os = "macos"))]
async fn capture_impl(_app: AppHandle, _page_id: String) -> Result<String, String> {
    Err("この OS ではサポートされていません".to_string())
}

/// WKWebView のネイティブポインタに対して takeSnapshotWithConfiguration:completionHandler: を呼び出す。
/// with_webview クロージャ内（メインスレッド）から呼ぶこと。
#[cfg(target_os = "macos")]
fn take_wkwebview_snapshot(
    raw_ptr: *mut objc2::runtime::AnyObject,
    tx: std::sync::Arc<
        std::sync::Mutex<
            Option<tokio::sync::oneshot::Sender<Result<String, String>>>,
        >,
    >,
) {
    use block2::RcBlock;
    use objc2::runtime::AnyObject;

    let block = RcBlock::new(move |image: *mut AnyObject, _error: *mut AnyObject| {
        let result = if image.is_null() {
            Err("NSImage が null です（Webview が非表示の可能性があります）".to_string())
        } else {
            encode_nsimage_to_base64(image)
        };
        if let Ok(mut guard) = tx.lock() {
            if let Some(sender) = guard.take() {
                let _ = sender.send(result);
            }
        }
    });

    unsafe {
        let nil: *mut AnyObject = std::ptr::null_mut();
        // takeSnapshotWithConfiguration:nil は全画面のスナップショットをデフォルト設定で取得
        let _: () = objc2::msg_send![raw_ptr, takeSnapshotWithConfiguration: nil, completionHandler: &*block];
    }
}

/// NSImage ポインタを PNG base64 Data URL に変換する。
#[cfg(target_os = "macos")]
fn encode_nsimage_to_base64(image: *mut objc2::runtime::AnyObject) -> Result<String, String> {
    use base64::Engine as _;
    use objc2::runtime::{AnyClass, AnyObject};

    unsafe {
        // NSImage → TIFF 中間表現
        let tiff: *mut AnyObject = objc2::msg_send![image, TIFFRepresentation];
        if tiff.is_null() {
            return Err("TIFFRepresentation が null です".to_string());
        }

        // NSBitmapImageRep に変換
        let cls = AnyClass::get(c"NSBitmapImageRep")
            .ok_or("NSBitmapImageRep クラスが見つかりません")?;
        let bitmap: *mut AnyObject = objc2::msg_send![cls, imageRepWithData: tiff];
        if bitmap.is_null() {
            return Err("NSBitmapImageRep の生成に失敗しました".to_string());
        }

        // PNG 形式でエクスポート（NSBitmapImageFileTypePNG = 4）
        let nil_dict: *mut AnyObject = std::ptr::null_mut();
        let png_data: *mut AnyObject = objc2::msg_send![
            bitmap,
            representationUsingType: 4usize,
            properties: nil_dict
        ];
        if png_data.is_null() {
            return Err("PNG データの生成に失敗しました".to_string());
        }

        let bytes: *const u8 = objc2::msg_send![png_data, bytes];
        let length: usize = objc2::msg_send![png_data, length];

        let slice = std::slice::from_raw_parts(bytes, length);
        let encoded = base64::engine::general_purpose::STANDARD.encode(slice);
        Ok(format!("data:image/png;base64,{encoded}"))
    }
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

/// CSS transform injection でビジュアルスケーリングを適用する。
/// pageZoom と異なりビューポートサイズを変更せず、レイアウトリフローも発生しない。
#[tauri::command]
pub async fn set_page_webview_scale(
    app: AppHandle,
    page_id: String,
    scale: f64,
) -> Result<(), String> {
    let label = format!("page-{}", page_id);
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("Webview '{label}' が見つかりません"))?;
    webview
        .eval(&format!(
            "window.__siteboardSetScale&&window.__siteboardSetScale({})",
            scale
        ))
        .map_err(|e| format!("eval エラー: {e}"))
}

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

    // SPA のクライアントサイドルーティング（history.pushState/replaceState）を検出するため、
    // initialization_script を注入して URL 変更を on_document_title_changed 経由で通知する。
    // on_navigation は WKWebView の decidePolicyForNavigationAction にマッピングされており、
    // pushState/replaceState では発火しないため、この代替手段が必要。
    // __siteboardSetScale: CSS transform でビジュアルスケーリングのみ行い、ビューポートサイズを変更しない。
    // pageZoom と異なりレイアウトリフローが発生せず、拡大縮小禁止サイトでも表示が崩れない。
    let spa_url_detection_script = r#"(function() {
  var lastUrl = location.href;
  function onUrlChange() {
    var newUrl = location.href;
    if (newUrl === lastUrl) return;
    lastUrl = newUrl;
    var orig = document.title;
    document.title = '\x01' + newUrl;
    requestAnimationFrame(function() { document.title = orig; });
  }
  var origPush = history.pushState;
  history.pushState = function() {
    var r = origPush.apply(this, arguments);
    onUrlChange();
    return r;
  };
  var origReplace = history.replaceState;
  history.replaceState = function() {
    var r = origReplace.apply(this, arguments);
    onUrlChange();
    return r;
  };
  window.addEventListener('popstate', onUrlChange);
  window.__siteboardSetScale = function(s) {
    var h = document.documentElement;
    if (!h) return;
    if (Math.abs(s - 1) < 0.005) {
      h.style.removeProperty('transform');
      h.style.removeProperty('transform-origin');
      h.style.removeProperty('width');
      h.style.removeProperty('overflow-x');
    } else {
      h.style.setProperty('transform', 'scale(' + s + ')', 'important');
      h.style.setProperty('transform-origin', 'top left', 'important');
      h.style.setProperty('width', (100 / s) + '%', 'important');
      h.style.setProperty('overflow-x', 'hidden', 'important');
    }
  };
})();"#;

    window
        .add_child(
            tauri::webview::WebviewBuilder::new(&label_clone, WebviewUrl::External(parsed_url))
                .initialization_script(spa_url_detection_script)
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
                        // \x01 プレフィックスは initialization_script からの SPA URL 変更通知
                        if let Some(url) = title.strip_prefix('\u{0001}') {
                            ah.emit(
                                &format!("page-navigated-{pid}"),
                                serde_json::json!({ "url": url }),
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

    Ok(label)
}
