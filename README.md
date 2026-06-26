# PetDex Linux 🐼

A floating desktop pet companion for Linux — an animated sprite that lives on top of your workspace and **reacts to what you do**.

**Idle while you browse, run while you code, wave when you chat, sleep when you're away.**

## Features

- 🖼️ **Always-on-top** — floats above all your apps, skip-taskbar
- 🎭 **Animated sprites** — idle, running, waving, jumping, failed, review, waiting
- 🖱️ **Draggable** — click and drag the pet anywhere on screen
- 💬 **Speech bubbles** — shows text from the sidecar
- 🌐 **HTTP API** — any process can control the pet via `localhost:7777`
- 🧠 **Auto activity monitor** — watches your active window and changes the pet's mood automatically
- 🔌 **Standalone** — no internet, no cloud, no AI dependencies

## Prerequisites

| Dependency | Version | Purpose |
|-----------|---------|---------|
| **Rust** | 1.77+ | Compiles the desktop app |
| **Node.js** | 18+ | Runs the sidecar server |
| **xdotool** | any | Detects your active window (activity monitor) |

### Debian / Ubuntu

```bash
sudo apt-get install -y \
  libwebkit2gtk-4.1-dev \
  build-essential \
  libxdo-dev \
  libssl-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev \
  xdotool
```

### Arch

```bash
sudo pacman -S \
  webkit2gtk-4.1 \
  base-devel \
  openssl \
  libayatana-appindicator \
  xdotool
```

### Fedora

```bash
sudo dnf install \
  webkit2gtk4.1-devel \
  gcc gcc-c++ \
  openssl-devel \
  libappindicator-gtk3-devel \
  librsvg2-devel \
  xdotool
```

## Quick Start

```bash
# 1. Clone the repo
git clone https://github.com/Mathieu-bot/petdex-linux
cd petdex-linux

# 2. Install sidecar dependencies (none currently, just Node builtins)
cd sidecar && npm install && cd ..

# 3. Build the app
cd src-tauri && cargo build --release && cd ..

# 4. Link the sidecar so the app can find it
mkdir -p ~/.petdex/sidecar ~/.petdex/pets
cp -r sidecar/* ~/.petdex/sidecar/

# 5. Get a pet spritesheet (see "Adding Pets" below)
#    Then copy it to ~/.petdex/pets/<pet-name>/spritesheet.webp

# 6. Run!
./src-tauri/target/release/petdex-linux
```

Or use the automated install script:

```bash
chmod +x install.sh
./install.sh
```

The install script builds the binary, symlinks it to `~/.local/bin/petdex-desktop`, and installs the sidecar.

## Usage

| Action | What happens |
|--------|-------------|
| **Left-click + drag** | Move the pet around |
| **Right-click** | Quit the app |
| **Switch windows** | Pet changes animation automatically |

### HTTP API

The sidecar runs on `http://127.0.0.1:7777`.

```bash
# Change animation
curl -X POST localhost:7777/state \
  -H 'Content-Type: application/json' \
  -d '{"state":"waving"}'

# Show a speech bubble
curl -X POST localhost:7777/bubble \
  -H 'Content-Type: application/json' \
  -d '{"text":"Hello from Linux! 🐧"}'

# Read current state
curl localhost:7777/state
# → {"state":"waving","timestamp":...}

# Read current bubble
curl localhost:7777/bubble
# → {"text":"Hello from Linux! 🐧","timestamp":...}
```

### Available pet states

| State | When it shows | Spritesheet row |
|-------|--------------|----------------|
| `idle` | Default — no special activity | 0 |
| `running` | You're coding (editor, terminal, builds) | 1 or 7 |
| `waving` | You're chatting (Discord, Slack, Telegram) | 3 |
| `jumping` | Celebrate / happy moment | 4 |
| `failed` | Error dialog or crash on screen | 5 |
| `waiting` | You're on the desktop or idle | 6 |
| `review` | You're browsing files or web | 8 |

The **activity monitor** automatically detects your focused window and picks the right state. You can also set any state manually via the API.

### Desktop Activity Monitor

