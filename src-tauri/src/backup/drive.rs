//! Google Drive access: OAuth (PKCE + loopback redirect), token storage in Windows
//! Credential Manager, and the few Drive calls a backup needs. Only the
//! `drive.file` scope is used, so the app can see just the files it created.

use super::models::DriveBackup;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use rand::distributions::Alphanumeric;
use rand::Rng;
use reqwest::blocking::{Client, Response};
use reqwest::{StatusCode, Url};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::File;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::Path;
use std::time::{Duration, Instant};

const AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const REVOKE_URL: &str = "https://oauth2.googleapis.com/revoke";
const USERINFO_URL: &str = "https://www.googleapis.com/oauth2/v3/userinfo";
const DRIVE_URL: &str = "https://www.googleapis.com/drive/v3";
const UPLOAD_URL: &str = "https://www.googleapis.com/upload/drive/v3/files";
const SCOPES: &str = "https://www.googleapis.com/auth/drive.file openid email";
const FOLDER_NAME: &str = "Mononmani Backups";
const KEYRING_SERVICE: &str = "com.manonmani.app";
const KEYRING_USER: &str = "google-drive";

pub const REAUTH_MESSAGE: &str =
    "Google sign-in has expired or was removed. Press Connect Google Drive to reconnect; your data is safe.";
pub const OFFLINE_MESSAGE: &str = "You're offline or Google Drive can't be reached. Connect to the internet and try again.";
pub const DRIVE_FULL_MESSAGE: &str =
    "Google Drive is full. Open Google Drive, delete the oldest backups in the Mononmani Backups folder, then back up again.";

/// Saved in Windows Credential Manager, never in the database or a file.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Credentials {
    pub client_id: String,
    pub client_secret: String,
    pub refresh_token: Option<String>,
    pub email: Option<String>,
}

fn entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).map_err(|e| format!("Credential store unavailable: {}", e))
}

pub fn load_credentials() -> Result<Option<Credentials>, String> {
    match entry()?.get_password() {
        Ok(json) => Ok(serde_json::from_str(&json).ok()),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("Could not read the saved Google sign-in: {}", e)),
    }
}

pub fn save_credentials(creds: &Credentials) -> Result<(), String> {
    let json = serde_json::to_string(creds).map_err(|e| e.to_string())?;
    entry()?
        .set_password(&json)
        .map_err(|e| format!("Could not save the Google sign-in: {}", e))
}

pub fn clear_credentials() -> Result<(), String> {
    match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("Could not remove the Google sign-in: {}", e)),
    }
}

fn client() -> Result<Client, String> {
    Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(300))
        .build()
        .map_err(|e| format!("Could not start the network client: {}", e))
}

fn net_err(e: reqwest::Error) -> String {
    if e.is_connect() || e.is_timeout() || e.is_request() {
        OFFLINE_MESSAGE.to_string()
    } else {
        format!("Network problem talking to Google: {}", e)
    }
}

/// Turn a failed HTTP response into a message a non-technical user can act on.
fn api_err(resp: Response) -> String {
    let status = resp.status();
    let body = resp.text().unwrap_or_default();
    if status == StatusCode::UNAUTHORIZED || body.contains("invalid_grant") {
        return REAUTH_MESSAGE.to_string();
    }
    if body.contains("storageQuotaExceeded") || body.contains("quotaExceeded") {
        return DRIVE_FULL_MESSAGE.to_string();
    }
    if status == StatusCode::FORBIDDEN || status == StatusCode::NOT_FOUND {
        return format!(
            "Google Drive refused the request ({}). If you deleted the backup folder or revoked access, reconnect Google Drive.",
            status.as_u16()
        );
    }
    let short: String = body.chars().take(200).collect();
    format!("Google Drive error {}: {}", status.as_u16(), short)
}

// ---- Sign-in -------------------------------------------------------------

pub struct PendingAuth {
    pub url: String,
    listener: TcpListener,
    verifier: String,
    state: String,
    redirect_uri: String,
}

fn random_string(len: usize) -> String {
    rand::thread_rng().sample_iter(&Alphanumeric).take(len).map(char::from).collect()
}

