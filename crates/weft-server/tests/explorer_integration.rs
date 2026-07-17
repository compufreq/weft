//! Integration tests for the data-explorer endpoints (objects, search,
//! NDJSON export) against a REAL seeded Weaviate.
//!
//! Seeded fixtures (crates/xtask): `Article` (25 objects, deterministic 8-dim
//! vectors, vectorizer "none") and multi-tenant `Product` (tenants acme/globex,
//! 5 objects each).

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

async fn get(path: &str) -> (StatusCode, serde_json::Value) {
    let response = test_app()
        .oneshot(Request::builder().uri(path).body(Body::empty()).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null),
    )
}

async fn post(path: &str, body: serde_json::Value) -> (StatusCode, serde_json::Value) {
    let response = test_app()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(path)
                .header("content-type", "application/json")
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null),
    )
}

// ---------- objects ----------

#[tokio::test]
async fn objects_paginate_with_cursor_until_drained() {
    let (status, page1) = get("/api/v1/instances/local/collections/Article/objects?limit=10").await;
    assert_eq!(status, StatusCode::OK, "{page1}");
    assert_eq!(page1["objects"].as_array().unwrap().len(), 10);
    let cursor1 = page1["next_cursor"].as_str().expect("cursor after page 1");

    let (_, page2) = get(&format!(
        "/api/v1/instances/local/collections/Article/objects?limit=10&cursor={cursor1}"
    ))
    .await;
    assert_eq!(page2["objects"].as_array().unwrap().len(), 10);
    let ids1: Vec<&str> = page1["objects"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|o| o["id"].as_str())
        .collect();
    let ids2: Vec<&str> = page2["objects"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|o| o["id"].as_str())
        .collect();
    assert!(ids1.iter().all(|id| !ids2.contains(id)), "pages overlap");

    // Third page drains the remaining 5 (seeded: 25 total).
    let cursor2 = page2["next_cursor"].as_str().unwrap();
    let (_, page3) = get(&format!(
        "/api/v1/instances/local/collections/Article/objects?limit=10&cursor={cursor2}"
    ))
    .await;
    assert_eq!(page3["objects"].as_array().unwrap().len(), 5);
    assert!(page3["next_cursor"].is_null(), "drained set has no cursor");
}

#[tokio::test]
async fn objects_include_vector_on_request() {
    let (_, body) =
        get("/api/v1/instances/local/collections/Article/objects?limit=1&include_vector=true")
            .await;
    let vector = &body["objects"][0]["vector"];
    assert_eq!(
        vector.as_array().map(Vec::len),
        Some(8),
        "8-dim seeded vector"
    );
}

#[tokio::test]
async fn multi_tenant_objects_require_and_respect_tenant() {
    // Without tenant: Weaviate rejects it → 4xx, not a 502.
    let (status, _) = get("/api/v1/instances/local/collections/Product/objects").await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);

    let (status, body) =
        get("/api/v1/instances/local/collections/Product/objects?tenant=acme").await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["objects"].as_array().unwrap().len(), 5);
}

// ---------- search ----------

