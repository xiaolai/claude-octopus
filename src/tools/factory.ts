import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v4";
import { OPTION_CATALOG } from "../constants.js";
import {
  sanitizeToolName,
  deriveServerName,
  deriveToolName,
  serializeArrayEnv,
} from "../lib.js";

function buildEnvFromParams(
  params: Record<string, unknown>
): Record<string, string> {
  const env: Record<string, string> = {};

  for (const opt of OPTION_CATALOG) {
    const val = params[opt.key];
    if (val === undefined || val === null) continue;

    if (Array.isArray(val)) {
      if (val.length > 0) env[opt.envVar] = serializeArrayEnv(val);
    } else if (typeof val === "object") {
      env[opt.envVar] = JSON.stringify(val);
    } else if (typeof val === "boolean") {
      env[opt.envVar] = String(val);
    } else if (val !== "") {
      env[opt.envVar] = String(val);
    }
  }

  return env;
}

export function registerFactoryTool(
  server: McpServer,
) {
  server.registerTool("create_claude_code_mcp", {
    description: [
      "Generate a .mcp.json config entry for a new Claude Octopus MCP server instance.",
      "WHEN TO USE: user says 'octopus agent', 'octopus mcp',",
      "'new octopus', 'add octopus', 'create octopus',",
      "'octopus instance', 'octopus config', 'octopus server',",
      "or any phrase combining 'octopus' with agent/mcp/new/add/create/config/server/setup.",
      "This is a wizard: only a description is required.",
      "Returns a ready-to-use .mcp.json config and lists all customization options.",
      "Call again with more parameters to refine.",
    ].join(" "),
    inputSchema: z.object({
      description: z.string().describe(
        "What this agent should do, in plain language. Example: 'a strict code reviewer that only reads files'"
      ),
      name: z.string().optional().describe("Server name / alias (derived from description if omitted)"),
      toolName: z.string().optional().describe("Custom tool name prefix"),
      model: z.string().optional(),
      systemPrompt: z.string().optional(),
      appendPrompt: z.string().optional(),
      allowedTools: z.array(z.string()).optional(),
      disallowedTools: z.array(z.string()).optional(),
      cwd: z.string().optional(),
      additionalDirs: z.array(z.string()).optional(),
      plugins: z.array(z.string()).optional(),
      maxTurns: z.number().optional(),
      maxBudgetUsd: z.number().optional(),
      effort: z.enum(["low", "medium", "high", "max"]).optional(),
      persistSession: z.boolean().optional(),
      permissionMode: z.enum(["bypassPermissions", "acceptEdits", "default", "plan"]).optional(),
      settingSources: z.array(z.string()).optional(),
      mcpServers: z.record(z.string(), z.unknown()).optional(),
      betas: z.array(z.string()).optional(),
      apiKey: z.string().optional().describe("Anthropic API key for this agent (leave unset to inherit)"),
      oauthToken: z.string().optional().describe("Claude Code OAuth token for this agent (leave unset to inherit)"),
    }),
  }, async (params) => {
    const { description, name: nameParam, toolName: toolNameParam } = params;

    const name = nameParam || deriveServerName(description);
    const derivedToolName = toolNameParam
      ? sanitizeToolName(toolNameParam)
      : deriveToolName(name);

    const env: Record<string, string> = {
      CLAUDE_TOOL_NAME: derivedToolName,
      CLAUDE_SERVER_NAME: name,
      CLAUDE_DESCRIPTION: description,
    };

    const optionEnv = buildEnvFromParams(params);
    Object.assign(env, optionEnv);

    const configured = Object.keys(optionEnv);
    const notConfigured = OPTION_CATALOG.filter(
      (o) => !configured.includes(o.envVar)
    );

    const SENSITIVE_KEYS = new Set(["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"]);

    // Redact secrets in rendered output, keep real values in config
    const displayEnv: Record<string, string> = {};
    for (const [k, v] of Object.entries(env)) {
      displayEnv[k] = SENSITIVE_KEYS.has(k) ? "<REDACTED>" : v;
    }

    const mcpEntry = {
      [name]: {
        command: "npx",
        args: ["claude-octopus"],
        env: displayEnv,
      },
    };

    const sections: string[] = [];

    sections.push(
      "## Generated config",
      "",
      "Add to `mcpServers` in your `.mcp.json`:",
      "",
      "```json",
      JSON.stringify(mcpEntry, null, 2),
      "```"
    );

    sections.push("", "## What's configured");
    sections.push("", `| Setting | Value |`, `|---|---|`);
    sections.push(`| Name | \`${name}\` |`);
    sections.push(`| Tool names | \`${derivedToolName}\`, \`${derivedToolName}_reply\` |`);
    for (const key of configured) {
      const opt = OPTION_CATALOG.find((o) => o.envVar === key);
      if (opt) {
        const val = SENSITIVE_KEYS.has(key) ? "<REDACTED>" : env[key];
        sections.push(`| ${opt.label} | \`${val}\` |`);
      }
    }
    if (configured.length === 0) {
      sections.push(`| _(all defaults)_ | — |`);
    }

    if (notConfigured.length > 0) {
      sections.push(
        "",
        "## Available customizations",
        "",
        "These options are not yet set. Ask the user if they'd like to configure any:",
        ""
      );
      for (const opt of notConfigured) {
        sections.push(`- **${opt.label}** — ${opt.hint}`);
        sections.push(`  Example: ${opt.example}`);
      }
      sections.push(
        "",
        "_Call this tool again with additional parameters to refine the config._"
      );
    }

    return {
      content: [{ type: "text" as const, text: sections.join("\n") }],
    };
  });
}
