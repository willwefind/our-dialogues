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
    checked: false,
    hidden: false,
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
    click() { return listeners.get("click")?.({ target: this }); },
    setAttribute(name, value) { this.attributes.set(name, String(value)); },
    getAttribute(name) { return this.attributes.get(name) ?? null; },
    querySelectorAll(selector) {
      if (selector === "[data-message-id]") {
        return [...this.innerHTML.matchAll(/data-message-id="([^"]+)"/g)].map((match, index) => ({
          dataset: { messageId: match[1] },
          offsetTop: (index + 1) * 100
        }));
      }
      return [];
    }
  };
}

async function loadAppRuntime(savedSortMode="asc", options={}) {
  const ids = [
    "status", "search", "conversationList", "archiveMeta", "welcome", "reader",
    "currentTitle", "readerTitle", "readerMeta", "messages", "main", "fileInput",
    "folderInput", "voiceMappingInput", "voiceArchiveInput", "clearSolVoice",
    "sourceFilter", "clearSources", "hideUser", "showThinking", "theme", "sidebarToggle", "sidebar",
    "directoryPicker", "localLibraryStatus", "clearLocalLibrary", "acceptanceAudit", "runAcceptanceAudit",
    "fontSmaller", "fontLarger", "lineHeight", "contentWidth", "fontFamily",
    "readingMode", "pageLength", "pageNavigation", "previousPage", "nextPage",
    "pageIndicator", "pageJump", "pageCount", "scrollJumpers", "toTop", "toEnd",
    "bookmarkAdd", "bookmarksPanel", "bookmarksList", "bookmarksCount",
    "annotationsPanel", "annotationsList", "annotationsCount", "highlightButton",
    "annotationEditor", "annotationColors", "annotationNote",
    "annotationSave", "annotationCancel", "annotationDelete"
  ];
  const elements = new Map(ids.map(id => [id, fakeElement(id)]));
  const sortAscending = fakeElement("sortAscending");
  const sortDescending = fakeElement("sortDescending");
  sortAscending.dataset.sortMode = "asc";
  sortDescending.dataset.sortMode = "desc";
  elements.set(sortAscending.id, sortAscending);
  elements.set(sortDescending.id, sortDescending);

  const stored = options.stored || new Map([["our-dialogues.conversation-sort", savedSortMode]]);
  if (!stored.has("our-dialogues.conversation-sort")) stored.set("our-dialogues.conversation-sort", savedSortMode);
  const documentListeners = new Map();
  const runtime = {
    console,
    Blob,
    File,
    Date,
    setTimeout,
    clearTimeout,
    localStorage: {
      getItem(key) { return stored.get(key) ?? null; },
      setItem(key, value) { stored.set(key, value); }
    },
    document: {
      body: fakeElement("body"),
      documentElement: { dataset: {}, style: { setProperty() {} } },
      visibilityState: "visible",
      getElementById(id) { return elements.get(id); },
      addEventListener(type, listener) { documentListeners.set(type, listener); },
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

  const runtimeFiles = [
    "src/core/conversation-order.js",
    "src/core/source-library.js",
    "src/core/reader-parity.js",
    "src/core/mufy-title-resolver.js",
    "src/core/bookmarks.js",
    "src/core/annotations.js"
  ];
  if (options.driver) runtimeFiles.push("src/core/persistent-library.js");
  for (const relativePath of runtimeFiles) {
    const source = await readFile(path.join(repositoryRoot, relativePath), "utf8");
    vm.runInContext(source, runtime, { filename: relativePath });
  }
  if (options.driver) {
    const persistence = runtime.OD.persistentLibrary.create({ driver: options.driver });
    runtime.OD.persistentLibrary.create = () => persistence;
  }
  vm.runInContext(await readFile(path.join(repositoryRoot, "src/app.js"), "utf8"), runtime, { filename: "src/app.js" });
  return {
    runtime,
    elements,
    stored,
    sortAscending,
    sortDescending,
    dispatchDocument(type) { return documentListeners.get(type)?.({ target: runtime.document }); }
  };
}

function ids(conversations) {
  return [...conversations.map(conversation => conversation.id)];
}

async function createMemoryPersistenceDriver() {
  const runtime = { console, Blob, File, Date, setTimeout, clearTimeout };
  runtime.window = runtime;
  vm.createContext(runtime);
  vm.runInContext(
    await readFile(path.join(repositoryRoot, "src/core/persistent-library.js"), "utf8"),
    runtime,
    { filename: "src/core/persistent-library.js" }
  );
  return runtime.OD.persistentLibrary._internals.createMemoryDriver();
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

test("app keeps consecutive sources, filters them, skips duplicates, and removes one source", async () => {
  const { runtime, elements, stored } = await loadAppRuntime("asc");
  const makeArchive = (platform, id) => ({
    source: { platform, exporter: `${platform}-synthetic` },
    conversations: [{
      id,
      title: `${platform} title`,
      createdAt: "2026-08-16T00:00:00.000Z",
      context: platform === "mufy" ? {
        sourceMetadata: { characterId: "same-name-a", characterName: "Same Name" }
      } : {},
      participants: [],
      messages: [{ id: `${id}-message`, role: "assistant", content: `${platform} body` }]
    }]
  });
  const mufyArchive = makeArchive("mufy", "mufy-session");
  const claudeArchive = makeArchive("claude", "claude-chat");
  const chatgptArchive = makeArchive("chatgpt", "chatgpt-chat");

  let disposedAssets = 0;
  const mufyAssets = { dispose() { disposedAssets += 1; } };
  runtime.OD.app.loadArchive(mufyArchive, "Mufy folder", mufyAssets);
  runtime.OD.app.loadArchive(claudeArchive, "Claude JSON");
  runtime.OD.app.loadArchive(chatgptArchive, "ChatGPT");
  let appState = runtime.OD.app.getState();
  assert.equal(appState.sources.length, 3);
  assert.equal(appState.archive.conversations.length, 3);
  assert.match(elements.get("conversationList").innerHTML, /character-group/);
  assert.match(elements.get("conversationList").innerHTML, /Same Name/);

  const duplicate = runtime.OD.app.loadArchive(chatgptArchive, "ChatGPT again");
  assert.equal(duplicate.duplicate, true);
  assert.equal(runtime.OD.app.getState().sources.length, 3);

  runtime.OD.app.openConversation("mufy-session");
  assert.equal(runtime.OD.app.getState().hasLocalAssets, true, "opening a source activates only its asset session");
  const listHTML = elements.get("conversationList").innerHTML;
  assert.match(listHTML, /class="source-group" data-source-id="[^"]+" open/, "source groups stay open by default");
  assert.match(listHTML, /class="character-group" data-character-key="[^"]+" open/, "the character group holding the open conversation is expanded");
  const mirror = JSON.parse(stored.get("our-dialogues.reader-state.v1"));
  assert.deepEqual(mirror.groupState, { sources: {}, characters: {} }, "untouched groups persist no explicit state");

  const claudeSource = runtime.OD.app.getState().sources.find(source => source.platform === "claude");
  elements.get("sourceFilter").value = claudeSource.id;
  elements.get("sourceFilter").dispatch("change");
  assert.deepEqual([...runtime.OD.app.getState().filteredIds], ["claude-chat"]);

  assert.equal(runtime.OD.app.removeSource(claudeSource.id), true);
  appState = runtime.OD.app.getState();
  assert.equal(appState.sources.length, 2);
  assert.equal(appState.archive.conversations.length, 2);
  assert.ok(appState.archive.conversations.some(conversation => conversation.id === "mufy-session"));
  assert.ok(appState.archive.conversations.some(conversation => conversation.id === "chatgpt-chat"));
  assert.equal(appState.sourceFilter, "all");
  const mufySource = appState.sources.find(source => source.platform === "mufy");
  assert.equal(runtime.OD.app.removeSource(mufySource.id), true);
  assert.equal(disposedAssets, 1, "removing a source disposes its lazy local assets");
});

test("app renders Mufy rich families with Reader-owned markup and escaped values", async () => {
  const { runtime, elements } = await loadAppRuntime("asc");
  runtime.OD.app.loadArchive({
    source: { platform: "mufy", exporter: "mufy-synthetic" },
    conversations: [{
      id: "rich-session",
      title: "Synthetic rich blocks",
      context: { sourceMetadata: { characterId: "rich-character", characterName: "Synthetic" } },
      participants: [],
      messages: [{
        id: "rich-message",
        role: "assistant",
        content: [{
          type: "source-rich-block",
          source: "mufy",
          kind: "scene-heading",
          variant: "zc",
          eyebrow: "SAFE META",
          title: "Synthetic <script> title",
          subtitle: "Chapter subtitle",
          text: "Synthetic title"
        }, {
          type: "source-rich-block",
          source: "mufy",
          kind: "task-card",
          variant: "task",
          title: "Task",
          rows: [{ label: "Level", value: "2" }],
          sections: [{ label: "State", value: "Ready" }],
          items: [{ text: "One objective" }],
          text: "Task Level 2 State Ready One objective"
        }]
      }]
    }]
  }, "Synthetic Mufy");
  runtime.OD.app.openConversation("rich-session");

  const markup = elements.get("messages").innerHTML;
  assert.match(markup, /source-rich-heading source-rich-zc/);
  assert.match(markup, /source-rich-kind-task-card source-rich-task/);
  assert.match(markup, /source-rich-sections/);
  assert.match(markup, /source-rich-items/);
  assert.match(markup, /Synthetic &lt;script&gt; title/);
  assert.doesNotMatch(markup, /<script>/i);
});

test("app boot restores the persistent source, prefs, recent conversation, and scroll position", async () => {
  const driver = await createMemoryPersistenceDriver();
  const stored = new Map([["our-dialogues.conversation-sort", "asc"]]);
  const first = await loadAppRuntime("asc", { driver, stored });
  await first.runtime.OD.app.ready;
  first.runtime.OD.app.loadArchive({
    source: { platform: "mufy", exporter: "mufy-synthetic" },
    conversations: [{
      id: "persistent-session",
      title: "Persistent session",
      createdAt: "2026-08-16T00:00:00.000Z",
      context: { sourceMetadata: { characterId: "character-persistent", characterName: "Persistent" } },
      participants: [],
      messages: [
        { id: "persistent-one", role: "assistant", content: "first" },
        { id: "persistent-two", role: "assistant", content: "second" }
      ]
    }]
  }, "Persistent Mufy");
  await new Promise(resolve => setTimeout(resolve, 20));

  const sourceId = first.runtime.OD.app.getState().sources[0].id;
  first.elements.get("sourceFilter").value = sourceId;
  first.elements.get("sourceFilter").dispatch("change");
  first.elements.get("hideUser").checked = true;
  first.elements.get("hideUser").dispatch("change");
  first.elements.get("showThinking").checked = true;
  first.elements.get("showThinking").dispatch("change");
  first.elements.get("theme").value = "night";
  first.elements.get("theme").dispatch("change");
  first.elements.get("main").scrollTop = 222;
  first.elements.get("main").dispatch("scroll");
  const acceptanceAudit = JSON.parse(first.elements.get("acceptanceAudit").textContent);
  assert.equal(acceptanceAudit.readingPosition.scrollTop, 222);
  assert.notEqual(acceptanceAudit.readingPosition.messageToken, "persistent-two");
  first.runtime.document.visibilityState = "hidden";
  await first.dispatchDocument("visibilitychange");
  await new Promise(resolve => setTimeout(resolve, 20));

  const refreshed = await loadAppRuntime("asc", { driver, stored });
  await refreshed.runtime.OD.app.ready;
  const restored = refreshed.runtime.OD.app.getState();
  assert.equal(restored.sources.length, 1);
  assert.equal(restored.current.id, "persistent-session");
  assert.equal(restored.sourceFilter, sourceId);
  assert.equal(refreshed.elements.get("main").scrollTop, 222);
  assert.equal(refreshed.elements.get("hideUser").checked, true);
  assert.equal(refreshed.elements.get("showThinking").checked, true);
  assert.equal(refreshed.elements.get("theme").value, "night");
  assert.match(refreshed.elements.get("status").textContent, /从本地书库恢复 1 个来源 \/ 1 段对话/);
  assert.equal(driver.inspect().settings.readingPosition.messageId, "persistent-two");
});

test("app reader parity paginates, jumps pages, crosses conversations, and keeps compact controls", async () => {
  const { runtime, elements } = await loadAppRuntime("asc");
  runtime.OD.app.loadArchive({
    source: { platform: "normalized", exporter: "parity-synthetic" },
    conversations: [{
      id: "book-one",
      title: "Book one",
      createdAt: "2026-08-15T00:00:00Z",
      messages: [
        { id: "page-one", role: "assistant", content: "a".repeat(2600) },
        { id: "page-two", role: "assistant", content: "b".repeat(2600) },
        { id: "page-three", role: "assistant", content: "c".repeat(2600) }
      ]
    }, {
      id: "book-two",
      title: "Book two",
      createdAt: "2026-08-16T00:00:00Z",
      messages: [{ id: "next-conversation", role: "assistant", content: "next" }]
    }]
  }, "Parity synthetic");

  elements.get("pageLength").value = "short";
  await elements.get("pageLength").dispatch("change");
  elements.get("readingMode").value = "page";
  await elements.get("readingMode").dispatch("change");
  assert.equal(runtime.OD.app.getState().pageCount, 3);
  assert.equal(elements.get("pageIndicator").hidden, false);
  elements.get("pageJump").value = "2";
  await elements.get("pageJump").dispatch("change");
  assert.equal(runtime.OD.app.getState().page, 1);
  assert.match(elements.get("messages").innerHTML, /page-two/);

  elements.get("fontLarger").click();
  elements.get("lineHeight").value = "2.2";
  await elements.get("lineHeight").dispatch("change");
  assert.equal(runtime.OD.app.getState().readerPreferences.fontSize, 19);
  assert.equal(runtime.OD.app.getState().readerPreferences.lineHeight, 2.2);

  elements.get("nextPage").click();
  assert.equal(runtime.OD.app.getState().page, 2);
  elements.get("nextPage").click();
  assert.equal(runtime.OD.app.getState().current.id, "book-two");
  elements.get("previousPage").click();
  assert.equal(runtime.OD.app.getState().current.id, "book-one");
  assert.equal(runtime.OD.app.getState().page, 2);

  elements.get("main").scrollHeight = 999;
  elements.get("toEnd").click();
  assert.equal(elements.get("main").scrollTop, 999);
  elements.get("sidebarToggle").click();
  assert.equal(elements.get("sidebar").classList.contains("closed"), true);
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

test("bookmarks anchor by conversation and message, persist, jump, rename, and remove", async () => {
  const { runtime, elements, stored } = await loadAppRuntime("asc");
  const archive = {
    conversations: [
      {
        id: "alpha",
        title: "第一段",
        createdAt: "2025-01-01T00:00:00.000Z",
        messages: [
          { id: "alpha-1", role: "assistant", content: "开头的一句话" },
          { id: "alpha-2", role: "user", content: "后面的一句话" }
        ]
      },
      {
        id: "beta",
        title: "第二段",
        createdAt: "2026-01-01T00:00:00.000Z",
        messages: [{ id: "beta-1", role: "assistant", content: "另一段的话" }]
      }
    ]
  };

  assert.equal(runtime.OD.app.addBookmark(), null, "no bookmark without an open conversation");

  runtime.OD.app.loadArchive(archive, "Synthetic");
  runtime.OD.app.openConversation("alpha");
  const bookmark = runtime.OD.app.addBookmark();
  assert.equal(bookmark.conversationId, "alpha");
  assert.equal(bookmark.messageId, "alpha-1", "anchors to the visible message, not an index");
  assert.equal(bookmark.conversationTitle, "第一段");
  assert.equal(bookmark.snippet, "开头的一句话");
  assert.equal(runtime.OD.app.getState().bookmarks.length, 1);

  runtime.OD.app.addBookmark();
  assert.equal(runtime.OD.app.getState().bookmarks.length, 1, "same anchor refreshes instead of duplicating");

  const mirror = JSON.parse(stored.get("our-dialogues.reader-state.v1"));
  assert.equal(mirror.bookmarks.length, 1, "bookmarks persist with reader settings");
  assert.equal(mirror.bookmarks[0].conversationId, "alpha");

  runtime.OD.app.openConversation("beta");
  assert.equal(runtime.OD.app.getState().current.id, "beta");
  const activeBookmark = runtime.OD.app.getState().bookmarks[0];
  assert.equal(runtime.OD.app.jumpToBookmark(activeBookmark.id), true);
  assert.equal(runtime.OD.app.getState().current.id, "alpha", "jump reopens the bookmarked conversation");

  runtime.OD.app.renameBookmark(activeBookmark.id, "  重要的一页  ");
  assert.equal(runtime.OD.app.getState().bookmarks[0].label, "重要的一页");
  assert.match(elements.get("bookmarksList").innerHTML, /重要的一页/);
  assert.equal(elements.get("bookmarksCount").textContent, "1");

  runtime.OD.app.removeBookmark(activeBookmark.id);
  assert.equal(runtime.OD.app.getState().bookmarks.length, 0);
  assert.match(elements.get("bookmarksList").innerHTML, /存书签/, "empty state invites saving a bookmark");
});

test("a bookmark whose source was removed stays listed but refuses to jump", async () => {
  const { runtime, elements } = await loadAppRuntime("asc");
  runtime.OD.app.loadArchive({
    conversations: [{
      id: "gone",
      title: "会被移除的一段",
      createdAt: "2025-01-01T00:00:00.000Z",
      messages: [{ id: "gone-1", role: "assistant", content: "正文" }]
    }]
  }, "Removable");
  runtime.OD.app.openConversation("gone");
  const bookmark = runtime.OD.app.addBookmark();

  const sourceId = runtime.OD.app.getState().sources[0].id;
  runtime.OD.app.removeSource(sourceId);
  assert.equal(runtime.OD.app.getState().bookmarks.length, 1, "the bookmark itself is not deleted");
  assert.match(elements.get("bookmarksList").innerHTML, /来源不在书库中/);
  assert.equal(runtime.OD.app.jumpToBookmark(bookmark.id), false, "jump refuses instead of opening nothing");
});

test("annotations render colored marks in the message, persist, jump, update, and remove", async () => {
  const { runtime, elements, stored } = await loadAppRuntime("asc");
  runtime.OD.app.loadArchive({
    conversations: [
      {
        id: "alpha",
        title: "第一段",
        createdAt: "2025-01-01T00:00:00.000Z",
        messages: [{ id: "alpha-1", role: "assistant", content: "前文。重点的一句话。重点的一句话又出现了。" }]
      },
      {
        id: "beta",
        title: "第二段",
        createdAt: "2026-01-01T00:00:00.000Z",
        messages: [{ id: "beta-1", role: "assistant", content: "另一段的话" }]
      }
    ]
  }, "Synthetic");
  runtime.OD.app.openConversation("alpha");

  const annotation = runtime.OD.app.addAnnotation({
    messageId: "alpha-1",
    selectedText: "重点的一句话",
    contextBefore: "。",
    contextAfter: "又出现了",
    color: "green",
    note: "这里要记住"
  });
  assert.equal(annotation.conversationId, "alpha");
  assert.equal(annotation.color, "green");
  assert.match(
    elements.get("messages").innerHTML,
    /<mark class="annotation hl-green noted" data-annotation-id="[^"]+">重点的一句话<\/mark>又出现了/,
    "context picks the second occurrence and the mark carries its color"
  );
  assert.match(elements.get("annotationsList").innerHTML, /这里要记住/);
  assert.equal(elements.get("annotationsCount").textContent, "1");

  const mirror = JSON.parse(stored.get("our-dialogues.reader-state.v1"));
  assert.equal(mirror.annotations.length, 1, "annotations persist with reader settings");
  assert.equal(mirror.annotationColor, "green", "the last-used pen color persists");

  runtime.OD.app.updateAnnotation(annotation.id, { color: "pink", note: "" });
  assert.match(elements.get("messages").innerHTML, /hl-pink/, "recoloring re-renders the mark");
  assert.doesNotMatch(elements.get("messages").innerHTML, /noted/, "clearing the note drops the noted style");

  runtime.OD.app.openConversation("beta");
  assert.equal(runtime.OD.app.jumpToAnnotation(annotation.id), true);
  assert.equal(runtime.OD.app.getState().current.id, "alpha", "jump reopens the annotated conversation");

  runtime.OD.app.removeAnnotation(annotation.id);
  assert.equal(runtime.OD.app.getState().annotations.length, 0);
  assert.doesNotMatch(elements.get("messages").innerHTML, /<mark/, "removing the annotation removes the mark");
});

test("an annotation whose source was removed stays listed but refuses to jump", async () => {
  const { runtime, elements } = await loadAppRuntime("asc");
  runtime.OD.app.loadArchive({
    conversations: [{
      id: "gone",
      title: "会被移除的一段",
      createdAt: "2025-01-01T00:00:00.000Z",
      messages: [{ id: "gone-1", role: "assistant", content: "被划过线的正文" }]
    }]
  }, "Removable");
  runtime.OD.app.openConversation("gone");
  const annotation = runtime.OD.app.addAnnotation({ messageId: "gone-1", selectedText: "划过线" });

  const sourceId = runtime.OD.app.getState().sources[0].id;
  runtime.OD.app.removeSource(sourceId);
  assert.equal(runtime.OD.app.getState().annotations.length, 1, "the annotation itself is not deleted");
  assert.match(elements.get("annotationsList").innerHTML, /来源不在书库中/);
  assert.equal(runtime.OD.app.jumpToAnnotation(annotation.id), false);
});
