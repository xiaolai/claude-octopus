/**
 * Helpers for the query tool — extracted from query.ts and lib.ts.
 *
 * Contains runQuery (override merging + SDK call), result formatting,
 * timeline recording, and the ResultPayload type.
 */

import { resolve, isAbsolute } from "node:path";
import {
  query,
  type SDKMessage,
  type SDKResultMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { Options, InvocationOverrides, TimelineConfig } from "./types.js";
import {
  mergeTools,
  mergeDisallowedTools,
  narrowPermissionMode,
  isDescendantPath,
} from "./lib.js";
import { appendTimeline, type TimelineEntry } from "./timeline.js";

// ── Loop metrics ─────────────────────────────────────────────────

/**
 * Counts derived from the message stream, independent of SDK `num_turns`.
 *
 * `num_turns` is not an agent-loop round-trip count: across completed runs it
 * comes back as `tool_use` blocks + 1, so parallel tool calls inflate it
 * relative to the number of assistant responses. These two counters are what
 * the stream actually shows, so they stay meaningful under parallel tool use.
 *
 * Both cover the main agent loop only — messages carrying a
 * `parent_tool_use_id` belong to a sub-agent's own loop and are excluded.
 */
export interface QueryMetrics {
  /** `tool_use` blocks emitted across the run. */
  tool_calls: number;
  /** Distinct assistant message IDs — one per API round trip. */
  response_groups: number;
}

export interface QueryOutcome {
  result: SDKResultMessage;
  metrics: QueryMetrics;
}

// ── Result payload ───────────────────────────────────────────────

export interface ResultPayload {
  run_id: string;
  session_id: string;
  cost_usd: number;
  duration_ms: number;
  /** Raw SDK `num_turns` — see {@link QueryMetrics} for why it can look high. */
  num_turns: number;
  tool_calls?: number;
  response_groups?: number;
  is_error: boolean;
  result?: string;
  errors?: string[];
}

export function buildResultPayload(
  result: {
    session_id: string;
    total_cost_usd: number;
    duration_ms: number;
    num_turns: number;
    is_error: boolean;
    subtype: string;
    result?: string;
    errors?: string[];
  },
  runId: string,
  metrics?: QueryMetrics,
): ResultPayload {
  const payload: ResultPayload = {
    run_id: runId,
    session_id: result.session_id,
    cost_usd: result.total_cost_usd,
    duration_ms: result.duration_ms,
    num_turns: result.num_turns,
    is_error: result.is_error,
  };
  if (metrics) {
    payload.tool_calls = metrics.tool_calls;
    payload.response_groups = metrics.response_groups;
  }
  if (result.subtype === "success") {
    payload.result = result.result;
  } else {
    payload.errors = result.errors;
  }
  return payload;
}

// ── System prompt merging ────────────────────────────────────────

export interface SystemPromptMerge {
  /** Replacement value, when the base can be rewritten safely. */
  systemPrompt?: Options["systemPrompt"];
  /** Text for `--append-system-prompt`, when the base must stay intact. */
  appendFlag?: string;
}

/**
 * Fold an invocation's extra system prompt into the server-level one.
 *
 * The SDK types `systemPrompt` as `string | string[] | { type: 'preset' }`,
 * and the `string[]` arm arrived mid-0.2.x. `typeof [] === "object"`, so the
 * array has to be narrowed out before the preset check or it lands in the
 * wrong branch — which is what broke the SDK auto-bump build.
 */
export function mergeSystemPrompt(
  base: Options["systemPrompt"],
  override: string,
): SystemPromptMerge {
  if (!Array.isArray(base) && typeof base === "object" && base?.type === "preset") {
    return {
      systemPrompt: {
        type: "preset",
        preset: "claude_code",
        append: [base.append || "", override].filter(Boolean).join("\n"),
      },
    };
  }
  if (base !== undefined) {
    // A plain string or a multi-part prompt: leave the base untouched and let
    // the CLI flag append to it, rather than guessing how to splice it.
    return { appendFlag: override };
  }
  return {
    systemPrompt: { type: "preset", preset: "claude_code", append: override },
  };
}

// ── Query execution ──────────────────────────────────────────────

/**
 * Drain a query stream: capture the result message and count loop metrics.
 *
 * The stream can throw *after* yielding the result — the runtime exits
 * non-zero on `error_max_turns`, and the SDK surfaces that as a stream error.
 * Rethrowing there would discard a result that carries the real subtype, the
 * session ID and the accrued cost, so a result already in hand wins.
 */
export async function consumeQuery(
  stream: AsyncIterable<SDKMessage>,
): Promise<QueryOutcome> {
  const responseIds = new Set<string>();
  let toolCalls = 0;
  let result: SDKResultMessage | undefined;

  try {
    for await (const message of stream) {
      if (message.type === "assistant" && message.parent_tool_use_id == null) {
        const api = message.message;
        if (api?.id) responseIds.add(api.id);
        for (const block of api?.content ?? []) {
          if (block.type === "tool_use") toolCalls++;
        }
      } else if (message.type === "result") {
        result = message;
      }
    }
  } catch (err) {
    if (!result) throw err;
  }

  if (!result) {
    throw new Error("No result message received from Claude Code");
  }

  return {
    result,
    metrics: { tool_calls: toolCalls, response_groups: responseIds.size },
  };
}

export async function runQuery(
  prompt: string,
  overrides: InvocationOverrides,
  baseOptions: Options
): Promise<QueryOutcome> {
  const options: Options = { ...baseOptions };

  // Handle cwd override — validate relative paths, allow absolute paths
  if (overrides.cwd) {
    const baseCwd = baseOptions.cwd || process.cwd();
    const resolvedCwd = resolve(baseCwd, overrides.cwd);
    if (!isAbsolute(overrides.cwd) && !isDescendantPath(overrides.cwd, baseCwd)) {
      console.error(`claude-octopus: cwd override "${overrides.cwd}" escapes base "${baseCwd}", ignoring`);
    } else if (resolvedCwd !== baseCwd) {
      options.cwd = resolvedCwd;
      const dirs = new Set(options.additionalDirectories || []);
      dirs.add(baseCwd);
      options.additionalDirectories = [...dirs];
    }
  }

  if (overrides.additionalDirs?.length) {
    const dirs = new Set(options.additionalDirectories || []);
    for (const dir of overrides.additionalDirs) {
      dirs.add(dir);
    }
    options.additionalDirectories = [...dirs];
  }

  if (overrides.plugins?.length) {
    const base = baseOptions.plugins || [];
    const overridePaths = new Set(base.map((p) => p.path));
    const merged = [...base];
    for (const path of overrides.plugins) {
      if (!overridePaths.has(path)) {
        merged.push({ type: "local" as const, path });
        overridePaths.add(path);
      }
    }
    options.plugins = merged;
  }

  if (overrides.model) options.model = overrides.model;
  if (overrides.effort) options.effort = overrides.effort as Options["effort"];

  if (overrides.permissionMode) {
    const base = (baseOptions.permissionMode as string) || "default";
    const narrowed = narrowPermissionMode(base, overrides.permissionMode);
    options.permissionMode = narrowed as Options["permissionMode"];
    options.allowDangerouslySkipPermissions = narrowed === "bypassPermissions";
  }

  if (overrides.maxTurns !== undefined && overrides.maxTurns > 0) {
    options.maxTurns = overrides.maxTurns;
  }
  if (overrides.maxBudgetUsd != null)
    options.maxBudgetUsd = overrides.maxBudgetUsd;
  if (overrides.resumeSessionId) options.resume = overrides.resumeSessionId;

  if (overrides.tools?.length) {
    const baseTools = Array.isArray(baseOptions.tools) ? baseOptions.tools : undefined;
    options.tools = mergeTools(baseTools, overrides.tools);
  }
  if (overrides.disallowedTools?.length) {
    options.disallowedTools = mergeDisallowedTools(
      baseOptions.disallowedTools,
      overrides.disallowedTools
    );
  }

  if (overrides.systemPrompt) {
    const merged = mergeSystemPrompt(baseOptions.systemPrompt, overrides.systemPrompt);
    if (merged.systemPrompt !== undefined) {
      options.systemPrompt = merged.systemPrompt;
    }
    if (merged.appendFlag !== undefined) {
      options.extraArgs = {
        ...options.extraArgs,
        "append-system-prompt": merged.appendFlag,
      };
    }
  }

  return consumeQuery(query({ prompt, options }));
}

// ── Timeline recording ───────────────────────────────────────────

export async function recordTimeline(
  agentName: string,
  prompt: string,
  runId: string,
  t0: string,
  outcome: QueryOutcome,
  cwd: string,
  timelineConfig: TimelineConfig,
): Promise<void> {
  const { result, metrics } = outcome;
  const sdkResult = result as SDKResultMessage & {
    total_cost_usd: number;
    num_turns: number;
    is_error: boolean;
    subtype: string;
  };
  const entry: TimelineEntry = {
    run_id: runId,
    agent: agentName,
    session_id: result.session_id,
    t0,
    t1: new Date().toISOString(),
    cost_usd: sdkResult.total_cost_usd,
    turns: sdkResult.num_turns,
    tool_calls: metrics.tool_calls,
    response_groups: metrics.response_groups,
    is_error: sdkResult.is_error,
    subtype: sdkResult.subtype,
    prompt_excerpt: prompt.slice(0, 200),
    cwd,
  };
  await appendTimeline(entry, timelineConfig.dir);
}
