//! Weft configuration.
//!
//! Layered via [figment]: built-in defaults < `weft.yaml` < `WEFT_*` environment
//! variables. The zero-config default registers a single instance called `local`
//! pointing at `$WEAVIATE_URL` (or `http://weaviate:8080` if unset), so
//! `docker run` next to a Weaviate container works with no configuration at all.

use figment::providers::{Env, Format, Serialized, Yaml};
use figment::Figment;
use secrecy::SecretString;
use serde::{Deserialize, Serialize};

/// A single Weaviate instance Weft knows about.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstanceConfig {
    /// Stable identifier used in API paths (`/api/v1/instances/{id}/...`).
    pub id: String,
    /// Human-friendly display name.
    pub name: String,
    /// Base URL of the Weaviate HTTP API, e.g. `http://weaviate:8080`.
    pub url: String,
    /// Optional API key. Redacted in every API response and never logged.
    #[serde(default, skip_serializing)]
    pub api_key: Option<SecretString>,
    /// Optional Prometheus metrics URL. When unset, Weft tries the base
    /// host on Weaviate's default metrics port (`http://host:2112/metrics`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metrics_url: Option<String>,
}

/// Top-level Weft configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    /// Address the HTTP server binds to.
    pub listen: String,
    /// Configured Weaviate instances.
    pub instances: Vec<InstanceConfig>,
    /// When set (`WEFT_AUTH_TOKEN`), every `/api` request must present this
    /// token (Bearer header or session cookie). Never serialized.
    #[serde(default, skip_serializing)]
    pub auth_token: Option<SecretString>,
    /// When true (`WEFT_READ_ONLY`), mutating API requests are rejected.
    #[serde(default)]
    pub read_only: bool,
    /// When set (`WEFT_INSTANCES_FILE`), instances added at runtime are
    /// persisted to this JSON file (mount a volume) and reloaded on start.
    #[serde(default)]
    pub instances_file: Option<String>,
}

impl Default for Config {
    fn default() -> Self {
        let url = std::env::var("WEAVIATE_URL").unwrap_or_else(|_| "http://weaviate:8080".into());
        Self {
            listen: "0.0.0.0:8080".into(),
            instances: vec![InstanceConfig {
                id: "local".into(),
                name: "Local Weaviate".into(),
                url,
                api_key: std::env::var("WEAVIATE_API_KEY")
                    .ok()
                    .map(SecretString::from),
                metrics_url: None,
            }],
            auth_token: None,
            read_only: false,
            instances_file: None,
        }
    }
}

#[derive(Debug, thiserror::Error)]
#[error("invalid configuration: {0}")]
pub struct ConfigError(Box<figment::Error>);

impl From<figment::Error> for ConfigError {
    fn from(e: figment::Error) -> Self {
        Self(Box::new(e))
    }
}

impl Config {
    /// Load configuration: defaults < `weft.yaml` < `WEFT_*` env vars.
    pub fn load() -> Result<Self, ConfigError> {
        Ok(Figment::from(Serialized::defaults(Config::default()))
            .merge(Yaml::file("weft.yaml"))
            .merge(Env::prefixed("WEFT_").split("__"))
            .extract()?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_config_has_local_instance() {
        let cfg = Config::default();
        assert_eq!(cfg.listen, "0.0.0.0:8080");
        assert_eq!(cfg.instances.len(), 1);
        assert_eq!(cfg.instances[0].id, "local");
    }

    #[test]
    fn api_key_is_never_serialized() {
        let cfg = Config {
            listen: "0.0.0.0:8080".into(),
            instances: vec![InstanceConfig {
                id: "x".into(),
                name: "X".into(),
                url: "http://w:8080".into(),
                api_key: Some(SecretString::from("super-secret")),
                metrics_url: None,
            }],
            auth_token: Some(SecretString::from("guard-secret")),
            read_only: false,
            instances_file: None,
        };
        let json = serde_json::to_string(&cfg).unwrap();
        assert!(!json.contains("super-secret"));
        assert!(
            !json.contains("guard-secret"),
            "auth token never serialized"
        );
    }
}
