#!/usr/bin/env node

/**
 * CLI entry point for non-MCP commands.
 *
 * Usage:
 *   claude-octopus report [run_id] [--out file.html] [--no-transcripts]
 *   claude-octopus report --list
 */

import { writeFile } from "node:fs/promises";
import { buildTimelineConfig } from "./config.js";
import { generateReport } from "./report.js";

function usage(): never {
  console.error(`Usage:
  claude-octopus report [run_id] [--out file.html] [--no-transcripts]
  claude-octopus report --list

Options:
  run_id             Generate detailed report for this run
  --list             List all runs (default when no run_id)
  --out <file>       Write to file instead of stdout
  --no-transcripts   Omit session transcripts from the report
`);
  process.exit(1);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] !== "report") {
    // Not a CLI command — this binary is for "report" only.
    // The MCP server is the default entry point (dist/index.js).
    console.error("Unknown command. Available commands: report");
    console.error("For the MCP server, use: npx claude-octopus (without arguments)");
    process.exit(1);
  }

  // Parse args after "report"
  const reportArgs = args.slice(1);
  let runId: string | undefined;
  let outFile: string | undefined;
  let includeTranscripts = true;

  for (let i = 0; i < reportArgs.length; i++) {
    const arg = reportArgs[i];
    if (arg === "--out" || arg === "-o") {
      outFile = reportArgs[++i];
      if (!outFile) usage();
    } else if (arg === "--no-transcripts") {
      includeTranscripts = false;
    } else if (arg === "--list") {
      runId = undefined;
    } else if (arg === "--help" || arg === "-h") {
      usage();
    } else if (!arg.startsWith("-")) {
      runId = arg;
    } else {
      console.error(`Unknown option: ${arg}`);
      usage();
    }
  }

  const timeline = buildTimelineConfig();

  const html = await generateReport({
    timelineDir: timeline.dir,
    runId,
    includeTranscripts,
  });

  if (outFile) {
    await writeFile(outFile, html, "utf-8");
    console.error(`Report written to ${outFile}`);
  } else {
    process.stdout.write(html);
  }
}

main().catch((error) => {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
