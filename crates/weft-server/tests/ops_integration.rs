//! Integration tests for ops endpoints (nodes, capabilities, backups)
//! against a REAL Weaviate with the backup-filesystem module enabled.

use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use std::time::Duration;
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

#[tokio::test]
async fn nodes_report_healthy_with_shards() {
    let (status, body) = request("GET", "/api/v1/instances/local/nodes", None).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let nodes = body["nodes"].as_array().expect("nodes array");
    assert_eq!(nodes.len(), 1, "single-node dev cluster");
    let node = &nodes[0];
    assert_eq!(node["status"], "HEALTHY");
    assert!(node["version"].as_str().unwrap().starts_with("1."));
    let shards = node["shards"].as_array().expect("verbose shards");
    assert!(
        shards.iter().any(|s| s["class"] == "Article"),
        "Article shard present: {body}"
    );
}

#[tokio::test]
async fn capabilities_expose_backup_backends() {
    let (status, body) = request("GET", "/api/v1/instances/local/capabilities", None).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(body["version"].as_str().unwrap().starts_with("1."));
    let backends: Vec<&str> = body["backup_backends"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|b| b.as_str())
        .collect();
    assert!(
        backends.contains(&"filesystem"),
        "backup-filesystem module enabled in dev/CI: {body}"
    );
}

#[tokio::test]
async fn backup_create_completes_and_lists() {
    // Deterministic-but-unique-enough id: derived from time.
    let id = format!(
        "itest-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs()
    );
    let (status, body) = request(
        "POST",
        "/api/v1/instances/local/backups/filesystem",
        Some(serde_json::json!({ "id": id })),
    )
    .await;
    assert_eq!(status, StatusCode::ACCEPTED, "{body}");

    // Poll status until SUCCESS (tiny dataset — should be fast).
    let mut last = serde_json::Value::Null;
    for _ in 0..30 {
        let (_, status_body) = request(
            "GET",
            &format!("/api/v1/instances/local/backups/filesystem/{id}"),
            None,
        )
        .await;
        last = status_body;
        if last["status"] == "SUCCESS" {
            break;
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
    assert_eq!(last["status"], "SUCCESS", "backup finished: {last}");

    let (status, list) = request("GET", "/api/v1/instances/local/backups/filesystem", None).await;
    assert_eq!(status, StatusCode::OK);
    if list["list_supported"] == true {
        let ids: Vec<&str> = list["backups"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|b| b["id"].as_str())
            .collect();
        assert!(ids.contains(&id.as_str()), "created backup listed: {list}");
    } else {
        // Weaviate < 1.31: listing unsupported — Weft degrades cleanly.
        assert_eq!(list["backups"], serde_json::json!([]));
    }

    // Restore is an async job. With the classes still present it is accepted
    // (202) and then FAILS safely — proving the restore path is wired without
    // destroying test data.
    let (status, body) = request(
        "POST",
        &format!("/api/v1/instances/local/backups/filesystem/{id}/restore"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::ACCEPTED, "{body}");

    let mut restore = serde_json::Value::Null;
    for _ in 0..30 {
        let (_, s) = request(
            "GET",
            &format!("/api/v1/instances/local/backups/filesystem/{id}/restore"),
            None,
        )
        .await;
        restore = s;
        if restore["status"] == "FAILED" || restore["status"] == "SUCCESS" {
            break;
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
    assert_eq!(restore["status"], "FAILED", "{restore}");
    assert!(
        restore["error"]
            .as_str()
            .unwrap()
            .contains("already exists"),
        "restore refused because classes exist: {restore}"
    );
}

#[tokio::test]
async fn disabled_backend_and_bad_ids_are_clean_4xx() {
    // Weaviate answers 500 for unloaded backup modules; Weft capability-gates
    // and answers 422 with a readable message instead.
    let (status, body) = request("GET", "/api/v1/instances/local/backups/s3", None).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert!(body["error"]["message"]
        .as_str()
        .unwrap()
        .contains("not enabled"));

    let (status, body) = request(
        "POST",
        "/api/v1/instances/local/backups/filesystem",
        Some(serde_json::json!({ "id": "../escape" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(body["error"]["code"], "invalid_input");
}

// ---------- cluster statistics + RBAC visibility (v0.12) ----------

#[tokio::test]
async fn cluster_statistics_report_raft_state() {
    let (status, stats) = request("GET", "/api/v1/instances/local/statistics", None).await;
    assert_eq!(status, StatusCode::OK, "{stats}");
    let nodes = stats["statistics"].as_array().expect("statistics array");
    assert!(!nodes.is_empty());
    assert!(nodes[0]["name"].is_string(), "{stats}");
    // Single-node dev cluster: it is its own leader and synchronized.
    assert!(stats["synchronized"].as_bool().unwrap_or(false), "{stats}");
}

#[tokio::test]
async fn rbac_degrades_gracefully_on_anonymous_instances() {
    // The dev/CI Weaviate runs with anonymous access and no RBAC — the
    // overview must answer 200 with enabled:false, never a 4xx/5xx.
    let (status, rbac) = request("GET", "/api/v1/instances/local/rbac", None).await;
    assert_eq!(status, StatusCode::OK, "{rbac}");
    if rbac["enabled"] == false {
        assert!(rbac["reason"].as_str().unwrap().len() > 10, "{rbac}");
        assert!(rbac["roles"].as_array().unwrap().is_empty());
    } else {
        // RBAC-enabled environment: roles must be a list.
        assert!(rbac["roles"].is_array(), "{rbac}");
        assert!(rbac["users"].is_array(), "{rbac}");
    }
}

// ---------- Prometheus metrics (v1.2) ----------

#[tokio::test]
async fn metrics_snapshot_reports_go_runtime_series() {
    let (status, body) = request("GET", "/api/v1/instances/local/metrics", None).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["supported"], true, "{body}");
    // Go runtime families exist on every Weaviate version with monitoring on.
    assert!(body["goroutines"].as_f64().unwrap() > 0.0, "{body}");
    assert!(body["heap_inuse_bytes"].as_f64().unwrap() > 0.0, "{body}");
    assert!(body["cpu_seconds_total"].as_f64().unwrap() > 0.0, "{body}");
}

#[tokio::test]
async fn metrics_degrade_cleanly_when_endpoint_unreachable() {
    // Same Weaviate, but metrics_url pointing at a closed port.
    let config = Config {
        listen: "0.0.0.0:0".into(),
        instances: vec![InstanceConfig {
            id: "local".into(),
            name: "Local".into(),
            url: weaviate_url(),
            api_key: None,
            metrics_url: Some("http://127.0.0.1:9/metrics".into()),
        }],
        auth_token: None,
        read_only: false,
        instances_file: None,
    };
    let app = app(AppState::from_config(&config).expect("valid test config"));

    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/v1/instances/local/metrics")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(body["supported"], false, "{body}");
    assert!(
        body["reason"].as_str().unwrap().contains("not reachable"),
        "{body}"
    );
}
