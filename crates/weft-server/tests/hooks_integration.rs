//! Extension-seam integration tests (v1.4): the mutation hook fires for
//! successful mutations only, with the actor established by the auth
//! backend — against a REAL seeded Weaviate.

use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use secrecy::SecretString;
use std::sync::{Arc, Mutex};
use tower::ServiceExt;
use weft_core::{Config, InstanceConfig};
use weft_server::{app, AppState, MutationEvent};

fn weaviate_url() -> String {
    std::env::var("WEAVIATE_URL").unwrap_or_else(|_| "http://localhost:8181".into())
}

fn config(auth_token: Option<&str>) -> Config {
    Config {
        listen: "0.0.0.0:0".into(),
        instances: vec![InstanceConfig {
            id: "local".into(),
            name: "Local".into(),
            url: weaviate_url(),
            api_key: None,
            metrics_url: None,
        }],
        auth_token: auth_token.map(SecretString::from),
        read_only: false,
        instances_file: None,
    }
}

type Recorded = Arc<Mutex<Vec<MutationEvent>>>;

fn hooked_app(auth_token: Option<&str>) -> (axum::Router, Recorded) {
    let recorded: Recorded = Arc::default();
    let sink = Arc::clone(&recorded);
    let state = AppState::from_config(&config(auth_token))
        .expect("valid test config")
        .with_mutation_hook(Arc::new(move |event: &MutationEvent| {
            sink.lock().unwrap().push(event.clone());
        }));
    (app(state), recorded)
}

async fn send(
    router: axum::Router,
    method: &str,
    path: &str,
    body: Option<serde_json::Value>,
    bearer: Option<&str>,
) -> StatusCode {
    let mut builder = Request::builder().method(method).uri(path);
    if let Some(token) = bearer {
        builder = builder.header("authorization", format!("Bearer {token}"));
    }
    let body = match body {
        Some(json) => {
            builder = builder.header("content-type", "application/json");
            Body::from(json.to_string())
        }
        None => Body::empty(),
    };
    let response = router.oneshot(builder.body(body).unwrap()).await.unwrap();
    let status = response.status();
    let _ = response.into_body().collect().await;
    status
}

#[tokio::test]
async fn hook_records_successful_mutations_only() {
    let (router, recorded) = hooked_app(None);

    // Read: no event.
    let status = send(
        router.clone(),
        "GET",
        "/api/v1/instances/local/schema",
        None,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    // Read-safe POST (search): no event.
    let status = send(
        router.clone(),
        "POST",
        "/api/v1/instances/local/collections/Article/search",
        Some(serde_json::json!({ "kind": "bm25", "query": "science", "limit": 1 })),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    // Failed mutation (duplicate instance id): no event.
    let status = send(
        router.clone(),
        "POST",
        "/api/v1/instances",
        Some(serde_json::json!({ "id": "local", "name": "Dup", "url": "http://x:1" })),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert!(recorded.lock().unwrap().is_empty(), "no events yet");

    // Successful mutation: exactly one event, anonymous actor (no auth).
    let status = send(
        router.clone(),
        "POST",
        "/api/v1/instances",
        Some(serde_json::json!({ "id": "hooked", "name": "Hooked", "url": "http://x:1" })),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let status = send(router, "DELETE", "/api/v1/instances/hooked", None, None).await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    let events = recorded.lock().unwrap();
    assert_eq!(events.len(), 2, "{events:?}");
    assert_eq!(events[0].method, "POST");
    assert_eq!(events[0].path, "/api/v1/instances");
    assert_eq!(events[0].actor, "anonymous");
    assert_eq!(events[0].status, 201);
    assert_eq!(events[1].method, "DELETE");
    assert_eq!(events[1].status, 204);
}

#[tokio::test]
async fn hook_actor_comes_from_the_auth_backend() {
    let (router, recorded) = hooked_app(Some("hook-secret"));

    // Unauthorized mutation: rejected, no event.
    let status = send(
        router.clone(),
        "POST",
        "/api/v1/instances",
        Some(serde_json::json!({ "id": "h2", "name": "H2", "url": "http://x:1" })),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert!(recorded.lock().unwrap().is_empty());

    // Authorized mutation: event with the shared-token actor.
    let status = send(
        router.clone(),
        "POST",
        "/api/v1/instances",
        Some(serde_json::json!({ "id": "h2", "name": "H2", "url": "http://x:1" })),
        Some("hook-secret"),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let status = send(
        router,
        "DELETE",
        "/api/v1/instances/h2",
        None,
        Some("hook-secret"),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    let events = recorded.lock().unwrap();
    assert_eq!(events.len(), 2, "{events:?}");
    assert!(events.iter().all(|e| e.actor == "shared-token"), "{events:?}");
}
