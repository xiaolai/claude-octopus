import type { Options } from "@anthropic-ai/claude-agent-sdk";

export interface InvocationOverrides {
  cwd?: string;
  model?: string;
  tools?: string[];
  disallowedTools?: string[];
  additionalDirs?: string[];
  plugins?: string[];
  effort?: string;
  permissionMode?: string;
  maxTurns?: number;
  maxBudgetUsd?: number;
  systemPrompt?: string;
  resumeSessionId?: string;
  runId?: string;
}

export interface TimelineConfig {
  dir: string;
}

export interface OctopusConfig {
  sdkOptions: Options;
  timeline: TimelineConfig;
}

export interface OptionCatalogEntry {
  key: string;
  envVar: string;
  label: string;
  hint: string;
  example: string;
}

export type { Options };
