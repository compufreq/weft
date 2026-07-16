//! `weft-core` — shared configuration and domain types for Weft.

pub mod config;
pub mod diff;

pub use config::{Config, InstanceConfig};
pub use diff::{diff_schemas, DiffEntry};
