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
    "fontSmaller", "fontLarger", "lineHeight", "contentWidth", "fontFamily", "printPreset",
    "readingMode", "pageLength", "uiLocale", "pageNavigation", "previousPage", "nextPage",
    "pageIndicator", "pageJump", "pageCount", "toTop", "toEnd",
    "readerToolbar", "readerMoreToggle", "readerMoreMenu", "voiceStatusLine", "readingProgressLabel",
    "bookmarkAdd", "bookmarksList", "bookmarksCount",
    "annotationsList", "annotationsCount", "highlightButton", "shijuButton",
    "annotationEditor", "annotationColors", "annotationNote",
    "annotationSave", "annotationCancel", "annotationDelete", "importPanel",
    "recentList", "recentCount",
    "searchHitCount", "searchScopeCurrent", "searchScopeLibrary", "searchSource", "searchQuery", "searchResults",
    "toolTabRecent", "toolTabBookmarks", "toolTabAnnotations", "toolTabSearch",
    "toolPanels", "recentPane", "bookmarksPane", "annotationsPane", "searchPane",
    "navLibrary", "navTraces", "libraryPane", "tracesPane",
    "filterMenu", "filterMenuToggle", "sourceAddToggle", "sourceAddMenu",
    "sourceManageToggle", "sourceManagePanel", "sourceManageList", "sourceManageClose",
    "libraryHome", "continueCard", "recentAdditions", "librarySummary",
    "aaDone", "themeCards", "presetCards", "resetPrefs",
    "readerPrefsToggle", "readerPrefsPanel", "sidebarClose", "sidebarBackdrop", "mobileHint",
    "favoriteToggle", "tagToggle", "tagEditor", "tagChips", "tagInput", "tagSuggestions",
    "favoritesFilter", "tagFilter",
    "exportToggle", "exportMenu", "exportCurrentMd", "exportCurrentJson", "exportListMd", "exportListJsonl",
    "exportListEpub", "exportCurrentHtml", "exportListHtml", "demoImport"
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
    TextEncoder,
    TextDecoder,
    setTimeout,
    clearTimeout,
    // The harness mirrors Dawn's real environment: a zh-CN browser, so the
    // "auto" locale resolves to zh-CN and existing Chinese-text assertions
    // keep describing the default UI.
    navigator: { language: "zh-CN", languages: ["zh-CN"] },
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
  if (options.matchMedia) runtime.matchMedia = options.matchMedia;
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
    "src/core/annotations.js",
    "src/core/reading-progress.js",
    "src/core/message-search.js",
    "src/core/solvoice-sidecar.js",
    "src/core/organization.js",
    "src/core/export.js",
    "src/core/zip-writer.js",
    "src/core/epub.js",
    "src/core/shiju-embed.js",
    "src/locales/zh-CN.js",
    "src/locales/en.js",
    "src/i18n.js"
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

test("拾句按钮：点击才触发懒加载；假 DOM 造不出 <script> 时软着陆到状态行", async () => {
  const { runtime, elements } = await loadAppRuntime("asc");
  runtime.OD.app.loadArchive({
    conversations: [{
      id: "shiju-1",
      title: "拾句段",
      createdAt: "2026-02-02T00:00:00.000Z",
      messages: [{ id: "shiju-1-m1", role: "assistant", speaker: "Ciel", content: "可以被摘走的一句话。" }]
    }]
  }, "ShijuSynthetic");
  runtime.OD.app.openConversation("shiju-1");

  // 全程 boot + 导入 + 开卷都没碰过拾句：包还没载
  assert.equal(runtime.__shijuEmbed, undefined, "boot 阶段不许载入拾句包");

  const highlight = elements.get("highlightButton");
  const shiju = elements.get("shijuButton");
  highlight.dataset.pending = JSON.stringify({
    messageId: "shiju-1-m1", selectedText: "可以被摘走的一句话", x: 10, y: 10
  });
  shiju.hidden = false;
  shiju.click();
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.equal(shiju.hidden, true, "点完按钮要收起");
  assert.equal(highlight.hidden, true, "标记钮一起收");
  // 懒加载在假 DOM 里造不出 <script>（document.createElement 不存在）→
  // Promise 拒绝 → 状态行如实说「拾句没能载入」，绝不静默
  assert.match(elements.get("status").textContent, /拾句没能载入/);
});

test("拾句按钮：跨消息禁用态点击只解释原因，不开面板", async () => {
  const { runtime, elements } = await loadAppRuntime("asc");
  runtime.OD.app.loadArchive({
    conversations: [{
      id: "shiju-2",
      title: "跨段",
      createdAt: "2026-02-02T00:00:00.000Z",
      messages: [{ id: "shiju-2-m1", role: "assistant", content: "第一条。" }]
    }]
  }, "ShijuSynthetic2");
  runtime.OD.app.openConversation("shiju-2");

  const shiju = elements.get("shijuButton");
  shiju.hidden = false;
  shiju.dataset.blocked = "1";
  shiju.click();
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.equal(shiju.hidden, true);
  assert.equal(shiju.dataset.blocked, undefined, "禁用标记要清掉");
  assert.match(elements.get("status").textContent, /一位说话人/);
  assert.equal(runtime.__shijuEmbed, undefined, "禁用态绝不触发懒加载");
});

test("the import section opens on an empty library, folds after import, and a manual choice wins", async () => {
  const { runtime, elements, stored } = await loadAppRuntime("asc");
  const panel = elements.get("importPanel");
  assert.equal(panel.open, true, "an empty library keeps the import buttons visible");

  runtime.OD.app.loadArchive({
    conversations: [{
      id: "only",
      title: "唯一的一段",
      createdAt: "2025-01-01T00:00:00.000Z",
      messages: [{ id: "only-1", role: "assistant", content: "正文" }]
    }]
  }, "Synthetic");
  assert.equal(panel.open, false, "the import section folds away once a library exists");

  panel.open = true;
  panel.dispatch("toggle");
  const mirror = JSON.parse(stored.get("our-dialogues.reader-state.v1"));
  assert.equal(mirror.importOpen, true, "a manual toggle persists as the user's choice");

  const sourceId = runtime.OD.app.getState().sources[0].id;
  runtime.OD.app.removeSource(sourceId);
  assert.equal(panel.open, true, "the recorded choice wins over the empty-library default");
});

