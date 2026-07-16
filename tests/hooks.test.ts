import assert from "node:assert/strict";
import test from "node:test";
import kontraPi from "../extensions/index.js";

type Handler = (event: Record<string, unknown>, context: Record<string, unknown>) => unknown;

test("registers tool-result and context credential backstops", () => {
  const handlers = new Map<string, Handler[]>();
  const pi = {
    on(name: string, handler: Handler) {
      handlers.set(name, [...(handlers.get(name) ?? []), handler]);
    },
    registerTool() {},
    registerEntryRenderer() {},
    registerCommand() {},
  };
  kontraPi(pi as never);

  const toolResult = handlers.get("tool_result")?.[0]?.({
    content: [{ type: "text", text: "Authorization: Bearer tool-secret" }],
    details: { password: "detail-secret" },
  }, {}) as { content: Array<{ text: string }>; details: { password: string } };
  assert.equal(toolResult.content[0].text.includes("tool-secret"), false);
  assert.equal(toolResult.details.password, "[redacted]");

  const context = handlers.get("context")?.[0]?.({
    messages: [{ role: "user", content: "api_key=context-secret" }],
  }, {}) as { messages: Array<{ content: string }> };
  assert.equal(context.messages[0].content.includes("context-secret"), false);
});
