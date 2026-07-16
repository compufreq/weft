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
        auth_token: None,
        read_only: false,
        instances_file: None,
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

async fn request(
    app: &axum::Router,
    method: &str,
    path: &str,
    body: Option<serde_json::Value>,
) -> (StatusCode, serde_json::Value, axum::http::HeaderMap) {
    let mut builder = Request::builder().method(method).uri(path);
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
    let headers = response.headers().clone();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let value = serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null);
    (status, value, headers)
}

#[tokio::test]
async fn instance_add_duplicate_delete_roundtrip() {
    let app = test_app();

    // Add a second instance pointing at the same Weaviate.
    let (status, body, _) = request(
        &app,
        "POST",
        "/api/v1/instances",
        Some(serde_json::json!({ "name": "Staging Copy", "url": weaviate_url() })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "add failed: {body}");
    assert_eq!(body["id"], "staging-copy"); // slugified from name
    assert!(body.get("api_key").is_none());

    // It shows up in the list and serves a schema.
    let (_, list, _) = request(&app, "GET", "/api/v1/instances", None).await;
    assert_eq!(list.as_array().unwrap().len(), 2);
    let (status, schema, _) =
        request(&app, "GET", "/api/v1/instances/staging-copy/schema", None).await;
    assert_eq!(status, StatusCode::OK);
    assert!(!schema["classes"].as_array().unwrap().is_empty());

    // Duplicate id → 409.
    let (status, body, _) = request(
        &app,
        "POST",
        "/api/v1/instances",
        Some(serde_json::json!({ "name": "staging copy", "url": weaviate_url() })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(body["error"]["code"], "instance_exists");

    // Delete → 204, then 404 on repeat.
    let (status, _, _) = request(&app, "DELETE", "/api/v1/instances/staging-copy", None).await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (status, _, _) = request(&app, "DELETE", "/api/v1/instances/staging-copy", None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn add_instance_rejects_empty_name() {
    let (status, body, _) = request(
        &test_app(),
        "POST",
        "/api/v1/instances",
        Some(serde_json::json!({ "name": "  ", "url": "http://x:1" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(body["error"]["code"], "invalid_input");
}

#[tokio::test]
async fn schema_export_is_a_json_download() {
    let (status, body, headers) = request(
        &test_app(),
        "GET",
        "/api/v1/instances/local/schema/export",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let disposition = headers
        .get("content-disposition")
        .expect("content-disposition header")
        .to_str()
        .unwrap();
    assert!(
        disposition.contains("weft-schema-local.json"),
        "{disposition}"
    );
    assert!(body["classes"].as_array().is_some());
}

#[tokio::test]
async fn diff_against_self_is_empty() {
    let app = test_app();
    request(
        &app,
        "POST",
        "/api/v1/instances",
        Some(serde_json::json!({ "id": "twin", "name": "Twin", "url": weaviate_url() })),
    )
    .await;
    let (status, body, _) = request(
        &app,
        "POST",
        "/api/v1/instances/local/schema/diff",
        Some(serde_json::json!({ "against_instance": "twin" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["entries"].as_array().unwrap().len(), 0, "{body}");
}

#[tokio::test]
async fn diff_against_provided_schema_reports_removed_classes() {
    let (status, body, _) = request(
        &test_app(),
        "POST",
        "/api/v1/instances/local/schema/diff",
        Some(serde_json::json!({ "against_schema": { "classes": [] } })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let entries = body["entries"].as_array().unwrap();
    assert!(entries
        .iter()
        .any(|e| e["kind"] == "class_removed" && e["class"] == "Article"));
    assert!(entries
        .iter()
        .any(|e| e["kind"] == "class_removed" && e["class"] == "Product"));
}

#[tokio::test]
async fn diff_requires_exactly_one_target() {
    let (status, body, _) = request(
        &test_app(),
        "POST",
        "/api/v1/instances/local/schema/diff",
        Some(serde_json::json!({})),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(body["error"]["code"], "invalid_input");
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
        auth_token: None,
        read_only: false,
        instances_file: None,
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
