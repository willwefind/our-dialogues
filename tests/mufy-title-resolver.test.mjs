import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadResolver() {
  const runtime = { console, Date };
  runtime.window = runtime;
  vm.createContext(runtime);
  vm.runInContext(
    await readFile(path.join(repositoryRoot, "src/core/mufy-title-resolver.js"), "utf8"),
    runtime,
    { filename: "src/core/mufy-title-resolver.js" }
  );
  return runtime.OD.mufyTitleResolver;
}

const message = (role, content, extra = {}) => ({
  id: `${role}-${Math.random()}`,
  role,
  content: Array.isArray(content) ? content : [{ type: "text", text: content }],
  metadata: { originalRole: role, ...(extra.metadata || {}) },
  ...extra
});

test("Mufy title priority covers remark, exported title, and current marker", async () => {
  const resolver = await loadResolver();
  assert.equal(JSON.stringify(resolver.resolve({ pack: { name: "A" }, session: { title: "Exported", archives: [{ remark: "Archive remark" }] } })),
    JSON.stringify({ title: "Archive remark", titleSource: "remark" }));
  assert.equal(JSON.stringify(resolver.resolve({ pack: { name: "A" }, session: { name: "Explicit session" } })),
    JSON.stringify({ title: "Explicit session", titleSource: "exported" }));
  assert.equal(JSON.stringify(resolver.resolve({ pack: { name: "A" }, session: { isCurrent: true } })),
    JSON.stringify({ title: "A · 当前对话", titleSource: "current" }));
});

test("narrative extraction skips rich status, labels, tools, and empty thinking", async () => {
  const resolver = await loadResolver();
  const result = resolver.resolve({
    session: {},
    messages: [
      message("assistant", [{ type: "source-rich-block", source: "mufy", kind: "hud", text: "时间 22:30 地点 Room" }]),
      message("tool", "tool result"),
      message("assistant", "时间：22:30\n地点：Room"),
      message("assistant", "真正的叙事从这里开始。后面还有内容。", { thinking: [{ type: "text", text: "hidden" }] })
    ]
  });
  assert.equal(JSON.stringify(result), JSON.stringify({ title: "真正的叙事从这里开始。后面还有内容。", titleSource: "assistant-first-line" }));
});

test("only-user dialogue derives a readable title and empty sessions fall back", async () => {
  const resolver = await loadResolver();
  assert.equal(JSON.stringify(resolver.resolve({ messages: [message("user", "请从这一幕继续")], index: 2 })),
    JSON.stringify({ title: "请从这一幕继续", titleSource: "dialogue-derived" }));
  assert.equal(JSON.stringify(resolver.resolve({ session: { createdAt: "2026-08-16T00:00:00Z" }, index: 3 })),
    JSON.stringify({ title: "2026-08-16 · 第 4 段", titleSource: "fallback" }));
  assert.equal(JSON.stringify(resolver.resolve({ session: {}, index: 0 })),
    JSON.stringify({ title: "第 1 段", titleSource: "fallback" }));
});

test("a short assistant acknowledgement derives context from the first user turn", async () => {
  const resolver = await loadResolver();
  const result = resolver.resolve({ messages: [
    message("user", "请打开书房里的旧信"),
    message("assistant", "好。")
  ] });
  assert.equal(JSON.stringify(result), JSON.stringify({
    title: "请打开书房里的旧信 / 好。",
    titleSource: "dialogue-derived"
  }));
});

test("safe truncation preserves emoji code points and never invents a summary", async () => {
  const resolver = await loadResolver();
  const original = `${"叙事".repeat(35)}🫶🏽${"ending".repeat(10)}`;
  const result = resolver.resolve({ messages: [message("assistant", original)] });
  assert.equal(result.titleSource, "assistant-first-line");
  assert.ok(result.title.endsWith("…"));
  assert.equal(result.title.includes("�"), false);
  assert.ok(original.startsWith(result.title.slice(0, -1)));
});

test("duplicate titles are disambiguated for display without mutating titles", async () => {
  const resolver = await loadResolver();
  const conversations = [
    { id: "one", title: "Same", createdAt: "2026-08-15", context: { sourceMetadata: { characterId: "c" } } },
    { id: "two", title: "Same", createdAt: "2026-08-16", context: { sourceMetadata: { characterId: "c" } } },
    { id: "three", title: "Same", createdAt: "2026-08-16", context: { sourceMetadata: { characterId: "c" } } }
  ];
  const labels = resolver.disambiguate(conversations);
  assert.equal(labels.get("one"), "Same · 2026-08-15");
  assert.equal(labels.get("two"), "Same · 2026-08-16");
  assert.equal(labels.get("three"), "Same · 2026-08-16（2）");
  assert.deepEqual(conversations.map(item => item.title), ["Same", "Same", "Same"]);
});
