//! Integration tests against a REAL Weaviate instance.
//!
//! Requires `WEAVIATE_URL` to point at a running, seeded Weaviate
//! (see `compose.dev.yaml` / the CI service container). Run via:
//! `cargo nextest run --workspace --test '*'` (Makefile: `make test-int`).

use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use tower::ServiceExt;
use weft_core::{Config, InstanceConfig};
use weft_server::{app, AppState};

fn weaviate_url() -> String {
    std::env::var("WEAVIATE_URL").unwrap_or_else(|_| "http://localhost:8181".into())
}

fn test_app() -> axum::Router {
    let config = Config {
        listen: "0.0.0.0:0".into(),
        instances: vec![InstanceConfig {
            id: "local".into(),
            name: "Local Weaviate".into(),
            url: weaviate_url(),
            api_key: None,
        }],
    };
    app(AppState::from_config(&config).expect("valid test config"))
}

async fn get_json(path: &str) -> (StatusCode, serde_json::Value) {
    let response = test_app()
        .oneshot(Request::builder().uri(path).body(Body::empty()).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let value = serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null);
    (status, value)
}

#[tokio::test]
async fn healthz_is_ok() {
    let response = test_app()
        .oneshot(
            Request::builder()
                .uri("/healthz")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
}

#[tokio::test]
async fn instances_lists_local_without_credentials() {
    let (status, body) = get_json("/api/v1/instances").await;
    assert_eq!(status, StatusCode::OK);
    let list = body.as_array().expect("array of instances");
    assert_eq!(list.len(), 1);
    assert_eq!(list[0]["id"], "local");
    assert!(
        list[0].get("api_key").is_none(),
        "credentials must never appear"
    );
}

#[tokio::test]
async fn meta_returns_weaviate_version() {
    let (status, body) = get_json("/api/v1/instances/local/meta").await;
    assert_eq!(
        status,
        StatusCode::OK,
        "is Weaviate running at {}?",
        weaviate_url()
    );
    let version = body["version"].as_str().expect("version string");
    assert!(version.starts_with("1."), "unexpected version {version}");
}

#[tokio::test]
async fn schema_contains_seeded_collections() {
    let (status, body) = get_json("/api/v1/instances/local/schema").await;
    assert_eq!(status, StatusCode::OK);
    let classes = body["classes"].as_array().expect("classes array");
    let names: Vec<&str> = classes.iter().filter_map(|c| c["class"].as_str()).collect();
    assert!(
        names.contains(&"Article"),
        "seeded Article missing: {names:?}"
    );
    assert!(
        names.contains(&"Product"),
        "seeded Product missing: {names:?}"
    );

    let product = classes.iter().find(|c| c["class"] == "Product").unwrap();
    assert_eq!(product["multiTenancyConfig"]["enabled"], true);
}

#[tokio::test]
async fn unknown_instance_is_404() {
    let (status, body) = get_json("/api/v1/instances/nope/schema").await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body["error"]["code"], "instance_not_found");
}

#[tokio::test]
async fn unreachable_weaviate_is_502() {
    let config = Config {
        listen: "0.0.0.0:0".into(),
        instances: vec![InstanceConfig {
            id: "dead".into(),
            name: "Dead".into(),
            url: "http://127.0.0.1:1".into(), // nothing listens here
            api_key: None,
        }],
    };
    let app = app(AppState::from_config(&config).unwrap());
    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/v1/instances/dead/schema")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::BAD_GATEWAY);
}
