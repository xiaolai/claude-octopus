#!/usr/bin/env node

/**
 * Claude Octopus — one brain, many arms.
 *
 * Entry point handles two modes:
 *   - No args (or MCP env): start as MCP server (default)
 *   - "report" subcommand:  generate HTML reports from CLI
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createRequire } from "node:module";
import { envStr, envBool, sanitizeToolName } from "./lib.js";
import { buildOctopusConfig } from "./config.js";
import { registerQueryTools } from "./tools/query.js";
import { registerTimelineTool } from "./tools/timeline.js";
import { registerReportTool } from "./tools/report.js";
import { registerFactoryTool } from "./tools/factory.js";
import { runReportCli } from "./cli.js";
import { runInitCli } from "./init.js";
import { runDashboardCli } from "./dashboard.js";

const require = createRequire(import.meta.url);
const { version: PKG_VERSION } = require("../package.json");

// ── Subcommand routing ────────────────────────────────────────────

const subcommand = process.argv[2];
if (subcommand === "report") {
  runReportCli(process.argv.slice(3));
} else if (subcommand === "init") {
  runInitCli(process.argv.slice(3));
} else if (subcommand === "dashboard") {
  runDashboardCli(process.argv.slice(3));
} else {
  startMcpServer();
}

// ── MCP Server ────────────────────────────────────────────────────

function startMcpServer() {
  const CONFIG = buildOctopusConfig();

  const TOOL_NAME = sanitizeToolName(envStr("CLAUDE_TOOL_NAME") || "claude_code");
  const REPLY_TOOL_NAME = `${TOOL_NAME}_reply`;
  const TIMELINE_TOOL_NAME = `${TOOL_NAME}_timeline`;
  const SERVER_NAME = envStr("CLAUDE_SERVER_NAME") || "claude-octopus";
  const FACTORY_ONLY = envBool("CLAUDE_FACTORY_ONLY", false);

  const DEFAULT_DESCRIPTION = [
    "Send a task to an autonomous Claude Code agent.",
    "It reads/writes files, runs shell commands, searches codebases,",
    "and handles complex software engineering tasks end-to-end.",
    `Returns the result text plus a session_id for follow-ups via ${REPLY_TOOL_NAME}.`,
  ].join(" ");

  const TOOL_DESCRIPTION = envStr("CLAUDE_DESCRIPTION") || DEFAULT_DESCRIPTION;

  const server = new McpServer({ name: SERVER_NAME, version: PKG_VERSION });

  if (!FACTORY_ONLY) {
    registerQueryTools(
      server,
      CONFIG.sdkOptions,
      TOOL_NAME,
      TOOL_DESCRIPTION,
      SERVER_NAME,
      CONFIG.timeline,
    );
    registerTimelineTool(
      server,
      TOOL_NAME,
      CONFIG.timeline,
      CONFIG.sdkOptions.persistSession !== false,
    );
    registerReportTool(
      server,
      TOOL_NAME,
      CONFIG.timeline,
      CONFIG.sdkOptions.persistSession !== false,
    );
  }

  if (FACTORY_ONLY) {
    registerFactoryTool(server);
  }

  async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    const toolList = FACTORY_ONLY
      ? ["create_claude_code_mcp"]
      : [
          TOOL_NAME,
          ...(CONFIG.sdkOptions.persistSession !== false ? [REPLY_TOOL_NAME] : []),
          TIMELINE_TOOL_NAME,
          ...(CONFIG.sdkOptions.persistSession !== false ? [`${TOOL_NAME}_transcript`] : []),
          `${TOOL_NAME}_report`,
        ];
    console.error(`${SERVER_NAME}: running on stdio (tools: ${toolList.join(", ")})`);
  }

  main().catch((error) => {
    console.error(`${SERVER_NAME}: fatal:`, error);
    process.exit(1);
  });
}
