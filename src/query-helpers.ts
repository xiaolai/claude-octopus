/**
 * Helpers for the query tool — extracted from query.ts and lib.ts.
 *
 * Contains runQuery (override merging + SDK call), result formatting,
 * timeline recording, and the ResultPayload type.
 */

import { resolve, isAbsolute } from "node:path";
import {
  query,
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

// ── Result payload ───────────────────────────────────────────────

export interface ResultPayload {
  run_id: string;
  session_id: string;
  cost_usd: number;
  duration_ms: number;
  num_turns: number;
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
): ResultPayload {
  const payload: ResultPayload = {
    run_id: runId,
    session_id: result.session_id,
    cost_usd: result.total_cost_usd,
    duration_ms: result.duration_ms,
    num_turns: result.num_turns,
    is_error: result.is_error,
  };
  if (result.subtype === "success") {
    payload.result = result.result;
  } else {
    payload.errors = result.errors;
  }
  return payload;
}

// ── Query execution ──────────────────────────────────────────────

export async function runQuery(
  prompt: string,
  overrides: InvocationOverrides,
  baseOptions: Options
): Promise<SDKResultMessage> {
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
    if (
      typeof baseOptions.systemPrompt === "object" &&
      baseOptions.systemPrompt?.type === "preset"
    ) {
      const baseAppend = baseOptions.systemPrompt.append || "";
      options.systemPrompt = {
        type: "preset",
        preset: "claude_code",
        append: [baseAppend, overrides.systemPrompt].filter(Boolean).join("\n"),
      };
    } else if (typeof baseOptions.systemPrompt === "string") {
      options.systemPrompt = baseOptions.systemPrompt;
      options.extraArgs = {
        ...options.extraArgs,
        "append-system-prompt": overrides.systemPrompt,
      };
    } else {
      options.systemPrompt = {
        type: "preset",
        preset: "claude_code",
        append: overrides.systemPrompt,
      };
    }
  }

  const q = query({ prompt, options });
  let result: SDKResultMessage | undefined;

  for await (const message of q) {
    if (message.type === "result") {
      result = message as SDKResultMessage;
    }
  }

  if (!result) {
    throw new Error("No result message received from Claude Code");
  }

  return result;
}

// ── Timeline recording ───────────────────────────────────────────

export async function recordTimeline(
  agentName: string,
  prompt: string,
  runId: string,
  t0: string,
  result: SDKResultMessage,
  cwd: string,
  timelineConfig: TimelineConfig,
): Promise<void> {
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
    is_error: sdkResult.is_error,
    subtype: sdkResult.subtype,
    prompt_excerpt: prompt.slice(0, 200),
    cwd,
  };
  await appendTimeline(entry, timelineConfig.dir);
}
