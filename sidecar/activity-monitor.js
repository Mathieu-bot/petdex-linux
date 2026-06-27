#!/usr/bin/env node
/**
 * PetDex Activity Monitor — watches the active window and drives pet state.
 *
 * Exports: startActivityMonitor(writeSafe, runtimeDir)
 *   - writeSafe(path, data): atomically write JSON (passed from server.js)
 *   - runtimeDir: path where state.json lives
 *
 * Runs xdotool every 2s to classify the focused window → pet state.
 * Falls back to "idle" after IDLE_MS of no activity.
 */

const { exec } = require("child_process");
const path = require("path");

const POLL_MS = 2000; // check window every 2s
const IDLE_MS = 90_000; // 90s without activity → idle/sleep
const IDLE_CHECK_MS = 10_000; // check idle timeout every 10s

// State map: first match wins (highest-priority entry = errors)
const WINDOW_STATE_MAP = [
  // Priority 1: errors / crashes
  {
    keywords: [
      "error", "crash", "exception", "failed", "fatal",
      "bug report", "problem", "critical", "unhandled",
    ],
    state: "failed",
  },
  // Priority 2: coding / working
  {
    keywords: [
      "vscode", "visual studio code", "code - ", "code - oss", "project",
      "vim", "nvim", "neovim", "emacs", "intellij", "pycharm", "gradle",
      "sublime", "atom", "zed", "helix",
      "terminal", "bash", "zsh", "fish",
      "building", "compil", "make", "makefile",
      "npm ", "yarn ", "pnpm ", "cargo", "go build",
      "python", "node ", "deno ", "bun ",
      "git", "docker ", "docker-compose", "kubernetes",
      "rustc", "gcc", "clang",
    ],
    state: "running",
  },
  // Priority 3: social / messaging
  {
    keywords: [
      "discord", "slack", "teams", "signal", "telegram",
      "whatsapp", "messenger", "chat", "irc", "element",
    ],
    state: "waving",
  },
  // Priority 4: browsing / researching
  {
    keywords: [
      "firefox", "chrome", "brave", "chromium", "edge",
      "opera", "browser", " - google search", " - duckduckgo",
    ],
    state: "waiting",
  },
  // Priority 5: system settings / config
  {
    keywords: [
      "settings", "control panel", "system settings",
      "update", "preferences", "configuration",
      "installer", "setup", "property",
    ],
    state: "review",
  },
  // Priority 6: file management
  {
    keywords: [
      "thunar", "nautilus", "nemo", "caja", "dolphin",
      "file manager", "file explorer", "files - ",
    ],
    state: "review",
  },
];

// Desktop / panel windows — no recognizable app
const DESKTOP_KEYWORDS = [
  "xfce4-session", "xfdesktop", "desktop", "panel",
  "root", "lxsession",
];

let lastWindowState = null;
let lastActivityTime = Date.now();
let activeTimer = null;
let idleTimer = null;

function classifyWindow(title) {
  if (!title || title.trim() === "") return "idle";
  const lower = title.toLowerCase();

  for (const entry of WINDOW_STATE_MAP) {
    if (entry.keywords.some((kw) => lower.includes(kw))) {
      return entry.state;
    }
  }

  if (DESKTOP_KEYWORDS.some((kw) => lower.includes(kw))) {
    return "waiting";
  }

  return "idle";
}

function startActivityMonitor(writeSafe, runtimeDir) {
  if (process.platform !== "linux") {
    console.error("[activity-monitor] only supported on Linux (X11)");
    return;
  }

  const stateFile = path.join(runtimeDir, "state.json");

  function writeState(state) {
    writeSafe(stateFile, { state, timestamp: Date.now() });
  }

  function pollActiveWindow() {
    exec("xdotool getactivewindow getwindowname", (err, stdout) => {
      if (err) return;
      const title = stdout.trim();
      const state = classifyWindow(title);

      lastActivityTime = Date.now();

      if (state !== lastWindowState) {
        lastWindowState = state;
        writeState(state);
        console.error(`[activity] ${state} ← "${title.slice(0, 60)}"`);
      }
    });
  }

  function checkIdle() {
    if (lastWindowState === "idle") return; // already sleeping
    if (Date.now() - lastActivityTime >= IDLE_MS) {
      lastWindowState = "idle";
      writeState("idle");
      console.error(`[activity] idle (no activity for ${IDLE_MS / 1000}s)`);
    }
  }

  // Start polling
  pollActiveWindow();
  activeTimer = setInterval(pollActiveWindow, POLL_MS);
  idleTimer = setInterval(checkIdle, IDLE_CHECK_MS);

  console.error(`[activity-monitor] watching every ${POLL_MS}ms, idle after ${IDLE_MS / 1000}s`);
}

function stopActivityMonitor() {
  if (activeTimer) clearInterval(activeTimer);
  if (idleTimer) clearInterval(idleTimer);
}

module.exports = { startActivityMonitor, stopActivityMonitor };