test("each conversation resumes its own reading position and the recent panel tracks progress", async () => {
  const { runtime, elements, stored } = await loadAppRuntime("asc");
  const messages = n => Array.from({ length: 4 }, (_, i) => ({ id: `${n}-m${i + 1}`, role: "assistant", content: `${n} 第 ${i + 1} 条` }));
  runtime.OD.app.loadArchive({
    conversations: [
      { id: "alpha", title: "第一段", createdAt: "2025-01-01T00:00:00.000Z", messages: messages("alpha") },
      { id: "beta", title: "第二段", createdAt: "2026-01-01T00:00:00.000Z", messages: messages("beta") }
    ]
  }, "Synthetic");

  runtime.OD.app.openConversation("alpha");
  elements.get("main").scrollTop = 350;
  elements.get("main").dispatch("scroll");

  let progress = runtime.OD.app.getState().readingProgress.alpha;
  assert.equal(progress.messageId, "alpha-m4", "the anchor follows the visible message");
  assert.equal(progress.percent, 100, "reaching the last message counts as finished");

  runtime.OD.app.openConversation("beta");
  assert.equal(runtime.OD.app.getState().current.id, "beta");
  assert.deepEqual([...runtime.OD.app.getState().recentConversations], ["beta", "alpha"]);

  elements.get("main").scrollTop = 0;
  runtime.OD.app.openConversation("alpha");
  assert.ok(elements.get("main").scrollTop > 0, "a plain reopen resumes the stored position instead of the top");

  const mirror = JSON.parse(stored.get("our-dialogues.reader-state.v1"));
  assert.ok(mirror.readingProgress.alpha, "progress persists with reader settings");
  assert.ok(mirror.readingProgress.beta);

  assert.match(elements.get("recentList").innerHTML, /已读完/, "the recent panel shows finished progress");
  assert.match(elements.get("conversationList").innerHTML, /已读完/, "the conversation list carries the progress label");
});

test("bookmark jumps still win over resumed progress and missing recents refuse politely", async () => {
  const { runtime, elements } = await loadAppRuntime("asc");
  runtime.OD.app.loadArchive({
    conversations: [{
      id: "alpha",
      title: "第一段",
      createdAt: "2025-01-01T00:00:00.000Z",
      messages: Array.from({ length: 4 }, (_, i) => ({ id: `alpha-m${i + 1}`, role: "assistant", content: `第 ${i + 1} 条` }))
    }]
  }, "Synthetic");

  runtime.OD.app.openConversation("alpha");
  const bookmark = runtime.OD.app.addBookmark();
  elements.get("main").scrollTop = 350;
  elements.get("main").dispatch("scroll");

  runtime.OD.app.jumpToBookmark(bookmark.id);
  assert.ok(elements.get("main").scrollTop < 350, "an explicit bookmark jump beats the stored progress");

  const sourceId = runtime.OD.app.getState().sources[0].id;
  runtime.OD.app.removeSource(sourceId);
  assert.match(elements.get("recentList").innerHTML, /来源不在书库中/, "a removed source is labelled in the recent panel");
});

test("previous/next follow the sidebar's visible order, not the flat date order", async () => {
  const { runtime, elements } = await loadAppRuntime("asc");
  runtime.OD.app.loadArchive({
    source: { platform: "mufy", exporter: "mufy-batch-export" },
    conversations: [
      {
        id: "greeting-a",
        title: "开场白",
        createdAt: null,
        context: { sourceMetadata: { characterId: "char-a", characterName: "角色甲", isGreeting: true } },
        messages: [{ id: "greeting-a-1", role: "assistant", content: "开场白正文" }]
      },
      {
        id: "session-a1",
        title: "甲的一段",
        createdAt: "2024-01-01T00:00:00.000Z",
        context: { sourceMetadata: { characterId: "char-a", characterName: "角色甲" } },
        messages: [{ id: "session-a1-1", role: "assistant", content: "甲的正文" }]
      },
      {
        id: "session-b1",
        title: "乙的一段",
        createdAt: "2025-01-01T00:00:00.000Z",
        context: { sourceMetadata: { characterId: "char-b", characterName: "角色乙" } },
        messages: [{ id: "session-b1-1", role: "assistant", content: "乙的正文" }]
      }
    ]
  }, "Mufy folder");

  // Flat ascending date order is [session-a1, session-b1, greeting-a] — the
  // undated greeting lands last. The sidebar shows 角色甲 → [开场白, 甲的一段],
  // then 角色乙 → [乙的一段]; navigation must walk that visible order.
  runtime.OD.app.openConversation("greeting-a");
  elements.get("nextPage").click();
  assert.equal(runtime.OD.app.getState().current.id, "session-a1", "next from the greeting is its own character's first session");
  elements.get("nextPage").click();
  assert.equal(runtime.OD.app.getState().current.id, "session-b1", "then the next character's session");
  elements.get("previousPage").click();
  assert.equal(runtime.OD.app.getState().current.id, "session-a1");
  elements.get("previousPage").click();
  assert.equal(runtime.OD.app.getState().current.id, "greeting-a", "previous walks back to the pinned greeting");
});

