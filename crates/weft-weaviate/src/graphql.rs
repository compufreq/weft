//! GraphQL `Get` query builders for Weaviate search.
//!
//! Weaviate's search surface (BM25, vector, hybrid) is GraphQL-only. Queries
//! are built as strings; every user-supplied value is JSON-encoded and every
//! identifier is validated, so injection is not possible.

use serde_json::json;

/// A search operator for a `Get` query.
#[derive(Debug, Clone)]
pub enum Search {
    /// Keyword (sparse) search.
    Bm25 { query: String },
    /// Semantic search via the collection's vectorizer.
    NearText { query: String },
    /// Raw vector similarity search.
    NearVector { vector: Vec<f64> },
    /// Fused keyword + vector search. `alpha`: 0 = pure BM25, 1 = pure vector.
    Hybrid {
        query: String,
        vector: Option<Vec<f64>>,
        alpha: Option<f64>,
    },
}

/// Errors from query building.
#[derive(Debug, thiserror::Error)]
pub enum BuildError {
    #[error("`{0}` is not a valid GraphQL identifier")]
    InvalidIdent(String),
}

/// Validate a Weaviate class/property name for safe GraphQL interpolation.
fn ident(name: &str) -> Result<&str, BuildError> {
    let ok = !name.is_empty() && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_');
    if ok {
        Ok(name)
    } else {
        Err(BuildError::InvalidIdent(name.to_string()))
    }
}

/// JSON-encode a string for embedding in GraphQL (quotes + escapes included).
fn encode_str(s: &str) -> String {
    json!(s).to_string()
}

fn encode_vec(v: &[f64]) -> String {
    json!(v).to_string()
}

impl Search {
    fn operator(&self) -> String {
        match self {
            Search::Bm25 { query } => format!("bm25: {{ query: {} }}", encode_str(query)),
            Search::NearText { query } => {
                format!("nearText: {{ concepts: [{}] }}", encode_str(query))
            }
            Search::NearVector { vector } => {
                format!("nearVector: {{ vector: {} }}", encode_vec(vector))
            }
            Search::Hybrid {
                query,
                vector,
                alpha,
            } => {
                let mut parts = vec![format!("query: {}", encode_str(query))];
                if let Some(v) = vector {
                    parts.push(format!("vector: {}", encode_vec(v)));
                }
                if let Some(a) = alpha {
                    parts.push(format!("alpha: {a}"));
                }
                format!("hybrid: {{ {} }}", parts.join(", "))
            }
        }
    }
}

/// Build a `Get` search query.
///
/// `properties` are selected verbatim (validated); `_additional` always
/// includes `id`, `score`, and `distance`.
pub fn build_get(
    class: &str,
    properties: &[String],
    search: &Search,
    limit: usize,
    tenant: Option<&str>,
) -> Result<String, BuildError> {
    let class = ident(class)?;
    let mut fields = Vec::with_capacity(properties.len() + 1);
    for p in properties {
        fields.push(ident(p)?.to_string());
    }
    fields.push("_additional { id score distance }".to_string());

    let mut args = vec![format!("limit: {limit}"), search.operator()];
    if let Some(t) = tenant {
        args.push(format!("tenant: {}", encode_str(t)));
    }

    Ok(format!(
        "{{ Get {{ {class}({args}) {{ {fields} }} }} }}",
        args = args.join(", "),
        fields = fields.join(" ")
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bm25_query_shape() {
        let q = build_get(
            "Article",
            &["title".into(), "body".into()],
            &Search::Bm25 {
                query: "hello world".into(),
            },
            10,
            None,
        )
        .unwrap();
        assert!(q.contains("Get { Article(limit: 10, bm25: { query: \"hello world\" })"));
        assert!(q.contains("title body _additional { id score distance }"));
    }

    #[test]
    fn strings_are_json_escaped() {
        let q = build_get(
            "Article",
            &[],
            &Search::Bm25 {
                query: "quote\" } inject { Get".into(),
            },
            5,
            None,
        )
        .unwrap();
        // The malicious payload stays inside a JSON string literal.
        assert!(q.contains(r#"bm25: { query: "quote\" } inject { Get" }"#));
    }

    #[test]
    fn invalid_identifiers_are_rejected() {
        let s = Search::Bm25 { query: "x".into() };
        assert!(build_get("Bad Name", &[], &s, 1, None).is_err());
        assert!(build_get("Article", &["prop-erty".into()], &s, 1, None).is_err());
        assert!(build_get("Article) { } {", &[], &s, 1, None).is_err());
    }

    #[test]
    fn near_vector_and_tenant() {
        let q = build_get(
            "Product",
            &["name".into()],
            &Search::NearVector {
                vector: vec![0.1, 0.2],
            },
            3,
            Some("acme"),
        )
        .unwrap();
        assert!(q.contains("nearVector: { vector: [0.1,0.2] }"));
        assert!(q.contains("tenant: \"acme\""));
    }

    #[test]
    fn hybrid_with_alpha_and_vector() {
        let q = build_get(
            "Article",
            &["title".into()],
            &Search::Hybrid {
                query: "news".into(),
                vector: Some(vec![0.5]),
                alpha: Some(0.25),
            },
            7,
            None,
        )
        .unwrap();
        assert!(q.contains("hybrid: { query: \"news\", vector: [0.5], alpha: 0.25 }"));
    }
}
