import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { isAbsolute, relative } from "node:path";
import { assertRequestAllowed, globMatches, loadConfig } from "./config.js";
import { ActivityStatus } from "./activity.js";
import { runKontra } from "./bridge.js";
import { configuredEnvironmentSecrets, sanitize } from "./redact.js";
import { KONTRA_COMMANDS, parseKontraCommand } from "./commands.js";
import { activityLabel, gateOutcomeLines, renderCall, renderResult, statusSummary } from "./render.js";
import { normalizeRequest, type BridgeResponse, type KontraRequest, type ToolDetails } from "./types.js";

const Key = Type.Union([Type.String(), Type.Array(Type.String(), { minItems: 1 })]);
const Parameters = Type.Object({
  operation: Type.Union([
    Type.Literal("validate"), Type.Literal("profile"), Type.Literal("check"),
    Type.Literal("explain"), Type.Literal("diff"), Type.Literal("profile_diff"),
    Type.Literal("compare"), Type.Literal("profile_compare"),
    Type.Literal("relationship"), Type.Literal("rules"),
    Type.Literal("sources"), Type.Literal("doctor"),
  ], { description: "Measurement or inspection to run" }),
  rule: Type.Optional(Type.String({ description: "Built-in rule name for an exact rules lookup; omit for the compact index" })),
  contract: Type.Optional(Type.String({ description: "Contract path for validate, check, explain, or diff" })),
  source: Type.Optional(Type.String({ description: "File, URI, or named datasource" })),
  before: Type.Optional(Type.String()),
  after: Type.Optional(Type.String()),
  left: Type.Optional(Type.String()),
  right: Type.Optional(Type.String()),
  key: Type.Optional(Key),
  beforeKey: Type.Optional(Key),
  afterKey: Type.Optional(Key),
  on: Type.Optional(Key),
  leftOn: Type.Optional(Key),
  rightOn: Type.Optional(Key),
  preset: Type.Optional(Type.Union([Type.Literal("scout"), Type.Literal("scan"), Type.Literal("interrogate")])),
  columns: Type.Optional(Type.Array(Type.String())),
  only: Type.Optional(Type.Array(Type.String(), { description: "Rule names or IDs to validate/explain" })),
  since: Type.Optional(Type.String({ description: "History window such as 7d or 24h" })),
  tally: Type.Optional(Type.Boolean({ description: "Exact violation counts; slower than fail-fast" })),
  sample: Type.Optional(Type.Integer({ minimum: 0, maximum: 20 })),
  sampleLimit: Type.Optional(Type.Integer({ minimum: 0, maximum: 20 })),
  save: Type.Optional(Type.Boolean()),
});

function validateShape(request: KontraRequest): void {
  const required: Record<KontraRequest["operation"], Array<keyof KontraRequest>> = {
    validate: ["contract"], profile: ["source"], check: ["contract"],
    explain: ["contract"], diff: ["contract"], profile_diff: ["source"],
    compare: ["before", "after"], profile_compare: ["before", "after"],
    relationship: ["left", "right"], rules: [], sources: [], doctor: [],
  };
  const missing = required[request.operation].filter((key) => !request[key]);
  if (missing.length) throw new Error(`${request.operation} requires ${missing.join(", ")}`);
  if (request.operation === "compare" && !request.key && !(request.beforeKey && request.afterKey)) {
    throw new Error("compare requires key or beforeKey + afterKey");
  }
  if (request.operation === "relationship" && !request.on && !(request.leftOn && request.rightOn)) {
    throw new Error("relationship requires on or leftOn + rightOn");
  }
  if ((request.operation === "validate" || request.operation === "explain") && request.only && request.columns) {
    throw new Error(`${request.operation} accepts either only or columns, not both`);
  }
}

function resultPassed(response: BridgeResponse): boolean {
  return response.result?.passed !== false;
}

interface GateResult {
  contract: string;
  passed: boolean;
  summary: string;
  runtimeMs?: number;
}

interface GateEntry {
  passed: boolean;
  results: GateResult[];
  files: string[];
  timestamp: number;
}

