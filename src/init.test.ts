import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  TEMPLATES,
  templateToMcpServers,
  agentToMcpEntry,
} from "./templates.js";

/**
 * Tests for init wizard logic — config merging and template application.
 * Interactive prompts (readline) are not tested here; the underlying
 * data transforms are pure functions tested via templates.test.ts.
 * This file tests the config file I/O behavior.
 */

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "octopus-init-test-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("config merging", () => {
  it("creates new .mcp.json from template", async () => {
    const template = TEMPLATES.find((t) => t.id === "solo-agent")!;
    const servers = templateToMcpServers(template);
    const config = { mcpServers: servers };
    const path = join(tmpDir, ".mcp.json");

    await writeFile(path, JSON.stringify(config, null, 2), "utf-8");
    const result = JSON.parse(await readFile(path, "utf-8"));

    expect(result.mcpServers).toBeDefined();
    expect(result.mcpServers.claude).toBeDefined();
    expect(result.mcpServers.claude.command).toBe("npx");
  });

  it("merges with existing config", async () => {
    const path = join(tmpDir, ".mcp.json");
    const existing = {
      mcpServers: {
        "existing-server": { command: "node", args: ["server.js"] },
      },
    };
    await writeFile(path, JSON.stringify(existing), "utf-8");

    // Simulate merge
    const template = TEMPLATES.find((t) => t.id === "solo-agent")!;
    const newServers = templateToMcpServers(template);
    const merged = {
      ...existing,
      mcpServers: {
        ...existing.mcpServers,
        ...newServers,
      },
    };
    await writeFile(path, JSON.stringify(merged, null, 2), "utf-8");

    const result = JSON.parse(await readFile(path, "utf-8"));
    expect(result.mcpServers["existing-server"]).toBeDefined();
    expect(result.mcpServers.claude).toBeDefined();
  });

  it("preserves non-mcpServers fields", async () => {
    const path = join(tmpDir, ".mcp.json");
    const existing = {
      mcpServers: {},
      customField: "keep me",
    };
    await writeFile(path, JSON.stringify(existing), "utf-8");

    const template = TEMPLATES.find((t) => t.id === "solo-agent")!;
    const newServers = templateToMcpServers(template);
    const merged = {
      ...existing,
      mcpServers: { ...existing.mcpServers, ...newServers },
    };
    await writeFile(path, JSON.stringify(merged, null, 2), "utf-8");

    const result = JSON.parse(await readFile(path, "utf-8"));
    expect(result.customField).toBe("keep me");
  });
});

describe("template configs are valid", () => {
  it("every template produces valid MCP server entries", () => {
    for (const template of TEMPLATES) {
      const servers = templateToMcpServers(template);
      for (const [name, entry] of Object.entries(servers)) {
        const e = entry as Record<string, unknown>;
        expect(e.command).toBe("npx");
        expect(e.args).toEqual(["-y", "claude-octopus@latest"]);
        expect(typeof e.env).toBe("object");
        const env = e.env as Record<string, string>;
        expect(env.CLAUDE_TOOL_NAME).toBeTruthy();
        expect(env.CLAUDE_SERVER_NAME).toBe(name);
        expect(env.CLAUDE_DESCRIPTION).toBeTruthy();
      }
    }
  });
});

describe("custom agent config", () => {
  it("produces valid MCP entry from minimal config", () => {
    const entry = agentToMcpEntry({
      serverName: "my-agent",
      toolName: "my_agent",
      description: "My custom agent",
    });
    const env = (entry as Record<string, unknown>).env as Record<string, string>;
    expect(env.CLAUDE_TOOL_NAME).toBe("my_agent");
    expect(env.CLAUDE_SERVER_NAME).toBe("my-agent");
    expect(env.CLAUDE_DESCRIPTION).toBe("My custom agent");
    // No optional fields should be set
    expect(env.CLAUDE_MODEL).toBeUndefined();
    expect(env.CLAUDE_EFFORT).toBeUndefined();
  });
});
