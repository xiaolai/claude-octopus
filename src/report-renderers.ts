/**
 * HTML rendering functions for the report — extracted from report.ts.
 */

import type { SessionMessage } from "@anthropic-ai/claude-agent-sdk";
import type { TimelineEntry, RunSummary } from "./timeline.js";
import { esc, formatCost, formatDuration, formatTime } from "./lib.js";

// ── Types (internal to rendering) ────────────────────────────────

export interface AgentReport {
  entry: TimelineEntry;
  transcript: SessionMessage[] | null;
}

export interface RunReport {
  summary: RunSummary;
  agents: AgentReport[];
}

// ── Message content ──────────────────────────────────────────────

function renderMessageContent(msg: SessionMessage): string {
  const message = msg.message;
  if (!message || typeof message !== "object") {
    return typeof message === "string" ? esc(message) : "<em>empty</em>";
  }

  const content = (message as Record<string, unknown>).content;
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

// ── Transcript ───────────────────────────────────────────────────

function renderTranscript(messages: SessionMessage[]): string {
  if (messages.length === 0) return "<p class='empty'>No messages in transcript.</p>";

  return messages
    .map((msg) => {
      const role = msg.type === "user" ? "user" : msg.type === "assistant" ? "assistant" : "system";
      return `<div class="msg msg-${role}"><div class="msg-role">${role}</div><div class="msg-content">${renderMessageContent(msg)}</div></div>`;
    })
    .join("\n");
}

// ── Agent card ───────────────────────────────────────────────────

export function renderAgent(agent: AgentReport, idx: number): string {
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
    `    <span class="session-id" title="${esc(e.session_id)}">${esc(e.session_id.slice(0, 8))}\u2026</span>`,
    `  </div>`,
    `  <div class="agent-prompt">${esc(e.prompt_excerpt)}</div>`,
    `  ${transcriptSection}`,
    `</div>`,
  ].join("\n");
}

// ── Run detail ───────────────────────────────────────────────────

export function renderRun(run: RunReport): string {
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

// ── Run list table ───────────────────────────────────────────────

export function renderRunList(runs: RunSummary[]): string {
  if (runs.length === 0) return "<p>No runs recorded yet.</p>";

  const rows = runs
    .map((r) => {
      const dur = formatDuration(r.t0, r.t1);
      const statusCls = r.has_errors ? "status-error" : "status-ok";
      return [
        `<tr>`,
        `  <td><code>${esc(r.run_id)}</code></td>`,
        `  <td>${r.agents.map(esc).join(" \u2192 ")}</td>`,
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
