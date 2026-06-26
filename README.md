# PetDex Linux 🐼

A floating desktop pet companion for Linux — animated sprites that live on top of your workspace.

Works with any **PetDex** or **Hermes** pet sprite. Automatically discovers pets from `~/.hermes/pets/`, `~/.codex/pets/`, or `~/.petdex/pets/`.

## Features

- 🖼️ **Always-on-top** floating window — stays above all your apps
- 🎭 **Animated sprites** — idle, running, waving, jumping, and more
- 🖱️ **Draggable** — click and drag the pet anywhere on screen
- 💬 **Speech bubbles** — shows text from the sidecar
- 🌐 **HTTP API** — any process can control the pet via `localhost:9120`
- 🔌 **Standalone app** — works with any petdex sprites

## Prerequisites

- **Rust** (1.77+) — [rustup.rs](https://rustup.rs)
- **Node.js** (18+) — for the sidecar
- **System deps** (Debian/Ubuntu):

```bash
sudo apt-get install -y libwebkit2gtk-4.1-dev build-essential \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

## Quick Start

```bash
# Clone and build
git clone https://github.com/Mathieu-bot/petdex-linux
cd petdex-linux

# Install the sidecar dependencies
cd sidecar && npm install && cd ..

# Build the app
cd src-tauri && cargo build --release && cd ..

# Run it
./src-tauri/target/release/app
```

Or use the install script:

```bash
chmod +x install.sh
./install.sh
petdex-desktop
```

## Usage

| Action | What happens |
|--------|-------------|
| **Left-click + drag** | Move the pet around |
| **Right-click** | Quit the app |
| **API** | `curl -X POST localhost:9120/state -H 'Content-Type: application/json' -d '{"state":"waving"}'` |

### Available states

`idle`, `running-right`, `running-left`, `waving`, `jumping`, `failed`, `waiting`, `running`, `review`

### Speech bubbles

```bash
curl -X POST localhost:9120/bubble \
  -H 'Content-Type: application/json' \
  -d '{"text":"Hello from Linux! 🐧"}'
```

## Architecture

```
petdex-linux/
├── src-tauri/          # Rust + Tauri v2 backend
│   ├── src/lib.rs      # Core commands: get pets, read files, sidecar mgmt
│   ├── src/main.rs     # Entry point
│   └── tauri.conf.json # Frameless, transparent, always-on-top config
├── ui/
│   └── index.html      # Sprite animation engine (CSS + JS)
├── sidecar/
│   └── server.js       # Node.js HTTP server for state/bubble API
└── README.md
```

## License

MIT
