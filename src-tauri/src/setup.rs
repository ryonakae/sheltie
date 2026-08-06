use tauri::{menu::Menu, Manager, RunEvent};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

use crate::app_exit::{emit_app_exit_requested, AppExitCoordinatorState};
use crate::commands::{
    store::{
        configure_macos_window_tabbing_policy, create_transient_untitled_document_window,
        handle_launch_args, strictly_focused_document_window_label, DocumentManagerState,
    },
    theme::{load_persisted_theme, MENU_ID_THEME_DARK, MENU_ID_THEME_LIGHT, MENU_ID_THEME_SYSTEM},
};
// DevTools メニューは debug ビルドだけに存在するため、その中でしか使わない
#[cfg(debug_assertions)]
use crate::commands::store::{focus_document_window, focused_document_window_label};
use crate::mcp::broker::McpRequestBrokerState;
use crate::mcp::lifecycle::{
    apply_requested_enabled, apply_requested_runtime_only, load_mcp_enabled, McpServerState,
};
use crate::mcp::page_automation::actor::PageAutomationState;
use crate::mcp::MCP_BIND_ADDRESS;
use crate::menus::{
    app::configure_app_menu,
    edit::{configure_edit_menu, emit_edit_command},
    file::{configure_file_menu, emit_file_command},
    mcp::{emit_mcp_lifecycle_changed, update_mcp_connection_count, update_mcp_menu_action},
    theme::{emit_theme_command, update_theme_check_state},
    view::{configure_view_menu, emit_view_command},
    MENU_ID_APP_QUIT, MENU_ID_EDIT_DELETE, MENU_ID_EDIT_REDO, MENU_ID_EDIT_UNDO,
    MENU_ID_FILE_NEW_TAB, MENU_ID_FILE_NEW_WINDOW, MENU_ID_FILE_OPEN, MENU_ID_FILE_SAVE,
    MENU_ID_FILE_SAVE_AS, MENU_ID_MCP_ENABLED, MENU_ID_OPEN_DEVTOOLS, MENU_ID_VIEW_FIT,
    MENU_ID_VIEW_RESET_ZOOM, MENU_ID_VIEW_ZOOM_IN, MENU_ID_VIEW_ZOOM_OUT,
};
#[cfg(debug_assertions)]
use tauri::menu::{MenuItemBuilder, SubmenuBuilder};

fn mcp_lifecycle_notification_window<'a>(
    state: &McpServerState,
    generation: u64,
    enabled: bool,
    notification_window_label: Option<&'a str>,
    apply_result: &Result<bool, String>,
) -> Option<&'a str> {
    if !matches!(apply_result, Ok(true))
        || !state
            .is_current_intent(generation, enabled)
            .unwrap_or(false)
    {
        return None;
    }
    notification_window_label
}

fn should_sync_mcp_menu_state(state: &McpServerState, generation: u64, enabled: bool) -> bool {
    state
        .is_current_intent(generation, enabled)
        .unwrap_or(false)
}

fn apply_mcp_menu_state(app: &tauri::AppHandle, enabled: bool) {
    update_mcp_menu_action(app, enabled);
    #[cfg(target_os = "macos")]
    if let Err(error) = crate::menus::macos::update_settings_mcp_section(enabled) {
        log::warn!("failed to update MCP section in Settings: {error}");
    }
}

fn sync_mcp_menu_state(app: &tauri::AppHandle, generation: u64, enabled: bool) {
    let app_for_update = app.clone();
    if let Err(error) = app.run_on_main_thread(move || {
        let state = app_for_update.state::<McpServerState>();
        if should_sync_mcp_menu_state(&state, generation, enabled) {
            apply_mcp_menu_state(&app_for_update, enabled);
        }
    }) {
        log::warn!("failed to schedule MCP menu state update: {error}");
    }
}

