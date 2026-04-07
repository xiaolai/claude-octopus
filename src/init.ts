/**
 * Interactive CLI init wizard.
 *
 * Usage:
 *   claude-octopus init [--template <id>]
 *
 * Detects MCP clients, shows template menu, writes config.
 */

import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { readFile, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import {
  TEMPLATES,
  getTemplate,
  templateToMcpServers,
  agentToMcpEntry,
  type Template,
  type AgentConfig,
} from "./templates.js";

// ── Types ─────────────────────────────────────────────────────────

interface McpClient {
  name: string;
  configPath: string;
}

interface McpConfig {
  mcpServers?: Record<string, unknown>;
  [key: string]: unknown;
}

// ── MCP Client Detection ─────────────────────────────────────────

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function detectMcpClients(): Promise<McpClient[]> {
  const home = homedir();
  const cwd = process.cwd();

  const candidates: McpClient[] = [
    { name: "Claude Code (project)", configPath: join(cwd, ".mcp.json") },
    { name: "Claude Desktop", configPath: join(home, ".claude", "mcp.json") },
    { name: "Cursor", configPath: join(cwd, ".cursor", "mcp.json") },
    { name: "Windsurf", configPath: join(cwd, ".windsurf", "mcp.json") },
    { name: "Claude Code (user)", configPath: join(home, ".claude", "mcp.json") },
  ];

  // Deduplicate by configPath
  const seen = new Set<string>();
  const unique: McpClient[] = [];
  for (const c of candidates) {
    if (!seen.has(c.configPath)) {
      seen.add(c.configPath);
      unique.push(c);
    }
  }

  const detected: McpClient[] = [];
  for (const client of unique) {
    if (await fileExists(client.configPath)) {
      detected.push(client);
    }
  }
  return detected;
}

// ── Config I/O ───────────────────────────────────────────────────

async function readMcpConfig(path: string): Promise<McpConfig> {
  try {
    const raw = await readFile(path, "utf-8");
    return JSON.parse(raw) as McpConfig;
  } catch {
    return {};
  }
}

async function writeMcpConfig(path: string, config: McpConfig): Promise<void> {
  await writeFile(path, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

// ── Interactive Prompts ──────────────────────────────────────────

async function choose(
  rl: ReturnType<typeof createInterface>,
  prompt: string,
  options: { label: string; value: string }[],
): Promise<string> {
  console.log(`\n${prompt}\n`);
  for (let i = 0; i < options.length; i++) {
    console.log(`  ${i + 1}. ${options[i].label}`);
  }
  while (true) {
    const answer = await rl.question(`\nChoice [1-${options.length}]: `);
    const idx = parseInt(answer.trim(), 10) - 1;
    if (idx >= 0 && idx < options.length) {
      return options[idx].value;
    }
    console.log(`Please enter a number between 1 and ${options.length}.`);
  }
}

async function confirm(
  rl: ReturnType<typeof createInterface>,
  prompt: string,
): Promise<boolean> {
  const answer = await rl.question(`${prompt} [Y/n]: `);
  return answer.trim().toLowerCase() !== "n";
}

// ── Custom Agent Builder ─────────────────────────────────────────

async function buildCustomAgent(
  rl: ReturnType<typeof createInterface>,
): Promise<AgentConfig> {
  console.log("\nDescribe your custom agent:\n");

  const description = await rl.question("  Description (what should it do?): ");
  const name = await rl.question("  Name (kebab-case, e.g. my-agent): ");

  const toolName = name
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 53) || "custom_agent";

  const model = await choose(rl, "  Model:", [
    { label: "Sonnet (balanced)", value: "sonnet" },
    { label: "Opus (most capable)", value: "opus" },
    { label: "Haiku (fastest, cheapest)", value: "haiku" },
    { label: "Default (inherit from SDK)", value: "" },
  ]);

  const readOnly = await confirm(rl, "  Read-only (no file writes)?");

  const agent: AgentConfig = {
    serverName: name || "custom-agent",
    toolName,
    description: description || "Custom Claude Code agent",
  };
  if (model) agent.model = model;
  if (readOnly) agent.allowedTools = "Read,Grep,Glob";
  if (description) {
    agent.appendPrompt = description;
  }

  return agent;
}

// ── Main ─────────────────────────────────────────────────────────

export async function runInitCli(args: string[]): Promise<void> {
  // Parse --template flag
  let templateId: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--template" || args[i] === "-t") {
      templateId = args[++i];
    } else if (args[i] === "--help" || args[i] === "-h") {
      console.log(`Usage: claude-octopus init [--template <id>]

Templates:
${TEMPLATES.map((t) => `  ${t.id.padEnd(20)} ${t.summary}`).join("\n")}

Options:
  --template, -t <id>  Use this template directly (skip menu)
  --help, -h           Show this help
`);
      return;
    }
  }

  const rl = createInterface({ input: stdin, output: stdout });

  try {
    console.log("\n  Claude Octopus — init wizard\n");
    console.log("  One brain, many arms. Let's set up your agents.\n");

    // ── Step 1: Choose template ────────────────────────────────

    let template: Template | undefined;
    let customAgents: AgentConfig[] | undefined;

    if (templateId) {
      template = getTemplate(templateId);
      if (!template) {
        console.error(`Unknown template: ${templateId}`);
        console.error(`Available: ${TEMPLATES.map((t) => t.id).join(", ")}`);
        process.exitCode = 1;
        return;
      }
      console.log(`  Using template: ${template.name} — ${template.summary}\n`);
    } else {
      const choice = await choose(
        rl,
        "Pick a template (or build your own):",
        [
          ...TEMPLATES.map((t) => ({
            label: `${t.name} — ${t.summary}`,
            value: t.id,
          })),
          { label: "Custom — describe your own agent(s)", value: "custom" },
        ],
      );

      if (choice === "custom") {
        customAgents = [];
        do {
          customAgents.push(await buildCustomAgent(rl));
        } while (await confirm(rl, "\n  Add another agent?"));
      } else {
        template = getTemplate(choice)!;
      }
    }

    // ── Step 2: Choose MCP client ──────────────────────────────

    const detected = await detectMcpClients();
    let targetPath: string;

    if (detected.length === 0) {
      // Default to .mcp.json in cwd
      targetPath = join(process.cwd(), ".mcp.json");
      console.log(`\n  No existing MCP config detected. Will create: ${targetPath}`);
    } else if (detected.length === 1) {
      targetPath = detected[0].configPath;
      console.log(`\n  Detected: ${detected[0].name} (${detected[0].configPath})`);
    } else {
      const chosen = await choose(
        rl,
        "Multiple MCP clients detected. Which one?",
        [
          ...detected.map((c) => ({
            label: `${c.name} (${c.configPath})`,
            value: c.configPath,
          })),
          {
            label: "New .mcp.json in current directory",
            value: join(process.cwd(), ".mcp.json"),
          },
        ],
      );
      targetPath = chosen;
    }

    // ── Step 3: Build config ───────────────────────────────────

    const newServers = template
      ? templateToMcpServers(template)
      : (() => {
          const servers: Record<string, unknown> = {};
          for (const agent of customAgents!) {
            servers[agent.serverName] = agentToMcpEntry(agent);
          }
          return servers;
        })();

    // ── Step 4: Merge and write ────────────────────────────────

    const existing = await readMcpConfig(targetPath);
    const merged: McpConfig = {
      ...existing,
      mcpServers: {
        ...(existing.mcpServers || {}),
        ...newServers,
      },
    };

    const agentNames = Object.keys(newServers);

    if (existing.mcpServers) {
      const conflicts = agentNames.filter(
        (name) => name in (existing.mcpServers as Record<string, unknown>),
      );
      if (conflicts.length > 0) {
        const overwrite = await confirm(
          rl,
          `\n  Warning: ${conflicts.join(", ")} already exist. Overwrite?`,
        );
        if (!overwrite) {
          console.log("\n  Aborted. No changes made.\n");
          return;
        }
      }
    }

    await writeMcpConfig(targetPath, merged);

    // ── Step 5: Summary ────────────────────────────────────────

    console.log(`\n  Done! Wrote ${agentNames.length} agent(s) to ${targetPath}\n`);
    console.log("  Agents added:");
    for (const name of agentNames) {
      console.log(`    - ${name}`);
    }
    console.log(`
  Next steps:
    1. Restart your MCP client to pick up the new config
    2. The new tools will appear in your AI assistant
    3. Run \`npx claude-octopus dashboard\` to monitor agent activity
`);
  } finally {
    rl.close();
  }
}
