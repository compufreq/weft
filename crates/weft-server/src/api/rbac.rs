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
                // "db_user" (dynamic) or "db_env_user" (env API key).
                "user_type": user["dbUserType"],
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

// ---------- RBAC management (v1.3) ----------
//
// All handlers below are mutations: POSTs are blocked by the read-only
// guard's default rule, the DELETE by method. Role names are validated
// before they land in a URL path.

use serde::Deserialize;

/// Validate a role name for safe URL-path interpolation.
fn valid_role_name(name: &str) -> Result<(), ApiError> {
    let ok = !name.is_empty()
        && name.len() <= 128
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-' || c == '.');
    if ok {
        Ok(())
    } else {
        Err(ApiError::InvalidInput(format!(
            "`{name}` is not a valid role name (alphanumeric, `_`, `-`, `.`)"
        )))
    }
}

/// Validate a user id for safe URL-path interpolation.
fn valid_user_id(id: &str) -> Result<(), ApiError> {
    let ok = !id.is_empty()
        && id.len() <= 128
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-' || c == '.' || c == '@');
    if ok {
        Ok(())
    } else {
        Err(ApiError::InvalidInput(format!(
            "`{id}` is not a valid user id"
        )))
    }
}

fn permissions_array(permissions: &Value) -> Result<(), ApiError> {
    if permissions.is_array() {
        Ok(())
    } else {
        Err(ApiError::InvalidInput(
            "`permissions` must be an array of permission objects".into(),
        ))
    }
}

#[derive(Debug, Deserialize)]
pub struct CreateRole {
    pub name: String,
    /// Weaviate permission objects, passed through verbatim
    /// (e.g. `{ "action": "read_data", "data": { "collection": "*" } }`).
    #[serde(default)]
    pub permissions: Value,
}

/// `POST /api/v1/instances/{id}/rbac/roles` — create a role.
pub async fn create_role(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<CreateRole>,
) -> Result<(axum::http::StatusCode, Json<Value>), ApiError> {
    let instance = state
        .instance(&id)
        .ok_or_else(|| ApiError::InstanceNotFound(id))?;
    valid_role_name(&body.name)?;
    let permissions = if body.permissions.is_null() {
        json!([])
    } else {
        body.permissions
    };
    permissions_array(&permissions)?;
    instance
        .client
        .create_role(&body.name, &permissions)
        .await?;
    Ok((
        axum::http::StatusCode::CREATED,
        Json(json!({ "name": body.name })),
    ))
}

/// `DELETE /api/v1/instances/{id}/rbac/roles/{role}` — delete a role.
pub async fn delete_role(
    State(state): State<AppState>,
    Path((id, role)): Path<(String, String)>,
) -> Result<axum::http::StatusCode, ApiError> {
    let instance = state
        .instance(&id)
        .ok_or_else(|| ApiError::InstanceNotFound(id))?;
    valid_role_name(&role)?;
    instance.client.delete_role(&role).await?;
    Ok(axum::http::StatusCode::NO_CONTENT)
}

#[derive(Debug, Deserialize)]
pub struct Permissions {
    pub permissions: Value,
}

/// `POST /api/v1/instances/{id}/rbac/roles/{role}/add-permissions`
pub async fn add_permissions(
    State(state): State<AppState>,
    Path((id, role)): Path<(String, String)>,
    Json(body): Json<Permissions>,
) -> Result<axum::http::StatusCode, ApiError> {
    let instance = state
        .instance(&id)
        .ok_or_else(|| ApiError::InstanceNotFound(id))?;
    valid_role_name(&role)?;
    permissions_array(&body.permissions)?;
    instance
        .client
        .add_role_permissions(&role, &body.permissions)
        .await?;
    Ok(axum::http::StatusCode::NO_CONTENT)
}

/// `POST /api/v1/instances/{id}/rbac/roles/{role}/remove-permissions`
pub async fn remove_permissions(
    State(state): State<AppState>,
    Path((id, role)): Path<(String, String)>,
    Json(body): Json<Permissions>,
) -> Result<axum::http::StatusCode, ApiError> {
    let instance = state
        .instance(&id)
        .ok_or_else(|| ApiError::InstanceNotFound(id))?;
    valid_role_name(&role)?;
    permissions_array(&body.permissions)?;
    instance
        .client
        .remove_role_permissions(&role, &body.permissions)
        .await?;
    Ok(axum::http::StatusCode::NO_CONTENT)
}

#[derive(Debug, Deserialize)]
pub struct UserRoles {
    pub roles: Vec<String>,
    /// Weaviate user type (`db` for dynamic users, `db_env_user` for
    /// env-configured API-key users). Passed through when set.
    #[serde(default)]
    pub user_type: Option<String>,
}

/// `POST /api/v1/instances/{id}/rbac/users/{user_id}/assign`
pub async fn assign_roles(
    State(state): State<AppState>,
    Path((id, user_id)): Path<(String, String)>,
    Json(body): Json<UserRoles>,
) -> Result<axum::http::StatusCode, ApiError> {
    let instance = state
        .instance(&id)
        .ok_or_else(|| ApiError::InstanceNotFound(id))?;
    valid_user_id(&user_id)?;
    for role in &body.roles {
        valid_role_name(role)?;
    }
    if body.roles.is_empty() {
        return Err(ApiError::InvalidInput("`roles` must not be empty".into()));
    }
    instance
        .client
        .assign_user_roles(&user_id, &body.roles, body.user_type.as_deref())
        .await?;
    Ok(axum::http::StatusCode::NO_CONTENT)
}

/// `POST /api/v1/instances/{id}/rbac/users/{user_id}/revoke`
pub async fn revoke_roles(
    State(state): State<AppState>,
    Path((id, user_id)): Path<(String, String)>,
    Json(body): Json<UserRoles>,
) -> Result<axum::http::StatusCode, ApiError> {
    let instance = state
        .instance(&id)
        .ok_or_else(|| ApiError::InstanceNotFound(id))?;
    valid_user_id(&user_id)?;
    for role in &body.roles {
        valid_role_name(role)?;
    }
    if body.roles.is_empty() {
        return Err(ApiError::InvalidInput("`roles` must not be empty".into()));
    }
    instance
        .client
        .revoke_user_roles(&user_id, &body.roles, body.user_type.as_deref())
        .await?;
    Ok(axum::http::StatusCode::NO_CONTENT)
}
