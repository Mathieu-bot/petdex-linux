#!/usr/bin/env bash
set -e

echo "=== PetDex Linux Installer ==="

# Check deps
echo "Checking system dependencies..."
if ! command -v rustc &>/dev/null; then
    echo "Error: Rust is not installed. Install it from https://rustup.rs"
    exit 1
fi

if ! command -v node &>/dev/null; then
    echo "Error: Node.js is not installed."
    exit 1
fi

if ! command -v xdotool &>/dev/null; then
    echo "Warning: xdotool not found — activity monitor won't work."
    echo "  Debian/Ubuntu: sudo apt install xdotool"
    echo "  Arch:         sudo pacman -S xdotool"
    echo "  Fedora:       sudo dnf install xdotool"
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Installing sidecar dependencies..."
cd "$SCRIPT_DIR/sidecar"
npm install

echo "Building PetDex desktop app..."
cd "$SCRIPT_DIR/src-tauri"
cargo build --release

echo "Setting up runtime directories..."
mkdir -p "$HOME/.petdex/pets"

# Copy sidecar to runtime path (the compiled binary looks for it there)
echo "Copying sidecar..."
mkdir -p "$HOME/.petdex/sidecar"
cp -r "$SCRIPT_DIR/sidecar"/*.js "$HOME/.petdex/sidecar/"
cp "$SCRIPT_DIR/sidecar/package.json" "$HOME/.petdex/sidecar/"

echo "Installing to ~/.local/bin..."
mkdir -p "$HOME/.local/bin"
ln -sf "$SCRIPT_DIR/src-tauri/target/release/petdex-linux" "$HOME/.local/bin/petdex-desktop"

echo ""
echo "=== Done! ==="
echo ""
echo "  Next steps:"
echo "    1. Add a pet spritesheet:"
echo "       mkdir -p ~/.petdex/pets/my-pet"
echo "       # copy your spritesheet.webp and pet.json into it"
echo ""
echo "    2. Run the app:"
echo "       petdex-desktop"
echo ""
echo "  Add ~/.local/bin to your PATH if not already."
echo ""
