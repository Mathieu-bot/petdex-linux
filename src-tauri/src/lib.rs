use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::State;

/// Runtime state file written by the sidecar
const RUNTIME_DIR: &str = "petdex/runtime";

/// Where pets are stored
const PET_DIRS: &[&str] = &[
    ".petdex/pets",
];

#[derive(Debug, Serialize)]
pub struct PetInfo {
    pub name: String,
    pub slug: String,
    pub sprite_path: String,
}

#[derive(Debug, Serialize)]
pub struct RuntimeState {
    pub state: String,
    pub counter: u64,
}

#[derive(Debug, Serialize)]
pub struct BubbleData {
    pub text: String,
    pub counter: u64,
}

/// Pet selected in active.json (written by `npx petdex select` or our select_pet)
#[derive(Debug, Serialize, Deserialize)]
pub struct ActivePet {
    pub slug: String,
}

pub struct SidecarState {
    pub child: Mutex<Option<std::process::Child>>,
}

pub struct RuntimeCounter {
    pub state_counter: Mutex<u64>,
    pub bubble_counter: Mutex<u64>,
}

/// Find the home directory
fn home_dir() -> PathBuf {
    std::env::var("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("/tmp"))
}

/// Find a pet by slug across all PET_DIRS
fn find_pet_by_slug(home: &PathBuf, slug: &str) -> Option<PetInfo> {
    for dir_rel in PET_DIRS {
        let pet_dir = home.join(dir_rel).join(slug);
        if !pet_dir.is_dir() {
            continue;
        }
        let pet_json_path = pet_dir.join("pet.json");
        if !pet_json_path.exists() {
            continue;
        }
        for ext in &["spritesheet.webp", "spritesheet.png"] {
            let sprite_path = pet_dir.join(ext);
            if sprite_path.exists() {
                if let Ok(content) = fs::read_to_string(&pet_json_path) {
                    if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                        if let Some(dn) = json.get("displayName").and_then(|v| v.as_str()) {
                            return Some(PetInfo {
                                name: dn.to_string(),
                                slug: slug.to_string(),
                                sprite_path: sprite_path.to_string_lossy().to_string(),
                            });
                        }
                    }
                }
                return Some(PetInfo {
                    name: slug.to_string(),
                    slug: slug.to_string(),
                    sprite_path: sprite_path.to_string_lossy().to_string(),
                });
            }
        }
    }
    None
}

/// Get the currently active pet — checks active.json first, falls back to first found
#[tauri::command]
fn get_active_pet() -> Result<PetInfo, String> {
    let home = home_dir();

    // 1. Try active.json (written by `npx petdex select` or our select_pet)
    let active_path = home.join(".petdex").join("active.json");
    if active_path.exists() {
        if let Ok(content) = fs::read_to_string(&active_path) {
            if let Ok(active) = serde_json::from_str::<ActivePet>(&content) {
                if let Some(pet) = find_pet_by_slug(&home, &active.slug) {
                    return Ok(pet);
                }
            }
        }
    }

    // 2. Fall back to first valid pet in PET_DIRS order
    for dir_rel in PET_DIRS {
        let pets_dir = home.join(dir_rel);
        if !pets_dir.exists() {
            continue;
        }
        if let Ok(entries) = fs::read_dir(&pets_dir) {
            for entry in entries.flatten() {
                let slug = entry.file_name().to_string_lossy().to_string();
                if let Some(pet) = find_pet_by_slug(&home, &slug) {
                    return Ok(pet);
                }
            }
        }
    }

    Err("no pet found".to_string())
}

/// List all installed pets
#[tauri::command]
fn list_pets() -> Result<Vec<PetInfo>, String> {
    let home = home_dir();
    let mut pets = Vec::new();

    for dir_rel in PET_DIRS {
        let pets_dir = home.join(dir_rel);
        if !pets_dir.exists() {
            continue;
        }
        if let Ok(entries) = fs::read_dir(&pets_dir) {
            for entry in entries.flatten() {
                let slug = entry.file_name().to_string_lossy().to_string();
                if let Some(pet) = find_pet_by_slug(&home, &slug) {
                    pets.push(pet);
                }
            }
        }
    }

    if pets.is_empty() {
        return Err("no pets found".to_string());
    }
    Ok(pets)
}

/// Select a pet by slug — writes active.json so it persists across restarts
#[tauri::command]
fn select_pet(slug: String) -> Result<(), String> {
    let home = home_dir();

    // Verify the pet exists before writing
    if find_pet_by_slug(&home, &slug).is_none() {
        return Err(format!("pet '{slug}' not found"));
    }

    let active_path = home.join(".petdex").join("active.json");
    if let Some(parent) = active_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("create_dir error: {e}"))?;
    }

    let content = serde_json::json!({ "slug": slug }).to_string() + "\n";
    fs::write(&active_path, content).map_err(|e| format!("write error: {e}"))?;

    Ok(())
}