The app starts a built-in watcher that runs `xdotool` every 2 seconds to check your active window. The pet reacts to:

| You focus… | Pet shows… |
|-----------|-----------|
| VS Code, terminal, vim, builds, cargo | 🏃 `running` |
| Firefox, Brave, Chrome, browser | 🔍 `review` |
| Discord, Slack, Telegram, chat | 👋 `waving` |
| Error dialog, crash window | 😢 `failed` |
| Desktop background, panel | 💤 `waiting` |
| No keyboard/mouse activity for 90 seconds | 😴 `idle` |

You can disable the activity monitor by not running the sidecar — the pet will stay in `idle` until you set a state via the API.

## Adding Pets

Your pet's appearance comes from a **spritesheet** — a single image file containing all animation frames in a grid.

### Directory layout

```
~/.petdex/pets/
  └── my-pet/                # directory name = pet slug
      ├── spritesheet.webp   # required: the sprite grid image
      └── pet.json           # optional: pet metadata
```

### Spritesheet format

| Property | Value |
|----------|-------|
| Size | 1536 × 1872 pixels |
| Frame size | 192 × 208 pixels |
| Grid | 8 columns × 9 rows |
| Format | WebP (recommended) or PNG |

Each row is one animation:

| Row | State | Frames |
|-----|-------|--------|
| 0 | `idle` | 6 |
| 1 | `running` | 8 |
| 2 | `running-left` | 8 |
| 3 | `waving` | 4 |
| 4 | `jumping` | 5 |
| 5 | `failed` | 8 |
| 6 | `waiting` | 6 |
| 7 | `running` | 6 |
| 8 | `review` | 6 |

### pet.json (optional)

```json
{
  "displayName": "Boba"
}
```

If no `pet.json` is found, the directory name is used as the pet name.

### Quick test sprite

To test without a real spritesheet, you can use any 192×208 image repeated in a grid — but for the full effect, use a dedicated spritesheet. Check the [petdex-sprites](https://github.com/Mathieu-bot/petdex-sprites) repo for pre-made pets.

## Architecture

```
petdex-linux/
├── src-tauri/                      # Rust + Tauri v2
│   ├── src/lib.rs                  # Core commands, sidecar management
│   ├── src/main.rs                 # Entry point
│   └── tauri.conf.json             # Frameless, transparent, always-on-top
├── ui/
│   └── index.html                  # RAF animation engine (CSS + JS)
├── sidecar/
│   ├── server.js                   # HTTP API server (port 7777)
│   └── activity-monitor.js         # xdotool window watcher
└── README.md
```

**Data flow:**

```
Your active window
        │
        ▼
activity-monitor.js ──→ state.json ──→ UI (RAF loop → sprite animation)
        │     (reads every 2s)   (polled every 300ms)
        │
        ▼
   HTTP API (any process can also set state)
```

## Systemd Autostart

To have the pet start automatically when you log in:

```bash
cp petdex-desktop.service ~/.config/systemd/user/
systemctl --user enable petdex-desktop
systemctl --user start petdex-desktop
```

This works on X11 only (the activity monitor uses `xdotool` which requires X11).

## Troubleshooting

| Problem | Likely cause | Fix |
|---------|-------------|-----|
| Window is transparent | No pet found | Add a spritesheet to `~/.petdex/pets/<name>/` |
| Pet stays idle | Activity monitor not running | Start the sidecar: `node ~/.petdex/sidecar/server.js` |
| Cannot drag the window | Tauri IPC error | Right-click → quit, restart the app |
| Sidecar fails to start | Node.js not found | Ensure `node` is in PATH |
| `xdotool` command not found | Not installed | `sudo apt install xdotool` |
| "no pet found" error | No spritesheet in path | Check `~/.petdex/pets/` exists and has a subdirectory with a spritesheet |
| App won't compile | Missing system deps | Run the apt/dnf/pacman command from Prerequisites |

## Building from source

```bash
# Full build
cd src-tauri && cargo build --release && cd ..

# Debug mode (faster rebuilds)
cd src-tauri && cargo build && cd ..
./src-tauri/target/debug/petdex-linux
```

## License

MIT
