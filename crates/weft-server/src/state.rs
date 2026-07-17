//! Application state: the registry of configured Weaviate instances.

use crate::api::auth::SessionRateLimiter;
use crate::auth_backend::{AuthBackend, MutationHook, SharedTokenBackend};
use dashmap::{DashMap, DashSet};
use secrecy::{ExposeSecret, SecretString};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use weft_core::Config;
use weft_weaviate::WeaviateClient;

/// One registered Weaviate instance and its client.
#[derive(Debug)]
pub struct Instance {
    pub id: String,
    pub name: String,
    /// Display URL (never contains credentials).
    pub url: String,
    pub client: WeaviateClient,
    /// Kept only so runtime instances can be persisted across restarts.
    /// Redacted in every API response and never logged.
    pub api_key: Option<SecretString>,
    /// Optional explicit Prometheus metrics URL (config or runtime input).
    /// When `None`, the metrics endpoint derives host:2112/metrics.
    pub metrics_url: Option<String>,
}

/// On-disk shape of one persisted runtime instance.
///
/// The API key is stored in plain text — the file lives on an
/// operator-controlled volume, same trust level as `weft.yaml`.
#[derive(Debug, Serialize, Deserialize)]
struct PersistedInstance {
    id: String,
    name: String,
    url: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    api_key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    metrics_url: Option<String>,
}

/// Shared application state. Cheap to clone.
#[derive(Clone)]
pub struct AppState {
    instances: Arc<DashMap<String, Arc<Instance>>>,
    /// Ids added at runtime (as opposed to config) — these are what
    /// `instances_file` persistence covers.
    runtime_ids: Arc<DashSet<String>>,
    /// When set, runtime instances survive restarts via this JSON file.
    instances_file: Option<Arc<PathBuf>>,
    /// When set, the API guard requires this token (Bearer or cookie).
    /// Kept alongside `auth_backend` because the cookie-session exchange
    /// (`POST /api/v1/auth/session`) is shared-token-specific.
    pub auth_token: Option<SecretString>,
    /// Verifies presented credentials; the built-in shared-token backend
    /// by default. Extension seam for alternative auth (v1.4+).
    pub auth_backend: Arc<dyn AuthBackend>,
    /// Called after every successful mutating API request. `None` = no-op.
    /// Extension seam for audit sinks (v1.4+).
    pub mutation_hook: Option<MutationHook>,
    /// When true, mutating API requests are rejected.
    pub read_only: bool,
    /// Per-IP rate limiter for `POST /api/v1/auth/session`.
    pub session_limiter: Arc<SessionRateLimiter>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            instances: Arc::default(),
            runtime_ids: Arc::default(),
            instances_file: None,
            auth_token: None,
            auth_backend: Arc::new(SharedTokenBackend::default()),
            mutation_hook: None,
            read_only: false,
            session_limiter: Arc::default(),
        }
    }
}

impl std::fmt::Debug for AppState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AppState")
            .field("instances", &self.instances.len())
            .field("auth_backend", &self.auth_backend)
            .field("mutation_hook", &self.mutation_hook.is_some())
            .field("read_only", &self.read_only)
            .finish_non_exhaustive()
    }
}

impl AppState {
    /// Build the registry from configuration, then rehydrate any persisted
    /// runtime instances.
    pub fn from_config(config: &Config) -> Result<Self, weft_weaviate::Error> {
        let state = Self {
            auth_token: config.auth_token.clone(),
            auth_backend: Arc::new(SharedTokenBackend::new(config.auth_token.clone())),
            read_only: config.read_only,
            instances_file: config
                .instances_file
                .as_ref()
                .map(|p| Arc::new(PathBuf::from(p))),
            ..Self::default()
        };
        for ic in &config.instances {
            let client = WeaviateClient::new(&ic.url, ic.api_key.clone())?;
            state.instances.insert(
                ic.id.clone(),
                Arc::new(Instance {
                    id: ic.id.clone(),
                    name: ic.name.clone(),
                    url: ic.url.clone(),
                    client,
                    api_key: ic.api_key.clone(),
                    metrics_url: ic.metrics_url.clone(),
                }),
            );
        }
        state.load_runtime_instances();
        Ok(state)
    }

