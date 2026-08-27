import { describe, it, expect } from "vitest";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { Options } from "./types.js";
import {
  consumeQuery,
  buildResultPayload,
  mergeSystemPrompt,
} from "./query-helpers.js";

// ── Stream fixtures ───────────────────────────────────────────────

function assistant(
  id: string,
  blocks: Array<{ type: string; name?: string }>,
  parentToolUseId: string | null = null,
): SDKMessage {
  return {
    type: "assistant",
    parent_tool_use_id: parentToolUseId,
    uuid: `uuid-${id}`,
    session_id: "ses-1",
    message: { id, content: blocks },
  } as unknown as SDKMessage;
}

function result(overrides: Record<string, unknown> = {}): SDKMessage {
  return {
    type: "result",
    subtype: "success",
    session_id: "ses-1",
    duration_ms: 1000,
    duration_api_ms: 900,
    is_error: false,
    num_turns: 5,
    total_cost_usd: 0.02,
    result: "done",
    uuid: "uuid-result",
    ...overrides,
  } as unknown as SDKMessage;
}

async function* stream(...messages: SDKMessage[]): AsyncIterable<SDKMessage> {
  for (const m of messages) yield m;
}

/** Yields every message, then throws — how the SDK reports a non-zero exit. */
async function* streamThenThrow(
  err: Error,
  ...messages: SDKMessage[]
): AsyncIterable<SDKMessage> {
  for (const m of messages) yield m;
  throw err;
}

// ── consumeQuery ──────────────────────────────────────────────────

describe("consumeQuery", () => {
  it("counts parallel tool calls as one response group", async () => {
    // The shape from the issue: 3 assistant responses, 5 tool calls.
    const outcome = await consumeQuery(
      stream(
        assistant("msg_a", [{ type: "thinking" }]),
        assistant("msg_a", [{ type: "text" }]),
        assistant("msg_a", [{ type: "tool_use", name: "Read" }]),
        assistant("msg_a", [{ type: "tool_use", name: "Read" }]),
        assistant("msg_a", [{ type: "tool_use", name: "Grep" }]),
        assistant("msg_b", [{ type: "tool_use", name: "Read" }]),
        assistant("msg_b", [{ type: "tool_use", name: "Read" }]),
        assistant("msg_c", [{ type: "text" }]),
        result({ num_turns: 6 }),
      ),
    );

    expect(outcome.metrics.response_groups).toBe(3);
    expect(outcome.metrics.tool_calls).toBe(5);
    // The raw SDK value is passed through untouched, inflation and all.
    expect(outcome.result.num_turns).toBe(6);
  });

  it("counts several tool_use blocks inside one message", async () => {
    const outcome = await consumeQuery(
      stream(
        assistant("msg_a", [
          { type: "text" },
          { type: "tool_use", name: "Read" },
          { type: "tool_use", name: "Read" },
        ]),
        result(),
      ),
    );

    expect(outcome.metrics.response_groups).toBe(1);
    expect(outcome.metrics.tool_calls).toBe(2);
  });

  it("excludes sub-agent messages from both counts", async () => {
    const outcome = await consumeQuery(
      stream(
        assistant("msg_a", [{ type: "tool_use", name: "Task" }]),
        assistant("sub_1", [{ type: "tool_use", name: "Read" }], "toolu_123"),
        assistant("sub_1", [{ type: "tool_use", name: "Read" }], "toolu_123"),
        assistant("msg_b", [{ type: "text" }]),
        result(),
      ),
    );

    expect(outcome.metrics.response_groups).toBe(2);
    expect(outcome.metrics.tool_calls).toBe(1);
  });

  it("reports zeroes for a run with no tool use", async () => {
    const outcome = await consumeQuery(
      stream(assistant("msg_a", [{ type: "text" }]), result({ num_turns: 1 })),
    );

    expect(outcome.metrics).toEqual({ tool_calls: 0, response_groups: 1 });
  });

  it("keeps the result when the stream throws after emitting it", async () => {
    // error_max_turns exits the runtime non-zero, so the SDK yields the result
    // and then throws. Rethrowing would lose cost, session_id and subtype.
    const outcome = await consumeQuery(
      streamThenThrow(
        new Error("Claude Code returned an error result: Reached maximum number of turns (2)"),
        assistant("msg_a", [{ type: "tool_use", name: "Read" }]),
        result({ subtype: "error_max_turns", is_error: true, num_turns: 3 }),
      ),
    );

    expect(outcome.result.subtype).toBe("error_max_turns");
    expect(outcome.result.session_id).toBe("ses-1");
    expect(outcome.metrics.tool_calls).toBe(1);
  });

  it("rethrows when the stream fails before any result", async () => {
    await expect(
      consumeQuery(streamThenThrow(new Error("spawn failed"))),
    ).rejects.toThrow("spawn failed");
  });

  it("throws when the stream ends without a result", async () => {
    await expect(
      consumeQuery(stream(assistant("msg_a", [{ type: "text" }]))),
    ).rejects.toThrow("No result message received");
  });
});

