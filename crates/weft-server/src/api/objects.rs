//! Object browsing, search, and export endpoints.

use crate::error::ApiError;
use crate::AppState;
use axum::body::Body;
use axum::extract::{Path, Query, State};
use axum::http::header;
use axum::response::IntoResponse;
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};
use weft_weaviate::graphql::{self, Search};
use weft_weaviate::{ObjectsQuery, WeaviateClient};

const DEFAULT_LIMIT: usize = 50;
const MAX_LIMIT: usize = 200;
const EXPORT_PAGE: usize = 100;

#[derive(Debug, Deserialize)]
pub struct ObjectsParams {
    pub cursor: Option<String>,
    pub limit: Option<usize>,
    pub tenant: Option<String>,
    #[serde(default)]
    pub include_vector: bool,
}

/// `GET /api/v1/instances/{id}/collections/{class}/objects`
///
/// Cursor pagination: pass the returned `next_cursor` back as `cursor`.
pub async fn list(
    State(state): State<AppState>,
    Path((id, class)): Path<(String, String)>,
    Query(params): Query<ObjectsParams>,
) -> Result<Json<Value>, ApiError> {
    let instance = state
        .instance(&id)
        .ok_or_else(|| ApiError::InstanceNotFound(id))?;
    let limit = params.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT);

    let raw = instance
        .client
        .objects(&ObjectsQuery {
            class: &class,
            limit,
            after: params.cursor.as_deref(),
            tenant: params.tenant.as_deref(),
            include_vector: params.include_vector,
        })
        .await?;

    let objects = raw["objects"].as_array().cloned().unwrap_or_default();
    // Weaviate's `after` cursor is the last object's UUID; a full page means
    // there may be more.
    let next_cursor = (objects.len() == limit)
        .then(|| {
            objects
                .last()
                .and_then(|o| o["id"].as_str())
                .map(String::from)
        })
        .flatten();

    Ok(Json(
        json!({ "objects": objects, "next_cursor": next_cursor }),
    ))
}

/// Body of the search endpoint. `kind` selects the operator.
#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SearchKind {
    Bm25 {
        query: String,
    },
    NearText {
        query: String,
    },
    NearVector {
        vector: Vec<f64>,
    },
    Hybrid {
        query: String,
        vector: Option<Vec<f64>>,
        alpha: Option<f64>,
    },
}

#[derive(Debug, Deserialize)]
pub struct SearchRequest {
    #[serde(flatten)]
    pub kind: SearchKind,
    pub limit: Option<usize>,
    pub tenant: Option<String>,
}

/// Only primitive properties can be selected in a flat GraphQL query.
/// Weaviate convention: primitive data types are lowercase; references are
/// capitalized class names.
fn primitive_properties(class: &weft_weaviate::types::Class) -> Vec<String> {
    class
        .properties
        .iter()
        .filter(|p| {
            p.data_type
                .first()
                .is_some_and(|t| t.chars().next().is_some_and(|c| c.is_lowercase()))
        })
        .map(|p| p.name.clone())
        .collect()
}

