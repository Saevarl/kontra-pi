const URI_USERINFO = /([a-z][a-z0-9+.-]*:\/\/)([^/@\s]+)@/gi;
const AUTHORIZATION = /\b((?:proxy-)?authorization\s*:\s*)(?:bearer|basic|digest)\s+[^\s,;]+/gi;
const SECRET_HEADER = /\b((?:x-api-key|api-key|x-auth-token|set-cookie|cookie)\s*:\s*)[^\r\n]+/gi;
const SECRET_ASSIGNMENT = /\b(password|passwd|pwd|secret|client[_-]?secret|token|access[_-]?token|refresh[_-]?token|id[_-]?token|session[_-]?token|api[_-]?key|access[_-]?key|secret[_-]?access[_-]?key|account[_-]?key|private[_-]?key|credential|connection[_-]?string|sig|signature|sas)(\s*[=:]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;&]+)/gi;
const SECRET_QUERY = /([?&](?:sig|signature|token|access_token|refresh_token|id_token|sas|password|pass|secret|key|credential|x-amz-signature|x-amz-credential)=)[^&\s'";]+/gi;
const PRIVATE_KEY = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g;
const AWS_ACCESS_KEY = /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g;
const PROVIDER_TOKEN = /\b(?:gh[opusr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|sk-(?:proj-)?[A-Za-z0-9_-]{20,})\b/g;
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
const SENSITIVE_ENV = /(?:^|_)(?:PASSWORD|PASSWD|PWD|SECRET|TOKEN|API_KEY|ACCESS_KEY|PRIVATE_KEY|CREDENTIAL)(?:$|_)/i;

function environmentSecrets(env: NodeJS.ProcessEnv = process.env): string[] {
  return [...new Set(Object.entries(env)
    .filter(([name, value]) => !["PWD", "OLDPWD"].includes(name) && SENSITIVE_ENV.test(name) && typeof value === "string" && value.length >= 4)
    .map(([, value]) => value as string))]
    .sort((left, right) => right.length - left.length);
}

export function redact(value: string, exactSecrets: readonly string[] = environmentSecrets()): string {
  let output = value
    .replace(PRIVATE_KEY, "[redacted private key]")
    .replace(URI_USERINFO, (_match, scheme: string, userinfo: string) => {
      const separator = userinfo.indexOf(":");
      return separator < 0 ? `${scheme}***@` : `${scheme}${userinfo.slice(0, separator)}:***@`;
    })
    .replace(AUTHORIZATION, "$1[redacted]")
    .replace(SECRET_HEADER, "$1[redacted]")
    .replace(SECRET_QUERY, "$1[redacted]")
    .replace(SECRET_ASSIGNMENT, "$1$2[redacted]")
    .replace(AWS_ACCESS_KEY, "[redacted access key]")
    .replace(PROVIDER_TOKEN, "[redacted token]")
    .replace(JWT, "[redacted token]");
  for (const secret of exactSecrets) output = output.replaceAll(secret, "[redacted]");
  return output;
}

function sensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replaceAll(/[^a-z0-9]+/g, "_").replaceAll(/^_|_$/g, "");
  return /^(?:password|passwd|pwd|secret|client_secret|token|access_token|refresh_token|id_token|session_token|api_key|access_key|access_key_id|secret_access_key|account_key|private_key|authorization|proxy_authorization|credential|credentials|connection_string|sig|signature|sas|cookie|set_cookie)$/.test(normalized);
}

export function sanitize<T>(value: T, exactSecrets: readonly string[] = environmentSecrets()): T {
  const seen = new WeakMap<object, unknown>();
  const visit = (current: unknown, key?: string, depth = 0): unknown => {
    if (key && sensitiveKey(key) && current !== null && current !== undefined) return "[redacted]";
    if (typeof current === "string") return redact(current, exactSecrets);
    if (current === null || typeof current !== "object" || depth >= 30) return current;
    const cached = seen.get(current);
    if (cached) return cached;
    if (Array.isArray(current)) {
      const copy: unknown[] = [];
      seen.set(current, copy);
      for (const item of current) copy.push(visit(item, undefined, depth + 1));
      return copy;
    }
    const prototype = Object.getPrototypeOf(current);
    if (prototype !== Object.prototype && prototype !== null) return current;
    const copy: Record<string, unknown> = {};
    seen.set(current, copy);
    for (const [childKey, child] of Object.entries(current)) {
      copy[childKey] = visit(child, childKey, depth + 1);
    }
    return copy;
  };
  return visit(value) as T;
}

export function configuredEnvironmentSecrets(env: NodeJS.ProcessEnv = process.env): string[] {
  return environmentSecrets(env);
}
