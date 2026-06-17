import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v4";
import { listSessions } from "@anthropic-ai/claude-agent-sdk";

/**
 * Decide which project directory `listSessions` reads.
 *
 * Repo-scoped by default: the server's working directory (CLAUDE_CWD or the
 * process cwd). `allProjects` widens the scope to every project on the machine
 * by omitting the directory entirely. An explicit `cwd` overrides the default
 * but is ignored once `allProjects` is set.
 *
 * Pure and exported so the scoping rule can be unit-tested without touching disk.
 */
export function resolveSessionScope(opts: {
  allProjects?: boolean;
  cwd?: string;
  defaultCwd: string;
}): { dir: string | undefined } {
  if (opts.allProjects) return { dir: undefined };
  return { dir: opts.cwd || opts.defaultCwd };
}

/**
 * Register the `<toolName>_sessions` tool — the enumerator for Claude Code's
 * interactive session history.
 *
 * The companion `<toolName>_transcript` tool already reads a session by id;
 * this tool supplies the ids. Together they let a caller discover and read the
 * conversation history stored under `~/.claude/projects/`.
 *
 * Registered unconditionally: listing the user's session storage is independent
 * of this server's own `persistSession` setting (which only governs whether the
 * server persists the agent sessions it spawns).
 */
export function registerSessionsTool(
  server: McpServer,
  toolName: string,
  defaultCwd: string,
) {
  server.registerTool(`${toolName}_sessions`, {
    description: [
      "List Claude Code interactive session history, newest first.",
      "Scoped to the current project directory by default; pass all_projects=true",
      "to list sessions across every project on this machine.",
      "Returns session_id, title, first prompt, git branch, timestamps, and file size",
      `for each session. Pass a returned session_id to ${toolName}_transcript to read`,
      "the full conversation.",
    ].join(" "),
    inputSchema: z.object({
      all_projects: z
        .boolean()
        .optional()
        .describe("List sessions from every project on this machine instead of just the current one (default: false)"),
      cwd: z
        .string()
        .optional()
        .describe("Project directory to list sessions for (default: the server's working directory). Ignored when all_projects is true."),
      limit: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Maximum number of sessions to return"),
      offset: z
        .number()
        .int()
        .optional()
        .describe("Skip this many sessions from the start, for pagination (default: 0)"),
      include_worktrees: z
        .boolean()
        .optional()
        .describe("When listing one project, also include sessions from its sibling git worktrees (default: true)"),
    }),
  }, async ({ all_projects, cwd, limit, offset, include_worktrees }) => {
    try {
      const { dir } = resolveSessionScope({ allProjects: all_projects, cwd, defaultCwd });
      const sessions = await listSessions({
        dir,
        limit,
        offset,
        includeWorktrees: include_worktrees,
      });
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            scope: dir ?? "all_projects",
            session_count: sessions.length,
            sessions,
          }, null, 2),
        }],
      };
    } catch (error) {
      return {
        content: [{
          type: "text" as const,
          text: `Error listing sessions: ${error instanceof Error ? error.message : String(error)}`,
        }],
        isError: true,
      };
    }
  });
}
