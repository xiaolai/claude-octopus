/**
 * CLI report command.
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

Options:
  run_id             Generate detailed report for this run
  (no run_id)        List all runs (default)
  --out <file>       Write to file instead of stdout
  --no-transcripts   Omit session transcripts from the report
  --help             Show this help
`);
  process.exit(1);
}

export function runReportCli(args: string[]): void {
  let runId: string | undefined;
  let outFile: string | undefined;
  let includeTranscripts = true;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--out" || arg === "-o") {
      outFile = args[++i];
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

  generateReport({
    timelineDir: timeline.dir,
    runId,
    includeTranscripts,
  })
    .then((html) => {
      if (outFile) {
        return writeFile(outFile, html, "utf-8").then(() => {
          console.error(`Report written to ${outFile}`);
        });
      }
      process.stdout.write(html);
    })
    .catch((error) => {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    });
}
