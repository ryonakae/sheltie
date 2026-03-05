use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl};

#[cfg(target_os = "macos")]
fn sanitize_zoom(zoom: f64) -> f64 {
    if zoom.is_finite() && zoom > 0.0 {
        zoom
    } else {
        1.0
    }
}

#[cfg(target_os = "macos")]
fn run_objc_void_guarded<F>(context: &str, f: F)
where
    F: FnOnce(),
{
    // macOS の private selector は OS バージョン差分で ObjC 例外を投げる場合があるため、
    // 起動直後クラッシュを防ぐために補正処理をスキップして継続する。
    if let Err(exception) = objc2::exception::catch(std::panic::AssertUnwindSafe(f)) {
        let detail = exception
            .as_ref()
            .map(|e| format!("{e:?}"))
            .unwrap_or_else(|| "nil exception".to_string());
        log::warn!(
            "Objective-C 呼び出し `{context}` で例外が発生したため補正をスキップしました: {detail}"
        );
    }
}

#[cfg(target_os = "macos")]
fn run_objc_bool_guarded<F>(context: &str, f: F) -> bool
where
    F: FnOnce() -> bool,
{
    match objc2::exception::catch(std::panic::AssertUnwindSafe(f)) {
        Ok(value) => value,
        Err(exception) => {
            let detail = exception
                .as_ref()
                .map(|e| format!("{e:?}"))
                .unwrap_or_else(|| "nil exception".to_string());
            log::warn!(
                "Objective-C 呼び出し `{context}` で例外が発生したため `false` を返します: {detail}"
            );
            false
        }
    }
}

/// frame/zoom から CSS viewport の論理サイズを計算する。
///
/// 無効な zoom 値で NaN/Inf になるのを防ぐ。
#[cfg(target_os = "macos")]
fn compute_css_viewport_size_for_units(width: f64, height: f64, zoom: f64) -> (f64, f64) {
    let safe_zoom = sanitize_zoom(zoom);
    (width / safe_zoom, height / safe_zoom)
}

/// CSS Viewport Units（svh/lvh）の基準サイズを CSS viewport（論理サイズ）に合わせる。
///
/// `_setLayoutMode: 2` + `_setViewScale` は vh/dvh のみに効き、svh/lvh は
/// "unobscured size" を参照するため、viewport insets を使って補正する。
///
/// WebKit 内部の計算:
///   `minimumUnobscuredSize = frame - maximumViewportInset` → svh
///   `maximumUnobscuredSize = frame - minimumViewportInset` → lvh
///
/// `inset = physical - logical`（zoom < 1 で負値）を渡すと:
///   `unobscuredSize = physical - (physical - logical) = logical` ✓
///
/// 優先度 1: `_recalculateViewportSizesWithMinimumViewportInset:maximumViewportInset:throwOnInvalidInput:`
///   WebKit 内部で `setFrameSize:` から `throwOnInvalidInput: NO` で呼ばれるメソッドを直接呼ぶことで、
///   公開 API の負値バリデーション（macOS 26.2 で強化）をスキップして負 inset を設定できる。
///
/// 優先度 2: `setMinimumViewportInset:maximumViewportInset:` (macOS 13.0+)
///   公開 API。inset が非負（zoom >= 1）の場合のみ有効。
#[cfg(target_os = "macos")]
unsafe fn set_css_viewport_unit_sizes(
    raw: *mut objc2::runtime::AnyObject,
    physical_width: f64,
    physical_height: f64,
    logical_width: f64,
    logical_height: f64,
) {
    use objc2_foundation::NSEdgeInsets;

    // zoom < 1 のとき inset は負値（logical > physical）になる
    let inset_right = physical_width - logical_width;
    let inset_bottom = physical_height - logical_height;
    let inset = NSEdgeInsets {
        top: 0.0,
        left: 0.0,
        bottom: inset_bottom,
        right: inset_right,
    };

    // 優先度 1: 内部メソッドを throwOnInvalidInput: NO で呼び、負 inset バリデーションをスキップ
    let recalc_sel = objc2::sel!(
        _recalculateViewportSizesWithMinimumViewportInset:maximumViewportInset:throwOnInvalidInput:
    );
    let supports_recalc = run_objc_bool_guarded(
        "respondsToSelector(_recalculateViewportSizes...)",
        || unsafe { objc2::msg_send![raw, respondsToSelector: recalc_sel] },
    );
    if supports_recalc {
        run_objc_void_guarded(
            "_recalculateViewportSizesWithMinimumViewportInset:maximumViewportInset:throwOnInvalidInput:",
            || unsafe {
                let _: () = objc2::msg_send![
                    raw,
                    _recalculateViewportSizesWithMinimumViewportInset: inset,
                    maximumViewportInset: inset,
                    throwOnInvalidInput: false
                ];
            },
        );
        return;
    }

    // 優先度 2: 公開 API（inset が非負の場合のみ呼ぶ。負値は NSInvalidArgumentException）
    if inset_right >= 0.0 && inset_bottom >= 0.0 {
        let supports_inset = run_objc_bool_guarded(
            "respondsToSelector(setMinimumViewportInset:maximumViewportInset:)",
            || unsafe {
                objc2::msg_send![
                    raw,
                    respondsToSelector: objc2::sel!(setMinimumViewportInset:maximumViewportInset:)
                ]
            },
        );
        if supports_inset {
            run_objc_void_guarded(
                "setMinimumViewportInset:maximumViewportInset:",
                || unsafe {
                    let _: () = objc2::msg_send![
                        raw,
                        setMinimumViewportInset: inset,
                        maximumViewportInset: inset
                    ];
                },
            );
        }
    }
}

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