test("full-text search scopes to the current conversation or the whole library and jumps exactly", async () => {
  const { runtime, elements, stored } = await loadAppRuntime("asc");
  runtime.OD.app.loadArchive({
    conversations: [
      {
        id: "alpha",
        title: "第一段",
        createdAt: "2025-01-01T00:00:00.000Z",
        messages: [
          { id: "alpha-m1", role: "assistant", content: "这里有关键词，后面还有一次关键词。" },
          { id: "alpha-m2", role: "user", content: "无关内容" }
        ]
      },
      {
        id: "beta",
        title: "第二段",
        createdAt: "2026-01-01T00:00:00.000Z",
        messages: [{ id: "beta-m1", role: "assistant", content: "另一段也提到关键词。" }]
      }
    ]
  }, "Synthetic");
  runtime.OD.app.openConversation("alpha");

  elements.get("searchQuery").value = "关键词";
  let hits = runtime.OD.app.performSearch();
  assert.equal(runtime.OD.app.getState().searchScope, "current");
  assert.equal(hits.length, 2, "current scope lists every occurrence in the open conversation only");
  assert.ok(hits.every(hit => hit.conversationId === "alpha"));
  assert.equal(elements.get("searchHitCount").textContent, "2");
  assert.match(elements.get("searchResults").innerHTML, /<b>关键词<\/b>/);

  elements.get("searchScopeLibrary").click();
  hits = runtime.OD.app.performSearch();
  assert.equal(hits.length, 3, "library scope adds the other conversation's hit");
  const mirror = JSON.parse(stored.get("our-dialogues.reader-state.v1"));
  assert.equal(mirror.searchScope, "library", "the chosen scope persists");

  const betaHit = hits.find(hit => hit.conversationId === "beta");
  assert.equal(runtime.OD.app.jumpToSearchHit(betaHit.conversationId, betaHit.messageId), true);
  assert.equal(runtime.OD.app.getState().current.id, "beta", "a hit jumps to its exact conversation and message");

  elements.get("searchQuery").value = "不存在的词";
  hits = runtime.OD.app.performSearch();
  assert.equal(hits.length, 0);
  assert.match(elements.get("searchResults").innerHTML, /没搜到/);
});

test("sidebar primary modes show one pane at a time and persist the choice", async () => {
  const { runtime, elements, stored } = await loadAppRuntime("asc");

  // Default mode is 书库: the library pane is visible, the others are not.
  assert.equal(elements.get("libraryPane").hidden, false, "library mode is the default");
  assert.equal(elements.get("tracesPane").hidden, true);
  assert.equal(elements.get("searchPane").hidden, true);
  assert.equal(elements.get("navLibrary").getAttribute("aria-pressed"), "true");

  // A trace tab switches to 阅读痕迹 with that segment active.
  elements.get("toolTabBookmarks").click();
  assert.equal(elements.get("libraryPane").hidden, true);
  assert.equal(elements.get("tracesPane").hidden, false);
  assert.equal(elements.get("toolPanels").hidden, false);
  assert.equal(elements.get("bookmarksPane").hidden, false);
  assert.equal(elements.get("recentPane").hidden, true);
  assert.equal(elements.get("navTraces").getAttribute("aria-pressed"), "true");
  assert.equal(elements.get("toolTabBookmarks").getAttribute("aria-pressed"), "true");

  // 搜索 is its own primary mode.
  elements.get("toolTabSearch").click();
  assert.equal(elements.get("tracesPane").hidden, true, "opening search leaves the traces mode");
  assert.equal(elements.get("searchPane").hidden, false);

  const mirror = JSON.parse(stored.get("our-dialogues.reader-state.v1"));
  assert.equal(mirror.toolTab, "search", "the open mode persists with reader settings");

  // 书库 returns; 阅读痕迹 remembers its last segment.
  elements.get("navLibrary").click();
  assert.equal(elements.get("libraryPane").hidden, false);
  assert.equal(elements.get("searchPane").hidden, true);
  assert.equal(JSON.parse(stored.get("our-dialogues.reader-state.v1")).toolTab, null,
    "library mode persists as the historical null value");
  elements.get("navTraces").click();
  assert.equal(elements.get("bookmarksPane").hidden, false, "traces reopen on the last used segment");
  assert.equal(runtime.OD.app.getState().current, null, "mode flips never open conversations");
});

test("old persisted toolTab values restore into the right sidebar mode", async () => {
  const stored = new Map([
    ["our-dialogues.conversation-sort", "asc"],
    ["our-dialogues.reader-state.v1", JSON.stringify({ toolTab: "annotations" })]
  ]);
  const { elements } = await loadAppRuntime("asc", { stored });
  assert.equal(elements.get("tracesPane").hidden, false, "a pre-redesign trace tab lands in 阅读痕迹");
  assert.equal(elements.get("annotationsPane").hidden, false);
  assert.equal(elements.get("libraryPane").hidden, true);
});

test("switching the interface language re-renders chrome, keeps the reading position, and persists", async () => {
  const { runtime, elements, stored } = await loadAppRuntime("asc");
  await runtime.OD.app.ready;
  runtime.OD.app.loadArchive({
    conversations: [
      {
        id: "conv-1", title: "第一篇", createdAt: "2026-01-01T08:00:00Z",
        messages: [
          { id: "m1", role: "user", content: "开场的问题" },
          { id: "m2", role: "assistant", content: "认真的回答" }
        ]
      },
      {
        id: "conv-2", title: "第二篇", createdAt: "2026-02-01T08:00:00Z",
        messages: [{ id: "m3", role: "user", content: "第二段开场" }]
      }
    ]
  }, "测试来源");
  const before = runtime.OD.app.getState();
  assert.ok(before.current, "loadArchive opens a conversation");
  assert.match(elements.get("archiveMeta").textContent, /段对话/);

  elements.get("uiLocale").value = "en";
  elements.get("uiLocale").dispatch("change");

  const after = runtime.OD.app.getState();
  assert.equal(after.current.id, before.current.id, "the open conversation survives the switch");
  assert.equal(after.page, before.page, "the page survives the switch");
  assert.equal(runtime.document.documentElement.lang, "en");
  assert.match(elements.get("archiveMeta").textContent, /conversations/, "sidebar meta re-renders in English");
  assert.match(elements.get("status").textContent, /Added:/, "the replayed archive status re-renders in English");
  assert.equal(JSON.parse(stored.get("our-dialogues.reader-state.v1")).locale, "en", "the choice persists");

  elements.get("uiLocale").value = "auto";
  elements.get("uiLocale").dispatch("change");
  assert.equal(runtime.document.documentElement.lang, "zh-CN", "auto resolves back through the zh browser");
  assert.match(elements.get("archiveMeta").textContent, /段对话/);
  assert.equal(JSON.parse(stored.get("our-dialogues.reader-state.v1")).locale, "auto");
});

