//! Collection alias management (Weaviate ≥ 1.32; GA in 1.33).
//!
//! On older Weaviate the list endpoint degrades to `supported: false`
//! instead of surfacing an upstream 404 — the same graceful-degradation
//! pattern as pre-1.31 backup listing.

use crate::error::ApiError;
use crate::AppState;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};

/// Parse "major.minor…" and compare against a minimum version.
pub fn version_at_least(version: &str, min_major: u64, min_minor: u64) -> bool {
    let mut parts = version.split('.').map(|p| p.parse::<u64>().unwrap_or(0));
    let major = parts.next().unwrap_or(0);
    let minor = parts.next().unwrap_or(0);
    (major, minor) >= (min_major, min_minor)
}

fn valid_alias(name: &str) -> Result<(), ApiError> {
    let ok = !name.is_empty()
        && name.len() <= 128
        && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_');
    if ok {
        Ok(())
    } else {
        Err(ApiError::InvalidInput(format!(
            "`{name}` is not a valid alias name"
        )))
    }
}

/// `GET /api/v1/instances/{id}/aliases` — list aliases, or
/// `{ supported: false }` on Weaviate < 1.32.
pub async fn list(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let instance = state
        .instance(&id)
        .ok_or_else(|| ApiError::InstanceNotFound(id))?;

    let meta = instance.client.meta().await?;
    if !version_at_least(&meta.version, 1, 32) {
        return Ok(Json(
            json!({ "supported": false, "aliases": [], "reason": format!("aliases need Weaviate ≥ 1.32 (this instance runs {})", meta.version) }),
        ));
    }

    let raw = instance.client.aliases().await?;
    let aliases = raw["aliases"].as_array().cloned().unwrap_or_default();
    Ok(Json(json!({ "supported": true, "aliases": aliases })))
}

#[derive(Debug, Deserialize)]
pub struct AliasRequest {
    pub alias: Option<String>,
    pub class: String,
}

/// `POST /api/v1/instances/{id}/aliases` — create `{alias, class}`.
pub async fn create(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<AliasRequest>,
) -> Result<Json<Value>, ApiError> {
    let instance = state
        .instance(&id)
        .ok_or_else(|| ApiError::InstanceNotFound(id))?;
    let alias = body
        .alias
        .as_deref()
        .ok_or_else(|| ApiError::InvalidInput("`alias` is required".into()))?;
    valid_alias(alias)?;
    valid_alias(&body.class)?;
    let created = instance.client.create_alias(alias, &body.class).await?;
    Ok(Json(created))
}

/// `PUT /api/v1/instances/{id}/aliases/{alias}` — repoint at another class.
pub async fn update(
    State(state): State<AppState>,
    Path((id, alias)): Path<(String, String)>,
    Json(body): Json<AliasRequest>,
) -> Result<Json<Value>, ApiError> {
    let instance = state
        .instance(&id)
        .ok_or_else(|| ApiError::InstanceNotFound(id))?;
    valid_alias(&alias)?;
    valid_alias(&body.class)?;
    let updated = instance.client.update_alias(&alias, &body.class).await?;
    Ok(Json(updated))
}

/// `DELETE /api/v1/instances/{id}/aliases/{alias}` — remove the alias only.
pub async fn delete(
    State(state): State<AppState>,
    Path((id, alias)): Path<(String, String)>,
) -> Result<StatusCode, ApiError> {
    let instance = state
        .instance(&id)
        .ok_or_else(|| ApiError::InstanceNotFound(id))?;
    valid_alias(&alias)?;
    instance.client.delete_alias(&alias).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[cfg(test)]
mod tests {
    use super::version_at_least;

    #[test]
    fn version_comparison_handles_real_weaviate_versions() {
        assert!(version_at_least("1.32.0", 1, 32));
        assert!(version_at_least("1.37.2", 1, 32));
        assert!(version_at_least("2.0.0", 1, 32));
        assert!(!version_at_least("1.30.1", 1, 32));
        assert!(!version_at_least("1.31.9", 1, 32));
        // Garbage degrades to "not supported", never a panic.
        assert!(!version_at_least("weird", 1, 32));
    }
}
