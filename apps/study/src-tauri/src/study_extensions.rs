//! Package store for study extensions: stage (download or read a zip, verify,
//! unpack safely), commit, discard and remove. Archives are untrusted.

use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use tauri::Manager;

const BAD_HASH: &str = "This download is damaged or was changed. Nothing was installed.";
const NO_MANIFEST: &str = "This isn't a study extension (no extension.json)";
const DOWNLOAD_CAP: u64 = 50 * 1024 * 1024;

pub struct Limits {
    pub max_total: u64,
    pub max_entries: usize,
}

impl Limits {
    pub const DEFAULT: Limits = Limits {
        max_total: 50 * 1024 * 1024,
        max_entries: 2000,
    };
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Staged {
    pub staging_id: String,
    pub manifest_json: String,
    pub files: Vec<String>,
}

pub fn verify_sha256(bytes: &[u8], expected_hex: &str) -> bool {
    let actual = hex::encode(Sha256::digest(bytes));
    actual.eq_ignore_ascii_case(expected_hex.trim())
}

// Same rule as manifest.js: ^[a-z0-9]+(\.[a-z0-9-]+)+$, at most 64 chars.
fn valid_id(id: &str) -> bool {
    if id.is_empty() || id.len() > 64 {
        return false;
    }
    let mut parts = id.split('.');
    let first = parts.next().unwrap_or("");
    if first.is_empty() || !first.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit()) {
        return false;
    }
    let mut n = 0;
    for p in parts {
        n += 1;
        if p.is_empty() || !p.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-') {
            return false;
        }
    }
    n > 0
}

// Same rule as semver.js: MAJOR.MINOR.PATCH with an optional -prerelease.
fn valid_version(v: &str) -> bool {
    let (core, pre) = match v.split_once('-') {
        Some((c, p)) => (c, Some(p)),
        None => (v, None),
    };
    let nums: Vec<&str> = core.split('.').collect();
    if nums.len() != 3 || !nums.iter().all(|n| !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit())) {
        return false;
    }
    match pre {
        None => true,
        Some(p) => !p.is_empty() && p.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-'),
    }
}

fn check_id_version(id: &str, version: &str) -> Result<(), String> {
    check_id(id)?;
    check_version(version)
}
fn check_id(id: &str) -> Result<(), String> {
    if valid_id(id) { Ok(()) } else { Err("Invalid extension id".into()) }
}
fn check_version(version: &str) -> Result<(), String> {
    if valid_version(version) { Ok(()) } else { Err("Invalid extension version".into()) }
}
fn check_staging_id(s: &str) -> Result<(), String> {
    uuid::Uuid::parse_str(s).map(|_| ()).map_err(|_| "Invalid staging id".to_string())
}

/// Validate an archive entry name and return its normalised segments.
fn clean_segments(raw: &str) -> Result<Vec<String>, String> {
    let bad = || format!("Bad path in archive: {raw}");
    let name = raw.replace('\\', "/");
    if name.starts_with('/') || name.contains('\0') {
        return Err(bad());
    }
    let mut out = Vec::new();
    for seg in name.split('/') {
        if seg.is_empty() || seg == "." {
            continue;
        }
        // ".." escapes; ':' catches Windows drive letters, prefixes and streams.
        if seg == ".." || seg.contains(':') {
            return Err(bad());
        }
        out.push(seg.to_string());
    }
    Ok(out)
}

pub fn unpack_archive(zip_bytes: &[u8], dest: &Path, limits: &Limits) -> Result<(), String> {
    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(zip_bytes))
        .map_err(|_| BAD_HASH.to_string())?;
    if archive.len() > limits.max_entries {
        return Err("Archive has too many files".into());
    }

    // Pass 1: validate every entry and work out the folder to strip.
    let mut entries: Vec<(usize, Vec<String>, bool)> = Vec::new();
    for i in 0..archive.len() {
        let f = archive.by_index(i).map_err(|_| BAD_HASH.to_string())?;
        let name = f.name().to_string();
        if let Some(mode) = f.unix_mode() {
            if mode & 0o170000 == 0o120000 {
                return Err(format!("Archive contains a link: {name}"));
            }
        }
        let segs = clean_segments(&name)?;
        if segs.is_empty() {
            continue;
        }
        entries.push((i, segs, f.is_dir()));
    }
    let strip = match entries.first() {
        Some((_, first, _)) => entries
            .iter()
            .all(|(_, s, is_dir)| s[0] == first[0] && (s.len() > 1 || *is_dir)),
        None => false,
    };

    // Pass 2: write, counting the bytes actually read.
    fs::create_dir_all(dest).map_err(|e| e.to_string())?;
    let mut total: u64 = 0;
    for (i, segs, is_dir) in entries {
        let rel: &[String] = if strip { &segs[1..] } else { &segs[..] };
        if rel.is_empty() {
            continue;
        }
        let mut target = dest.to_path_buf();
        for s in rel {
            target.push(s);
        }
        if is_dir {
            fs::create_dir_all(&target).map_err(|e| e.to_string())?;
            continue;
        }
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let f = archive.by_index(i).map_err(|_| BAD_HASH.to_string())?;
        let remaining = limits.max_total - total;
        let mut buf = Vec::new();
        f.take(remaining.saturating_add(1))
            .read_to_end(&mut buf)
            .map_err(|_| BAD_HASH.to_string())?;
        if buf.len() as u64 > remaining {
            return Err("Archive is too large".into());
        }
        total += buf.len() as u64;
        let mut out = fs::File::create(&target).map_err(|e| e.to_string())?;
        out.write_all(&buf).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn list_files(dir: &Path) -> Result<Vec<String>, String> {
    fn walk(base: &Path, dir: &Path, out: &mut Vec<String>) -> Result<(), String> {
        for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            let ty = entry.file_type().map_err(|e| e.to_string())?;
            if ty.is_dir() {
                walk(base, &path, out)?;
            } else if ty.is_file() {
                let rel = path.strip_prefix(base).map_err(|e| e.to_string())?;
                let parts: Vec<String> = rel.iter().map(|c| c.to_string_lossy().into_owned()).collect();
                out.push(parts.join("/"));
            }
        }
        Ok(())
    }
    let mut out = Vec::new();
    walk(dir, dir, &mut out)?;
    out.sort();
    Ok(out)
}