/// Read a file and return its contents as a base64-encoded string
#[tauri::command]
fn read_file_as_base64(path: String) -> Result<String, String> {
    let data = fs::read(&path).map_err(|e| format!("read error: {e}"))?;
    use base64::Engine;
    Ok(base64::engine::general_purpose::STANDARD.encode(&data))
}

/// Spawn the sidecar Node.js process
#[tauri::command]
fn spawn_sidecar(sidecar: State<SidecarState>) -> Result<(), String> {
    let mut child = sidecar.child.lock().unwrap();
    if child.is_some() {
        return Ok(()); // already running
    }

    let sidecar_dir = home_dir().join(".petdex").join("sidecar");
    let server_js = sidecar_dir.join("server.js");

    if !server_js.exists() {
        // Try relative to the app's own sidecar directory
        let exe_dir = std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|p| p.to_path_buf()))
            .unwrap_or_default();
        let bundled_js = exe_dir.join("sidecar").join("server.js");
        if bundled_js.exists() {
            let proc = std::process::Command::new("node")
                .arg(&bundled_js)
                .env("RUNTIME_DIR", home_dir().join(&RUNTIME_DIR))
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .spawn()
                .map_err(|e| format!("spawn error: {e}"))?;
            *child = Some(proc);
            return Ok(());
        }

        // Create runtime dir and try to install sidecar from bundled resources
        let sidecar_dir = home_dir().join(".petdex").join("sidecar");
        let _ = fs::create_dir_all(&sidecar_dir);
        return Err("sidecar not found — run 'npm install' in the sidecar directory".to_string());
    }

    // Ensure runtime dir exists
    let _ = fs::create_dir_all(home_dir().join(&RUNTIME_DIR));

    let proc = std::process::Command::new("node")
        .arg(&server_js)
        .env("RUNTIME_DIR", home_dir().join(&RUNTIME_DIR))
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| format!("spawn error: {e}"))?;

    *child = Some(proc);
    Ok(())
}

/// Stop the sidecar process
#[tauri::command]
fn stop_sidecar(sidecar: State<SidecarState>) -> Result<(), String> {
    let mut child = sidecar.child.lock().unwrap();
    if let Some(ref mut c) = *child {
        let _ = c.kill();
        let _ = c.wait();
    }
    *child = None;
    Ok(())
}

/// Read the current state written by the sidecar
#[tauri::command]
fn read_runtime_state(counter: State<RuntimeCounter>) -> Result<Option<RuntimeState>, String> {
    let state_path = home_dir().join(&RUNTIME_DIR).join("state.json");
    if !state_path.exists() {
        return Ok(None);
    }

    let content = fs::read_to_string(&state_path)
        .map_err(|e| format!("read state error: {e}"))?;
    let val: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("parse state error: {e}"))?;

    let state = val
        .get("state")
        .and_then(|v| v.as_str())
        .unwrap_or("idle")
        .to_string();

    let mut ctr = counter.state_counter.lock().unwrap();
    *ctr += 1;

    Ok(Some(RuntimeState {
        state,
        counter: *ctr,
    }))
}

/// Read the current bubble text written by the sidecar
#[tauri::command]
fn read_runtime_bubble(counter: State<RuntimeCounter>) -> Result<Option<BubbleData>, String> {
    let bubble_path = home_dir().join(&RUNTIME_DIR).join("bubble.json");
    if !bubble_path.exists() {
        return Ok(None);
    }

    let content = fs::read_to_string(&bubble_path)
        .map_err(|e| format!("read bubble error: {e}"))?;
    let val: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("parse bubble error: {e}"))?;

    let text = val
        .get("text")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let mut ctr = counter.bubble_counter.lock().unwrap();
    *ctr += 1;

    Ok(Some(BubbleData {
        text,
        counter: *ctr,
    }))
}

/// Start dragging the window (for frameless window move)
#[tauri::command]
fn start_window_drag(window: tauri::Window) -> Result<(), String> {
    window.start_dragging().map_err(|e| format!("drag: {e}"))
}

/// Quit the application
#[tauri::command]
fn quit_app(app: tauri::AppHandle) -> Result<(), String> {
    app.exit(0);
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(SidecarState {
            child: Mutex::new(None),
        })
        .manage(RuntimeCounter {
            state_counter: Mutex::new(0),
            bubble_counter: Mutex::new(0),
        })
        .invoke_handler(tauri::generate_handler![
            get_active_pet,
            list_pets,
            select_pet,
            read_file_as_base64,
            spawn_sidecar,
            stop_sidecar,
            read_runtime_state,
            read_runtime_bubble,
            start_window_drag,
            quit_app,
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
