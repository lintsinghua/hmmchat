//! Streaming HTTP proxy.
//!
//! Vendor chat APIs block browser calls via CORS, so every provider request
//! goes through here instead. The frontend wraps this in a `fetch`-compatible
//! function (see `src/lib/transport.ts`) and hands it to the AI SDK, which
//! means the SDK's provider adapters work unmodified.
//!
//! Chunks are sent to the webview base64-encoded rather than as strings: a
//! network chunk can split a multi-byte UTF-8 character, and decoding each
//! chunk independently would corrupt it. The frontend feeds the raw bytes
//! through a single streaming `TextDecoder` instead.

use std::collections::HashMap;
use std::time::Duration;

use base64::Engine as _;
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use tauri::State;
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;
use url::Url;

use crate::secrets::SecretsState;

/// Headers the transport owns; forwarding the webview's copies would either be
/// rejected by reqwest or fight with its own framing.
const SKIPPED_HEADERS: [&str; 5] = [
    "host",
    "content-length",
    "connection",
    "accept-encoding",
    "transfer-encoding",
];

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum StreamEvent {
    /// Sent once, as soon as upstream response headers arrive. This is what
    /// lets the frontend resolve its `fetch()` promise before the body starts.
    Headers {
        status: u16,
        headers: Vec<(String, String)>,
    },
    Chunk {
        data: String,
    },
    End,
    Error {
        message: String,
    },
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpRequestArgs {
    pub request_id: String,
    pub url: String,
    pub method: String,
    pub headers: Vec<(String, String)>,
    pub body: Option<String>,
}

pub struct HttpState {
    inflight: Mutex<HashMap<String, CancellationToken>>,
    client: reqwest::Client,
}

impl HttpState {
    pub fn new() -> Self {
        let client = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(20))
            // Deliberately no overall timeout: a long reasoning turn can stream
            // for minutes, and a global timeout would sever it mid-answer.
            .build()
            .expect("failed to build the http client");

        Self {
            inflight: Mutex::new(HashMap::new()),
            client,
        }
    }
}

#[tauri::command]
pub async fn http_stream(
    state: State<'_, HttpState>,
    secrets: State<'_, SecretsState>,
    args: HttpRequestArgs,
    on_event: Channel<StreamEvent>,
) -> Result<(), String> {
    let token = CancellationToken::new();
    {
        let mut inflight = state.inflight.lock().await;
        if let Some(previous) = inflight.insert(args.request_id.clone(), token.clone()) {
            previous.cancel();
        }
    }

    let result = forward(&state, &secrets, &args, &token, &on_event).await;

    state.inflight.lock().await.remove(&args.request_id);
    result
}

#[tauri::command]
pub async fn http_abort(state: State<'_, HttpState>, request_id: String) -> Result<(), String> {
    let inflight = state.inflight.lock().await;
    if let Some(token) = inflight.get(&request_id) {
        token.cancel();
    }
    Ok(())
}

async fn forward(
    state: &HttpState,
    secrets: &SecretsState,
    args: &HttpRequestArgs,
    token: &CancellationToken,
    on_event: &Channel<StreamEvent>,
) -> Result<(), String> {
    // The origin is taken from the URL as written, before substitution: the
    // secret lives in the path/query/headers, none of which affect the origin,
    // so this avoids a chicken-and-egg between "which key" and "which host".
    let declarative = Url::parse(&args.url).map_err(|e| format!("invalid url: {e}"))?;
    match declarative.scheme() {
        "http" | "https" => {}
        other => return Err(format!("refusing to proxy scheme `{other}`")),
    }
    let origin = declarative.origin().ascii_serialization();

    let resolved_url = secrets.resolve(&args.url, &origin).await;
    let url = Url::parse(&resolved_url).map_err(|e| format!("invalid url: {e}"))?;

    let method = reqwest::Method::from_bytes(args.method.to_ascii_uppercase().as_bytes())
        .map_err(|_| format!("invalid method: {}", args.method))?;

    let mut headers = reqwest::header::HeaderMap::new();
    for (name, value) in &args.headers {
        if SKIPPED_HEADERS.contains(&name.to_ascii_lowercase().as_str()) {
            continue;
        }
        let resolved = secrets.resolve(value, &origin).await;
        if let (Ok(name), Ok(value)) = (
            reqwest::header::HeaderName::from_bytes(name.as_bytes()),
            reqwest::header::HeaderValue::from_str(&resolved),
        ) {
            headers.insert(name, value);
        }
    }

    let mut request = state.client.request(method, url).headers(headers);
    if let Some(body) = &args.body {
        request = request.body(secrets.resolve(body, &origin).await);
    }

    let response = tokio::select! {
        _ = token.cancelled() => return Ok(()),
        result = request.send() => result.map_err(|e| format!("request failed: {e}"))?,
    };

    let status = response.status().as_u16();
    let response_headers: Vec<(String, String)> = response
        .headers()
        .iter()
        .filter_map(|(name, value)| {
            value
                .to_str()
                .ok()
                .map(|value| (name.as_str().to_string(), value.to_string()))
        })
        .collect();

    let _ = on_event.send(StreamEvent::Headers {
        status,
        headers: response_headers,
    });

    let mut stream = response.bytes_stream();
    loop {
        tokio::select! {
            _ = token.cancelled() => break,
            next = stream.next() => match next {
                Some(Ok(bytes)) => {
                    let data = base64::engine::general_purpose::STANDARD.encode(&bytes);
                    if on_event.send(StreamEvent::Chunk { data }).is_err() {
                        // The webview is gone (window closed, request replaced).
                        // Stop pulling from upstream so we stop being billed.
                        break;
                    }
                }
                Some(Err(e)) => {
                    let _ = on_event.send(StreamEvent::Error { message: e.to_string() });
                    return Ok(());
                }
                None => break,
            }
        }
    }

    let _ = on_event.send(StreamEvent::End);
    Ok(())
}
