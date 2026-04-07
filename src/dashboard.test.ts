import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { appendTimeline, type TimelineEntry } from "./timeline.js";

/**
 * Tests for dashboard data layer.
 * The dashboard reuses listRuns/readTimeline from timeline.ts (tested there)
 * and the HTML generation is self-contained. These tests verify the
 * data flow works correctly for the dashboard's API endpoints.
 */

function makeEntry(overrides: Partial<TimelineEntry> = {}): TimelineEntry {
  return {
    run_id: "run-001",
    agent: "researcher",
    session_id: "ses-aaa",
    t0: "2026-04-07T10:00:00.000Z",
    t1: "2026-04-07T10:00:30.000Z",
    cost_usd: 0.05,
    turns: 4,
    is_error: false,
    subtype: "success",
    prompt_excerpt: "Research topic X",
    cwd: "/project",
    ...overrides,
  };
}

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "octopus-dashboard-test-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("dashboard data layer", () => {
  it("handles empty timeline gracefully", async () => {
    // Import listRuns to verify empty state
    const { listRuns } = await import("./timeline.js");
    const runs = await listRuns(tmpDir);
    expect(runs).toEqual([]);
  });

  it("provides run data for dashboard rendering", async () => {
    await appendTimeline(makeEntry({ run_id: "run-001", agent: "researcher" }), tmpDir);
    await appendTimeline(makeEntry({ run_id: "run-001", agent: "architect", session_id: "ses-bbb" }), tmpDir);
    await appendTimeline(makeEntry({ run_id: "run-002", agent: "verifier", session_id: "ses-ccc" }), tmpDir);

    const { listRuns, readTimeline } = await import("./timeline.js");
    const runs = await listRuns(tmpDir);
    expect(runs.length).toBe(2);

    // Most recent run has entries accessible
    const entries = await readTimeline(tmpDir, { runId: runs[0].run_id });
    expect(entries.length).toBeGreaterThan(0);
  });

  it("computes aggregate stats correctly", async () => {
    await appendTimeline(makeEntry({ run_id: "r1", cost_usd: 0.05, turns: 4 }), tmpDir);
    await appendTimeline(makeEntry({ run_id: "r1", cost_usd: 0.08, turns: 6, agent: "b", session_id: "ses-b" }), tmpDir);
    await appendTimeline(makeEntry({ run_id: "r2", cost_usd: 0.03, turns: 3, agent: "c", session_id: "ses-c" }), tmpDir);

    const { listRuns } = await import("./timeline.js");
    const runs = await listRuns(tmpDir);

    const totalCost = runs.reduce((s, r) => s + r.total_cost_usd, 0);
    const totalTurns = runs.reduce((s, r) => s + r.total_turns, 0);
    const totalAgents = runs.reduce((s, r) => s + r.entry_count, 0);

    expect(totalCost).toBeCloseTo(0.16);
    expect(totalTurns).toBe(13);
    expect(totalAgents).toBe(3);
  });
});
