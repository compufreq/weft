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
            ApiError::InvalidInput(_) => (StatusCode::UNPROCESSABLE_ENTITY, "invalid_input"),
            ApiError::Weaviate(weft_weaviate::Error::Status { status, .. }) => (
                // Pass through auth errors; everything else is an upstream failure.
                if status.as_u16() == 401 || status.as_u16() == 403 {
                    StatusCode::from_u16(status.as_u16()).unwrap_or(StatusCode::BAD_GATEWAY)
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
