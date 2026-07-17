//! `weft-weaviate` — a minimal, from-scratch Rust client for the Weaviate
//! REST/GraphQL HTTP API.
//!
//! Existing Rust clients for Weaviate are either unmaintained or experimental,
//! so Weft owns this surface. The design goals are:
//!
//! - **Minimal surface**: only the endpoints Weft actually uses.
//! - **Version tolerant**: unknown JSON fields are preserved via
//!   [`serde_json::Value`] catch-alls so newer Weaviate releases don't break
//!   deserialization.
//! - **Loud drift detection**: every endpoint is covered by wiremock contract
//!   tests, so a Weaviate API change breaks CI instead of production.

mod client;
mod error;
pub mod graphql;
pub mod metrics;
pub mod types;

pub use client::{ObjectsQuery, WeaviateClient};
pub use error::Error;