fn request_mcp_enabled(
    app: tauri::AppHandle,
    enabled: bool,
    notification_window_label: Option<String>,
) {
    let state = app.state::<McpServerState>();
    let generation = match state.request_enabled(enabled) {
        Ok(generation) => generation,
        Err(error) => {
            log::error!("failed to register MCP enablement intent: {error}");
            apply_mcp_menu_state(&app, load_mcp_enabled(&app));
            return;
        }
    };
    sync_mcp_menu_state(&app, generation, enabled);

    tauri::async_runtime::spawn(async move {
        let apply_result = apply_requested_enabled(app.clone(), generation, enabled).await;

        match &apply_result {
            Ok(true) => sync_mcp_menu_state(&app, generation, enabled),
            Ok(false) => {}
            Err(error) => {
                log::error!("failed to update MCP server lifecycle: {error}");
                let recovery_enabled = !enabled;
                let recovery_generation = app
                    .state::<McpServerState>()
                    .request_recovery_if_current(generation, enabled, recovery_enabled)
                    .ok()
                    .flatten();
                if let Some(recovery_generation) = recovery_generation {
                    sync_mcp_menu_state(&app, recovery_generation, recovery_enabled);
                    if let Err(recovery_error) =
                        apply_requested_enabled(app.clone(), recovery_generation, recovery_enabled)
                            .await
                    {
                        log::error!("failed to persist MCP lifecycle recovery: {recovery_error}");
                        let _ = apply_requested_runtime_only(
                            app.clone(),
                            recovery_generation,
                            recovery_enabled,
                        )
                        .await;
                    }
                    app.dialog()
                        .message(format!(
                            "Sheltie could not change the MCP server setting on {MCP_BIND_ADDRESS}.\n\n{error}"
                        ))
                        .kind(MessageDialogKind::Error)
                        .title("MCP Server")
                        .show(|_| {});
                }
            }
        }

        if let Some(window_label) = notification_window_label {
            let app_for_notification = app.clone();
            if let Err(error) = app.run_on_main_thread(move || {
                let state = app_for_notification.state::<McpServerState>();
                if mcp_lifecycle_notification_window(
                    &state,
                    generation,
                    enabled,
                    Some(&window_label),
                    &apply_result,
                )
                .is_some()
                {
                    emit_mcp_lifecycle_changed(&app_for_notification, &window_label, enabled);
                }
            }) {
                log::warn!("failed to schedule MCP lifecycle notification: {error}");
            }
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    use tauri_plugin_prevent_default::Flags;

    let builder = tauri::Builder::default()
        .manage(DocumentManagerState::default())
        .manage(AppExitCoordinatorState::default())
        .manage(McpRequestBrokerState::default())
        .manage(PageAutomationState::default())
        .manage(McpServerState::default())
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            if let Err(error) = handle_launch_args(app, &argv, Some(cwd.as_str())) {
                log::error!("failed to handle single-instance launch request: {error}");
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_prevent_default::Builder::new()
                .with_flags(Flags::CONTEXT_MENU)
                .build(),
        )
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .menu(|app| {
            let menu = Menu::default(app)?;
            configure_app_menu(app, &menu)?;
            configure_file_menu(app, &menu)?;
            configure_edit_menu(app, &menu)?;
            configure_view_menu(app, &menu)?;

            #[cfg(debug_assertions)]
            {
                let devtools_item =
                    MenuItemBuilder::with_id(MENU_ID_OPEN_DEVTOOLS, "Open DevTools").build(app)?;
                let develop_menu = SubmenuBuilder::with_id(app, "develop", "Develop")
                    .item(&devtools_item)
                    .build()?;
                menu.append(&develop_menu)?;
            }

            Ok(menu)
        });

    let app = builder
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            if let Err(error) = configure_macos_window_tabbing_policy(app.handle()) {
                log::error!("failed to initialize macOS native tab: {error}");
            }
            // tauri_plugin_store の State がここで初期化済みなので、
            // 永続化済みテーマで Settings > Theme の初期チェック状態を反映する
            let initial_theme = load_persisted_theme(app.handle());
            update_theme_check_state(app.handle(), &initial_theme);
            update_mcp_connection_count(app.handle(), 0);
            let initial_mcp_enabled = cfg!(target_os = "macos") && load_mcp_enabled(app.handle());
            update_mcp_menu_action(app.handle(), initial_mcp_enabled);

            #[cfg(target_os = "macos")]
            if let Err(error) =
                crate::menus::macos::apply_settings_section_headers(initial_mcp_enabled)
            {
                log::warn!("failed to insert Settings section headers: {error}");
            }

            #[cfg(target_os = "macos")]
            if initial_mcp_enabled {
                request_mcp_enabled(app.handle().clone(), true, None);
            }

            let launch_args: Vec<String> = std::env::args().collect();
            if let Err(error) = handle_launch_args(app.handle(), &launch_args, None) {
                log::error!("failed to create initial window: {error}");
            }
            app.on_menu_event(|app, event| match event.id().as_ref() {
                MENU_ID_APP_QUIT => emit_app_exit_requested(app),
                MENU_ID_FILE_NEW_TAB => emit_file_command(app, "new-tab"),
                MENU_ID_FILE_NEW_WINDOW => emit_file_command(app, "new-window"),
                MENU_ID_FILE_OPEN => emit_file_command(app, "open"),
                MENU_ID_FILE_SAVE => emit_file_command(app, "save"),
                MENU_ID_FILE_SAVE_AS => emit_file_command(app, "save-as"),
                MENU_ID_EDIT_UNDO => emit_edit_command(app, "undo"),
                MENU_ID_EDIT_REDO => emit_edit_command(app, "redo"),
                MENU_ID_EDIT_DELETE => emit_edit_command(app, "delete"),
                MENU_ID_VIEW_FIT => emit_view_command(app, "fit-view"),
                MENU_ID_VIEW_RESET_ZOOM => emit_view_command(app, "reset-zoom"),
                MENU_ID_VIEW_ZOOM_IN => emit_view_command(app, "zoom-in"),
                MENU_ID_VIEW_ZOOM_OUT => emit_view_command(app, "zoom-out"),
                MENU_ID_THEME_LIGHT => {
                    update_theme_check_state(app, "light");
                    emit_theme_command(app, "light");
                }
                MENU_ID_THEME_DARK => {
                    update_theme_check_state(app, "dark");
                    emit_theme_command(app, "dark");
                }
                MENU_ID_THEME_SYSTEM => {
                    update_theme_check_state(app, "system");
                    emit_theme_command(app, "system");
                }
                MENU_ID_MCP_ENABLED => {
                    let enabled = match app.state::<McpServerState>().desired_enabled() {
                        Ok(enabled) => !enabled,
                        Err(error) => {
                            log::error!("failed to read MCP enablement intent: {error}");
                            return;
                        }
                    };
                    request_mcp_enabled(
                        app.clone(),
                        enabled,
                        strictly_focused_document_window_label(app),
                    );
                }
                MENU_ID_OPEN_DEVTOOLS =>
                {
                    #[cfg(debug_assertions)]
                    if let Some(label) = focused_document_window_label(app) {
                        if let Some(window) = app.get_webview_window(&label) {
                            let _ = focus_document_window(app, &label);
                            window.open_devtools();
                        }
                    } else if let Some(label) = app
                        .windows()
                        .into_iter()
                        .find_map(|(label, _)| label.starts_with("document-").then_some(label))
                    {
                        if let Some(window) = app.get_webview_window(&label) {
                            window.open_devtools();
                        }
                    }
                }
                _ => {}
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            crate::commands::store::document_window::load_window_context,
            crate::commands::store::macos_tabs::present_document_window,
            crate::commands::store::macos_tabs::new_document_tab,
            crate::commands::store::macos_tabs::set_document_edited,
            crate::commands::store::document_window::new_document_window,
            crate::commands::store::document_window::open_document_window,
            crate::commands::store::document_window::complete_app_exit,
            crate::commands::store::document_window::abort_app_exit,
            crate::commands::store::document_window::close_ready,
            crate::commands::store::file_io::load_project_file,
            crate::commands::store::file_io::save_project_file,
            crate::commands::theme::load_theme,
            crate::commands::theme::set_theme,
            crate::commands::theme::get_platform_info,
            crate::commands::webview::bounds::create_page_webview,
            crate::commands::webview::screenshots::capture_webview_screenshot,
            crate::commands::webview::navigation::reload_page_webview,
            crate::commands::webview::navigation::go_back_page_webview,
            crate::commands::webview::navigation::go_forward_page_webview,
            crate::commands::webview::navigation::get_navigation_state_page_webview,
            crate::commands::webview::page_automation::complete_page_automation_request,
            crate::commands::webview::page_automation::unregister_page_automation_page,
            crate::commands::webview::bounds::update_page_webview_bounds,
            crate::commands::webview::bounds::set_page_webview_opacity,
            crate::commands::webview::bounds::batch_update_page_webview_bounds,
            crate::commands::webview::bounds::batch_update_webview_positions,
            crate::commands::webview::screenshots::save_webview_screenshot,
            crate::commands::webview::screenshots::get_existing_screenshot_paths,
            crate::commands::webview::screenshots::delete_screenshot,
            crate::commands::webview::screenshots::prune_screenshot_cache,
            crate::commands::dialog::show_unsaved_changes_dialog,
            crate::mcp::broker::complete_mcp_renderer_request,
        ])
        .build(tauri::generate_context!())
        .expect("an error occurred while running the Tauri app");

    app.run(|app_handle, event| {
        #[cfg(target_os = "macos")]
        match event {
            RunEvent::ExitRequested { api, .. } => {
                let exit_state = app_handle.state::<AppExitCoordinatorState>();
                match exit_state.consume_allow_exit() {
                    Ok(true) => {}
                    // Cmd+Q / Quit メニュー以外（全ウインドウクローズ等）で発火した
                    // ExitRequested は無視し、一般的な Mac アプリと同様にプロセスを維持する
                    Ok(false) => match exit_state.has_pending_quit() {
                        Ok(true) | Ok(false) => api.prevent_exit(),
                        Err(error) => {
                            log::error!("failed to handle ExitRequested: {error}");
                            api.prevent_exit();
                        }
                    },
                    Err(error) => {
                        log::error!("failed to handle ExitRequested: {error}");
                        api.prevent_exit();
                    }
                }
            }
            // Finder のダブルクリック等で届く Apple Event。macOS では argv に
            // パスが渡らないため、この経路が唯一の入口になる
            RunEvent::Opened { urls } => {
                crate::commands::store::handle_opened_urls(app_handle, &urls);
            }
            // Dock アイコンクリック等の applicationShouldHandleReopen 発火時、
            // document window が 1 枚も無ければ新規 untitled を開く。
            // 最小化など「window はあるが不可視」の場合は OS の標準復帰に任せる。
            RunEvent::Reopen {
                has_visible_windows: false,
                ..
            } => {
                let has_document_window = app_handle
                    .windows()
                    .keys()
                    .any(|label| label.starts_with("document-"));
                if !has_document_window {
                    if let Err(error) = create_transient_untitled_document_window(app_handle) {
                        log::error!("failed to create window on dock reopen: {error}");
                    }
                }
            }
            _ => {}
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn menu_sync_accepts_only_current_intent() {
        let state = McpServerState::default();
        let enable_generation = state.request_enabled(true).unwrap();
        let disable_generation = state.request_enabled(false).unwrap();

        assert!(!should_sync_mcp_menu_state(&state, enable_generation, true));
        assert!(should_sync_mcp_menu_state(
            &state,
            disable_generation,
            false
        ));
    }

    #[test]
    fn lifecycle_notification_requires_current_applied_result_and_target_window() {
        let state = McpServerState::default();
        let generation = state.request_enabled(true).unwrap();
        let applied = Ok(true);
        let stale = Ok(false);
        let failed = Err("bind failed".to_string());

        assert_eq!(
            mcp_lifecycle_notification_window(
                &state,
                generation,
                true,
                Some("document-1"),
                &applied,
            ),
            Some("document-1")
        );
        assert_eq!(
            mcp_lifecycle_notification_window(&state, generation, true, None, &applied),
            None
        );
        assert_eq!(
            mcp_lifecycle_notification_window(&state, generation, true, Some("document-1"), &stale,),
            None
        );
        assert_eq!(
            mcp_lifecycle_notification_window(
                &state,
                generation,
                true,
                Some("document-1"),
                &failed,
            ),
            None
        );

        state.request_enabled(false).unwrap();
        assert_eq!(
            mcp_lifecycle_notification_window(
                &state,
                generation,
                true,
                Some("document-1"),
                &applied,
            ),
            None
        );
    }
}
