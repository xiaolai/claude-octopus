/**
 * Dashboard HTML template — CSS, JS, renderers, and page builder.
 * Extracted from dashboard.ts.
 */

import { type RunSummary, type TimelineEntry } from "./timeline.js";
import { esc, formatCost, formatDuration } from "./lib.js";

// ── CSS ──────────────────────────────────────────────────────────

const DASHBOARD_CSS = `
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

.connection { display: inline-flex; align-items: center; gap: 0.4rem; font-size: 0.8rem; color: var(--text-dim); float: right; margin-top: 0.25rem; }
.dot { width: 8px; height: 8px; border-radius: 50%; }
.dot-connected { background: var(--green); }
.dot-disconnected { background: var(--red); }

.stats { display: flex; gap: 2rem; margin-bottom: 1.5rem; flex-wrap: wrap; }
.stat-card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 1rem 1.5rem; min-width: 120px; }
.stat-val { font-size: 1.5rem; font-weight: 700; color: var(--text-bright); }
.stat-label { font-size: 0.75rem; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.05em; }

.run-table { width: 100%; border-collapse: collapse; margin: 0.5rem 0 1.5rem; }
.run-table th, .run-table td { padding: 0.5rem 0.75rem; text-align: left; border-bottom: 1px solid var(--border); font-size: 0.85rem; }
.run-table th { color: var(--text-dim); font-weight: 600; }
.run-table tbody tr:hover { background: var(--surface); cursor: pointer; }
.status-ok { color: var(--green); }
.status-error { color: var(--red); }

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

.toast { position: fixed; bottom: 1.5rem; right: 1.5rem; background: var(--surface); border: 1px solid var(--accent); border-radius: 8px; padding: 0.75rem 1rem; font-size: 0.85rem; color: var(--accent); opacity: 0; transition: opacity 0.3s; pointer-events: none; z-index: 100; }
.toast.show { opacity: 1; }
`;

// ── Client-side JS ───────────────────────────────────────────────

const DASHBOARD_JS = `
(function() {
  var dot = document.getElementById('conn-dot');
  var text = document.getElementById('conn-text');
  var toast = document.getElementById('toast');

  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(function() { toast.classList.remove('show'); }, 3000);
  }

  function connect() {
    var es = new EventSource('/events');
    es.onopen = function() {
      dot.className = 'dot dot-connected';
      text.textContent = 'live';
    };
    es.onerror = function() {
      dot.className = 'dot dot-disconnected';
      text.textContent = 'reconnecting\u2026';
    };
    es.onmessage = function(e) {
      try {
        var data = JSON.parse(e.data);
        if (data.type === 'new_entry') {
          showToast('New: ' + data.entry.agent + ' (' + data.entry.run_id.slice(0,8) + '\u2026)');
        }
        if (data.type === 'runs_update') {
          location.reload();
        }
      } catch(err) {}
    };
  }

  connect();
})();
`;

// ── Renderers ────────────────────────────────────────────────────

function renderRunRow(r: RunSummary): string {
  const dur = formatDuration(r.t0, r.t1);
  const statusCls = r.has_errors ? "status-error" : "status-ok";
  const agentList = r.agents.map(esc).join(" \u2192 ");
  return `<tr class="run-row" data-run-id="${esc(r.run_id)}">
    <td><code>${esc(r.run_id.slice(0, 12))}\u2026</code></td>
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
      <span class="mono">${esc(e.session_id.slice(0, 8))}\u2026</span>
    </div>
    <div class="entry-prompt">${esc(e.prompt_excerpt)}</div>
  </div>`;
}

// ── Page builder ─────────────────────────────────────────────────

export interface DashboardData {
  runs: RunSummary[];
  recentEntries: TimelineEntry[];
}

export async function buildDashboardHtml(
  runs: RunSummary[],
  recentEntries: TimelineEntry[],
): Promise<string> {
  const totalCost = runs.reduce((s, r) => s + r.total_cost_usd, 0);
  const totalAgents = runs.reduce((s, r) => s + r.entry_count, 0);
  const totalTurns = runs.reduce((s, r) => s + r.total_turns, 0);
  const errorCount = runs.filter((r) => r.has_errors).length;

  let recentRunHtml = "<p class='empty'>No runs yet. Start an agent to see activity here.</p>";
  if (runs.length > 0) {
    const recent = runs[0];
    recentRunHtml = `
      <h3>Latest: <code>${esc(recent.run_id)}</code></h3>
      <div class="entry-list">
        ${recentEntries.map((e, i) => renderEntryCard(e, i)).join("\n")}
      </div>`;
  }

  const runTableRows = runs.map(renderRunRow).join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Claude Octopus \u2014 Dashboard</title>
<style>${DASHBOARD_CSS}</style>
</head>
<body>
  <div>
    <h1>Claude Octopus \u2014 Dashboard</h1>
    <span class="connection"><span class="dot dot-disconnected" id="conn-dot"></span><span id="conn-text">connecting\u2026</span></span>
    <p class="subtitle">Live timeline \u2014 auto-refreshes when agents run</p>
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

<script>${DASHBOARD_JS}</script>
</body>
</html>`;
}
