/**
 * Pure, testable logic extracted from index.ts.
 */

import { normalize, resolve, sep } from "node:path";

// ── Env helpers ────────────────────────────────────────────────────

export function envStr(
  key: string,
  env: Record<string, string | undefined> = process.env
): string | undefined {
  return env[key] || undefined;
}

export function envList(
  key: string,
  env: Record<string, string | undefined> = process.env
): string[] | undefined {
  const val = env[key];
  if (!val) return undefined;
  if (val.startsWith("[")) {
    try {
      const parsed = JSON.parse(val);
      if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
    } catch {
      // fall through to comma-split
    }
  }
  return val
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function envNum(
  key: string,
  env: Record<string, string | undefined> = process.env
): number | undefined {
  const val = env[key];
  if (!val) return undefined;
  const n = Number(val);
  return Number.isNaN(n) ? undefined : n;
}

export function envBool(
  key: string,
  fallback: boolean,
  env: Record<string, string | undefined> = process.env
): boolean {
  const val = env[key];
  if (val === undefined) return fallback;
  return val === "true" || val === "1";
}

export function envJson<T>(
  key: string,
  env: Record<string, string | undefined> = process.env
): T | undefined {
  const val = env[key];
  if (!val) return undefined;
  try {
    return JSON.parse(val) as T;
  } catch {
    return undefined;
  }
}

// ── Tool name sanitization ─────────────────────────────────────────

export const MAX_TOOL_NAME_LEN = 64 - "_transcript".length;

export function sanitizeToolName(raw: string): string {
  const sanitized = raw
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .slice(0, MAX_TOOL_NAME_LEN);
  return sanitized || "claude_code";
}

// ── cwd security check ────────────────────────────────────────────

export function isDescendantPath(
  requested: string,
  baseCwd: string
): boolean {
  const normalBase = normalize(baseCwd);
  const normalReq = normalize(resolve(normalBase, requested));
  if (normalReq === normalBase) return true;
  const baseWithSep = normalBase.endsWith(sep)
    ? normalBase
    : normalBase + sep;
  return normalReq.startsWith(baseWithSep);
}

// ── Tool restriction merging ───────────────────────────────────────

export function mergeTools(
  serverList: string[] | undefined,
  callList: string[]
): string[] {
  if (serverList?.length) {
    const serverSet = new Set(serverList);
    return callList.filter((t) => serverSet.has(t));
  }
  return callList;
}

export function mergeDisallowedTools(
  serverList: string[] | undefined,
  callList: string[]
): string[] {
  const merged = new Set([...(serverList || []), ...callList]);
  return [...merged];
}

// ── Permission mode validation ─────────────────────────────────────

export const VALID_PERM_MODES = new Set([
  "default",
  "acceptEdits",
  "bypassPermissions",
  "plan",
  "dontAsk",
]);

export function validatePermissionMode(mode: string): string {
  return VALID_PERM_MODES.has(mode) ? mode : "default";
}

// Strictness order: most permissive → most restrictive
const PERM_STRICTNESS: Record<string, number> = {
  bypassPermissions: 0,
  acceptEdits: 1,
  default: 2,
  dontAsk: 3,
  plan: 4,
};

/**
 * Narrow permission mode: returns the stricter of base and override.
 * Callers can tighten permissions but never loosen them.
 * Returns base unchanged if override is invalid or less strict.
 */
export function narrowPermissionMode(base: string, override: string): string {
  if (!VALID_PERM_MODES.has(override)) return base;
  const baseLevel = PERM_STRICTNESS[base] ?? 2;
  const overrideLevel = PERM_STRICTNESS[override] ?? 2;
  return overrideLevel >= baseLevel ? override : base;
}

// ── Factory name derivation ────────────────────────────────────────

export function deriveServerName(description: string): string {
  const slug = description
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 30);
  return slug || `agent-${Date.now()}`;
}

export function deriveToolName(name: string): string {
  const slug = name
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, MAX_TOOL_NAME_LEN);
  return slug || "agent";
}

// ── Factory env serialization ──────────────────────────────────────

export function serializeArrayEnv(val: unknown[]): string {
  const hasComma = val.some((v) => String(v).includes(","));
  return hasComma ? JSON.stringify(val) : val.join(",");
}

// ── Shared formatters ─────────────────────────────────────────────

export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function formatCost(usd: number): string {
  return `$${usd.toFixed(4)}`;
}

export function formatDuration(t0: string, t1: string): string {
  const ms = new Date(t1).getTime() - new Date(t0).getTime();
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

export function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
