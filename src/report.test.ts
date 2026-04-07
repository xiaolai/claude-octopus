import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { appendTimeline, type TimelineEntry } from "./timeline.js";
import { generateReport, generateRunReport, generateIndexReport } from "./report.js";

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
  tmpDir = await mkdtemp(join(tmpdir(), "octopus-report-test-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("generateIndexReport", () => {
  it("produces valid HTML for empty timeline", async () => {
    const html = await generateIndexReport({ timelineDir: tmpDir });
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("Claude Octopus");
    expect(html).toContain("0 runs recorded");
  });

  it("lists runs in the report", async () => {
    await appendTimeline(makeEntry({ run_id: "run-001", agent: "researcher" }), tmpDir);
    await appendTimeline(makeEntry({ run_id: "run-001", agent: "architect" }), tmpDir);
    await appendTimeline(makeEntry({ run_id: "run-002", agent: "verifier" }), tmpDir);

    const html = await generateIndexReport({ timelineDir: tmpDir });
    expect(html).toContain("run-001");
    expect(html).toContain("run-002");
    expect(html).toContain("researcher");
  });
});

describe("generateRunReport", () => {
  it("returns not-found page for missing run", async () => {
    const html = await generateRunReport({
      timelineDir: tmpDir,
      runId: "nonexistent",
    });
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("Run Not Found");
  });

  it("produces detailed report for a run", async () => {
    await appendTimeline(makeEntry({
      run_id: "run-001",
      agent: "researcher",
      cost_usd: 0.05,
      turns: 4,
    }), tmpDir);
    await appendTimeline(makeEntry({
      run_id: "run-001",
      agent: "architect",
      cost_usd: 0.08,
      turns: 6,
      session_id: "ses-bbb",
    }), tmpDir);

    const html = await generateRunReport({
      timelineDir: tmpDir,
      runId: "run-001",
      includeTranscripts: false,
    });

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("run-001");
    expect(html).toContain("researcher");
    expect(html).toContain("architect");
    expect(html).toContain("$0.05");
    expect(html).toContain("$0.08");
    expect(html).toContain("4 turns");
    expect(html).toContain("6 turns");
    expect(html).toContain("Transcript not loaded");
  });

  it("shows error status for failed agents", async () => {
    await appendTimeline(makeEntry({
      run_id: "run-err",
      agent: "broken",
      is_error: true,
      subtype: "error_max_turns",
    }), tmpDir);

    const html = await generateRunReport({
      timelineDir: tmpDir,
      runId: "run-err",
      includeTranscripts: false,
    });

    expect(html).toContain("error_max_turns");
    expect(html).toContain("has errors");
  });

  it("escapes HTML in prompt excerpts", async () => {
    await appendTimeline(makeEntry({
      run_id: "run-xss",
      prompt_excerpt: '<script>alert("xss")</script>',
    }), tmpDir);

    const html = await generateRunReport({
      timelineDir: tmpDir,
      runId: "run-xss",
      includeTranscripts: false,
    });

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("generateReport", () => {
  it("delegates to index report when no runId", async () => {
    const html = await generateReport({ timelineDir: tmpDir });
    expect(html).toContain("Timeline");
    expect(html).toContain("0 runs");
  });

  it("delegates to run report when runId provided", async () => {
    await appendTimeline(makeEntry({ run_id: "run-001" }), tmpDir);
    const html = await generateReport({ timelineDir: tmpDir, runId: "run-001" });
    expect(html).toContain("Run Report");
    expect(html).toContain("run-001");
  });
});
