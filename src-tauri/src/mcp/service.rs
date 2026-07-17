use rmcp::{
    model::{Implementation, ServerCapabilities, ServerInfo},
    ServerHandler,
};

#[derive(Clone, Debug, Default)]
pub struct SheltieMcpService;

impl ServerHandler for SheltieMcpService {
    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(ServerCapabilities::builder().build())
            .with_server_info(Implementation::new("sheltie", env!("CARGO_PKG_VERSION")))
            .with_instructions(
                "Operate open Sheltie documents. Enablement is controlled by the Sheltie Settings menu.",
            )
    }
}