export default function kontraPi(pi: ExtensionAPI) {
  const calls = new Map<string, { tool: string; path?: string }>();
  const changed = new Set<string>();
  const activityStatus = new ActivityStatus();
  let gateRunning = false;

  // Tool results are persisted in the transcript. Scrub them at creation, then
  // scrub the assembled context again to cover older entries and other paths.
  pi.on("tool_result", (event) => {
    const credentialValues = configuredEnvironmentSecrets();
    return {
      content: sanitize(event.content, credentialValues),
      details: sanitize(event.details, credentialValues),
    };
  });
  pi.on("context", (event) => {
    const credentialValues = configuredEnvironmentSecrets();
    return { messages: sanitize(event.messages, credentialValues) };
  });

  async function execute(request: KontraRequest, ctx: ExtensionContext, signal?: AbortSignal): Promise<ToolDetails> {
    if (!ctx.isProjectTrusted()) throw new Error("Kontra requires a trusted Pi project");
    const normalized = normalizeRequest(request);
    validateShape(normalized);
    const config = await loadConfig(ctx.cwd);
    assertRequestAllowed(ctx.cwd, normalized, config);
    const finishActivity = activityStatus.begin(activityLabel(normalized), ctx.ui);
    try {
      const response = await runKontra(ctx.cwd, normalized, config, signal);
      return { ...response, request: normalized };
    } finally {
      finishActivity();
    }
  }

  async function runGate(ctx: ExtensionContext, manual = false): Promise<GateEntry | undefined> {
    if (gateRunning) return undefined;
    if (!ctx.isProjectTrusted()) {
      if (manual) ctx.ui.notify("Kontra gate requires a trusted project", "error");
      return undefined;
    }
    const config = await loadConfig(ctx.cwd);
    if (!manual && !config.gate.enabled) return undefined;
    if (!config.gate.contracts.length) {
      if (manual) ctx.ui.notify("No gate.contracts in .pi/kontra.json", "warning");
      return undefined;
    }
    if (!manual && !changed.size) return undefined;

    gateRunning = true;
    const files = [...changed];
    changed.clear();
    ctx.ui.setStatus("kontra", "kontra …");
    try {
      const results: GateResult[] = [];
      for (const contract of config.gate.contracts) {
        const request: KontraRequest = {
          operation: "validate", contract, tally: config.gate.tally,
          sample: config.gate.sample, save: config.gate.save,
        };
        assertRequestAllowed(ctx.cwd, request, config);
        const response = await runKontra(ctx.cwd, request, config, ctx.signal);
        results.push({
          contract,
          passed: resultPassed(response),
          summary: response.summary,
          runtimeMs: response.runtimeMs,
        });
      }
      const passed = results.every((result) => result.passed);
      const entry: GateEntry = {
        passed,
        results,
        files,
        timestamp: Date.now(),
      };
      pi.appendEntry("kontra-gate", entry);
      ctx.ui.setStatus("kontra", passed ? `kontra ✓ ${results.length}` : `kontra ✗ ${results.length}`);
      const gateLines = gateOutcomeLines(results);
      ctx.ui.notify(
        `${passed ? "Kontra gate passed" : "Kontra gate failed"}\n\n${gateLines.join("\n")}`,
        passed ? "info" : "error",
      );
      if (!passed && !manual && config.gate.continueOnFailure) {
        pi.sendMessage({
          customType: "kontra-gate-result",
          content: `Kontra completion gate failed after your changes. Treat this as measurement, do not weaken the contract.\n\n${entry.results.map((result) => `${result.contract}\n${result.summary}`).join("\n\n")}`,
          display: true,
          details: entry,
        }, { triggerTurn: true, deliverAs: "followUp" });
      }
      return entry;
    } finally {
      gateRunning = false;
    }
  }

  pi.registerTool({
    name: "kontra",
    label: "Kontra",
    description: "Run one bounded Kontra measurement or inspection: discover exact built-in rule semantics and sources, check or explain a contract, validate or profile data, inspect saved drift, compare transformation stages, or profile a join relationship. Uses the project's Python environment. Probes measure effects; they do not judge correctness.",
    promptSnippet: "Measure data quality and transformation effects with Kontra",
    promptGuidelines: [
      "Use kontra before and after data transformations when row/key behavior is uncertain.",
      "Never modify or weaken a contract merely to make a failed kontra measurement pass.",
      "Before drafting an unfamiliar contract rule, inspect it with operation rules and its rule name; never invent thresholds or business policy.",
      "With kontra, prefer sample 0; request bounded samples only when counts are insufficient to explain a failure.",
    ],
    parameters: Parameters,
    executionMode: "parallel",
    async execute(_id, request, signal, _update, ctx) {
      const details = await execute(request as KontraRequest, ctx, signal);
      return { content: [{ type: "text", text: details.summary }], details };
    },
    renderCall: (request, theme) => renderCall(request as KontraRequest, theme),
    renderResult: (result, options, theme) => renderResult(result.details as ToolDetails | undefined, options.expanded, options.isPartial, theme),
  });

  pi.registerEntryRenderer<GateEntry>("kontra-gate", (entry, { expanded }, theme) => {
    const data = entry.data;
    if (!data) return undefined;
    let text = data.passed ? theme.fg("success", "kontra ✓") : theme.fg("error", "kontra ✗");
    text += theme.fg("muted", `  ${data.results.length} contract${data.results.length === 1 ? "" : "s"}`);
    if (expanded) {
      text += `\n${data.results.map((result) => {
        const mark = theme.fg(result.passed ? "success" : "error", result.passed ? "✓" : "✗");
        const runtime = result.runtimeMs === undefined ? "" : theme.fg("muted", `  ${result.runtimeMs}ms`);
        return `${mark} ${result.contract}${runtime}\n${theme.fg("dim", result.summary)}`;
      }).join("\n\n")}`;
    }
    return new Text(text, 0, 0);
  });

  pi.registerCommand("kontra", {
    description: "Show Kontra status, rules, sources, diagnostics, or run the completion gate",
    getArgumentCompletions: (prefix) => KONTRA_COMMANDS
      .filter((value) => value.startsWith(prefix))
      .map((value) => ({ value, label: value })),
    handler: async (args, ctx) => {
      const command = parseKontraCommand(args);
      if (!command) {
        ctx.ui.notify(`Unknown /kontra command: ${args.trim()}. Try /kontra help.`, "error");
        return;
      }
      if (command === "gate") {
        await runGate(ctx, true);
        return;
      }
      if (command === "help") {
        ctx.ui.notify("/kontra status | rules | sources | doctor | gate  •  LLM tool: kontra", "info");
        return;
      }
      if (command === "rules" || command === "sources" || command === "doctor") {
        const details = await execute({ operation: command }, ctx, ctx.signal);
        ctx.ui.notify(details.summary, details.result?.status === "config_not_found" ? "warning" : "info");
        return;
      }
      if (command === "status") {
        const config = await loadConfig(ctx.cwd);
        const details = await execute({ operation: "doctor" }, ctx, ctx.signal);
        ctx.ui.notify(
          statusSummary(details, config.gate.enabled, config.gate.contracts.length),
          details.result?.status === "ok" ? "info" : "warning",
        );
        return;
      }
    },
  });

  pi.on("tool_execution_start", (event) => {
    const path = typeof event.args?.path === "string" ? event.args.path : undefined;
    calls.set(event.toolCallId, { tool: event.toolName, path });
  });
  pi.on("tool_execution_end", async (event, ctx) => {
    const call = calls.get(event.toolCallId);
    calls.delete(event.toolCallId);
    if (!call || event.isError) return;
    const config = await loadConfig(ctx.cwd);
    if (!config.gate.enabled) return;
    if ((call.tool === "edit" || call.tool === "write") && call.path) {
      const path = (isAbsolute(call.path) ? relative(ctx.cwd, call.path) : call.path).replaceAll("\\", "/").replace(/^\.\//, "");
      if (config.gate.include.some((pattern) => globMatches(pattern, path))) changed.add(path);
    } else if (call.tool === "bash" && config.gate.afterBash) {
      changed.add("<bash>");
    }
  });
  pi.on("agent_end", async (_event, ctx) => { await runGate(ctx); });
  pi.on("session_shutdown", () => { calls.clear(); changed.clear(); activityStatus.clear(); });
}
