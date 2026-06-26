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

echo "Installing sidecar dependencies..."
cd "$(dirname "$0")/sidecar"
npm install

echo "Building PetDex desktop app..."
cd "$(dirname "$0")/src-tauri"
cargo build --release

echo "Installing to ~/.local/bin..."
mkdir -p ~/.local/bin
ln -sf "$(pwd)/target/release/app" ~/.local/bin/petdex-desktop

echo ""
echo "=== Done! ==="
echo "Run 'petdex-desktop' to start the pet."
echo "Add ~/.local/bin to your PATH if not already."
