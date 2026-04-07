/**
 * Timeline index — cross-agent run correlation.
 *
 * Append-only JSONL ledger that records metadata per agent invocation.
 * Full transcripts stay in Claude Code's session storage; this index
 * provides the table-of-contents and cross-references via session_id.
 */

import { mkdir, appendFile, readFile } from "node:fs/promises";
import { join } from "node:path";

// ── Types ─────────────────────────────────────────────────────────

export interface TimelineEntry {
  run_id: string;
  agent: string;
  session_id: string;
  t0: string;
  t1: string;
  cost_usd: number;
  turns: number;
  is_error: boolean;
  subtype: string;
  prompt_excerpt: string;
  cwd: string;
}

export interface RunSummary {
  run_id: string;
  agents: string[];
  t0: string;
  t1: string;
  total_cost_usd: number;
  total_turns: number;
  has_errors: boolean;
  entry_count: number;
}

export interface ReadTimelineOptions {
  runId?: string;
  sessionId?: string;
}

// ── Constants ─────────────────────────────────────────────────────

const TIMELINE_FILE = "timeline.jsonl";

// ── Writer ────────────────────────────────────────────────────────

function timelinePath(dir: string): string {
  return join(dir, TIMELINE_FILE);
}

/**
 * Append a timeline entry. Best-effort: never throws.
 * Creates the directory tree if it doesn't exist.
 */
export async function appendTimeline(
  entry: TimelineEntry,
  dir: string,
): Promise<void> {
  try {
    await mkdir(dir, { recursive: true });
    const line = JSON.stringify(entry) + "\n";
    await appendFile(timelinePath(dir), line, "utf-8");
  } catch {
    // Best-effort — never fail the primary query because indexing broke.
  }
}

// ── Reader ────────────────────────────────────────────────────────

/**
 * Parse all timeline entries, skipping malformed lines.
 */
async function parseEntries(dir: string): Promise<TimelineEntry[]> {
  let raw: string;
  try {
    raw = await readFile(timelinePath(dir), "utf-8");
  } catch {
    return [];
  }
  const entries: TimelineEntry[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line) as TimelineEntry);
    } catch {
      // Skip malformed lines — corruption tolerance.
    }
  }
  return entries;
}

/**
 * Read timeline entries, optionally filtered.
 */
export async function readTimeline(
  dir: string,
  opts?: ReadTimelineOptions,
): Promise<TimelineEntry[]> {
  const entries = await parseEntries(dir);
  if (opts?.runId) {
    return entries
      .filter((e) => e.run_id === opts.runId)
      .sort((a, b) => a.t0.localeCompare(b.t0));
  }
  if (opts?.sessionId) {
    return entries.filter((e) => e.session_id === opts.sessionId);
  }
  return entries;
}

/**
 * Group entries by run_id and return summaries, most recent first.
 */
export async function listRuns(dir: string): Promise<RunSummary[]> {
  const entries = await parseEntries(dir);
  const groups = new Map<string, TimelineEntry[]>();
  for (const e of entries) {
    const list = groups.get(e.run_id) || [];
    list.push(e);
    groups.set(e.run_id, list);
  }

  const summaries: RunSummary[] = [];
  for (const [run_id, list] of groups) {
    list.sort((a, b) => a.t0.localeCompare(b.t0));
    summaries.push({
      run_id,
      agents: list.map((e) => e.agent),
      t0: list[0].t0,
      t1: list[list.length - 1].t1,
      total_cost_usd: list.reduce((s, e) => s + e.cost_usd, 0),
      total_turns: list.reduce((s, e) => s + e.turns, 0),
      has_errors: list.some((e) => e.is_error),
      entry_count: list.length,
    });
  }

  // Most recent run first.
  summaries.sort((a, b) => b.t0.localeCompare(a.t0));
  return summaries;
}
