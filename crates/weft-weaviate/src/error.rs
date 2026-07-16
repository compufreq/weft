//! Client error type.

/// Errors returned by [`crate::WeaviateClient`].
#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// Transport-level failure (connection refused, timeout, TLS, ...).
    #[error("request to Weaviate failed: {0}")]
    Http(#[from] reqwest::Error),

    /// Weaviate answered with a non-success status code.
    #[error("Weaviate returned {status}: {body}")]
    Status {
        status: reqwest::StatusCode,
        body: String,
    },

    /// The response body could not be decoded into the expected shape.
    #[error("failed to decode Weaviate response: {0}")]
    Decode(#[from] serde_json::Error),

    /// The configured base URL is invalid.
    #[error("invalid Weaviate base URL: {0}")]
    BaseUrl(#[from] url::ParseError),
}
