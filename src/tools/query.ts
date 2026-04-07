import { randomUUID } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v4";
import { resolve, isAbsolute } from "node:path";
import type { Options, TimelineConfig } from "../types.js";
import { isDescendantPath, formatErrorMessage } from "../lib.js";
import { appendTimeline } from "../timeline.js";
import {
  runQuery,
  buildResultPayload,
  recordTimeline,
} from "../query-helpers.js";

function formatResult(result: { session_id: string; total_cost_usd: number; duration_ms: number; num_turns: number; is_error: boolean; subtype: string; result?: string; errors?: string[] }, runId: string) {
  const payload = buildResultPayload(result, runId);
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
    isError: result.is_error,
  };
}

function formatError(error: unknown, runId: string) {
  return {
    content: [{
      type: "text" as const,
      text: JSON.stringify({ run_id: runId, error: formatErrorMessage(error) }, null, 2),
    }],
    isError: true,
  };
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
    const baseCwd = baseOptions.cwd || process.cwd();
    const effectiveCwd = cwd
      ? (isAbsolute(cwd) || isDescendantPath(cwd, baseCwd)) ? resolve(baseCwd, cwd) : baseCwd
      : baseCwd;
    try {
      const result = await runQuery(prompt, {
        cwd, model, tools, disallowedTools, additionalDirs, plugins, effort, permissionMode, maxTurns, maxBudgetUsd, systemPrompt,
      }, baseOptions);
      await recordTimeline(agentName, prompt, runId, t0, result, effectiveCwd, timelineConfig);
      return formatResult(result, runId);
    } catch (error) {
      await appendTimeline({
        run_id: runId, agent: agentName, session_id: "", t0,
        t1: new Date().toISOString(), cost_usd: 0, turns: 0,
        is_error: true, subtype: "error_thrown",
        prompt_excerpt: prompt.slice(0, 200), cwd: effectiveCwd,
      }, timelineConfig.dir);
      return formatError(error, runId);
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
      const baseCwd = baseOptions.cwd || process.cwd();
      const effectiveCwd = cwd
        ? (isAbsolute(cwd) || isDescendantPath(cwd, baseCwd)) ? resolve(baseCwd, cwd) : baseCwd
        : baseCwd;
      try {
        const result = await runQuery(prompt, {
          cwd, model, maxTurns, maxBudgetUsd, resumeSessionId: session_id,
        }, baseOptions);
        await recordTimeline(agentName, prompt, runId, t0, result, effectiveCwd, timelineConfig);
        return formatResult(result, runId);
      } catch (error) {
        await appendTimeline({
          run_id: runId, agent: agentName, session_id: session_id || "", t0,
          t1: new Date().toISOString(), cost_usd: 0, turns: 0,
          is_error: true, subtype: "error_thrown",
          prompt_excerpt: prompt.slice(0, 200), cwd: effectiveCwd,
        }, timelineConfig.dir);
        return formatError(error, runId);
      }
    });
  }
}