/// `POST /api/v1/instances/{id}/collections/{class}/search`
pub async fn search(
    State(state): State<AppState>,
    Path((id, class)): Path<(String, String)>,
    Json(body): Json<SearchRequest>,
) -> Result<Json<Value>, ApiError> {
    let instance = state
        .instance(&id)
        .ok_or_else(|| ApiError::InstanceNotFound(id))?;
    let limit = body.limit.unwrap_or(25).clamp(1, MAX_LIMIT);

    // Property selection comes from the live schema.
    let schema = instance.client.schema().await?;
    let cls = schema
        .classes
        .iter()
        .find(|c| c.class == class)
        .ok_or_else(|| ApiError::CollectionNotFound(class.clone()))?;
    let properties = primitive_properties(cls);

    let search = match &body.kind {
        SearchKind::Bm25 { query } => Search::Bm25 {
            query: query.clone(),
        },
        SearchKind::NearText { query } => Search::NearText {
            query: query.clone(),
        },
        SearchKind::NearVector { vector } => Search::NearVector {
            vector: vector.clone(),
        },
        SearchKind::Hybrid {
            query,
            vector,
            alpha,
        } => Search::Hybrid {
            query: query.clone(),
            vector: vector.clone(),
            alpha: *alpha,
        },
    };

    let gql = graphql::build_get(&class, &properties, &search, limit, body.tenant.as_deref())
        .map_err(|e| ApiError::InvalidInput(e.to_string()))?;
    let envelope = instance.client.graphql(&gql).await?;

    // Surface Weaviate GraphQL errors (e.g. nearText without a vectorizer).
    if let Some(errors) = envelope.get("errors").filter(|e| e.is_array()) {
        let message = errors
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|e| e["message"].as_str())
            .collect::<Vec<_>>()
            .join("; ");
        return Err(ApiError::InvalidInput(format!("search failed: {message}")));
    }

    let hits = envelope["data"]["Get"][&class]
        .as_array()
        .cloned()
        .unwrap_or_default();
    let results: Vec<Value> = hits
        .into_iter()
        .map(|hit| {
            let mut properties = hit.as_object().cloned().unwrap_or_default();
            let additional = properties.remove("_additional").unwrap_or(Value::Null);
            // BM25/hybrid scores arrive as strings — normalize to numbers.
            let score = additional["score"]
                .as_str()
                .and_then(|s| s.parse::<f64>().ok())
                .or_else(|| additional["score"].as_f64());
            json!({
                "id": additional["id"],
                "score": score,
                "distance": additional["distance"],
                "properties": Value::Object(properties),
            })
        })
        .collect();

    Ok(Json(json!({ "results": results })))
}

#[derive(Debug, Deserialize)]
pub struct ExportParams {
    pub tenant: Option<String>,
    #[serde(default)]
    pub include_vector: bool,
}

/// `GET /api/v1/instances/{id}/collections/{class}/export.ndjson`
///
/// Streams every object as one JSON line, paging through the cursor API —
/// constant memory regardless of collection size.
pub async fn export(
    State(state): State<AppState>,
    Path((id, class)): Path<(String, String)>,
    Query(params): Query<ExportParams>,
) -> Result<impl IntoResponse, ApiError> {
    let instance = state
        .instance(&id)
        .ok_or_else(|| ApiError::InstanceNotFound(id))?;
    let client: WeaviateClient = instance.client.clone();

    struct PageState {
        client: WeaviateClient,
        class: String,
        tenant: Option<String>,
        include_vector: bool,
        cursor: Option<String>,
        done: bool,
    }

    let initial = PageState {
        client,
        class: class.clone(),
        tenant: params.tenant,
        include_vector: params.include_vector,
        cursor: None,
        done: false,
    };

    let stream = futures_util::stream::try_unfold(initial, |mut st| async move {
        if st.done {
            return Ok::<_, weft_weaviate::Error>(None);
        }
        let raw = st
            .client
            .objects(&ObjectsQuery {
                class: &st.class,
                limit: EXPORT_PAGE,
                after: st.cursor.as_deref(),
                tenant: st.tenant.as_deref(),
                include_vector: st.include_vector,
            })
            .await?;
        let objects = raw["objects"].as_array().cloned().unwrap_or_default();
        if objects.is_empty() {
            return Ok(None);
        }
        st.cursor = objects
            .last()
            .and_then(|o| o["id"].as_str())
            .map(String::from);
        st.done = objects.len() < EXPORT_PAGE || st.cursor.is_none();

        let mut chunk = String::new();
        for obj in &objects {
            chunk.push_str(&obj.to_string());
            chunk.push('\n');
        }
        Ok(Some((axum::body::Bytes::from(chunk), st)))
    });

    let disposition = format!("attachment; filename=\"weft-objects-{class}.ndjson\"");
    Ok((
        [
            (header::CONTENT_TYPE, "application/x-ndjson".to_string()),
            (header::CONTENT_DISPOSITION, disposition),
        ],
        Body::from_stream(stream),
    ))
}