    /// Rehydrate runtime instances from `instances_file` (best-effort:
    /// a corrupt or missing file must never stop the server).
    fn load_runtime_instances(&self) {
        let Some(path) = &self.instances_file else {
            return;
        };
        let raw = match std::fs::read_to_string(path.as_ref()) {
            Ok(raw) => raw,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return,
            Err(e) => {
                tracing::warn!(?path, error = %e, "could not read instances file");
                return;
            }
        };
        let persisted: Vec<PersistedInstance> = match serde_json::from_str(&raw) {
            Ok(p) => p,
            Err(e) => {
                tracing::warn!(?path, error = %e, "instances file is not valid JSON — ignoring");
                return;
            }
        };
        for p in persisted {
            if self.instances.contains_key(&p.id) {
                continue; // config wins over the persisted file
            }
            let api_key = p.api_key.map(SecretString::from);
            match WeaviateClient::new(&p.url, api_key.clone()) {
                Ok(client) => {
                    self.runtime_ids.insert(p.id.clone());
                    self.instances.insert(
                        p.id.clone(),
                        Arc::new(Instance {
                            id: p.id,
                            name: p.name,
                            url: p.url,
                            client,
                            api_key,
                            metrics_url: p.metrics_url,
                        }),
                    );
                }
                Err(e) => {
                    tracing::warn!(id = %p.id, error = %e, "skipping persisted instance with invalid url");
                }
            }
        }
    }

    /// Persist current runtime instances (atomic: temp file + rename).
    /// Best-effort — persistence failures are logged, never fatal.
    fn save_runtime_instances(&self) {
        let Some(path) = &self.instances_file else {
            return;
        };
        let persisted: Vec<PersistedInstance> = self
            .instances
            .iter()
            .filter(|e| self.runtime_ids.contains(e.key()))
            .map(|e| {
                let i = e.value();
                PersistedInstance {
                    id: i.id.clone(),
                    name: i.name.clone(),
                    url: i.url.clone(),
                    api_key: i.api_key.as_ref().map(|k| k.expose_secret().to_string()),
                    metrics_url: i.metrics_url.clone(),
                }
            })
            .collect();
        let json = match serde_json::to_string_pretty(&persisted) {
            Ok(j) => j,
            Err(e) => {
                tracing::warn!(error = %e, "could not serialize runtime instances");
                return;
            }
        };
        let tmp = path.with_extension("json.tmp");
        let result = std::fs::write(&tmp, json).and_then(|()| std::fs::rename(&tmp, path.as_ref()));
        if let Err(e) = result {
            tracing::warn!(?path, error = %e, "could not persist runtime instances");
        }
    }

    /// Look up an instance by id.
    pub fn instance(&self, id: &str) -> Option<Arc<Instance>> {
        self.instances.get(id).map(|e| Arc::clone(e.value()))
    }

    /// Register an instance at runtime. Returns `None` if the id is taken.
    ///
    /// Runtime instances persist across restarts only when `instances_file`
    /// is configured; otherwise they are in-memory and gone after a restart.
    pub fn add_instance(&self, instance: Instance) -> Option<Arc<Instance>> {
        use dashmap::mapref::entry::Entry;
        let added = match self.instances.entry(instance.id.clone()) {
            Entry::Occupied(_) => None,
            Entry::Vacant(v) => {
                let arc = Arc::new(instance);
                v.insert(Arc::clone(&arc));
                Some(arc)
            }
        };
        if let Some(arc) = &added {
            self.runtime_ids.insert(arc.id.clone());
            self.save_runtime_instances();
        }
        added
    }

    /// Remove an instance by id. Returns true if it existed.
    pub fn remove_instance(&self, id: &str) -> bool {
        let removed = self.instances.remove(id).is_some();
        if removed && self.runtime_ids.remove(id).is_some() {
            self.save_runtime_instances();
        }
        removed
    }

    /// All registered instances (stable order by id).
    pub fn instances(&self) -> Vec<Arc<Instance>> {
        let mut all: Vec<_> = self
            .instances
            .iter()
            .map(|e| Arc::clone(e.value()))
            .collect();
        all.sort_by(|a, b| a.id.cmp(&b.id));
        all
    }

    pub fn instance_count(&self) -> usize {
        self.instances.len()
    }

    /// Replace the auth backend (extension seam — the built-in shared-token
    /// backend stays the default).
    #[must_use]
    pub fn with_auth_backend(mut self, backend: Arc<dyn AuthBackend>) -> Self {
        self.auth_backend = backend;
        self
    }

    /// Install a mutation hook, called after every successful mutating API
    /// request (extension seam for audit sinks — no-op by default).
    #[must_use]
    pub fn with_mutation_hook(mut self, hook: MutationHook) -> Self {
        self.mutation_hook = Some(hook);
        self
    }
}
