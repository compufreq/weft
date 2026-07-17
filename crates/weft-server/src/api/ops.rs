//! Operations endpoints: node health, capabilities, backups.

use crate::error::ApiError;
use crate::AppState;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};
use std::time::{SystemTime, UNIX_EPOCH};

/// `GET /api/v1/instances/{id}/nodes` — verbose node/shard health.
pub async fn nodes(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let instance = state
        .instance(&id)
        .ok_or_else(|| ApiError::InstanceNotFound(id))?;
    Ok(Json(instance.client.nodes().await?))
}

/// Backup backends Weaviate can expose as modules.
const BACKUP_BACKENDS: &[&str] = &["filesystem", "s3", "gcs", "azure"];

/// `GET /api/v1/instances/{id}/capabilities` — version, modules, and derived
/// capability flags (what the UI should offer for this instance).
pub async fn capabilities(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let instance = state
        .instance(&id)
        .ok_or_else(|| ApiError::InstanceNotFound(id))?;
    let meta = instance.client.meta().await?;

    let module_names: Vec<String> = meta
        .modules
        .as_object()
        .map(|m| m.keys().cloned().collect())
        .unwrap_or_default();
    let backup_backends: Vec<&str> = BACKUP_BACKENDS
        .iter()
        .copied()
        .filter(|b| module_names.iter().any(|m| m == &format!("backup-{b}")))
        .collect();

    Ok(Json(json!({
        "version": meta.version,
        "modules": module_names,
        "backup_backends": backup_backends,
        "aliases_supported": crate::api::aliases::version_at_least(&meta.version, 1, 32),
    })))
}

/// `GET /api/v1/instances/{id}/statistics` — Raft cluster statistics
/// (leader, synchronization state, per-node Raft info).
pub async fn statistics(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let instance = state
        .instance(&id)
        .ok_or_else(|| ApiError::InstanceNotFound(id))?;
    Ok(Json(instance.client.cluster_statistics().await?))
}

/// Validate a backend/backup-id path segment (defense in depth — these are
/// interpolated into upstream URL paths).
fn path_segment(s: &str) -> Result<&str, ApiError> {
    let ok = !s.is_empty()
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if ok {
        Ok(s)
    } else {
        Err(ApiError::InvalidInput(format!("invalid identifier `{s}`")))
    }
}

/// Capability-gate a backup backend: Weaviate answers 500 for backends whose
/// module isn't loaded, so we check the module list and answer 422 instead.
async fn ensure_backend_enabled(
    instance: &crate::state::Instance,
    backend: &str,
) -> Result<(), ApiError> {
    let meta = instance.client.meta().await?;
    let enabled = meta
        .modules
        .as_object()
        .is_some_and(|m| m.contains_key(&format!("backup-{backend}")));
    if enabled {
        Ok(())
    } else {
        Err(ApiError::InvalidInput(format!(
            "backup backend `{backend}` is not enabled on this instance (module backup-{backend} missing)"
        )))
    }
}

/// `GET /api/v1/instances/{id}/backups/{backend}` — list backups.
pub async fn backups_list(
    State(state): State<AppState>,
    Path((id, backend)): Path<(String, String)>,
) -> Result<Json<Value>, ApiError> {
    let instance = state
        .instance(&id)
        .ok_or_else(|| ApiError::InstanceNotFound(id))?;
    path_segment(&backend)?;
    ensure_backend_enabled(&instance, &backend).await?;
    // Older Weaviate (< 1.31) has no list endpoint — degrade, don't 502.
    match instance.client.backups(&backend).await {
        Ok(list) => Ok(Json(json!({ "backups": list, "list_supported": true }))),
        Err(weft_weaviate::Error::Status { status, body })
            if status.is_server_error() && body.contains("not implemented") =>
        {
            Ok(Json(json!({ "backups": [], "list_supported": false })))
        }
        Err(err) => Err(err.into()),
    }
}

#[derive(Debug, Deserialize)]
pub struct CreateBackup {
    /// Optional explicit id; timestamp-derived when omitted.
    pub id: Option<String>,
}

