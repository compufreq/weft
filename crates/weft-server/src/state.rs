//! Application state: the registry of configured Weaviate instances.

use dashmap::DashMap;
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
}

impl AppState {
    /// Build the registry from configuration.
    pub fn from_config(config: &Config) -> Result<Self, weft_weaviate::Error> {
        let state = Self::default();
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
