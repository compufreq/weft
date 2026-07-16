//! Dev tasks for Weft. Currently: `seed` — populate a Weaviate instance with
//! demo data for local development and integration testing.
//!
//! Dogfoods `weft-weaviate` on purpose: if the client can't seed, CI breaks.

use anyhow::{bail, Context, Result};
use serde_json::json;
use std::time::Duration;
use weft_weaviate::WeaviateClient;

#[tokio::main]
async fn main() -> Result<()> {
    let cmd = std::env::args().nth(1).unwrap_or_default();
    match cmd.as_str() {
        "seed" => seed().await,
        other => bail!("unknown xtask `{other}`. Available: seed"),
    }
}

async fn seed() -> Result<()> {
    let url = std::env::var("WEAVIATE_URL").unwrap_or_else(|_| "http://weaviate:8080".into());
    let client = WeaviateClient::new(&url, None).context("invalid WEAVIATE_URL")?;

    // Wait for Weaviate to become ready (fresh containers take a few seconds).
    let mut attempts = 0u32;
    while !client.ready().await.unwrap_or(false) {
        attempts += 1;
        if attempts > 60 {
            bail!("Weaviate at {url} not ready after 60s");
        }
        tokio::time::sleep(Duration::from_secs(1)).await;
    }
    println!("weaviate ready at {url}");

    // Idempotency: skip if demo classes already exist.
    let schema = client.schema().await?;
    if schema.classes.iter().any(|c| c.class == "Article") {
        println!("demo data already present, skipping seed");
        return Ok(());
    }

    // 1. Article — plain collection, no vectorizer (no model containers needed).
    client
        .create_class(&json!({
            "class": "Article",
            "description": "Demo news articles",
            "vectorizer": "none",
            "properties": [
                { "name": "title", "dataType": ["text"], "description": "Headline" },
                { "name": "body", "dataType": ["text"], "description": "Article body" },
                { "name": "category", "dataType": ["text"], "description": "Section" },
                { "name": "wordCount", "dataType": ["int"] }
            ]
        }))
        .await
        .context("creating Article class")?;

    // 2. Product — multi-tenant collection to exercise tenant features.
    client
        .create_class(&json!({
            "class": "Product",
            "description": "Demo products (multi-tenant)",
            "vectorizer": "none",
            "multiTenancyConfig": { "enabled": true },
            "properties": [
                { "name": "name", "dataType": ["text"] },
                { "name": "price", "dataType": ["number"] }
            ]
        }))
        .await
        .context("creating Product class")?;
    client
        .create_tenants("Product", &["acme", "globex"])
        .await
        .context("creating Product tenants")?;

    // 3. Seed Article objects with deterministic demo vectors.
    let categories = ["tech", "science", "business", "sports"];
    let objects: Vec<_> = (0..25)
        .map(|i| {
            let cat = categories[i % categories.len()];
            json!({
                "class": "Article",
                "properties": {
                    "title": format!("Demo article #{i}: notes on {cat}"),
                    "body": format!("This is seeded demo content number {i} in the {cat} category, used to exercise the Weft object explorer."),
                    "category": cat,
                    "wordCount": 40 + (i as i64) * 7
                },
                // 8-dim deterministic vector so vector search works without a vectorizer.
                "vector": (0..8).map(|d| ((i * 31 + d * 7) % 100) as f64 / 100.0).collect::<Vec<f64>>()
            })
        })
        .collect();
    client
        .batch_objects(&objects)
        .await
        .context("batch inserting Article objects")?;

    // Tenant-scoped products.
    for tenant in ["acme", "globex"] {
        let products: Vec<_> = (0..5)
            .map(|i| {
                json!({
                    "class": "Product",
                    "tenant": tenant,
                    "properties": {
                        "name": format!("{tenant} product {i}"),
                        "price": 9.99 + i as f64
                    }
                })
            })
            .collect();
        client
            .batch_objects(&products)
            .await
            .with_context(|| format!("batch inserting products for tenant {tenant}"))?;
    }

    println!("seeded: Article (25 objects), Product (multi-tenant: acme, globex, 5 each)");
    Ok(())
}
