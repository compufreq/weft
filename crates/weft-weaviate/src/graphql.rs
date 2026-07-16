//! GraphQL `Get` / `Aggregate` query builders for Weaviate.
//!
//! Weaviate's search surface (BM25, vector, hybrid), `where` filtering, and
//! aggregations are GraphQL-only. Queries are built as strings; every
//! user-supplied value is JSON-encoded and every identifier is validated, so
//! injection is not possible.

use serde::Deserialize;
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

    #[error("filter condition on `{path}`: {reason}")]
    InvalidCondition { path: String, reason: String },

    #[error("a filter needs at least one condition")]
    EmptyFilter,
}

/// A structured `where` filter: a flat AND of conditions.
///
/// (Or/nested groups are deliberately out of scope for now — the raw GraphQL
/// console covers those cases.)
#[derive(Debug, Clone, Deserialize)]
pub struct WhereFilter {
    pub conditions: Vec<Condition>,
}

/// One filter condition on a property path.
#[derive(Debug, Clone, Deserialize)]
pub struct Condition {
    /// Property name (single hop; validated as an identifier).
    pub path: String,
    pub operator: WhereOperator,
    /// Comparison value. Type inferred from JSON unless `value_type` says
    /// otherwise. Ignored for `IsNull` (defaults to `true`).
    #[serde(default)]
    pub value: serde_json::Value,
    /// Optional explicit Weaviate value type (`text`, `int`, `number`,
    /// `boolean`, `date`) — needed e.g. for RFC3339 date strings.
    #[serde(default)]
    pub value_type: Option<ValueType>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
pub enum WhereOperator {
    Equal,
    NotEqual,
    GreaterThan,
    GreaterThanEqual,
    LessThan,
    LessThanEqual,
    Like,
    ContainsAny,
    ContainsAll,
    IsNull,
}

impl WhereOperator {
    fn as_str(self) -> &'static str {
        match self {
            Self::Equal => "Equal",
            Self::NotEqual => "NotEqual",
            Self::GreaterThan => "GreaterThan",
            Self::GreaterThanEqual => "GreaterThanEqual",
            Self::LessThan => "LessThan",
            Self::LessThanEqual => "LessThanEqual",
            Self::Like => "Like",
            Self::ContainsAny => "ContainsAny",
            Self::ContainsAll => "ContainsAll",
            Self::IsNull => "IsNull",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ValueType {
    Text,
    Int,
    Number,
    Boolean,
    Date,
}

impl ValueType {
    /// The GraphQL argument key for a scalar of this type.
    fn key(self) -> &'static str {
        match self {
            Self::Text => "valueText",
            Self::Int => "valueInt",
            Self::Number => "valueNumber",
            Self::Boolean => "valueBoolean",
            Self::Date => "valueDate",
        }
    }

    fn infer(value: &serde_json::Value) -> Option<Self> {
        match value {
            serde_json::Value::String(_) => Some(Self::Text),
            serde_json::Value::Bool(_) => Some(Self::Boolean),
            serde_json::Value::Number(n) if n.is_i64() || n.is_u64() => Some(Self::Int),
            serde_json::Value::Number(_) => Some(Self::Number),
            _ => None,
        }
    }
}

impl Condition {
    /// Render one condition as a GraphQL operand object.
    fn render(&self) -> Result<String, BuildError> {
        let path = ident(&self.path)?;
        let op = self.operator;

        if op == WhereOperator::IsNull {
            let flag = self.value.as_bool().unwrap_or(true);
            return Ok(format!(
                "{{ path: [{}], operator: IsNull, valueBoolean: {flag} }}",
                encode_str(path)
            ));
        }

        let invalid = |reason: &str| BuildError::InvalidCondition {
            path: self.path.clone(),
            reason: reason.to_string(),
        };

        // ContainsAny/All take a list; everything else takes a scalar.
        let (vtype, encoded) = if let serde_json::Value::Array(items) = &self.value {
            if !matches!(op, WhereOperator::ContainsAny | WhereOperator::ContainsAll) {
                return Err(invalid("a list value requires ContainsAny/ContainsAll"));
            }
            let first = items.first().ok_or_else(|| invalid("empty list value"))?;
            let vtype = self
                .value_type
                .or_else(|| ValueType::infer(first))
                .ok_or_else(|| invalid("unsupported list element type"))?;
            if items
                .iter()
                .any(|i| ValueType::infer(i) != ValueType::infer(first))
            {
                return Err(invalid("list elements must share one type"));
            }
            (vtype, json!(items).to_string())
        } else {
            let vtype = self
                .value_type
                .or_else(|| ValueType::infer(&self.value))
                .ok_or_else(|| invalid("value must be a string, number, or boolean"))?;
            (vtype, self.value.to_string())
        };

        Ok(format!(
            "{{ path: [{}], operator: {}, {}: {encoded} }}",
            encode_str(path),
            op.as_str(),
            vtype.key()
        ))
    }
}

/// Render a `where: {...}` GraphQL argument from a structured filter.
pub fn where_argument(filter: &WhereFilter) -> Result<String, BuildError> {
    let rendered: Vec<String> = filter
        .conditions
        .iter()
        .map(Condition::render)
        .collect::<Result<_, _>>()?;
    match rendered.as_slice() {
        [] => Err(BuildError::EmptyFilter),
        [single] => Ok(format!("where: {single}")),
        many => Ok(format!(
            "where: {{ operator: And, operands: [{}] }}",
            many.join(", ")
        )),
    }
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
    filter: Option<&WhereFilter>,
) -> Result<String, BuildError> {
    let class = ident(class)?;
    let mut fields = Vec::with_capacity(properties.len() + 1);
    for p in properties {
        fields.push(ident(p)?.to_string());
    }
    fields.push("_additional { id score distance }".to_string());

    let mut args = vec![format!("limit: {limit}"), search.operator()];
    if let Some(f) = filter {
        args.push(where_argument(f)?);
    }
    if let Some(t) = tenant {
        args.push(format!("tenant: {}", encode_str(t)));
    }

    Ok(format!(
        "{{ Get {{ {class}({args}) {{ {fields} }} }} }}",
        args = args.join(", "),
        fields = fields.join(" ")
    ))
}

/// Build a `Get` browse query (no search operator) with a `where` filter.
///
/// Filtered browsing must go through GraphQL — the REST objects API has no
/// filter support. Pagination is offset-based: Weaviate's `after` cursor is
/// explicitly incompatible with `where`.
pub fn build_browse(
    class: &str,
    properties: &[String],
    filter: &WhereFilter,
    limit: usize,
    offset: usize,
    tenant: Option<&str>,
) -> Result<String, BuildError> {
    let class = ident(class)?;
    let mut fields = Vec::with_capacity(properties.len() + 1);
    for p in properties {
        fields.push(ident(p)?.to_string());
    }
    fields.push("_additional { id }".to_string());

    let mut args = vec![format!("limit: {limit}"), where_argument(filter)?];
    if offset > 0 {
        args.push(format!("offset: {offset}"));
    }
    if let Some(t) = tenant {
        args.push(format!("tenant: {}", encode_str(t)));
    }

    Ok(format!(
        "{{ Get {{ {class}({args}) {{ {fields} }} }} }}",
        args = args.join(", "),
        fields = fields.join(" ")
    ))
}

/// Build an `Aggregate` count query (optionally tenant-scoped).
pub fn build_count(class: &str, tenant: Option<&str>) -> Result<String, BuildError> {
    build_aggregate(class, tenant, None, None)
}

/// Build an `Aggregate` query: total count, optionally filtered, optionally
/// grouped by one property (facets).
pub fn build_aggregate(
    class: &str,
    tenant: Option<&str>,
    filter: Option<&WhereFilter>,
    group_by: Option<&str>,
) -> Result<String, BuildError> {
    let class = ident(class)?;

    let mut args = Vec::new();
    if let Some(g) = group_by {
        args.push(format!("groupBy: [{}]", encode_str(ident(g)?)));
    }
    if let Some(f) = filter {
        args.push(where_argument(f)?);
    }
    if let Some(t) = tenant {
        args.push(format!("tenant: {}", encode_str(t)));
    }
    let args = if args.is_empty() {
        String::new()
    } else {
        format!("({})", args.join(", "))
    };

    let fields = if group_by.is_some() {
        "groupedBy { path value } meta { count }"
    } else {
        "meta { count }"
    };

    Ok(format!(
        "{{ Aggregate {{ {class}{args} {{ {fields} }} }} }}"
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn count_query_with_and_without_tenant() {
        assert_eq!(
            build_count("Product", Some("acme")).unwrap(),
            "{ Aggregate { Product(tenant: \"acme\") { meta { count } } } }"
        );
        assert_eq!(
            build_count("Article", None).unwrap(),
            "{ Aggregate { Article { meta { count } } } }"
        );
        assert!(build_count("Bad Name", None).is_err());
    }

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
            None,
        )
        .unwrap();
        // The malicious payload stays inside a JSON string literal.
        assert!(q.contains(r#"bm25: { query: "quote\" } inject { Get" }"#));
    }

    #[test]
    fn invalid_identifiers_are_rejected() {
        let s = Search::Bm25 { query: "x".into() };
        assert!(build_get("Bad Name", &[], &s, 1, None, None).is_err());
        assert!(build_get("Article", &["prop-erty".into()], &s, 1, None, None).is_err());
        assert!(build_get("Article) { } {", &[], &s, 1, None, None).is_err());
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
            None,
        )
        .unwrap();
        assert!(q.contains("nearVector: { vector: [0.1,0.2] }"));
        assert!(q.contains("tenant: \"acme\""));
    }

    fn cond(path: &str, operator: WhereOperator, value: serde_json::Value) -> Condition {
        Condition {
            path: path.into(),
            operator,
            value,
            value_type: None,
        }
    }

    #[test]
    fn where_single_condition_infers_types() {
        let f = WhereFilter {
            conditions: vec![cond("category", WhereOperator::Equal, json!("science"))],
        };
        assert_eq!(
            where_argument(&f).unwrap(),
            r#"where: { path: ["category"], operator: Equal, valueText: "science" }"#
        );

        let f = WhereFilter {
            conditions: vec![cond("wordCount", WhereOperator::GreaterThan, json!(100))],
        };
        assert!(where_argument(&f).unwrap().contains("valueInt: 100"));

        let f = WhereFilter {
            conditions: vec![cond("price", WhereOperator::LessThanEqual, json!(9.5))],
        };
        assert!(where_argument(&f).unwrap().contains("valueNumber: 9.5"));

        let f = WhereFilter {
            conditions: vec![cond("published", WhereOperator::Equal, json!(true))],
        };
        assert!(where_argument(&f).unwrap().contains("valueBoolean: true"));
    }

    #[test]
    fn where_multiple_conditions_are_anded() {
        let f = WhereFilter {
            conditions: vec![
                cond("category", WhereOperator::Equal, json!("science")),
                cond("wordCount", WhereOperator::GreaterThanEqual, json!(50)),
            ],
        };
        let w = where_argument(&f).unwrap();
        assert!(w.starts_with("where: { operator: And, operands: ["));
        assert!(w.contains("valueText: \"science\""));
        assert!(w.contains("valueInt: 50"));
    }

    #[test]
    fn where_is_null_and_contains_and_date_override() {
        let f = WhereFilter {
            conditions: vec![cond("category", WhereOperator::IsNull, json!(null))],
        };
        assert!(where_argument(&f)
            .unwrap()
            .contains("operator: IsNull, valueBoolean: true"));

        let f = WhereFilter {
            conditions: vec![cond(
                "category",
                WhereOperator::ContainsAny,
                json!(["a", "b"]),
            )],
        };
        assert!(where_argument(&f)
            .unwrap()
            .contains(r#"operator: ContainsAny, valueText: ["a","b"]"#));

        let mut date = cond(
            "publishedAt",
            WhereOperator::GreaterThan,
            json!("2026-01-01T00:00:00Z"),
        );
        date.value_type = Some(ValueType::Date);
        let f = WhereFilter {
            conditions: vec![date],
        };
        assert!(where_argument(&f)
            .unwrap()
            .contains(r#"valueDate: "2026-01-01T00:00:00Z""#));
    }

    #[test]
    fn where_rejects_bad_input() {
        // Injection through the path is impossible — idents are validated.
        let f = WhereFilter {
            conditions: vec![cond("cat\"] , x", WhereOperator::Equal, json!("x"))],
        };
        assert!(where_argument(&f).is_err());

        // A list needs Contains*, a scalar op rejects lists.
        let f = WhereFilter {
            conditions: vec![cond("category", WhereOperator::Equal, json!(["a"]))],
        };
        assert!(where_argument(&f).is_err());

        // Null value without IsNull is rejected.
        let f = WhereFilter {
            conditions: vec![cond("category", WhereOperator::Equal, json!(null))],
        };
        assert!(where_argument(&f).is_err());

        // Empty filter is rejected.
        assert!(where_argument(&WhereFilter { conditions: vec![] }).is_err());

        // Injection through a string value stays inside the JSON literal.
        let f = WhereFilter {
            conditions: vec![cond(
                "category",
                WhereOperator::Equal,
                json!("x\" }] , inject: { "),
            )],
        };
        assert!(where_argument(&f)
            .unwrap()
            .contains(r#"valueText: "x\" }] , inject: { ""#));
    }

    #[test]
    fn browse_query_with_filter_and_offset() {
        let f = WhereFilter {
            conditions: vec![cond("category", WhereOperator::Equal, json!("science"))],
        };
        let q = build_browse("Article", &["title".into()], &f, 25, 50, Some("acme")).unwrap();
        assert!(q.contains("Get { Article(limit: 25, where:"));
        assert!(q.contains("offset: 50"));
        assert!(q.contains(r#"tenant: "acme""#));
        assert!(q.contains("title _additional { id }"));

        // Offset 0 is omitted.
        let q0 = build_browse("Article", &[], &f, 25, 0, None).unwrap();
        assert!(!q0.contains("offset"));
    }

    #[test]
    fn aggregate_with_group_by_and_filter() {
        let f = WhereFilter {
            conditions: vec![cond("wordCount", WhereOperator::GreaterThan, json!(10))],
        };
        let q = build_aggregate("Article", None, Some(&f), Some("category")).unwrap();
        assert!(q.contains(r#"Aggregate { Article(groupBy: ["category"], where:"#));
        assert!(q.contains("groupedBy { path value } meta { count }"));

        assert!(build_aggregate("Article", None, None, Some("bad name")).is_err());
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
            None,
        )
        .unwrap();
        assert!(q.contains("hybrid: { query: \"news\", vector: [0.5], alpha: 0.25 }"));
    }
}
