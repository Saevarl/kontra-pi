import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, isAbsolute, resolve } from "node:path";
import type { BridgeResponse, KontraConfig, KontraRequest } from "./types.js";
import { redact, sanitize } from "./redact.js";

export { redact } from "./redact.js";

const BRIDGE = resolve(dirname(fileURLToPath(import.meta.url)), "../bridge/bridge.py");
export const MAX_OUTPUT = 2 * 1024 * 1024;
const KILL_GRACE_MS = 1_000;
const pythonCache = new Map<string, string>();

function executable(cwd: string, value: string): string {
  if (value.includes("/") && !isAbsolute(value)) return resolve(cwd, value);
  return value;
}

function candidates(cwd: string, config: KontraConfig): string[] {
  const values = [
    config.python,
    process.env.KONTRA_PYTHON,
    process.env.VIRTUAL_ENV ? resolve(process.env.VIRTUAL_ENV, "bin/python") : undefined,
    resolve(cwd, ".venv/bin/python"),
    resolve(cwd, "venv/bin/python"),
    "python3",
    "python",
  ].filter((value): value is string => Boolean(value));
  return [...new Set(values.map((value) => executable(cwd, value)))];
}

interface ProcessResult { code: number | null; stdout: string; stderr: string }

type StopReason = "timeout" | "cancelled" | "output-limit";

function duration(timeoutMs: number): string {
  return timeoutMs % 1_000 === 0 ? `${timeoutMs / 1_000}s` : `${timeoutMs}ms`;
}

function stopMessage(reason: StopReason, timeoutMs: number): string {
  if (reason === "timeout") return `Kontra timed out after ${duration(timeoutMs)}.`;
  if (reason === "cancelled") return "Kontra was cancelled.";
  return `Kontra stopped because bridge output exceeded ${MAX_OUTPUT / (1024 * 1024)} MiB.`;
}

export function runProcess(command: string, args: string[], input: string, cwd: string, timeoutMs: number, signal?: AbortSignal): Promise<ProcessResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, stdio: ["pipe", "pipe", "pipe"], shell: false });
    let stdout = "";
    let stderr = "";
    let outputBytes = 0;
    let done = false;
    let stopReason: StopReason | undefined;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = (callback: () => void) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      signal?.removeEventListener("abort", abort);
      callback();
    };
    const stop = (reason: StopReason) => {
      if (stopReason) return;
      stopReason = reason;
      child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), KILL_GRACE_MS);
    };
    const abort = () => stop("cancelled");
    const timer = setTimeout(() => stop("timeout"), timeoutMs);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    child.on("error", (error) => finish(() => reject(error)));
    child.stdout.on("data", (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > MAX_OUTPUT) {
        stop("output-limit");
        return;
      }
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > MAX_OUTPUT) {
        stop("output-limit");
        return;
      }
      stderr += chunk.toString();
    });
    child.on("close", (code) => finish(() => {
      if (stopReason) reject(new Error(stopMessage(stopReason, timeoutMs)));
      else resolvePromise({ code, stdout, stderr });
    }));
    child.stdin.on("error", () => { /* Process may stop before consuming input. */ });
    child.stdin.end(input);
  });
}

export async function resolvePython(cwd: string, config: KontraConfig, signal?: AbortSignal): Promise<string> {
  const available = candidates(cwd, config);
  const cacheKey = `${cwd}\0${available.join("\0")}`;
  const cached = pythonCache.get(cacheKey);
  if (cached) return cached;
  for (const candidate of available) {
    try {
      if (candidate.includes("/")) await access(candidate);
      const result = await runProcess(candidate, ["-c", "import kontra"], "", cwd, 10_000, signal);
      if (result.code === 0) {
        pythonCache.set(cacheKey, candidate);
        return candidate;
      }
    } catch (error) {
      if (signal?.aborted) throw error;
    }
  }
  throw new Error("Kontra is not importable. Activate its Python environment, set KONTRA_PYTHON, or set python in .pi/kontra.json.");
}

export async function runKontra(cwd: string, request: KontraRequest, config: KontraConfig, signal?: AbortSignal): Promise<BridgeResponse & { python: string }> {
  const python = await resolvePython(cwd, config, signal);
  const processResult = await runProcess(python, [BRIDGE], JSON.stringify(request), cwd, config.timeoutMs, signal);
  let response: BridgeResponse;
  try {
    response = JSON.parse(processResult.stdout) as BridgeResponse;
  } catch {
    const detail = redact(processResult.stderr || processResult.stdout || `bridge exited ${processResult.code}`).slice(0, 4000);
    throw new Error(`Kontra bridge returned no valid result: ${detail}`);
  }
  response = sanitize(response);
  if (!response.ok) throw new Error(`${response.error?.type ?? "KontraError"}: ${redact(response.summary).slice(0, 4000)}`);
  return { ...response, python };
}
