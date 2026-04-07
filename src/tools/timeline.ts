import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v4";
import {
  getSessionMessages,
  getSessionInfo,
} from "@anthropic-ai/claude-agent-sdk";
import type { TimelineConfig } from "../types.js";
import { readTimeline, listRuns } from "../timeline.js";

export function registerTimelineTool(
  server: McpServer,
  toolName: string,
  timelineConfig: TimelineConfig,
  persistSession: boolean,
) {
  const timelineToolName = `${toolName}_timeline`;

  server.registerTool(timelineToolName, {
    description: [
      "Query the cross-agent workflow timeline.",
      "No args: list all runs. run_id: show one run's agent sequence.",
      persistSession
        ? "session_id: retrieve full transcript from Claude Code's session storage."
        : "session_id: retrieve entry metadata (transcripts unavailable — session persistence is off).",
    ].join(" "),
    inputSchema: z.object({
      run_id: z.string().optional().describe("Show all entries for this workflow run, ordered by time"),
      session_id: z.string().optional().describe("Retrieve data for a specific session"),
      info_only: z.boolean().optional().describe("When used with session_id: return metadata only, not full transcript"),
    }),
  }, async ({ run_id, session_id }) => {
    try {
      // Mode 1: specific session
      if (session_id) {
        // Always return the timeline entry for this session
        const entries = await readTimeline(timelineConfig.dir, { sessionId: session_id });
        const entryData = entries.length > 0
          ? entries[0]
          : null;

        if (persistSession) {
          // Try to get session info from Claude Code's storage
          const info = await getSessionInfo(session_id).catch(() => undefined);
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                timeline_entry: entryData,
                session_info: info || null,
              }, null, 2),
            }],
          };
        }

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              timeline_entry: entryData,
              session_info: null,
              note: "Session persistence is off — full transcripts unavailable.",
            }, null, 2),
          }],
        };
      }

      // Mode 2: specific run
      if (run_id) {
        const entries = await readTimeline(timelineConfig.dir, { runId: run_id });
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ run_id, entries }, null, 2),
          }],
        };
      }

      // Mode 3: list all runs
      const runs = await listRuns(timelineConfig.dir);
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ runs }, null, 2),
        }],
      };
    } catch (error) {
      return {
        content: [{
          type: "text" as const,
          text: `Error reading timeline: ${error instanceof Error ? error.message : String(error)}`,
        }],
        isError: true,
      };
    }
  });

  // Separate tool for full transcript retrieval — only when persistence is on
  if (persistSession) {
    server.registerTool(`${toolName}_transcript`, {
      description: [
        `Retrieve the full conversation transcript for a session from Claude Code's storage.`,
        "Returns chronological user/assistant messages. Use session_id from a prior query or timeline lookup.",
      ].join(" "),
      inputSchema: z.object({
        session_id: z.string().describe("Session ID to retrieve transcript for"),
        limit: z.number().int().positive().optional().describe("Maximum number of messages to return"),
        offset: z.number().int().optional().describe("Skip this many messages from the start"),
        include_system: z.boolean().optional().describe("Include system messages (default: false)"),
      }),
    }, async ({ session_id, limit, offset, include_system }) => {
      try {
        const messages = await getSessionMessages(session_id, {
          limit,
          offset,
          includeSystemMessages: include_system,
        });
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              session_id,
              message_count: messages.length,
              messages,
            }, null, 2),
          }],
        };
      } catch (error) {
        return {
          content: [{
            type: "text" as const,
            text: `Error retrieving transcript: ${error instanceof Error ? error.message : String(error)}`,
          }],
          isError: true,
        };
      }
    });
  }
}