#[tokio::test]
async fn bm25_search_returns_scored_hits() {
    let (status, body) = post(
        "/api/v1/instances/local/collections/Article/search",
        serde_json::json!({ "kind": "bm25", "query": "science", "limit": 5 }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let results = body["results"].as_array().unwrap();
    assert!(!results.is_empty(), "seeded science articles should match");
    let first = &results[0];
    assert!(first["id"].is_string());
    assert!(
        first["score"].is_number(),
        "bm25 score normalized to number"
    );
    assert!(first["properties"]["title"]
        .as_str()
        .unwrap()
        .contains("science"));
}

#[tokio::test]
async fn near_vector_search_finds_the_seeded_neighbor() {
    // Exact vector of seeded Article #0: ((0*31 + d*7) % 100) / 100
    let vector: Vec<f64> = (0..8).map(|d| ((d * 7) % 100) as f64 / 100.0).collect();
    let (status, body) = post(
        "/api/v1/instances/local/collections/Article/search",
        serde_json::json!({ "kind": "near_vector", "vector": vector, "limit": 3 }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let results = body["results"].as_array().unwrap();
    assert_eq!(results.len(), 3);
    assert!(
        results[0]["properties"]["title"]
            .as_str()
            .unwrap()
            .contains("#0"),
        "exact-vector match must rank first: {body}"
    );
    assert!(results[0]["distance"].as_f64().unwrap() < 1e-6);
}

#[tokio::test]
async fn hybrid_search_works_with_query_and_vector() {
    let vector: Vec<f64> = (0..8).map(|d| ((d * 7) % 100) as f64 / 100.0).collect();
    let (status, body) = post(
        "/api/v1/instances/local/collections/Article/search",
        serde_json::json!({ "kind": "hybrid", "query": "tech", "vector": vector, "alpha": 0.5 }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(!body["results"].as_array().unwrap().is_empty());
}

#[tokio::test]
async fn near_text_without_vectorizer_is_a_clean_422() {
    let (status, body) = post(
        "/api/v1/instances/local/collections/Article/search",
        serde_json::json!({ "kind": "near_text", "query": "anything" }),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(body["error"]["code"], "invalid_input");
}

#[tokio::test]
async fn search_on_unknown_collection_is_404() {
    let (status, body) = post(
        "/api/v1/instances/local/collections/Nope/search",
        serde_json::json!({ "kind": "bm25", "query": "x" }),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body["error"]["code"], "collection_not_found");
}

// ---------- export ----------

#[tokio::test]
async fn ndjson_export_streams_every_object() {
    let response = test_app()
        .oneshot(
            Request::builder()
                .uri("/api/v1/instances/local/collections/Article/export.ndjson")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()["content-type"], "application/x-ndjson");
    assert!(response.headers()["content-disposition"]
        .to_str()
        .unwrap()
        .contains("weft-objects-Article.ndjson"));

    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let text = String::from_utf8(bytes.to_vec()).unwrap();
    let lines: Vec<&str> = text.lines().collect();
    assert_eq!(lines.len(), 25, "all seeded articles exported");
    for line in &lines {
        let obj: serde_json::Value = serde_json::from_str(line).expect("valid JSON line");
        assert!(obj["id"].is_string());
        assert!(obj["properties"]["title"].is_string());
    }
}

// ---------- where-filters, aggregate, graphql console (v0.9) ----------

#[tokio::test]
async fn filtered_browse_pages_by_offset() {
    // 25 seeded articles, categories rotate tech/science/business/sports:
    // "science" matches exactly 6.
    let filter = serde_json::json!({
        "conditions": [{ "path": "category", "operator": "Equal", "value": "science" }]
    })
    .to_string();
    let encoded: String = url_encode(&filter);

    let (status, page1) = get(&format!(
        "/api/v1/instances/local/collections/Article/objects?limit=4&where={encoded}"
    ))
    .await;
    assert_eq!(status, StatusCode::OK, "{page1}");
    let objects = page1["objects"].as_array().unwrap();
    assert_eq!(objects.len(), 4);
    assert!(objects
        .iter()
        .all(|o| o["properties"]["category"] == "science"));
    assert_eq!(page1["next_cursor"], "4", "offset cursor");

    let (_, page2) = get(&format!(
        "/api/v1/instances/local/collections/Article/objects?limit=4&where={encoded}&cursor=4"
    ))
    .await;
    assert_eq!(page2["objects"].as_array().unwrap().len(), 2, "6 total");
    assert!(page2["next_cursor"].is_null(), "drained");
}

#[tokio::test]
async fn filtered_browse_supports_or_and_nested_groups() {
    // science (6) OR sports (6) → 12 of the 25 seeded articles.
    let filter = serde_json::json!({
        "operator": "Or",
        "conditions": [
            { "path": "category", "operator": "Equal", "value": "science" },
            { "path": "category", "operator": "Equal", "value": "sports" }
        ]
    })
    .to_string();
    let (status, body) = get(&format!(
        "/api/v1/instances/local/collections/Article/objects?limit=50&where={}",
        url_encode(&filter)
    ))
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let objects = body["objects"].as_array().unwrap();
    assert_eq!(objects.len(), 12, "{body}");
    assert!(objects.iter().all(|o| {
        let c = &o["properties"]["category"];
        c == "science" || c == "sports"
    }));

    // Nested: (science OR sports) AND wordCount < 100.
    // Seeded wordCount = 40 + i*7 → matches are 47, 61, 75, 89.
    let filter = serde_json::json!({
        "conditions": [
            { "path": "wordCount", "operator": "LessThan", "value": 100 }
        ],
        "groups": [{
            "operator": "Or",
            "conditions": [
                { "path": "category", "operator": "Equal", "value": "science" },
                { "path": "category", "operator": "Equal", "value": "sports" }
            ]
        }]
    })
    .to_string();
    let (status, body) = get(&format!(
        "/api/v1/instances/local/collections/Article/objects?limit=50&where={}",
        url_encode(&filter)
    ))
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["objects"].as_array().unwrap().len(), 4, "{body}");
}

#[tokio::test]
async fn filtered_browse_rejects_too_deep_nesting() {
    // Chain 6 groups (top level is depth 1, cap is 5) → clean 422.
    let mut filter = serde_json::json!({
        "conditions": [{ "path": "category", "operator": "Equal", "value": "tech" }]
    });
    for _ in 0..5 {
        filter = serde_json::json!({ "conditions": [], "groups": [filter] });
    }
    let (status, body) = get(&format!(
        "/api/v1/instances/local/collections/Article/objects?where={}",
        url_encode(&filter.to_string())
    ))
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert!(
        body["error"]["message"]
            .as_str()
            .unwrap()
            .contains("nest at most"),
        "{body}"
    );
}

#[tokio::test]
async fn filtered_browse_rejects_bad_filters() {
    // Malformed JSON → 422.
    let (status, body) =
        get("/api/v1/instances/local/collections/Article/objects?where=notjson").await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");

    // Unknown operator → 422 from deserialization.
    let filter = url_encode(
        &serde_json::json!({
            "conditions": [{ "path": "category", "operator": "Regex", "value": "x" }]
        })
        .to_string(),
    );
    let (status, _) = get(&format!(
        "/api/v1/instances/local/collections/Article/objects?where={filter}"
    ))
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn search_combines_operator_with_filter() {
    let (status, body) = post(
        "/api/v1/instances/local/collections/Article/search",
        serde_json::json!({
            "kind": "bm25",
            "query": "demo",
            "where": {
                "conditions": [
                    { "path": "category", "operator": "Equal", "value": "science" }
                ]
            }
        }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let results = body["results"].as_array().unwrap();
    assert!(!results.is_empty(), "bm25 'demo' hits every seeded article");
    assert!(
        results
            .iter()
            .all(|r| r["properties"]["category"] == "science"),
        "filter constrains search results: {body}"
    );
}

#[tokio::test]
async fn aggregate_counts_and_facets() {
    // Plain count.
    let (status, body) = post(
        "/api/v1/instances/local/collections/Article/aggregate",
        serde_json::json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["count"], 25);
    assert!(body["groups"].is_null());

    // Facets by category: 4 buckets, tech leads with 7.
    let (status, body) = post(
        "/api/v1/instances/local/collections/Article/aggregate",
        serde_json::json!({ "group_by": "category" }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["count"], 25, "sum of buckets");
    let groups = body["groups"].as_array().unwrap();
    assert_eq!(groups.len(), 4);
    assert_eq!(groups[0]["value"], "tech", "sorted by count desc: {body}");
    assert_eq!(groups[0]["count"], 7);

    // Filtered count.
    let (status, body) = post(
        "/api/v1/instances/local/collections/Article/aggregate",
        serde_json::json!({
            "where": { "conditions": [
                { "path": "category", "operator": "Equal", "value": "science" }
            ]}
        }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["count"], 6);
}

#[tokio::test]
async fn graphql_console_passes_through_data_and_errors() {
    // A valid aggregate query returns Weaviate's envelope verbatim.
    let (status, body) = post(
        "/api/v1/instances/local/graphql",
        serde_json::json!({ "query": "{ Aggregate { Article { meta { count } } } }" }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["data"]["Aggregate"]["Article"][0]["meta"]["count"], 25);

    // Weaviate-side GraphQL errors come back in the envelope, not as 4xx.
    let (status, body) = post(
        "/api/v1/instances/local/graphql",
        serde_json::json!({ "query": "{ Get { NoSuchClass { x } } }" }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(body["errors"].is_array(), "{body}");

    // Empty query is a clean 422.
    let (status, _) = post(
        "/api/v1/instances/local/graphql",
        serde_json::json!({ "query": "  " }),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
}

/// Minimal percent-encoding for JSON in a query string.
fn url_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 3);
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

// ---------- object CRUD + import (v0.10) ----------
// These tests use their own collections (set up via the weaviate client
// directly) so they can't disturb the seeded Article counts that other
// tests assert in parallel.

async fn ensure_class(name: &str) -> weft_weaviate::WeaviateClient {
    let client = weft_weaviate::WeaviateClient::new(&weaviate_url(), None).unwrap();
    let _ = client.delete_class(name).await; // clean slate; ignore 4xx
    client
        .create_class(&serde_json::json!({
            "class": name,
            "vectorizer": "none",
            "properties": [
                { "name": "title", "dataType": ["text"] },
                { "name": "wordCount", "dataType": ["int"] }
            ]
        }))
        .await
        .expect("create test class");
    client
}

async fn delete(path: &str) -> StatusCode {
    let response = test_app()
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri(path)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    response.status()
}

async fn put(path: &str, body: serde_json::Value) -> (StatusCode, serde_json::Value) {
    let response = test_app()
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri(path)
                .header("content-type", "application/json")
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
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
async fn object_crud_roundtrip() {
    let cleanup = ensure_class("WeftCrudTest").await;
    let base = "/api/v1/instances/local/collections/WeftCrudTest/objects";

    // Create.
    let (status, created) = post(
        base,
        serde_json::json!({ "properties": { "title": "first", "wordCount": 5 } }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{created}");
    let id = created["id"].as_str().expect("created id").to_string();

    // Read.
    let (status, fetched) = get(&format!("{base}/{id}")).await;
    assert_eq!(status, StatusCode::OK, "{fetched}");
    assert_eq!(fetched["properties"]["title"], "first");

    // Replace.
    let (status, updated) = put(
        &format!("{base}/{id}"),
        serde_json::json!({ "properties": { "title": "second", "wordCount": 9 } }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{updated}");
    let (_, refetched) = get(&format!("{base}/{id}")).await;
    assert_eq!(refetched["properties"]["title"], "second");
    assert_eq!(refetched["properties"]["wordCount"], 9);

    // Delete → gone.
    assert_eq!(
        delete(&format!("{base}/{id}")).await,
        StatusCode::NO_CONTENT
    );
    let (status, _) = get(&format!("{base}/{id}")).await;
    assert_eq!(
        status,
        StatusCode::UNPROCESSABLE_ENTITY,
        "404 from weaviate maps to 422"
    );

    // Bad ids are rejected before touching Weaviate.
    let (status, _) = get(&format!("{base}/..%2Fetc")).await;
    assert_ne!(status, StatusCode::OK);

    let _ = cleanup.delete_class("WeftCrudTest").await;
}

#[tokio::test]
async fn import_reports_per_item_outcomes() {
    let cleanup = ensure_class("WeftImportTest").await;

    // Two good objects, one with a type-mismatched property (fails per-item).
    let (status, report) = post(
        "/api/v1/instances/local/collections/WeftImportTest/import",
        serde_json::json!({
            "objects": [
                { "properties": { "title": "a", "wordCount": 1 } },
                { "properties": { "title": "b", "wordCount": "not-a-number" } },
                { "properties": { "title": "c", "wordCount": 3 } }
            ]
        }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{report}");
    assert_eq!(report["inserted"], 2, "{report}");
    assert_eq!(report["failed"], 1, "{report}");
    let errors = report["errors"].as_array().unwrap();
    assert_eq!(errors.len(), 1);
    assert_eq!(errors[0]["index"], 1);
    assert!(errors[0]["message"].as_str().unwrap().len() > 3);

    // Imported objects are actually queryable.
    let (_, agg) = post(
        "/api/v1/instances/local/collections/WeftImportTest/aggregate",
        serde_json::json!({}),
    )
    .await;
    assert_eq!(agg["count"], 2, "{agg}");

    // Empty import is a clean 422.
    let (status, _) = post(
        "/api/v1/instances/local/collections/WeftImportTest/import",
        serde_json::json!({ "objects": [] }),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);

    let _ = cleanup.delete_class("WeftImportTest").await;
}
