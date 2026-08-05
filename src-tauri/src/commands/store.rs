pub mod document_manager;
pub mod document_window;
pub mod file_io;
pub mod macos_tabs;

pub use document_manager::DocumentManagerState;
pub use document_window::{
    create_transient_untitled_document_window, create_untitled_document_window,
    focused_document_window_label, handle_launch_args, handle_opened_urls,
    strictly_focused_document_window_label,
};
// DevTools メニュー（debug ビルド限定）からのみ使う
#[cfg(debug_assertions)]
pub use document_window::focus_document_window;
pub use macos_tabs::configure_macos_window_tabbing_policy;
