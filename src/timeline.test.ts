import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  appendTimeline,
  readTimeline,
  listRuns,
  type TimelineEntry,
} from "./timeline.js";

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
  tmpDir = await mkdtemp(join(tmpdir(), "octopus-timeline-test-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

// ── appendTimeline ──────────────────────────────────────────────

describe("appendTimeline", () => {
  it("creates directory and writes JSONL", async () => {
    const dir = join(tmpDir, "nested", "dir");
    await appendTimeline(makeEntry(), dir);
    const content = await readFile(join(dir, "timeline.jsonl"), "utf-8");
    const parsed = JSON.parse(content.trim());
    expect(parsed.run_id).toBe("run-001");
    expect(parsed.agent).toBe("researcher");
  });

  it("appends multiple entries", async () => {
    await appendTimeline(makeEntry({ agent: "researcher" }), tmpDir);
    await appendTimeline(makeEntry({ agent: "architect" }), tmpDir);
    const content = await readFile(join(tmpDir, "timeline.jsonl"), "utf-8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).agent).toBe("researcher");
    expect(JSON.parse(lines[1]).agent).toBe("architect");
  });

  it("never throws on write failure", async () => {
    // Pass a path that can't be created (null byte in path)
    await expect(
      appendTimeline(makeEntry(), "/dev/null/impossible\0path")
    ).resolves.toBeUndefined();
  });
});

// ── readTimeline ────────────────────────────────────────────────

describe("readTimeline", () => {
  it("returns empty array for missing file", async () => {
    const entries = await readTimeline(join(tmpDir, "nonexistent"));
    expect(entries).toEqual([]);
  });

  it("returns all entries when no filter", async () => {
    await appendTimeline(makeEntry({ agent: "a" }), tmpDir);
    await appendTimeline(makeEntry({ agent: "b" }), tmpDir);
    const entries = await readTimeline(tmpDir);
    expect(entries).toHaveLength(2);
  });

  it("filters by run_id and sorts by t0", async () => {
    await appendTimeline(makeEntry({ run_id: "run-001", t0: "2026-04-07T10:01:00Z" }), tmpDir);
    await appendTimeline(makeEntry({ run_id: "run-002" }), tmpDir);
    await appendTimeline(makeEntry({ run_id: "run-001", t0: "2026-04-07T10:00:00Z" }), tmpDir);
    const entries = await readTimeline(tmpDir, { runId: "run-001" });
    expect(entries).toHaveLength(2);
    // Sorted by t0 — second entry should come first
    expect(entries[0].t0).toBe("2026-04-07T10:00:00Z");
    expect(entries[1].t0).toBe("2026-04-07T10:01:00Z");
  });

  it("filters by session_id", async () => {
    await appendTimeline(makeEntry({ session_id: "ses-aaa" }), tmpDir);
    await appendTimeline(makeEntry({ session_id: "ses-bbb" }), tmpDir);
    const entries = await readTimeline(tmpDir, { sessionId: "ses-aaa" });
    expect(entries).toHaveLength(1);
    expect(entries[0].session_id).toBe("ses-aaa");
  });

  it("skips malformed lines", async () => {
    const { appendFile } = await import("node:fs/promises");
    const path = join(tmpDir, "timeline.jsonl");
    await appendFile(path, '{"run_id":"run-001","agent":"good","session_id":"ses-1"}\n');
    await appendFile(path, "THIS IS NOT JSON\n");
    await appendFile(path, '{"run_id":"run-001","agent":"also-good","session_id":"ses-2"}\n');
    const entries = await readTimeline(tmpDir);
    expect(entries).toHaveLength(2);
  });
});

// ── listRuns ────────────────────────────────────────────────────

describe("listRuns", () => {
  it("returns empty for missing file", async () => {
    const runs = await listRuns(join(tmpDir, "nonexistent"));
    expect(runs).toEqual([]);
  });

  it("groups entries by run_id", async () => {
    await appendTimeline(makeEntry({ run_id: "run-001", agent: "researcher", cost_usd: 0.05, turns: 4 }), tmpDir);
    await appendTimeline(makeEntry({ run_id: "run-001", agent: "architect", cost_usd: 0.08, turns: 6 }), tmpDir);
    await appendTimeline(makeEntry({ run_id: "run-002", agent: "verifier", cost_usd: 0.03, turns: 3 }), tmpDir);

    const runs = await listRuns(tmpDir);
    expect(runs).toHaveLength(2);

    const run001 = runs.find((r) => r.run_id === "run-001")!;
    expect(run001.agents).toEqual(["researcher", "architect"]);
    expect(run001.total_cost_usd).toBeCloseTo(0.13);
    expect(run001.total_turns).toBe(10);
    expect(run001.entry_count).toBe(2);
    expect(run001.has_errors).toBe(false);
  });

  it("sorts runs most-recent first", async () => {
    await appendTimeline(makeEntry({ run_id: "old", t0: "2026-04-01T10:00:00Z" }), tmpDir);
    await appendTimeline(makeEntry({ run_id: "new", t0: "2026-04-07T10:00:00Z" }), tmpDir);
    const runs = await listRuns(tmpDir);
    expect(runs[0].run_id).toBe("new");
    expect(runs[1].run_id).toBe("old");
  });

  it("detects errors in runs", async () => {
    await appendTimeline(makeEntry({ run_id: "run-err", is_error: false }), tmpDir);
    await appendTimeline(makeEntry({ run_id: "run-err", is_error: true, subtype: "error_max_turns" }), tmpDir);
    const runs = await listRuns(tmpDir);
    expect(runs[0].has_errors).toBe(true);
  });
});