test("a stored en locale boots the Reader with English runtime strings", async () => {
  const stored = new Map([
    ["our-dialogues.conversation-sort", "asc"],
    ["our-dialogues.reader-state.v1", JSON.stringify({ locale: "en" })]
  ]);
  const { runtime, elements } = await loadAppRuntime("asc", { stored });
  await runtime.OD.app.ready;
  assert.equal(runtime.OD.i18n.currentLocale(), "en", "the persisted locale wins over the zh browser");
  assert.equal(runtime.document.documentElement.lang, "en", "<html lang> follows the resolved locale");
  assert.equal(elements.get("status").textContent, "Files are parsed in your browser only and never uploaded.");
  assert.equal(elements.get("currentTitle").textContent, "No archive loaded yet");
});

test("legacy settings without a locale normalize to auto and keep the zh browser default", async () => {
  const stored = new Map([
    ["our-dialogues.conversation-sort", "asc"],
    ["our-dialogues.reader-state.v1", JSON.stringify({ toolTab: null })]
  ]);
  const { runtime, elements } = await loadAppRuntime("asc", { stored });
  await runtime.OD.app.ready;
  assert.equal(runtime.OD.i18n.currentSetting(), "auto", "missing locale normalizes to auto");
  assert.equal(runtime.OD.i18n.currentLocale(), "zh-CN", "auto resolves through the zh-CN fake navigator");
  assert.equal(runtime.document.documentElement.lang, "zh-CN");
  assert.equal(elements.get("status").textContent, "文件只在本机浏览器中解析，不会上传。");
});

test("library home renders continue-reading, recent additions, and summary without stealing the reader", async () => {
  const { runtime, elements } = await loadAppRuntime("asc");
  const conversation = (id, createdAt) => ({
    id, title: `篇章 ${id}`, createdAt,
    messages: [
      { id: `${id}-1`, role: "user", content: `${id} 的开头` },
      { id: `${id}-2`, role: "assistant", content: `${id} 的回应正文` }
    ]
  });
  runtime.OD.app.loadArchive({ conversations: [
    conversation("alpha", "2026-08-01T00:00:00.000Z"),
    conversation("beta", "2026-08-10T00:00:00.000Z"),
    conversation("gamma", "2026-08-20T00:00:00.000Z"),
    conversation("delta", "2026-07-01T00:00:00.000Z")
  ] }, "Home fixture");

  // Importing opened a conversation, so the reader is showing, not the home.
  assert.ok(elements.get("libraryHome").classList.contains("hidden"), "the home stays hidden while reading");
  const currentId = runtime.OD.app.getState().current.id;

  elements.get("navLibrary").click();
  assert.equal(elements.get("libraryHome").classList.contains("hidden"), false, "书库 shows the loaded home");
  assert.ok(elements.get("reader").classList.contains("hidden"));
  assert.equal(elements.get("currentTitle").textContent, "书库");
  assert.match(elements.get("continueCard").innerHTML, new RegExp(currentId),
    "the continue card points at the last reading position");
  const additions = elements.get("recentAdditions").innerHTML;
  assert.match(additions, /gamma/);
  assert.match(additions, /beta/);
  assert.match(additions, /alpha/);
  assert.doesNotMatch(additions, /delta/, "recent additions keep only the newest three");
  assert.match(elements.get("librarySummary").innerHTML, /个来源/);
  assert.equal(runtime.OD.app.getState().current.id, currentId, "showing the home never drops the open conversation");

  // Opening a conversation returns to the reader view.
  runtime.OD.app.openConversation("beta");
  assert.ok(elements.get("libraryHome").classList.contains("hidden"));
  assert.equal(elements.get("reader").classList.contains("hidden"), false);
});

test("year headings are display-only and appear only past the approved thresholds", async () => {
  const { runtime, elements } = await loadAppRuntime("asc");
  const conversation = (id, createdAt) => ({
    id, title: `对话 ${id}`, createdAt,
    messages: [{ id: `${id}-1`, role: "assistant", content: "正文" }]
  });

  // 12 conversations, 2 years, one undated (>=70% dated) → headings appear,
  // and the undated one sits under 日期不详 at the bottom.
  const eligible = {
    conversations: [
      ...Array.from({ length: 6 }, (_, i) => conversation(`a${i}`, `2025-0${(i % 6) + 1}-01T00:00:00.000Z`)),
      ...Array.from({ length: 5 }, (_, i) => conversation(`b${i}`, `2026-0${(i % 5) + 1}-01T00:00:00.000Z`)),
      conversation("undated", null)
    ]
  };
  runtime.OD.app.loadArchive(eligible, "Yearly");
  let markup = elements.get("conversationList").innerHTML;
  assert.match(markup, /year-heading[^>]*>2025</);
  assert.match(markup, /year-heading[^>]*>2026</);
  assert.match(markup, /year-heading[^>]*>日期不详</);
  assert.ok(markup.indexOf(">2025<") < markup.indexOf(">2026<"), "ascending sort keeps ascending year order");
  assert.ok(markup.indexOf("日期不详") > markup.indexOf(">2026<"), "undated items land at the bottom");

  // The visible reading order (previous/next) is untouched by grouping:
  // the undated conversation still follows the dated ones in import order.
  const order = runtime.OD.app.getState().filteredIds;
  assert.equal(order.at(-1), "undated");

  // Below the thresholds (one year only) no heading is rendered.
  runtime.OD.app.clearSources();
  const singleYear = {
    conversations: Array.from({ length: 12 }, (_, i) =>
      conversation(`c${i}`, `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`))
  };
  runtime.OD.app.loadArchive(singleYear, "OneYear");
  markup = elements.get("conversationList").innerHTML;
  assert.doesNotMatch(markup, /year-heading/, "a single-year source stays flat");
});

