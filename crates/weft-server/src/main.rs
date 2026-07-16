//! `weft-server` — the Weft HTTP server.
//!
//! Serves the JSON API under `/api/v1` and (in the all-in-one image, from
//! v0.2.0) reverse-proxies everything else to the SolidStart SSR process.

use tracing_subscriber::EnvFilter;
use weft_core::Config;
use weft_server::{app_with_proxy, supervisor, AppState, SsrProxy};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .init();

    let config = Config::load()?;
    let state = AppState::from_config(&config)?;

    // All-in-one image: start + supervise the SolidStart SSR process and
    // reverse-proxy every non-API path to it.
    if let Ok(command) = std::env::var("WEFT_SSR_COMMAND") {
        supervisor::spawn_supervised(command);
    }
    let ssr = std::env::var("WEFT_SSR_PROXY").ok().map(SsrProxy::new);
    if let Some(proxy) = &ssr {
        tracing::info!(?proxy, "SSR reverse proxy enabled");
    }

    let listener = tokio::net::TcpListener::bind(&config.listen).await?;
    tracing::info!(listen = %config.listen, instances = state.instance_count(), "weft-server started");

    // ConnectInfo gives handlers the TCP peer address (session rate limiting).
    axum::serve(
        listener,
        app_with_proxy(state, ssr).into_make_service_with_connect_info::<std::net::SocketAddr>(),
    )
    .await?;
    Ok(())
}
