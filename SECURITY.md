# Security

## Trust model

Pi packages execute with the permissions of the Pi process. `kontra-pi` is not
a sandbox and cannot hide environment variables or files from an unrestricted
agent. Use container or VM isolation when the data or credentials require a
strong boundary.

Within that trust model, the extension narrows its own surface:

- project trust is checked before commands and tool execution;
- path-like inputs stay inside the project by default;
- raw remote URIs are disabled by default;
- named Kontra datasources keep credentials out of tool arguments;
- child processes use argument arrays and `shell: false`;
- samples default to zero;
- output is capped at 2 MiB;
- timeouts and cancellation terminate the child process;
- Kontra responses are recursively redacted, including successful summaries and
  structured results;
- Pi tool-result and final-context hooks scrub common credential forms and exact
  values from credential-named environment variables before model calls;
- no arbitrary Python, SQL, or inline rules are accepted.

The completion gate is disabled by default and never weakens contracts or
creates an unbounded retry loop.

Redaction covers URI userinfo, secret query parameters, authorization and API-key
headers, common key/value forms, private keys, several provider token formats,
JWTs, sensitive structured fields, and exact environment credential values. It
is defense in depth, not a substitute for isolation: unknown credential formats
or secrets already transformed by another process may not be recognizable.

## Reporting a vulnerability

Please use GitHub's private security advisory flow for
`Saevarl/kontra-pi`. Include the affected version, reproduction steps, and the
expected boundary. Do not open a public issue for an unpatched credential or
code-execution vulnerability.
