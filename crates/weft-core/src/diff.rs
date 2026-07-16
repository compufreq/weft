//! Structural diff of two Weaviate schemas.
//!
//! Works on raw [`serde_json::Value`] schemas (the shape of `GET /v1/schema`)
//! so it stays forward-compatible: any class-level or property-level field —
//! including ones Weft doesn't know about — is compared generically.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

/// One difference between the left and right schema.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum DiffEntry {
    /// Class exists on the right but not the left.
    ClassAdded {
        class: String,
    },
    /// Class exists on the left but not the right.
    ClassRemoved {
        class: String,
    },
    /// A class-level field differs (e.g. `vectorizer`, `multiTenancyConfig`).
    FieldChanged {
        class: String,
        field: String,
        left: Value,
        right: Value,
    },
    PropertyAdded {
        class: String,
        property: String,
    },
    PropertyRemoved {
        class: String,
        property: String,
    },
    /// A field of a property differs (e.g. `dataType`, `indexFilterable`).
    PropertyFieldChanged {
        class: String,
        property: String,
        field: String,
        left: Value,
        right: Value,
    },
}

fn classes_by_name(schema: &Value) -> BTreeMap<String, &Value> {
    schema["classes"]
        .as_array()
        .map(|classes| {
            classes
                .iter()
                .filter_map(|c| c["class"].as_str().map(|name| (name.to_string(), c)))
                .collect()
        })
        .unwrap_or_default()
}

fn properties_by_name(class: &Value) -> BTreeMap<String, &Value> {
    class["properties"]
        .as_array()
        .map(|props| {
            props
                .iter()
                .filter_map(|p| p["name"].as_str().map(|name| (name.to_string(), p)))
                .collect()
        })
        .unwrap_or_default()
}

/// Union of the keys of two JSON objects (empty for non-objects).
fn key_union<'a>(a: &'a Value, b: &'a Value) -> Vec<&'a str> {
    let mut keys: Vec<&str> = Vec::new();
    for v in [a, b] {
        if let Some(map) = v.as_object() {
            for k in map.keys() {
                if !keys.contains(&k.as_str()) {
                    keys.push(k);
                }
            }
        }
    }
    keys.sort_unstable();
    keys
}

/// Compute the differences between `left` and `right` schema documents.
///
/// Entries are ordered: class-level changes first (alphabetical by class),
/// each followed by its property-level changes.
pub fn diff_schemas(left: &Value, right: &Value) -> Vec<DiffEntry> {
    let left_classes = classes_by_name(left);
    let right_classes = classes_by_name(right);
    let mut entries = Vec::new();

    for name in right_classes.keys() {
        if !left_classes.contains_key(name) {
            entries.push(DiffEntry::ClassAdded {
                class: name.clone(),
            });
        }
    }
    for name in left_classes.keys() {
        if !right_classes.contains_key(name) {
            entries.push(DiffEntry::ClassRemoved {
                class: name.clone(),
            });
        }
    }

    for (name, lc) in &left_classes {
        let Some(rc) = right_classes.get(name) else {
            continue;
        };

        // Class-level fields, compared generically (properties handled below).
        for field in key_union(lc, rc) {
            if field == "properties" || field == "class" {
                continue;
            }
            let (lv, rv) = (&lc[field], &rc[field]);
            if lv != rv {
                entries.push(DiffEntry::FieldChanged {
                    class: name.clone(),
                    field: field.to_string(),
                    left: lv.clone(),
                    right: rv.clone(),
                });
            }
        }

        // Properties by name.
        let lprops = properties_by_name(lc);
        let rprops = properties_by_name(rc);
        for prop in rprops.keys() {
            if !lprops.contains_key(prop) {
                entries.push(DiffEntry::PropertyAdded {
                    class: name.clone(),
                    property: prop.clone(),
                });
            }
        }
        for prop in lprops.keys() {
            if !rprops.contains_key(prop) {
                entries.push(DiffEntry::PropertyRemoved {
                    class: name.clone(),
                    property: prop.clone(),
                });
            }
        }
        for (prop, lp) in &lprops {
            let Some(rp) = rprops.get(prop) else { continue };
            for field in key_union(lp, rp) {
                if field == "name" {
                    continue;
                }
                let (lv, rv) = (&lp[field], &rp[field]);
                if lv != rv {
                    entries.push(DiffEntry::PropertyFieldChanged {
                        class: name.clone(),
                        property: prop.clone(),
                        field: field.to_string(),
                        left: lv.clone(),
                        right: rv.clone(),
                    });
                }
            }
        }
    }

    entries
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn schema(classes: Value) -> Value {
        json!({ "classes": classes })
    }

    #[test]
    fn identical_schemas_have_no_diff() {
        let s = schema(json!([{ "class": "A", "vectorizer": "none", "properties": [] }]));
        assert!(diff_schemas(&s, &s).is_empty());
    }

    #[test]
    fn detects_added_and_removed_classes() {
        let left = schema(json!([{ "class": "A" }, { "class": "B" }]));
        let right = schema(json!([{ "class": "B" }, { "class": "C" }]));
        let d = diff_schemas(&left, &right);
        assert!(d.contains(&DiffEntry::ClassAdded { class: "C".into() }));
        assert!(d.contains(&DiffEntry::ClassRemoved { class: "A".into() }));
        assert_eq!(d.len(), 2);
    }

    #[test]
    fn detects_class_field_change_including_unknown_fields() {
        let left = schema(json!([{ "class": "A", "vectorizer": "none", "futureKnob": 1 }]));
        let right =
            schema(json!([{ "class": "A", "vectorizer": "text2vec-openai", "futureKnob": 2 }]));
        let d = diff_schemas(&left, &right);
        assert_eq!(d.len(), 2);
        assert!(matches!(&d[0], DiffEntry::FieldChanged { field, .. } if field == "futureKnob"));
        assert!(matches!(&d[1], DiffEntry::FieldChanged { field, .. } if field == "vectorizer"));
    }

    #[test]
    fn detects_property_changes() {
        let left = schema(json!([{ "class": "A", "properties": [
            { "name": "title", "dataType": ["text"] },
            { "name": "old", "dataType": ["int"] }
        ]}]));
        let right = schema(json!([{ "class": "A", "properties": [
            { "name": "title", "dataType": ["string"] },
            { "name": "fresh", "dataType": ["int"] }
        ]}]));
        let d = diff_schemas(&left, &right);
        assert!(d.contains(&DiffEntry::PropertyAdded {
            class: "A".into(),
            property: "fresh".into()
        }));
        assert!(d.contains(&DiffEntry::PropertyRemoved {
            class: "A".into(),
            property: "old".into()
        }));
        assert!(d.iter().any(|e| matches!(e,
            DiffEntry::PropertyFieldChanged { property, field, .. }
                if property == "title" && field == "dataType")));
    }

    #[test]
    fn missing_field_on_one_side_is_a_change_against_null() {
        let left = schema(json!([{ "class": "A" }]));
        let right = schema(json!([{ "class": "A", "description": "added later" }]));
        let d = diff_schemas(&left, &right);
        assert_eq!(d.len(), 1);
        assert!(matches!(&d[0], DiffEntry::FieldChanged { field, left, .. }
            if field == "description" && left.is_null()));
    }

    #[test]
    fn empty_or_malformed_schemas_do_not_panic() {
        assert!(diff_schemas(&json!({}), &json!({})).is_empty());
        assert!(diff_schemas(&json!(null), &json!({ "classes": "not-an-array" })).is_empty());
    }
}
