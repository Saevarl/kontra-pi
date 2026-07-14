export type Operation =
  | "validate"
  | "profile"
  | "check"
  | "explain"
  | "diff"
  | "profile_diff"
  | "compare"
  | "profile_compare"
  | "relationship"
  | "sources"
  | "doctor";

export interface KontraRequest {
  operation: Operation;
  contract?: string;
  source?: string;
  before?: string;
  after?: string;
  left?: string;
  right?: string;
  key?: string | string[];
  beforeKey?: string | string[];
  afterKey?: string | string[];
  on?: string | string[];
  leftOn?: string | string[];
  rightOn?: string | string[];
  preset?: "scout" | "scan" | "interrogate";
  columns?: string[];
  only?: string[];
  since?: string;
  tally?: boolean;
  sample?: number;
  sampleLimit?: number;
  save?: boolean;
}

export function normalizeRequest(request: KontraRequest): KontraRequest {
  if ((request.operation === "compare" || request.operation === "relationship") && request.sampleLimit === undefined) {
    return { ...request, sampleLimit: 0 };
  }
  if (request.operation === "validate" && request.sample === undefined) {
    return { ...request, sample: 0 };
  }
  return request;
}

export interface BridgeResponse {
  ok: boolean;
  operation: Operation;
  summary: string;
  result?: Record<string, unknown> | null;
  error?: { type: string; message: string };
  runtimeMs?: number;
  execution?: string[];
}

export interface GateConfig {
  enabled: boolean;
  contracts: string[];
  include: string[];
  afterBash: boolean;
  tally: boolean;
  sample: number;
  save: boolean;
  continueOnFailure: boolean;
}

export interface KontraConfig {
  python?: string;
  allowOutsideProject: boolean;
  allowRemoteSources: boolean;
  timeoutMs: number;
  gate: GateConfig;
}

export interface ToolDetails extends BridgeResponse {
  request: KontraRequest;
  python?: string;
}
