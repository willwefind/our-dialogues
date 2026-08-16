import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadBookmarks() {
  const runtime = { console, Date };
  runtime.window = runtime;
  vm.createContext(runtime);
  const source = await readFile(path.join(repositoryRoot, "src", "core", "bookmarks.js"), "utf8");
  vm.runInContext(source, runtime, { filename: "src/core/bookmarks.js" });
  return runtime.OD.bookmarks;
}

test("create fills identity, trims text, and stamps a creation time", async () => {
  const bookmarks = await loadBookmarks();
  const bookmark = bookmarks.create({
    sourceId: "source-1",
    sourceLabel: "  Mufy folder  ",
    conversationId: "conversation-1",
    conversationTitle: "  A   long\n title  ",
    messageId: "message-9",
    label: `  ${"很".repeat(200)}  `,
    snippet: "  first\nline  "
  });

  assert.ok(bookmark.id);
  assert.ok(bookmark.createdAt);
  assert.equal(bookmark.sourceLabel, "Mufy folder");
  assert.equal(bookmark.conversationTitle, "A long title");
  assert.equal(bookmark.label.length, 120, "labels are capped");
  assert.equal(bookmark.snippet, "first line");
});

test("normalize drops invalid entries and duplicate IDs without touching valid ones", async () => {
  const bookmarks = await loadBookmarks();
  const list = bookmarks.normalize([
    null,
    "text",
    { label: "no conversation" },
    { id: "keep", conversationId: "c1", messageId: 42 },
    { id: "keep", conversationId: "c2" },
    { conversationId: "c3", messageId: "   " }
  ]);

  assert.equal(list.length, 2);
  assert.equal(list[0].id, "keep");
  assert.equal(list[0].messageId, "42", "message IDs normalize to strings");
  assert.equal(list[1].conversationId, "c3");
  assert.equal(list[1].messageId, null, "blank message IDs become null");
  assert.ok(list[1].id, "missing IDs are generated");
});

test("adding the same conversation and message refreshes instead of duplicating, keeping the label", async () => {
  const bookmarks = await loadBookmarks();
  const first = bookmarks.create({ conversationId: "c1", messageId: "m1" });
  let list = bookmarks.add([], first);
  list = bookmarks.rename(list, first.id, "手写的名字");

  const refreshed = bookmarks.create({ conversationId: "c1", messageId: "m1" });
  list = bookmarks.add(list, refreshed);
  assert.equal(list.length, 1);
  assert.equal(list[0].id, refreshed.id);
  assert.equal(list[0].label, "手写的名字", "an unnamed refresh keeps the existing label");

  const other = bookmarks.create({ conversationId: "c1", messageId: "m2" });
  list = bookmarks.add(list, other);
  assert.equal(list.length, 2, "a different message in the same conversation is a separate bookmark");
  assert.equal(list[0].id, other.id, "newest bookmark goes first");
});

test("remove, rename, and displayTitle behave on normalized lists", async () => {
  const bookmarks = await loadBookmarks();
  const a = bookmarks.create({ conversationId: "c1", messageId: "m1", conversationTitle: "第一段" });
  const b = bookmarks.create({ conversationId: "c2", messageId: null });
  let list = bookmarks.add(bookmarks.add([], a), b);

  assert.equal(bookmarks.displayTitle(list.find(item => item.id === a.id)), "第一段");
  list = bookmarks.rename(list, a.id, "  改过的名字  ");
  assert.equal(bookmarks.displayTitle(list.find(item => item.id === a.id)), "改过的名字");
  assert.equal(bookmarks.displayTitle(list.find(item => item.id === b.id)), "c2", "falls back to the conversation ID");

  list = bookmarks.remove(list, a.id);
  assert.equal(list.length, 1);
  assert.equal(list[0].id, b.id);
});
