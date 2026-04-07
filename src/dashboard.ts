/**
 * Local web dashboard for Claude Octopus.
 *
 * Serves a self-contained HTML page on localhost with SSE for
 * real-time timeline updates. No external dependencies.
 *
 * Usage:
 *   claude-octopus dashboard [--port <n>]
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { watch, type FSWatcher } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { buildTimelineConfig } from "./config.js";
import { listRuns, readTimeline, type TimelineEntry, type RunSummary } from "./timeline.js";

// ── Types ─────────────────────────────────────────────────────────

interface DashboardOptions {
  port: number;
  timelineDir: string;
}

// ── SSE Clients ───────────────────────────────────────────────────

const sseClients = new Set<ServerResponse>();

function broadcastSSE(data: unknown): void {
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch {
      sseClients.delete(client);
    }
  }
}

// ── File Watcher ──────────────────────────────────────────────────

function watchTimeline(dir: string): FSWatcher | null {
  const filePath = join(dir, "timeline.jsonl");
  let lastSize = 0;
  let processing = false;

  // Initialize size
  stat(filePath).then((s) => { lastSize = s.size; }).catch(() => {});

  async function onchange(filename: string | null): Promise<void> {
    if (filename && filename !== "timeline.jsonl") return;
    if (processing) return;
    processing = true;
    try {
      const s = await stat(filePath);
      if (s.size <= lastSize) return;

      // Read only the new bytes appended since last check
      const { createReadStream } = await import("node:fs");
      const newData = await new Promise<string>((resolve, reject) => {
        let buf = "";
        const stream = createReadStream(filePath, { start: lastSize, encoding: "utf-8" });
        stream.on("data", (chunk) => { buf += String(chunk); });
        stream.on("end", () => resolve(buf));
        stream.on("error", reject);
      });
      lastSize = s.size;

      // Parse new entries
      for (const line of newData.split("\n")) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line);
          broadcastSSE({ type: "new_entry", entry });
        } catch {
          // Skip malformed
        }
      }

      // Send updated run summaries
      const runs = await listRuns(dir);
      broadcastSSE({ type: "runs_update", runs });
    } catch {
      // File may not exist yet — that's fine
    } finally {
      processing = false;
    }
  }

  // Watch the directory so we detect file creation too
  try {
    const watcher = watch(dir, { persistent: false }, (_event, filename) => {
      onchange(filename);
    });
    return watcher;
  } catch {
    return null;
  }
}

// ── API Handlers ──────────────────────────────────────────────────

function json(res: ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

async function handleApi(
  req: IncomingMessage,
  res: ServerResponse,
  dir: string,
): Promise<boolean> {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);

  if (url.pathname === "/api/runs") {
    const runs = await listRuns(dir);
    json(res, { runs });
    return true;
  }

  if (url.pathname.startsWith("/api/run/")) {
    const runId = decodeURIComponent(url.pathname.slice("/api/run/".length));
    const entries = await readTimeline(dir, { runId });
    const runs = await listRuns(dir);
    const summary = runs.find((r) => r.run_id === runId);
    json(res, { run_id: runId, summary: summary || null, entries });
    return true;
  }

  if (url.pathname === "/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    });
    res.write(": connected\n\n");
    sseClients.add(res);
    req.on("close", () => sseClients.delete(res));
    return true;
  }

  return false;
}

// ── Dashboard HTML ────────────────────────────────────────────────

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatCost(usd: number): string {
  return `$${usd.toFixed(4)}`;
}

function formatDuration(t0: string, t1: string): string {
  const ms = new Date(t1).getTime() - new Date(t0).getTime();
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function renderRunRow(r: RunSummary): string {
  const dur = formatDuration(r.t0, r.t1);
  const statusCls = r.has_errors ? "status-error" : "status-ok";
  const agentList = r.agents.map(esc).join(" → ");
  return `<tr class="run-row" data-run-id="${esc(r.run_id)}">
    <td><code>${esc(r.run_id.slice(0, 12))}…</code></td>
    <td>${agentList}</td>
    <td>${r.entry_count}</td>
    <td>${formatCost(r.total_cost_usd)}</td>
    <td>${r.total_turns}</td>
    <td>${dur}</td>
    <td class="${statusCls}">${r.has_errors ? "errors" : "ok"}</td>
    <td>${new Date(r.t0).toLocaleString()}</td>
  </tr>`;
}

function renderEntryCard(e: TimelineEntry, idx: number): string {
  const statusClass = e.is_error ? "status-error" : "status-ok";
  const statusLabel = e.is_error ? esc(e.subtype) : "success";
  const dur = formatDuration(e.t0, e.t1);
  return `<div class="entry-card">
    <div class="entry-header">
      <span class="entry-seq">${idx + 1}</span>
      <span class="entry-agent">${esc(e.agent)}</span>
      <span class="entry-badge ${statusClass}">${statusLabel}</span>
    </div>
    <div class="entry-meta">
      <span>${dur}</span>
      <span>${formatCost(e.cost_usd)}</span>
      <span>${e.turns} turns</span>
      <span class="mono">${esc(e.session_id.slice(0, 8))}…</span>
    </div>
    <div class="entry-prompt">${esc(e.prompt_excerpt)}</div>
  </div>`;
}

async function buildDashboardHtml(dir: string): Promise<string> {
  const runs = await listRuns(dir);
  const totalCost = runs.reduce((s, r) => s + r.total_cost_usd, 0);
  const totalAgents = runs.reduce((s, r) => s + r.entry_count, 0);
  const totalTurns = runs.reduce((s, r) => s + r.total_turns, 0);
  const errorCount = runs.filter((r) => r.has_errors).length;

  // Load entries for the most recent run (if any)
  let recentRunHtml = "<p class='empty'>No runs yet. Start an agent to see activity here.</p>";
  if (runs.length > 0) {
    const recent = runs[0];
    const entries = await readTimeline(dir, { runId: recent.run_id });
    recentRunHtml = `
      <h3>Latest: <code>${esc(recent.run_id)}</code></h3>
      <div class="entry-list">
        ${entries.map((e, i) => renderEntryCard(e, i)).join("\n")}
      </div>`;
  }

  const runTableRows = runs.map(renderRunRow).join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Claude Octopus — Dashboard</title>
<style>
:root {
  --bg: #0d1117; --surface: #161b22; --border: #30363d;
  --text: #e6edf3; --text-dim: #8b949e; --text-bright: #f0f6fc;
  --accent: #58a6ff; --green: #3fb950; --red: #f85149; --orange: #d29922;
  --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
  --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
}
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: var(--font); background: var(--bg); color: var(--text); padding: 2rem; max-width: 1400px; margin: 0 auto; line-height: 1.5; }
h1 { color: var(--text-bright); margin-bottom: 0.25rem; }
h2 { color: var(--text-bright); font-size: 1.2rem; margin: 1.5rem 0 0.75rem; }
h3 { color: var(--text); font-size: 1rem; margin: 0.5rem 0; }
code { font-family: var(--mono); background: var(--surface); padding: 0.15em 0.4em; border-radius: 4px; font-size: 0.85em; }
.mono { font-family: var(--mono); font-size: 0.8em; }
.subtitle { color: var(--text-dim); margin-bottom: 1.5rem; }
.empty { color: var(--text-dim); font-style: italic; }

/* Connection indicator */
.connection { display: inline-flex; align-items: center; gap: 0.4rem; font-size: 0.8rem; color: var(--text-dim); float: right; margin-top: 0.25rem; }
.dot { width: 8px; height: 8px; border-radius: 50%; }
.dot-connected { background: var(--green); }
.dot-disconnected { background: var(--red); }

