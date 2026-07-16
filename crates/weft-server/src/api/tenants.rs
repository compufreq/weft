//! Tenant management endpoints (multi-tenant collections).

use crate::error::ApiError;
use crate::AppState;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::Json;
use futures_util::StreamExt;
use serde::Deserialize;
use serde_json::{json, Value};
use weft_weaviate::graphql;

/// How many per-tenant count queries run concurrently.
const COUNT_CONCURRENCY: usize = 8;

#[derive(Debug, Deserialize)]
pub struct TenantsParams {
    /// When true, fetch object counts for HOT tenants (bounded fan-out).
    #[serde(default)]
    pub counts: bool,
}

/// `GET /api/v1/instances/{id}/collections/{class}/tenants`
pub async fn list(
    State(state): State<AppState>,
    Path((id, class)): Path<(String, String)>,
    Query(params): Query<TenantsParams>,
) -> Result<Json<Value>, ApiError> {
    let instance = state
        .instance(&id)
        .ok_or_else(|| ApiError::InstanceNotFound(id))?;

    let raw = instance.client.tenants(&class).await?;
    let mut tenants: Vec<Value> = raw.as_array().cloned().unwrap_or_default();
    tenants.sort_by(|a, b| a["name"].as_str().cmp(&b["name"].as_str()));

    if params.counts {
        // Count only HOT tenants — COLD tenants can't be queried.
        // Owned job list first (async blocks must not borrow `tenants`).
        let jobs: Vec<(String, bool)> = tenants
            .iter()
            .filter_map(|t| {
                Some((
                    t["name"].as_str()?.to_string(),
                    t["activityStatus"].as_str() == Some("HOT"),
                ))
            })
            .collect();

        let counts: Vec<(String, Option<i64>)> =
            futures_util::stream::iter(jobs.into_iter().map(|(name, hot)| {
                let client = instance.client.clone();
                let class = class.clone();
                async move {
                    if !hot {
                        return (name, None);
                    }
                    let count = match graphql::build_count(&class, Some(&name)) {
                        Ok(q) => client.graphql(&q).await.ok().and_then(|env| {
                            env["data"]["Aggregate"][&class][0]["meta"]["count"].as_i64()
                        }),
                        Err(_) => None,
                    };
                    (name, count)
                }
            }))
            .buffer_unordered(COUNT_CONCURRENCY)
            .collect()
            .await;

        for tenant in &mut tenants {
            if let Some(name) = tenant["name"].as_str() {
                if let Some((_, count)) = counts.iter().find(|(n, _)| n == name) {
                    tenant["count"] = count.map(Value::from).unwrap_or(Value::Null);
                }
            }
        }
    }

    Ok(Json(json!({ "tenants": tenants })))
}

#[derive(Debug, Deserialize)]
pub struct CreateTenants {
    pub names: Vec<String>,
}

/// `POST /api/v1/instances/{id}/collections/{class}/tenants`
pub async fn create(
    State(state): State<AppState>,
    Path((id, class)): Path<(String, String)>,
    Json(body): Json<CreateTenants>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    if body.names.is_empty() || body.names.iter().any(|n| n.trim().is_empty()) {
        return Err(ApiError::InvalidInput(
            "tenant names must be non-empty".into(),
        ));
    }
    let instance = state
        .instance(&id)
        .ok_or_else(|| ApiError::InstanceNotFound(id))?;
    let names: Vec<&str> = body.names.iter().map(String::as_str).collect();
    let created = instance.client.create_tenants(&class, &names).await?;
    Ok((StatusCode::CREATED, Json(created)))
}

#[derive(Debug, Deserialize)]
pub struct TenantStatusUpdate {
    pub name: String,
    /// `HOT` (active) or `COLD` (deactivated).
    pub status: String,
}

#[derive(Debug, Deserialize)]
pub struct UpdateTenants {
    pub updates: Vec<TenantStatusUpdate>,
}

/// `PUT /api/v1/instances/{id}/collections/{class}/tenants`
pub async fn update(
    State(state): State<AppState>,
    Path((id, class)): Path<(String, String)>,
    Json(body): Json<UpdateTenants>,
) -> Result<Json<Value>, ApiError> {
    if body.updates.is_empty() {
        return Err(ApiError::InvalidInput("updates must not be empty".into()));
    }
    for u in &body.updates {
        if !matches!(u.status.as_str(), "HOT" | "COLD") {
            return Err(ApiError::InvalidInput(format!(
                "status must be HOT or COLD, got `{}`",
                u.status
            )));
        }
    }
    let instance = state
        .instance(&id)
        .ok_or_else(|| ApiError::InstanceNotFound(id))?;
    let payload: Vec<Value> = body
        .updates
        .iter()
        .map(|u| json!({ "name": u.name, "activityStatus": u.status }))
        .collect();
    let updated = instance.client.update_tenants(&class, &payload).await?;
    Ok(Json(updated))
}
