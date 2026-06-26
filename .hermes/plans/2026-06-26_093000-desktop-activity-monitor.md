# Pet Animation — Desktop Activity Monitor Implementation Plan

> **For Hermes:** Use subagent-driven-development to implement task-by-task.

## Goal

Make the PetDex pet react to **your real PC activity** — coding, browsing, errors, idle — without any dependency on the Hermes agent. The pet becomes a desktop companion that mirrors what you're doing.

## Architecture

The existing Node.js sidecar (`server.js` on port 7777) already handles state. We extend it with a **window activity monitor** that:

1. Polls `xdotool getactivewindow getwindowname` every 2 seconds
2. Classifies the window title into a pet state via keyword matching
3. POSTs the classified state to the sidecar's own `/state` endpoint
4. The Tauri UI reads the state file and switches animations (already works)

No new processes — everything runs inside the existing sidecar.

## Classification Map

Priority (highest first — error wins):

| Priority | Keyword in window title | Pet State |
|----------|------------------------|-----------|
| 1 | `error`, `crash`, `exception`, `failed`, `fatal`, `bug`, `problem`, `critical` | `failed` |
| 2 | `vscode`, `code`, `vim`, `nvim`, `emacs`, `intellij`, `sublime`, `atom`, `terminal`, `bash`, `zsh`, `make`, `compile`, `build`, `npm`, `yarn`, `cargo`, `go build`, `python` | `running` |
| 3 | `discord`, `slack`, `teams`, `signal`, `telegram`, `whatsapp`, `messenger`, `chat` | `waving` |
| 4 | `firefox`, `chrome`, `brave`, `chromium`, `edge`, `opera`, `browser` | `review` |
| 5 | `settings`, `control panel`, `system`, `update`, `preferences`, `config` | `waiting` |
| 6 | `thunar`, `nautilus`, `nemo`, `file manager`, `explorer`, `file` | `review` |
| 7 | Desktop / no title / panel / root window | `waiting` |
| 8 | Everything else (unknown) | `idle` |

Note: The classification uses `includes()` substring matching against the lowercased window title, not exact equality.

## Implementation Tasks

### Task 1: Read current index.html classification logic

**Objective:** Confirm the current `applyState()` ALIASES map handles all Hermes state names (already done in previous work).

No changes needed — `wave→waving`, `run→running`, `failed`, `review`, `waiting`, `jump→jumping` all map correctly.

---

### Task 2: Add activity monitor to sidecar

**Objective:** Add window classification + auto-POST loop to `/home/jiu/petdex/sidecar/server.js`.

**Files:**
- Modify: `/home/jiu/petdex/sidecar/server.js`

**What to add** (at the end of the file, before `server.listen()`):

```javascript
// ============================================================
// Desktop activity monitor — watch active window, drive pet state
// ============================================================

const { exec } = require("child_process");

const WINDOW_STATE_MAP = [
  // Priority 1: errors
  { keywords: ["error", "crash", "exception", "failed", "fatal", "bug report", "problem", "critical"], state: "failed" },
  // Priority 2: coding / working
  { keywords: ["vscode", "visual studio code", "code - ", "vim", "nvim", "emacs", "intellij",
    "sublime", "atom", "terminal", "bash", "zsh", "make -j", "building", "compil",
    "npm ", "yarn ", "cargo ", "go build", "python", "node ", "git", "docker "], state: "running" },
  // Priority 3: social / messaging
  { keywords: ["discord", "slack", "teams", "signal", "telegram", "whatsapp",
    "messenger", "chat", "irc"], state: "waving" },
  // Priority 4: browsing / researching
  { keywords: ["firefox", "chrome", "brave", "chromium", "edge", "opera", "browser",
    " - google search", " - duckduckgo"], state: "review" },
  // Priority 5: system settings
  { keywords: ["settings", "control panel", "system settings", "update", "preferences",
    "configuration", "installer", "setup"], state: "waiting" },
  // Priority 6: file manager
  { keywords: ["thunar", "nautilus", "nemo", "file manager", "file explorer",
    "explorer", "files - ", "finder"], state: "review" },
];

function classifyWindow(title) {
  if (!title || title.trim() === "") return "idle";
  const lower = title.toLowerCase();

  for (const entry of WINDOW_STATE_MAP) {
    if (entry.keywords.some((kw) => lower.includes(kw))) {
      return entry.state;
    }
  }

  // Desktop / panel / root window (no recognizable app)
  const desktopNames = ["xfce4-session", "xfdesktop", "desktop", "panel", "root"];
  if (desktopNames.some((n) => lower.includes(n))) return "waiting";

  return "idle";
}

let lastWindowState = null;

function pollActiveWindow() {
  exec("xdotool getactivewindow getwindowname", (err, stdout) => {
    if (err) return;
    const title = stdout.trim();
    const state = classifyWindow(title);

    if (state !== lastWindowState) {
      lastWindowState = state;
      // Write directly to state.json (same path sidecar uses)
      writeSafe(path.join(RUNTIME_DIR, "state.json"), {
        state: state,
        timestamp: Date.now(),
      });
      console.error(`[activity] ${state} ← "${title.slice(0, 60)}"`);
    }
  });
}

// Start poll loop (only on Linux with X11)
if (process.platform === "linux") {
  pollActiveWindow(); // immediate first poll
  setInterval(pollActiveWindow, 2000);
}
```

