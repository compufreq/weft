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
        instances_file: None,
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

/// Like `send`, but stamps a `ConnectInfo` peer address so the session rate
/// limiter sees distinct client IPs (in production axum injects this).
async fn send_from(
    app: &axum::Router,
    ip: &str,
    body: serde_json::Value,
) -> (StatusCode, serde_json::Value, axum::http::HeaderMap) {
    use axum::extract::ConnectInfo;
    use std::net::SocketAddr;
    let addr: SocketAddr = format!("{ip}:52100").parse().unwrap();
    let request = Request::builder()
        .method("POST")
        .uri("/api/v1/auth/session")
        .header("content-type", "application/json")
        .extension(ConnectInfo(addr))
        .body(Body::from(body.to_string()))
        .unwrap();
    let response = app.clone().oneshot(request).await.unwrap();
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
async fn session_rate_limit_blocks_after_five_attempts_per_ip() {
    let app = app_with(Some("s3cret"), false);
    let wrong = serde_json::json!({ "token": "nope" });

    // Five attempts pass through (and fail auth normally).
    for i in 0..5 {
        let (status, _, _) = send_from(&app, "10.9.9.1", wrong.clone()).await;
        assert_eq!(
            status,
            StatusCode::UNAUTHORIZED,
            "attempt {i} is a plain 401"
        );
    }

    // Sixth is throttled — even with the RIGHT token (no oracle around the limit).
    let (status, body, headers) =
        send_from(&app, "10.9.9.1", serde_json::json!({ "token": "s3cret" })).await;
    assert_eq!(status, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(body["error"]["code"], "rate_limited");
    let retry: u64 = headers
        .get("retry-after")
        .expect("Retry-After header present")
        .to_str()
        .unwrap()
        .parse()
        .unwrap();
    assert!((1..=60).contains(&retry));
    assert!(
        headers.get("set-cookie").is_none(),
        "no cookie while limited"
    );

    // A different client IP is unaffected.
    let (status, _, headers) =
        send_from(&app, "10.9.9.2", serde_json::json!({ "token": "s3cret" })).await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert!(headers.get("set-cookie").is_some());
}

#[tokio::test]
async fn logout_clears_the_session_cookie() {
    let app = app_with(Some("s3cret"), false);

    // Works with or without a valid session — logout must always be reachable.
    let (status, _, headers) = send(
        &app,
        "DELETE",
        "/api/v1/auth/session",
        &[("cookie", "weft_token=s3cret")],
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let cookie = headers.get("set-cookie").unwrap().to_str().unwrap();
    assert!(
        cookie.starts_with("weft_token=;"),
        "value cleared: {cookie}"
    );
    assert!(
        cookie.contains("Max-Age=0"),
        "expired immediately: {cookie}"
    );
    assert!(cookie.contains("HttpOnly"));

    // Logout also passes the guard in read-only mode (it's an auth endpoint).
    let ro = app_with(Some("s3cret"), true);
    let (status, _, _) = send(&ro, "DELETE", "/api/v1/auth/session", &[], None).await;
    assert_eq!(status, StatusCode::NO_CONTENT);
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

#[tokio::test]
async fn read_only_allows_query_posts() {
    // search/diff/aggregate/graphql are POST-with-body but never mutate —
    // read-only mode must let them through the guard. (They 404 here because
    // the test app has no instances; the point is they are NOT 403.)
    let app = app_with(None, true);
    for path in [
        "/api/v1/instances/x/collections/C/search",
        "/api/v1/instances/x/collections/C/aggregate",
        "/api/v1/instances/x/schema/diff",
        "/api/v1/instances/x/graphql",
    ] {
        let (status, body, _) = send(&app, "POST", path, &[], Some(serde_json::json!({}))).await;
        assert_ne!(
            status,
            StatusCode::FORBIDDEN,
            "read-only must not block {path}: {body}"
        );
    }

    // Mutating requests stay blocked — including the v0.10 write path.
    for (method, path) in [
        ("POST", "/api/v1/instances"),
        ("POST", "/api/v1/instances/x/collections/C/objects"),
        ("PUT", "/api/v1/instances/x/collections/C/objects/u-1"),
        ("DELETE", "/api/v1/instances/x/collections/C/objects/u-1"),
        ("POST", "/api/v1/instances/x/collections/C/import"),
        ("POST", "/api/v1/instances/x/collections"),
        ("DELETE", "/api/v1/instances/x/collections/C"),
        ("POST", "/api/v1/instances/x/collections/C/properties"),
        ("POST", "/api/v1/instances/x/aliases"),
        ("PUT", "/api/v1/instances/x/aliases/a1"),
        ("DELETE", "/api/v1/instances/x/aliases/a1"),
    ] {
        let (status, body, _) = send(&app, method, path, &[], Some(serde_json::json!({}))).await;
        assert_eq!(
            status,
            StatusCode::FORBIDDEN,
            "read-only must block {method} {path}: {body}"
        );
    }
}
