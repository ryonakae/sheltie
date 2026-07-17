pub const MCP_BIND_ADDRESS: &str = "127.0.0.1:29978";
pub const MCP_ENDPOINT: &str = "http://127.0.0.1:29978/mcp";
pub const MCP_RENDERER_REQUEST_EVENT: &str = "mcp-renderer-request";
pub const MCP_RENDERER_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);

pub mod lifecycle;
pub mod service;
pub mod types;
