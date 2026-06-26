// ── Pet state definitions — frame counts match spritesheet rows ──
const PET_STATES = {
  "idle":          { row: 0, frames: 6 },
  "running-right": { row: 1, frames: 8 },
  "running-left":  { row: 2, frames: 8 },
  "waving":        { row: 3, frames: 4 },
  "jumping":       { row: 4, frames: 5 },
  "failed":        { row: 5, frames: 8 },
  "waiting":       { row: 6, frames: 6 },
  "running":       { row: 7, frames: 6 },
  "review":        { row: 8, frames: 6 },
};

const FRAME_W = 192;
const FRAME_H = 208;
const LOOP_MS = 1100; // single loop duration for all states
const DEFAULT_STATE = "idle";

// ── Animation state ──
let currentState = DEFAULT_STATE;
let frame = 0;
let activeRow = -1;
let activeCount = -1;
let drawnFrame = -1;
let drawnRow = -1;
let lastStep = 0;
let rafId = 0;

// ── Sidecar polling guard ──
let lastStateCounter = 0;
let lastBubbleCounter = 0;

// ── Sprite element reference ──
const sprite = document.getElementById("sprite");

// ── RAF animation loop ──
// Only redraws when the visible cell changes (skips ~90% of ticks)
function animationLoop(now) {
  const s = PET_STATES[currentState] || PET_STATES[DEFAULT_STATE];
  const row = s.row;
  const count = s.frames;

  // Detect state transition: new row or frame count
  if (row !== activeRow || count !== activeCount) {
    activeRow = row;
    activeCount = count;
    frame = 0;
    lastStep = now;
    drawnFrame = -1;
  }

  // Timing: LOOP_MS / frameCount = ms per frame step
  const stepMs = LOOP_MS / count;
  if (now - lastStep >= stepMs) {
    frame = (frame + 1) % count;
    lastStep = now;
  }

  // Only paint when the cell actually changed
  if (frame !== drawnFrame || row !== drawnRow) {
    const x = frame * -FRAME_W;
    const y = row * -FRAME_H;
    sprite.style.backgroundPosition = `${x}px ${y}px`;
    drawnFrame = frame;
    drawnRow = row;
  }

  rafId = requestAnimationFrame(animationLoop);
}

// ── State management ──
function startAnimation(stateId) {
  const s = PET_STATES[stateId] || PET_STATES[DEFAULT_STATE];
  currentState = stateId;

  // Reset so the RAF loop picks up the new row/count
  activeRow = -1;
  activeCount = -1;
  frame = 0;
  lastStep = 0;
}

function applyState(stateId) {
  const ALIASES = {
    "idle": "idle", "wave": "waving", "run": "running",
    "failed": "failed", "review": "review", "jump": "jumping",
    "waiting": "waiting", "running-left": "running-left",
    "running-right": "running-right", "done": "waving",
    "running": "running", "waving": "waving", "jumping": "jumping",
  };
  const resolved = ALIASES[stateId] || stateId;
  if (!PET_STATES[resolved]) return; // unknown state
  startAnimation(resolved);
}

// ── Sidecar polling ──
function startPolling() {
  setInterval(pollState, 300);
  setInterval(pollBubble, 300);
}

async function pollState() {
  try {
    const data = await window.__TAURI_INTERNALS__.invoke("read_runtime_state");
    if (!data) return;
    if (data.counter === lastStateCounter) return;
    lastStateCounter = data.counter;
    if (data.state && data.state !== currentState) {
      applyState(data.state);
    }
  } catch (e) {
    // ignore
  }
}

async function pollBubble() {
  try {
    const data = await window.__TAURI_INTERNALS__.invoke("read_runtime_bubble");
    if (!data) return;
    if (data.counter === lastBubbleCounter) return;
    lastBubbleCounter = data.counter;
    showBubble(data.text || "");
  } catch (e) {
    // ignore
  }
}

// ── Speech bubble ──
function showBubble(text) {
  const el = document.getElementById("bubble");
  if (!text) {
    el.textContent = "";
    el.classList.remove("visible");
    return;
  }
  el.textContent = text;
  el.classList.add("visible");
}

// ── Dragging ──
document.getElementById("root").addEventListener("mousedown", async (e) => {
  if (e.button !== 0) return;
  try {
    await window.__TAURI_INTERNALS__.invoke("start_window_drag");
  } catch (err) {
    // ignore
  }
});

// ── Right-click to quit ──
window.addEventListener("contextmenu", async (e) => {
  e.preventDefault();
  try {
    await window.__TAURI_INTERNALS__.invoke("stop_sidecar");
    await window.__TAURI_INTERNALS__.invoke("quit_app");
  } catch (err) {
    console.error("quit:", err);
  }
});

// ── Boot ──
(async function boot() {
  try {
    const pet = await window.__TAURI_INTERNALS__.invoke("get_active_pet");
    if (!pet) return;

    const b64 = await window.__TAURI_INTERNALS__.invoke("read_file_as_base64", { path: pet.sprite_path });
    const ext = pet.sprite_path.endsWith(".png") ? "png" : "webp";
    sprite.style.backgroundImage = `url("data:image/${ext};base64,${b64}")`;

    // Wait for the spritesheet to decode before starting the RAF loop
    await new Promise((resolve) => {
      const img = new Image();
      img.onload = resolve;
      img.onerror = resolve;
      img.src = `data:image/${ext};base64,${b64}`;
    });

    applyState(DEFAULT_STATE);

    // Start RAF animation loop
    rafId = requestAnimationFrame(animationLoop);

    // Start sidecar polling
    startPolling();

    // Try to boot the sidecar
    try {
      await window.__TAURI_INTERNALS__.invoke("spawn_sidecar");
    } catch (e) {
      // sidecar not needed for standalone mode
    }
  } catch (e) {
    // silent fail — window stays transparent
  }
})();
