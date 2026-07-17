//! Authentication backend abstraction and the mutation event hook.
//!
//! These are the extension seams behind Weft's auth: the built-in
//! [`SharedTokenBackend`] reproduces the original `WEFT_AUTH_TOKEN`
//! behavior exactly, and the default mutation hook is a no-op. Alternative
//! backends (per-user tokens, OIDC) and audit sinks plug in here without
//! touching the guard middleware.

use secrecy::{ExposeSecret, SecretString};
use std::fmt;
use std::sync::Arc;

/// The authenticated caller, as established by an [`AuthBackend`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Actor {
    /// Stable identifier for the caller. The shared-token backend cannot
    /// distinguish callers, so it reports `"shared-token"`; open
    /// deployments report `"anonymous"`.
    pub id: String,
}

impl Actor {
    pub fn anonymous() -> Self {
        Self {
            id: "anonymous".into(),
        }
    }
}

/// Verifies presented credentials for `/api` requests.
///
/// Implementations must be cheap to call per-request and side-effect-free.
pub trait AuthBackend: fmt::Debug + Send + Sync {
    /// Whether this deployment requires authentication at all.
    fn required(&self) -> bool;

    /// Verify a presented token (bearer header or session cookie value).
    /// `Some(actor)` when valid; `None` rejects the request.
    fn verify(&self, presented: &str) -> Option<Actor>;
}

/// The built-in backend: one shared secret (`WEFT_AUTH_TOKEN`) for every
/// caller, compared in constant time. `None` means auth is disabled.
#[derive(Debug, Default)]
pub struct SharedTokenBackend {
    token: Option<SecretString>,
}

impl SharedTokenBackend {
    pub fn new(token: Option<SecretString>) -> Self {
        Self { token }
    }
}

impl AuthBackend for SharedTokenBackend {
    fn required(&self) -> bool {
        self.token.is_some()
    }

    fn verify(&self, presented: &str) -> Option<Actor> {
        let expected = self.token.as_ref()?;
        ct_eq(presented, expected.expose_secret()).then(|| Actor {
            id: "shared-token".into(),
        })
    }
}

/// Constant-time string comparison (length leaks, contents don't).
pub(crate) fn ct_eq(a: &str, b: &str) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.bytes()
        .zip(b.bytes())
        .fold(0u8, |acc, (x, y)| acc | (x ^ y))
        == 0
}

/// One successful mutating API request, as observed by the guard.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MutationEvent {
    /// Who did it (from the [`AuthBackend`]).
    pub actor: String,
    /// HTTP method (`POST`, `PUT`, `DELETE`).
    pub method: String,
    /// Request path, e.g. `/api/v1/instances/local/collections`.
    pub path: String,
    /// Response status code (only success statuses are reported).
    pub status: u16,
}

/// Called by the guard after every successful mutating API request.
/// The default deployment has no hook; consumers (e.g. an audit log)
/// install one via [`crate::AppState::with_mutation_hook`]. Hooks run on
/// the request path — keep them fast and non-blocking.
pub type MutationHook = Arc<dyn Fn(&MutationEvent) + Send + Sync>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shared_token_backend_matches_original_behavior() {
        let open = SharedTokenBackend::new(None);
        assert!(!open.required());
        assert!(open.verify("anything").is_none(), "no token to verify against");

        let locked = SharedTokenBackend::new(Some(SecretString::from("s3cret")));
        assert!(locked.required());
        assert_eq!(
            locked.verify("s3cret").map(|a| a.id),
            Some("shared-token".to_string())
        );
        assert!(locked.verify("s3creT").is_none());
        assert!(locked.verify("").is_none());
    }

    #[test]
    fn ct_eq_matches_only_exact() {
        assert!(ct_eq("secret", "secret"));
        assert!(!ct_eq("secret", "secret2"));
        assert!(!ct_eq("secret", "secreT"));
        assert!(!ct_eq("", "x"));
        assert!(ct_eq("", ""));
    }
}