/// Start sign-in: open a loopback port and build the Google consent URL.
pub fn begin_auth(client_id: &str) -> Result<PendingAuth, String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| format!("Could not open a local sign-in port: {}", e))?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let redirect_uri = format!("http://127.0.0.1:{}", port);
    let verifier = random_string(64);
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let state = random_string(24);
    let url = Url::parse_with_params(
        AUTH_URL,
        &[
            ("client_id", client_id),
            ("redirect_uri", redirect_uri.as_str()),
            ("response_type", "code"),
            ("scope", SCOPES),
            ("code_challenge", challenge.as_str()),
            ("code_challenge_method", "S256"),
            ("state", state.as_str()),
            ("access_type", "offline"),
            ("prompt", "consent"),
        ],
    )
    .map_err(|e| e.to_string())?
    .to_string();
    Ok(PendingAuth { url, listener, verifier, state, redirect_uri })
}

const DONE_PAGE: &str = "<html><body style=\"font-family:sans-serif;padding:3rem\"><h2>Google Drive connected</h2>\
    <p>You can close this tab and return to Mononmani Welding Works.</p></body></html>";

fn reply(stream: &mut std::net::TcpStream, status: &str, body: &str) {
    let _ = write!(
        stream,
        "HTTP/1.1 {}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        status,
        body.len(),
        body
    );
}

