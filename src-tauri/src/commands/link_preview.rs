//! Rich link previews for note content.
//!
//! Same rationale as `logos.rs`: the webview makes no network requests of its
//! own, so fetching a page's metadata/thumbnail and turning it into a data
//! URI happens here, with an on-disk cache keyed by URL hash. YouTube gets its
//! own path via the oEmbed API (no scraping needed, and it hands back an
//! embeddable video id); everything else falls back to scraping Open Graph
//! (and Twitter Card) meta tags out of the page's HTML.

use base64::Engine as _;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::PathBuf;
use std::time::Duration;
use tauri::{AppHandle, Manager};

/// How long a failed/empty lookup is remembered before being retried. Shorter
/// than the ticker-logo miss TTL — a page gaining Open Graph tags, or a typo'd
/// URL being fixed, is far more likely than a delisted ticker growing a logo.
const MISS_TTL_SECS: i64 = 24 * 60 * 60;

/// Reject anything implausibly large for a preview thumbnail or page fetch.
const MAX_IMAGE_BYTES: usize = 2 * 1024 * 1024;
const MAX_HTML_BYTES: usize = 2 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinkPreview {
    pub url: String,
    pub title: Option<String>,
    pub site_name: Option<String>,
    pub description: Option<String>,
    /// `data:image/...;base64,…`
    pub thumbnail_data_uri: Option<String>,
    /// Set only for a recognized video provider (currently YouTube). The
    /// frontend renders a play button and, once clicked, embeds this URL in
    /// an iframe instead of opening the link externally.
    pub embed_url: Option<String>,
}

impl LinkPreview {
    fn empty(url: &str) -> Self {
        LinkPreview {
            url: url.to_string(),
            title: None,
            site_name: None,
            description: None,
            thumbnail_data_uri: None,
            embed_url: None,
        }
    }
}

#[derive(Debug, Deserialize)]
struct YoutubeOembed {
    title: Option<String>,
    author_name: Option<String>,
    thumbnail_url: Option<String>,
}

fn cache_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("link_previews");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn cache_key(url: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(url.as_bytes());
    format!("{:x}", hasher.finalize())
}

fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

