import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadAnnotations() {
  const runtime = { console, Date };
  runtime.window = runtime;
  vm.createContext(runtime);
  const source = await readFile(path.join(repositoryRoot, "src", "core", "annotations.js"), "utf8");
  vm.runInContext(source, runtime, { filename: "src/core/annotations.js" });
  return runtime.OD.annotations;
}

test("create requires conversation, message, and text, and normalizes colors", async () => {
  const annotations = await loadAnnotations();
  assert.equal(annotations.create({ conversationId: "c1", messageId: "m1", selectedText: "   " }), null);
  assert.equal(annotations.create({ conversationId: "c1", selectedText: "字" }), null);

  const created = annotations.create({
    conversationId: "c1",
    messageId: "m1",
    selectedText: "一段划过的话",
    color: "chartreuse",
    note: `  多余空白的注  `
  });
  assert.ok(created.id);
  assert.ok(created.createdAt);
  assert.equal(created.color, "yellow", "unknown colors fall back to the default");
  assert.equal(created.note, "多余空白的注");
  assert.equal(annotations.normalizeColor("green"), "green");
});

test("locate uses stored context to pick between repeated occurrences and never guesses", async () => {
  const annotations = await loadAnnotations();
  const text = "好呀。后面又说了一次：好呀。结尾。";
  const base = { conversationId: "c1", messageId: "m1", selectedText: "好呀" };

  const second = annotations.create({ ...base, contextBefore: "说了一次：", contextAfter: "。结尾" });
  assert.deepEqual({ ...annotations.locate(text, second) }, { start: 11, end: 13 });

  const first = annotations.create({ ...base, contextBefore: "", contextAfter: "。后面" });
  assert.deepEqual({ ...annotations.locate(text, first) }, { start: 0, end: 2 });

  const gone = annotations.create({ ...base, selectedText: "不存在的话" });
  assert.equal(annotations.locate(text, gone), null, "missing text is null, not a nearby guess");
});

test("markupText escapes around marks and positions by raw text, not escaped text", async () => {
  const annotations = await loadAnnotations();
  const text = `A & B <tag> 然后是重点句 <"end">`;
  const highlight = annotations.create({
    conversationId: "c1",
    messageId: "m1",
    selectedText: "重点句",
    color: "green",
    note: "记一笔"
  });

  const html = annotations.markupText(text, [highlight]);
  assert.match(html, /^A &amp; B &lt;tag&gt; 然后是/);
  assert.match(html, /<mark class="annotation hl-green noted" data-annotation-id="[^"]+">重点句<\/mark>/);
  assert.match(html, /&lt;&quot;end&quot;&gt;$/);
  assert.doesNotMatch(html.replace(/<\/?mark[^>]*>/g, ""), /[<>]/, "everything outside marks stays escaped");
});

test("overlapping spans keep the first and drop the loser from rendering only", async () => {
  const annotations = await loadAnnotations();
  const text = "重叠的一段长句子";
  const wide = annotations.create({ conversationId: "c1", messageId: "m1", selectedText: "重叠的一段" });
  const inside = annotations.create({ conversationId: "c1", messageId: "m1", selectedText: "一段长句" });

  const html = annotations.markupText(text, [wide, inside]);
  assert.match(html, /<mark[^>]*>重叠的一段<\/mark>/);
  assert.equal((html.match(/<mark/g) || []).length, 1, "the overlapping later span does not render");
});

test("re-marking the same span updates color but keeps a written note", async () => {
  const annotations = await loadAnnotations();
  const anchor = { conversationId: "c1", messageId: "m1", selectedText: "同一段", contextBefore: "", contextAfter: "" };
  let list = annotations.add([], annotations.create({ ...anchor, color: "yellow" }));
  list = annotations.update(list, list[0].id, { note: "写过的小注" });

  list = annotations.add(list, annotations.create({ ...anchor, color: "pink" }));
  assert.equal(list.length, 1);
  assert.equal(list[0].color, "pink");
  assert.equal(list[0].note, "写过的小注");

  list = annotations.update(list, list[0].id, { color: "blue", note: "" });
  assert.equal(list[0].color, "blue");
  assert.equal(list[0].note, "");

  list = annotations.remove(list, list[0].id);
  assert.equal(list.length, 0);
});

test("forMessage filters by conversation and message identity", async () => {
  const annotations = await loadAnnotations();
  const a = annotations.create({ conversationId: "c1", messageId: "m1", selectedText: "甲" });
  const b = annotations.create({ conversationId: "c1", messageId: "m2", selectedText: "乙" });
  const c = annotations.create({ conversationId: "c2", messageId: "m1", selectedText: "丙" });
  const list = [a, b, c];

  assert.deepEqual([...annotations.forMessage(list, "c1", "m1").map(item => item.selectedText)], ["甲"]);
  assert.deepEqual([...annotations.forMessage(list, "c2", "m1").map(item => item.selectedText)], ["丙"]);
});

test("production highlighter CSS maps stored colors to the approved assets without stretching mother strokes", async () => {
  const css = await readFile(path.join(repositoryRoot, "styles.css"), "utf8");
  // Display aliases preserve stored values: salmon→pink, sage→green, lilac→purple.
  const expected = {
    "hl-yellow": "highlighter-yellow",
    "hl-pink": "highlighter-salmon",
    "hl-green": "highlighter-sage",
    "hl-blue": "highlighter-blue",
    "hl-purple": "highlighter-lilac"
  };
  for (const [storedClass, asset] of Object.entries(expected)) {
    const rule = css.match(new RegExp(`mark\.annotation\.${storedClass}\{([^}]*)\}`))?.[1] || "";
    assert.match(rule, new RegExp(`${asset}-left\.png`), `${storedClass} uses the ${asset} left cap`);
    assert.match(rule, new RegExp(`${asset}-middle\.png`), `${storedClass} uses the ${asset} repeat middle`);
    assert.match(rule, new RegExp(`${asset}-right\.png`), `${storedClass} uses the ${asset} right cap`);
    assert.match(rule, new RegExp(`${asset}\.png`), `${storedClass} keeps the mother stroke for short marks`);
  }
  const base = css.match(/mark\.annotation\{([^}]*)\}/)?.[1] || "";
  assert.match(base, /box-decoration-break:\s*clone/, "wrapped fragments get independent caps");
  assert.match(base, /repeat-x/, "only the middle part repeats");
  assert.doesNotMatch(base, /background-size:[^;]*100% 100%/, "the mother stroke is never stretched to 100% 100%");
  const short = css.match(/mark\.annotation\.od-hl-short\{([^}]*)\}/)?.[1] || "";
  assert.match(short, /var\(--hl-full\)/, "short marks compress the single full stroke");
  assert.match(short, /no-repeat/, "the full stroke never repeats");
});
