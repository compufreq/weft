//! Instance registry endpoints.

use crate::error::ApiError;
use crate::state::Instance;
use crate::AppState;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use secrecy::SecretString;
use serde::{Deserialize, Serialize};
use weft_weaviate::types::Meta;
use weft_weaviate::WeaviateClient;

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

/// Body of `POST /api/v1/instances`.
#[derive(Debug, Deserialize)]
pub struct AddInstance {
    /// Optional explicit id; derived from `name` when omitted.
    pub id: Option<String>,
    pub name: String,
    pub url: String,
    /// Optional API key — accepted on input, never echoed back.
    pub api_key: Option<String>,
}

fn slugify(name: &str) -> String {
    let slug: String = name
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    let slug = slug.trim_matches('-').to_string();
    if slug.is_empty() {
        "instance".into()
    } else {
        slug
    }
}

/// `POST /api/v1/instances` — register an instance at runtime (in-memory).
pub async fn add(
    State(state): State<AppState>,
    Json(body): Json<AddInstance>,
) -> Result<(StatusCode, Json<InstanceSummary>), ApiError> {
    let name = body.name.trim().to_string();
    if name.is_empty() {
        return Err(ApiError::InvalidInput("name must not be empty".into()));
    }
    let id = body
        .id
        .map(|id| slugify(&id))
        .unwrap_or_else(|| slugify(&name));

    let api_key = body
        .api_key
        .filter(|k| !k.is_empty())
        .map(SecretString::from);
    let client = WeaviateClient::new(&body.url, api_key)
        .map_err(|e| ApiError::InvalidInput(format!("invalid url: {e}")))?;

    let instance = Instance {
        id: id.clone(),
        name,
        url: body.url,
        client,
    };
    let added = state
        .add_instance(instance)
        .ok_or(ApiError::InstanceExists(id))?;

    Ok((
        StatusCode::CREATED,
        Json(InstanceSummary {
            id: added.id.clone(),
            name: added.name.clone(),
            url: added.url.clone(),
        }),
    ))
}

/// `DELETE /api/v1/instances/{id}` — remove a registered instance.
pub async fn remove(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
    if state.remove_instance(&id) {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(ApiError::InstanceNotFound(id))
    }
}
