//! Schema endpoints.

use crate::error::ApiError;
use crate::AppState;
use axum::extract::{Path, State};
use axum::http::header;
use axum::response::IntoResponse;
use axum::Json;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use weft_core::{diff_schemas, DiffEntry};
use weft_weaviate::types::Schema;

/// `GET /api/v1/instances/{id}/schema` — the instance's full schema.
pub async fn full(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Schema>, ApiError> {
    let instance = state
        .instance(&id)
        .ok_or_else(|| ApiError::InstanceNotFound(id))?;
    Ok(Json(instance.client.schema().await?))
}

/// `GET /api/v1/instances/{id}/schema/export` — raw schema as a JSON download.
pub async fn export(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    let instance = state
        .instance(&id)
        .ok_or_else(|| ApiError::InstanceNotFound(id.clone()))?;
    let schema = instance.client.schema_raw().await?;
    // id comes from the registry (slugified on create), safe for a filename.
    let disposition = format!("attachment; filename=\"weft-schema-{id}.json\"");
    Ok((
        [
            (header::CONTENT_TYPE, "application/json".to_string()),
            (header::CONTENT_DISPOSITION, disposition),
        ],
        Json(schema),
    ))
}

/// Body of `POST /api/v1/instances/{id}/schema/diff`.
///
/// Exactly one of `against_instance` / `against_schema` must be set.
#[derive(Debug, Deserialize)]
pub struct DiffRequest {
    /// Compare against another registered instance.
    pub against_instance: Option<String>,
    /// Compare against a pasted/uploaded raw schema document.
    pub against_schema: Option<Value>,
}

#[derive(Debug, Serialize)]
pub struct DiffResponse {
    /// Label of the left side (this instance's id).
    pub left: String,
    /// Label of the right side (other instance id or "provided schema").
    pub right: String,
    pub entries: Vec<DiffEntry>,
}

/// `POST /api/v1/instances/{id}/schema/diff` — structural schema diff.
pub async fn diff(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<DiffRequest>,
) -> Result<Json<DiffResponse>, ApiError> {
    let instance = state
        .instance(&id)
        .ok_or_else(|| ApiError::InstanceNotFound(id.clone()))?;
    let left = instance.client.schema_raw().await?;

    let (right, right_label) = match (body.against_instance, body.against_schema) {
        (Some(other_id), None) => {
            let other = state
                .instance(&other_id)
                .ok_or_else(|| ApiError::InstanceNotFound(other_id.clone()))?;
            (other.client.schema_raw().await?, other_id)
        }
        (None, Some(schema)) => (schema, "provided schema".to_string()),
        _ => {
            return Err(ApiError::InvalidInput(
                "set exactly one of against_instance or against_schema".into(),
            ))
        }
    };

    Ok(Json(DiffResponse {
        left: id,
        right: right_label,
        entries: diff_schemas(&left, &right),
    }))
}