**Verification:**

```bash
cd /home/jiu/petdex
node sidecar/server.js
# Switch to terminal — should show "running"
# Switch to browser — should show "review"
# Switch to desktop — should show "waiting"
```

---

### Task 3: Error detection enhancement (optional)

**Objective:** Improve error detection beyond title keywords.

**Approach A: Window class detection** — check `xprop -id <window> WM_CLASS` for dialog classes:
```javascript
exec(`xprop -id ${winId} WM_CLASS`, (err, stdout) => {
  const cls = stdout.match(/"([^"]+)"/)?.[1] || "";
  if (cls.includes("dialog") || cls.includes("error") || cls.includes("alert")) {
    return "failed";
  }
});
```

**Approach B: Screenshot analysis** — use `xdotool` / `import` to capture screen region, then check for red/error patterns. Heavy but effective. Can be added later.

---

### Task 4: Idle/sleep detection (optional)

**Objective:** Show `idle` when the user hasn't interacted for a while.

**Approach:** Track when `lastWindowState` last changed. If > 5 minutes since last window title change and no state change:
```javascript
let lastActivity = Date.now();
function pollActiveWindow() {
  exec("xdotool getactivewindow getwindowname", (err, stdout) => {
    if (err) return;
    const title = stdout.trim();
    lastActivity = Date.now();
    // ... classify and update
  });
}

// Separate idle checker
setInterval(() => {
  const idleMs = Date.now() - lastActivity;
  if (idleMs > 300_000 && lastWindowState !== "idle") { // 5 min
    writeSafe(..., { state: "idle", timestamp: Date.now() });
    lastWindowState = "idle";
  }
}, 10_000);
```

---

### Task 5: Rebuild & test

**Objective:** Rebuild PetDex binary and test all state transitions.

```bash
cd /home/jiu/petdex/src-tauri && cargo build
cd /home/jiu/petdex && RUNTIME_DIR="$HOME/.petdex/runtime" ./src-tauri/target/debug/petdex-linux
```

Test each scenario:
1. Open VS Code → pet shows `running`
2. Open Brave/Firefox → pet shows `review`
3. Click on desktop → pet shows `waiting`
4. Switch to a window with "error" in the title → pet shows `failed` 😢
5. Open Discord → pet shows `waving`
6. Switch to unknown app → pet shows `idle`

## Files That Will Change

| File | Action | Change |
|------|--------|--------|
| `sidecar/server.js` | **Modify** | Add `classifyWindow()`, `pollActiveWindow()`, `WINDOW_STATE_MAP` |
| `sidecar/server.js` | **Modify** | Add idle detection loop (optional) |

## Risks

1. **`xdotool` latency** — each call spawns a subprocess (~5-10ms). At 2s intervals this is negligible.
2. **Window title matching errors** — apps have unpredictable titles. The keyword list may need tuning.
3. **No Wayland support** — `xdotool` only works on X11. If you ever switch to Wayland, we'd need `ydotool` or a different approach.
4. **Error detection is fuzzy** — not all windows with "error" in the title are actual errors. May produce false positives.
5. **No mouse/keyboard idle detection** — we use window title change staleness as a proxy. True idle detection needs `xprintidle` or `libxss`.

## Verification

After implementation:

```bash
# Start sidecar
node /home/jiu/petdex/sidecar/server.js

# In another terminal, check state file changes
watch -n 1 'cat ~/.petdex/runtime/state.json'

# Switch between apps and watch the pet change
```
