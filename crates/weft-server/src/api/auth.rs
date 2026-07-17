//! Optional API authentication (`WEFT_AUTH_TOKEN`) and read-only mode.
//!
//! Design: the token protects the **API** (all data access). The SSR page
//! shells stay public — they contain no data until the browser authenticates.
//! Browsers get an HttpOnly session cookie via `POST /api/v1/auth/session`;
//! programmatic clients send `Authorization: Bearer <token>`.

use crate::AppState;
use axum::extract::{ConnectInfo, FromRequest, Request, State};
use axum::http::{header, HeaderMap, Method, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use axum::Json;
use dashmap::DashMap;
use secrecy::ExposeSecret;
use serde::Deserialize;
use serde_json::json;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::time::{Duration, Instant};

pub const COOKIE_NAME: &str = "weft_token";

/// Sliding window for the session rate limit.
const RATE_WINDOW: Duration = Duration::from_secs(60);
/// Max session attempts per IP per window.
const RATE_MAX_ATTEMPTS: usize = 5;
/// Above this many tracked IPs, idle entries are pruned on the next attempt.
const RATE_PRUNE_THRESHOLD: usize = 1024;

/// Per-IP sliding-window rate limiter for `POST /api/v1/auth/session`.
///
/// Keys on the TCP peer address (`ConnectInfo`) — `X-Forwarded-For` is
/// spoofable, so behind a reverse proxy the limit applies per proxy hop.
#[derive(Debug, Default)]
pub struct SessionRateLimiter {
    windows: DashMap<IpAddr, Vec<Instant>>,
}

impl SessionRateLimiter {
    /// Record an attempt at `now`. `Err(retry_after_secs)` when over the limit.
    pub fn check(&self, ip: IpAddr, now: Instant) -> Result<(), u64> {
        {
            let mut window = self.windows.entry(ip).or_default();
            window.retain(|t| now.duration_since(*t) < RATE_WINDOW);
            if window.len() >= RATE_MAX_ATTEMPTS {
                // Timestamps are pushed in order, so [0] is the oldest.
                let retry = RATE_WINDOW.saturating_sub(now.duration_since(window[0]));
                return Err(retry.as_secs().max(1));
            }
            window.push(now);
        }
        // Bound memory against IP-churn floods: drop idle windows.
        if self.windows.len() > RATE_PRUNE_THRESHOLD {
            self.windows
                .retain(|_, w| w.iter().any(|t| now.duration_since(*t) < RATE_WINDOW));
        }
        Ok(())
    }
}

use crate::auth_backend::{ct_eq, Actor, MutationEvent};

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

/// Resolve the caller via the configured [`crate::auth_backend::AuthBackend`]:
/// `Some(actor)` when the request may proceed, `None` when unauthorized.
fn authenticate(state: &AppState, headers: &HeaderMap) -> Option<Actor> {
    if !state.auth_backend.required() {
        return Some(Actor::anonymous());
    }
    presented_token(headers).and_then(|presented| state.auth_backend.verify(&presented))
}

fn authorized(state: &AppState, headers: &HeaderMap) -> bool {
    authenticate(state, headers).is_some()
}

/// POST endpoints that never mutate anything: search/diff/aggregate are pure
/// queries that only use POST for their request bodies, and Weaviate's
/// GraphQL schema is query-only (mutations are REST-only), so the console
/// passthrough is read-safe too.
fn is_read_safe_post(path: &str) -> bool {
    path.ends_with("/search")
        || path.ends_with("/aggregate")
        || path.ends_with("/schema/diff")
        || path.ends_with("/graphql")
}

/// Middleware: enforce auth + read-only on `/api` routes, and report
/// successful mutations to the [`crate::auth_backend::MutationHook`].
pub async fn guard(State(state): State<AppState>, req: Request, next: Next) -> Response {
    let path = req.uri().path().to_string();
    let method = req.method().clone();

    // Only the API is guarded; probes and the SSR shell pass through.
    let is_api = path.starts_with("/api/");
    let is_auth_endpoint = path == "/api/v1/auth" || path == "/api/v1/auth/session";

    let mut actor: Option<Actor> = None;
    let mut is_mutation = false;
    if is_api && !is_auth_endpoint {
        let Some(caller) = authenticate(&state, req.headers()) else {
            return (
                StatusCode::UNAUTHORIZED,
                Json(json!({ "error": { "code": "unauthorized", "message": "missing or invalid token" } })),
            )
                .into_response();
        };
        let read_safe = matches!(method, Method::GET | Method::HEAD | Method::OPTIONS)
            || (method == Method::POST && is_read_safe_post(&path));
        if state.read_only && !read_safe {
            return (
                StatusCode::FORBIDDEN,
                Json(json!({ "error": { "code": "read_only", "message": "this Weft deployment is read-only" } })),
            )
                .into_response();
        }
        actor = Some(caller);
        is_mutation = !read_safe;
    }

    let response = next.run(req).await;

    // Report successful mutations. Failures are deliberately not reported:
    // the hook's contract is "this happened", not "this was attempted".
    if is_mutation && response.status().is_success() {
        if let (Some(hook), Some(actor)) = (&state.mutation_hook, actor) {
            hook(&MutationEvent {
                actor: actor.id,
                method: method.to_string(),
                path,
                status: response.status().as_u16(),
            });
        }
    }

    response
}

/// `GET /api/v1/auth` — auth status for the UI gate (never guarded).
pub async fn status(State(state): State<AppState>, headers: HeaderMap) -> Json<serde_json::Value> {
    Json(json!({
        "auth_required": state.auth_backend.required(),
        "authorized": authorized(&state, &headers),
        "read_only": state.read_only,
    }))
}

#[derive(Debug, Deserialize)]
pub struct SessionRequest {
    pub token: String,
}

/// `POST /api/v1/auth/session` — exchange the token for an HttpOnly cookie.
///
/// Rate-limited per client IP (sliding window) to slow brute-force attempts;
/// the limit is checked before the token, so throttled clients learn nothing.
pub async fn session(State(state): State<AppState>, req: Request) -> Response {
    let Some(expected) = &state.auth_token else {
        return StatusCode::NO_CONTENT.into_response();
    };

    // Peer IP from ConnectInfo; absent only in in-process tests, where all
    // callers share the unspecified-address bucket.
    let ip = req
        .extensions()
        .get::<ConnectInfo<SocketAddr>>()
        .map_or(IpAddr::V4(Ipv4Addr::UNSPECIFIED), |ci| ci.0.ip());
    if let Err(retry_after) = state.session_limiter.check(ip, Instant::now()) {
        return (
            StatusCode::TOO_MANY_REQUESTS,
            [(header::RETRY_AFTER, retry_after.to_string())],
            Json(json!({ "error": { "code": "rate_limited", "message": format!("too many attempts — try again in {retry_after}s") } })),
        )
            .into_response();
    }

    let body = match Json::<SessionRequest>::from_request(req, &()).await {
        Ok(Json(body)) => body,
        Err(rejection) => return rejection.into_response(),
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

/// `DELETE /api/v1/auth/session` — log out by clearing the session cookie.
///
/// Deliberately unauthenticated (an expired or garbage cookie must still be
/// clearable) and idempotent.
pub async fn logout() -> Response {
    let cookie = format!("{COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0");
    ([(header::SET_COOKIE, cookie)], StatusCode::NO_CONTENT).into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

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

    #[test]
    fn rate_limiter_blocks_sixth_attempt_in_window() {
        let limiter = SessionRateLimiter::default();
        let ip: IpAddr = "10.0.0.1".parse().unwrap();
        let t0 = Instant::now();
        for i in 0..RATE_MAX_ATTEMPTS {
            assert!(
                limiter
                    .check(ip, t0 + Duration::from_secs(i as u64))
                    .is_ok(),
                "attempt {i} should pass"
            );
        }
        let denied = limiter.check(ip, t0 + Duration::from_secs(10));
        let retry = denied.expect_err("sixth attempt must be limited");
        assert!(
            (1..=RATE_WINDOW.as_secs()).contains(&retry),
            "retry-after {retry}s out of range"
        );
    }

    #[test]
    fn rate_limiter_isolates_ips_and_resets_after_window() {
        let limiter = SessionRateLimiter::default();
        let a: IpAddr = "10.0.0.1".parse().unwrap();
        let b: IpAddr = "10.0.0.2".parse().unwrap();
        let t0 = Instant::now();
        for _ in 0..RATE_MAX_ATTEMPTS {
            limiter.check(a, t0).unwrap();
        }
        assert!(limiter.check(a, t0).is_err(), "a is limited");
        assert!(limiter.check(b, t0).is_ok(), "b is unaffected");
        // Once a's window has fully expired, attempts pass again.
        let later = t0 + RATE_WINDOW + Duration::from_secs(1);
        assert!(limiter.check(a, later).is_ok(), "a resets after the window");
    }
}
