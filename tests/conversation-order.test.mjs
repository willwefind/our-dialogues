import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadConversationOrder() {
  const runtime = { console };
  runtime.window = runtime;
  vm.createContext(runtime);
  const source = await readFile(
    path.join(repositoryRoot, "src", "core", "conversation-order.js"),
    "utf8"
  );
  vm.runInContext(source, runtime, { filename: "src/core/conversation-order.js" });
  return runtime.OD.conversationOrder;
}

function fakeElement(id="") {
  const listeners = new Map();
  const classes = new Set();
  return {
    id,
    value: "",
    textContent: "",
    innerHTML: "",
    scrollTop: 0,
    dataset: {},
    attributes: new Map(),
    classList: {
      add(...names) { names.forEach(name => classes.add(name)); },
      remove(...names) { names.forEach(name => classes.delete(name)); },
      toggle(name, force) {
        const enabled = force === undefined ? !classes.has(name) : !!force;
        if (enabled) classes.add(name);
        else classes.delete(name);
        return enabled;
      },
      contains(name) { return classes.has(name); }
    },
    addEventListener(type, listener) { listeners.set(type, listener); },
    dispatch(type) { return listeners.get(type)?.({ target: this }); },
    setAttribute(name, value) { this.attributes.set(name, String(value)); },
    getAttribute(name) { return this.attributes.get(name) ?? null; },
    querySelectorAll() { return []; }
  };
}

async function loadAppRuntime(savedSortMode="asc") {
  const ids = [
    "status", "search", "conversationList", "archiveMeta", "welcome", "reader",
    "currentTitle", "readerTitle", "readerMeta", "messages", "main", "fileInput",
    "folderInput", "voiceMappingInput", "voiceArchiveInput", "clearSolVoice",
    "hideUser", "showThinking", "theme", "sidebarToggle", "sidebar"
  ];
  const elements = new Map(ids.map(id => [id, fakeElement(id)]));
  const sortAscending = fakeElement("sortAscending");
  const sortDescending = fakeElement("sortDescending");
  sortAscending.dataset.sortMode = "asc";
  sortDescending.dataset.sortMode = "desc";
  elements.set(sortAscending.id, sortAscending);
  elements.set(sortDescending.id, sortDescending);

  const stored = new Map([["our-dialogues.conversation-sort", savedSortMode]]);
  const runtime = {
    console,
    localStorage: {
      getItem(key) { return stored.get(key) ?? null; },
      setItem(key, value) { stored.set(key, value); }
    },
    document: {
      body: fakeElement("body"),
      documentElement: { dataset: {} },
      getElementById(id) { return elements.get(id); },
      querySelectorAll(selector) {
        if (selector === "[data-sort-mode]") return [sortAscending, sortDescending];
        return [];
      }
    }
  };
  runtime.window = runtime;
  runtime.addEventListener = () => {};
  runtime.OD = {
    schema: {
      textOf(content) { return typeof content === "string" ? content : ""; }
    }
  };
  vm.createContext(runtime);

  for (const relativePath of ["src/core/conversation-order.js", "src/app.js"]) {
    const source = await readFile(path.join(repositoryRoot, relativePath), "utf8");
    vm.runInContext(source, runtime, { filename: relativePath });
  }
  return { runtime, elements, stored, sortAscending, sortDescending };
}

function ids(conversations) {
  return [...conversations.map(conversation => conversation.id)];
}

test("conversation sort uses normalized createdAt in both directions", async () => {
  const order = await loadConversationOrder();
  const conversations = [
    { id: "middle", createdAt: "2025-06-01T00:00:00.000Z" },
    { id: "newest", createdAt: "2026-01-01T00:00:00.000Z" },
    { id: "oldest", createdAt: "2024-08-26T00:00:00.000Z" }
  ];

  assert.deepEqual(ids(order.sortConversations(conversations, "asc")), ["oldest", "middle", "newest"]);
  assert.deepEqual(ids(order.sortConversations(conversations, "desc")), ["newest", "middle", "oldest"]);
  assert.deepEqual(ids(conversations), ["middle", "newest", "oldest"], "import order must not be mutated");
});

test("search results retain the selected conversation sort mode", async () => {
  const order = await loadConversationOrder();
  const conversations = [
    { id: "later-match", title: "Moon notes", createdAt: "2026-02-01T00:00:00.000Z" },
    { id: "non-match", title: "Gardening", createdAt: "2023-01-01T00:00:00.000Z" },
    { id: "earlier-match", title: "Moon archive", createdAt: "2024-02-01T00:00:00.000Z" }
  ];
  const searchText = conversation => conversation.title;

  assert.deepEqual(
    ids(order.filterAndSort(conversations, " moon ", searchText, "asc")),
    ["earlier-match", "later-match"]
  );
  assert.deepEqual(
    ids(order.filterAndSort(conversations, "MOON", searchText, "desc")),
    ["later-match", "earlier-match"]
  );
});

