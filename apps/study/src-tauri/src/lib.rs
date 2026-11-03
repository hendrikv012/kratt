mod service;
mod study_extensions;
use std::sync::Mutex;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "linux")]
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none()
        && std::path::Path::new("/proc/driver/nvidia/version").exists() {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }
    let app = tauri::Builder::default()
        .register_uri_scheme_protocol("study-ext", study_extensions::protocol)
        .plugin(tauri_plugin_fs::init())
        .manage(service::Service(Mutex::new(service::Runtime::default())))
        .invoke_handler(tauri::generate_handler![
            service::desktop_start, service::desktop_open, service::desktop_open_auth,
            study_extensions::ext_stage_download, study_extensions::ext_stage_file,
            study_extensions::ext_commit, study_extensions::ext_discard,
            study_extensions::ext_remove, study_extensions::ext_fetch_text,
            study_extensions::ext_proxy_fetch
        ])
        .build(tauri::generate_context!()).expect("error while starting Kratt");
    app.run(|handle, event| {
        if let tauri::RunEvent::Exit = event {
            if let Ok(mut runtime) = handle.state::<service::Service>().0.lock() { runtime.stop(); }
        }
    });
}
