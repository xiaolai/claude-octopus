import type { Options } from "./types.js";
import {
  envStr,
  envList,
  envNum,
  envBool,
  envJson,
  validatePermissionMode,
} from "./lib.js";

export function buildBaseOptions(): Options {
  const opts: Options = {
    cwd: envStr("CLAUDE_CWD") || process.cwd(),
    persistSession: envBool("CLAUDE_PERSIST_SESSION", true),
  };

  const rawPerm = envStr("CLAUDE_PERMISSION_MODE") || "default";
  const permMode = validatePermissionMode(rawPerm);
  if (rawPerm !== permMode) {
    console.error(
      `claude-octopus: invalid CLAUDE_PERMISSION_MODE "${rawPerm}", using "default"`
    );
  }
  opts.permissionMode = permMode as Options["permissionMode"];
  if (permMode === "bypassPermissions") {
    opts.allowDangerouslySkipPermissions = true;
  }

  const model = envStr("CLAUDE_MODEL");
  if (model) opts.model = model;

  const allowed = envList("CLAUDE_ALLOWED_TOOLS");
  if (allowed) opts.allowedTools = allowed;
  const disallowed = envList("CLAUDE_DISALLOWED_TOOLS");
  if (disallowed) opts.disallowedTools = disallowed;

  const maxTurns = envNum("CLAUDE_MAX_TURNS");
  if (maxTurns !== undefined && maxTurns > 0 && Number.isInteger(maxTurns)) {
    opts.maxTurns = maxTurns;
  }
  const maxBudget = envNum("CLAUDE_MAX_BUDGET_USD");
  if (maxBudget !== undefined && maxBudget > 0) {
    opts.maxBudgetUsd = maxBudget;
  }

  const sysPrompt = envStr("CLAUDE_SYSTEM_PROMPT");
  const appendPrompt = envStr("CLAUDE_APPEND_PROMPT");
  if (sysPrompt) {
    opts.systemPrompt = sysPrompt;
  } else if (appendPrompt) {
    opts.systemPrompt = {
      type: "preset",
      preset: "claude_code",
      append: appendPrompt,
    };
  }

  const dirs = envList("CLAUDE_ADDITIONAL_DIRS");
  if (dirs) opts.additionalDirectories = dirs;

  const plugins = envList("CLAUDE_PLUGINS");
  if (plugins) {
    opts.plugins = plugins.map((p) => ({ type: "local" as const, path: p }));
  }

  const mcpServers = envJson<Record<string, unknown>>("CLAUDE_MCP_SERVERS");
  if (mcpServers) {
    opts.mcpServers = mcpServers as Options["mcpServers"];
  }

  const effort = envStr("CLAUDE_EFFORT");
  if (effort) opts.effort = effort as Options["effort"];

  const sources = envList("CLAUDE_SETTING_SOURCES");
  if (sources) {
    opts.settingSources = sources as Options["settingSources"];
  }

  const settings = envStr("CLAUDE_SETTINGS");
  if (settings) {
    if (settings.startsWith("{")) {
      try {
        opts.settings = JSON.parse(settings);
      } catch {
        opts.settings = settings;
      }
    } else {
      opts.settings = settings;
    }
  }

  const betas = envList("CLAUDE_BETAS");
  if (betas) opts.betas = betas as Options["betas"];

  return opts;
}
