//! Typed subsets of Weaviate API responses.
//!
//! Only the fields Weft renders are typed; everything else is preserved in
//! `extra` so we stay forward-compatible with newer Weaviate releases.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

/// Response of `GET /v1/meta`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Meta {
    /// Weaviate server version, e.g. `"1.37.2"`.
    pub version: String,
    #[serde(default)]
    pub hostname: Option<String>,
    /// Enabled modules keyed by module name.
    #[serde(default)]
    pub modules: Value,
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}

/// Response of `GET /v1/schema`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Schema {
    #[serde(default)]
    pub classes: Vec<Class>,
}

/// A Weaviate collection (historically "class").
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Class {
    /// Collection name.
    pub class: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub vectorizer: Option<String>,
    #[serde(default)]
    pub vector_index_type: Option<String>,
    #[serde(default)]
    pub multi_tenancy_config: Option<MultiTenancyConfig>,
    #[serde(default)]
    pub properties: Vec<Property>,
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MultiTenancyConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}

/// A property of a collection.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Property {
    pub name: String,
    #[serde(default)]
    pub data_type: Vec<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A real-shaped 1.37.x schema payload must decode, and unknown fields
    /// must be preserved rather than rejected.
    #[test]
    fn schema_decodes_and_preserves_unknown_fields() {
        let json = serde_json::json!({
            "classes": [{
                "class": "Article",
                "description": "News articles",
                "vectorizer": "none",
                "vectorIndexType": "hnsw",
                "multiTenancyConfig": { "enabled": false, "autoTenantCreation": true },
                "properties": [
                    { "name": "title", "dataType": ["text"], "indexFilterable": true }
                ],
                "replicationConfig": { "factor": 1 },
                "someFutureField": { "x": 1 }
            }]
        });
        let schema: Schema = serde_json::from_value(json).unwrap();
        let class = &schema.classes[0];
        assert_eq!(class.class, "Article");
        assert_eq!(class.vectorizer.as_deref(), Some("none"));
        assert!(!class.multi_tenancy_config.as_ref().unwrap().enabled);
        assert_eq!(class.properties[0].data_type, vec!["text"]);
        assert!(class.extra.contains_key("someFutureField"));
        assert!(class.extra.contains_key("replicationConfig"));
        assert!(class.properties[0].extra.contains_key("indexFilterable"));
    }
}
