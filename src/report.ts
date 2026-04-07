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
import { readTimeline, listRuns } from "./timeline.js";
import { esc } from "./lib.js";
import { REPORT_CSS } from "./report-styles.js";
import {
  renderRun,
  renderRunList,
  type AgentReport,
  type RunReport,
} from "./report-renderers.js";

// ── Types ─────────────────────────────────────────────────────────

export interface ReportOptions {
  timelineDir: string;
  runId?: string;
  includeTranscripts?: boolean;
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

// ── HTML wrapper ─────────────────────────────────────────────────

function wrapHtml(title: string, body: string): string {
  return [
    `<!DOCTYPE html>`,
    `<html lang="en">`,
    `<head>`,
    `<meta charset="utf-8">`,
    `<meta name="viewport" content="width=device-width, initial-scale=1">`,
    `<title>${esc(title)}</title>`,
    `<style>${REPORT_CSS}</style>`,
    `</head>`,
    `<body>`,
    body,
    `</body>`,
    `</html>`,
  ].join("\n");
}

// ── Public API ────────────────────────────────────────────────────

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

export async function generateIndexReport(opts: ReportOptions): Promise<string> {
  const runs = await listRuns(opts.timelineDir);

  const body = [
    `<h1>Claude Octopus — Timeline</h1>`,
    `<p class="subtitle">Generated ${new Date().toISOString()} — ${runs.length} run${runs.length !== 1 ? "s" : ""} recorded</p>`,
    renderRunList(runs),
  ].join("\n");

  return wrapHtml("Claude Octopus Timeline", body);
}

export async function generateReport(opts: ReportOptions): Promise<string> {
  if (opts.runId) {
    return generateRunReport({ ...opts, runId: opts.runId });
  }
  return generateIndexReport(opts);
}
