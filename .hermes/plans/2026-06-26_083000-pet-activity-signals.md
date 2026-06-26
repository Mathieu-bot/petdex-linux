# Pet Animation Activity Signals — Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Make the PetDex pet react to real Hermes agent activity (tool running, reasoning, errors, completion) instead of auto-cycling or staying idle.

**Architecture:** The Hermes desktop app drives its pet via activity signals (`setPetActivity`/`flashPetActivity`) derived from message stream events (`reasoning.delta`, `tool.start`, `tool.complete`, `message.complete`, `error`). The PetDex Tauri app has a sidecar HTTP server that already accepts `POST /state`, but there's no bridge connecting Hermes activity → sidecar. We'll build a small Node.js bridge that subscribes to Hermes' runtime state files and forwards state changes to the sidecar.

**Tech Stack:** Node.js (bridge), Hermes runtime artifacts (`~/.hermes/var/`), existing sidecar on `127.0.0.1:7777`

---

## Current Context

### How Hermes drives its pet (desktop app)

The TS desktop app subscribes to message-stream events and calls:

| Event | Signal | State | Type |
|-------|--------|-------|------|
| `reasoning.delta` | `{ reasoning: true }` | `review` | steady |
| `reasoning.available` | `{ reasoning: true }` | `review` | steady |
| `tool.start / tool.progress / tool.generating` | `{ reasoning: false, toolRunning: true }` | `run` | steady |
| `tool.complete` | `{ toolRunning: false }` | idle (or falls through) | steady |
| `message.complete` | `flash({ celebrate: true, reasoning: false, toolRunning: false }, 2200)` | `jump` | transient (~2.2s) |
| `error` | `flash({ error: true })` | `failed` | transient (1.6s) |

Priority order (from `derive_pet_state`): **error → celebrate → just_completed → awaiting_input → tool_running → reasoning → busy → idle**

Transient states (`jump`, `wave`, `failed`) decay back to the underlying steady state after ~1.6–2.2s.

### How the desktop popout overlay works

The popout overlay (`pet-overlay-app.tsx`) receives activity directly from the gateway RPC:
```ts
$petActivity.set(payload.activity ?? {})
```

### How sidecar works now

- Accepts `POST /state {"state":"..."}` and writes to `~/.petdex/runtime/state.json`
- UI polls `state.json` every 300ms and switches to the matching spritesheet row
- Currently no bridge from Hermes agent activity → sidecar

### What exists (that we can tap into)

The Python agent writes runtime artifacts under `~/.hermes/var/`. The TUI gateway also emits activity signals. The agent's `agent/pet/store.py` manages the pet file store — the TUI state writes `state.json` for the CLI/TUI pets. This is the same `state.json` format our sidecar writes.

### Key insight

Hermes already has a file-based pet state system in the Python agent that writes to a pet store. The TUI and CLI both read from this store. The PetDex Tauri app uses its own `state.json` under `~/.petdex/runtime/`. The bridge needs to relay from Hermes' pet store → PetDex sidecar.

---

## Proposed Approach

### Option A: Bridge process (recommended)

A lightweight Node.js script that:
1. Watches Hermes' pet state file (`~/.hermes/var/pet/state.json`)
2. On every change, POSTs the state to the sidecar at `http://127.0.0.1:7777/state`
3. Is spawned by the sidecar or launched alongside it

**File to watch:** Hermes writes activity-based state to its pet store. The exact path is `~/.hermes/var/pet/state.json` (or `~/.hermes/var/state/pet.json` — needs verification).

### Option B: Python-side injection

Patch the sidecar server to also read Hermes' pet state file directly, merging the two sources. Simpler but couples the sidecar to Hermes' file layout.

### Option C: Gateway event subscription

Add a persistent WebSocket or event stream from the gateway that the sidecar subscribes to. Most robust but requires gateway changes.

**Chosen: Option A** — minimal coupling, easy to debug, works with any Hermes setup.

---

## Step-by-Step Plan

### Task 1: Discover Hermes pet state file format and location

