//! Integration tests for tenant management against a REAL seeded Weaviate.
//!
//! Seeded: multi-tenant `Product` with tenants acme/globex (5 objects each).
//! Lifecycle tests use their own tenants and never touch acme/globex, so they
//! can't race the explorer tests. Weaviate state persists across runs — every
//! test is idempotent.

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
            name: "Local".into(),
            url: weaviate_url(),
            api_key: None,
        }],
        auth_token: None,
        read_only: false,
    };
    app(AppState::from_config(&config).expect("valid test config"))
}

async fn request(
    method: &str,
    path: &str,
    body: Option<serde_json::Value>,
) -> (StatusCode, serde_json::Value) {
    let mut builder = Request::builder().method(method).uri(path);
    let body = match body {
        Some(json) => {
            builder = builder.header("content-type", "application/json");
            Body::from(json.to_string())
        }
        None => Body::empty(),
    };
    let response = test_app()
        .oneshot(builder.body(body).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null),
    )
}

const BASE: &str = "/api/v1/instances/local/collections/Product/tenants";

fn tenant<'a>(list: &'a serde_json::Value, name: &str) -> Option<&'a serde_json::Value> {
    list["tenants"]
        .as_array()?
        .iter()
        .find(|t| t["name"] == name)
}

#[tokio::test]
async fn tenants_list_includes_seeded_with_counts() {
    let (status, body) = request("GET", &format!("{BASE}?counts=true"), None).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let acme = tenant(&body, "acme").expect("seeded tenant acme");
    assert_eq!(acme["activityStatus"], "HOT");
    assert_eq!(acme["count"], 5, "5 seeded products for acme: {body}");
    let globex = tenant(&body, "globex").expect("seeded tenant globex");
    assert_eq!(globex["count"], 5);
}

#[tokio::test]
async fn create_tenant_then_it_lists_empty() {
    // Idempotent: creation may 422 if it already exists from a previous run.
    let (status, _) = request(
        "POST",
        BASE,
        Some(serde_json::json!({ "names": ["created-t"] })),
    )
    .await;
    assert!(
        status == StatusCode::CREATED || status == StatusCode::UNPROCESSABLE_ENTITY,
        "unexpected create status {status}"
    );

    let (_, body) = request("GET", &format!("{BASE}?counts=true"), None).await;
    let created = tenant(&body, "created-t").expect("created tenant listed");
    assert_eq!(created["activityStatus"], "HOT");
    assert_eq!(created["count"], 0, "fresh tenant has no objects");
}

#[tokio::test]
async fn tenant_lifecycle_deactivate_blocks_queries_then_reactivate() {
    // Own tenant so we never race the explorer tests using acme/globex.
    request(
        "POST",
        BASE,
        Some(serde_json::json!({ "names": ["lifecycle-t"] })),
    )
    .await;

    // COLD: listing shows it, but objects queries fail cleanly.
    let (status, body) = request(
        "PUT",
        BASE,
        Some(serde_json::json!({ "updates": [{ "name": "lifecycle-t", "status": "COLD" }] })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");

    let (_, list) = request("GET", BASE, None).await;
    assert_eq!(
        tenant(&list, "lifecycle-t").unwrap()["activityStatus"],
        "COLD"
    );

    let (status, _) = request(
        "GET",
        "/api/v1/instances/local/collections/Product/objects?tenant=lifecycle-t",
        None,
    )
    .await;
    assert_eq!(
        status,
        StatusCode::UNPROCESSABLE_ENTITY,
        "COLD tenant must reject object queries cleanly"
    );

    // HOT again: queries work.
    let (status, _) = request(
        "PUT",
        BASE,
        Some(serde_json::json!({ "updates": [{ "name": "lifecycle-t", "status": "HOT" }] })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (status, body) = request(
        "GET",
        "/api/v1/instances/local/collections/Product/objects?tenant=lifecycle-t",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["objects"].as_array().unwrap().len(), 0);
}

#[tokio::test]
async fn invalid_status_and_empty_bodies_are_422() {
    let (status, body) = request(
        "PUT",
        BASE,
        Some(serde_json::json!({ "updates": [{ "name": "acme", "status": "LUKEWARM" }] })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert!(body["error"]["message"]
        .as_str()
        .unwrap()
        .contains("LUKEWARM"));

    let (status, _) = request("PUT", BASE, Some(serde_json::json!({ "updates": [] }))).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);

    let (status, _) = request("POST", BASE, Some(serde_json::json!({ "names": [" "] }))).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn tenants_on_non_mt_collection_is_clean_4xx() {
    let (status, _) = request(
        "GET",
        "/api/v1/instances/local/collections/Article/tenants",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
}