/// Wait for the browser to come back with the code, then trade it for tokens.
pub fn finish_auth(pending: PendingAuth, creds: &Credentials) -> Result<Credentials, String> {
    pending.listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let deadline = Instant::now() + Duration::from_secs(180);
    let code = loop {
        if Instant::now() > deadline {
            return Err("Sign-in timed out. Press Connect Google Drive and try again.".to_string());
        }
        match pending.listener.accept() {
            Ok((mut stream, _)) => {
                let _ = stream.set_nonblocking(false);
                let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
                let mut buf = [0u8; 4096];
                let n = stream.read(&mut buf).unwrap_or(0);
                let request = String::from_utf8_lossy(&buf[..n]).to_string();
                let path = request.lines().next().and_then(|l| l.split_whitespace().nth(1)).unwrap_or("/");
                let url = Url::parse(&format!("http://127.0.0.1{}", path)).map_err(|e| e.to_string())?;
                let get = |key: &str| url.query_pairs().find(|(k, _)| k == key).map(|(_, v)| v.to_string());
                if let Some(err) = get("error") {
                    reply(&mut stream, "400 Bad Request", "<html><body>Sign-in was cancelled. You can close this tab.</body></html>");
                    return Err(format!("Google sign-in was cancelled ({}).", err));
                }
                match (get("code"), get("state")) {
                    (Some(code), Some(state)) if state == pending.state => {
                        reply(&mut stream, "200 OK", DONE_PAGE);
                        break code;
                    }
                    _ => reply(&mut stream, "404 Not Found", "Not found"),
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => std::thread::sleep(Duration::from_millis(200)),
            Err(e) => return Err(format!("Sign-in failed: {}", e)),
        }
    };

    let http = client()?;
    let resp = http
        .post(TOKEN_URL)
        .form(&[
            ("client_id", creds.client_id.as_str()),
            ("client_secret", creds.client_secret.as_str()),
            ("code", code.as_str()),
            ("code_verifier", pending.verifier.as_str()),
            ("redirect_uri", pending.redirect_uri.as_str()),
            ("grant_type", "authorization_code"),
        ])
        .send()
        .map_err(net_err)?;
    if !resp.status().is_success() {
        let body = resp.text().unwrap_or_default();
        if body.contains("invalid_client") {
            return Err("Google rejected the Client ID or Client secret. Check them and try again.".to_string());
        }
        return Err(format!("Google sign-in failed: {}", body.chars().take(200).collect::<String>()));
    }
    #[derive(Deserialize)]
    struct Tokens {
        access_token: String,
        refresh_token: Option<String>,
    }
    let tokens: Tokens = resp.json().map_err(|e| format!("Unexpected sign-in reply: {}", e))?;
    let refresh = tokens
        .refresh_token
        .ok_or("Google did not return a long-lived sign-in. Remove the app under your Google account's third-party access and connect again.")?;

    #[derive(Deserialize)]
    struct UserInfo {
        email: Option<String>,
    }
    let email = http
        .get(USERINFO_URL)
        .bearer_auth(&tokens.access_token)
        .send()
        .ok()
        .and_then(|r| r.json::<UserInfo>().ok())
        .and_then(|u| u.email);

    Ok(Credentials {
        client_id: creds.client_id.clone(),
        client_secret: creds.client_secret.clone(),
        refresh_token: Some(refresh),
        email,
    })
}

pub fn revoke(creds: &Credentials) {
    if let (Ok(http), Some(token)) = (client(), creds.refresh_token.as_ref()) {
        let _ = http.post(REVOKE_URL).form(&[("token", token.as_str())]).send();
    }
}

// ---- Drive calls ---------------------------------------------------------

pub struct DriveFile {
    pub id: String,
    pub size: i64,
    pub md5: String,
}

pub struct Drive {
    http: Client,
    token: String,
}

fn parse_size(v: &serde_json::Value) -> i64 {
    v.as_str().and_then(|s| s.parse().ok()).or_else(|| v.as_i64()).unwrap_or(0)
}

impl Drive {
    /// Exchange the saved refresh token for a short-lived access token.
    pub fn connect(creds: &Credentials) -> Result<Drive, String> {
        let refresh = creds.refresh_token.as_ref().ok_or("Connect Google Drive first.")?;
        let http = client()?;
        let resp = http
            .post(TOKEN_URL)
            .form(&[
                ("client_id", creds.client_id.as_str()),
                ("client_secret", creds.client_secret.as_str()),
                ("refresh_token", refresh.as_str()),
                ("grant_type", "refresh_token"),
            ])
            .send()
            .map_err(net_err)?;
        if !resp.status().is_success() {
            return Err(api_err(resp));
        }
        let v: serde_json::Value = resp.json().map_err(|e| e.to_string())?;
        let token = v["access_token"].as_str().ok_or("Google returned no access token.")?.to_string();
        Ok(Drive { http, token })
    }

    fn json(&self, resp: Response) -> Result<serde_json::Value, String> {
        if !resp.status().is_success() {
            return Err(api_err(resp));
        }
        resp.json().map_err(|e| format!("Unexpected reply from Google Drive: {}", e))
    }

    /// The backup folder, created on first use. Only folders this app made are visible to it.
    pub fn ensure_folder(&self) -> Result<String, String> {
        let q = format!(
            "name = '{}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false",
            FOLDER_NAME
        );
        let resp = self
            .http
            .get(format!("{}/files", DRIVE_URL))
            .bearer_auth(&self.token)
            .query(&[("q", q.as_str()), ("fields", "files(id)"), ("pageSize", "1")])
            .send()
            .map_err(net_err)?;
        let v = self.json(resp)?;
        if let Some(id) = v["files"][0]["id"].as_str() {
            return Ok(id.to_string());
        }
        let resp = self
            .http
            .post(format!("{}/files", DRIVE_URL))
            .bearer_auth(&self.token)
            .query(&[("fields", "id")])
            .json(&serde_json::json!({ "name": FOLDER_NAME, "mimeType": "application/vnd.google-apps.folder" }))
            .send()
            .map_err(net_err)?;
        let v = self.json(resp)?;
        Ok(v["id"].as_str().ok_or("Drive did not return the new folder.")?.to_string())
    }

    fn list_raw(&self, folder: &str, name_filter: &str) -> Result<Vec<serde_json::Value>, String> {
        let q = format!("'{}' in parents and trashed = false and name contains '{}'", folder, name_filter);
        let resp = self
            .http
            .get(format!("{}/files", DRIVE_URL))
            .bearer_auth(&self.token)
            .query(&[
                ("q", q.as_str()),
                ("fields", "files(id,name,size,createdTime,md5Checksum)"),
                ("orderBy", "createdTime desc"),
                ("pageSize", "1000"),
            ])
            .send()
            .map_err(net_err)?;
        let v = self.json(resp)?;
        Ok(v["files"].as_array().cloned().unwrap_or_default())
    }

    /// Remove half-finished uploads left by an interrupted backup.
    pub fn delete_partials(&self, folder: &str) -> Result<(), String> {
        for f in self.list_raw(folder, ".partial")? {
            if let Some(id) = f["id"].as_str() {
                let _ = self.delete(id);
            }
        }
        Ok(())
    }

    pub fn delete(&self, id: &str) -> Result<(), String> {
        let resp = self
            .http
            .delete(format!("{}/files/{}", DRIVE_URL, id))
            .bearer_auth(&self.token)
            .send()
            .map_err(net_err)?;
        if resp.status().is_success() || resp.status() == StatusCode::NOT_FOUND {
            Ok(())
        } else {
            Err(api_err(resp))
        }
    }

    /// Upload under a temporary name; `rename` makes it final once verified.
    pub fn upload(&self, folder: &str, local: &Path, temp_name: &str, props: serde_json::Value) -> Result<DriveFile, String> {
        let start = self
            .http
            .post(UPLOAD_URL)
            .bearer_auth(&self.token)
            .query(&[("uploadType", "resumable"), ("fields", "id,size,md5Checksum")])
            .header("X-Upload-Content-Type", "application/gzip")
            .json(&serde_json::json!({ "name": temp_name, "parents": [folder], "appProperties": props }))
            .send()
            .map_err(net_err)?;
        if !start.status().is_success() {
            return Err(api_err(start));
        }
        let location = start
            .headers()
            .get("location")
            .and_then(|v| v.to_str().ok())
            .ok_or("Google Drive did not give an upload address.")?
            .to_string();

        let mut bytes = Vec::new();
        File::open(local)
            .and_then(|mut f| f.read_to_end(&mut bytes))
            .map_err(|e| format!("Could not read the backup file: {}", e))?;
        let resp = self
            .http
            .put(location)
            .header("Content-Type", "application/gzip")
            .body(bytes)
            .send()
            .map_err(net_err)?;
        let v = self.json(resp)?;
        Ok(DriveFile {
            id: v["id"].as_str().ok_or("Drive did not confirm the upload.")?.to_string(),
            size: parse_size(&v["size"]),
            md5: v["md5Checksum"].as_str().unwrap_or_default().to_string(),
        })
    }

    pub fn rename(&self, id: &str, name: &str) -> Result<(), String> {
        let resp = self
            .http
            .patch(format!("{}/files/{}", DRIVE_URL, id))
            .bearer_auth(&self.token)
            .json(&serde_json::json!({ "name": name }))
            .send()
            .map_err(net_err)?;
        self.json(resp).map(|_| ())
    }

    pub fn list_backups(&self, folder: &str) -> Result<Vec<DriveBackup>, String> {
        Ok(self
            .list_raw(folder, ".db.gz")?
            .into_iter()
            .filter(|f| f["name"].as_str().map(|n| !n.ends_with(".partial")).unwrap_or(false))
            .map(|f| DriveBackup {
                id: f["id"].as_str().unwrap_or_default().to_string(),
                name: f["name"].as_str().unwrap_or_default().to_string(),
                size_bytes: parse_size(&f["size"]),
                created_at: f["createdTime"].as_str().unwrap_or_default().to_string(),
            })
            .collect())
    }

    /// Download a backup file and return Drive's MD5 for it.
    pub fn download(&self, id: &str, dest: &Path) -> Result<String, String> {
        let meta = self
            .http
            .get(format!("{}/files/{}", DRIVE_URL, id))
            .bearer_auth(&self.token)
            .query(&[("fields", "md5Checksum")])
            .send()
            .map_err(net_err)?;
        let md5 = self.json(meta)?["md5Checksum"].as_str().unwrap_or_default().to_string();

        let mut resp = self
            .http
            .get(format!("{}/files/{}", DRIVE_URL, id))
            .bearer_auth(&self.token)
            .query(&[("alt", "media")])
            .send()
            .map_err(net_err)?;
        if !resp.status().is_success() {
            return Err(api_err(resp));
        }
        let mut out = File::create(dest).map_err(|e| e.to_string())?;
        resp.copy_to(&mut out).map_err(net_err)?;
        Ok(md5)
    }

    /// (used, limit) bytes of the Google account's storage.
    pub fn quota(&self) -> Result<(Option<i64>, Option<i64>), String> {
        let resp = self
            .http
            .get(format!("{}/about", DRIVE_URL))
            .bearer_auth(&self.token)
            .query(&[("fields", "storageQuota(limit,usage)")])
            .send()
            .map_err(net_err)?;
        let v = self.json(resp)?;
        let get = |k: &str| v["storageQuota"][k].as_str().and_then(|s| s.parse::<i64>().ok());
        Ok((get("usage"), get("limit")))
    }
}