// ── buildResultPayload with metrics ───────────────────────────────

describe("buildResultPayload metrics", () => {
  const base = {
    session_id: "ses-1",
    total_cost_usd: 0.02,
    duration_ms: 1000,
    num_turns: 6,
    is_error: false,
    subtype: "success",
    result: "done",
  };

  it("includes tool_calls and response_groups when supplied", () => {
    const payload = buildResultPayload(base, "run-1", {
      tool_calls: 5,
      response_groups: 3,
    });

    expect(payload.num_turns).toBe(6);
    expect(payload.tool_calls).toBe(5);
    expect(payload.response_groups).toBe(3);
  });

  it("omits them entirely when no metrics are supplied", () => {
    const payload = buildResultPayload(base, "run-1");

    expect(payload).not.toHaveProperty("tool_calls");
    expect(payload).not.toHaveProperty("response_groups");
  });
});

// ── mergeSystemPrompt ─────────────────────────────────────────────

describe("mergeSystemPrompt", () => {
  it("appends to an existing preset", () => {
    const merged = mergeSystemPrompt(
      { type: "preset", preset: "claude_code", append: "Be terse." },
      "Cite sources.",
    );

    expect(merged.systemPrompt).toEqual({
      type: "preset",
      preset: "claude_code",
      append: "Be terse.\nCite sources.",
    });
    expect(merged.appendFlag).toBeUndefined();
  });

  it("drops the blank line when the preset has no append yet", () => {
    const merged = mergeSystemPrompt(
      { type: "preset", preset: "claude_code" },
      "Cite sources.",
    );

    expect(merged.systemPrompt).toMatchObject({ append: "Cite sources." });
  });

  it("builds a preset when there is no base prompt", () => {
    const merged = mergeSystemPrompt(undefined, "Cite sources.");

    expect(merged.systemPrompt).toEqual({
      type: "preset",
      preset: "claude_code",
      append: "Cite sources.",
    });
  });

  it("leaves a string base intact and appends via the CLI flag", () => {
    const merged = mergeSystemPrompt("You are a linter.", "Cite sources.");

    expect(merged.systemPrompt).toBeUndefined();
    expect(merged.appendFlag).toBe("Cite sources.");
  });

  it("leaves a multi-part base intact rather than treating it as a preset", () => {
    // `typeof [] === "object"`, so without an Array.isArray guard this lands in
    // the preset branch and stops compiling. The cast keeps the test valid on
    // SDK lines whose Options type predates the string[] arm.
    const base = ["part one", "part two"] as unknown as Options["systemPrompt"];

    const merged = mergeSystemPrompt(base, "Cite sources.");

    expect(merged.systemPrompt).toBeUndefined();
    expect(merged.appendFlag).toBe("Cite sources.");
  });
});
