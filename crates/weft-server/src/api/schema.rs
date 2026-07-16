//! Schema endpoints.

use crate::error::ApiError;
use crate::AppState;
use axum::extract::{Path, State};
use axum::Json;
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
