//! The HTTP client for a single Weaviate instance.

use crate::types::{Meta, Schema};
use crate::Error;
use secrecy::{ExposeSecret, SecretString};
use serde_json::Value;
use std::time::Duration;
use url::Url;

/// Parameters for [`WeaviateClient::objects`].
#[derive(Debug, Clone)]
pub struct ObjectsQuery<'a> {
    pub class: &'a str,
    pub limit: usize,
    /// Cursor: UUID of the last object of the previous page.
    pub after: Option<&'a str>,
    pub tenant: Option<&'a str>,
    pub include_vector: bool,
}

/// Client for one Weaviate instance.
///
/// Wraps a pooled [`reqwest::Client`]; cheap to clone via `Arc` at the caller.
#[derive(Debug, Clone)]
pub struct WeaviateClient {
    http: reqwest::Client,
    base_url: Url,
    api_key: Option<SecretString>,
}

impl WeaviateClient {
    /// Create a client for `base_url` (e.g. `http://weaviate:8080`).
    pub fn new(base_url: &str, api_key: Option<SecretString>) -> Result<Self, Error> {
        let http = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(5))
            .timeout(Duration::from_secs(30))
            .build()?;
        Ok(Self {
            http,
            base_url: Url::parse(base_url)?,
            api_key,
        })
    }

    /// The instance base URL (no credentials).
    pub fn base_url(&self) -> &Url {
        &self.base_url
    }

    fn url(&self, path: &str) -> Result<Url, Error> {
        Ok(self.base_url.join(path)?)
    }

    fn get(&self, url: Url) -> reqwest::RequestBuilder {
        let req = self.http.get(url);
        match &self.api_key {
            Some(key) => req.bearer_auth(key.expose_secret()),
            None => req,
        }
    }

    fn post(&self, url: Url) -> reqwest::RequestBuilder {
        let req = self.http.post(url);
        match &self.api_key {
            Some(key) => req.bearer_auth(key.expose_secret()),
            None => req,
        }
    }

    /// Decode a response, converting non-2xx statuses into [`Error::Status`].
    async fn decode<T: serde::de::DeserializeOwned>(resp: reqwest::Response) -> Result<T, Error> {
        let status = resp.status();
        let body = resp.text().await?;
        if !status.is_success() {
            return Err(Error::Status { status, body });
        }
        Ok(serde_json::from_str(&body)?)
    }

    /// `GET /v1/.well-known/ready` — true when the instance can serve traffic.
    pub async fn ready(&self) -> Result<bool, Error> {
        let resp = self.get(self.url("/v1/.well-known/ready")?).send().await?;
        Ok(resp.status().is_success())
    }

    /// `GET /v1/meta` — server version and enabled modules.
    pub async fn meta(&self) -> Result<Meta, Error> {
        let resp = self.get(self.url("/v1/meta")?).send().await?;
        Self::decode(resp).await
    }

    /// `GET /v1/schema` — the full schema (all collections).
    pub async fn schema(&self) -> Result<Schema, Error> {
        let resp = self.get(self.url("/v1/schema")?).send().await?;
        Self::decode(resp).await
    }

    /// `GET /v1/schema` as raw JSON — used for export and diff, where every
    /// field (including ones Weft doesn't type) must round-trip untouched.
    pub async fn schema_raw(&self) -> Result<Value, Error> {
        let resp = self.get(self.url("/v1/schema")?).send().await?;
        Self::decode(resp).await
    }

    /// `GET /v1/objects` — list objects of a class with cursor pagination.
    ///
    /// Returns the raw response (`{ "objects": [...] }`); pagination uses
    /// Weaviate's `after` cursor (the last object's UUID), never offsets.
    pub async fn objects(&self, query: &ObjectsQuery<'_>) -> Result<Value, Error> {
        let mut url = self.url("/v1/objects")?;
        {
            let mut pairs = url.query_pairs_mut();
            pairs.append_pair("class", query.class);
            pairs.append_pair("limit", &query.limit.to_string());
            if let Some(after) = query.after {
                pairs.append_pair("after", after);
            }
            if let Some(tenant) = query.tenant {
                pairs.append_pair("tenant", tenant);
            }
            if query.include_vector {
                pairs.append_pair("include", "vector");
            }
        }
        let resp = self.get(url).send().await?;
        Self::decode(resp).await
    }

    /// `POST /v1/graphql` — run a raw GraphQL query.
    ///
    /// Returns the full envelope (`{ "data": ..., "errors": ... }`); callers
    /// are responsible for inspecting `errors`.
    pub async fn graphql(&self, query: &str) -> Result<Value, Error> {
        let body = serde_json::json!({ "query": query });
        let resp = self
            .post(self.url("/v1/graphql")?)
            .json(&body)
            .send()
            .await?;
        Self::decode(resp).await
    }

    /// `POST /v1/schema` — create a collection from a raw class definition.
    ///
    /// Takes a raw [`Value`] on purpose: the seeder and later schema tooling
    /// need full flexibility over the class payload.
    pub async fn create_class(&self, class: &Value) -> Result<Value, Error> {
        let resp = self
            .post(self.url("/v1/schema")?)
            .json(class)
            .send()
            .await?;
        Self::decode(resp).await
    }

    /// `POST /v1/batch/objects` — insert objects in a single batch.
    pub async fn batch_objects(&self, objects: &[Value]) -> Result<Value, Error> {
        let body = serde_json::json!({ "objects": objects });
        let resp = self
            .post(self.url("/v1/batch/objects")?)
            .json(&body)
            .send()
            .await?;
        Self::decode(resp).await
    }

    /// `POST /v1/schema/{class}/tenants` — create tenants on a multi-tenant collection.
    pub async fn create_tenants(&self, class: &str, names: &[&str]) -> Result<Value, Error> {
        let tenants: Vec<Value> = names
            .iter()
            .map(|n| serde_json::json!({ "name": n }))
            .collect();
        let resp = self
            .post(self.url(&format!("/v1/schema/{class}/tenants"))?)
            .json(&tenants)
            .send()
            .await?;
        Self::decode(resp).await
    }

    /// `GET /v1/schema/{class}/tenants` — list tenants with activity status.
    pub async fn tenants(&self, class: &str) -> Result<Value, Error> {
        let resp = self
            .get(self.url(&format!("/v1/schema/{class}/tenants"))?)
            .send()
            .await?;
        Self::decode(resp).await
    }

    /// `PUT /v1/schema/{class}/tenants` — update tenants (e.g. activity status).
    ///
    /// Each entry is `{ "name": ..., "activityStatus": "HOT" | "COLD" }`.
    pub async fn update_tenants(&self, class: &str, tenants: &[Value]) -> Result<Value, Error> {
        let req = self
            .http
            .put(self.url(&format!("/v1/schema/{class}/tenants"))?);
        let req = match &self.api_key {
            Some(key) => req.bearer_auth(key.expose_secret()),
            None => req,
        };
        let resp = req.json(&tenants).send().await?;
        Self::decode(resp).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use wiremock::matchers::{bearer_token, method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    async fn client(server: &MockServer) -> WeaviateClient {
        WeaviateClient::new(&server.uri(), None).unwrap()
    }

    #[tokio::test]
    async fn meta_decodes_version_and_modules() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/v1/meta"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "version": "1.37.2",
                "hostname": "http://[::]:8080",
                "modules": { "text2vec-openai": {} }
            })))
            .mount(&server)
            .await;

        let meta = client(&server).await.meta().await.unwrap();
        assert_eq!(meta.version, "1.37.2");
        assert!(meta.modules.get("text2vec-openai").is_some());
    }

    #[tokio::test]
    async fn schema_decodes_classes() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/v1/schema"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "classes": [
                    { "class": "Article", "vectorizer": "none", "properties": [] },
                    { "class": "Product", "multiTenancyConfig": { "enabled": true } }
                ]
            })))
            .mount(&server)
            .await;

        let schema = client(&server).await.schema().await.unwrap();
        assert_eq!(schema.classes.len(), 2);
        assert!(
            schema.classes[1]
                .multi_tenancy_config
                .as_ref()
                .unwrap()
                .enabled
        );
    }

    #[tokio::test]
    async fn empty_schema_decodes() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/v1/schema"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({})))
            .mount(&server)
            .await;

        let schema = client(&server).await.schema().await.unwrap();
        assert!(schema.classes.is_empty());
    }

    #[tokio::test]
    async fn api_key_is_sent_as_bearer() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/v1/meta"))
            .and(bearer_token("sekrit"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "version": "1.37.2"
            })))
            .mount(&server)
            .await;

        let client =
            WeaviateClient::new(&server.uri(), Some(SecretString::from("sekrit"))).unwrap();
        assert_eq!(client.meta().await.unwrap().version, "1.37.2");
    }

    #[tokio::test]
    async fn tenants_list_and_update_roundtrip() {
        use wiremock::matchers::body_string_contains;
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/v1/schema/Product/tenants"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([
                { "name": "acme", "activityStatus": "HOT" },
                { "name": "globex", "activityStatus": "COLD" }
            ])))
            .mount(&server)
            .await;
        Mock::given(method("PUT"))
            .and(path("/v1/schema/Product/tenants"))
            .and(body_string_contains("\"activityStatus\":\"COLD\""))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([
                { "name": "acme", "activityStatus": "COLD" }
            ])))
            .mount(&server)
            .await;

        let c = client(&server).await;
        let list = c.tenants("Product").await.unwrap();
        assert_eq!(list.as_array().unwrap().len(), 2);
        assert_eq!(list[0]["activityStatus"], "HOT");

        let updated = c
            .update_tenants(
                "Product",
                &[serde_json::json!({ "name": "acme", "activityStatus": "COLD" })],
            )
            .await
            .unwrap();
        assert_eq!(updated[0]["activityStatus"], "COLD");
    }

    #[tokio::test]
    async fn objects_builds_cursor_query_params() {
        use wiremock::matchers::query_param;
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/v1/objects"))
            .and(query_param("class", "Article"))
            .and(query_param("limit", "50"))
            .and(query_param("after", "abc-123"))
            .and(query_param("tenant", "acme"))
            .and(query_param("include", "vector"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "objects": [{ "id": "x", "properties": {} }]
            })))
            .mount(&server)
            .await;

        let result = client(&server)
            .await
            .objects(&ObjectsQuery {
                class: "Article",
                limit: 50,
                after: Some("abc-123"),
                tenant: Some("acme"),
                include_vector: true,
            })
            .await
            .unwrap();
        assert_eq!(result["objects"].as_array().unwrap().len(), 1);
    }

    #[tokio::test]
    async fn graphql_posts_query_and_returns_envelope() {
        use wiremock::matchers::body_string_contains;
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/v1/graphql"))
            .and(body_string_contains("Get { Article"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "data": { "Get": { "Article": [] } }
            })))
            .mount(&server)
            .await;

        let envelope = client(&server)
            .await
            .graphql("{ Get { Article(limit: 1) { title } } }")
            .await
            .unwrap();
        assert!(envelope["data"]["Get"]["Article"].is_array());
    }

    #[tokio::test]
    async fn unauthorized_maps_to_status_error() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/v1/schema"))
            .respond_with(ResponseTemplate::new(401).set_body_string("anonymous access denied"))
            .mount(&server)
            .await;

        let err = client(&server).await.schema().await.unwrap_err();
        match err {
            Error::Status { status, body } => {
                assert_eq!(status.as_u16(), 401);
                assert!(body.contains("denied"));
            }
            other => panic!("expected Status error, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn malformed_body_maps_to_decode_error() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/v1/meta"))
            .respond_with(ResponseTemplate::new(200).set_body_string("not-json"))
            .mount(&server)
            .await;

        let err = client(&server).await.meta().await.unwrap_err();
        assert!(matches!(err, Error::Decode(_)));
    }

    #[tokio::test]
    async fn ready_is_false_on_503() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/v1/.well-known/ready"))
            .respond_with(ResponseTemplate::new(503))
            .mount(&server)
            .await;

        assert!(!client(&server).await.ready().await.unwrap());
    }
}