test("the Aa popover toggles and an outside click closes it", async () => {
  const { elements, dispatchDocument } = await loadAppRuntime("asc");
  const panel = elements.get("readerPrefsPanel");
  assert.equal(panel.hidden, true);

  elements.get("readerPrefsToggle").click();
  assert.equal(panel.hidden, false);
  dispatchDocument("click");
  assert.equal(panel.hidden, true, "clicking elsewhere closes the popover");
});

test("library search can target one chosen source, decoupled from the catalog filters", async () => {
  const { runtime, elements, stored } = await loadAppRuntime("asc");
  runtime.OD.app.loadArchive({
    conversations: [{
      id: "in-a",
      title: "来源A的一段",
      createdAt: "2025-01-01T00:00:00.000Z",
      messages: [{ id: "a-m1", role: "assistant", content: "两个来源都有的关键词" }]
    }]
  }, "Source A");
  runtime.OD.app.loadArchive({
    conversations: [{
      id: "in-b",
      title: "来源B的一段",
      createdAt: "2026-01-01T00:00:00.000Z",
      messages: [{ id: "b-m1", role: "assistant", content: "两个来源都有的关键词" }]
    }]
  }, "Source B");

  elements.get("searchQuery").value = "关键词";
  runtime.OD.app.setSearchScope("library");
  let hits = runtime.OD.app.performSearch();
  assert.equal(hits.length, 2, "all sources by default");

  const sourceB = runtime.OD.app.getState().sources.find(source => source.label === "Source B");
  const control = elements.get("searchSource");
  control.value = sourceB.id;
  control.dispatch("change");
  hits = runtime.OD.app.performSearch();
  assert.equal(hits.length, 1, "narrowed to the chosen source");
  assert.equal(hits[0].conversationId, "in-b");

  const mirror = JSON.parse(stored.get("our-dialogues.reader-state.v1"));
  assert.equal(mirror.searchSourceId, sourceB.id, "the chosen search source persists");

  runtime.OD.app.removeSource(sourceB.id);
  hits = runtime.OD.app.performSearch();
  assert.equal(runtime.OD.app.getState().searchSourceId ?? "all", "all", "a removed source falls back to all");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].conversationId, "in-a");
});

test("choosing another voice audio folder adds to the pool instead of replacing it", async () => {
  const { runtime } = await loadAppRuntime("asc");
  const voiceFile = (relativePath) => {
    const name = relativePath.split("/").pop();
    const file = new runtime.File([`synthetic:${name}`], name, { type: "audio/mpeg" });
    Object.defineProperty(file, "webkitRelativePath", { value: relativePath });
    return file;
  };

  await runtime.OD.app.loadSolVoiceFolder([
    voiceFile("VoiceArchive/sol/audio/sol-1.mp3"),
    voiceFile("VoiceArchive/ciel/ciel-1.mp3")
  ]);
  assert.equal(runtime.OD.app.getState().voiceAudioFileCount, 2);

  await runtime.OD.app.loadSolVoiceFolder([voiceFile("CielHouseAudio/house-1.mp3")]);
  assert.equal(runtime.OD.app.getState().voiceAudioFileCount, 3,
    "the House folder joins the pool without wiping the VoiceArchive");

  await runtime.OD.app.loadSolVoiceFolder([voiceFile("VoiceArchive/ciel/ciel-1.mp3")]);
  assert.equal(runtime.OD.app.getState().voiceAudioFileCount, 3,
    "re-picking the same path refreshes instead of duplicating");

  runtime.OD.app.clearSolVoice();
  assert.equal(runtime.OD.app.getState().voiceAudioFileCount, 0);
});

test("crossing the narrow breakpoint never strands the drawer without a way out", async () => {
  const mediaListeners = [];
  const mediaQuery = {
    matches: false,
    addEventListener(type, listener) { if (type === "change") mediaListeners.push(listener); }
  };
  const { elements } = await loadAppRuntime("asc", { matchMedia: () => mediaQuery });
  const sidebar = elements.get("sidebar");
  const backdrop = elements.get("sidebarBackdrop");

  assert.equal(sidebar.classList.contains("closed"), false, "desktop starts with the sidebar open");

  mediaQuery.matches = true;
  mediaListeners.forEach(listener => listener({ matches: true }));
  assert.equal(sidebar.classList.contains("closed"), true, "entering narrow closes the drawer");
  assert.equal(backdrop.hidden, true);

  elements.get("sidebarToggle").click();
  assert.equal(sidebar.classList.contains("closed"), false);
  assert.equal(backdrop.hidden, false, "an open drawer on narrow always shows its backdrop");

  elements.get("sidebarClose").click();
  assert.equal(sidebar.classList.contains("closed"), true, "the in-drawer ✕ closes it");
  assert.equal(backdrop.hidden, true);

  elements.get("sidebarToggle").click();
  mediaQuery.matches = false;
  mediaListeners.forEach(listener => listener({ matches: false }));
  assert.equal(backdrop.hidden, true, "leaving narrow retires the backdrop");
});

