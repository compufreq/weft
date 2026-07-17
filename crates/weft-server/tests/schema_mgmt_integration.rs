//! Integration tests for collection management and aliases (v0.11)
//! against a real Weaviate. Alias assertions are version-aware: on
//! Weaviate < 1.32 the endpoints must degrade to `supported: false`.

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
            metrics_url: None,
        }],
        auth_token: None,
        read_only: false,
        instances_file: None,
    };
    app(AppState::from_config(&config).expect("valid test config"))
}

async fn send(
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

#[tokio::test]
async fn collection_lifecycle_create_add_property_delete() {
    // Clean slate in case of a previous aborted run.
    let _ = send(
        "DELETE",
        "/api/v1/instances/local/collections/WeftSchemaTest",
        None,
    )
    .await;

    // Create.
    let (status, created) = send(
        "POST",
        "/api/v1/instances/local/collections",
        Some(serde_json::json!({
            "class": "WeftSchemaTest",
            "vectorizer": "none",
            "properties": [{ "name": "title", "dataType": ["text"] }]
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{created}");

    // Visible in the schema.
    let (_, schema) = send("GET", "/api/v1/instances/local/schema", None).await;
    let cls = schema["classes"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["class"] == "WeftSchemaTest")
        .expect("created collection listed")
        .clone();
    assert_eq!(cls["properties"].as_array().unwrap().len(), 1);

    // Add a property.
    let (status, added) = send(
        "POST",
        "/api/v1/instances/local/collections/WeftSchemaTest/properties",
        Some(serde_json::json!({ "name": "extra", "dataType": ["int"] })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{added}");
    let (_, schema) = send("GET", "/api/v1/instances/local/schema", None).await;
    let cls = schema["classes"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["class"] == "WeftSchemaTest")
        .unwrap()
        .clone();
    assert_eq!(cls["properties"].as_array().unwrap().len(), 2, "{cls}");

    // Delete → gone.
    let (status, _) = send(
        "DELETE",
        "/api/v1/instances/local/collections/WeftSchemaTest",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (_, schema) = send("GET", "/api/v1/instances/local/schema", None).await;
    assert!(
        !schema["classes"]
            .as_array()
            .unwrap()
            .iter()
            .any(|c| c["class"] == "WeftSchemaTest"),
        "collection deleted"
    );
}

#[tokio::test]
async fn invalid_collection_and_property_input_is_422() {
    let (status, _) = send(
        "POST",
        "/api/v1/instances/local/collections",
        Some(serde_json::json!({ "class": "lowercase" })),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::UNPROCESSABLE_ENTITY,
        "class names are UpperCamelCase"
    );

    let (status, _) = send(
        "POST",
        "/api/v1/instances/local/collections",
        Some(serde_json::json!({ "vectorizer": "none" })),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::UNPROCESSABLE_ENTITY,
        "class is required"
    );

    let (status, _) = send(
        "POST",
        "/api/v1/instances/local/collections/Article/properties",
        Some(serde_json::json!({ "name": "x" })),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::UNPROCESSABLE_ENTITY,
        "dataType is required"
    );
}

#[tokio::test]
async fn alias_lifecycle_or_graceful_degradation() {
    let (status, listed) = send("GET", "/api/v1/instances/local/aliases", None).await;
    assert_eq!(status, StatusCode::OK, "{listed}");

    if listed["supported"] == false {
        // Pre-1.32 Weaviate (the 1.30 CI matrix leg): shape check only.
        assert!(listed["aliases"].as_array().unwrap().is_empty());
        assert!(listed["reason"].as_str().unwrap().contains("1.32"));
        return;
    }

    // Setup: two target collections.
    for class in ["WeftAliasA", "WeftAliasB"] {
        let _ = send(
            "DELETE",
            &format!("/api/v1/instances/local/collections/{class}"),
            None,
        )
        .await;
        let (status, body) = send(
            "POST",
            "/api/v1/instances/local/collections",
            Some(serde_json::json!({ "class": class, "vectorizer": "none",
                "properties": [{ "name": "title", "dataType": ["text"] }] })),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{body}");
    }

    // Create an alias → listed.
    let (status, body) = send(
        "POST",
        "/api/v1/instances/local/aliases",
        Some(serde_json::json!({ "alias": "WeftAliasTest", "class": "WeftAliasA" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let (_, listed) = send("GET", "/api/v1/instances/local/aliases", None).await;
    let entry = listed["aliases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["alias"] == "WeftAliasTest")
        .expect("alias listed")
        .clone();
    assert_eq!(entry["class"], "WeftAliasA");

    // Repoint → class changes.
    let (status, body) = send(
        "PUT",
        "/api/v1/instances/local/aliases/WeftAliasTest",
        Some(serde_json::json!({ "class": "WeftAliasB" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let (_, listed) = send("GET", "/api/v1/instances/local/aliases", None).await;
    let entry = listed["aliases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["alias"] == "WeftAliasTest")
        .unwrap()
        .clone();
    assert_eq!(entry["class"], "WeftAliasB");

    // Delete → gone; targets are untouched.
    let (status, _) = send(
        "DELETE",
        "/api/v1/instances/local/aliases/WeftAliasTest",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (_, listed) = send("GET", "/api/v1/instances/local/aliases", None).await;
    assert!(
        !listed["aliases"]
            .as_array()
            .unwrap()
            .iter()
            .any(|a| a["alias"] == "WeftAliasTest"),
        "alias removed"
    );

    for class in ["WeftAliasA", "WeftAliasB"] {
        let _ = send(
            "DELETE",
            &format!("/api/v1/instances/local/collections/{class}"),
            None,
        )
        .await;
    }
}