test("missing and invalid dates stay last and stable in original import order", async () => {
  const order = await loadConversationOrder();
  const conversations = [
    { id: "missing-first", createdAt: null },
    { id: "same-time-first", createdAt: "2025-01-01T00:00:00.000Z" },
    { id: "invalid", createdAt: "not-a-date" },
    { id: "same-time-second", createdAt: "2025-01-01T00:00:00.000Z" },
    { id: "older", createdAt: "2024-01-01T00:00:00.000Z" },
    { id: "missing-second" }
  ];

  assert.deepEqual(ids(order.sortConversations(conversations, "asc")), [
    "older", "same-time-first", "same-time-second", "missing-first", "invalid", "missing-second"
  ]);
  assert.deepEqual(ids(order.sortConversations(conversations, "desc")), [
    "same-time-first", "same-time-second", "older", "missing-first", "invalid", "missing-second"
  ]);
});

test("sort mode defaults to ascending and persists through localStorage", async () => {
  const order = await loadConversationOrder();
  const values = new Map();
  const storage = {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); }
  };

  assert.equal(order.readStoredMode(storage), "asc");
  assert.equal(order.persistMode(storage, "desc"), "desc");
  assert.equal(values.get("our-dialogues.conversation-sort"), "desc");
  assert.equal(order.readStoredMode(storage), "desc");
  assert.equal(order.persistMode(storage, "unexpected"), "asc");
  assert.equal(order.readStoredMode(storage), "asc");
});

test("sorting conversations never reverses or mutates message order", async () => {
  const order = await loadConversationOrder();
  const conversations = [
    {
      id: "newer",
      createdAt: "2026-01-01T00:00:00.000Z",
      messages: [{ id: "newer-1" }, { id: "newer-2" }, { id: "newer-3" }]
    },
    {
      id: "older",
      createdAt: "2024-01-01T00:00:00.000Z",
      messages: [{ id: "older-1" }, { id: "older-2" }]
    }
  ];
  const messageArrays = conversations.map(conversation => conversation.messages);

  order.sortConversations(conversations, "asc");
  order.sortConversations(conversations, "desc");

  assert.equal(conversations[0].messages, messageArrays[0]);
  assert.equal(conversations[1].messages, messageArrays[1]);
  assert.deepEqual(ids(conversations[0].messages), ["newer-1", "newer-2", "newer-3"]);
  assert.deepEqual(ids(conversations[1].messages), ["older-1", "older-2"]);
});

test("app opens the first sorted conversation and keeps search in the saved mode", async () => {
  const { runtime, elements, stored, sortAscending, sortDescending } = await loadAppRuntime("desc");
  const archive = {
    conversations: [
      {
        id: "middle",
        title: "Keep middle",
        createdAt: "2025-01-01T00:00:00.000Z",
        messages: [{ id: "middle-1", role: "user", content: "keep" }]
      },
      {
        id: "oldest",
        title: "Skip oldest",
        createdAt: "2024-01-01T00:00:00.000Z",
        messages: [{ id: "oldest-1", role: "user", content: "skip" }]
      },
      {
        id: "newest",
        title: "Keep newest",
        createdAt: "2026-01-01T00:00:00.000Z",
        messages: [{ id: "newest-1", role: "assistant", content: "keep" }]
      }
    ]
  };

  runtime.OD.app.loadArchive(archive, "Synthetic");
  assert.equal(runtime.OD.app.getState().current.id, "newest");
  assert.deepEqual([...runtime.OD.app.getState().filteredIds], ["newest", "middle", "oldest"]);
  assert.equal(sortAscending.getAttribute("aria-pressed"), "false");
  assert.equal(sortDescending.getAttribute("aria-pressed"), "true");

  elements.get("search").value = "keep";
  elements.get("search").dispatch("input");
  assert.deepEqual([...runtime.OD.app.getState().filteredIds], ["newest", "middle"]);

  sortAscending.dispatch("click");
  assert.equal(runtime.OD.app.getState().sortMode, "asc");
  assert.equal(stored.get("our-dialogues.conversation-sort"), "asc");
  assert.deepEqual([...runtime.OD.app.getState().filteredIds], ["middle", "newest"]);
});

test("sidebar exposes exactly two clearly labelled conversation sort modes", async () => {
  const html = await readFile(path.join(repositoryRoot, "index.html"), "utf8");
  const controls = [...html.matchAll(/data-sort-mode="(asc|desc)"[^>]*>([^<]+)<\/button>/g)];

  assert.deepEqual(controls.map(match => [match[1], match[2].trim()]), [
    ["asc", "正序"],
    ["desc", "倒序"]
  ]);
  assert.match(html, /正序：最早到最新/);
  assert.match(html, /倒序：最新到最早/);
});
