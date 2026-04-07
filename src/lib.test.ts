import { describe, it, expect } from "vitest";
import {
  envStr,
  envList,
  envNum,
  envBool,
  envJson,
  sanitizeToolName,
  MAX_TOOL_NAME_LEN,
  isDescendantPath,
  mergeTools,
  mergeDisallowedTools,
  validatePermissionMode,
  narrowPermissionMode,
  VALID_PERM_MODES,
  deriveServerName,
  deriveToolName,
  serializeArrayEnv,
  formatErrorMessage,
} from "./lib.js";
import { buildResultPayload } from "./query-helpers.js";

// ── envStr ─────────────────────────────────────────────────────────

describe("envStr", () => {
  it("returns value when set", () => {
    expect(envStr("FOO", { FOO: "bar" })).toBe("bar");
  });

  it("returns undefined when missing", () => {
    expect(envStr("FOO", {})).toBeUndefined();
  });

  it("returns undefined for empty string", () => {
    expect(envStr("FOO", { FOO: "" })).toBeUndefined();
  });
});

// ── envList ────────────────────────────────────────────────────────

describe("envList", () => {
  it("splits comma-separated values", () => {
    expect(envList("X", { X: "a,b,c" })).toEqual(["a", "b", "c"]);
  });

  it("trims whitespace", () => {
    expect(envList("X", { X: " a , b , c " })).toEqual(["a", "b", "c"]);
  });

  it("filters empty segments", () => {
    expect(envList("X", { X: "a,,b," })).toEqual(["a", "b"]);
  });

  it("returns undefined when missing", () => {
    expect(envList("X", {})).toBeUndefined();
  });

  it("parses JSON array", () => {
    expect(envList("X", { X: '["a","b","c"]' })).toEqual(["a", "b", "c"]);
  });

  it("handles JSON array with commas in values", () => {
    expect(envList("X", { X: '["/path,with,commas","/normal"]' })).toEqual([
      "/path,with,commas",
      "/normal",
    ]);
  });

  it("falls back to comma-split on invalid JSON starting with [", () => {
    expect(envList("X", { X: "[not-json" })).toEqual(["[not-json"]);
  });
});

// ── envNum ─────────────────────────────────────────────────────────

describe("envNum", () => {
  it("parses integers", () => {
    expect(envNum("X", { X: "42" })).toBe(42);
  });

  it("parses floats", () => {
    expect(envNum("X", { X: "1.5" })).toBe(1.5);
  });

  it("returns undefined for NaN", () => {
    expect(envNum("X", { X: "abc" })).toBeUndefined();
  });

  it("returns undefined when missing", () => {
    expect(envNum("X", {})).toBeUndefined();
  });

  it("parses zero", () => {
    expect(envNum("X", { X: "0" })).toBe(0);
  });

  it("parses negative numbers", () => {
    expect(envNum("X", { X: "-5" })).toBe(-5);
  });
});

// ── envBool ────────────────────────────────────────────────────────

describe("envBool", () => {
  it('returns true for "true"', () => {
    expect(envBool("X", false, { X: "true" })).toBe(true);
  });

  it('returns true for "1"', () => {
    expect(envBool("X", false, { X: "1" })).toBe(true);
  });

  it("returns false for other values", () => {
    expect(envBool("X", true, { X: "false" })).toBe(false);
    expect(envBool("X", true, { X: "0" })).toBe(false);
    expect(envBool("X", true, { X: "no" })).toBe(false);
  });

  it("returns fallback when missing", () => {
    expect(envBool("X", true, {})).toBe(true);
    expect(envBool("X", false, {})).toBe(false);
  });
});

// ── envJson ────────────────────────────────────────────────────────

describe("envJson", () => {
  it("parses valid JSON", () => {
    expect(envJson("X", { X: '{"a":1}' })).toEqual({ a: 1 });
  });

  it("returns undefined for invalid JSON", () => {
    expect(envJson("X", { X: "{bad" })).toBeUndefined();
  });

  it("returns undefined when missing", () => {
    expect(envJson("X", {})).toBeUndefined();
  });
});

// ── sanitizeToolName ───────────────────────────────────────────────

describe("sanitizeToolName", () => {
  it("passes through valid names", () => {
    expect(sanitizeToolName("code_reviewer")).toBe("code_reviewer");
  });

  it("replaces invalid characters with underscore", () => {
    expect(sanitizeToolName("my-tool.name")).toBe("my_tool_name");
  });

  it("truncates to MAX_TOOL_NAME_LEN", () => {
    const long = "a".repeat(100);
    expect(sanitizeToolName(long).length).toBe(MAX_TOOL_NAME_LEN);
  });

  it("falls back to claude_code when sanitization empties the string", () => {
    expect(sanitizeToolName("---")).toBe("___");
    expect(sanitizeToolName("")).toBe("claude_code");
  });

  it("reserves space for _transcript suffix (longest)", () => {
    expect(MAX_TOOL_NAME_LEN).toBe(53);
    const name = sanitizeToolName("a".repeat(53));
    expect(`${name}_transcript`.length).toBeLessThanOrEqual(64);
    expect(`${name}_timeline`.length).toBeLessThanOrEqual(64);
    expect(`${name}_reply`.length).toBeLessThanOrEqual(64);
  });
});

