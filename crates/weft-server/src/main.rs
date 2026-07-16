//! `weft-server` — the Weft HTTP server.
//!
//! Serves the JSON API under `/api/v1` and (in the all-in-one image, from
//! v0.2.0) reverse-proxies everything else to the SolidStart SSR process.

use tracing_subscriber::EnvFilter;
use weft_core::Config;
use weft_server::{app, AppState};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .init();

    let config = Config::load()?;
    let state = AppState::from_config(&config)?;
    let listener = tokio::net::TcpListener::bind(&config.listen).await?;
    tracing::info!(listen = %config.listen, instances = state.instance_count(), "weft-server started");

    axum::serve(listener, app(state)).await?;
    Ok(())
}