/// NSImage ポインタを PNG バイト列に変換する。
#[cfg(target_os = "macos")]
fn nsimage_to_png_bytes(image: *mut objc2::runtime::AnyObject) -> Result<Vec<u8>, String> {
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
        Ok(slice.to_vec())
    }
}

/// NSImage ポインタを PNG base64 Data URL に変換する。
#[cfg(target_os = "macos")]
fn encode_nsimage_to_base64(image: *mut objc2::runtime::AnyObject) -> Result<String, String> {
    use base64::Engine as _;
    let bytes = nsimage_to_png_bytes(image)?;
    let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(format!("data:image/png;base64,{encoded}"))
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

    // SPA のクライアントサイドルーティング（history.pushState/replaceState）を検出するため、
    // initialization_script を注入して URL 変更を on_document_title_changed 経由で通知する。
    // on_navigation は WKWebView の decidePolicyForNavigationAction にマッピングされており、
    // pushState/replaceState では発火しないため、この代替手段が必要。
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
})();"#;

    // scrollend（Safari 26.2+）+ debounced scroll のハイブリッドでスクロール完了を検知し、
    // \x02 プレフィックスで on_document_title_changed 経由で通知する
    let scroll_detection_script = r#"(function() {
  var t = null, orig = '', DELAY = 150;
  function notify() {
    orig = document.title;
    document.title = '\x02scroll-end';
    requestAnimationFrame(function() { document.title = orig; });
  }
  if ('onscrollend' in window) {
    window.addEventListener('scrollend', notify, { passive: true });
  } else {
    window.addEventListener('scroll', function() {
      if (t) clearTimeout(t);
      t = setTimeout(notify, DELAY);
    }, { passive: true, capture: true });
  }
})();"#;

    window
        .add_child(
            tauri::webview::WebviewBuilder::new(&label_clone, WebviewUrl::External(parsed_url))
                .initialization_script(spa_url_detection_script)
                .initialization_script(scroll_detection_script)
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
        let safe_zoom = sanitize_zoom(zoom);
        let (css_viewport_width, css_viewport_height) =
            compute_css_viewport_size_for_units(width, height, safe_zoom);

        if let Some(wv) = app.get_webview(&label) {
            wv.with_webview(move |platform_wv| {
                let raw = platform_wv.inner() as *mut objc2::runtime::AnyObject;
                run_objc_void_guarded("_setLayoutMode + _setViewScale + viewport insets", || unsafe {
                    // _WKLayoutModeDynamicSizeComputedFromViewScale = 2
                    let _: () = objc2::msg_send![raw, _setLayoutMode: 2i64];
                    let _: () = objc2::msg_send![raw, _setViewScale: safe_zoom];
                    set_css_viewport_unit_sizes(
                        raw,
                        width,
                        height,
                        css_viewport_width,
                        css_viewport_height,
                    );
                });
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
        run_objc_void_guarded("setAlphaValue:", || unsafe {
            let _: () = objc2::msg_send![raw, setAlphaValue: opacity];
        });
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

    let safe_zoom = sanitize_zoom(zoom);
    let (css_viewport_width, css_viewport_height) =
        compute_css_viewport_size_for_units(width, height, safe_zoom);
    wv.with_webview(move |platform_wv| {
        let raw = platform_wv.inner() as *mut objc2::runtime::AnyObject;
        run_objc_void_guarded("_setViewScale + viewport insets", || unsafe {
            let _: () = objc2::msg_send![raw, _setViewScale: safe_zoom];
            set_css_viewport_unit_sizes(raw, width, height, css_viewport_width, css_viewport_height);
        });
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
    use std::sync::{Arc, Mutex};
    use tokio::sync::oneshot;
    use block2::RcBlock;
    use objc2::runtime::AnyObject;

    let label = format!("page-{}", page_id);
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("Webview '{label}' が見つかりません"))?;

    let (tx, rx) = oneshot::channel::<Result<Vec<u8>, String>>();
    let tx = Arc::new(Mutex::new(Some(tx)));

    webview
        .with_webview(move |platform_wv| {
            let raw_ptr = platform_wv.inner() as *mut AnyObject;

            let block = RcBlock::new(move |image: *mut AnyObject, _error: *mut AnyObject| {
                let result = if image.is_null() {
                    Err("NSImage が null です（Webview が非表示の可能性があります）".to_string())
                } else {
                    nsimage_to_png_bytes(image)
                };
                if let Ok(mut guard) = tx.lock() {
                    if let Some(sender) = guard.take() {
                        let _ = sender.send(result);
                    }
                }
            });

            unsafe {
                let nil: *mut AnyObject = std::ptr::null_mut();
                let _: () = objc2::msg_send![raw_ptr, takeSnapshotWithConfiguration: nil, completionHandler: &*block];
            }
        })
        .map_err(|e| format!("with_webview エラー: {e}"))?;

    let png_bytes = rx
        .await
        .map_err(|_| "スクリーンショットチャネルが閉じられました".to_string())??;

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