/// `POST /api/v1/instances/{id}/backups/{backend}` — start a backup.
pub async fn backups_create(
    State(state): State<AppState>,
    Path((id, backend)): Path<(String, String)>,
    Json(body): Json<CreateBackup>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let instance = state
        .instance(&id)
        .ok_or_else(|| ApiError::InstanceNotFound(id))?;
    path_segment(&backend)?;
    ensure_backend_enabled(&instance, &backend).await?;
    let backup_id = match body.id {
        Some(explicit) => path_segment(&explicit)?.to_string(),
        None => {
            let secs = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0);
            format!("weft-{secs}")
        }
    };
    let created = instance.client.backup_create(&backend, &backup_id).await?;
    Ok((StatusCode::ACCEPTED, Json(created)))
}

/// `GET /api/v1/instances/{id}/backups/{backend}/{backup_id}` — creation status.
pub async fn backups_status(
    State(state): State<AppState>,
    Path((id, backend, backup_id)): Path<(String, String, String)>,
) -> Result<Json<Value>, ApiError> {
    let instance = state
        .instance(&id)
        .ok_or_else(|| ApiError::InstanceNotFound(id))?;
    path_segment(&backend)?;
    path_segment(&backup_id)?;
    Ok(Json(
        instance.client.backup_status(&backend, &backup_id).await?,
    ))
}

/// `POST /api/v1/instances/{id}/backups/{backend}/{backup_id}/restore`
///
/// Starts an async restore job — poll the GET variant for its outcome.
pub async fn backups_restore(
    State(state): State<AppState>,
    Path((id, backend, backup_id)): Path<(String, String, String)>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let instance = state
        .instance(&id)
        .ok_or_else(|| ApiError::InstanceNotFound(id))?;
    path_segment(&backend)?;
    path_segment(&backup_id)?;
    let restored = instance.client.backup_restore(&backend, &backup_id).await?;
    Ok((StatusCode::ACCEPTED, Json(restored)))
}

/// `GET /api/v1/instances/{id}/backups/{backend}/{backup_id}/restore` — restore job status.
pub async fn backups_restore_status(
    State(state): State<AppState>,
    Path((id, backend, backup_id)): Path<(String, String, String)>,
) -> Result<Json<Value>, ApiError> {
    let instance = state
        .instance(&id)
        .ok_or_else(|| ApiError::InstanceNotFound(id))?;
    path_segment(&backend)?;
    path_segment(&backup_id)?;
    Ok(Json(
        instance
            .client
            .backup_restore_status(&backend, &backup_id)
            .await?,
    ))
}

/// `GET /api/v1/instances/{id}/metrics` — a live snapshot of selected
/// Prometheus series from Weaviate's metrics endpoint.
///
/// The URL comes from the instance's `metrics_url` config, falling back to
/// the base host on Weaviate's default metrics port (`host:2112/metrics`).
/// An unreachable endpoint degrades to `supported: false` instead of an
/// error — metrics are optional (`PROMETHEUS_MONITORING_ENABLED`).
pub async fn metrics(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let instance = state
        .instance(&id)
        .ok_or_else(|| ApiError::InstanceNotFound(id))?;
    let Some(url) = instance
        .metrics_url
        .clone()
        .or_else(|| instance.client.derived_metrics_url())
    else {
        return Ok(Json(json!({
            "supported": false,
            "reason": "no metrics URL could be derived for this instance — set metrics_url",
        })));
    };

    match instance.client.fetch_text(&url).await {
        Ok(text) => {
            let snapshot = weft_weaviate::metrics::parse_snapshot(&text);
            let mut body = serde_json::to_value(snapshot).unwrap_or_else(|_| json!({}));
            body["supported"] = json!(true);
            Ok(Json(body))
        }
        Err(e) => Ok(Json(json!({
            "supported": false,
            "reason": format!(
                "metrics endpoint not reachable ({e}) — enable PROMETHEUS_MONITORING_ENABLED=true on Weaviate or configure metrics_url"
            ),
        }))),
    }
}
