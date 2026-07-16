//! Read-only RBAC visibility (roles, users, assignments).
//!
//! Weaviate's RBAC endpoints answer 4xx/5xx when RBAC is disabled (e.g.
//! anonymous-access dev instances) or when Weft's key lacks permission —
//! both degrade to `enabled: false` with a reason instead of an error.
//! RBAC *management* stays out of scope pre-1.0.

use crate::error::ApiError;
use crate::AppState;
use axum::extract::{Path, State};
use axum::Json;
use serde_json::{json, Value};

/// Per-request cap on user-role assignment lookups (bounded fan-out).
const MAX_USER_ROLE_LOOKUPS: usize = 50;

/// `GET /api/v1/instances/{id}/rbac`
pub async fn overview(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let instance = state
        .instance(&id)
        .ok_or_else(|| ApiError::InstanceNotFound(id))?;

    // Roles are the cheapest probe for "is RBAC on and can we see it".
    let roles = match instance.client.authz_roles().await {
        Ok(roles) => roles,
        Err(weft_weaviate::Error::Status { status, .. }) => {
            let reason = if status.as_u16() == 401 || status.as_u16() == 403 {
                "Weft's credentials cannot read RBAC data (needs a key with authz read permissions)"
            } else {
                "RBAC is not enabled on this instance (AUTHORIZATION_RBAC_ENABLED)"
            };
            return Ok(Json(
                json!({ "enabled": false, "reason": reason, "roles": [], "users": [] }),
            ));
        }
        Err(e) => return Err(e.into()),
    };
    let roles = roles.as_array().cloned().unwrap_or_default();

    // Anonymous-access instances answer 200 with an empty list; a genuinely
    // RBAC-enabled cluster always exposes at least its predefined roles.
    if roles.is_empty() {
        return Ok(Json(json!({
            "enabled": false,
            "reason": "no roles visible — RBAC is likely not enabled on this instance (AUTHORIZATION_RBAC_ENABLED)",
            "roles": [],
            "users": [],
        })));
    }

    // Users (and their role assignments) are best-effort extras: some
    // Weaviate versions/keys expose roles but not the users API.
    let mut users: Vec<Value> = Vec::new();
    let mut users_truncated = false;
    if let Ok(raw_users) = instance.client.db_users().await {
        let all = raw_users.as_array().cloned().unwrap_or_default();
        users_truncated = all.len() > MAX_USER_ROLE_LOOKUPS;
        for user in all.into_iter().take(MAX_USER_ROLE_LOOKUPS) {
            let user_id = user["userId"]
                .as_str()
                .or_else(|| user["user_id"].as_str())
                .unwrap_or_default()
                .to_string();
            let assigned: Vec<String> = match instance.client.user_roles(&user_id).await {
                Ok(r) => r
                    .as_array()
                    .map(|roles| {
                        roles
                            .iter()
                            .filter_map(|role| role["name"].as_str().map(String::from))
                            .collect()
                    })
                    .unwrap_or_default(),
                Err(_) => Vec::new(),
            };
            users.push(json!({
                "user_id": user_id,
                "active": user["active"],
                "roles": assigned,
            }));
        }
    }

    Ok(Json(json!({
        "enabled": true,
        "roles": roles,
        "users": users,
        "users_truncated": users_truncated,
    })))
}
