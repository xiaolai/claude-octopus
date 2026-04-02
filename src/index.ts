#!/usr/bin/env node

/**
 * Claude Octopus — one brain, many arms.
 *
 * Wraps the Claude Agent SDK as MCP servers, letting you spawn multiple
 * specialized Claude Code agents — each with its own model, tools, prompt,
 * and personality.
 *
 * See README or env var docs in config.ts for configuration.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createRequire } from "node:module";
import { envStr, envBool, sanitizeToolName } from "./lib.js";
import { buildBaseOptions } from "./config.js";
import { registerQueryTools } from "./tools/query.js";
import { registerFactoryTool } from "./tools/factory.js";

const require = createRequire(import.meta.url);
const { version: PKG_VERSION } = require("../package.json");

// ── Configuration ──────────────────────────────────────────────────

const BASE_OPTIONS = buildBaseOptions();

const TOOL_NAME = sanitizeToolName(envStr("CLAUDE_TOOL_NAME") || "claude_code");
const REPLY_TOOL_NAME = `${TOOL_NAME}_reply`;
const SERVER_NAME = envStr("CLAUDE_SERVER_NAME") || "claude-octopus";
const FACTORY_ONLY = envBool("CLAUDE_FACTORY_ONLY", false);

const DEFAULT_DESCRIPTION = [
  "Send a task to an autonomous Claude Code agent.",
  "It reads/writes files, runs shell commands, searches codebases,",
  "and handles complex software engineering tasks end-to-end.",
  `Returns the result text plus a session_id for follow-ups via ${REPLY_TOOL_NAME}.`,
].join(" ");

const TOOL_DESCRIPTION = envStr("CLAUDE_DESCRIPTION") || DEFAULT_DESCRIPTION;

// ── Server ─────────────────────────────────────────────────────────

const server = new McpServer({ name: SERVER_NAME, version: PKG_VERSION });

if (!FACTORY_ONLY) {
  registerQueryTools(server, BASE_OPTIONS, TOOL_NAME, TOOL_DESCRIPTION);
}

if (FACTORY_ONLY) {
  registerFactoryTool(server);
}

// ── Start ──────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  const toolList = FACTORY_ONLY
    ? ["create_claude_code_mcp"]
    : BASE_OPTIONS.persistSession !== false
      ? [TOOL_NAME, REPLY_TOOL_NAME]
      : [TOOL_NAME];
  console.error(`${SERVER_NAME}: running on stdio (tools: ${toolList.join(", ")})`);
}

main().catch((error) => {
  console.error(`${SERVER_NAME}: fatal:`, error);
  process.exit(1);
});
