//! Instance registry endpoints.

use crate::error::ApiError;
use crate::AppState;
use axum::extract::{Path, State};
use axum::Json;
use serde::Serialize;
use weft_weaviate::types::Meta;

/// Public representation of an instance (no credentials, ever).
#[derive(Debug, Serialize)]
pub struct InstanceSummary {
    pub id: String,
    pub name: String,
    pub url: String,
}

/// `GET /api/v1/instances`
pub async fn list(State(state): State<AppState>) -> Json<Vec<InstanceSummary>> {
    Json(
        state
            .instances()
            .iter()
            .map(|i| InstanceSummary {
                id: i.id.clone(),
                name: i.name.clone(),
                url: i.url.clone(),
            })
            .collect(),
    )
}

/// `GET /api/v1/instances/{id}/meta`
pub async fn meta(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Meta>, ApiError> {
    let instance = state
        .instance(&id)
        .ok_or_else(|| ApiError::InstanceNotFound(id))?;
    Ok(Json(instance.client.meta().await?))
}
