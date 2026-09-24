//! Broker errors.
//!
//! These surface directly in the UI, so the messages are written for the person
//! reading them: what went wrong, and what to do about it.

#[derive(Debug, thiserror::Error)]
pub enum BrokerError {
    #[error("Unknown brokerage '{0}'")]
    UnknownProvider(String),

    #[error("'{0}' is not a valid environment for this brokerage")]
    UnknownEnvironment(String),

    #[error("Missing {0}")]
    MissingCredential(String),

    #[error("The API key or secret was rejected. Check both values and that they match the selected environment — live keys do not work against paper, and paper keys do not work against live.")]
    Unauthorized,

    #[error("{0}")]
    Api(String),

    /// Throttled — by the brokerage (HTTP 429) or pre-emptively by our own
    /// limiter. Carries seconds until a request should succeed. Sync treats
    /// this as "keep what's stored, try next round", not as a failure.
    #[error("Rate limited by the brokerage — retrying in {0}s.")]
    RateLimited(u64),

    #[error("Could not reach the brokerage: {0}")]
    Network(String),

    #[error("Unexpected response from the brokerage: {0}")]
    Parse(String),

    #[error("No credentials stored on this device for this connection. Add them here to sync.")]
    NoCredentials,

    #[error("{0}")]
    Db(String),
}

/// Tauri commands return `Result<_, String>`, so this conversion is what lets
/// command bodies use `?` on broker calls.
impl From<BrokerError> for String {
    fn from(e: BrokerError) -> String {
        e.to_string()
    }
}

pub type BrokerResult<T> = Result<T, BrokerError>;
