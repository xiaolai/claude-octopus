<p align="center">
  <img src="assets/claude-octopus-icon.svg" alt="Claude Octopus" width="200" />
</p>

# Claude Octopus

One brain, many arms.

An MCP server that wraps the [Claude Agent SDK](https://docs.anthropic.com/en/docs/claude-code/sdk), letting you run multiple specialized Claude Code agents — each with its own model, tools, system prompt, and personality — from any MCP client.

## Why

Claude Code is powerful. But one instance does everything the same way. Sometimes you want a **strict code reviewer** that only reads files. A **test writer** that defaults to TDD. A **cheap quick helper** on Haiku. A **deep thinker** on Opus.

Claude Octopus lets you spin up as many of these as you need. Same binary, different configurations. Each one shows up as a separate tool in your MCP client.

## Prerequisites

- **Node.js** >= 18
- **Claude Code** — the [Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) is bundled as a dependency, but it spawns Claude Code under the hood, so you need a working `claude` CLI installation
- **Anthropic API key** (`ANTHROPIC_API_KEY` env var) or an active Claude Code OAuth session

## Install

```bash
npm install claude-octopus
```

Or skip the install entirely — use `npx` directly in your `.mcp.json` (see Quick Start below).

## Quick Start

Add to your `.mcp.json`:

```json
{
  "mcpServers": {
    "claude": {
      "command": "npx",
      "args": ["claude-octopus"],
      "env": {
        "CLAUDE_PERMISSION_MODE": "bypassPermissions"
      }
    }
  }
}
```

This gives you two tools: `claude_code` and `claude_code_reply`. That's it — you have Claude Code as a tool.

## Multiple Agents

The real power is running several instances with different configurations:

```json
{
  "mcpServers": {
    "code-reviewer": {
      "command": "npx",
      "args": ["claude-octopus"],
      "env": {
        "CLAUDE_TOOL_NAME": "code_reviewer",
        "CLAUDE_SERVER_NAME": "code-reviewer",
        "CLAUDE_DESCRIPTION": "Strict code reviewer. Finds bugs and security issues. Read-only.",
        "CLAUDE_MODEL": "opus",
        "CLAUDE_ALLOWED_TOOLS": "Read,Grep,Glob",
        "CLAUDE_APPEND_PROMPT": "You are a strict code reviewer. Report real bugs, not style preferences.",
        "CLAUDE_EFFORT": "high"
      }
    },
    "test-writer": {
      "command": "npx",
      "args": ["claude-octopus"],
      "env": {
        "CLAUDE_TOOL_NAME": "test_writer",
        "CLAUDE_SERVER_NAME": "test-writer",
        "CLAUDE_DESCRIPTION": "Writes thorough tests with edge case coverage.",
        "CLAUDE_MODEL": "sonnet",
        "CLAUDE_APPEND_PROMPT": "Write tests first. Cover edge cases. TDD."
      }
    },
    "quick-qa": {
      "command": "npx",
      "args": ["claude-octopus"],
      "env": {
        "CLAUDE_TOOL_NAME": "quick_qa",
        "CLAUDE_SERVER_NAME": "quick-qa",
        "CLAUDE_DESCRIPTION": "Fast answers to quick coding questions.",
        "CLAUDE_MODEL": "haiku",
        "CLAUDE_MAX_BUDGET_USD": "0.02",
        "CLAUDE_EFFORT": "low"
      }
    }
  }
}
```

Your MCP client now sees three distinct tools — `code_reviewer`, `test_writer`, `quick_qa` — each purpose-built.

## Agent Factory

Don't want to write configs by hand? Add a factory instance:

```json
{
  "mcpServers": {
    "agent-factory": {
      "command": "npx",
      "args": ["claude-octopus"],
      "env": {
        "CLAUDE_FACTORY_ONLY": "true",
        "CLAUDE_SERVER_NAME": "agent-factory"
      }
    }
  }
}
```

This exposes a single `create_claude_code_mcp` tool — an interactive wizard. Tell it what you want ("a strict code reviewer that only reads files") and it generates the `.mcp.json` entry for you, listing all available options you can customize.

In factory-only mode, no query tools are registered — just the wizard. This keeps routing clean: the factory creates agents, the agents do work.

## Tools

Each non-factory instance exposes:

| Tool           | Purpose                                                 |
| -------------- | ------------------------------------------------------- |
| `<name>`       | Send a task to the agent, get a response + `session_id` |
| `<name>_reply` | Continue a previous conversation by `session_id`        |

Per-invocation parameters (override server defaults):

| Parameter         | Description                                     |
| ----------------- | ----------------------------------------------- |
| `prompt`          | The task or question (required)                 |
| `cwd`             | Working directory override                      |
| `model`           | Model override                                  |
| `allowedTools`    | Tool whitelist (intersects with server default) |
| `disallowedTools` | Tool blacklist (unions with server default)     |
| `maxTurns`        | Max conversation turns                          |
| `maxBudgetUsd`    | Max spend in USD                                |
| `systemPrompt`    | Additional prompt (appended to server default)  |

## Configuration

All configuration is via environment variables in `.mcp.json`. Every env var is optional.

### Identity

| Env Var               | Description                                    | Default          |
| --------------------- | ---------------------------------------------- | ---------------- |
| `CLAUDE_TOOL_NAME`    | Tool name prefix (`<name>` and `<name>_reply`) | `claude_code`    |
| `CLAUDE_DESCRIPTION`  | Tool description shown to the host AI          | generic          |
| `CLAUDE_SERVER_NAME`  | MCP server name in protocol handshake          | `claude-octopus` |
| `CLAUDE_FACTORY_ONLY` | Only expose the factory wizard tool            | `false`          |

### Agent

| Env Var                   | Description                                           | Default         |
| ------------------------- | ----------------------------------------------------- | --------------- |
| `CLAUDE_MODEL`            | Model (`sonnet`, `opus`, `haiku`, or full ID)         | SDK default     |
| `CLAUDE_CWD`              | Working directory                                     | `process.cwd()` |
| `CLAUDE_PERMISSION_MODE`  | `default`, `acceptEdits`, `bypassPermissions`, `plan` | `default`       |
| `CLAUDE_ALLOWED_TOOLS`    | Comma-separated tool whitelist                        | all             |
| `CLAUDE_DISALLOWED_TOOLS` | Comma-separated tool blacklist                        | none            |
| `CLAUDE_MAX_TURNS`        | Max conversation turns                                | unlimited       |
| `CLAUDE_MAX_BUDGET_USD`   | Max spend per invocation                              | unlimited       |
| `CLAUDE_EFFORT`           | `low`, `medium`, `high`, `max`                        | SDK default     |

### Prompts

| Env Var                | Description                                            |
| ---------------------- | ------------------------------------------------------ |
| `CLAUDE_SYSTEM_PROMPT` | Replaces the default Claude Code system prompt         |
| `CLAUDE_APPEND_PROMPT` | Appended to the default prompt (usually what you want) |

### Advanced

| Env Var                  | Description                                              |
| ------------------------ | -------------------------------------------------------- |
| `CLAUDE_ADDITIONAL_DIRS` | Extra directories to grant access (comma-separated)      |
| `CLAUDE_PLUGINS`         | Local plugin paths (comma-separated)                     |
| `CLAUDE_MCP_SERVERS`     | MCP servers for the inner agent (JSON)                   |
| `CLAUDE_PERSIST_SESSION` | `true`/`false` — enable session resume (default: `true`) |
| `CLAUDE_SETTING_SOURCES` | Settings to load: `user`, `project`, `local`             |
| `CLAUDE_SETTINGS`        | Path to settings JSON or inline JSON                     |
| `CLAUDE_BETAS`           | Beta features (comma-separated)                          |

### Authentication

| Env Var                   | Description                            | Default               |
| ------------------------- | -------------------------------------- | --------------------- |
| `ANTHROPIC_API_KEY`       | Anthropic API key for this agent       | inherited from parent |
| `CLAUDE_CODE_OAUTH_TOKEN` | Claude Code OAuth token for this agent | inherited from parent |

Leave both unset to inherit auth from the parent process. Set one per agent to use a different account or billing source.

Lists accept JSON arrays when values contain commas: `["path,with,comma", "/normal"]`

## Security

- **Permission mode defaults to ****`default`** — tool executions prompt for approval unless you explicitly set `bypassPermissions`.
- **`cwd`**** overrides are confined** — per-invocation `cwd` must be a descendant of the server-level base directory. Traversal attempts are silently ignored.
- **Tool restrictions narrow, never widen** — per-invocation `allowedTools` intersects with the server whitelist (can only remove tools, not add). `disallowedTools` unions (can only block more).
- **`_reply`**** tool respects persistence** — not registered when `CLAUDE_PERSIST_SESSION=false`.

## Architecture

```
┌─────────────────────────────────┐
│  MCP Client                     │
│  (Claude Desktop, Cursor, etc.) │
│                                 │
│  Sees: code_reviewer,           │
│        test_writer, quick_qa    │
└──────────┬──────────────────────┘
           │ JSON-RPC / stdio
┌──────────▼──────────────────────┐
│  Claude Octopus (per instance)  │
│                                 │
│  Env: CLAUDE_MODEL=opus         │
│       CLAUDE_ALLOWED_TOOLS=...  │
│       CLAUDE_APPEND_PROMPT=...  │
│                                 │
│  Calls: Agent SDK query()       │
└──────────┬──────────────────────┘
           │ in-process
┌──────────▼──────────────────────┐
│  Claude Agent SDK               │
│  Runs autonomously: reads files,│
│  writes code, runs commands     │
│  Returns result + session_id    │
└─────────────────────────────────┘
```

## How It Compares

| Feature             | ``         | [claude-code-mcp](https://github.com/steipete/claude-code-mcp) | **Claude Octopus** |
| ------------------- | ------------ | -------------------------------------------------------------- | ------------------ |
| Approach            | Built-in     | CLI wrapping                                                   | Agent SDK          |
| Exposes             | 16 raw tools | 1 prompt tool                                                  | 1 prompt + reply   |
| Multi-instance      | No           | No                                                             | Yes                |
| Per-instance config | No           | No                                                             | Yes (18 env vars)  |
| Factory wizard      | No           | No                                                             | Yes                |
| Session continuity  | No           | No                                                             | Yes                |

## Development

```bash
pnpm install
pnpm build       # compile TypeScript
pnpm test        # run tests (vitest)
pnpm test:coverage  # 100% coverage
```

## License

[ISC](https://github.com/xiaolai/claude-octopus/blob/main/LICENSE) - Xiaolai Li
