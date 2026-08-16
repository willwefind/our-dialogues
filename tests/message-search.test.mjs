import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadMessageSearch() {
  const runtime = { console };
  runtime.window = runtime;
  vm.createContext(runtime);
  for (const relativePath of ["src/core/schema.js", "src/core/message-search.js"]) {
    const source = await readFile(path.join(repositoryRoot, relativePath), "utf8");
    vm.runInContext(source, runtime, { filename: relativePath });
  }
  return runtime.OD.messageSearch;
}

test("every occurrence in a long message becomes its own hit with exact message identity", async () => {
  const search = await loadMessageSearch();
  const conversation = {
    id: "c1",
    messages: [
      { id: "m1", role: "assistant", speaker: "角色", content: "重点在前。中间说了别的。重点在后。" },
      { id: "m2", role: "user", content: "这条没有关键词" },
      { id: "m3", role: "assistant", content: [{ type: "text", text: "分段内容里也有重点" }] }
    ]
  };

  const { hits, truncated } = search.searchConversation(conversation, "重点");
  assert.equal(truncated, false);
  assert.deepEqual([...hits.map(hit => `${hit.messageId}@${hit.index}`)], ["m1@0", "m1@12", "m3@7"]);
  assert.equal(hits[0].speaker, "角色");
  assert.equal(hits[1].before, "重点在前。中间说了别的。", "context reaches back up to the limit");
  assert.equal(hits[1].match, "重点");
});

test("search is case-insensitive and keeps the original casing in the match", async () => {
  const search = await loadMessageSearch();
  const conversation = {
    id: "c1",
    messages: [{ id: "m1", role: "assistant", content: "God, I can't even afford this. GOD indeed." }]
  };

  const { hits } = search.searchConversation(conversation, "god");
  assert.equal(hits.length, 2);
  assert.equal(hits[0].match, "God");
  assert.equal(hits[1].match, "GOD");
});

test("library search walks the given order and reports truncation instead of dropping silently", async () => {
  const search = await loadMessageSearch();
  const conversations = ["a", "b", "c"].map(id => ({
    id,
    messages: [{ id: `${id}-m1`, role: "assistant", content: "词 词 词 词" }]
  }));

  const full = search.searchLibrary(conversations, "词");
  assert.equal(full.hits.length, 12);
  assert.equal(full.truncated, false);
  assert.deepEqual([...new Set(full.hits.map(hit => hit.conversationId))], ["a", "b", "c"], "hits follow the given conversation order");

  const capped = search.searchLibrary(conversations, "词", { limit: 5 });
  assert.equal(capped.hits.length, 5);
  assert.equal(capped.truncated, true);
});

test("blank queries and missing conversations return no hits", async () => {
  const search = await loadMessageSearch();
  const empty = search.searchConversation(null, "词");
  assert.equal(empty.hits.length, 0);
  assert.equal(empty.truncated, false);
  assert.equal(search.searchConversation({ id: "c", messages: [] }, "   ").hits.length, 0);
  assert.equal(search.searchLibrary(null, "词").hits.length, 0);
});