test("favorites and tags mark conversations, filter the catalog, and persist", async () => {
  const { runtime, elements, stored } = await loadAppRuntime("asc");
  runtime.OD.app.loadArchive({
    conversations: [
      { id: "fav-a", title: "要收藏的", createdAt: "2025-01-01T00:00:00.000Z",
        messages: [{ id: "a-1", role: "assistant", content: "正文A" }] },
      { id: "plain-b", title: "普通的", createdAt: "2026-01-01T00:00:00.000Z",
        messages: [{ id: "b-1", role: "assistant", content: "正文B" }] }
    ]
  }, "Synthetic");

  runtime.OD.app.openConversation("fav-a");
  assert.equal(runtime.OD.app.toggleFavorite(), true);
  assert.equal(elements.get("favoriteToggle").textContent, "⭐ 已收藏");
  assert.match(elements.get("conversationList").innerHTML, /conv-star/);

  runtime.OD.app.setConversationTags("fav-a", ["日常", " 旅行 "]);
  const state = runtime.OD.app.getState();
  assert.deepEqual([...state.organization.tags["fav-a"]], ["日常", "旅行"]);
  assert.match(elements.get("conversationList").innerHTML, /conv-tag/);
  assert.match(elements.get("tagFilter").innerHTML, /日常（1）/);

  runtime.OD.app.setFavoritesOnly(true);
  assert.deepEqual([...runtime.OD.app.getState().filteredIds], ["fav-a"], "favorites-only hides unstarred conversations");
  runtime.OD.app.setFavoritesOnly(false);

  runtime.OD.app.setTagFilter("旅行");
  assert.deepEqual([...runtime.OD.app.getState().filteredIds], ["fav-a"]);
  runtime.OD.app.setTagFilter("");
  assert.equal(runtime.OD.app.getState().filteredIds.length, 2);

  const mirror = JSON.parse(stored.get("our-dialogues.reader-state.v1"));
  assert.equal(mirror.organization.favorites["fav-a"] != null, true, "favorites persist with settings");
  assert.deepEqual([...mirror.organization.tags["fav-a"]], ["日常", "旅行"]);

  assert.equal(runtime.OD.app.toggleFavorite(), false, "toggling again unstars");
  assert.equal(elements.get("favoriteToggle").textContent, "☆ 收藏");
});

test("removing the last use of a tag resets a stale tag filter instead of stranding it", async () => {
  const { runtime } = await loadAppRuntime("asc");
  runtime.OD.app.loadArchive({
    conversations: [{ id: "only", title: "唯一", createdAt: "2025-01-01T00:00:00.000Z",
      messages: [{ id: "m1", role: "assistant", content: "正文" }] }]
  }, "Synthetic");
  runtime.OD.app.openConversation("only");
  runtime.OD.app.setConversationTags("only", ["临时"]);
  runtime.OD.app.setTagFilter("临时");
  assert.equal(runtime.OD.app.getState().tagFilter, "临时");

  runtime.OD.app.setConversationTags("only", []);
  assert.equal(runtime.OD.app.getState().tagFilter, "", "the vanished tag no longer filters");
  assert.equal(runtime.OD.app.getState().filteredIds.length, 1, "the catalog is not silently empty");
});

test("personal documents enter document mode, chats keep their transcript chrome", async () => {
  const { runtime, elements } = await loadAppRuntime("asc");
  await runtime.OD.app.ready;
  const personalArchive = {
    schema: "our-dialogues.normalized.v1",
    source: {
      platform: "personal-archive",
      exporter: "our-dialogues-personal-archive",
      formatVersion: 1,
      sourceLabel: "半夏的字纸箱",
      personalImport: { collections: 2, entries: 2, datedEntries: 1, undatedEntries: 1, skippedCollections: 0, skippedEntries: 0, types: { diary: 1, fragment: 1 } }
    },
    conversations: [
      {
        id: "personal:col-diary:diary-2016-03-17",
        title: "2016-03-17",
        createdAt: "2016-03-17T12:00:00.000Z",
        context: { room: null, sourceMetadata: { contentKind: "personal-document", collectionId: "col-diary", collectionName: "纸上日子", documentType: "diary", authorName: "半夏", titleSource: "date" } },
        participants: [{ id: "banxia", name: "半夏", role: "other" }],
        messages: [{ id: "personal:col-diary:diary-2016-03-17:body", role: "other", speaker: "半夏", createdAt: "2016-03-17T12:00:00.000Z", content: [{ type: "text", text: "青苔巷的猫有名字了。" }], metadata: { personalDocument: true } }]
      },
      {
        id: "personal:col-fragment:fragment-0001",
        title: "夹在旧课本里的一句话",
        createdAt: null,
        context: { room: null, sourceMetadata: { contentKind: "personal-document", collectionId: "col-fragment", collectionName: "字纸篓", documentType: "fragment", authorName: "半夏", titleSource: "first-line" } },
        participants: [{ id: "banxia", name: "半夏", role: "other" }],
        messages: [{ id: "personal:col-fragment:fragment-0001:body", role: "other", speaker: "半夏", createdAt: null, content: [{ type: "text", text: "夹在旧课本里的一句话，没头没尾。" }], metadata: { personalDocument: true } }]
      }
    ]
  };

  runtime.OD.app.loadArchive(personalArchive, personalArchive.source.sourceLabel);

  // The archive announces itself as a personal archive, by its own name.
  assert.equal(elements.get("status").textContent,
    "已导入私人文字档案：半夏的字纸箱 · 2 个集合，2 篇 · 共 1 个来源");
  assert.deepEqual([...runtime.OD.app.getState().sources.map(source => source.label)], ["半夏的字纸箱"]);

  // The dated diary opens first (asc sort): document mode, localized date title.
  assert.equal(runtime.OD.app.getState().current.id, "personal:col-diary:diary-2016-03-17");
  assert.equal(runtime.document.body.classList.contains("document-mode"), true);
  assert.equal(elements.get("currentTitle").textContent, "2016年3月17日");
  const personalMeta = String(elements.get("readerMeta").innerHTML);
  assert.ok(personalMeta.includes("纸上日子") && personalMeta.includes("半夏"), "meta reads collection · author");
  assert.ok(!personalMeta.includes(" 段"), "no transcript segment count for a document");

  // Bookmarks keep working on personal documents.
  assert.ok(runtime.OD.app.addBookmark(), "a bookmark anchors inside a personal document");

  // An undated fragment keeps its conservative title and no invented date.
  runtime.OD.app.openConversation("personal:col-fragment:fragment-0001");
  assert.equal(elements.get("currentTitle").textContent, "夹在旧课本里的一句话");
  assert.equal(runtime.document.body.classList.contains("document-mode"), true);

  // A chat conversation switches the chrome straight back.
  runtime.OD.app.loadArchive({
    conversations: [{
      id: "chat-1", title: "普通对话", createdAt: "2026-01-01T00:00:00.000Z",
      messages: [
        { id: "c1", role: "user", content: "问题" },
        { id: "c2", role: "assistant", content: "回答" }
      ]
    }]
  }, "聊天来源");
  assert.equal(runtime.OD.app.getState().current.id, "chat-1");
  assert.equal(runtime.document.body.classList.contains("document-mode"), false, "chats never enter document mode");
  assert.ok(String(elements.get("readerMeta").innerHTML).includes("2 段"), "chat meta keeps its segment count");

  // Reopening the personal document restores document mode.
  runtime.OD.app.openConversation("personal:col-diary:diary-2016-03-17");
  assert.equal(runtime.document.body.classList.contains("document-mode"), true);
});

