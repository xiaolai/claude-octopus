/**
 * HTML report generator for workflow timeline.
 *
 * Reads the timeline index and (optionally) session transcripts,
 * produces a single self-contained HTML file with no external deps.
 */

import {
  getSessionMessages,
  type SessionMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { readTimeline, listRuns, type TimelineEntry, type RunSummary } from "./timeline.js";

// ── Types ─────────────────────────────────────────────────────────

export interface ReportOptions {
  timelineDir: string;
  runId?: string;
  includeTranscripts?: boolean;
}

interface AgentReport {
  entry: TimelineEntry;
  transcript: SessionMessage[] | null;
}

interface RunReport {
  summary: RunSummary;
  agents: AgentReport[];
}

// ── Data loading ──────────────────────────────────────────────────

async function loadRunReport(
  timelineDir: string,
  runId: string,
  includeTranscripts: boolean,
): Promise<RunReport | null> {
  const entries = await readTimeline(timelineDir, { runId });
  if (entries.length === 0) return null;

  const runs = await listRuns(timelineDir);
  const summary = runs.find((r) => r.run_id === runId);
  if (!summary) return null;

  const agents: AgentReport[] = [];
  for (const entry of entries) {
    let transcript: SessionMessage[] | null = null;
    if (includeTranscripts) {
      try {
        transcript = await getSessionMessages(entry.session_id, {
          dir: entry.cwd,
        });
      } catch {
        // Session may have been cleaned up — that's fine.
      }
    }
    agents.push({ entry, transcript });
  }

  return { summary, agents };
}

// ── HTML generation ───────────────────────────────────────────────

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

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function renderMessageContent(msg: SessionMessage): string {
  const message = msg.message as { content?: unknown; role?: string };
  if (!message) return "<em>empty</em>";

  const content = message.content;
  if (typeof content === "string") return esc(content);

  if (Array.isArray(content)) {
    return content
      .map((block: Record<string, unknown>) => {
        if (block.type === "text" && typeof block.text === "string") {
          return `<div class="text-block">${esc(block.text)}</div>`;
        }
        if (block.type === "tool_use") {
          const input = typeof block.input === "string"
            ? block.input
            : JSON.stringify(block.input, null, 2);
          return [
            `<div class="tool-call">`,
            `<span class="tool-name">${esc(String(block.name))}</span>`,
            `<pre class="tool-input">${esc(input).slice(0, 2000)}</pre>`,
            `</div>`,
          ].join("");
        }
        if (block.type === "tool_result") {
          const resultContent = typeof block.content === "string"
            ? block.content
            : JSON.stringify(block.content, null, 2);
          return [
            `<div class="tool-result">`,
            `<pre>${esc(resultContent).slice(0, 2000)}</pre>`,
            `</div>`,
          ].join("");
        }
        return `<pre class="unknown-block">${esc(JSON.stringify(block, null, 2)).slice(0, 500)}</pre>`;
      })
      .join("\n");
  }

  return `<pre>${esc(JSON.stringify(content, null, 2)).slice(0, 2000)}</pre>`;
}

function renderTranscript(messages: SessionMessage[]): string {
  if (messages.length === 0) return "<p class='empty'>No messages in transcript.</p>";

  return messages
    .map((msg) => {
      const role = msg.type === "user" ? "user" : msg.type === "assistant" ? "assistant" : "system";
      return `<div class="msg msg-${role}"><div class="msg-role">${role}</div><div class="msg-content">${renderMessageContent(msg)}</div></div>`;
    })
    .join("\n");
}

function renderAgent(agent: AgentReport, idx: number): string {
  const e = agent.entry;
  const statusClass = e.is_error ? "status-error" : "status-ok";
  const statusLabel = e.is_error ? e.subtype : "success";
  const duration = formatDuration(e.t0, e.t1);

  const transcriptSection = agent.transcript
    ? [
        `<details class="transcript">`,
        `<summary>Transcript (${agent.transcript.length} messages)</summary>`,
        `<div class="transcript-body">${renderTranscript(agent.transcript)}</div>`,
        `</details>`,
      ].join("\n")
    : `<p class="no-transcript">Transcript not loaded.</p>`;

  return [
    `<div class="agent-card">`,
    `  <div class="agent-header">`,
    `    <span class="agent-seq">${idx + 1}</span>`,
    `    <span class="agent-name">${esc(e.agent)}</span>`,
    `    <span class="agent-badge ${statusClass}">${esc(statusLabel)}</span>`,
    `  </div>`,
    `  <div class="agent-meta">`,
    `    <span>${formatTime(e.t0)}</span>`,
    `    <span>${duration}</span>`,
    `    <span>${formatCost(e.cost_usd)}</span>`,
    `    <span>${e.turns} turns</span>`,
    `    <span class="session-id" title="${esc(e.session_id)}">${esc(e.session_id.slice(0, 8))}…</span>`,
    `  </div>`,
    `  <div class="agent-prompt">${esc(e.prompt_excerpt)}</div>`,
    `  ${transcriptSection}`,
    `</div>`,
  ].join("\n");
}

function renderRun(run: RunReport): string {
  const s = run.summary;
  const duration = formatDuration(s.t0, s.t1);
  const errorBadge = s.has_errors
    ? '<span class="run-badge run-badge-error">has errors</span>'
    : '<span class="run-badge run-badge-ok">all ok</span>';

  return [
    `<div class="run">`,
    `  <div class="run-header">`,
    `    <h2>Run: <code>${esc(s.run_id)}</code></h2>`,
    `    ${errorBadge}`,
    `  </div>`,
    `  <div class="run-stats">`,
    `    <div class="stat"><div class="stat-val">${s.entry_count}</div><div class="stat-label">agents</div></div>`,
    `    <div class="stat"><div class="stat-val">${formatCost(s.total_cost_usd)}</div><div class="stat-label">total cost</div></div>`,
    `    <div class="stat"><div class="stat-val">${s.total_turns}</div><div class="stat-label">total turns</div></div>`,
    `    <div class="stat"><div class="stat-val">${duration}</div><div class="stat-label">duration</div></div>`,
    `    <div class="stat"><div class="stat-val">${formatTime(s.t0)}</div><div class="stat-label">started</div></div>`,
    `  </div>`,
    `  <div class="agent-sequence">`,
    `    <h3>Agent Sequence</h3>`,
    `    <div class="timeline-bar">`,
    ...run.agents.map((a, i) => {
      const cls = a.entry.is_error ? "dot-error" : "dot-ok";
      return `      <div class="timeline-dot ${cls}" title="${esc(a.entry.agent)}">${i + 1}</div>`;
    }),
    `    </div>`,
    `    ${run.agents.map((a, i) => renderAgent(a, i)).join("\n")}`,
    `  </div>`,
    `</div>`,
  ].join("\n");
}

function renderRunList(runs: RunSummary[]): string {
  if (runs.length === 0) return "<p>No runs recorded yet.</p>";

  const rows = runs
    .map((r) => {
      const dur = formatDuration(r.t0, r.t1);
      const statusCls = r.has_errors ? "status-error" : "status-ok";
      return [
        `<tr>`,
        `  <td><code>${esc(r.run_id)}</code></td>`,
        `  <td>${r.agents.map(esc).join(" → ")}</td>`,
        `  <td>${r.entry_count}</td>`,
        `  <td>${formatCost(r.total_cost_usd)}</td>`,
        `  <td>${r.total_turns}</td>`,
        `  <td>${dur}</td>`,
        `  <td class="${statusCls}">${r.has_errors ? "errors" : "ok"}</td>`,
        `  <td>${formatTime(r.t0)}</td>`,
        `</tr>`,
      ].join("\n");
    })
    .join("\n");

  return [
    `<table class="run-table">`,
    `<thead><tr>`,
    `  <th>Run ID</th><th>Agents</th><th>#</th><th>Cost</th><th>Turns</th><th>Duration</th><th>Status</th><th>Started</th>`,
    `</tr></thead>`,
    `<tbody>${rows}</tbody>`,
    `</table>`,
  ].join("\n");
}

const CSS = `
:root {
  --bg: #0d1117; --surface: #161b22; --border: #30363d;
  --text: #e6edf3; --text-dim: #8b949e; --text-bright: #f0f6fc;
  --accent: #58a6ff; --green: #3fb950; --red: #f85149; --orange: #d29922;
  --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
  --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
}
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: var(--font); background: var(--bg); color: var(--text); padding: 2rem; max-width: 1200px; margin: 0 auto; line-height: 1.5; }
h1 { color: var(--text-bright); margin-bottom: 0.5rem; }
h2 { color: var(--text-bright); font-size: 1.3rem; }
h3 { color: var(--text); font-size: 1rem; margin: 1rem 0 0.5rem; }
code { font-family: var(--mono); background: var(--surface); padding: 0.15em 0.4em; border-radius: 4px; font-size: 0.9em; }
pre { font-family: var(--mono); font-size: 0.8em; overflow-x: auto; white-space: pre-wrap; word-break: break-word; }
a { color: var(--accent); text-decoration: none; }
.subtitle { color: var(--text-dim); margin-bottom: 2rem; }

/* Run list table */
.run-table { width: 100%; border-collapse: collapse; margin: 1rem 0; }
.run-table th, .run-table td { padding: 0.5rem 0.75rem; text-align: left; border-bottom: 1px solid var(--border); font-size: 0.85rem; }
.run-table th { color: var(--text-dim); font-weight: 600; }
.run-table tbody tr:hover { background: var(--surface); }

/* Run detail */
.run { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 1.5rem; margin-bottom: 2rem; }
.run-header { display: flex; align-items: center; gap: 1rem; margin-bottom: 1rem; }
.run-badge { font-size: 0.75rem; padding: 0.2em 0.6em; border-radius: 12px; font-weight: 600; }
.run-badge-ok { background: rgba(63,185,80,0.15); color: var(--green); }
.run-badge-error { background: rgba(248,81,73,0.15); color: var(--red); }

.run-stats { display: flex; gap: 2rem; margin-bottom: 1.5rem; flex-wrap: wrap; }
.stat { text-align: center; }
.stat-val { font-size: 1.3rem; font-weight: 700; color: var(--text-bright); }
.stat-label { font-size: 0.75rem; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.05em; }

/* Timeline bar */
.timeline-bar { display: flex; align-items: center; gap: 0; margin-bottom: 1rem; padding: 0.5rem 0; }
.timeline-dot { width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 0.75rem; font-weight: 700; color: var(--bg); flex-shrink: 0; }
.timeline-dot + .timeline-dot { margin-left: -1px; }
.timeline-dot::before { content: ""; position: absolute; }
.dot-ok { background: var(--green); }
.dot-error { background: var(--red); }
.timeline-dot + .timeline-dot { margin-left: 4px; }

/* Agent cards */
.agent-card { border: 1px solid var(--border); border-radius: 6px; padding: 1rem; margin-bottom: 0.75rem; background: var(--bg); }
.agent-header { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.5rem; }
.agent-seq { width: 24px; height: 24px; border-radius: 50%; background: var(--accent); color: var(--bg); display: flex; align-items: center; justify-content: center; font-size: 0.7rem; font-weight: 700; flex-shrink: 0; }
.agent-name { font-weight: 700; font-size: 1rem; color: var(--text-bright); }
.agent-badge { font-size: 0.7rem; padding: 0.15em 0.5em; border-radius: 10px; font-weight: 600; }
.status-ok { background: rgba(63,185,80,0.15); color: var(--green); }
.status-error { background: rgba(248,81,73,0.15); color: var(--red); }
.agent-meta { display: flex; gap: 1rem; font-size: 0.8rem; color: var(--text-dim); margin-bottom: 0.5rem; flex-wrap: wrap; }
.session-id { font-family: var(--mono); font-size: 0.75rem; }
.agent-prompt { font-size: 0.85rem; color: var(--text-dim); font-style: italic; margin-bottom: 0.75rem; }

/* Transcript */
.transcript { margin-top: 0.5rem; }
.transcript > summary { cursor: pointer; font-size: 0.85rem; color: var(--accent); font-weight: 600; padding: 0.3rem 0; }
.transcript-body { margin-top: 0.5rem; max-height: 600px; overflow-y: auto; border: 1px solid var(--border); border-radius: 4px; padding: 0.5rem; }
.msg { padding: 0.5rem; border-bottom: 1px solid var(--border); }
.msg:last-child { border-bottom: none; }
.msg-role { font-size: 0.7rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.25rem; }
.msg-user .msg-role { color: var(--accent); }
.msg-assistant .msg-role { color: var(--green); }
.msg-system .msg-role { color: var(--orange); }
.msg-content { font-size: 0.8rem; }
.text-block { margin-bottom: 0.5rem; white-space: pre-wrap; }
.tool-call { background: rgba(88,166,255,0.08); border: 1px solid rgba(88,166,255,0.2); border-radius: 4px; padding: 0.5rem; margin: 0.25rem 0; }
.tool-name { font-family: var(--mono); font-weight: 700; color: var(--accent); font-size: 0.8rem; }
.tool-input { margin-top: 0.25rem; color: var(--text-dim); font-size: 0.75rem; max-height: 200px; overflow-y: auto; }
.tool-result { background: rgba(63,185,80,0.05); border: 1px solid rgba(63,185,80,0.15); border-radius: 4px; padding: 0.5rem; margin: 0.25rem 0; }
.tool-result pre { color: var(--text-dim); font-size: 0.75rem; max-height: 200px; overflow-y: auto; }
.no-transcript { font-size: 0.8rem; color: var(--text-dim); font-style: italic; }
.empty { color: var(--text-dim); font-style: italic; }
`;

function wrapHtml(title: string, body: string): string {
  return [
    `<!DOCTYPE html>`,
    `<html lang="en">`,
    `<head>`,
    `<meta charset="utf-8">`,
    `<meta name="viewport" content="width=device-width, initial-scale=1">`,
    `<title>${esc(title)}</title>`,
    `<style>${CSS}</style>`,
    `</head>`,
    `<body>`,
    body,
    `</body>`,
    `</html>`,
  ].join("\n");
}

// ── Public API ────────────────────────────────────────────────────

/**
 * Generate an HTML report for a specific run.
 */
export async function generateRunReport(opts: ReportOptions & { runId: string }): Promise<string> {
  const run = await loadRunReport(opts.timelineDir, opts.runId, opts.includeTranscripts ?? true);
  if (!run) {
    return wrapHtml(
      "Run Not Found",
      `<h1>Run Not Found</h1><p>No timeline entries found for run <code>${esc(opts.runId)}</code>.</p>`,
    );
  }

  const body = [
    `<h1>Claude Octopus — Run Report</h1>`,
    `<p class="subtitle">Generated ${new Date().toISOString()}</p>`,
    renderRun(run),
  ].join("\n");

  return wrapHtml(`Run: ${opts.runId}`, body);
}

/**
 * Generate an HTML report listing all runs.
 */
export async function generateIndexReport(opts: ReportOptions): Promise<string> {
  const runs = await listRuns(opts.timelineDir);

  const body = [
    `<h1>Claude Octopus — Timeline</h1>`,
    `<p class="subtitle">Generated ${new Date().toISOString()} — ${runs.length} run${runs.length !== 1 ? "s" : ""} recorded</p>`,
    renderRunList(runs),
  ].join("\n");

  return wrapHtml("Claude Octopus Timeline", body);
}

/**
 * Generate a report — run detail if runId provided, index otherwise.
 */
export async function generateReport(opts: ReportOptions): Promise<string> {
  if (opts.runId) {
    return generateRunReport({ ...opts, runId: opts.runId });
  }
  return generateIndexReport(opts);
}
