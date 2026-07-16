//! Reverse proxy to the SolidStart SSR process (all-in-one image).
//!
//! In the zero-config container, the Rust server is the only published port:
//! `/api`, `/healthz`, `/readyz` are handled here, everything else is
//! forwarded to the node SSR server on loopback.

use axum::body::Body;
use axum::extract::Request;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use futures_util::TryStreamExt;
use http_body_util::BodyExt;
use std::time::Duration;

/// Handle to the SSR upstream.
#[derive(Debug, Clone)]
pub struct SsrProxy {
    client: reqwest::Client,
    base: String,
}

impl SsrProxy {
    /// `base` is the SSR server origin, e.g. `http://127.0.0.1:3000`.
    pub fn new(base: String) -> Self {
        let client = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(2))
            // No total timeout: SSR responses stream and can be long-lived.
            .build()
            .expect("proxy client construction cannot fail with static config");
        Self {
            client,
            base: base.trim_end_matches('/').to_string(),
        }
    }

    /// Forward `req` to the SSR upstream, streaming the response back.
    pub async fn forward(&self, req: Request) -> Response {
        let path_and_query = req
            .uri()
            .path_and_query()
            .map(|pq| pq.as_str())
            .unwrap_or("/");
        let url = format!("{}{}", self.base, path_and_query);

        let method = match reqwest::Method::from_bytes(req.method().as_str().as_bytes()) {
            Ok(m) => m,
            Err(_) => return StatusCode::METHOD_NOT_ALLOWED.into_response(),
        };

        let mut upstream = self.client.request(method, url);
        for (name, value) in req.headers() {
            // Hop-by-hop headers must not be forwarded.
            if matches!(name.as_str(), "host" | "connection" | "transfer-encoding") {
                continue;
            }
            upstream = upstream.header(name, value);
        }

        let body = match req.into_body().collect().await {
            Ok(collected) => collected.to_bytes(),
            Err(_) => return StatusCode::BAD_REQUEST.into_response(),
        };

        match upstream.body(body).send().await {
            Ok(resp) => {
                let status = resp.status();
                let mut builder = Response::builder().status(status.as_u16());
                for (name, value) in resp.headers() {
                    if matches!(name.as_str(), "connection" | "transfer-encoding") {
                        continue;
                    }
                    builder = builder.header(name, value);
                }
                let stream = resp.bytes_stream().map_err(std::io::Error::other);
                builder
                    .body(Body::from_stream(stream))
                    .unwrap_or_else(|_| StatusCode::BAD_GATEWAY.into_response())
            }
            Err(err) => {
                tracing::warn!(%err, "SSR upstream unreachable");
                (
                    StatusCode::BAD_GATEWAY,
                    "Weft UI is starting up — retry in a moment.",
                )
                    .into_response()
            }
        }
    }
}