/* Stats bar */
.stats { display: flex; gap: 2rem; margin-bottom: 1.5rem; flex-wrap: wrap; }
.stat-card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 1rem 1.5rem; min-width: 120px; }
.stat-val { font-size: 1.5rem; font-weight: 700; color: var(--text-bright); }
.stat-label { font-size: 0.75rem; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.05em; }

/* Run table */
.run-table { width: 100%; border-collapse: collapse; margin: 0.5rem 0 1.5rem; }
.run-table th, .run-table td { padding: 0.5rem 0.75rem; text-align: left; border-bottom: 1px solid var(--border); font-size: 0.85rem; }
.run-table th { color: var(--text-dim); font-weight: 600; }
.run-table tbody tr:hover { background: var(--surface); cursor: pointer; }
.status-ok { color: var(--green); }
.status-error { color: var(--red); }

/* Entry cards */
.entry-list { display: flex; flex-direction: column; gap: 0.5rem; }
.entry-card { background: var(--surface); border: 1px solid var(--border); border-radius: 6px; padding: 0.75rem 1rem; }
.entry-header { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.25rem; }
.entry-seq { width: 22px; height: 22px; border-radius: 50%; background: var(--accent); color: var(--bg); display: flex; align-items: center; justify-content: center; font-size: 0.65rem; font-weight: 700; flex-shrink: 0; }
.entry-agent { font-weight: 700; color: var(--text-bright); }
.entry-badge { font-size: 0.65rem; padding: 0.15em 0.5em; border-radius: 10px; font-weight: 600; }
.entry-badge.status-ok { background: rgba(63,185,80,0.15); color: var(--green); }
.entry-badge.status-error { background: rgba(248,81,73,0.15); color: var(--red); }
.entry-meta { display: flex; gap: 0.75rem; font-size: 0.8rem; color: var(--text-dim); margin-bottom: 0.25rem; }
.entry-prompt { font-size: 0.8rem; color: var(--text-dim); font-style: italic; }