fn image_data_uri(bytes: &[u8], content_type: Option<&str>) -> String {
    let mime = content_type
        .filter(|ct| ct.starts_with("image/"))
        .unwrap_or("image/jpeg");
    format!(
        "data:{mime};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    )
}

fn youtube_video_id(url: &str) -> Option<String> {
    let parsed = url::Url::parse(url).ok()?;
    let host = parsed.host_str()?.trim_start_matches("www.").to_lowercase();
    match host.as_str() {
        "youtu.be" => parsed.path_segments()?.next().map(str::to_string),
        "youtube.com" | "m.youtube.com" | "music.youtube.com" => {
            if let Some((_, id)) = parsed.query_pairs().find(|(k, _)| k == "v") {
                return Some(id.to_string());
            }
            let mut segments = parsed.path_segments()?;
            match segments.next()? {
                "embed" | "shorts" | "live" => segments.next().map(str::to_string),
                _ => None,
            }
        }
        _ => None,
    }
    .filter(|id| !id.is_empty())
}

/// Fetches a single `<meta>`/`<title>` value without pulling in a full HTML
/// parser — the app only needs a handful of well-known Open Graph / Twitter
/// Card attributes, and a plain scan is far cheaper than an HTML5 tree
/// builder for that.
fn meta_content(html: &str, attr_names: &[&str]) -> Option<String> {
    let lower = html.to_lowercase();
    let mut search_from = 0;
    while let Some(rel_start) = lower[search_from..].find("<meta") {
        let start = search_from + rel_start;
        let end = lower[start..].find('>').map(|e| start + e)?;
        let tag = &html[start..end];
        let tag_lower = &lower[start..end];
        let matches_name = attr_names.iter().any(|name| {
            let needle_property = format!("property=\"{name}\"");
            let needle_property_sq = format!("property='{name}'");
            let needle_name = format!("name=\"{name}\"");
            let needle_name_sq = format!("name='{name}'");
            tag_lower.contains(&needle_property)
                || tag_lower.contains(&needle_property_sq)
                || tag_lower.contains(&needle_name)
                || tag_lower.contains(&needle_name_sq)
        });
        if matches_name {
            if let Some(content) = tag_attr(tag, "content") {
                if !content.trim().is_empty() {
                    return Some(decode_entities(content.trim()));
                }
            }
        }
        search_from = end + 1;
    }
    None
}

fn tag_attr(tag: &str, attr: &str) -> Option<String> {
    let lower = tag.to_lowercase();
    for quote in ['"', '\''] {
        let needle = format!("{attr}={quote}");
        if let Some(pos) = lower.find(&needle) {
            let start = pos + needle.len();
            if let Some(rel_end) = tag[start..].find(quote) {
                return Some(tag[start..start + rel_end].to_string());
            }
        }
    }
    None
}

fn decode_entities(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
}

fn page_title(html: &str) -> Option<String> {
    let lower = html.to_lowercase();
    let start = lower.find("<title")?;
    let content_start = html[start..].find('>').map(|i| start + i + 1)?;
    let end = lower[content_start..].find("</title>")? + content_start;
    let title = html[content_start..end].trim();
    if title.is_empty() {
        None
    } else {
        Some(decode_entities(title))
    }
}

/// Resolves a possibly-relative image URL against the page it came from.
/// Handles the absolute, protocol-relative and root-relative cases that cover
/// the overwhelming majority of real Open Graph tags; anything else (e.g. a
/// path relative to the current directory) is skipped rather than guessed at.
fn resolve_image_url(page_url: &str, image_url: &str) -> Option<String> {
    if image_url.starts_with("http://") || image_url.starts_with("https://") {
        return Some(image_url.to_string());
    }
    let parsed = url::Url::parse(page_url).ok()?;
    if let Some(rest) = image_url.strip_prefix("//") {
        return Some(format!("{}://{}", parsed.scheme(), rest));
    }
    if image_url.starts_with('/') {
        return Some(format!(
            "{}://{}{}",
            parsed.scheme(),
            parsed.host_str()?,
            image_url
        ));
    }
    None
}

async fn fetch_bytes(
    client: &reqwest::Client,
    url: &str,
    max_bytes: usize,
) -> Option<(Vec<u8>, Option<String>)> {
    let response = client.get(url).send().await.ok()?;
    if !response.status().is_success() {
        return None;
    }
    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .map(|v| v.split(';').next().unwrap_or(v).trim().to_string());
    let bytes = response.bytes().await.ok()?;
    if bytes.is_empty() || bytes.len() > max_bytes {
        return None;
    }
    Some((bytes.to_vec(), content_type))
}

async fn fetch_youtube_preview(client: &reqwest::Client, url: &str, video_id: &str) -> LinkPreview {
    let mut preview = LinkPreview::empty(url);
    preview.embed_url = Some(format!("https://www.youtube-nocookie.com/embed/{video_id}"));
    preview.site_name = Some("YouTube".to_string());

    let oembed_url = format!(
        "https://www.youtube.com/oembed?url={}&format=json",
        urlencoding::encode(url)
    );
    if let Some((bytes, _)) = fetch_bytes(client, &oembed_url, MAX_HTML_BYTES).await {
        if let Ok(data) = serde_json::from_slice::<YoutubeOembed>(&bytes) {
            preview.title = data.title;
            if let Some(author) = data.author_name {
                preview.site_name = Some(author);
            }
            if let Some(thumb_url) = data.thumbnail_url {
                if let Some((img_bytes, content_type)) =
                    fetch_bytes(client, &thumb_url, MAX_IMAGE_BYTES).await
                {
                    preview.thumbnail_data_uri =
                        Some(image_data_uri(&img_bytes, content_type.as_deref()));
                }
            }
        }
    }
    preview
}

async fn fetch_generic_preview(client: &reqwest::Client, url: &str) -> LinkPreview {
    let mut preview = LinkPreview::empty(url);

    let Some((html_bytes, content_type)) = fetch_bytes(client, url, MAX_HTML_BYTES).await else {
        return preview;
    };
    let is_html = content_type
        .as_deref()
        .map(|ct| ct.contains("html"))
        .unwrap_or(true);
    if !is_html {
        return preview;
    }
    let html = String::from_utf8_lossy(&html_bytes);

    preview.title = meta_content(&html, &["og:title", "twitter:title"]).or_else(|| page_title(&html));
    preview.description = meta_content(&html, &["og:description", "twitter:description", "description"]);
    preview.site_name = meta_content(&html, &["og:site_name"]).or_else(|| {
        url::Url::parse(url)
            .ok()
            .and_then(|u| u.host_str().map(|h| h.trim_start_matches("www.").to_string()))
    });

    if let Some(image) = meta_content(&html, &["og:image", "og:image:url", "twitter:image"]) {
        if let Some(resolved) = resolve_image_url(url, &image) {
            if let Some((img_bytes, img_content_type)) =
                fetch_bytes(client, &resolved, MAX_IMAGE_BYTES).await
            {
                preview.thumbnail_data_uri =
                    Some(image_data_uri(&img_bytes, img_content_type.as_deref()));
            }
        }
    }

    preview
}

/// Fetch a rich preview (title, site, thumbnail, and for YouTube an
/// embeddable video id) for a URL a user pasted into a note. Uses an on-disk
/// cache keyed by the URL, so opening a note repeatedly doesn't re-fetch.
///
/// Returns `Ok` even when nothing could be found — every field but `url` is
/// then `None`, and the frontend falls back to a plain hyperlink rather than
/// treating that as an error.
#[tauri::command]
pub async fn fetch_link_preview(app: AppHandle, url: String) -> Result<LinkPreview, String> {
    let url = url.trim().to_string();
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Ok(LinkPreview::empty(&url));
    }

    let dir = cache_dir(&app)?;
    let key = cache_key(&url);
    let hit = dir.join(format!("{key}.json"));
    let miss = dir.join(format!("{key}.miss"));

    if let Ok(contents) = fs::read_to_string(&hit) {
        if let Ok(preview) = serde_json::from_str::<LinkPreview>(&contents) {
            return Ok(preview);
        }
    }
    if let Ok(contents) = fs::read_to_string(&miss) {
        if let Ok(at) = contents.trim().parse::<i64>() {
            if now_secs() - at < MISS_TTL_SECS {
                return Ok(LinkPreview::empty(&url));
            }
        }
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .user_agent("Mozilla/5.0 (compatible; Stockfolio/1.0)")
        .build()
        .map_err(|e| e.to_string())?;

    let preview = match youtube_video_id(&url) {
        Some(id) => fetch_youtube_preview(&client, &url, &id).await,
        None => fetch_generic_preview(&client, &url).await,
    };

    if preview.title.is_some() || preview.thumbnail_data_uri.is_some() || preview.embed_url.is_some() {
        if let Ok(json) = serde_json::to_string(&preview) {
            let _ = fs::write(&hit, json);
            let _ = fs::remove_file(&miss);
        }
    } else {
        let _ = fs::write(&miss, now_secs().to_string());
    }

    Ok(preview)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_youtube_ids_from_common_url_shapes() {
        assert_eq!(
            youtube_video_id("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
            Some("dQw4w9WgXcQ".to_string())
        );
        assert_eq!(
            youtube_video_id("https://youtu.be/dQw4w9WgXcQ?si=abc123"),
            Some("dQw4w9WgXcQ".to_string())
        );
        assert_eq!(
            youtube_video_id("https://www.youtube.com/shorts/dQw4w9WgXcQ"),
            Some("dQw4w9WgXcQ".to_string())
        );
        assert_eq!(youtube_video_id("https://example.com/watch?v=abc"), None);
    }

    #[test]
    fn extracts_open_graph_meta_regardless_of_attribute_order() {
        let html = r#"<html><head>
            <meta content="Cool Article" property="og:title">
            <meta property="og:image" content="https://example.com/img.png">
        </head></html>"#;
        assert_eq!(meta_content(html, &["og:title"]), Some("Cool Article".to_string()));
        assert_eq!(
            meta_content(html, &["og:image"]),
            Some("https://example.com/img.png".to_string())
        );
    }

    #[test]
    fn resolves_relative_image_urls() {
        assert_eq!(
            resolve_image_url("https://example.com/a/b", "/img.png"),
            Some("https://example.com/img.png".to_string())
        );
        assert_eq!(
            resolve_image_url("https://example.com/a/b", "//cdn.example.com/img.png"),
            Some("https://cdn.example.com/img.png".to_string())
        );
        assert_eq!(
            resolve_image_url("https://example.com/a/b", "https://cdn.example.com/img.png"),
            Some("https://cdn.example.com/img.png".to_string())
        );
    }
}
