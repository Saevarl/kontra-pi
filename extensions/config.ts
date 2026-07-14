import { readFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, relative, resolve } from "node:path";
import type { KontraConfig, KontraRequest } from "./types.js";

export const DEFAULT_CONFIG: KontraConfig = {
  allowOutsideProject: false,
  allowRemoteSources: false,
  timeoutMs: 120_000,
  gate: {
    enabled: false,
    contracts: [],
    include: ["**/*"],
    afterBash: false,
    tally: false,
    sample: 0,
    save: true,
    continueOnFailure: false,
  },
};

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function strings(value: unknown, fallback: string[]): string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : fallback;
}

export async function loadConfig(cwd: string): Promise<KontraConfig> {
  let raw: unknown = {};
  try {
    raw = JSON.parse(await readFile(resolve(cwd, ".pi/kontra.json"), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new Error(`Invalid .pi/kontra.json: ${(error as Error).message}`);
    }
  }
  const root = object(raw);
  const gate = object(root.gate);
  const timeout = typeof root.timeoutMs === "number" ? root.timeoutMs : DEFAULT_CONFIG.timeoutMs;
  return {
    python: typeof root.python === "string" ? root.python : undefined,
    allowOutsideProject: root.allowOutsideProject === true,
    allowRemoteSources: root.allowRemoteSources === true,
    timeoutMs: Math.min(Math.max(timeout, 1_000), 600_000),
    gate: {
      enabled: gate.enabled === true,
      contracts: strings(gate.contracts, []),
      include: strings(gate.include, DEFAULT_CONFIG.gate.include),
      afterBash: gate.afterBash === true,
      tally: gate.tally === true,
      sample: Math.min(Math.max(typeof gate.sample === "number" ? gate.sample : 0, 0), 20),
      save: gate.save !== false,
      continueOnFailure: gate.continueOnFailure === true,
    },
  };
}

export function isInside(cwd: string, value: string): boolean {
  const input = value.startsWith("~/") ? resolve(homedir(), value.slice(2)) : resolve(cwd, value);
  const canonical = (path: string) => {
    try {
      return realpathSync.native(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return path;
      throw error;
    }
  };
  const rel = relative(canonical(resolve(cwd)), canonical(input));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

const REMOTE = /^[a-z][a-z0-9+.-]*:\/\//i;
const FILEISH = /^(?:\.{0,2}\/|\/|~\/)|\.(?:csv|parquet|jsonl?|ya?ml)$/i;

export function assertRequestAllowed(cwd: string, request: KontraRequest, config: KontraConfig): void {
  const values: Array<[string, string | undefined, boolean]> = [
    ["contract", request.contract, true],
    ["source", request.source, false],
    ["before", request.before, false],
    ["after", request.after, false],
    ["left", request.left, false],
    ["right", request.right, false],
  ];
  for (const [label, value, alwaysPath] of values) {
    if (!value) continue;
    if (REMOTE.test(value)) {
      if (!config.allowRemoteSources) throw new Error(`${label} uses a remote URI; set allowRemoteSources to true`);
      continue;
    }
    if ((alwaysPath || FILEISH.test(value)) && !config.allowOutsideProject && !isInside(cwd, value)) {
      throw new Error(`${label} resolves outside the project; set allowOutsideProject to true`);
    }
  }
}

export function globMatches(pattern: string, path: string): boolean {
  const normalized = path.replaceAll("\\", "/").replace(/^\.\//, "");
  let source = "";
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    if (char === "*" && pattern[i + 1] === "*") {
      source += pattern[i + 2] === "/" ? "(?:.*/)?" : ".*";
      i += pattern[i + 2] === "/" ? 2 : 1;
    } else if (char === "*") source += "[^/]*";
    else if (char === "?") source += "[^/]";
    else source += char!.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
  }
  return new RegExp(`^${source}$`).test(normalized);
}
