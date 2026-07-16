//! Runtime-instance persistence (`WEFT_INSTANCES_FILE`) — no Weaviate needed:
//! registering an instance only validates the URL.

use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use tower::ServiceExt;
use weft_core::Config;
use weft_server::{app, AppState};

fn config_with_file(path: &std::path::Path) -> Config {
    Config {
        listen: "0.0.0.0:0".into(),
        instances: vec![],
        auth_token: None,
        read_only: false,
        instances_file: Some(path.to_string_lossy().into_owned()),
    }
}

async fn send(
    app: &axum::Router,
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
    let response = app
        .clone()
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
async fn runtime_instances_survive_restart_via_file() {
    let dir = std::env::temp_dir().join(format!("weft-test-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let file = dir.join("instances.json");
    let _ = std::fs::remove_file(&file);
    let config = config_with_file(&file);

    // "First boot": add an instance (with an api key) at runtime.
    let app1 = app(AppState::from_config(&config).unwrap());
    let (status, created) = send(
        &app1,
        "POST",
        "/api/v1/instances",
        Some(serde_json::json!({
            "name": "Persisted Cluster",
            "url": "http://persisted:8080",
            "api_key": "sekrit-key"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{created}");

    // The file exists, holds the instance, and carries the key for reuse —
    // but the API response never echoed it.
    let raw = std::fs::read_to_string(&file).expect("instances file written");
    assert!(raw.contains("persisted-cluster"));
    assert!(
        raw.contains("sekrit-key"),
        "key persisted for restart reuse"
    );
    assert!(!created.to_string().contains("sekrit-key"));

    // "Restart": a fresh state from the same config rehydrates it.
    let app2 = app(AppState::from_config(&config).unwrap());
    let (_, listed) = send(&app2, "GET", "/api/v1/instances", None).await;
    let entry = listed
        .as_array()
        .unwrap()
        .iter()
        .find(|i| i["id"] == "persisted-cluster")
        .expect("instance survived the restart")
        .clone();
    assert_eq!(entry["url"], "http://persisted:8080");
    assert!(
        !listed.to_string().contains("sekrit-key"),
        "never in responses"
    );

    // Removing it updates the file; the next boot no longer has it.
    let (status, _) = send(&app2, "DELETE", "/api/v1/instances/persisted-cluster", None).await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let app3 = app(AppState::from_config(&config).unwrap());
    let (_, listed) = send(&app3, "GET", "/api/v1/instances", None).await;
    assert!(
        !listed
            .as_array()
            .unwrap()
            .iter()
            .any(|i| i["id"] == "persisted-cluster"),
        "removal persisted"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test]
async fn corrupt_instances_file_never_stops_boot() {
    let dir = std::env::temp_dir().join(format!("weft-test-corrupt-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let file = dir.join("instances.json");
    std::fs::write(&file, "{{{{ not json").unwrap();

    let app1 = app(AppState::from_config(&config_with_file(&file)).unwrap());
    let (status, listed) = send(&app1, "GET", "/api/v1/instances", None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(listed, serde_json::json!([]), "boots empty, not crashed");

    let _ = std::fs::remove_dir_all(&dir);
}
