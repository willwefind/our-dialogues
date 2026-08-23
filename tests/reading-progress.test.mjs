import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadReadingProgress() {
  const runtime = { console, Date };
  runtime.window = runtime;
  vm.createContext(runtime);
  const source = await readFile(path.join(repositoryRoot, "src", "core", "reading-progress.js"), "utf8");
  vm.runInContext(source, runtime, { filename: "src/core/reading-progress.js" });
  return runtime.OD.readingProgress;
}

test("normalize drops invalid entries and clamps numbers", async () => {
  const progress = await loadReadingProgress();
  const map = progress.normalize({
    "": { updatedAt: "2026-08-16T00:00:00Z" },
    "no-time": { messageId: "m1" },
    "keep": { messageId: 42, page: "3.7", scrollTop: -5, percent: 250, updatedAt: "2026-08-16T00:00:00Z" },
    "blank-anchor": { messageId: "  ", updatedAt: "2026-08-16T01:00:00Z" }
  });

  assert.deepEqual(Object.keys(map).sort(), ["blank-anchor", "keep"]);
  assert.equal(map.keep.messageId, "42");
  assert.equal(map.keep.page, 4);
  assert.equal(map.keep.scrollTop, 0);
  assert.equal(map.keep.percent, 100);
  assert.equal(map["blank-anchor"].messageId, null);
});

test("record keeps newest first and recent honors same-timestamp ordering", async () => {
  const progress = await loadReadingProgress();
  const at = "2026-08-16T12:00:00.000Z";
  let map = progress.record({}, "a", { messageId: "a-1", percent: 10, updatedAt: at });
  map = progress.record(map, "b", { messageId: "b-1", percent: 20, updatedAt: at });
  map = progress.record(map, "a", { messageId: "a-2", percent: 30, updatedAt: at });

  const order = progress.recent(map, 10).map(entry => entry.conversationId);
  assert.deepEqual([...order], ["a", "b"], "re-recording moves a conversation back to the front even at equal timestamps");
  assert.equal(progress.recent(map, 1).length, 1);
  assert.equal(progress.recent(map, 10)[0].messageId, "a-2");
});

test("the map is capped by recency", async () => {
  const progress = await loadReadingProgress();
  let map = {};
  for (let i = 0; i < progress.MAX_ENTRIES + 25; i++) {
    map = progress.record(map, `conversation-${i}`, {
      messageId: `m-${i}`,
      updatedAt: new Date(1700000000000 + i * 1000).toISOString()
    });
  }
  const keys = Object.keys(map);
  assert.equal(keys.length, progress.MAX_ENTRIES);
  assert.ok(!keys.includes("conversation-0"), "the oldest entries fall off");
  assert.ok(keys.includes(`conversation-${progress.MAX_ENTRIES + 24}`), "the newest entry stays");
});

test("percent approximates by anchor index and treats the last message as finished", async () => {
  const progress = await loadReadingProgress();
  const messages = [{ id: "m1" }, { id: "m2" }, { id: "m3" }, { id: "m4" }];

  assert.equal(progress.percent(messages, null), 0);
  assert.equal(progress.percent(messages, "missing"), 0);
  assert.equal(progress.percent(messages, "m2"), 50);
  assert.equal(progress.percent(messages, "m4"), 100);
  assert.equal(progress.percent([], "m1"), 0);
  assert.equal(progress.isFinished({ percent: 100 }), true);
  assert.equal(progress.isFinished({ percent: 42 }), false);
});

test("percent scales inside the anchored message when a viewport fraction is supplied", async () => {
  const progress = await loadReadingProgress();
  const single = [{ id: "body" }];

  // One long document (a diary entry) no longer opens as "finished".
  assert.equal(progress.percent(single, "body", 0), 0);
  assert.equal(progress.percent(single, "body", 0.37), 37);
  assert.equal(progress.percent(single, "body", 1), 100);
  assert.equal(progress.percent(single, "body"), 100, "no fraction keeps the historical behaviour");
  assert.equal(progress.percent(single, "body", Number.NaN), 100, "unmeasurable layouts keep the historical behaviour");

  // Fractions clamp instead of overflowing the scale.
  assert.equal(progress.percent(single, "body", -3), 0);
  assert.equal(progress.percent(single, "body", 42), 100);

  // Multi-message conversations blend the fraction into the anchored slot.
  const four = [{ id: "m1" }, { id: "m2" }, { id: "m3" }, { id: "m4" }];
  assert.equal(progress.percent(four, "m2", 0.5), 38, "(1 + 0.5) / 4");
  assert.equal(progress.percent(four, "m4", 0.5), 88, "a huge final message is no longer instantly finished");
  assert.equal(progress.percent(four, "m4", 1), 100);
});