fn staging_dir(root: &Path) -> PathBuf {
    root.join(".staging")
}

fn stage_bytes_inner(root: &Path, bytes: &[u8]) -> Result<Staged, String> {
    let staging_id = uuid::Uuid::new_v4().to_string();
    let dir = staging_dir(root).join(&staging_id);
    let result = (|| {
        unpack_archive(bytes, &dir, &Limits::DEFAULT)?;
        let manifest_path = dir.join("extension.json");
        if !manifest_path.is_file() {
            return Err(NO_MANIFEST.to_string());
        }
        let manifest_json = fs::read_to_string(&manifest_path)
            .map_err(|_| "The extension file isn't valid".to_string())?;
        let files = list_files(&dir)?;
        Ok(Staged { staging_id: staging_id.clone(), manifest_json, files })
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(&dir);
    }
    result
}

pub fn stage_file_inner(root: &Path, path: &str) -> Result<Staged, String> {
    let meta = fs::metadata(path).map_err(|_| "Couldn't read that file".to_string())?;
    if meta.len() > DOWNLOAD_CAP {
        return Err("Archive is too large".into());
    }
    let bytes = fs::read(path).map_err(|_| "Couldn't read that file".to_string())?;
    stage_bytes_inner(root, &bytes)
}

pub fn stage_verified_bytes_inner(root: &Path, bytes: &[u8], sha256: &str) -> Result<Staged, String> {
    if !verify_sha256(bytes, sha256) {
        return Err(BAD_HASH.into());
    }
    stage_bytes_inner(root, bytes)
}

pub fn ext_commit_inner(root: &Path, staging_id: &str, id: &str, version: &str) -> Result<(), String> {
    check_id_version(id, version)?;
    check_staging_id(staging_id)?;
    let src = staging_dir(root).join(staging_id);
    if !src.is_dir() {
        return Err("Nothing is staged to install".into());
    }
    let id_dir = root.join(id);
    let target = id_dir.join(version);
    fs::create_dir_all(&id_dir).map_err(|e| e.to_string())?;
    // Keep the installed copy until the new one is in place.
    let backup = if target.exists() {
        let b = id_dir.join(format!(".old-{}", uuid::Uuid::new_v4()));
        fs::rename(&target, &b).map_err(|e| e.to_string())?;
        Some(b)
    } else {
        None
    };
    if let Err(e) = fs::rename(&src, &target) {
        if let Some(b) = &backup {
            let _ = fs::rename(b, &target);
        }
        return Err(e.to_string());
    }
    if let Some(b) = backup {
        let _ = fs::remove_dir_all(b);
    }
    Ok(())
}

pub fn ext_discard_inner(root: &Path, staging_id: &str) -> Result<(), String> {
    check_staging_id(staging_id)?;
    let dir = staging_dir(root).join(staging_id);
    if dir.exists() {
        fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn ext_remove_inner(root: &Path, id: &str, version: Option<&str>) -> Result<(), String> {
    check_id(id)?;
    let target = match version {
        Some(v) => {
            check_version(v)?;
            root.join(id).join(v)
        }
        None => root.join(id),
    };
    if target.exists() {
        fs::remove_dir_all(&target).map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn ext_root<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|p| p.join("study-extensions"))
        .map_err(|e| e.to_string())
}

const DOWNLOAD_FAILED: &str = "Couldn't download that. Check your connection and try again.";

/// Reads a `file://` download source with the size cap. Other schemes are rejected.
fn read_download_source(url: &str, max: u64) -> Result<Vec<u8>, String> {
    let parsed = url::Url::parse(url).map_err(|_| DOWNLOAD_FAILED.to_string())?;
    if parsed.scheme() != "file" {
        return Err(DOWNLOAD_FAILED.into());
    }
    let path = parsed.to_file_path().map_err(|_| DOWNLOAD_FAILED.to_string())?;
    let meta = fs::metadata(&path).map_err(|_| DOWNLOAD_FAILED.to_string())?;
    if meta.len() > max {
        return Err("Archive is too large".into());
    }
    let mut buf = Vec::new();
    fs::File::open(&path)
        .and_then(|f| f.take(max + 1).read_to_end(&mut buf))
        .map_err(|_| DOWNLOAD_FAILED.to_string())?;
    if buf.len() as u64 > max {
        return Err("Archive is too large".into());
    }
    Ok(buf)
}

async fn download(url: &str) -> Result<Vec<u8>, String> {
    download_capped(url, DOWNLOAD_CAP, 30, false).await
}

async fn download_capped(url: &str, cap: u64, timeout_secs: u64, https_only: bool) -> Result<Vec<u8>, String> {
    let fail = || DOWNLOAD_FAILED.to_string();
    match url::Url::parse(url) {
        Ok(u) if u.scheme() == "https" || (!https_only && u.scheme() == "http") => {}
        _ => return Err(fail()),
    }
    let mut builder = reqwest::Client::builder().timeout(std::time::Duration::from_secs(timeout_secs));
    if https_only {
        builder = builder.redirect(https_only_policy());
    }
    let client = builder
        .build()
        .map_err(|_| fail())?;
    let mut resp = client.get(url).send().await.map_err(|_| fail())?;
    if !resp.status().is_success() {
        return Err(fail());
    }
    if resp.content_length().map_or(false, |n| n > cap) {
        return Err("Archive is too large".into());
    }
    let mut bytes: Vec<u8> = Vec::new();
    while let Some(chunk) = resp.chunk().await.map_err(|_| fail())? {
        if bytes.len() as u64 + chunk.len() as u64 > cap {
            return Err("Archive is too large".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

#[tauri::command]
pub async fn ext_stage_download(app: tauri::AppHandle, url: String, sha256: String) -> Result<Staged, String> {
    let root = ext_root(&app)?;
    let is_file = url::Url::parse(&url).map_or(false, |u| u.scheme() == "file");
    let bytes = if is_file { read_download_source(&url, DOWNLOAD_CAP)? } else { download(&url).await? };
    stage_verified_bytes_inner(&root, &bytes, &sha256)
}

#[tauri::command]
pub async fn ext_stage_file(app: tauri::AppHandle, path: String) -> Result<Staged, String> {
    let root = ext_root(&app)?;
    stage_file_inner(&root, &path)
}

#[tauri::command]
pub async fn ext_commit(app: tauri::AppHandle, staging_id: String, id: String, version: String) -> Result<(), String> {
    ext_commit_inner(&ext_root(&app)?, &staging_id, &id, &version)
}

#[tauri::command]
pub async fn ext_discard(app: tauri::AppHandle, staging_id: String) -> Result<(), String> {
    ext_discard_inner(&ext_root(&app)?, &staging_id)
}

#[tauri::command]
pub async fn ext_remove(app: tauri::AppHandle, id: String, version: Option<String>) -> Result<(), String> {
    ext_remove_inner(&ext_root(&app)?, &id, version.as_deref())
}

// ---- study-ext:// protocol -------------------------------------------------

// ---- Network commands (catalog and study.fetch) ----

const FETCH_TEXT_CAP: u64 = 2 * 1024 * 1024;
const PROXY_CAP: usize = 5 * 1024 * 1024;
const MAX_REDIRECTS: usize = 5;

/// Allows https and file URLs (file is for the local dev catalog). Plain http is
/// refused: a network attacker could swap the catalog's sha256 values.
pub fn check_fetch_url(raw: &str) -> Result<url::Url, String> {
    let u = url::Url::parse(raw).map_err(|_| "That address isn't valid".to_string())?;
    match u.scheme() {
        "https" | "file" => Ok(u),
        _ => Err("Only https and file addresses are supported".into()),
    }
}

/// True for loopback, private, link-local and unspecified addresses (v4 and v6).
pub fn is_blocked_ip(ip: std::net::IpAddr) -> bool {
    use std::net::IpAddr;
    match ip {
        IpAddr::V4(v4) => {
            v4.is_loopback() || v4.is_private() || v4.is_link_local() || v4.is_unspecified()
        }
        IpAddr::V6(v6) => {
            if let Some(v4) = v6.to_ipv4_mapped() {
                return is_blocked_ip(IpAddr::V4(v4));
            }
            let first = v6.segments()[0];
            v6.is_loopback()
                || v6.is_unspecified()
                || (first & 0xfe00) == 0xfc00 // fc00::/7
                || (first & 0xffc0) == 0xfe80 // fe80::/10
        }
    }
}

/// https only, and no IP-literal (or localhost) hosts in blocked ranges.
pub fn check_proxy_url(raw: &str) -> Result<url::Url, String> {
    let u = url::Url::parse(raw).map_err(|_| "That address isn't valid".to_string())?;
    if u.scheme() != "https" {
        return Err("Only https addresses are allowed".into());
    }
    let blocked = match u.host() {
        None => return Err("That address isn't valid".into()),
        Some(url::Host::Ipv4(ip)) => is_blocked_ip(ip.into()),
        Some(url::Host::Ipv6(ip)) => is_blocked_ip(ip.into()),
        Some(url::Host::Domain(d)) => {
            let d = d.trim_end_matches('.').to_ascii_lowercase();
            d == "localhost" || d.ends_with(".localhost")
        }
    };
    if blocked {
        return Err("That address isn't allowed".into());
    }
    Ok(u)
}

#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub enum RedirectAction {
    Follow,
    Stop,
    TooMany,
}

/// `previous` holds the initial URL plus every hop already taken (reqwest's
/// `Attempt::previous`), so N earlier redirects means `previous.len() == N + 1`.
/// Follows at most 5 redirects, and only https ones that stay on the first host.
pub fn redirect_action(previous: &[url::Url], next: &url::Url) -> RedirectAction {
    if previous.len() > MAX_REDIRECTS {
        return RedirectAction::TooMany;
    }
    let same = previous.first().map_or(false, |first| first.host_str() == next.host_str());
    if next.scheme() == "https" && same {
        RedirectAction::Follow
    } else {
        RedirectAction::Stop
    }
}

/// Anything not followed stops and the redirect response is returned as-is.
fn same_host_https_policy() -> reqwest::redirect::Policy {
    reqwest::redirect::Policy::custom(|attempt| match redirect_action(attempt.previous(), attempt.url()) {
        RedirectAction::Follow => attempt.follow(),
        RedirectAction::Stop => attempt.stop(),
        RedirectAction::TooMany => attempt.error("too many redirects"),
    })
}

/// No https-to-http downgrade for the catalog fetch.
fn https_only_policy() -> reqwest::redirect::Policy {
    reqwest::redirect::Policy::custom(|attempt| {
        if attempt.previous().len() > 10 {
            attempt.error("too many redirects")
        } else if attempt.url().scheme() == "https" {
            attempt.follow()
        } else {
            attempt.stop()
        }
    })
}

/// Drops headers the caller must not control: Host (domain fronting past the
/// host grant), framing headers and hop-by-hop headers.
pub fn sanitize_headers(
    headers: std::collections::HashMap<String, String>,
) -> std::collections::HashMap<String, String> {
    const DROP: [&str; 8] =
        ["host", "content-length", "transfer-encoding", "connection", "upgrade", "te", "trailer", "keep-alive"];
    headers
        .into_iter()
        .filter(|(k, _)| {
            let k = k.to_ascii_lowercase();
            !DROP.contains(&k.as_str()) && !k.starts_with("proxy-")
        })
        .collect()
}

fn decode_text(bytes: Vec<u8>) -> Result<String, String> {
    String::from_utf8(bytes).map_err(|_| "That file isn't text".to_string())
}

#[tauri::command]
pub async fn ext_fetch_text(url: String) -> Result<String, String> {
    let parsed = check_fetch_url(&url)?;
    let bytes = if parsed.scheme() == "file" {
        read_download_source(&url, FETCH_TEXT_CAP)?
    } else {
        download_capped(&url, FETCH_TEXT_CAP, 15, true).await?
    };
    decode_text(bytes)
}

#[derive(serde::Deserialize, Debug)]
pub struct ProxyRequest {
    pub url: String,
    #[serde(default)]
    pub method: Option<String>,
    #[serde(default)]
    pub headers: std::collections::HashMap<String, String>,
    #[serde(default)]
    pub body: Option<String>,
}

#[derive(Serialize, Debug)]
pub struct ProxyResponse {
    pub status: u16,
    pub headers: std::collections::HashMap<String, String>,
    pub body: String,
}

/// Rust does not check extension permissions; the host does before calling this.
#[tauri::command]
pub async fn ext_proxy_fetch(req: ProxyRequest) -> Result<ProxyResponse, String> {
    let url = check_proxy_url(&req.url)?;
    let fail = |_| "The request failed".to_string();
    let method = reqwest::Method::from_bytes(req.method.as_deref().unwrap_or("GET").to_ascii_uppercase().as_bytes())
        .map_err(|_| "Unsupported request method".to_string())?;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .redirect(same_host_https_policy())
        .build()
        .map_err(fail)?;
    let mut builder = client.request(method, url);
    for (k, v) in &sanitize_headers(req.headers) {
        builder = builder.header(k.as_str(), v.as_str());
    }
    if let Some(body) = req.body {
        builder = builder.body(body);
    }
    let mut resp = builder.send().await.map_err(fail)?;
    if resp.content_length().map_or(false, |n| n > PROXY_CAP as u64) {
        return Err("The response was too large".into());
    }
    let status = resp.status().as_u16();
    let mut headers = std::collections::HashMap::new();
    for (k, v) in resp.headers() {
        if let Ok(v) = v.to_str() {
            headers
                .entry(k.as_str().to_string())
                .and_modify(|e: &mut String| {
                    e.push_str(", ");
                    e.push_str(v);
                })
                .or_insert_with(|| v.to_string());
        }
    }
    let mut bytes: Vec<u8> = Vec::new();
    while let Some(chunk) = resp.chunk().await.map_err(fail)? {
        if bytes.len() + chunk.len() > PROXY_CAP {
            return Err("The response was too large".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(ProxyResponse { status, headers, body: String::from_utf8_lossy(&bytes).into_owned() })
}

pub const FRAME_CSP: &str = "default-src 'none'; script-src study-ext: http://study-ext.localhost 'unsafe-inline'; style-src study-ext: http://study-ext.localhost 'unsafe-inline'; img-src study-ext: http://study-ext.localhost data: blob:; font-src study-ext: http://study-ext.localhost data:; connect-src 'none'";

const CLIENT_JS: &[u8] = include_bytes!("../../src/views/studyhome/extensions/client/study-extension.js");
const CLIENT_CSS: &[u8] = include_bytes!("../../src/views/studyhome/extensions/client/study-extension.css");
// The app's fonts, so frames look native (their CSP only allows study-ext: fonts).
const ARCHIVO: &[u8] = include_bytes!("../../src/views/studyhome/extensions/client/archivo-latin-wdth-normal.woff2");
const JETBRAINS_MONO: &[u8] = include_bytes!("../../src/views/studyhome/extensions/client/jetbrains-mono-latin-400-normal.woff2");

/// Map `<id>/<version>/<rest>` (already percent-encoded, no leading slash) to a
/// file inside `root`. Returns None for anything that is not an existing file
/// strictly inside `root`.
pub fn resolve_asset(root: &Path, uri_path: &str) -> Option<PathBuf> {
    let decoded = urlencoding::decode(uri_path).ok()?;
    if decoded.contains('\0') || decoded.contains('\\') {
        return None;
    }
    let mut parts = decoded.splitn(3, '/');
    let id = parts.next()?;
    let version = parts.next()?;
    let rest = parts.next()?;
    if !valid_id(id) || !valid_version(version) || rest.is_empty() {
        return None;
    }
    if rest.split('/').any(|s| s.is_empty() || s == "." || s == "..") {
        return None;
    }
    let root = root.canonicalize().ok()?;
    let full = root.join(id).join(version).join(rest).canonicalize().ok()?;
    if full.starts_with(&root) && full.is_file() {
        Some(full)
    } else {
        None
    }
}

/// Files the host injects into every extension frame.
pub fn client_asset(name: &str) -> Option<(&'static str, &'static [u8])> {
    match name {
        "_client/study-extension.js" => Some(("text/javascript", CLIENT_JS)),
        "_client/study-extension.css" => Some(("text/css", CLIENT_CSS)),
        "_client/archivo.woff2" => Some(("font/woff2", ARCHIVO)),
        "_client/jetbrains-mono.woff2" => Some(("font/woff2", JETBRAINS_MONO)),
        _ => None,
    }
}

fn mime_for(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).as_deref() {
        Some("html") | Some("htm") => "text/html; charset=utf-8",
        Some("js") | Some("mjs") => "text/javascript",
        Some("css") => "text/css",
        Some("json") => "application/json",
        Some("png") => "image/png",
        Some("svg") => "image/svg+xml",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("woff2") => "font/woff2",
        _ => "application/octet-stream",
    }
}

fn respond(status: u16, mime: &str, body: Vec<u8>) -> tauri::http::Response<Vec<u8>> {
    tauri::http::Response::builder()
        .status(status)
        .header("Content-Type", mime)
        .header("Content-Security-Policy", FRAME_CSP)
        .header("X-Content-Type-Options", "nosniff")
        .header("Access-Control-Allow-Origin", "*")
        .body(body)
        .expect("static response headers are valid")
}

/// `path` is the request path without its leading slash.
pub fn build_response(root: &Path, path: &str) -> tauri::http::Response<Vec<u8>> {
    if let Some((mime, bytes)) = client_asset(path) {
        return respond(200, mime, bytes.to_vec());
    }
    match resolve_asset(root, path).and_then(|f| fs::read(&f).ok().map(|b| (f, b))) {
        Some((file, bytes)) => respond(200, mime_for(&file), bytes),
        None => respond(404, "text/plain; charset=utf-8", b"Not found".to_vec()),
    }
}

pub fn protocol<R: tauri::Runtime>(
    ctx: tauri::UriSchemeContext<'_, R>,
    request: tauri::http::Request<Vec<u8>>,
) -> tauri::http::Response<Vec<u8>> {
    let root = match ext_root(ctx.app_handle()) {
        Ok(r) => r,
        Err(_) => return respond(404, "text/plain; charset=utf-8", b"Not found".to_vec()),
    };
    build_response(&root, request.uri().path().trim_start_matches('/'))
}

#[cfg(test)]
mod tests {
    use super::*;
    use zip::write::SimpleFileOptions;

    fn make_zip(entries: &[(&str, &[u8], Option<u32>)]) -> Vec<u8> {
        let mut w = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        for (name, data, mode) in entries {
            let mut opts = SimpleFileOptions::default();
            if let Some(m) = mode {
                opts = opts.unix_permissions(*m);
            }
            w.start_file(*name, opts).unwrap();
            w.write_all(data).unwrap();
        }
        w.finish().unwrap().into_inner()
    }
    fn plain(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let v: Vec<_> = entries.iter().map(|(n, d)| (*n, *d, None)).collect();
        make_zip(&v)
    }

    #[test]
    fn unpacks_plain_archive() {
        let dir = tempfile::tempdir().unwrap();
        let z = plain(&[("extension.json", b"{}"), ("a/b.txt", b"hi")]);
        unpack_archive(&z, dir.path(), &Limits::DEFAULT).unwrap();
        assert_eq!(fs::read(dir.path().join("extension.json")).unwrap(), b"{}");
        assert_eq!(fs::read(dir.path().join("a/b.txt")).unwrap(), b"hi");
    }

    #[test]
    fn strips_single_top_folder() {
        let dir = tempfile::tempdir().unwrap();
        let z = plain(&[("pkg/extension.json", b"{}"), ("pkg/w/x.html", b"x")]);
        unpack_archive(&z, dir.path(), &Limits::DEFAULT).unwrap();
        assert!(dir.path().join("extension.json").is_file());
        assert!(dir.path().join("w/x.html").is_file());
        assert!(!dir.path().join("pkg").exists());
    }

    #[test]
    fn rejects_parent_dir_entry() {
        let dir = tempfile::tempdir().unwrap();
        let z = plain(&[("extension.json", b"{}"), ("../evil.txt", b"x")]);
        let e = unpack_archive(&z, dir.path(), &Limits::DEFAULT).unwrap_err();
        assert!(e.starts_with("Bad path in archive"), "{e}");
        let z = plain(&[("a/../../evil.txt", b"x")]);
        assert!(unpack_archive(&z, dir.path(), &Limits::DEFAULT).is_err());
    }

    #[test]
    fn rejects_absolute_entry() {
        let dir = tempfile::tempdir().unwrap();
        for name in ["/etc/passwd", "C:/x.txt", "\\\\srv\\share\\x", "C:\\x.txt"] {
            let z = plain(&[(name, b"x")]);
            let e = unpack_archive(&z, dir.path(), &Limits::DEFAULT).unwrap_err();
            assert!(e.starts_with("Bad path in archive"), "{name}: {e}");
        }
    }

    #[test]
    fn rejects_symlink_entry() {
        let dir = tempfile::tempdir().unwrap();
        // unix_permissions() masks to 0o777, so build a real symlink entry
        // (mode 0o120777) with add_symlink.
        let mut w = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        w.add_symlink("link", "/etc/passwd", SimpleFileOptions::default()).unwrap();
        let z = w.finish().unwrap().into_inner();
        let e = unpack_archive(&z, dir.path(), &Limits::DEFAULT).unwrap_err();
        assert!(e.starts_with("Archive contains a link"), "{e}");
    }

    #[test]
    fn rejects_too_many_entries() {
        let dir = tempfile::tempdir().unwrap();
        let z = plain(&[("a", b"1"), ("b", b"1"), ("c", b"1"), ("d", b"1")]);
        let l = Limits { max_total: u64::MAX, max_entries: 3 };
        assert_eq!(unpack_archive(&z, dir.path(), &l).unwrap_err(), "Archive has too many files");
    }

    #[test]
    fn rejects_oversized_total() {
        let dir = tempfile::tempdir().unwrap();
        let z = plain(&[("a", b"12345678901")]);
        let l = Limits { max_total: 10, max_entries: 10 };
        assert_eq!(unpack_archive(&z, dir.path(), &l).unwrap_err(), "Archive is too large");
        // Total across files, not per file.
        let z = plain(&[("a", b"123456"), ("b", b"123456")]);
        assert_eq!(unpack_archive(&z, dir.path(), &l).unwrap_err(), "Archive is too large");
    }

    #[test]
    fn sha256_match_and_mismatch() {
        let h = hex::encode(Sha256::digest(b"abc"));
        assert!(verify_sha256(b"abc", &h));
        assert!(verify_sha256(b"abc", &h.to_uppercase()));
        assert!(!verify_sha256(b"abd", &h));
    }

    #[test]
    fn rejects_bad_id_before_join() {
        let dir = tempfile::tempdir().unwrap();
        assert!(ext_commit_inner(dir.path(), "x", "../../etc", "1.0.0").is_err());
        let sid = uuid::Uuid::new_v4().to_string();
        assert!(ext_commit_inner(dir.path(), &sid, "study.ok", "../../1.0.0").is_err());
        assert!(ext_remove_inner(dir.path(), "..", None).is_err());
        assert!(ext_remove_inner(dir.path(), "study.ok", Some("../x")).is_err());
        assert!(ext_discard_inner(dir.path(), "../x").is_err());
    }

    #[test]
    fn id_and_version_rules() {
        for ok in ["study.flashcards", "a1.b-c.d"] {
            assert!(valid_id(ok), "{ok}");
        }
        for bad in ["", "study", "Study.x", ".x", "a..b", "a.", "a.b/c", &format!("a.{}", "b".repeat(63))] {
            assert!(!valid_id(bad), "{bad}");
        }
        assert!(valid_version("1.2.3") && valid_version("1.0.0-beta.1"));
        for bad in ["1.2", "1.2.x", "../1.0.0", "1.2.3/", "", "1.2.3-"] {
            assert!(!valid_version(bad), "{bad}");
        }
    }

    #[test]
    fn stage_commit_remove_roundtrip() {
        let root = tempfile::tempdir().unwrap();
        let zdir = tempfile::tempdir().unwrap();
        let zp = zdir.path().join("e.zip");
        fs::write(&zp, plain(&[("top/extension.json", b"{\"id\":\"a.b\"}"), ("top/w.html", b"w")])).unwrap();
        let s = stage_file_inner(root.path(), zp.to_str().unwrap()).unwrap();
        assert_eq!(s.manifest_json, "{\"id\":\"a.b\"}");
        assert_eq!(s.files, vec!["extension.json", "w.html"]);
        ext_commit_inner(root.path(), &s.staging_id, "a.b", "1.0.0").unwrap();
        assert!(root.path().join("a.b/1.0.0/w.html").is_file());
        // replace existing
        let s2 = stage_file_inner(root.path(), zp.to_str().unwrap()).unwrap();
        ext_commit_inner(root.path(), &s2.staging_id, "a.b", "1.0.0").unwrap();
        ext_remove_inner(root.path(), "a.b", Some("1.0.0")).unwrap();
        assert!(!root.path().join("a.b/1.0.0").exists());
        ext_remove_inner(root.path(), "a.b", None).unwrap();
        assert!(!root.path().join("a.b").exists());
        // discard
        let s3 = stage_file_inner(root.path(), zp.to_str().unwrap()).unwrap();
        ext_discard_inner(root.path(), &s3.staging_id).unwrap();
        assert!(!root.path().join(".staging").join(&s3.staging_id).exists());
    }

    #[test]
    fn stage_without_manifest_and_bad_hash() {
        let root = tempfile::tempdir().unwrap();
        let z = plain(&[("readme.txt", b"x")]);
        let e = stage_verified_bytes_inner(root.path(), &z, &hex::encode(Sha256::digest(&z))).unwrap_err();
        assert_eq!(e, NO_MANIFEST);
        assert!(fs::read_dir(root.path().join(".staging")).unwrap().next().is_none());
        let e = stage_verified_bytes_inner(root.path(), &z, "00").unwrap_err();
        assert_eq!(e, BAD_HASH);
    }

    #[test]
    fn commit_replaces_existing_without_leftovers() {
        let root = tempfile::tempdir().unwrap();
        let zdir = tempfile::tempdir().unwrap();
        let zp = zdir.path().join("e.zip");
        fs::write(&zp, plain(&[("extension.json", b"{}"), ("new.txt", b"n")])).unwrap();
        let target = root.path().join("a.b/1.0.0");
        fs::create_dir_all(&target).unwrap();
        fs::write(target.join("old.txt"), b"o").unwrap();
        let s = stage_file_inner(root.path(), zp.to_str().unwrap()).unwrap();
        ext_commit_inner(root.path(), &s.staging_id, "a.b", "1.0.0").unwrap();
        assert!(target.join("new.txt").is_file());
        assert!(!target.join("old.txt").exists());
        let names: Vec<_> = fs::read_dir(root.path().join("a.b")).unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();
        assert_eq!(names, vec!["1.0.0"], "no backup left behind");
    }

    #[test]
    fn unreadable_zips_give_damaged_message() {
        let dir = tempfile::tempdir().unwrap();
        let l = &Limits::DEFAULT;
        assert_eq!(unpack_archive(b"not a zip at all", dir.path(), l).unwrap_err(), BAD_HASH);
        let good = plain(&[("extension.json", b"{\"id\":\"a.b\"}"), ("w.html", b"some content here")]);
        let truncated = &good[..good.len() / 2];
        assert_eq!(unpack_archive(truncated, dir.path(), l).unwrap_err(), BAD_HASH);
        // Corrupt the stored data of the first entry (local header is 30 + name len bytes).
        let mut bad = good.clone();
        let off = 30 + "extension.json".len();
        bad[off] ^= 0xff;
        assert_eq!(unpack_archive(&bad, dir.path(), l).unwrap_err(), BAD_HASH);
    }

    #[test]
    fn file_urls_stage_and_other_schemes_are_rejected() {
        let root = tempfile::tempdir().unwrap();
        let zdir = tempfile::tempdir().unwrap();
        let zp = zdir.path().join("e.zip");
        let z = plain(&[("extension.json", b"{}")]);
        fs::write(&zp, &z).unwrap();
        let url = url::Url::from_file_path(&zp).unwrap().to_string();
        let bytes = read_download_source(&url, DOWNLOAD_CAP).unwrap();
        let h = hex::encode(Sha256::digest(&z));
        assert!(stage_verified_bytes_inner(root.path(), &bytes, &h).is_ok());
        assert_eq!(stage_verified_bytes_inner(root.path(), &bytes, "00").unwrap_err(), BAD_HASH);
        assert!(read_download_source(&url, 3).is_err(), "cap applies");
        assert!(read_download_source("ftp://example.com/x.zip", DOWNLOAD_CAP).is_err());
    }

    fn serve_root() -> tempfile::TempDir {
        let d = tempfile::tempdir().unwrap();
        let v = d.path().join("a.b").join("1.0.0");
        fs::create_dir_all(v.join("sub")).unwrap();
        fs::write(v.join("index.html"), "<p>hi</p>").unwrap();
        fs::write(v.join("sub").join("app.js"), "1").unwrap();
        fs::write(d.path().join("secret.txt"), "s").unwrap();
        d
    }

    #[test]
    fn resolve_inside_root() {
        let d = serve_root();
        let p = resolve_asset(d.path(), "a.b/1.0.0/sub/app.js").unwrap();
        assert!(p.ends_with("sub/app.js"));
        assert!(resolve_asset(d.path(), "a.b/1.0.0/index.html").is_some());
        assert!(resolve_asset(d.path(), "a.b/1.0.0/missing.html").is_none());
    }

    #[test]
    fn resolve_rejects_traversal() {
        let d = serve_root();
        assert!(resolve_asset(d.path(), "a.b/1.0.0/../../secret.txt").is_none());
        assert!(resolve_asset(d.path(), "a.b/1.0.0/..\\..\\secret.txt").is_none());
    }

    #[test]
    fn resolve_rejects_encoded_traversal() {
        let d = serve_root();
        assert!(resolve_asset(d.path(), "a.b/1.0.0/%2e%2e/%2e%2e/secret.txt").is_none());
        assert!(resolve_asset(d.path(), "a.b/1.0.0/%2e%2e%2f%2e%2e%2fsecret.txt").is_none());
    }

    #[test]
    fn resolve_rejects_bad_id() {
        let d = serve_root();
        assert!(resolve_asset(d.path(), "A.B/1.0.0/index.html").is_none());
        assert!(resolve_asset(d.path(), "../1.0.0/index.html").is_none());
        assert!(resolve_asset(d.path(), "a.b/latest/index.html").is_none());
        assert!(resolve_asset(d.path(), "a.b/1.0.0").is_none());
    }

    #[test]
    fn client_asset_known_and_unknown() {
        let (m, b) = client_asset("_client/study-extension.js").unwrap();
        assert_eq!(m, "text/javascript");
        assert!(!b.is_empty());
        assert!(client_asset("_client/study-extension.css").is_some());
        for font in ["_client/archivo.woff2", "_client/jetbrains-mono.woff2"] {
            let (m, b) = client_asset(font).unwrap();
            assert_eq!(m, "font/woff2");
            assert_eq!(&b[..4], b"wOF2");
        }
        assert!(client_asset("_client/other.js").is_none());
    }

    #[test]
    fn response_has_csp_header() {
        let d = serve_root();
        let r = build_response(d.path(), "a.b/1.0.0/index.html");
        assert_eq!(r.status(), 200);
        assert_eq!(r.headers()["Content-Security-Policy"], FRAME_CSP);
        assert_eq!(r.headers()["X-Content-Type-Options"], "nosniff");
        assert_eq!(r.headers()["Access-Control-Allow-Origin"], "*");
        assert_eq!(r.headers()["Content-Type"], "text/html; charset=utf-8");
        assert_eq!(r.body(), b"<p>hi</p>");
        let js = build_response(d.path(), "a.b/1.0.0/sub/app.js");
        assert_eq!(js.headers()["Content-Type"], "text/javascript");
        let c = build_response(d.path(), "_client/study-extension.css");
        assert_eq!(c.status(), 200);
        let nf = build_response(d.path(), "a.b/1.0.0/../../secret.txt");
        assert_eq!(nf.status(), 404);
        assert_eq!(nf.headers()["Content-Security-Policy"], FRAME_CSP);
    }

    #[cfg(unix)]
    #[test]
    fn resolve_rejects_symlink_escape() {
        let d = serve_root();
        let outside = tempfile::tempdir().unwrap();
        fs::write(outside.path().join("secret.txt"), "s").unwrap();
        std::os::unix::fs::symlink(
            outside.path().join("secret.txt"),
            d.path().join("a.b").join("1.0.0").join("link.txt"),
        )
        .unwrap();
        assert!(resolve_asset(d.path(), "a.b/1.0.0/link.txt").is_none());
    }

    #[test]
    fn resolve_rejects_odd_encodings() {
        let d = serve_root();
        for p in [
            "a.b/1.0.0/..%5c..%5csecret.txt",
            "a.b/1.0.0/index.html%00.png",
            "a.b/1.0.0/%252e%252e/%252e%252e/secret.txt",
            "a.b/1.0.0/%2fetc%2fpasswd",
            "a.b%2f1.0.0%2f..%2f..%2fsecret.txt",
        ] {
            assert!(resolve_asset(d.path(), p).is_none(), "{p}");
        }
    }

    #[test]
    fn resolve_missing_root_is_none() {
        let d = serve_root();
        assert!(resolve_asset(&d.path().join("nope"), "a.b/1.0.0/index.html").is_none());
    }

    #[test]
    fn not_found_has_security_headers() {
        let d = serve_root();
        let r = build_response(d.path(), "a.b/1.0.0/missing.html");
        assert_eq!(r.status(), 404);
        assert_eq!(r.headers()["Content-Security-Policy"], FRAME_CSP);
        assert_eq!(r.headers()["X-Content-Type-Options"], "nosniff");
        assert_eq!(r.headers()["Access-Control-Allow-Origin"], "*");
    }

    #[test]
    fn proxy_rejects_http() {
        assert!(check_proxy_url("http://example.com/a").is_err());
        assert!(check_proxy_url("https://example.com/a").is_ok());
    }

    #[test]
    fn fetch_text_rejects_ftp() {
        assert!(check_fetch_url("ftp://example.com/catalog.json").is_err());
        assert!(check_fetch_url("https://example.com/catalog.json").is_ok());
        assert!(check_fetch_url("http://example.com/catalog.json").is_err());
        assert!(check_fetch_url("file:///tmp/catalog.json").is_ok());
        assert!(check_fetch_url("not a url").is_err());
    }

    #[test]
    fn proxy_rejects_blocked_ip_literals() {
        for u in [
            "https://127.0.0.1:3333/",
            "https://[::1]/",
            "https://169.254.169.254/latest/meta-data",
            "https://10.0.0.5/",
            "https://172.16.0.1/",
            "https://192.168.1.1/",
            "https://0.0.0.0/",
            "https://[::]/",
            "https://[fc00::1]/",
            "https://[fd12:3456::1]/",
            "https://[fe80::1]/",
            "https://[::ffff:127.0.0.1]/",
            "https://localhost:5055/",
        ] {
            assert!(check_proxy_url(u).is_err(), "{u} should be rejected");
        }
    }

    #[test]
    fn proxy_allows_public_hosts_and_ips() {
        for u in ["https://api.example.com/x", "https://8.8.8.8/", "https://172.32.0.1/", "https://[2606:4700::1111]/"] {
            assert!(check_proxy_url(u).is_ok(), "{u} should be allowed");
        }
    }

    #[test]
    fn blocked_ip_ranges() {
        let b = |s: &str| is_blocked_ip(s.parse().unwrap());
        assert!(b("127.0.0.1") && b("10.0.0.5") && b("172.31.255.255") && b("169.254.0.1"));
        assert!(!b("172.15.0.1") && !b("11.0.0.1") && !b("1.1.1.1"));
        assert!(b("::1") && b("fe80::abcd") && b("fc00::1") && b("::ffff:10.0.0.1"));
        assert!(!b("2001:db8::1"));
    }

    fn u(s: &str) -> url::Url {
        url::Url::parse(s).unwrap()
    }

    #[test]
    fn redirect_action_rules() {
        let first = u("https://api.example.com/a");
        assert_eq!(redirect_action(&[first.clone()], &u("https://other.example.com/")), RedirectAction::Stop);
        assert_eq!(redirect_action(&[first.clone()], &u("http://api.example.com/b")), RedirectAction::Stop);
        assert_eq!(redirect_action(&[first.clone()], &u("https://api.example.com/b")), RedirectAction::Follow);
    }

    #[test]
    fn redirect_action_allows_five_redirects() {
        let first = u("https://api.example.com/0");
        // previous holds the initial URL plus the earlier hops.
        let mut prev = vec![first];
        for i in 1..=4 {
            prev.push(u(&format!("https://api.example.com/{i}")));
        }
        // 4 earlier redirects done: the 5th redirect follows.
        assert_eq!(redirect_action(&prev, &u("https://api.example.com/5")), RedirectAction::Follow);
        prev.push(u("https://api.example.com/5"));
        // the 6th is too many.
        assert_eq!(redirect_action(&prev, &u("https://api.example.com/6")), RedirectAction::TooMany);
    }

    #[test]
    fn sanitize_headers_drops_host_and_hop_by_hop() {
        let mut h = std::collections::HashMap::new();
        for k in ["Host", "HOST", "Content-Length", "transfer-encoding", "Connection", "Upgrade", "TE", "Trailer", "Keep-Alive", "Proxy-Authorization", "proxy-connection"] {
            h.insert(k.to_string(), "x".to_string());
        }
        h.insert("Authorization".into(), "Bearer t".into());
        h.insert("Content-Type".into(), "application/json".into());
        let out = sanitize_headers(h);
        let mut keys: Vec<_> = out.keys().cloned().collect();
        keys.sort();
        assert_eq!(keys, vec!["Authorization", "Content-Type"]);
    }
}
