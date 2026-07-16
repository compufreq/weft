//! Collection (class) management: create, delete, add property.
//!
//! All three are mutations — the read-only guard blocks them wholesale.

use crate::error::ApiError;
use crate::AppState;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde_json::Value;

/// Weaviate class names: GraphQL identifiers starting with an uppercase letter.
fn valid_class_name(name: &str) -> Result<(), ApiError> {
    let mut chars = name.chars();
    let ok = chars.next().is_some_and(|c| c.is_ascii_uppercase())
        && name.len() <= 128
        && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_');
    if ok {
        Ok(())
    } else {
        Err(ApiError::InvalidInput(format!(
            "`{name}` is not a valid collection name (UpperCamelCase, alphanumeric)"
        )))
    }
}

/// `POST /api/v1/instances/{id}/collections` — create a collection from a raw
/// class definition (the UI's guided form assembles the same JSON).
pub async fn create(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let instance = state
        .instance(&id)
        .ok_or_else(|| ApiError::InstanceNotFound(id))?;
    let name = body["class"]
        .as_str()
        .ok_or_else(|| ApiError::InvalidInput("`class` (string) is required".into()))?;
    valid_class_name(name)?;
    let created = instance.client.create_class(&body).await?;
    Ok(Json(created))
}

/// `DELETE /api/v1/instances/{id}/collections/{class}` — drop a collection
/// and all of its objects. The UI gates this behind a typed confirmation.
pub async fn delete(
    State(state): State<AppState>,
    Path((id, class)): Path<(String, String)>,
) -> Result<StatusCode, ApiError> {
    let instance = state
        .instance(&id)
        .ok_or_else(|| ApiError::InstanceNotFound(id))?;
    valid_class_name(&class)?;
    instance.client.delete_class(&class).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// `POST /api/v1/instances/{id}/collections/{class}/properties` — add a
/// property to an existing collection (the only schema mutation Weaviate
/// supports in place; anything else needs a migration).
pub async fn add_property(
    State(state): State<AppState>,
    Path((id, class)): Path<(String, String)>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let instance = state
        .instance(&id)
        .ok_or_else(|| ApiError::InstanceNotFound(id))?;
    valid_class_name(&class)?;
    if body["name"].as_str().is_none() || !body["dataType"].is_array() {
        return Err(ApiError::InvalidInput(
            "a property needs `name` (string) and `dataType` (array)".into(),
        ));
    }
    let added = instance.client.add_property(&class, &body).await?;
    Ok(Json(added))
}
