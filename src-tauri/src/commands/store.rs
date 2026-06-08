pub mod document_manager;
pub mod document_window;
pub mod file_io;
pub mod macos_tabs;

pub use document_manager::DocumentManagerState;
pub use document_window::{
    create_untitled_document_window, focus_document_window, focused_document_window_label,
    handle_launch_args,
};
pub use macos_tabs::configure_macos_window_tabbing_policy;
