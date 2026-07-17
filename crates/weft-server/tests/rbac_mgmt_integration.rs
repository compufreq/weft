//! RBAC-management integration tests against a REAL RBAC-enabled Weaviate
//! (API-key auth, `AUTHORIZATION_RBAC_ENABLED=true`).
//!
//! These tests skip themselves when `WEAVIATE_RBAC_URL` is unset/empty —
//! the CI floor leg (1.30) and ad-hoc environments without the extra
//! container stay green.

use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use secrecy::SecretString;
use tower::ServiceExt;
use weft_core::{Config, InstanceConfig};
use weft_server::{app, AppState};
use weft_weaviate::WeaviateClient;

fn rbac_env() -> Option<(String, String)> {
    let url = std::env::var("WEAVIATE_RBAC_URL")
        .ok()
        .filter(|s| !s.is_empty())?;
    let key = std::env::var("WEAVIATE_RBAC_KEY").unwrap_or_else(|_| "rbac-admin-key".into());
    Some((url, key))
}

fn test_app(url: &str, key: &str, read_only: bool) -> axum::Router {
    let config = Config {
        listen: "0.0.0.0:0".into(),
        instances: vec![InstanceConfig {
            id: "rbac".into(),
            name: "RBAC".into(),
            url: url.into(),
            api_key: Some(SecretString::from(key)),
            metrics_url: None,
        }],
        auth_token: None,
        read_only,
        instances_file: None,
    };
    app(AppState::from_config(&config).expect("valid test config"))
}

async fn request(
    router: axum::Router,
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
    let response = router.oneshot(builder.body(body).unwrap()).await.unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null),
    )
}

/// Wait until the RBAC Weaviate answers authz requests (fresh container).
async fn wait_ready(client: &WeaviateClient) {
    for _ in 0..60 {
        if client.authz_roles().await.is_ok() {
            return;
        }
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
    }
    panic!("RBAC Weaviate never became ready");
}

#[tokio::test]
async fn role_lifecycle_create_modify_assign_revoke_delete() {
    let Some((url, key)) = rbac_env() else {
        eprintln!("WEAVIATE_RBAC_URL unset — skipping RBAC management test");
        return;
    };
    let client = WeaviateClient::new(&url, Some(SecretString::from(key.clone()))).unwrap();
    wait_ready(&client).await;

    let role = "weft_itest_role";
    let user = "weft-itest-user";
    // Idempotent cleanup from any earlier aborted run.
    let _ = client.delete_role(role).await;
    let _ = client.delete_db_user(user).await;

    // Overview reports RBAC enabled with the predefined roles visible.
    let (status, body) = request(
        test_app(&url, &key, false),
        "GET",
        "/api/v1/instances/rbac/rbac",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["enabled"], true, "{body}");
    assert!(!body["roles"].as_array().unwrap().is_empty(), "{body}");

    // Create a role with one permission through Weft's API.
    let (status, body) = request(
        test_app(&url, &key, false),
        "POST",
        "/api/v1/instances/rbac/rbac/roles",
        Some(serde_json::json!({
            "name": role,
            "permissions": [
                { "action": "read_data", "data": { "collection": "*" } }
            ]
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");

    // It shows up in the overview.
    let (_, body) = request(
        test_app(&url, &key, false),
        "GET",
        "/api/v1/instances/rbac/rbac",
        None,
    )
    .await;
    let names: Vec<&str> = body["roles"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|r| r["name"].as_str())
        .collect();
    assert!(names.contains(&role), "created role listed: {names:?}");

    // Add and then remove a second permission.
    let perm = serde_json::json!({
        "permissions": [
            { "action": "read_collections", "collections": { "collection": "*" } }
        ]
    });
    let (status, body) = request(
        test_app(&url, &key, false),
        "POST",
        &format!("/api/v1/instances/rbac/rbac/roles/{role}/add-permissions"),
        Some(perm.clone()),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT, "{body}");
    let (status, body) = request(
        test_app(&url, &key, false),
        "POST",
        &format!("/api/v1/instances/rbac/rbac/roles/{role}/remove-permissions"),
        Some(perm),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT, "{body}");

    // Create a throwaway dynamic db user, assign the role, verify, revoke.
    client.create_db_user(user).await.expect("create db user");
    let (status, body) = request(
        test_app(&url, &key, false),
        "POST",
        &format!("/api/v1/instances/rbac/rbac/users/{user}/assign"),
        Some(serde_json::json!({ "roles": [role], "user_type": "db" })),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT, "{body}");

    let (_, body) = request(
        test_app(&url, &key, false),
        "GET",
        "/api/v1/instances/rbac/rbac",
        None,
    )
    .await;
    let assigned = body["users"]
        .as_array()
        .unwrap()
        .iter()
        .find(|u| u["user_id"] == user)
        .map(|u| u["roles"].clone());
    assert!(
        assigned
            .as_ref()
            .and_then(|r| r.as_array())
            .is_some_and(|r| r.iter().any(|x| x == role)),
        "assigned role visible on user: {body}"
    );

    let (status, body) = request(
        test_app(&url, &key, false),
        "POST",
        &format!("/api/v1/instances/rbac/rbac/users/{user}/revoke"),
        Some(serde_json::json!({ "roles": [role], "user_type": "db" })),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT, "{body}");

    // Delete the role through Weft; clean up the user via the client.
    let (status, body) = request(
        test_app(&url, &key, false),
        "DELETE",
        &format!("/api/v1/instances/rbac/rbac/roles/{role}"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT, "{body}");
    client.delete_db_user(user).await.expect("delete db user");

    let (_, body) = request(
        test_app(&url, &key, false),
        "GET",
        "/api/v1/instances/rbac/rbac",
        None,
    )
    .await;
    let names: Vec<String> = body["roles"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|r| r["name"].as_str().map(String::from))
        .collect();
    assert!(!names.iter().any(|n| n == role), "role deleted: {names:?}");
}

#[tokio::test]
async fn rbac_mutations_validate_input_and_respect_read_only() {
    let Some((url, key)) = rbac_env() else {
        eprintln!("WEAVIATE_RBAC_URL unset — skipping RBAC management test");
        return;
    };

    // Invalid role name → 422 before any upstream call.
    let (status, _) = request(
        test_app(&url, &key, false),
        "POST",
        "/api/v1/instances/rbac/rbac/roles",
        Some(serde_json::json!({ "name": "bad role/../name", "permissions": [] })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);

    // Empty roles list on assign → 422.
    let (status, _) = request(
        test_app(&url, &key, false),
        "POST",
        "/api/v1/instances/rbac/rbac/users/someone/assign",
        Some(serde_json::json!({ "roles": [] })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);

    // Read-only blocks every management mutation.
    for (method, path, body) in [
        (
            "POST",
            "/api/v1/instances/rbac/rbac/roles".to_string(),
            Some(serde_json::json!({ "name": "x", "permissions": [] })),
        ),
        (
            "DELETE",
            "/api/v1/instances/rbac/rbac/roles/x".to_string(),
            None,
        ),
        (
            "POST",
            "/api/v1/instances/rbac/rbac/roles/x/add-permissions".to_string(),
            Some(serde_json::json!({ "permissions": [] })),
        ),
        (
            "POST",
            "/api/v1/instances/rbac/rbac/users/u/assign".to_string(),
            Some(serde_json::json!({ "roles": ["x"] })),
        ),
    ] {
        let (status, body) = request(test_app(&url, &key, true), method, &path, body).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{method} {path}: {body}");
        assert_eq!(body["error"]["code"], "read_only", "{body}");
    }
}
