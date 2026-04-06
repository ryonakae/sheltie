#[derive(serde::Deserialize)]
pub struct UnsavedChangesDialogParams {
    kind: String,
    #[serde(rename = "projectTitle")]
    project_title: Option<String>,
    #[serde(rename = "projectTitles")]
    project_titles: Option<Vec<String>>,
}

#[cfg(target_os = "macos")]
fn build_alert_texts(params: &UnsavedChangesDialogParams) -> (String, String, &'static str, &'static str) {
    let is_app_exit = params.kind == "app-exit";

    let titles = params.project_titles.as_deref().unwrap_or(&[]);
    let title_text = params.project_title.as_deref().unwrap_or("名称未設定");

    let message_text = if is_app_exit {
        let n = titles.len();
        format!("未保存の変更がある {n} 件の書類があります。")
    } else {
        format!("「{title_text}」の変更内容を保存しますか？")
    };

    let informative_text = if is_app_exit && !titles.is_empty() {
        let list: String = titles
            .iter()
            .map(|t| format!("・{t}"))
            .collect::<Vec<_>>()
            .join("\n");
        format!("保存しないと、変更内容は失われます。\n\n{list}")
    } else {
        "保存しないと、変更内容は失われます。".to_string()
    };

    let save_label = if is_app_exit { "すべて保存" } else { "保存" };
    let discard_label = "削除";

    (message_text, informative_text, save_label, discard_label)
}

/// NSAlert をシートとして表示する（main thread から呼び出すこと）。
/// ユーザーがボタンを押すと tx に結果を送信する。
#[cfg(target_os = "macos")]
fn show_nsalert_sheet(
    params: &UnsavedChangesDialogParams,
    ns_window: *mut objc2::runtime::AnyObject,
    tx: std::sync::Arc<std::sync::Mutex<Option<std::sync::mpsc::Sender<String>>>>,
) {
    use block2::RcBlock;
    use objc2::runtime::{AnyClass, AnyObject};
    use objc2_foundation::NSString;

    let (message_text, informative_text, save_label, discard_label) = build_alert_texts(params);

    // NSAlertStyleWarning = 0
    const NS_ALERT_STYLE_WARNING: usize = 0;
    // NSAlertFirstButtonReturn=1000, Second=1001, Third=1002
    const FIRST: isize = 1000;
    const SECOND: isize = 1001;

    let result = objc2::exception::catch(std::panic::AssertUnwindSafe(|| unsafe {
        let alert_class = AnyClass::get(c"NSAlert")
            .expect("NSAlert クラスが見つかりません");
        let alert: *mut AnyObject = objc2::msg_send![alert_class, new];

        let _: () = objc2::msg_send![alert, setAlertStyle: NS_ALERT_STYLE_WARNING];

        let ns_message = NSString::from_str(&message_text);
        let _: () = objc2::msg_send![alert, setMessageText: &*ns_message];

        let ns_info = NSString::from_str(&informative_text);
        let _: () = objc2::msg_send![alert, setInformativeText: &*ns_info];

        // ボタン追加順 = 右から左（右端がデフォルト）
        let ns_save = NSString::from_str(save_label);
        let _: () = objc2::msg_send![alert, addButtonWithTitle: &*ns_save];

        let ns_cancel = NSString::from_str("キャンセル");
        let _: () = objc2::msg_send![alert, addButtonWithTitle: &*ns_cancel];

        let ns_discard = NSString::from_str(discard_label);
        let _: () = objc2::msg_send![alert, addButtonWithTitle: &*ns_discard];

        // 「削除」ボタンに Cmd+D を割り当て（macOS 標準）と danger soft カラーを設定
        let buttons: *mut AnyObject = objc2::msg_send![alert, buttons];
        let discard_btn: *mut AnyObject = objc2::msg_send![buttons, objectAtIndex: 2usize];
        let ns_d = NSString::from_str("d");
        let _: () = objc2::msg_send![discard_btn, setKeyEquivalent: &*ns_d];
        // NSEventModifierFlagCommand = 1 << 20
        let _: () = objc2::msg_send![discard_btn, setKeyEquivalentModifierMask: (1u64 << 20)];

        // macOS システムレッド（CotEditor の「削除」ボタンと同じ）
        let color_class = AnyClass::get(c"NSColor").expect("NSColor クラスが見つかりません");
        let danger_color: *mut AnyObject = objc2::msg_send![color_class, systemRedColor];
        let _: () = objc2::msg_send![discard_btn, setBezelColor: danger_color];

        // ユーザーがボタンを押した時に呼ばれる completion handler
        let block = RcBlock::new(move |response: isize| {
            let decision = match response {
                FIRST => "save",
                SECOND => "cancel",
                _ => "discard",
            };
            if let Ok(mut guard) = tx.lock() {
                if let Some(sender) = guard.take() {
                    let _ = sender.send(decision.to_string());
                }
            }
        });

        // シートとして表示（ウィンドウから降りてくるスタイル）
        let _: () = objc2::msg_send![
            alert,
            beginSheetModalForWindow: ns_window,
            completionHandler: &*block
        ];
    }));

    if let Err(exception) = result {
        let detail = exception
            .as_ref()
            .map(|e| format!("{e:?}"))
            .unwrap_or_else(|| "nil exception".to_string());
        log::warn!("NSAlert シート表示中に Objective-C 例外が発生しました: {detail}");
    }
}

#[tauri::command]
pub async fn show_unsaved_changes_dialog(
    window: tauri::Window,
    params: UnsavedChangesDialogParams,
) -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        use objc2::runtime::AnyObject;

        // NSWindow ポインタを取得（run_on_main_thread の外で取得可能）
        let ns_window_raw = window
            .ns_window()
            .map_err(|e| format!("NSWindow の取得に失敗しました: {e}"))?;

        // usize は Send なのでポインタ値としてクロージャに渡す
        let ns_window_addr = ns_window_raw as usize;

        let (sender, receiver) = std::sync::mpsc::channel::<String>();
        let tx = std::sync::Arc::new(std::sync::Mutex::new(Some(sender)));

        window
            .run_on_main_thread(move || {
                let ns_window = ns_window_addr as *mut AnyObject;
                show_nsalert_sheet(&params, ns_window, tx);
            })
            .map_err(|e| format!("main thread への切り替えに失敗しました: {e}"))?;

        receiver
            .recv()
            .map_err(|_| "ダイアログの結果受信に失敗しました".to_string())
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = (window, params);
        Ok("cancel".to_string())
    }
}