/* Toast */
.toast { position: fixed; bottom: 1.5rem; right: 1.5rem; background: var(--surface); border: 1px solid var(--accent); border-radius: 8px; padding: 0.75rem 1rem; font-size: 0.85rem; color: var(--accent); opacity: 0; transition: opacity 0.3s; pointer-events: none; z-index: 100; }
.toast.show { opacity: 1; }
</style>
</head>
<body>
  <div>
    <h1>Claude Octopus — Dashboard</h1>
    <span class="connection"><span class="dot dot-disconnected" id="conn-dot"></span><span id="conn-text">connecting…</span></span>
    <p class="subtitle">Live timeline — auto-refreshes when agents run</p>
  </div>

  <div class="stats" id="stats">
    <div class="stat-card"><div class="stat-val" id="stat-runs">${runs.length}</div><div class="stat-label">runs</div></div>
    <div class="stat-card"><div class="stat-val" id="stat-agents">${totalAgents}</div><div class="stat-label">invocations</div></div>
    <div class="stat-card"><div class="stat-val" id="stat-cost">${formatCost(totalCost)}</div><div class="stat-label">total cost</div></div>
    <div class="stat-card"><div class="stat-val" id="stat-turns">${totalTurns}</div><div class="stat-label">total turns</div></div>
    <div class="stat-card"><div class="stat-val" id="stat-errors">${errorCount}</div><div class="stat-label">errors</div></div>
  </div>

  <h2>Recent Activity</h2>
  <div id="recent">${recentRunHtml}</div>

  <h2>All Runs</h2>
  <table class="run-table">
    <thead><tr>
      <th>Run ID</th><th>Agents</th><th>#</th><th>Cost</th><th>Turns</th><th>Duration</th><th>Status</th><th>Started</th>
    </tr></thead>
    <tbody id="run-table-body">${runTableRows}</tbody>
  </table>

  <div class="toast" id="toast"></div>

<script>
(function() {
  const dot = document.getElementById('conn-dot');
  const text = document.getElementById('conn-text');
  const toast = document.getElementById('toast');

  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3000);
  }

  function connect() {
    const es = new EventSource('/events');
    es.onopen = () => {
      dot.className = 'dot dot-connected';
      text.textContent = 'live';
    };
    es.onerror = () => {
      dot.className = 'dot dot-disconnected';
      text.textContent = 'reconnecting…';
    };
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === 'new_entry') {
          showToast('New: ' + data.entry.agent + ' (' + data.entry.run_id.slice(0,8) + '…)');
        }
        if (data.type === 'runs_update') {
          // Full refresh — simplest correct approach
          location.reload();
        }
      } catch {}
    };
  }

  connect();
})();
</script>
</body>
</html>`;
}

// ── Server ────────────────────────────────────────────────────────

function parseCliArgs(args: string[]): DashboardOptions {
  const timeline = buildTimelineConfig();
  let port = 3456;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--port" || args[i] === "-p") {
      port = parseInt(args[++i], 10);
      if (isNaN(port) || port < 1 || port > 65535) {
        console.error("Invalid port number");
        process.exit(1);
      }
    } else if (args[i] === "--help" || args[i] === "-h") {
      console.log(`Usage: claude-octopus dashboard [--port <n>]

Options:
  --port, -p <n>  Port number (default: 3456)
  --help, -h      Show this help
`);
      process.exit(0);
    }
  }

  return { port, timelineDir: timeline.dir };
}

export function runDashboardCli(args: string[]): void {
  const opts = parseCliArgs(args);

  const server = createServer(async (req, res) => {
    try {
      // API routes
      if (await handleApi(req, res, opts.timelineDir)) return;

      // Dashboard page
      if (req.url === "/" || req.url === "/index.html") {
        const html = await buildDashboardHtml(opts.timelineDir);
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(html);
        return;
      }

      // 404
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
    } catch (err) {
      console.error("Request error:", err);
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Internal Server Error");
    }
  });

  const watcher = watchTimeline(opts.timelineDir);

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(`Port ${opts.port} is already in use. Try --port <n>.`);
    } else {
      console.error(`Server error: ${err.message}`);
    }
    process.exit(1);
  });

  server.listen(opts.port, "127.0.0.1", () => {
    console.log(`
  Claude Octopus — Dashboard

  URL:      http://localhost:${opts.port}
  Timeline: ${opts.timelineDir}

  Watching for new agent activity…
  Press Ctrl+C to stop.
`);
  });

  // Graceful shutdown
  const cleanup = () => {
    watcher?.close();
    for (const client of sseClients) {
      try { client.end(); } catch {}
    }
    sseClients.clear();
    server.close();
  };
  process.on("SIGINT", () => { cleanup(); process.exit(0); });
  process.on("SIGTERM", () => { cleanup(); process.exit(0); });
}
