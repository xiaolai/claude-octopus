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
import { listRuns, readTimeline } from "./timeline.js";
import { buildDashboardHtml } from "./dashboard-template.js";

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

  stat(filePath).then((s) => { lastSize = s.size; }).catch(() => {});

  async function onchange(filename: string | null): Promise<void> {
    if (filename && filename !== "timeline.jsonl") return;
    if (processing) return;
    processing = true;
    try {
      const s = await stat(filePath);
      if (s.size <= lastSize) return;

      const { createReadStream } = await import("node:fs");
      const newData = await new Promise<string>((resolve, reject) => {
        let buf = "";
        const stream = createReadStream(filePath, { start: lastSize, encoding: "utf-8" });
        stream.on("data", (chunk) => { buf += String(chunk); });
        stream.on("end", () => resolve(buf));
        stream.on("error", reject);
      });
      lastSize = s.size;

      for (const line of newData.split("\n")) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line);
          broadcastSSE({ type: "new_entry", entry });
        } catch {
          // Skip malformed
        }
      }

      const runs = await listRuns(dir);
      broadcastSSE({ type: "runs_update", runs });
    } catch {
      // File may not exist yet — that's fine
    } finally {
      processing = false;
    }
  }

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

// ── CLI + Server ─────────────────────────────────────────────────

interface DashboardOptions {
  port: number;
  timelineDir: string;
}

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
      if (await handleApi(req, res, opts.timelineDir)) return;

      if (req.url === "/" || req.url === "/index.html") {
        const runs = await listRuns(opts.timelineDir);
        const recentEntries = runs.length > 0
          ? await readTimeline(opts.timelineDir, { runId: runs[0].run_id })
          : [];
        const html = await buildDashboardHtml(runs, recentEntries);
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(html);
        return;
      }

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
  Claude Octopus \u2014 Dashboard

  URL:      http://localhost:${opts.port}
  Timeline: ${opts.timelineDir}

  Watching for new agent activity\u2026
  Press Ctrl+C to stop.
`);
  });

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