test("personal collections group by declaration order with year and unknown-date headings", async () => {
  const { runtime, elements } = await loadAppRuntime("asc");
  await runtime.OD.app.ready;
  const doc = (collectionId, collectionName, documentType, id, createdAt, text) => ({
    id: `personal:${collectionId}:${id}`,
    title: createdAt ? String(createdAt).slice(0, 10) : text.slice(0, 8),
    createdAt,
    context: { room: null, sourceMetadata: {
      contentKind: "personal-document", collectionId, collectionName, documentType,
      authorName: "半夏", titleSource: createdAt ? "date" : "first-line"
    } },
    participants: [{ id: "banxia", name: "半夏", role: "other" }],
    messages: [{ id: `personal:${collectionId}:${id}:body`, role: "other", speaker: "半夏", createdAt, content: [{ type: "text", text }], metadata: { personalDocument: true } }]
  });
  runtime.OD.app.loadArchive({
    schema: "our-dialogues.normalized.v1",
    source: { platform: "personal-archive", exporter: "our-dialogues-personal-archive", formatVersion: 1, sourceLabel: "半夏的字纸箱" },
    conversations: [
      doc("col-diary", "纸上日子", "diary", "d-2015-05-01", "2015-05-01T12:00:00.000Z", "旧年的一页。"),
      doc("col-diary", "纸上日子", "diary", "d-2016-03-17", "2016-03-17T12:00:00.000Z", "青苔巷的猫。"),
      doc("col-diary", "纸上日子", "diary", "d-undated", null, "没有日期的一页。"),
      doc("col-frag", "字纸篓", "fragment", "f-0001", null, "一句没头没尾的话。")
    ]
  }, "半夏的字纸箱");

  const list = String(elements.get("conversationList").innerHTML);
  assert.ok(list.includes("::collection:col-diary"), "collections persist under the collection-prefixed group key");
  assert.match(list, /title="日记">纸上日子</, "the collection summary names the collection with its localized type");
  assert.match(list, /title="碎片">字纸篓</);
  assert.match(list, /year-heading[^>]*>2015</);
  assert.match(list, /year-heading[^>]*>2016</);
  assert.match(list, /year-heading[^>]*>日期未知</, "undated entries trail under the localized unknown-date heading");
  assert.equal(list.split("year-heading").length - 1, 3, "the single-year fragment collection stays flat");
  assert.ok(list.indexOf("纸上日子") < list.indexOf("字纸篓"), "collection order follows the archive declaration order");

  // The sidebar's visible order doubles as the reading order, across collections.
  assert.equal(runtime.OD.app.getState().current.id, "personal:col-diary:d-2015-05-01");
  elements.get("nextPage").click();
  assert.equal(runtime.OD.app.getState().current.id, "personal:col-diary:d-2016-03-17");
  elements.get("nextPage").click();
  assert.equal(runtime.OD.app.getState().current.id, "personal:col-diary:d-undated");
  elements.get("nextPage").click();
  assert.equal(runtime.OD.app.getState().current.id, "personal:col-frag:f-0001",
    "next crosses into the following collection exactly as the eye sees it");
  assert.equal(elements.get("nextPage").disabled, true, "the last visible entry is the end of the reading order");
});

