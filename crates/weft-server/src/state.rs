//! Application state: the registry of configured Weaviate instances.

use dashmap::DashMap;
use secrecy::SecretString;
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
}

/// Shared application state. Cheap to clone.
#[derive(Debug, Clone, Default)]
pub struct AppState {
    instances: Arc<DashMap<String, Arc<Instance>>>,
    /// When set, the API guard requires this token (Bearer or cookie).
    pub auth_token: Option<SecretString>,
    /// When true, mutating API requests are rejected.
    pub read_only: bool,
}

impl AppState {
    /// Build the registry from configuration.
    pub fn from_config(config: &Config) -> Result<Self, weft_weaviate::Error> {
        let state = Self {
            auth_token: config.auth_token.clone(),
            read_only: config.read_only,
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
                }),
            );
        }
        Ok(state)
    }

    /// Look up an instance by id.
    pub fn instance(&self, id: &str) -> Option<Arc<Instance>> {
        self.instances.get(id).map(|e| Arc::clone(e.value()))
    }

    /// Register an instance at runtime. Returns `None` if the id is taken.
    ///
    /// Runtime instances live in memory only (the backend stays stateless);
    /// they're gone after a restart. Persistent instances belong in
    /// `weft.yaml` / `WEFT_INSTANCES`.
    pub fn add_instance(&self, instance: Instance) -> Option<Arc<Instance>> {
        use dashmap::mapref::entry::Entry;
        match self.instances.entry(instance.id.clone()) {
            Entry::Occupied(_) => None,
            Entry::Vacant(v) => {
                let arc = Arc::new(instance);
                v.insert(Arc::clone(&arc));
                Some(arc)
            }
        }
    }

    /// Remove an instance by id. Returns true if it existed.
    pub fn remove_instance(&self, id: &str) -> bool {
        self.instances.remove(id).is_some()
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
}