// ── isDescendantPath ───────────────────────────────────────────────

describe("isDescendantPath", () => {
  it("allows exact base path", () => {
    expect(isDescendantPath("/srv/app", "/srv/app")).toBe(true);
  });

  it("allows subdirectory", () => {
    expect(isDescendantPath("subdir", "/srv/app")).toBe(true);
  });

  it("allows nested subdirectory", () => {
    expect(isDescendantPath("a/b/c", "/srv/app")).toBe(true);
  });

  it("rejects parent traversal", () => {
    expect(isDescendantPath("../escape", "/srv/app")).toBe(false);
  });

  it("rejects prefix attack (/srv/app-escape)", () => {
    expect(isDescendantPath("/srv/app-escape", "/srv/app")).toBe(false);
  });

  it("rejects absolute path outside base", () => {
    expect(isDescendantPath("/etc/passwd", "/srv/app")).toBe(false);
  });

  it("allows absolute path inside base", () => {
    expect(isDescendantPath("/srv/app/sub", "/srv/app")).toBe(true);
  });

  it("handles base path with trailing slash", () => {
    expect(isDescendantPath("subdir", "/srv/app/")).toBe(true);
    expect(isDescendantPath("/srv/app-escape", "/srv/app/")).toBe(false);
  });
});

// ── mergeTools ───────────────────────────────────────────────────

describe("mergeTools", () => {
  it("intersects when server has a list", () => {
    expect(
      mergeTools(["Read", "Grep", "Glob"], ["Read", "Write", "Glob"])
    ).toEqual(["Read", "Glob"]);
  });

  it("passes through when server has no list", () => {
    expect(
      mergeTools(undefined, ["Read", "Write"])
    ).toEqual(["Read", "Write"]);
  });

  it("returns empty when no overlap", () => {
    expect(
      mergeTools(["Read"], ["Write"])
    ).toEqual([]);
  });
});

// ── mergeDisallowedTools ───────────────────────────────────────────

describe("mergeDisallowedTools", () => {
  it("unions server and call lists", () => {
    const result = mergeDisallowedTools(["WebFetch"], ["WebSearch"]);
    expect(result).toContain("WebFetch");
    expect(result).toContain("WebSearch");
    expect(result).toHaveLength(2);
  });

  it("deduplicates", () => {
    const result = mergeDisallowedTools(["WebFetch"], ["WebFetch", "WebSearch"]);
    expect(result).toHaveLength(2);
  });

  it("handles undefined server list", () => {
    expect(mergeDisallowedTools(undefined, ["WebFetch"])).toEqual(["WebFetch"]);
  });
});

// ── validatePermissionMode ─────────────────────────────────────────

describe("validatePermissionMode", () => {
  it("passes valid modes through", () => {
    for (const mode of VALID_PERM_MODES) {
      expect(validatePermissionMode(mode)).toBe(mode);
    }
  });

  it("falls back to default for invalid modes", () => {
    expect(validatePermissionMode("allowEdits")).toBe("default");
    expect(validatePermissionMode("garbage")).toBe("default");
    expect(validatePermissionMode("")).toBe("default");
    expect(validatePermissionMode("auto")).toBe("default");
  });
});

// ── narrowPermissionMode ──────────────────────────────────────────

