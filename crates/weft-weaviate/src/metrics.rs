//! Prometheus exposition-format parsing for Weaviate's metrics endpoint.
//!
//! Weaviate exposes Prometheus metrics on its own port (2112 by default,
//! enabled with `PROMETHEUS_MONITORING_ENABLED=true`). Weft folds the text
//! format into a small JSON snapshot — no storage, no PromQL; the UI keeps a
//! rolling in-browser window and charts it live.

use serde::Serialize;
use std::collections::HashMap;

/// Object counts beyond this many classes are truncated (largest first).
const MAX_CLASSES: usize = 10;

/// The selected series Weft surfaces, summed across label sets.
///
/// Every field is optional: a family missing from the scrape (different
/// Weaviate version, feature off) simply yields `null`, and the UI hides
/// that card.
#[derive(Debug, Default, Clone, PartialEq, Serialize)]
pub struct MetricsSnapshot {
    /// `go_memstats_heap_inuse_bytes`
    pub heap_inuse_bytes: Option<f64>,
    /// `go_goroutines`
    pub goroutines: Option<f64>,
    /// `process_cpu_seconds_total` (counter — the UI derives CPU% from deltas)
    pub cpu_seconds_total: Option<f64>,
    /// `object_count` summed over all classes and shards
    pub objects_total: Option<f64>,
    /// `object_count` per `class_name`, largest first, capped
    pub objects_by_class: Vec<ClassCount>,
    /// `vector_index_size` summed
    pub vector_index_size: Option<f64>,
    /// `requests_total` summed (counter — the UI derives QPS from deltas)
    pub requests_total: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ClassCount {
    pub class: String,
    pub count: f64,
}

/// Fold Prometheus text exposition into a [`MetricsSnapshot`].
///
/// Tolerant by design: comment lines, unknown families, and unparsable
/// values are skipped — a partial scrape yields a partial snapshot.
pub fn parse_snapshot(text: &str) -> MetricsSnapshot {
    let mut snap = MetricsSnapshot::default();
    let mut by_class: HashMap<String, f64> = HashMap::new();

    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let Some((name, labels, value)) = parse_series(line) else {
            continue;
        };
        if !value.is_finite() {
            continue;
        }
        let add = |slot: &mut Option<f64>| *slot = Some(slot.unwrap_or(0.0) + value);
        match name {
            "go_memstats_heap_inuse_bytes" => add(&mut snap.heap_inuse_bytes),
            "go_goroutines" => add(&mut snap.goroutines),
            "process_cpu_seconds_total" => add(&mut snap.cpu_seconds_total),
            "vector_index_size" => add(&mut snap.vector_index_size),
            "requests_total" => add(&mut snap.requests_total),
            "object_count" => {
                add(&mut snap.objects_total);
                if let Some(class) = label_value(labels, "class_name") {
                    *by_class.entry(class.to_string()).or_default() += value;
                }
            }
            _ => {}
        }
    }

    let mut classes: Vec<ClassCount> = by_class
        .into_iter()
        .map(|(class, count)| ClassCount { class, count })
        .collect();
    classes.sort_by(|a, b| {
        b.count
            .partial_cmp(&a.count)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.class.cmp(&b.class))
    });
    classes.truncate(MAX_CLASSES);
    snap.objects_by_class = classes;
    snap
}

/// Split one series line into (family name, raw label block, value).
/// Handles `name 1`, `name{a="b"} 1`, and an optional trailing timestamp.
fn parse_series(line: &str) -> Option<(&str, &str, f64)> {
    let (name_labels, rest) = match line.find('{') {
        Some(open) => {
            let close = line[open..].find('}')? + open;
            (
                (&line[..open], &line[open + 1..close]),
                line[close + 1..].trim_start(),
            )
        }
        None => {
            let space = line.find(char::is_whitespace)?;
            ((&line[..space], ""), line[space..].trim_start())
        }
    };
    let value_token = rest.split_whitespace().next()?;
    let value = value_token.parse::<f64>().ok()?;
    Some((name_labels.0, name_labels.1, value))
}

/// Extract one label's value from a raw label block (`a="x",b="y"`).
/// Weaviate label values (class/shard names) never contain escaped quotes.
fn label_value<'a>(labels: &'a str, key: &str) -> Option<&'a str> {
    for pair in labels.split(',') {
        let (k, v) = pair.split_once('=')?;
        if k.trim() == key {
            return Some(v.trim().trim_matches('"'));
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"
# HELP go_goroutines Number of goroutines that currently exist.
# TYPE go_goroutines gauge
go_goroutines 42
go_memstats_heap_inuse_bytes 1.048576e+07
process_cpu_seconds_total 12.5
object_count{class_name="Article",shard_name="abc"} 25
object_count{class_name="PerfDoc",shard_name="def"} 1000
object_count{class_name="PerfDoc",shard_name="ghi"} 500
vector_index_size{class_name="Article",shard_name="abc"} 25
requests_total{api="rest",class_name="Article",query_type="get"} 100
requests_total{api="graphql",class_name="Article",query_type="get"} 50
some_unknown_family{x="y"} 1
broken line without value
nan_family NaN
"#;

    #[test]
    fn folds_selected_families() {
        let s = parse_snapshot(SAMPLE);
        assert_eq!(s.goroutines, Some(42.0));
        assert_eq!(s.heap_inuse_bytes, Some(10_485_760.0));
        assert_eq!(s.cpu_seconds_total, Some(12.5));
        assert_eq!(s.objects_total, Some(1525.0));
        assert_eq!(s.vector_index_size, Some(25.0));
        assert_eq!(s.requests_total, Some(150.0));
    }

    #[test]
    fn sums_object_count_per_class_sorted_desc() {
        let s = parse_snapshot(SAMPLE);
        assert_eq!(s.objects_by_class.len(), 2);
        assert_eq!(s.objects_by_class[0].class, "PerfDoc");
        assert_eq!(s.objects_by_class[0].count, 1500.0);
        assert_eq!(s.objects_by_class[1].class, "Article");
    }

    #[test]
    fn missing_families_stay_null() {
        let s = parse_snapshot("go_goroutines 7\n");
        assert_eq!(s.goroutines, Some(7.0));
        assert_eq!(s.heap_inuse_bytes, None);
        assert_eq!(s.objects_total, None);
        assert!(s.objects_by_class.is_empty());
    }

    #[test]
    fn tolerates_garbage_timestamps_and_infinities() {
        let text =
            "go_goroutines 5 1700000000000\nrequests_total{a=\"b\"} +Inf\n###\nnot a metric\n";
        let s = parse_snapshot(text);
        assert_eq!(s.goroutines, Some(5.0), "trailing timestamp ignored");
        assert_eq!(s.requests_total, None, "+Inf skipped");
    }

    #[test]
    fn class_cap_keeps_largest() {
        let mut text = String::new();
        for i in 0..15 {
            text.push_str(&format!(
                "object_count{{class_name=\"C{i}\",shard_name=\"s\"}} {}\n",
                i + 1
            ));
        }
        let s = parse_snapshot(&text);
        assert_eq!(s.objects_by_class.len(), MAX_CLASSES);
        assert_eq!(s.objects_by_class[0].class, "C14", "largest first");
        assert_eq!(s.objects_total, Some((1..=15).sum::<i32>() as f64));
    }
}
