import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v4";
import { resolve } from "node:path";
import {
  query,
  type SDKResultMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { Options, InvocationOverrides } from "../types.js";
import {
  isDescendantPath,
  mergeAllowedTools,
  mergeDisallowedTools,
  buildResultPayload,
  formatErrorMessage,
} from "../lib.js";

async function runQuery(
  prompt: string,
  overrides: InvocationOverrides,
  baseOptions: Options
): Promise<SDKResultMessage> {
  const options: Options = { ...baseOptions };

  if (overrides.cwd) {
    const baseCwd = baseOptions.cwd || process.cwd();
    if (isDescendantPath(overrides.cwd, baseCwd)) {
      options.cwd = resolve(baseCwd, overrides.cwd);
    }
  }
  if (overrides.model) options.model = overrides.model;
  if (overrides.maxTurns !== undefined && overrides.maxTurns > 0) {
    options.maxTurns = overrides.maxTurns;
  }
  if (overrides.maxBudgetUsd != null)
    options.maxBudgetUsd = overrides.maxBudgetUsd;
  if (overrides.resumeSessionId) options.resume = overrides.resumeSessionId;

  if (overrides.allowedTools?.length) {
    options.allowedTools = mergeAllowedTools(
      baseOptions.allowedTools,
      overrides.allowedTools
    );
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

function formatResult(result: SDKResultMessage) {
  const payload = buildResultPayload(
    result as Parameters<typeof buildResultPayload>[0]
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

export function registerQueryTools(
  server: McpServer,
  baseOptions: Options,
  toolName: string,
  toolDescription: string
) {
  const replyToolName = `${toolName}_reply`;

  server.registerTool(toolName, {
    description: toolDescription,
    inputSchema: z.object({
      prompt: z.string().describe("Task or question for Claude Code"),
      cwd: z.string().optional().describe("Working directory (overrides CLAUDE_CWD)"),
      model: z.string().optional().describe('Model override (e.g. "sonnet", "opus", "haiku")'),
      allowedTools: z.array(z.string()).optional().describe("Tool whitelist override"),
      disallowedTools: z.array(z.string()).optional().describe("Tool blacklist override"),
      maxTurns: z.number().int().positive().optional().describe("Max conversation turns"),
      maxBudgetUsd: z.number().optional().describe("Max spend in USD"),
      systemPrompt: z.string().optional().describe("Additional system prompt (appended to server default)"),
    }),
  }, async ({ prompt, cwd, model, allowedTools, disallowedTools, maxTurns, maxBudgetUsd, systemPrompt }) => {
    try {
      const result = await runQuery(prompt, {
        cwd, model, allowedTools, disallowedTools, maxTurns, maxBudgetUsd, systemPrompt,
      }, baseOptions);
      return formatResult(result);
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
        cwd: z.string().optional().describe("Working directory override"),
        model: z.string().optional().describe("Model override"),
        maxTurns: z.number().int().positive().optional().describe("Max conversation turns"),
        maxBudgetUsd: z.number().optional().describe("Max spend in USD"),
      }),
    }, async ({ session_id, prompt, cwd, model, maxTurns, maxBudgetUsd }) => {
      try {
        const result = await runQuery(prompt, {
          cwd, model, maxTurns, maxBudgetUsd, resumeSessionId: session_id,
        }, baseOptions);
        return formatResult(result);
      } catch (error) {
        return formatError(error);
      }
    });
  }
}