test("search results and home cards show collection provenance for personal documents", async () => {
  const { runtime, elements } = await loadAppRuntime("asc");
  await runtime.OD.app.ready;
  runtime.OD.app.loadArchive({
    schema: "our-dialogues.normalized.v1",
    source: { platform: "personal-archive", exporter: "our-dialogues-personal-archive", formatVersion: 1, sourceLabel: "半夏的字纸箱" },
    conversations: [{
      id: "personal:col-diary:diary-2016-03-17",
      title: "2016-03-17",
      createdAt: "2016-03-17T12:00:00.000Z",
      context: { room: null, sourceMetadata: { contentKind: "personal-document", collectionId: "col-diary", collectionName: "纸上日子", documentType: "diary", authorName: "半夏", titleSource: "date" } },
      participants: [{ id: "banxia", name: "半夏", role: "other" }],
      messages: [{ id: "personal:col-diary:diary-2016-03-17:body", role: "other", speaker: "半夏", createdAt: "2016-03-17T12:00:00.000Z", content: "猫在落雨前蹲上配电箱。", metadata: { personalDocument: true } }]
    }]
  }, "半夏的字纸箱");

  runtime.OD.app.setSearchScope("library");
  elements.get("searchQuery").value = "配电箱";
  const hits = runtime.OD.app.performSearch();
  assert.equal(hits.length, 1);
  const resultsHTML = String(elements.get("searchResults").innerHTML);
  assert.ok(resultsHTML.includes("纸上日子 · 2016年3月17日"), "provenance reads collection · entry");
  assert.ok(!resultsHTML.includes("· 半夏"), "no speaker prefix on a personal document hit");

  elements.get("navLibrary").click();
  const continueHTML = String(elements.get("continueCard").innerHTML);
  assert.ok(continueHTML.includes("2016年3月17日"), "the continue card title is the localized date");
  assert.ok(continueHTML.includes("纸上日子"), "the continue card names the collection");
  assert.ok(!continueHTML.includes("第 1 / 1 段"), "no segment position for a one-page document");
});

test("the demo library loads synthetic sources once and skips duplicates on a second click", async () => {
  const { runtime } = await loadAppRuntime("asc");
  runtime.OD.registry = {
    async parseJSON(data) {
      return { recognized: true, adapter: { label: data.label }, archive: data.archive };
    }
  };
  const served = new Map([
    ["fixtures/normalized-v1.json", { label: "Normalized", archive: { conversations: [{ id: "demo-n", title: "示例甲", createdAt: "2025-01-01T00:00:00.000Z", messages: [{ id: "n-1", role: "assistant", content: "合成正文" }] }] } }],
    ["fixtures/ciel-house-v1.json", { label: "Ciel House", archive: { conversations: [{ id: "demo-c", title: "示例乙", createdAt: "2025-02-01T00:00:00.000Z", messages: [{ id: "c-1", role: "assistant", content: "合成正文二" }] }] } }]
  ]);
  const fetcher = async url => served.has(url)
    ? { ok: true, json: async () => served.get(url) }
    : { ok: false };

  const added = await runtime.OD.app.loadDemoLibrary(fetcher);
  assert.equal(added, 2, "every reachable fixture becomes a source");
  const labels = runtime.OD.app.getState().sources.map(source => source.label);
  assert.deepEqual([...labels], ["示例 · Normalized", "示例 · Ciel House"]);

  await runtime.OD.app.loadDemoLibrary(fetcher);
  assert.equal(runtime.OD.app.getState().sources.length, 2, "a second click never duplicates the demo sources");
});

test("exports carry the reading surface and respect the filtered list", async () => {
  const { runtime } = await loadAppRuntime("asc");
  assert.equal(runtime.OD.app.buildExport("current-markdown"), null, "no current conversation before any import");

  runtime.OD.app.loadArchive({
    conversations: [
      { id: "exp-a", title: "第一段", createdAt: "2025-01-01T00:00:00.000Z",
        messages: [
          { id: "a-1", role: "user", speaker: "You", content: "问题" },
          { id: "a-2", role: "assistant", speaker: "Ciel", content: "回答",
            thinking: "内部思考", metadata: { sourceTrace: [{ type: "tool_use", text: "→ tool" }] } }
        ] },
      { id: "exp-b", title: "第二段", createdAt: "2026-01-01T00:00:00.000Z",
        messages: [{ id: "b-1", role: "assistant", speaker: "Ciel", content: "另一段" }] }
    ]
  }, "Synthetic");

  runtime.OD.app.openConversation("exp-a");
  const markdown = runtime.OD.app.buildExport("current-markdown");
  assert.equal(markdown.filename, "第一段.md");
  assert.match(markdown.content, /# 第一段/);
  assert.match(markdown.content, /\*\*Ciel\*\*/);
  assert.match(markdown.content, /回答/);
  assert.match(markdown.content, /未包含在本导出中：思考 1 条 · 工具轨迹 1 条/);
  assert.doesNotMatch(markdown.content, /内部思考/, "thinking text never leaks into Markdown");

  const json = runtime.OD.app.buildExport("current-json");
  assert.equal(JSON.parse(json.content).id, "exp-a");

  const jsonl = runtime.OD.app.buildExport("list-jsonl");
  const lines = jsonl.content.trim().split("\n");
  assert.equal(lines.length, 2);
  assert.deepEqual(lines.map(line => JSON.parse(line).id), ["exp-a", "exp-b"]);

  runtime.OD.app.setConversationTags("exp-b", ["只要这个"]);
  runtime.OD.app.setTagFilter("只要这个");
  const narrowed = runtime.OD.app.buildExport("list-markdown");
  assert.match(narrowed.content, /第二段/);
  assert.doesNotMatch(narrowed.content, /第一段/, "list exports follow the live filters");

  runtime.OD.app.setTagFilter("");
  const epub = runtime.OD.app.buildExport("list-epub");
  assert.equal(epub.mimeType, "application/epub+zip");
  assert.match(epub.filename, /\.epub$/);
  assert.ok(epub.content.length > 500, "EPUB bytes are produced");

  const html = runtime.OD.app.buildExport("list-html");
  assert.equal(html.mimeType, "text/html");
  assert.match(html.content, /<!doctype html>/);
  assert.match(html.content, /class="toc"/, "multi-conversation HTML gets a table of contents");
  assert.match(html.content, /id="c2"/);
  assert.doesNotMatch(html.content, /内部思考/, "thinking never leaks into HTML either");

  const single = runtime.OD.app.buildExport("current-html");
  assert.match(single.filename, /\.html$/);
  assert.doesNotMatch(single.content, /class="toc"/, "a single conversation needs no TOC");
});