describe("narrowPermissionMode", () => {
  it("allows tightening from bypassPermissions to stricter modes", () => {
    expect(narrowPermissionMode("bypassPermissions", "acceptEdits")).toBe("acceptEdits");
    expect(narrowPermissionMode("bypassPermissions", "default")).toBe("default");
    expect(narrowPermissionMode("bypassPermissions", "plan")).toBe("plan");
    expect(narrowPermissionMode("bypassPermissions", "dontAsk")).toBe("dontAsk");
  });

  it("allows tightening from acceptEdits to stricter modes", () => {
    expect(narrowPermissionMode("acceptEdits", "default")).toBe("default");
    expect(narrowPermissionMode("acceptEdits", "plan")).toBe("plan");
    expect(narrowPermissionMode("acceptEdits", "dontAsk")).toBe("dontAsk");
  });

  it("plan is the strictest — rejects all loosening", () => {
    expect(narrowPermissionMode("plan", "bypassPermissions")).toBe("plan");
    expect(narrowPermissionMode("plan", "acceptEdits")).toBe("plan");
    expect(narrowPermissionMode("plan", "default")).toBe("plan");
    expect(narrowPermissionMode("plan", "dontAsk")).toBe("plan");
    expect(narrowPermissionMode("plan", "plan")).toBe("plan");
  });

  it("dontAsk allows tightening to plan", () => {
    expect(narrowPermissionMode("dontAsk", "plan")).toBe("plan");
    expect(narrowPermissionMode("dontAsk", "bypassPermissions")).toBe("dontAsk");
    expect(narrowPermissionMode("dontAsk", "default")).toBe("dontAsk");
  });

  it("rejects loosening — returns base unchanged", () => {
    expect(narrowPermissionMode("default", "bypassPermissions")).toBe("default");
    expect(narrowPermissionMode("default", "acceptEdits")).toBe("default");
    expect(narrowPermissionMode("plan", "bypassPermissions")).toBe("plan");
    expect(narrowPermissionMode("plan", "acceptEdits")).toBe("plan");
    expect(narrowPermissionMode("plan", "default")).toBe("plan");
  });

  it("same mode returns same mode", () => {
    expect(narrowPermissionMode("default", "default")).toBe("default");
    expect(narrowPermissionMode("plan", "plan")).toBe("plan");
    expect(narrowPermissionMode("bypassPermissions", "bypassPermissions")).toBe("bypassPermissions");
  });

  it("invalid override returns base unchanged", () => {
    expect(narrowPermissionMode("default", "garbage")).toBe("default");
    expect(narrowPermissionMode("bypassPermissions", "")).toBe("bypassPermissions");
    expect(narrowPermissionMode("default", "auto")).toBe("default");
  });
});

// ── deriveServerName ───────────────────────────────────────────────

describe("deriveServerName", () => {
  it("slugifies ASCII description", () => {
    expect(deriveServerName("a strict code reviewer")).toBe(
      "a-strict-code-reviewer"
    );
  });

  it("truncates to 30 chars", () => {
    const long = "a very long description that exceeds the thirty character limit";
    expect(deriveServerName(long).length).toBeLessThanOrEqual(30);
  });

  it("falls back for non-ASCII-only description", () => {
    const name = deriveServerName("严谨代码审计员");
    expect(name).toMatch(/^agent-\d+$/);
  });

  it("strips special characters", () => {
    expect(deriveServerName("code!!reviewer##v2")).toBe("code-reviewer-v2");
  });
});

// ── deriveToolName ─────────────────────────────────────────────────

describe("deriveToolName", () => {
  it("converts hyphens to underscores", () => {
    expect(deriveToolName("code-reviewer")).toBe("code_reviewer");
  });

  it("strips leading/trailing underscores", () => {
    expect(deriveToolName("-code-")).toBe("code");
  });

  it("falls back to agent for empty result", () => {
    expect(deriveToolName("---")).toBe("agent");
  });

  it("respects MAX_TOOL_NAME_LEN", () => {
    expect(deriveToolName("a".repeat(100)).length).toBeLessThanOrEqual(
      MAX_TOOL_NAME_LEN
    );
  });
});

// ── serializeArrayEnv ──────────────────────────────────────────────

describe("serializeArrayEnv", () => {
  it("comma-joins simple values", () => {
    expect(serializeArrayEnv(["a", "b", "c"])).toBe("a,b,c");
  });

  it("uses JSON when values contain commas", () => {
    const result = serializeArrayEnv(["/path,with,commas", "/normal"]);
    expect(result).toBe('["/path,with,commas","/normal"]');
    expect(JSON.parse(result)).toEqual(["/path,with,commas", "/normal"]);
  });
});

// ── buildResultPayload ─────────────────────────────────────────────

describe("buildResultPayload", () => {
  it("builds success payload with run_id", () => {
    const payload = buildResultPayload({
      session_id: "abc-123",
      total_cost_usd: 0.05,
      duration_ms: 1234,
      num_turns: 3,
      is_error: false,
      subtype: "success",
      result: "Hello world",
    }, "run-001");
    expect(payload).toEqual({
      run_id: "run-001",
      session_id: "abc-123",
      cost_usd: 0.05,
      duration_ms: 1234,
      num_turns: 3,
      is_error: false,
      result: "Hello world",
    });
  });

  it("builds error payload with run_id", () => {
    const payload = buildResultPayload({
      session_id: "abc-123",
      total_cost_usd: 0,
      duration_ms: 500,
      num_turns: 1,
      is_error: true,
      subtype: "error_during_execution",
      errors: ["Something went wrong"],
    }, "run-002");
    expect(payload.run_id).toBe("run-002");
    expect(payload.is_error).toBe(true);
    expect(payload.errors).toEqual(["Something went wrong"]);
    expect(payload.result).toBeUndefined();
  });
});

// ── formatErrorMessage ─────────────────────────────────────────────

describe("formatErrorMessage", () => {
  it("extracts Error message", () => {
    expect(formatErrorMessage(new Error("boom"))).toBe("boom");
  });

  it("stringifies non-Error values", () => {
    expect(formatErrorMessage("oops")).toBe("oops");
    expect(formatErrorMessage(42)).toBe("42");
    expect(formatErrorMessage(null)).toBe("null");
  });
});
