//! Tests for the auth guard and read-only mode. No Weaviate needed.

use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use secrecy::SecretString;
use tower::ServiceExt;
use weft_core::Config;
use weft_server::{app, AppState};

fn app_with(auth: Option<&str>, read_only: bool) -> axum::Router {
    let config = Config {
        listen: "0.0.0.0:0".into(),
        instances: vec![],
        auth_token: auth.map(SecretString::from),
        read_only,
    };
    app(AppState::from_config(&config).unwrap())
}

async fn send(
    app: &axum::Router,
    method: &str,
    path: &str,
    headers: &[(&str, &str)],
    body: Option<serde_json::Value>,
) -> (StatusCode, serde_json::Value, axum::http::HeaderMap) {
    let mut builder = Request::builder().method(method).uri(path);
    for (k, v) in headers {
        builder = builder.header(*k, *v);
    }
    let body = match body {
        Some(json) => {
            builder = builder.header("content-type", "application/json");
            Body::from(json.to_string())
        }
        None => Body::empty(),
    };
    let response = app
        .clone()
        .oneshot(builder.body(body).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let resp_headers = response.headers().clone();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null),
        resp_headers,
    )
}

#[tokio::test]
async fn no_token_configured_means_open_api() {
    let app = app_with(None, false);
    let (status, body, _) = send(&app, "GET", "/api/v1/instances", &[], None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, serde_json::json!([]));

    let (_, auth, _) = send(&app, "GET", "/api/v1/auth", &[], None).await;
    assert_eq!(auth["auth_required"], false);
    assert_eq!(auth["authorized"], true);
}

#[tokio::test]
async fn token_guards_api_but_not_probes() {
    let app = app_with(Some("s3cret"), false);

    let (status, body, _) = send(&app, "GET", "/api/v1/instances", &[], None).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(body["error"]["code"], "unauthorized");

    let (status, _, _) = send(&app, "GET", "/healthz", &[], None).await;
    assert_eq!(status, StatusCode::OK, "probes stay open");

    // Wrong bearer → 401; right bearer → 200.
    let (status, _, _) = send(
        &app,
        "GET",
        "/api/v1/instances",
        &[("authorization", "Bearer wrong")],
        None,
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    let (status, _, _) = send(
        &app,
        "GET",
        "/api/v1/instances",
        &[("authorization", "Bearer s3cret")],
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
}

#[tokio::test]
async fn session_cookie_flow_works() {
    let app = app_with(Some("s3cret"), false);

    // Wrong token → 401, no cookie.
    let (status, _, headers) = send(
        &app,
        "POST",
        "/api/v1/auth/session",
        &[],
        Some(serde_json::json!({ "token": "nope" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert!(headers.get("set-cookie").is_none());

    // Right token → cookie issued.
    let (status, _, headers) = send(
        &app,
        "POST",
        "/api/v1/auth/session",
        &[],
        Some(serde_json::json!({ "token": "s3cret" })),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let cookie = headers.get("set-cookie").unwrap().to_str().unwrap();
    assert!(cookie.contains("weft_token=s3cret"));
    assert!(cookie.contains("HttpOnly"));

    // Cookie authorizes API calls.
    let (status, _, _) = send(
        &app,
        "GET",
        "/api/v1/instances",
        &[("cookie", "weft_token=s3cret")],
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    // Status endpoint reflects authorization.
    let (_, auth, _) = send(
        &app,
        "GET",
        "/api/v1/auth",
        &[("cookie", "weft_token=s3cret")],
        None,
    )
    .await;
    assert_eq!(auth["auth_required"], true);
    assert_eq!(auth["authorized"], true);
}

#[tokio::test]
async fn read_only_blocks_mutations_but_not_reads() {
    let app = app_with(None, true);

    let (status, _, _) = send(&app, "GET", "/api/v1/instances", &[], None).await;
    assert_eq!(status, StatusCode::OK);

    let (status, body, _) = send(
        &app,
        "POST",
        "/api/v1/instances",
        &[],
        Some(serde_json::json!({ "name": "X", "url": "http://x:1" })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(body["error"]["code"], "read_only");

    let (status, _, _) = send(&app, "DELETE", "/api/v1/instances/local", &[], None).await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    let (_, auth, _) = send(&app, "GET", "/api/v1/auth", &[], None).await;
    assert_eq!(auth["read_only"], true);
}
