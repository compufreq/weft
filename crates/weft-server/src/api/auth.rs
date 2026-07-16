//! Optional API authentication (`WEFT_AUTH_TOKEN`) and read-only mode.
//!
//! Design: the token protects the **API** (all data access). The SSR page
//! shells stay public — they contain no data until the browser authenticates.
//! Browsers get an HttpOnly session cookie via `POST /api/v1/auth/session`;
//! programmatic clients send `Authorization: Bearer <token>`.

use crate::AppState;
use axum::extract::{Request, State};
use axum::http::{header, HeaderMap, Method, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use axum::Json;
use secrecy::ExposeSecret;
use serde::Deserialize;
use serde_json::json;

pub const COOKIE_NAME: &str = "weft_token";

/// Constant-time string comparison (length leaks, contents don't).
fn ct_eq(a: &str, b: &str) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.bytes()
        .zip(b.bytes())
        .fold(0u8, |acc, (x, y)| acc | (x ^ y))
        == 0
}

fn cookie_token(headers: &HeaderMap) -> Option<String> {
    let cookies = headers.get(header::COOKIE)?.to_str().ok()?;
    cookies.split(';').find_map(|pair| {
        let (name, value) = pair.trim().split_once('=')?;
        (name == COOKIE_NAME).then(|| value.to_string())
    })
}

fn bearer_token(headers: &HeaderMap) -> Option<String> {
    let value = headers.get(header::AUTHORIZATION)?.to_str().ok()?;
    value.strip_prefix("Bearer ").map(str::to_string)
}

fn presented_token(headers: &HeaderMap) -> Option<String> {
    bearer_token(headers).or_else(|| cookie_token(headers))
}

fn authorized(state: &AppState, headers: &HeaderMap) -> bool {
    match &state.auth_token {
        None => true,
        Some(expected) => presented_token(headers)
            .is_some_and(|presented| ct_eq(&presented, expected.expose_secret())),
    }
}

/// Middleware: enforce auth + read-only on `/api` routes.
pub async fn guard(State(state): State<AppState>, req: Request, next: Next) -> Response {
    let path = req.uri().path();

    // Only the API is guarded; probes and the SSR shell pass through.
    let is_api = path.starts_with("/api/");
    let is_auth_endpoint = path == "/api/v1/auth" || path == "/api/v1/auth/session";

    if is_api && !is_auth_endpoint {
        if !authorized(&state, req.headers()) {
            return (
                StatusCode::UNAUTHORIZED,
                Json(json!({ "error": { "code": "unauthorized", "message": "missing or invalid token" } })),
            )
                .into_response();
        }
        if state.read_only && !matches!(*req.method(), Method::GET | Method::HEAD | Method::OPTIONS)
        {
            return (
                StatusCode::FORBIDDEN,
                Json(json!({ "error": { "code": "read_only", "message": "this Weft deployment is read-only" } })),
            )
                .into_response();
        }
    }

    next.run(req).await
}

/// `GET /api/v1/auth` — auth status for the UI gate (never guarded).
pub async fn status(State(state): State<AppState>, headers: HeaderMap) -> Json<serde_json::Value> {
    Json(json!({
        "auth_required": state.auth_token.is_some(),
        "authorized": authorized(&state, &headers),
        "read_only": state.read_only,
    }))
}

#[derive(Debug, Deserialize)]
pub struct SessionRequest {
    pub token: String,
}

/// `POST /api/v1/auth/session` — exchange the token for an HttpOnly cookie.
pub async fn session(State(state): State<AppState>, Json(body): Json<SessionRequest>) -> Response {
    let Some(expected) = &state.auth_token else {
        return StatusCode::NO_CONTENT.into_response();
    };
    if !ct_eq(&body.token, expected.expose_secret()) {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": { "code": "unauthorized", "message": "invalid token" } })),
        )
            .into_response();
    }
    // SameSite=Strict + HttpOnly; Secure is the operator's TLS terminator's
    // job (Weft itself serves plain HTTP behind it).
    let cookie = format!(
        "{COOKIE_NAME}={}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800",
        body.token
    );
    ([(header::SET_COOKIE, cookie)], StatusCode::NO_CONTENT).into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ct_eq_matches_only_exact() {
        assert!(ct_eq("secret", "secret"));
        assert!(!ct_eq("secret", "secret2"));
        assert!(!ct_eq("secret", "secreT"));
        assert!(!ct_eq("", "x"));
        assert!(ct_eq("", ""));
    }

    #[test]
    fn cookie_parsing_finds_weft_token() {
        let mut headers = HeaderMap::new();
        headers.insert(
            header::COOKIE,
            "other=1; weft_token=abc123; more=2".parse().unwrap(),
        );
        assert_eq!(cookie_token(&headers), Some("abc123".to_string()));

        let mut none = HeaderMap::new();
        none.insert(header::COOKIE, "other=1".parse().unwrap());
        assert_eq!(cookie_token(&none), None);
    }
}
