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
import { join } from "node:path";
import {
  TEMPLATES,
  getTemplate,
  templateToMcpServers,
  agentToMcpEntry,
  type Template,
  type AgentConfig,
} from "./templates.js";
import {
  choose,
  confirm,
  buildCustomAgent,
  detectMcpClients,
  readMcpConfig,
  writeMcpConfig,
} from "./cli-prompts.js";

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
    console.log("\n  Claude Octopus \u2014 init wizard\n");
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
      console.log(`  Using template: ${template.name} \u2014 ${template.summary}\n`);
    } else {
      const choice = await choose(
        rl,
        "Pick a template (or build your own):",
        [
          ...TEMPLATES.map((t) => ({
            label: `${t.name} \u2014 ${t.summary}`,
            value: t.id,
          })),
          { label: "Custom \u2014 describe your own agent(s)", value: "custom" },
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
    const merged = {
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
  } catch (err) {
    console.error(`\n  Error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  } finally {
    rl.close();
  }
}