**Objective:** Find where Hermes writes its derived pet state to disk (the Python agent's pet store).

**Files:**
- Inspect: `~/.hermes/var/pet/` or `~/.hermes/var/`
- Inspect: `agent/pet/store.py` and `agent/pet/__init__.py`

**Step 1: Inspect the pet store**

Look at `agent/pet/store.py` and `agent/pet/__init__.py` to find the file paths and format of the on-disk state.

**Step 2: Check what files exist at runtime**

Run: `ls -la ~/.hermes/var/pet/` (or the resolved path)
Expected: one or more JSON files with pet state data.

**Step 3: Read the state file format**

Run: `cat ~/.hermes/var/pet/<state-file>.json`
Expected: JSON with fields like `state`, `timestamp`, possibly `counter`.

**Step 4: Document findings**

Record: exact file path, JSON schema, update frequency, how Hermes triggers writes.

---

### Task 2: Create watcher script

**Objective:** A Node.js script that watches Hermes' pet state file and POSTs state changes to the sidecar.

**Files:**
- Create: `/home/jiu/petdex/sidecar/activity-watcher.js`

**Step 1: Write the watcher script**

```javascript
#!/usr/bin/env node
/**
 * PetDex Activity Watcher
 *
 * Watches Hermes' on-disk pet state file and relays state changes
 * to the PetDex sidecar so the Tauri pet reacts to agent activity.
 *
 * State priority (mirrors agent.pet.state.derive_pet_state):
 *   error > celebrate > just_completed > awaiting_input > tool_running
 *   > reasoning > busy > idle
 */

const fs = require("fs");
const http = require("http");
const path = require("path");

const HERMES_HOME = process.env.HERMES_HOME || path.join(process.env.HOME, ".hermes");
const STATE_FILE = process.env.HERMES_PET_STATE || path.join(HERMES_HOME, "var", "pet", "state.json");
const SIDECAR_URL = process.env.SIDECAR_URL || "http://127.0.0.1:7777";
const POLL_MS = parseInt(process.env.POLL_MS || "300", 10);

let lastState = null;
let lastTimestamp = 0;

function postState(state) {
  return new Promise((resolve, reject) => {
    const url = new URL("/state", SIDECAR_URL);
    const data = JSON.stringify({ state });
    const req = http.request(
      url,
      { method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve(body));
      }
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

function readStateFile() {
  try {
    if (!fs.existsSync(STATE_FILE)) return null;
    const raw = fs.readFileSync(STATE_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function poll() {
  const data = readStateFile();
  if (!data) return;

  // Only relay if the state changed or timestamp advanced
  const ts = data.timestamp || data.ts || 0;
  if (data.state && (data.state !== lastState || ts > lastTimestamp)) {
    lastState = data.state;
    lastTimestamp = ts;
    try {
      await postState(data.state);
    } catch (e) {
      // sidecar not available yet — retry next poll
    }
  }
}

console.error(`petdex-activity-watcher: watching ${STATE_FILE} → ${SIDECAR_URL}/state`);
poll(); // immediate first poll
setInterval(poll, POLL_MS);
```

**Step 2: Verify it runs**

Run: `node /home/jiu/petdex/sidecar/activity-watcher.js`
Then trigger activity in Hermes and watch the console output.

---

### Task 3: Wire watcher into sidecar lifecycle

**Objective:** The sidecar spawns the watcher as a child process so it starts/ends together.

**Files:**
- Modify: `/home/jiu/petdex/sidecar/server.js`

**Step 1: Add child_process spawn to sidecar**

After `server.listen(...)`, spawn the watcher:

```javascript
const { spawn } = require("child_process");

// ...

server.listen(PORT, "127.0.0.1", () => {
  console.error(`petdex-sidecar listening on http://127.0.0.1:${PORT}`);

  // Spawn activity watcher if it exists
  const watcherPath = path.join(__dirname, "activity-watcher.js");
  if (fs.existsSync(watcherPath)) {
    const watcher = spawn(process.execPath, [watcherPath], {
      stdio: "inherit",
      env: { ...process.env },
    });
    watcher.on("error", (err) => console.error("watcher spawn error:", err));
    watcher.on("exit", (code) => console.error(`watcher exited (code ${code})`));
  }
});
```

**Step 2: Verify end-to-end**

Run the sidecar, check the watcher starts. Trigger a Hermes action and observe the pet state changes.

---

### Task 4: Add Hermes state alias mapping (already done in UI)

**Objective:** Ensure the UI correctly maps all Hermes activity state names to spritesheet rows.

**Status: Already done** — the `applyState()` function in `index.html` has:
```
"wave"  → "waving"  (row 3)
"run"   → "running" (row 7)
"jump"  → "jumping" (row 4)
"failed" → "failed" (row 5)
"review" → "review" (row 8)
"waiting" → "waiting" (row 6)
"idle"   → "idle"   (row 0)
```

**Verification:** Check that the `applyState` ALIASES object in `ui/index.html` maps all Hermes `PetState` values.

---

### Task 5: Test end-to-end

**Objective:** Trigger each activity signal and verify the pet shows the correct animation.

**Step 1: Trigger each state via watcher**

After the watcher picks up a Hermes state change, verify:
1. The sidecar receives the POST
2. The state file is updated
3. The UI switches spritesheet rows

**Step 2: Manual API test**

```bash
curl -X POST http://127.0.0.1:7777/state -d '{"state":"idle"}'
curl -X POST http://127.0.0.1:7777/state -d '{"state":"running"}'
curl -X POST http://127.0.0.1:7777/state -d '{"state":"review"}'
curl -X POST http://127.0.0.1:7777/state -d '{"state":"waving"}'
curl -X POST http://127.0.0.1:7777/state -d '{"state":"jumping"}'
curl -X POST http://127.0.0.1:7777/state -d '{"state":"failed"}'
curl -X POST http://127.0.0.1:7777/state -d '{"state":"waiting"}'
```

**Step 3: Real Hermes activity test**

Send a message in Hermes while watching the pet — it should react:
- Typing → idle
- Reasoning → `review` 
- Running tools → `run`
- Completion → `jump` (transient, then back to idle)

---

## Files That Will Change

| File | Action | Purpose |
|------|--------|---------|
| `sidecar/activity-watcher.js` | **Create** | Watch Hermes state file, POST to sidecar |
| `sidecar/server.js` | **Modify** | Spawn watcher on startup |

## Risks and Open Questions

1. **Hermes state file path unknown** — need to discover at runtime. `~/.hermes/var/pet/state.json` is likely but must be confirmed. File format may differ between CLI/TUI modes.
2. **State file format** — Hermes may write `{state: "run", timestamp: ...}`, `{codex_state: "running", ...}`, or use a different schema. Task 1 resolves this.
3. **Update frequency** — If Hermes writes state changes very frequently (e.g. on every reasoning token), the poll at 300ms may introduce latency. Adjust `POLL_MS` if needed.
4. **Race condition** — If the watcher starts before the sidecar is listening, initial POSTs will fail. The `catch` in `poll()` handles this gracefully.
5. **Watcher reliability** — If the watcher crashes, the pet stops reacting. Consider auto-restart (e.g. the sidecar re-spawns on crash).
6. **Multiple Hermes instances** — Per-profile pets. The watcher watches one file; if profiles switch, the file path would need to track the active profile.

## Verification

After all tasks:
1. Sidecar starts → watcher starts automatically
2. Watcher reads Hermes state file every 300ms
3. State changes propagate to pet UI within ~600ms (worst-case: 300ms poll + 300ms UI poll)
4. All 7 Hermes activity states map to correct spritesheet rows
5. Pet stays on `idle` when no activity (no auto-cycle)

---

## Execution Handoff

**Plan complete and saved.** Ready to execute — start with Task 1 (discover Hermes pet state file format), proceed through the watcher implementation, wiring, and end-to-end testing.
