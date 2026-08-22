import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadCore() {
  const runtime = { console };
  runtime.window = runtime;
  vm.createContext(runtime);
  vm.runInContext(
    await readFile(path.join(repositoryRoot, "src/core/reader-parity.js"), "utf8"),
    runtime,
    { filename: "src/core/reader-parity.js" }
  );
  return runtime.OD.readerParity;
}

const message = (id, length, role = "assistant") => ({
  id,
  role,
  content: [{ type: "text", text: "x".repeat(length) }]
});

test("pagination uses visible character volume rather than message count", async () => {
  const core = await loadCore();
  const pages = core.paginateMessages([
    message("a", 1400), message("b", 1200), message("c", 100), message("d", 2400)
  ], { mode: "page", pageLength: "short" });
  assert.equal(JSON.stringify(pages.map(page => page.map(item => item.id))), JSON.stringify([["a", "b"], ["c", "d"]]));
  assert.equal(core.PAGE_CHARS.short, 2500);
  assert.equal(core.PAGE_CHARS.mid, 5000);
  assert.equal(core.PAGE_CHARS.long, 9000);
});

test("scroll mode stays one page and hidden user messages do not affect page boundaries", async () => {
  const core = await loadCore();
  const messages = [message("user", 4000, "user"), message("assistant", 3000), message("end", 2500)];
  assert.equal(core.paginateMessages(messages, { mode: "scroll" }).length, 1);
  const pages = core.paginateMessages(messages, { mode: "page", pageLength: "mid", hideUser: true });
  assert.equal(JSON.stringify(pages.map(page => page.map(item => item.id))), JSON.stringify([["assistant", "end"]]));
});

test("reader preferences normalize persisted values conservatively", async () => {
  const core = await loadCore();
  assert.equal(JSON.stringify(core.normalizePreferences({
    fontSize: 99,
    lineHeight: 1.2,
    contentWidth: 10,
    fontFamily: "unknown",
    theme: "bad",
    readingMode: "page",
    pageLength: "long"
  })), JSON.stringify({
    fontSize: 30,
    lineHeight: 1.5,
    contentWidth: 560,
    fontFamily: "serif",
    theme: "paper",
    readingMode: "page",
    pageLength: "long",
    printPreset: null
  }));
});

test("printPreset is a backward-compatible nullable presentation alias", async () => {
  const core = await loadCore();
  // Old records that never saw printPreset normalize cleanly and keep their
  // stored fontFamily authoritative.
  const legacy = core.normalizePreferences({ fontFamily: "huiwen", fontSize: 20 });
  assert.equal(legacy.printPreset, null);
  assert.equal(legacy.fontFamily, "huiwen");
  assert.equal(legacy.fontSize, 20);
  // Choosing a preset never rewrites fontFamily; clearing it falls back.
  const chosen = core.normalizePreferences({ fontFamily: "huiwen", printPreset: "correspondence" });
  assert.equal(chosen.printPreset, "correspondence");
  assert.equal(chosen.fontFamily, "huiwen");
  // Unknown preset keys collapse to null instead of breaking normalization.
  assert.equal(core.normalizePreferences({ printPreset: "neon" }).printPreset, null);
  // Typescript exists but is never the default.
  assert.equal(core.DEFAULTS.printPreset, null);
  assert.ok(Object.keys(core.PRINT_PRESETS).includes("typescript"));
});

test("print presets pair CJK and Latin faces and stay in lockstep with the menu", async () => {
  const { readFile } = await import("node:fs/promises");
  const path = await import("node:path");
  const html = await readFile(path.join(repositoryRoot, "index.html"), "utf8");
  const select = html.match(/<select id="printPreset"[\s\S]*?<\/select>/)[0];
  const optionValues = [...select.matchAll(/<option value="([^"]*)"/g)].map(match => match[1]);
  const core = await loadCore();
  const knownKeys = Object.keys(core.PRINT_PRESETS);

  assert.ok(optionValues.includes(""), "the menu offers a way back to plain fontFamily");
  for (const value of optionValues.filter(Boolean)) {
    assert.ok(knownKeys.includes(value), `option "${value}" must exist in PRINT_PRESETS`);
  }
  for (const key of knownKeys) {
    assert.ok(optionValues.includes(key), `preset "${key}" must be offered in the menu`);
    const preset = core.PRINT_PRESETS[key];
    assert.match(preset.family, /^"OD /, `"${key}" leads with its composite family`);
    assert.match(preset.family, /,serif\s*$/i, `"${key}" stack must end in a generic fallback`);
    assert.ok(preset.fontSize >= 14 && preset.fontSize <= 30, `"${key}" suggested size stays in the normalized range`);
    assert.ok(preset.lineHeight >= 1.5 && preset.lineHeight <= 2.5, `"${key}" suggested leading stays in the normalized range`);
  }
});

test("message anchors select the containing page and page values clamp", async () => {
  const core = await loadCore();
  const pages = core.paginateMessages([message("a", 3000), message("b", 3000)], { mode: "page", pageLength: "short" });
  assert.equal(core.pageForMessage(pages, "b"), 1);
  assert.equal(core.pageForMessage(pages, "missing"), -1);
  assert.equal(core.clampPage(90, pages), 1);
  assert.equal(core.clampPage(-2, pages), 0);
});

test("every fontFamily option in the Reader HTML has a defined font stack, and bundled faces keep fallbacks", async () => {
  const { readFile } = await import("node:fs/promises");
  const path = await import("node:path");
  const html = await readFile(path.join(repositoryRoot, "index.html"), "utf8");
  const select = html.match(/<select id="fontFamily"[\s\S]*?<\/select>/)[0];
  const optionValues = [...select.matchAll(/<option value="([^"]+)"/g)].map(match => match[1]);
  const parity = await loadCore();
  const knownKeys = Object.keys(parity.FONT_FAMILIES);

  assert.ok(optionValues.length >= 10, "the font menu offers a real selection");
  for (const value of optionValues) {
    assert.ok(knownKeys.includes(value), `option "${value}" must exist in FONT_FAMILIES`);
  }
  for (const [key, stack] of Object.entries(parity.FONT_FAMILIES)) {
    assert.match(stack, /,(?:.*serif|.*sans-serif)\s*$/i, `"${key}" stack must end in a generic fallback`);
  }
  assert.equal(parity.normalizePreferences({ fontFamily: "huiwen" }).fontFamily, "huiwen");
  assert.equal(parity.normalizePreferences({ fontFamily: "not-a-font" }).fontFamily, "serif", "unknown keys fall back to the default");
});
