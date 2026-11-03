//! One owned engine per user data directory. Never attach to an arbitrary localhost service.
use fs2::FileExt;
use serde::Serialize;
use std::fs::{self, File, OpenOptions};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::Manager;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Connection {
    pub base_url: String,
    pub token: String,
    pub data_dir: String,
    pub study_dir: String,
}
#[derive(Default)]
pub struct Runtime {
    child: Option<Child>,
    lock: Option<File>,
    connection: Option<Connection>,
    descriptor: Option<PathBuf>,
}
pub struct Service(pub Mutex<Runtime>);

pub fn data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    // KRATT_DATA_DIR is a developer/test override, never set by the normal launcher.
    if let Some(path) = std::env::var_os("KRATT_DATA_DIR") {
        let path = PathBuf::from(path);
        if !path.is_absolute() { return Err("KRATT_DATA_DIR must be an absolute path".into()); }
        return Ok(path);
    }
    #[cfg(target_os = "windows")]
    let base = app.path().config_dir();
    #[cfg(not(target_os = "windows"))]
    let base = app.path().data_dir();
    Ok(base.map_err(|e| e.to_string())?.join(if cfg!(target_os = "linux") { "kratt" } else { "Kratt" }))
}

fn healthy(connection: &Connection) -> bool {
    let Ok(client) = reqwest::blocking::Client::builder().no_proxy().timeout(Duration::from_millis(600)).build() else { return false; };
    let Ok(reply) = client.get(format!("{}/health", connection.base_url)).bearer_auth(&connection.token).send() else { return false; };
    let Ok(value) = reply.json::<serde_json::Value>() else { return false; };
    value["service"] == "kratt-engine" && value["protocol"] == 1 && value["ok"] == true
}

impl Runtime {
    pub fn start(&mut self, dir: &Path) -> Result<Connection, String> {
        if let Some(connection) = &self.connection {
            if self.child.as_mut().is_some_and(|child| matches!(child.try_wait(), Ok(None))) && healthy(connection) {
                return Ok(connection.clone());
            }
        }
        self.stop();
        for name in ["", "Study", "logs", "temp"] {
            fs::create_dir_all(dir.join(name)).map_err(|e| format!("Can't create {}: {e}", dir.display()))?;
        }
        if self.lock.is_none() {
            let lock = OpenOptions::new().read(true).write(true).create(true).truncate(false)
                .open(dir.join("engine.lock")).map_err(|e| e.to_string())?;
            lock.try_lock_exclusive().map_err(|_| "Kratt is already open for this data folder. Switch to its other window.".to_string())?;
            self.lock = Some(lock);
        }
        let token = uuid::Uuid::new_v4().to_string();
        let descriptor = dir.join("temp").join(format!("engine-{token}.json"));
        self.descriptor = Some(descriptor.clone());
        let executable = std::env::current_exe().map_err(|e| e.to_string())?;
        let sidecar = executable.parent().ok_or("Can't locate the Kratt application")?
            .join(if cfg!(windows) { "kratt-engine.exe" } else { "kratt-engine" });
        let log_path = dir.join("logs/engine.log");
        if log_path.exists() { let _ = fs::rename(&log_path, dir.join("logs/engine.previous.log")); }
        let log = File::create(&log_path).map_err(|e| e.to_string())?;
        let mut command = Command::new(sidecar);
        command.args(["--exit-with-stdin", "--port", "0", "--data-dir"])
            .arg(dir).arg("--ready-file").arg(&descriptor)
            .env("KRATT_ENGINE_TOKEN", &token)
            .stdin(Stdio::piped()).stdout(log.try_clone().map_err(|e| e.to_string())?).stderr(log);
        #[cfg(windows)] {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x0800_0000);
        }
        self.child = Some(command.spawn().map_err(|e| format!("Can't start the bundled engine: {e}. Reinstall Kratt or open {}.", log_path.display()))?);
        let deadline = Instant::now() + Duration::from_secs(45);
        while Instant::now() < deadline {
            if let Some(child) = self.child.as_mut() {
                if let Ok(Some(status)) = child.try_wait() {
                    self.stop();
                    return Err(format!("The engine stopped ({status}). See {} and try again.", log_path.display()));
                }
            }
            if let Ok(text) = fs::read_to_string(&descriptor) {
                if let Ok(ready) = serde_json::from_str::<serde_json::Value>(&text) {
                    if let Some(port) = ready["port"].as_u64().filter(|p| *p > 0 && *p <= 65535) {
                        let connection = Connection { base_url: format!("http://127.0.0.1:{port}"), token: token.clone(),
                            data_dir: dir.display().to_string(), study_dir: ready["folder"].as_str().unwrap_or("").into() };
                        if healthy(&connection) {
                            let _ = fs::remove_file(&descriptor);
                            self.connection = Some(connection.clone());
                            return Ok(connection);
                        }
                    }
                }
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        self.stop();
        Err(format!("The engine didn't become ready in 45 seconds. See {} and try again.", log_path.display()))
    }

    pub fn stop(&mut self) {
        self.connection = None;
        if let Some(path) = self.descriptor.take() { let _ = fs::remove_file(path); }
        if let Some(mut child) = self.child.take() {
            drop(child.stdin.take());
            let deadline = Instant::now() + Duration::from_secs(35);
            while Instant::now() < deadline {
                if matches!(child.try_wait(), Ok(Some(_))) { return; }
                std::thread::sleep(Duration::from_millis(100));
            }
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}
impl Drop for Runtime { fn drop(&mut self) { self.stop(); } }

#[tauri::command]
pub async fn desktop_start(app: tauri::AppHandle) -> Result<Connection, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dir = data_dir(&app)?;
        app.state::<Service>().0.lock().map_err(|e| e.to_string())?.start(&dir)
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn desktop_open(app: tauri::AppHandle, target: String) -> Result<(), String> {
    let path = match target.as_str() {
        "ollama" => return open::that("https://ollama.com/download").map_err(|e| e.to_string()),
        "logs" => data_dir(&app)?.join("logs"),
        "data" => data_dir(&app)?,
        _ => return Err("Unknown destination".into()),
    };
    open::that(path).map_err(|e| e.to_string())
}
