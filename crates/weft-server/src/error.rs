//! API error type with JSON responses.

use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::json;

/// Errors surfaced by API handlers.
#[derive(Debug, thiserror::Error)]
pub enum ApiError {
    #[error("instance `{0}` not found")]
    InstanceNotFound(String),

    #[error("instance `{0}` already exists")]
    InstanceExists(String),

    #[error("collection `{0}` not found")]
    CollectionNotFound(String),

    #[error("{0}")]
    InvalidInput(String),

    #[error(transparent)]
    Weaviate(#[from] weft_weaviate::Error),
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, code) = match &self {
            ApiError::InstanceNotFound(_) => (StatusCode::NOT_FOUND, "instance_not_found"),
            ApiError::InstanceExists(_) => (StatusCode::CONFLICT, "instance_exists"),
            ApiError::CollectionNotFound(_) => (StatusCode::NOT_FOUND, "collection_not_found"),
            ApiError::InvalidInput(_) => (StatusCode::UNPROCESSABLE_ENTITY, "invalid_input"),
            ApiError::Weaviate(weft_weaviate::Error::Status { status, .. }) => (
                // Client errors from Weaviate (bad class, missing tenant, auth)
                // are the caller's problem — pass 4xx through as 422/401/403.
                if status.as_u16() == 401 || status.as_u16() == 403 {
                    StatusCode::from_u16(status.as_u16()).unwrap_or(StatusCode::BAD_GATEWAY)
                } else if status.is_client_error() {
                    StatusCode::UNPROCESSABLE_ENTITY
                } else {
                    StatusCode::BAD_GATEWAY
                },
                "weaviate_error",
            ),
            ApiError::Weaviate(_) => (StatusCode::BAD_GATEWAY, "weaviate_unreachable"),
        };
        // The Display impl never includes credentials; weft-weaviate redacts them.
        let body = Json(json!({ "error": { "code": code, "message": self.to_string() } }));
        (status, body).into_response()
    }
}
