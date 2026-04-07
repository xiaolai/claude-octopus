/**
 * CLI prompt helpers and MCP client detection — extracted from init.ts.
 */

import { createInterface } from "node:readline/promises";
import { readFile, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import type { AgentConfig } from "./templates.js";

// ── Types ─────────────────────────────────────────────────────────

export interface McpClient {
  name: string;
  configPath: string;
}

export interface McpConfig {
  mcpServers?: Record<string, unknown>;
  [key: string]: unknown;
}

// ── File helpers ─────────────────────────────────────────────────

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

// ── MCP Client Detection ─────────────────────────────────────────

export async function detectMcpClients(): Promise<McpClient[]> {
  const home = homedir();
  const cwd = process.cwd();

  const candidates: McpClient[] = [
    { name: "Claude Code (project)", configPath: join(cwd, ".mcp.json") },
    { name: "Claude Desktop", configPath: join(home, ".claude", "mcp.json") },
    { name: "Cursor", configPath: join(cwd, ".cursor", "mcp.json") },
    { name: "Windsurf", configPath: join(cwd, ".windsurf", "mcp.json") },
    { name: "Claude Code (user)", configPath: join(home, ".claude", "mcp.json") },
  ];

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

export async function readMcpConfig(path: string): Promise<McpConfig> {
  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new Error(`Cannot read ${path}: ${(err as Error).message}`);
  }
  try {
    return JSON.parse(raw) as McpConfig;
  } catch {
    throw new Error(`${path} contains invalid JSON \u2014 fix it manually before running init`);
  }
}

export async function writeMcpConfig(path: string, config: McpConfig): Promise<void> {
  await writeFile(path, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

// ── Interactive Prompts ──────────────────────────────────────────

export async function choose(
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

export async function confirm(
  rl: ReturnType<typeof createInterface>,
  prompt: string,
): Promise<boolean> {
  const answer = await rl.question(`${prompt} [Y/n]: `);
  return answer.trim().toLowerCase() !== "n";
}

// ── Custom Agent Builder ─────────────────────────────────────────

export async function buildCustomAgent(
  rl: ReturnType<typeof createInterface>,
): Promise<AgentConfig> {
  console.log("\nDescribe your custom agent:\n");

  const description = await rl.question("  Description (what should it do?): ");
  let name: string;
  while (true) {
    const raw = (await rl.question("  Name (kebab-case, e.g. my-agent): ")).trim();
    if (/^[a-z0-9][a-z0-9-]*$/.test(raw) && raw.length <= 30) {
      name = raw;
      break;
    }
    console.log("    Name must be lowercase alphanumeric with hyphens, 1-30 chars.");
  }

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
