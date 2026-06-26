#!/usr/bin/env node
/**
 * PetDex Sidecar — a minimal HTTP server that:
 *   - Listens on 127.0.0.1:7777 for POST /state, POST /bubble, GET /state, GET /bubble
 *   - Writes state to ~/petdex/runtime/state.json and bubble.json
 *   - Exposes these files so the Tauri WebView can poll them

 * Protocol:
 *   POST /state { "state": "waving" }   → writes state.json
 *   POST /bubble { "text": "Hello!" }   → writes bubble.json
 *   GET  /state                          → reads state.json
 *   GET  /bubble                         → reads bubble.json
 *   GET  /health                         → {"ok":true}
 */

const http = require("http");
const fs = require("fs");
const path = require("path");

const { startActivityMonitor } = require("./activity-monitor");

const RUNTIME_DIR = process.env.RUNTIME_DIR || path.join(process.env.HOME || "/tmp", "petdex", "runtime");

// Ensure runtime directory exists
function ensureRuntimeDir() {
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
}

// Write JSON atomically
function writeSafe(filePath, data) {
  const tmp = filePath + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, filePath);
}

// Read JSON, return null if doesn't exist or invalid
function readSafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// Parse JSON body from request
function parseBody(req, cb) {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    try {
      cb(JSON.parse(Buffer.concat(chunks).toString()));
    } catch {
      cb(null);
    }
  });
}

function jsonResponse(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  const pathname = url.pathname;

  // CORS headers for local development
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Health check
  if (pathname === "/health" && req.method === "GET") {
    jsonResponse(res, 200, { ok: true });
    return;
  }

  // State
  if (pathname === "/state") {
    if (req.method === "GET") {
      const data = readSafe(path.join(RUNTIME_DIR, "state.json"));
      jsonResponse(res, 200, data || { state: "idle" });
      return;
    }
    if (req.method === "POST") {
      parseBody(req, (body) => {
        if (!body || !body.state) {
          jsonResponse(res, 400, { error: "state field required" });
          return;
        }
        writeSafe(path.join(RUNTIME_DIR, "state.json"), {
          state: body.state,
          timestamp: Date.now(),
        });
        jsonResponse(res, 200, { ok: true });
      });
      return;
    }
  }

  // Bubble
  if (pathname === "/bubble") {
    if (req.method === "GET") {
      const data = readSafe(path.join(RUNTIME_DIR, "bubble.json"));
      jsonResponse(res, 200, data || { text: "" });
      return;
    }
    if (req.method === "POST") {
      parseBody(req, (body) => {
        writeSafe(path.join(RUNTIME_DIR, "bubble.json"), {
          text: body?.text || "",
          timestamp: Date.now(),
        });
        jsonResponse(res, 200, { ok: true });
      });
      return;
    }
  }

  // 404
  jsonResponse(res, 404, { error: "not found" });
});

ensureRuntimeDir();

// Write initial clear files
writeSafe(path.join(RUNTIME_DIR, "state.json"), { state: "idle", timestamp: Date.now() });
writeSafe(path.join(RUNTIME_DIR, "bubble.json"), { text: "", timestamp: Date.now() });

const PORT = 7777;
server.listen(PORT, "127.0.0.1", () => {
  console.error(`petdex-sidecar listening on http://127.0.0.1:${PORT}`);
  startActivityMonitor(writeSafe, RUNTIME_DIR);
});
