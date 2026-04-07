/**
 * Pre-built agent templates for `claude-octopus init`.
 *
 * Each template defines a set of agents with tuned configurations.
 * Templates are pure data — no side effects.
 */

// ── Types ─────────────────────────────────────────────────────────

export interface AgentConfig {
  serverName: string;
  toolName: string;
  description: string;
  model?: string;
  appendPrompt?: string;
  allowedTools?: string;
  disallowedTools?: string;
  effort?: string;
  maxBudgetUsd?: string;
  permissionMode?: string;
  factoryOnly?: boolean;
  mcpServers?: string;
}

export interface Template {
  id: string;
  name: string;
  summary: string;
  agents: AgentConfig[];
}

// ── Helpers ───────────────────────────────────────────────────────

export function agentToEnv(agent: AgentConfig): Record<string, string> {
  const env: Record<string, string> = {
    CLAUDE_TOOL_NAME: agent.toolName,
    CLAUDE_SERVER_NAME: agent.serverName,
    CLAUDE_DESCRIPTION: agent.description,
  };
  if (agent.model) env.CLAUDE_MODEL = agent.model;
  if (agent.appendPrompt) env.CLAUDE_APPEND_PROMPT = agent.appendPrompt;
  if (agent.allowedTools) env.CLAUDE_ALLOWED_TOOLS = agent.allowedTools;
  if (agent.disallowedTools) env.CLAUDE_DISALLOWED_TOOLS = agent.disallowedTools;
  if (agent.effort) env.CLAUDE_EFFORT = agent.effort;
  if (agent.maxBudgetUsd) env.CLAUDE_MAX_BUDGET_USD = agent.maxBudgetUsd;
  if (agent.permissionMode) env.CLAUDE_PERMISSION_MODE = agent.permissionMode;
  if (agent.factoryOnly) env.CLAUDE_FACTORY_ONLY = "true";
  if (agent.mcpServers) env.CLAUDE_MCP_SERVERS = agent.mcpServers;
  return env;
}

export function agentToMcpEntry(agent: AgentConfig): Record<string, unknown> {
  return {
    command: "npx",
    args: ["claude-octopus@latest"],
    env: agentToEnv(agent),
  };
}

export function templateToMcpServers(
  template: Template,
): Record<string, unknown> {
  const servers: Record<string, unknown> = {};
  for (const agent of template.agents) {
    servers[agent.serverName] = agentToMcpEntry(agent);
  }
  return servers;
}

// ── Templates ─────────────────────────────────────────────────────

export const TEMPLATES: Template[] = [
  {
    id: "code-review-team",
    name: "Code Review Team",
    summary: "Reviewer + test writer + security auditor",
    agents: [
      {
        serverName: "code-reviewer",
        toolName: "code_reviewer",
        description: "Strict code reviewer. Finds bugs and security issues. Read-only.",
        model: "opus",
        allowedTools: "Read,Grep,Glob",
        appendPrompt: "You are a strict code reviewer. Report real bugs, not style preferences. Be specific about file and line.",
        effort: "high",
      },
      {
        serverName: "test-writer",
        toolName: "test_writer",
        description: "Writes thorough tests with edge case coverage.",
        model: "sonnet",
        appendPrompt: "Write tests first. Cover edge cases. Use TDD. Prefer integration tests over unit tests when it makes sense.",
      },
      {
        serverName: "security-auditor",
        toolName: "security_auditor",
        description: "Security-focused code auditor. Checks for OWASP top 10 and common vulnerabilities.",
        model: "opus",
        allowedTools: "Read,Grep,Glob",
        appendPrompt: "You are a security auditor. Check for injection, XSS, CSRF, auth bypasses, secrets in code, and insecure defaults. Report with severity.",
        effort: "high",
      },
    ],
  },
  {
    id: "publishing-house",
    name: "Publishing House",
    summary: "Researcher + architect + editor + proofreader",
    agents: [
      {
        serverName: "researcher",
        toolName: "researcher",
        description: "Deep researcher. Reads codebases, documentation, and web sources to gather context.",
        model: "sonnet",
        appendPrompt: "You are a thorough researcher. Gather all relevant context before answering. Cite specific files and line numbers.",
      },
      {
        serverName: "architect",
        toolName: "architect",
        description: "Software architect. Designs systems, plans implementations, reviews designs.",
        model: "opus",
        appendPrompt: "You are a software architect. Think about separation of concerns, extensibility, and failure modes. Draw from established patterns.",
        effort: "high",
      },
      {
        serverName: "editor",
        toolName: "editor",
        description: "Code editor. Implements designs, writes clean production code.",
        model: "sonnet",
        appendPrompt: "You are a meticulous code editor. Write clean, idiomatic code. Follow existing patterns in the codebase. Keep changes minimal and focused.",
        permissionMode: "acceptEdits",
      },
      {
        serverName: "proofreader",
        toolName: "proofreader",
        description: "Final review pass. Catches typos, inconsistencies, and documentation gaps.",
        model: "haiku",
        allowedTools: "Read,Grep,Glob",
        appendPrompt: "You are a proofreader. Check for typos, inconsistent naming, missing documentation, and formatting issues. Be thorough but concise.",
      },
    ],
  },
  {
    id: "tiered-models",
    name: "Tiered Models",
    summary: "Haiku for quick Q&A, Sonnet for coding, Opus for hard problems",
    agents: [
      {
        serverName: "quick-qa",
        toolName: "quick_qa",
        description: "Fast answers to quick coding questions. Cheap and fast.",
        model: "haiku",
        maxBudgetUsd: "0.02",
        effort: "low",
      },
      {
        serverName: "coder",
        toolName: "coder",
        description: "General-purpose coding agent. Reads, writes, and refactors code.",
        model: "sonnet",
        appendPrompt: "Write clean, idiomatic code. Follow existing patterns. Test your changes.",
      },
      {
        serverName: "deep-thinker",
        toolName: "deep_thinker",
        description: "Deep reasoning for hard problems. Architecture, debugging, complex refactors.",
        model: "opus",
        effort: "high",
        appendPrompt: "Think step by step. Consider edge cases. Explain your reasoning.",
      },
    ],
  },
  {
    id: "solo-agent",
    name: "Solo Agent",
    summary: "Single Claude Code agent with sensible defaults",
    agents: [
      {
        serverName: "claude",
        toolName: "claude_code",
        description: "Send a task to an autonomous Claude Code agent. Reads/writes files, runs commands, handles complex engineering tasks.",
        permissionMode: "bypassPermissions",
      },
    ],
  },
  {
    id: "factory",
    name: "Agent Factory",
    summary: "Interactive wizard that generates agent configs on demand",
    agents: [
      {
        serverName: "agent-factory",
        toolName: "agent_factory",
        description: "Interactive wizard — describe what you want and get a ready-to-use .mcp.json config.",
        factoryOnly: true,
      },
    ],
  },
];

export function getTemplate(id: string): Template | undefined {
  return TEMPLATES.find((t) => t.id === id);
}
