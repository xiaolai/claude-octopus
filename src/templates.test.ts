import { describe, it, expect } from "vitest";
import {
  TEMPLATES,
  getTemplate,
  agentToEnv,
  agentToMcpEntry,
  templateToMcpServers,
  type AgentConfig,
} from "./templates.js";

describe("TEMPLATES", () => {
  it("has at least 5 templates", () => {
    expect(TEMPLATES.length).toBeGreaterThanOrEqual(5);
  });

  it("every template has unique id", () => {
    const ids = TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every template has at least one agent", () => {
    for (const t of TEMPLATES) {
      expect(t.agents.length).toBeGreaterThan(0);
    }
  });

  it("every agent has required fields", () => {
    for (const t of TEMPLATES) {
      for (const agent of t.agents) {
        expect(agent.serverName).toBeTruthy();
        expect(agent.toolName).toBeTruthy();
        expect(agent.description).toBeTruthy();
      }
    }
  });

  it("tool names are valid (alphanumeric + underscore, <= 53 chars)", () => {
    for (const t of TEMPLATES) {
      for (const agent of t.agents) {
        expect(agent.toolName).toMatch(/^[a-zA-Z0-9_]+$/);
        expect(agent.toolName.length).toBeLessThanOrEqual(53);
      }
    }
  });
});

describe("getTemplate", () => {
  it("finds existing template", () => {
    const t = getTemplate("code-review-team");
    expect(t).toBeDefined();
    expect(t!.name).toBe("Code Review Team");
  });

  it("returns undefined for missing template", () => {
    expect(getTemplate("nonexistent")).toBeUndefined();
  });
});

describe("agentToEnv", () => {
  it("includes required fields", () => {
    const env = agentToEnv({
      serverName: "test",
      toolName: "test_tool",
      description: "A test agent",
    });
    expect(env.CLAUDE_TOOL_NAME).toBe("test_tool");
    expect(env.CLAUDE_SERVER_NAME).toBe("test");
    expect(env.CLAUDE_DESCRIPTION).toBe("A test agent");
  });

  it("includes optional fields when set", () => {
    const agent: AgentConfig = {
      serverName: "rev",
      toolName: "reviewer",
      description: "Reviewer",
      model: "opus",
      appendPrompt: "Be strict",
      allowedTools: "Read,Grep",
      effort: "high",
      maxBudgetUsd: "1.0",
      permissionMode: "bypassPermissions",
    };
    const env = agentToEnv(agent);
    expect(env.CLAUDE_MODEL).toBe("opus");
    expect(env.CLAUDE_APPEND_PROMPT).toBe("Be strict");
    expect(env.CLAUDE_ALLOWED_TOOLS).toBe("Read,Grep");
    expect(env.CLAUDE_EFFORT).toBe("high");
    expect(env.CLAUDE_MAX_BUDGET_USD).toBe("1.0");
    expect(env.CLAUDE_PERMISSION_MODE).toBe("bypassPermissions");
  });

  it("omits unset optional fields", () => {
    const env = agentToEnv({
      serverName: "test",
      toolName: "test_tool",
      description: "A test agent",
    });
    expect(env.CLAUDE_MODEL).toBeUndefined();
    expect(env.CLAUDE_EFFORT).toBeUndefined();
  });

  it("sets CLAUDE_FACTORY_ONLY for factory agents", () => {
    const env = agentToEnv({
      serverName: "factory",
      toolName: "factory",
      description: "Factory",
      factoryOnly: true,
    });
    expect(env.CLAUDE_FACTORY_ONLY).toBe("true");
  });
});

describe("agentToMcpEntry", () => {
  it("produces valid MCP entry structure", () => {
    const entry = agentToMcpEntry({
      serverName: "test",
      toolName: "test_tool",
      description: "Test",
    });
    expect(entry).toEqual({
      command: "npx",
      args: ["-y", "claude-octopus@latest"],
      env: expect.objectContaining({
        CLAUDE_TOOL_NAME: "test_tool",
      }),
    });
  });
});

describe("templateToMcpServers", () => {
  it("produces server entries keyed by serverName", () => {
    const template = getTemplate("solo-agent")!;
    const servers = templateToMcpServers(template);
    expect(Object.keys(servers)).toEqual(["claude"]);
    expect(servers.claude).toEqual(
      expect.objectContaining({ command: "npx" }),
    );
  });

  it("produces multiple entries for multi-agent templates", () => {
    const template = getTemplate("code-review-team")!;
    const servers = templateToMcpServers(template);
    expect(Object.keys(servers)).toEqual([
      "code-reviewer",
      "test-writer",
      "security-auditor",
    ]);
  });
});
