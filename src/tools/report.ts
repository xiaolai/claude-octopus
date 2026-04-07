import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v4";
import type { TimelineConfig } from "../types.js";
import { generateReport } from "../report.js";

export function registerReportTool(
  server: McpServer,
  toolName: string,
  timelineConfig: TimelineConfig,
  persistSession: boolean,
) {
  server.registerTool(`${toolName}_report`, {
    description: [
      "Generate a self-contained HTML report of a workflow run.",
      "No args: list all runs. run_id: detailed report for that run",
      "with agent sequence, cost breakdown, and collapsible transcripts.",
      "Save the returned HTML to a file and open in a browser.",
    ].join(" "),
    inputSchema: z.object({
      run_id: z.string().optional().describe("Generate detailed report for this run. Omit to list all runs."),
      include_transcripts: z.boolean().optional().describe("Include full session transcripts in run reports (default: true, requires session persistence)"),
    }),
  }, async ({ run_id, include_transcripts }) => {
    try {
      const html = await generateReport({
        timelineDir: timelineConfig.dir,
        runId: run_id,
        includeTranscripts: persistSession && (include_transcripts !== false),
      });
      return {
        content: [{
          type: "text" as const,
          text: html,
        }],
      };
    } catch (error) {
      return {
        content: [{
          type: "text" as const,
          text: `Error generating report: ${error instanceof Error ? error.message : String(error)}`,
        }],
        isError: true,
      };
    }
  });
}
