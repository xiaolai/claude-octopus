import { randomUUID } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v4";
import { resolve } from "node:path";
import {
  query,
  type SDKResultMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { Options, InvocationOverrides, TimelineConfig } from "../types.js";
import {
  mergeTools,
  mergeDisallowedTools,
  narrowPermissionMode,
  buildResultPayload,
  formatErrorMessage,
} from "../lib.js";
import { appendTimeline, type TimelineEntry } from "../timeline.js";

async function runQuery(
  prompt: string,
  overrides: InvocationOverrides,
  baseOptions: Options
): Promise<SDKResultMessage> {
  const options: Options = { ...baseOptions };

  // Handle cwd override — accept any path, preserve agent's base access
  if (overrides.cwd) {
    const baseCwd = baseOptions.cwd || process.cwd();
    const resolvedCwd = resolve(baseCwd, overrides.cwd);
    if (resolvedCwd !== baseCwd) {
      options.cwd = resolvedCwd;
      // Agent's base dir becomes an additional dir so it keeps its knowledge
      const dirs = new Set(options.additionalDirectories || []);
      dirs.add(baseCwd);
      options.additionalDirectories = [...dirs];
    }
  }

  // Per-invocation additionalDirs — unions with server-level + auto-added dirs
  if (overrides.additionalDirs?.length) {
    const dirs = new Set(options.additionalDirectories || []);
    for (const dir of overrides.additionalDirs) {
      dirs.add(dir);
    }
    options.additionalDirectories = [...dirs];
  }

  // Per-invocation plugins — unions with server-level plugins
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

  // Permission mode can only tighten, never loosen
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

function formatResult(result: SDKResultMessage, runId: string) {
  const payload = buildResultPayload(
    result as Parameters<typeof buildResultPayload>[0],
    runId,
  );
  return {
    content: [
      { type: "text" as const, text: JSON.stringify(payload, null, 2) },
    ],
    isError: result.is_error,
  };
}

function formatError(error: unknown) {
  return {
    content: [
      { type: "text" as const, text: `Error: ${formatErrorMessage(error)}` },
    ],
    isError: true,
  };
}

/**
 * Build and append a timeline entry. Best-effort — never throws.
 */
async function recordTimeline(
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

export function registerQueryTools(
  server: McpServer,
  baseOptions: Options,
  toolName: string,
  toolDescription: string,
  agentName: string,
  timelineConfig: TimelineConfig,
) {
  const replyToolName = `${toolName}_reply`;

  server.registerTool(toolName, {
    description: toolDescription,
    inputSchema: z.object({
      prompt: z.string().describe("Task or question for Claude Code"),
      run_id: z.string().optional().describe("Workflow run ID — groups related agent calls into one timeline. Auto-generated if omitted; returned in every response for propagation."),
      cwd: z.string().optional().describe("Working directory (overrides CLAUDE_CWD)"),
      model: z.string().optional().describe('Model override (e.g. "sonnet", "opus", "haiku")'),
      tools: z.array(z.string()).optional().describe("Restrict available tools to this list (intersects with server-level restriction)"),
      disallowedTools: z.array(z.string()).optional().describe("Additional tools to block (unions with server-level blacklist)"),
      additionalDirs: z.array(z.string()).optional().describe("Extra directories the agent can access for this invocation"),
      plugins: z.array(z.string()).optional().describe("Additional plugin paths to load for this invocation (unions with server-level plugins)"),
      effort: z.enum(["low", "medium", "high", "max"]).optional().describe("Thinking effort override"),
      permissionMode: z.enum(["default", "acceptEdits", "plan"]).optional().describe("Permission mode override (can only tighten, never loosen)"),
      maxTurns: z.number().int().positive().optional().describe("Max conversation turns"),
      maxBudgetUsd: z.number().positive().optional().describe("Max spend in USD"),
      systemPrompt: z.string().optional().describe("Additional system prompt (appended to server default)"),
    }),
  }, async ({ prompt, run_id, cwd, model, tools, disallowedTools, additionalDirs, plugins, effort, permissionMode, maxTurns, maxBudgetUsd, systemPrompt }) => {
    const runId = run_id || randomUUID();
    const t0 = new Date().toISOString();
    try {
      const result = await runQuery(prompt, {
        cwd, model, tools, disallowedTools, additionalDirs, plugins, effort, permissionMode, maxTurns, maxBudgetUsd, systemPrompt,
      }, baseOptions);
      await recordTimeline(agentName, prompt, runId, t0, result, baseOptions.cwd || process.cwd(), timelineConfig);
      return formatResult(result, runId);
    } catch (error) {
      return formatError(error);
    }
  });

  if (baseOptions.persistSession !== false) {
    server.registerTool(replyToolName, {
      description: [
        `Continue a previous ${toolName} conversation by session ID.`,
        "Use this for follow-up questions, iterative refinement,",
        "or multi-step workflows that build on prior context.",
      ].join(" "),
      inputSchema: z.object({
        session_id: z.string().describe(`Session ID from a prior ${toolName} response`),
        prompt: z.string().describe("Follow-up instruction or question"),
        run_id: z.string().optional().describe("Workflow run ID — pass the same run_id from the original call to keep entries grouped."),
        cwd: z.string().optional().describe("Working directory override"),
        model: z.string().optional().describe("Model override"),
        maxTurns: z.number().int().positive().optional().describe("Max conversation turns"),
        maxBudgetUsd: z.number().positive().optional().describe("Max spend in USD"),
      }),
    }, async ({ session_id, prompt, run_id, cwd, model, maxTurns, maxBudgetUsd }) => {
      const runId = run_id || randomUUID();
      const t0 = new Date().toISOString();
      try {
        const result = await runQuery(prompt, {
          cwd, model, maxTurns, maxBudgetUsd, resumeSessionId: session_id,
        }, baseOptions);
        await recordTimeline(agentName, prompt, runId, t0, result, baseOptions.cwd || process.cwd(), timelineConfig);
        return formatResult(result, runId);
      } catch (error) {
        return formatError(error);
      }
    });
  }
}
