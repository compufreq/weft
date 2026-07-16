//! Tests for the SSR reverse proxy (all-in-one topology).
//!
//! wiremock plays the SolidStart SSR server; no Weaviate needed.

use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use tower::ServiceExt;
use weft_core::Config;
use weft_server::{app_with_proxy, AppState, SsrProxy};
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

fn state() -> AppState {
    let config = Config {
        listen: "0.0.0.0:0".into(),
        instances: vec![],
    };
    AppState::from_config(&config).unwrap()
}

async fn body_string(response: axum::response::Response) -> String {
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    String::from_utf8_lossy(&bytes).to_string()
}

#[tokio::test]
async fn non_api_paths_are_forwarded_to_ssr() {
    let ssr = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/i/local/schema"))
        .respond_with(ResponseTemplate::new(200).set_body_raw("<html>ssr page</html>", "text/html"))
        .mount(&ssr)
        .await;

    let app = app_with_proxy(state(), Some(SsrProxy::new(ssr.uri())));
    let response = app
        .oneshot(
            Request::builder()
                .uri("/i/local/schema")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response.headers()["content-type"],
        "text/html",
        "upstream headers must pass through"
    );
    assert!(body_string(response).await.contains("ssr page"));
}

#[tokio::test]
async fn api_and_health_are_not_proxied() {
    // SSR mock that would answer 500 to everything — if /api or /healthz hit
    // it, these assertions fail.
    let ssr = MockServer::start().await;
    Mock::given(method("GET"))
        .respond_with(ResponseTemplate::new(500))
        .mount(&ssr)
        .await;

    let app = app_with_proxy(state(), Some(SsrProxy::new(ssr.uri())));

    let health = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/healthz")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(health.status(), StatusCode::OK);

    let api = app
        .oneshot(
            Request::builder()
                .uri("/api/v1/instances")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(api.status(), StatusCode::OK);
    assert_eq!(body_string(api).await, "[]");
}

#[tokio::test]
async fn unreachable_ssr_yields_friendly_502() {
    let app = app_with_proxy(
        state(),
        Some(SsrProxy::new("http://127.0.0.1:1".to_string())),
    );
    let response = app
        .oneshot(Request::builder().uri("/").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::BAD_GATEWAY);
    assert!(body_string(response).await.contains("starting up"));
}

#[tokio::test]
async fn post_bodies_are_forwarded() {
    let ssr = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/_server"))
        .and(wiremock::matchers::body_string_contains("hello"))
        .respond_with(ResponseTemplate::new(200).set_body_string("got it"))
        .mount(&ssr)
        .await;

    let app = app_with_proxy(state(), Some(SsrProxy::new(ssr.uri())));
    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/_server")
                .body(Body::from("hello ssr"))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(body_string(response).await, "got it");
}
