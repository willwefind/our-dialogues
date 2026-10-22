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
    // Real elements always have a style object; without one the Reader's
    // background code threw asynchronously in every test run.
    style: {},
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
    // A real click carries the deepest element as its target, not the element
    // the listener sits on — delegation tests need to say which one.
    dispatch(type, target, details = {}) { return listeners.get(type)?.({ target: target || this, ...details }); },
    click() { return listeners.get("click")?.({ target: this }); },
    setAttribute(name, value) { this.attributes.set(name, String(value)); },
    getAttribute(name) { return this.attributes.get(name) ?? null; },
    removeAttribute(name) { this.attributes.delete(name); },
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
    "sourceFilter", "sourceRow", "shelfSelectToggle", "shelfSelectBar", "shelfSelectCount", "shelfSelectDone", "shelfSelectTarget", "shelfSelectApply", "shelfSelectNewName", "shelfNewGroupDrop", "clearSources", "hideUser", "showThinking", "theme", "sidebarToggle", "sidebar",
    "directoryPicker", "localLibraryStatus", "clearLocalLibrary", "acceptanceAudit", "runAcceptanceAudit",
    "fontSmaller", "fontLarger", "lineHeight", "contentWidth", "contentNarrower", "contentWider", "contentWidthValue", "fontFamily", "printPreset",
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
    "libraryHome", "continueCard",
    "customBackground",
    "backgroundAccordion",
    "backgroundPreview",
    "backgroundEmpty",
    "backgroundInput",
    "backgroundChooseLabel",
    "backgroundRemove",
    "backgroundEnabled",
    "backgroundStatus",
    "backgroundPaperWarning",
    "backgroundScaleNote",
    "backgroundFocus",
    "backgroundBrightness",
    "backgroundBrightnessValue",
    "backgroundClarity",
    "backgroundClarityValue",
    "backgroundPaperOpacityRow",
    "backgroundPaperOpacity",
    "backgroundPaperOpacityValue",
    "memorialCard",
    "companionPicker",
    "companionPickerTitle",
    "companionSearch",
    "companionPickerHint",
    "companionList",
    "companionPickerClose",
    "memorialMenu",
    "memorialEditDate",
    "memorialRename",
    "memorialManagePinned",
    "memorialNameEditor",
    "memorialNameTitle",
    "memorialNameClose",
    "memorialNameInput",
    "memorialArchiveName",
    "memorialNameRestore",
    "memorialNameCancel",
    "memorialNameSave",
    "memorialDateEditor",
    "memorialDateTitle",
    "memorialDateClose",
    "memorialDateInput",
    "memorialTimeInput",
    "memorialArchiveLine",
    "memorialRestore",
    "memorialCancel",
    "memorialSave", "recentAdditions", "librarySummary",
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
  // A recording stand-in for the root element's inline style, so custom
  // properties the Reader sets can be read back.
  const rootStyle = {
    props: new Map(),
    setProperty(name, value) { this.props.set(name, String(value)); },
    removeProperty(name) { this.props.delete(name); },
    getPropertyValue(name) { return this.props.get(name) ?? ""; }
  };
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
    // The picture reaches a layer as an object URL; one stand-in is enough.
    URL: { createObjectURL: () => "blob:probe", revokeObjectURL() {} },
    localStorage: {
      getItem(key) { return stored.get(key) ?? null; },
      setItem(key, value) { stored.set(key, value); }
    },
    document: {
      body: fakeElement("body"),
      documentElement: { dataset: {}, style: rootStyle },
      visibilityState: "visible",
      getElementById(id) { return elements.get(id); },
      addEventListener(type, listener) { documentListeners.set(type, listener); },
      querySelectorAll(selector) {
        if (selector === "[data-sort-mode]") return [sortAscending, sortDescending];
        return [];
      },
      // The memorial menu items find the card this way to learn whose card
      // they are acting on.
      querySelector(selector) {
        if (selector !== ".memorial-card") return null;
        const key = /data-companion-key="([^"]+)"/
          .exec(elements.get("memorialCard")?.innerHTML || "")?.[1];
        return key ? { dataset: { companionKey: key } } : null;
      }
    }
  };
  runtime.window = runtime;
  runtime.addEventListener = () => {};
  if (options.matchMedia) runtime.matchMedia = options.matchMedia;
  // Site data blocked: Chrome and Safari throw on merely reading the property.
  if (options.blockedStorage) {
    Object.defineProperty(runtime, "localStorage", {
      get() { throw new DOMException("The operation is insecure.", "SecurityError"); }
    });
  }
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
    "src/core/source-shelf.js",
    "src/core/companionship.js",
    "src/core/reader-background.js",
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
    rootStyle,
    dispatchDocument(type, target, details = {}) {
      return documentListeners.get(type)?.({ target: target || runtime.document, ...details });
    }
  };
}

function ids(conversations) {
  return [...conversations.map(conversation => conversation.id)];
}

async function createMemoryPersistenceDriver(options={}) {
  const runtime = { console, Blob, File, Date, setTimeout, clearTimeout };
  runtime.window = runtime;
  vm.createContext(runtime);
  vm.runInContext(
    await readFile(path.join(repositoryRoot, "src/core/persistent-library.js"), "utf8"),
    runtime,
    { filename: "src/core/persistent-library.js" }
  );
  return runtime.OD.persistentLibrary._internals.createMemoryDriver(options);
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

async function bootWithBackground(background) {
  const driver = await createMemoryPersistenceDriver({ settings: { background } });
  await driver.setAsset("background-image", { blob: { size: 1 } });
  const harness = await loadAppRuntime("asc", { driver });
  await harness.runtime.OD.app.ready;
  // The picture is fetched from its own record after settings name it, and
  // that lookup is not part of the boot promise.
  await new Promise(resolve => setTimeout(resolve, 0));
  return harness;
}

test("both background targets ride one viewport-sized layer, and only the sheet differs", async () => {
  const base = { enabled: true, assetId: "probe", fit: "fill", paperOpacity: 40 };

  // The reading-paper target used to paint the picture inside the sheet, which
  // is as tall as its conversation — the same image came out 0.37x in a
  // one-line entry and 7.4x in an 82-message chat. It thins the paper now and
  // leaves the picture on the fixed layer, so every conversation matches.
  const paper = await bootWithBackground({ ...base, target: "paper" });
  assert.equal(paper.elements.get("customBackground").hidden, false,
    "the fixed layer carries the picture for the paper target too");
  assert.equal(paper.rootStyle.getPropertyValue("--od-reader-paper-alpha"), "0.4",
    "paper density reaches the sheet");
  assert.equal(paper.rootStyle.getPropertyValue("--od-reader-bg-image"), "",
    "the sheet never carries a picture of its own again");
  assert.equal(paper.runtime.document.body.dataset.backgroundTarget, "paper");

  // The outer stage leaves the sheet alone.
  const outer = await bootWithBackground({ ...base, target: "outer" });
  assert.equal(outer.elements.get("customBackground").hidden, false);
  assert.equal(outer.rootStyle.getPropertyValue("--od-reader-paper-alpha"), "",
    "an opaque sheet needs no density");
  assert.equal(outer.runtime.document.body.dataset.backgroundTarget, "outer");
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
      conversation(`c${i}`, `2026-06-${String(i + 1).padStart(2, "0")}T12:00:00.000Z`))
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

/* A target that models a real click: the deepest element, which answers
   closest() for its own selector and nothing else. */
function clickTarget(dataKey, value="1") {
  const element = fakeElement("");
  element.dataset[dataKey] = value;
  const marker = dataKey.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);
  element.closest = selector => (selector.includes(`data-${marker}`) ? element : null);
  return element;
}

async function loadTwoCompanions() {
  const harness = await loadAppRuntime("asc");
  harness.runtime.OD.app.loadArchive({
    conversations: [{
      id: "sol-1", title: "\u4e00", createdAt: "2026-03-22T12:00:00.000Z",
      messages: [{ id: "sol-1-m1", role: "assistant", content: "\u5728" }]
    }]
  }, "Sol");
  harness.runtime.OD.app.loadArchive({
    conversations: [{
      id: "ciel-1", title: "\u4e8c", createdAt: "2026-04-01T12:00:00.000Z",
      messages: [{ id: "ciel-1-m1", role: "assistant", content: "\u5728" }]
    }]
  }, "Ciel");
  return harness;
}

function companionKeyOnCard(card) {
  return /data-companion-key="([^"]+)"/.exec(card.innerHTML)?.[1] || null;
}

test("\u6362\u4e00\u4f4d and \u7ba1\u7406\u7f6e\u9876 open the same list in two different modes", async () => {
  const { elements } = await loadTwoCompanions();
  const heading = elements.get("companionPickerTitle");
  const hint = elements.get("companionPickerHint");
  const list = elements.get("companionList");
  elements.get("companionPicker").hidden = true;

  // The chevron on the card picks who is remembered; it says nothing about pins.
  elements.get("memorialCard").dispatch("click", clickTarget("memorialOpen"));
  assert.equal(elements.get("companionPicker").hidden, false);
  assert.equal(heading.textContent, "\u9009\u62e9\u8981\u7eaa\u5ff5\u7684\u4e00\u4f4d");
  assert.equal(hint.hidden, true, "picking mode keeps the pin hint out of the way");
  assert.doesNotMatch(list.innerHTML, /companion-pin-label/, "the pin stays a quiet icon");
  elements.get("companionPickerClose").click();

  // \u7ba1\u7406\u7f6e\u9876 opens the same list to work on the pins, and says so.
  elements.get("memorialCard").dispatch("click", clickTarget("memorialMenu"));
  elements.get("memorialManagePinned").click();
  assert.equal(heading.textContent, "\u7ba1\u7406\u7f6e\u9876", "the heading names the job");
  assert.equal(hint.hidden, false, "managing pins explains what pinning buys");
  assert.match(list.innerHTML, /companion-pin-label/, "the pin action is spelled out");

  // Closing drops back to picking, so the next chevron click is not in manage mode.
  elements.get("companionPickerClose").click();
  elements.get("memorialCard").dispatch("click", clickTarget("memorialOpen"));
  assert.equal(hint.hidden, true);
});

test("a companion can be called what the reader calls it, archive name one click away", async () => {
  const { runtime, elements } = await loadTwoCompanions();
  const card = elements.get("memorialCard");
  const shownName = () => /class="memorial-name-button"[^>]*>([^<]*)</.exec(card.innerHTML)?.[1] || "";

  // Choose whose card this is the way a reader does, through the picker.
  const sol = runtime.OD.app.getState().sources.find(source => source.label === "Sol");
  const key = runtime.OD.companionship.companionKey(sol.id, null);
  elements.get("companionList").dispatch("click", clickTarget("companionPick", key));
  assert.match(shownName(), /Sol/, "the archive's own label is the honest default");

  card.dispatch("click", clickTarget("memorialMenu"));
  elements.get("memorialRename").click();
  assert.equal(elements.get("memorialNameEditor").hidden, false);
  assert.match(elements.get("memorialArchiveName").textContent, /Sol/,
    "the editor keeps the archive's own name in view");
  assert.equal(elements.get("memorialNameRestore").disabled, true, "nothing to restore to yet");

  elements.get("memorialNameInput").value = "小 S";
  elements.get("memorialNameSave").click();
  assert.match(shownName(), /小 S/, "the card calls the companion what the reader does");
  assert.equal(elements.get("memorialNameEditor").hidden, true);

  // Renaming leaves the archive's own name underneath: the picker still
  // answers to it, and Restore has somewhere to go back to.
  elements.get("companionPicker").hidden = true;
  card.dispatch("click", clickTarget("memorialOpen"));
  const search = elements.get("companionSearch");
  search.value = "Sol";
  search.dispatch("input");
  assert.match(elements.get("companionList").innerHTML, /小 S/,
    "found by its archive name, shown by its new one");
  elements.get("companionPickerClose").click();

  card.dispatch("click", clickTarget("memorialMenu"));
  elements.get("memorialRename").click();
  assert.equal(elements.get("memorialNameRestore").disabled, false);
  elements.get("memorialNameRestore").click();
  assert.match(shownName(), /Sol/, "the archive's own name comes back whole");
});

test("pinning from inside the picker does not read as a click from outside it", async () => {
  const { runtime, elements, dispatchDocument } = await loadTwoCompanions();
  const picker = elements.get("companionPicker");
  picker.hidden = true;
  elements.get("memorialCard").dispatch("click", clickTarget("memorialOpen"));
  assert.equal(picker.hidden, false);

  const key = runtime.OD.companionship
    .companionKey(runtime.OD.app.getState().sources[0].id, null);
  const pin = clickTarget("companionPin", key);
  elements.get("companionList").dispatch("click", pin);

  // Pinning rebuilds the rows, so the button the reader pressed has left the
  // document by the time the same click reaches the closer, and a detached
  // node answers closest() with null.
  pin.isConnected = false;
  pin.closest = () => null;
  dispatchDocument("click", pin);
  assert.equal(picker.hidden, false, "the picker survives its own pin button");

  // A real outside click still closes it.
  dispatchDocument("click");
  assert.equal(picker.hidden, true);
});

test("the card's arrows wake up once two companions are pinned", async () => {
  const { runtime, elements } = await loadTwoCompanions();
  const card = elements.get("memorialCard");
  assert.match(card.innerHTML, /data-memorial-step="-1" disabled/, "nothing to step through yet");
  assert.match(card.innerHTML, /\u7f6e\u9876\u4e24\u4f4d\u4ee5\u4e0a\u624d\u80fd\u5de6\u53f3\u5207\u6362/,
    "the dead arrows say why they are dead");

  // Pin both the way the reader does: through the rows in the picker.
  const keys = runtime.OD.app.getState().sources
    .map(source => runtime.OD.companionship.companionKey(source.id, null));
  for (const key of keys) {
    elements.get("companionList").dispatch("click", clickTarget("companionPin", key));
  }
  assert.doesNotMatch(card.innerHTML, /disabled/, "two pins bring the arrows to life");

  const before = companionKeyOnCard(card);
  card.dispatch("click", clickTarget("memorialStep", "1"));
  const after = companionKeyOnCard(card);
  assert.notEqual(after, before, "the arrow moves to the other pinned companion");
  assert.ok(keys.includes(after), "and it lands on a pinned one");
});

test("the memorial menu's manage-pinned item opens the picker and it stays open", async () => {
  const { elements, dispatchDocument } = await loadAppRuntime("asc");
  const menu = elements.get("memorialMenu");
  const picker = elements.get("companionPicker");
  menu.hidden = true;
  picker.hidden = true;

  // The ··· button inside the card opens the little menu.
  const menuButton = fakeElement("");
  menuButton.dataset.memorialMenu = "";
  menuButton.closest = selector => (selector.includes("[data-memorial-menu]") ? menuButton : null);
  elements.get("memorialCard").dispatch("click", menuButton);
  assert.equal(menu.hidden, false, "the ··· button opens the memorial menu");

  // Choosing 管理置顶 closes the menu and opens the picker...
  elements.get("memorialManagePinned").click();
  assert.equal(menu.hidden, true);
  assert.equal(picker.hidden, false, "manage-pinned opens the companion picker");

  // ...and that same click, still bubbling to the document closer, must not
  // shut the picker it just opened. That was the dead-button bug.
  const item = elements.get("memorialManagePinned");
  item.closest = selector => (selector.includes("#memorialManagePinned") ? item : null);
  dispatchDocument("click", item);
  assert.equal(picker.hidden, false, "the opener is not an outside click");

  // A genuine click elsewhere still closes it.
  dispatchDocument("click");
  assert.equal(picker.hidden, true, "clicking elsewhere closes the picker");
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

test("sources can be renamed and filed into reader-made groups, and the shelf persists", async () => {
  const { runtime, elements, stored } = await loadAppRuntime("asc");
  const makeArchive = (platform, id) => ({
    source: { platform, exporter: `${platform}-synthetic` },
    conversations: [{
      id,
      title: `${platform} title`,
      createdAt: "2026-08-16T00:00:00.000Z",
      participants: [],
      messages: [{ id: `${id}-message`, role: "assistant", content: `${platform} body` }]
    }]
  });
  const claudeArchive = makeArchive("claude", "claude-chat");
  runtime.OD.app.loadArchive(claudeArchive, "Claude JSON");
  runtime.OD.app.loadArchive(makeArchive("chatgpt", "chatgpt-chat"), "ChatGPT official export");
  runtime.OD.app.loadArchive(makeArchive("normalized", "plain-chat"), "Normalized JSON");
  const byPlatform = platform => runtime.OD.app.getState().sources.find(source => source.platform === platform);
  const list = () => elements.get("conversationList").innerHTML;
  const mirror = () => JSON.parse(stored.get("our-dialogues.reader-state.v1"));

  runtime.OD.app.renameSource(byPlatform("chatgpt").id, "  和 Sol 的对话 ");
  assert.equal(byPlatform("chatgpt").displayName, "和 Sol 的对话");
  assert.equal(byPlatform("chatgpt").label, "ChatGPT official export", "the archive label itself is untouched");
  assert.match(list(), /class="source-summary-label"[^>]*>和 Sol 的对话</);
  assert.match(list(), /原名 · ChatGPT official export/, "the menu still shows where the source came from");
  assert.match(elements.get("sourceFilter").innerHTML, /和 Sol 的对话（1）/);
  assert.equal(mirror().sourceShelf.names[byPlatform("chatgpt").id], "和 Sol 的对话");

  runtime.OD.app.openConversation("chatgpt-chat");
  assert.match(elements.get("readerMeta").innerHTML, /<span data-source-label>和 Sol 的对话<\/span>/);

  runtime.OD.app.moveSourceToNewGroup(byPlatform("chatgpt").id, "旧日");
  const groupId = runtime.OD.app.getState().sourceShelf.groups[0].id;
  runtime.OD.app.setSourceGroup(byPlatform("normalized").id, groupId);
  const html = list();
  const groupStart = html.indexOf('class="shelf-group"');
  assert.ok(groupStart >= 0, "the group is drawn");
  assert.ok(html.indexOf(byPlatform("claude").id) < groupStart, "an ungrouped source before the group keeps its place");
  assert.ok(html.indexOf(byPlatform("chatgpt").id) > groupStart && html.indexOf(byPlatform("normalized").id) > groupStart);
  assert.match(html, /class="shelf-group-label">旧日<\/span>\s*<span class="source-count">2</);

  elements.get("sourceFilter").value = `group:${groupId}`;
  elements.get("sourceFilter").dispatch("change");
  assert.deepEqual([...runtime.OD.app.getState().filteredIds].sort(), ["chatgpt-chat", "plain-chat"]);
  assert.match(elements.get("sourceFilter").innerHTML, /<optgroup label="旧日"><option value="group:[^"]+">整组 · 旧日（2）/);

  runtime.OD.app.renameSourceGroup(groupId, "   ");
  assert.equal(runtime.OD.app.getState().sourceShelf.groups[0].name, "旧日", "an empty group name is refused");
  runtime.OD.app.renameSourceGroup(groupId, "Sol 那边");
  assert.match(list(), /class="shelf-group-label">Sol 那边</);

  // A source removed and imported again comes back under its name and in its group.
  const claudeId = byPlatform("claude").id;
  runtime.OD.app.renameSource(claudeId, "小克");
  runtime.OD.app.setSourceGroup(claudeId, groupId);
  assert.equal(runtime.OD.app.removeSource(claudeId), true);
  runtime.OD.app.loadArchive(claudeArchive, "Claude JSON");
  assert.equal(byPlatform("claude").displayName, "小克");
  assert.equal(runtime.OD.app.getState().sourceShelf.members[claudeId], groupId);

  runtime.OD.app.dissolveSourceGroup(groupId);
  assert.doesNotMatch(list(), /shelf-group/);
  assert.equal(runtime.OD.app.getState().sourceFilter, "all", "a filter on the dissolved group falls back to all");
  assert.equal(runtime.OD.app.getState().sources.length, 3, "dissolving removes nothing");

  runtime.OD.app.renameSource(byPlatform("chatgpt").id, "");
  assert.equal(byPlatform("chatgpt").displayName, "ChatGPT official export");
  assert.deepEqual(Object.keys(mirror().sourceShelf.names), [claudeId]);
});

test("整理 mode picks several sources and files them together, then lets go", async () => {
  const { runtime, elements } = await loadAppRuntime("asc");
  const makeArchive = (platform, id) => ({
    source: { platform, exporter: `${platform}-synthetic` },
    conversations: [{
      id, title: `${platform} title`, createdAt: "2026-08-16T00:00:00.000Z", participants: [],
      messages: [{ id: `${id}-message`, role: "assistant", content: `${platform} body` }]
    }]
  });
  runtime.OD.app.loadArchive(makeArchive("claude", "claude-chat"), "Claude JSON");
  runtime.OD.app.loadArchive(makeArchive("chatgpt", "chatgpt-chat"), "ChatGPT");
  runtime.OD.app.loadArchive(makeArchive("normalized", "plain-chat"), "Normalized JSON");
  const ids = runtime.OD.app.getState().sources.map(source => source.id);
  const bar = elements.get("shelfSelectBar");
  assert.equal(bar.hidden, true);

  elements.get("shelfSelectToggle").click();
  assert.equal(runtime.OD.app.getState().shelfSelecting, true);
  assert.equal(bar.hidden, false);
  assert.equal(elements.get("shelfSelectToggle").getAttribute("aria-pressed"), "true");
  assert.match(elements.get("conversationList").innerHTML, /class="shelf-check" role="checkbox"[^>]*aria-checked="false"/);
  assert.equal(elements.get("shelfSelectApply").disabled, true, "nothing to move yet");
  assert.equal(elements.get("shelfSelectTarget").value, "__new", "with no groups yet, the bar offers a new one");
  assert.equal(elements.get("shelfSelectNewName").hidden, false);

  runtime.OD.app.toggleShelfSelection([ids[0]]);
  runtime.OD.app.toggleShelfSelection([ids[2]]);
  assert.deepEqual([...runtime.OD.app.getState().shelfSelection], [ids[0], ids[2]]);
  assert.match(elements.get("shelfSelectCount").textContent, /已选 2 个来源/);

  // Asking for a new group without a name keeps everything picked.
  elements.get("shelfSelectApply").click();
  assert.equal(runtime.OD.app.getState().shelfSelecting, true);
  elements.get("shelfSelectNewName").value = "外面的人";
  elements.get("shelfSelectApply").click();
  let appState = runtime.OD.app.getState();
  assert.equal(appState.shelfSelecting, false, "moving finishes 整理");
  assert.equal(bar.hidden, true);
  const groupId = appState.sourceShelf.groups[0].id;
  assert.deepEqual({ ...appState.sourceShelf.members }, { [ids[0]]: groupId, [ids[2]]: groupId });
  assert.match(elements.get("status").textContent, /2 个来源已放进「外面的人」/);

  // A second round: the existing group is offered first; picking a whole
  // group's sources and the third source moves them all there.
  runtime.OD.app.setShelfSelecting(true);
  assert.equal(elements.get("shelfSelectTarget").value, groupId);
  runtime.OD.app.toggleShelfSelection(ids);
  assert.equal(runtime.OD.app.getState().shelfSelection.length, 3);
  runtime.OD.app.toggleShelfSelection([ids[0], ids[2]]);
  assert.deepEqual([...runtime.OD.app.getState().shelfSelection], [ids[1]], "toggling a fully picked group lets all of it go");
  runtime.OD.app.applyShelfSelection();
  appState = runtime.OD.app.getState();
  assert.equal(Object.values(appState.sourceShelf.members).filter(id => id === groupId).length, 3);

  // Out of groups, and Esc leaves the mode without moving anything.
  runtime.OD.app.setShelfSelecting(true);
  runtime.OD.app.toggleShelfSelection(ids);
  elements.get("shelfSelectTarget").value = "__out";
  runtime.OD.app.applyShelfSelection();
  assert.deepEqual({ ...runtime.OD.app.getState().sourceShelf.members }, {});
  runtime.OD.app.setShelfSelecting(true);
  runtime.OD.app.toggleShelfSelection([ids[1]]);
  runtime.OD.app.setShelfSelecting(false);
  assert.deepEqual([...runtime.OD.app.getState().shelfSelection], []);
  assert.equal(runtime.OD.app.applyShelfSelection(), null, "with nothing picked there is nothing to apply");
});

test("SillyTavern sources group by character in the sidebar, without the folder name as a subtitle", async () => {
  const { runtime, elements } = await loadAppRuntime("asc");
  const chat = (id, characterId, characterName, extra = {}) => ({
    id, title: id, createdAt: "2026-08-16T00:00:00.000Z", participants: [],
    context: { sourceMetadata: { characterId, characterName, ...extra } },
    messages: [{ id: `${id}-m1`, role: "assistant", speaker: characterName, content: "body" }]
  });
  runtime.OD.app.loadArchive({
    source: { platform: "sillytavern", exporter: "sillytavern-chats" },
    conversations: [
      chat("lantern-1", "Lantern", "Lantern"),
      chat("lantern-2", "Lantern", "Lantern"),
      chat("porch", "group:1787", "The porch", { isGroupChat: true })
    ]
  }, "SillyTavern");
  const html = elements.get("conversationList").innerHTML;
  assert.equal((html.match(/class="character-group"/g) || []).length, 2);
  assert.match(html, /data-character-key="[^"]+::id:Lantern"/);
  assert.match(html, /<span class="character-summary-label">Lantern<\/span>\s*<span class="character-count">2</);
  assert.match(html, /<span class="character-summary-label">The porch<\/span>/);
  assert.doesNotMatch(html, /character-identity/, "the folder name is not repeated under the character");
});

test("conversations from different sources share one group and leave their sources' lists", async () => {
  const { runtime, elements } = await loadAppRuntime("asc");
  const archive = (platform, ids, extra = {}) => ({
    source: { platform, exporter: `${platform}-synthetic` },
    conversations: ids.map((id, index) => ({
      id, title: `${platform} ${index + 1}`, createdAt: `2026-08-1${index}T00:00:00.000Z`, participants: [],
      context: { sourceMetadata: { characterId: "lamp", characterName: "Lamp", ...extra } },
      messages: [{ id: `${id}-m`, role: "assistant", speaker: "Lamp", content: `${platform} body` }]
    }))
  });
  runtime.OD.app.loadArchive(archive("mufy", ["m1", "m2", "m3"]), "Mufy");
  runtime.OD.app.loadArchive(archive("sillytavern", ["s1", "s2"]), "SillyTavern");
  runtime.OD.app.loadArchive(archive("chatgpt", ["g1"]), "ChatGPT");
  const all = runtime.OD.app.getState().archive.conversations;
  const idOf = title => all.find(conversation => conversation.title === title).id;
  const picks = [idOf("mufy 1"), idOf("mufy 3"), idOf("sillytavern 2"), idOf("chatgpt 1")];

  runtime.OD.app.setShelfSelecting(true);
  runtime.OD.app.toggleShelfConversations(picks.slice(0, 2));
  runtime.OD.app.toggleShelfConversations([picks[2]]);
  runtime.OD.app.toggleShelfConversations([picks[3]]);
  assert.match(elements.get("shelfSelectCount").textContent, /已选 4 项/);
  elements.get("shelfSelectNewName").value = "放在一起读";
  runtime.OD.app.applyShelfSelection();

  const state = runtime.OD.app.getState();
  const groupId = state.sourceShelf.groups[0].id;
  assert.deepEqual(Object.keys(state.sourceShelf.conversations).sort(), [...picks].sort());
  assert.match(elements.get("status").textContent, /4 项已放进「放在一起读」/);
  const html = elements.get("conversationList").innerHTML;
  const groupStart = html.indexOf('class="shelf-group"');
  const groupEnd = html.indexOf("</details>", html.lastIndexOf('class="shelf-group-loose"'));
  for (const id of picks) {
    const at = html.indexOf(`data-id="${id}"`);
    assert.ok(at > groupStart && at < groupEnd, `${id} is drawn inside the group`);
    assert.equal(html.split(`data-id="${id}"`).length, 2, `${id} is drawn once, not also under its source`);
  }
  assert.match(html, /<div class="conv-provenance">Mufy · Lamp<\/div>/, "a loose conversation says where it came from");
  assert.match(html, /<div class="conv-provenance">ChatGPT<\/div>/, "no character for a source that has none");
  assert.match(html, /class="shelf-group-label">放在一起读<\/span>\s*<span class="source-count">4</);
  assert.ok(html.includes(`data-id="${idOf("mufy 2")}"`), "unpicked conversations stay with their source");


  elements.get("sourceFilter").value = `group:${groupId}`;
  elements.get("sourceFilter").dispatch("change");
  assert.deepEqual([...runtime.OD.app.getState().filteredIds].sort(), [...picks].sort(), "the group filter shows exactly the group");
  assert.match(elements.get("sourceFilter").innerHTML, /整组 · 放在一起读（4）/);

  // Out of the group, a conversation goes back under its own source.
  runtime.OD.app.fileShelfItems({ conversations: [picks[3]] }, null);
  assert.match(elements.get("status").textContent, /已放回原来的来源/);
  assert.equal(runtime.OD.app.getState().sourceShelf.conversations[picks[3]], undefined);

  // A drop on the new-group strip makes 新分组, then 新分组 2.
  const first = runtime.OD.app.dropIntoNewGroup({ conversations: [idOf("sillytavern 1")] });
  const second = runtime.OD.app.dropIntoNewGroup({ sources: [runtime.OD.app.getState().sources.find(s => s.platform === "chatgpt").id] });
  const names = runtime.OD.app.getState().sourceShelf.groups.map(group => group.name);
  assert.ok(first && second);
  assert.deepEqual([...names.slice(-2)], ["新分组", "新分组 2"]);
  assert.match(elements.get("status").textContent, /已新建「新分组 2」/);

  runtime.OD.app.dissolveSourceGroup(groupId);
  assert.equal(Object.values(runtime.OD.app.getState().sourceShelf.conversations).includes(groupId), false);
  assert.equal(runtime.OD.app.getState().archive.conversations.length, 6, "nothing is removed");
});

test("text width moves freely: the slider previews live, − and ＋ step, the ends hold", async () => {
  const { runtime, elements, stored, rootStyle } = await loadAppRuntime("asc");
  const width = () => runtime.OD.app.getState().readerPreferences.contentWidth;
  const saved = () => JSON.parse(stored.get("our-dialogues.reader-state.v1") || "{}").contentWidth;
  assert.equal(width(), 800);
  assert.equal(elements.get("contentWidthValue").textContent, "800 px");

  elements.get("contentWider").click();
  assert.equal(width(), 840);
  assert.equal(elements.get("contentWidth").value, "840");
  assert.equal(elements.get("contentWidthValue").textContent, "840 px");
  elements.get("contentNarrower").click();
  elements.get("contentNarrower").click();
  assert.equal(width(), 760);

  // Dragging previews without saving; letting go saves once.
  elements.get("contentWidth").value = "1100";
  elements.get("contentWidth").dispatch("input");
  assert.equal(elements.get("contentWidthValue").textContent, "1100 px");
  assert.equal(width(), 760, "a preview is not yet a setting");
  elements.get("contentWidth").dispatch("change");
  assert.equal(width(), 1100);
  assert.equal(saved(), 1100);

  for (let index = 0; index < 10; index += 1) elements.get("contentWider").click();
  assert.equal(width(), 1280);
  assert.equal(elements.get("contentWider").disabled, true);
  assert.equal(elements.get("contentNarrower").disabled, false);
  runtime.OD.app.setContentWidth(100);
  assert.equal(width(), 480);
  assert.equal(elements.get("contentNarrower").disabled, true);
  if (rootStyle?.getPropertyValue) assert.equal(rootStyle.getPropertyValue("--cw"), "480px");
});

test("the width slider ends where the window does, and steps back from what is shown", async () => {
  const { runtime, elements, rootStyle } = await loadAppRuntime("asc");
  elements.get("main").clientWidth = 1128; // 1440 wide with the sidebar open
  runtime.OD.app.setContentWidth(1280);
  const width = () => runtime.OD.app.getState().readerPreferences.contentWidth;
  assert.equal(width(), 940, "no wider than this window can show");
  assert.equal(elements.get("contentWidth").max, "940");
  assert.equal(elements.get("contentWider").disabled, true);
  if (rootStyle?.getPropertyValue) assert.equal(rootStyle.getPropertyValue("--reader-gutter"), "48px", "past the default, the stage margins give way");
  elements.get("contentNarrower").click();
  assert.equal(width(), 900, "one press, one visible step");
  runtime.OD.app.setContentWidth(800);
  if (rootStyle?.getPropertyValue) assert.equal(rootStyle.getPropertyValue("--reader-gutter"), "144px", "the default keeps its margins");
});

test("on a phone the width control narrows the column within the screen, in finer steps", async () => {
  const { runtime, elements } = await loadAppRuntime("asc", { matchMedia: query => ({ matches: /max-width:\s*1023px|max-width:\s*760px/.test(query), addEventListener() {}, addListener() {} }) });
  elements.get("main").clientWidth = 375;
  runtime.OD.app.setContentWidth(800);
  const width = () => runtime.OD.app.getState().readerPreferences.contentWidth;
  assert.equal(elements.get("contentWidth").disabled, false);
  assert.equal(elements.get("contentWidth").max, "330", "all the room inside the 22px margins");
  assert.equal(elements.get("contentWidth").min, "240");
  assert.equal(elements.get("contentWidth").step, "10");
  assert.equal(width(), 330);
  assert.equal(elements.get("contentWider").disabled, true);
  elements.get("contentNarrower").click();
  assert.equal(width(), 310, "a press is 20px on a phone");
  assert.equal(elements.get("contentWidthValue").textContent, "310 px");
  runtime.OD.app.setContentWidth(100);
  assert.equal(width(), 240);
  assert.equal(elements.get("contentNarrower").disabled, true);
});

test("the Reader still opens and works when the browser blocks site storage", async () => {
  const { runtime, elements } = await loadAppRuntime("asc", { blockedStorage: true });
  runtime.OD.app.loadArchive({
    conversations: [{ id: "only", title: "对话", messages: [{ id: "m1", role: "assistant", content: "正文" }] }]
  }, "Blocked");
  runtime.OD.app.openConversation("only");
  assert.equal(runtime.OD.app.getState().current.id, "only");
  elements.get("sortDescending").click();
  assert.equal(runtime.OD.app.getState().sortMode, "desc", "sorting still works, it just isn't remembered");
});

test("scrolling the library home leaves the conversation underneath where it was", async () => {
  const { runtime, elements } = await loadAppRuntime("asc");
  const messages = Array.from({ length: 10 }, (_, i) => ({ id: `m${i + 1}`, role: "assistant", content: `line ${i + 1}` }));
  runtime.OD.app.loadArchive({ conversations: [{ id: "alpha", title: "A", createdAt: "2025-01-01T00:00:00.000Z", messages }] }, "Synthetic");
  runtime.OD.app.openConversation("alpha");
  elements.get("main").scrollTop = 250;
  elements.get("main").dispatch("scroll");
  const before = runtime.OD.app.getState().readingProgress.alpha;
  assert.equal(before.messageId, "m3");

  elements.get("navLibrary").click();
  assert.ok(elements.get("reader").classList.contains("hidden"));
  // In a browser the hidden messages all measure 0 from the top.
  const list = elements.get("messages");
  const measure = list.querySelectorAll.bind(list);
  list.querySelectorAll = selector => measure(selector).map(element => ({ ...element, offsetTop: 0, offsetHeight: 0 }));
  elements.get("main").scrollTop = 120;
  elements.get("main").dispatch("scroll");

  const after = runtime.OD.app.getState();
  assert.equal(after.readingProgress.alpha.messageId, "m3", "the home page's scroll is not reading");
  assert.equal(after.readingProgress.alpha.percent, before.percent);
  assert.equal(after.readingPosition.messageId, "m3", "the saved place is the one last seen");
});

test("changing language on the library home stays on the library home", async () => {
  const { runtime, elements } = await loadAppRuntime("asc");
  runtime.OD.app.loadArchive({
    conversations: [{ id: "only", title: "对话", messages: [{ id: "m1", role: "assistant", content: "正文" }] }]
  }, "Home");
  runtime.OD.app.openConversation("only");
  elements.get("navLibrary").click();
  elements.get("uiLocale").value = "en";
  elements.get("uiLocale").dispatch("change");
  assert.equal(elements.get("libraryHome").classList.contains("hidden"), false);
  assert.equal(elements.get("reader").classList.contains("hidden"), true, "the conversation does not pop open");
});

test("Enter that confirms a Chinese IME candidate never submits the half-typed text", async () => {
  const { runtime, elements } = await loadTwoCompanions();
  runtime.OD.app.openConversation(runtime.OD.app.getState().archive.conversations[0].id);
  const enter = (element, details = {}) => element.dispatch("keydown", element, { key: "Enter", preventDefault() {}, ...details });

  // Tags: the pinyin being composed is not a tag; the confirmed word is.
  const tagInput = elements.get("tagInput");
  tagInput.value = "wenxin";
  enter(tagInput, { isComposing: true });
  enter(tagInput, { keyCode: 229 });
  assert.deepEqual([...(runtime.OD.app.getState().current.tags || [])], []);
  tagInput.value = "温馨";
  enter(tagInput);
  assert.match(elements.get("tagChips").innerHTML, /温馨/);

  // The companion's name: composing keeps the editor open and unsaved.
  const sol = runtime.OD.app.getState().sources.find(source => source.label === "Sol");
  elements.get("companionList").dispatch("click", clickTarget("companionPick", runtime.OD.companionship.companionKey(sol.id, null)));
  elements.get("memorialCard").dispatch("click", clickTarget("memorialMenu"));
  elements.get("memorialRename").click();
  const nameInput = elements.get("memorialNameInput");
  nameInput.value = "xiao";
  enter(nameInput, { isComposing: true });
  assert.equal(elements.get("memorialNameEditor").hidden, false, "still composing, still editing");
  assert.doesNotMatch(elements.get("memorialCard").innerHTML, /xiao/);
  nameInput.value = "小 S";
  enter(nameInput);
  assert.equal(elements.get("memorialNameEditor").hidden, true);
  assert.match(elements.get("memorialCard").innerHTML, /小 S/);
});

test("page-turn keys leave composing, modified keys, and media players alone", async () => {
  const { runtime, elements, dispatchDocument } = await loadAppRuntime("asc");
  const one = id => ({ id, title: id, createdAt: `2025-0${id.length}-01T12:00:00.000Z`, messages: [{ id: `${id}-1`, role: "assistant", content: "正文" }] });
  runtime.OD.app.loadArchive({ conversations: [one("a"), one("bb")] }, "Keys");
  runtime.OD.app.openConversation("a");
  const press = details => dispatchDocument("keydown", details.target || { tagName: "MAIN" }, { preventDefault() {}, ...details });

  press({ key: "ArrowRight", altKey: true });
  press({ key: "ArrowRight", shiftKey: true });
  press({ key: "ArrowRight", target: { tagName: "AUDIO" } });
  assert.equal(runtime.OD.app.getState().current.id, "a");
  press({ key: "ArrowRight" });
  assert.equal(runtime.OD.app.getState().current.id, "bb", "a plain arrow still turns to the next conversation");

  // Esc that cancels a candidate does not also close the Aa panel.
  for (const id of ["memorialNameEditor", "memorialDateEditor", "memorialMenu", "companionPicker",
    "annotationEditor", "readerMoreMenu", "exportMenu", "tagEditor", "readerPrefsPanel"]) elements.get(id).hidden = true;
  elements.get("readerPrefsToggle").click();
  assert.equal(elements.get("readerPrefsPanel").hidden, false);
  press({ key: "Escape", isComposing: true });
  assert.equal(elements.get("readerPrefsPanel").hidden, false);
  press({ key: "Escape" });
  assert.equal(elements.get("readerPrefsPanel").hidden, true);
});

test("the memorial name and date editors never share one open key", async () => {
  const { runtime, elements } = await loadTwoCompanions();
  const sol = runtime.OD.app.getState().sources.find(source => source.label === "Sol");
  elements.get("companionList").dispatch("click", clickTarget("companionPick", runtime.OD.companionship.companionKey(sol.id, null)));
  const card = elements.get("memorialCard");
  card.dispatch("click", clickTarget("memorialMenu"));
  elements.get("memorialRename").click();
  card.dispatch("click", clickTarget("memorialMenu"));
  elements.get("memorialEditDate").click();
  assert.equal(elements.get("memorialNameEditor").hidden, true, "opening the date editor closes the name editor");
  assert.equal(elements.get("memorialDateEditor").hidden, false);
});

test("a dismissed reconnect picker does not turn the next import into a reconnect", async () => {
  const { runtime, elements } = await loadAppRuntime("asc");
  runtime.OD.app.loadArchive({
    conversations: [{ id: "old", title: "旧", messages: [{ id: "m1", role: "assistant", content: "正文" }] }]
  }, "Old");
  const sourceId = runtime.OD.app.getState().sources[0].id;
  await runtime.OD.app.reconnectSource(sourceId);
  const input = elements.get("fileInput");
  input.dispatch("cancel");

  // The adapters are not loaded here; a stand-in recognises the new file.
  runtime.OD.registry = { async parseJSON(data) { return { archive: data, adapter: { label: "New" } }; } };
  const fresh = { conversations: [{ id: "new", title: "新", messages: [{ id: "n1", role: "assistant", content: "正文" }] }] };
  input.files = [new File([JSON.stringify(fresh)], "fresh.json", { type: "application/json" })];
  await input.dispatch("change");
  assert.equal(runtime.OD.app.getState().sources.length, 2, "the chosen file arrives as a new source");
});

test("a bare calendar date belongs to that day and year in every time zone", async () => {
  const { runtime, elements } = await loadAppRuntime("asc");
  runtime.OD.app.loadArchive({
    conversations: Array.from({ length: 12 }, (_, i) => ({
      id: `d${i}`, title: `对话 ${i}`, createdAt: i ? `2026-0${(i % 9) + 1}-15` : "2026-01-01",
      messages: [{ id: `d${i}-1`, role: "assistant", content: "正文" }]
    }))
  }, "DateOnly");
  // New Year's Day read as UTC midnight was still 2025 west of London.
  assert.doesNotMatch(elements.get("conversationList").innerHTML, /year-heading/);
});

/* ── Keyboard and screen-reader reach (reader sweep) ── */

// The Esc handler walks every transient layer first; the fake elements start
// visible, so tests that reach the later branches shut the earlier ones.
function shutTransientLayers(elements) {
  for (const id of ["memorialNameEditor", "memorialDateEditor", "memorialMenu", "companionPicker",
    "annotationEditor", "readerMoreMenu", "exportMenu", "tagEditor", "readerPrefsPanel",
    "filterMenu", "sourceAddMenu", "sourceManagePanel"]) elements.get(id).hidden = true;
}

function focusSpy(elements, ids) {
  const focused = [];
  for (const id of ids) elements.get(id).focus = () => focused.push(id);
  return focused;
}

test("catalog, history, and search rows are in the Tab order with the right roles", async () => {
  const { runtime, elements } = await loadAppRuntime("asc");
  runtime.OD.app.loadArchive({
    conversations: [{ id: "alpha", title: "第一段", createdAt: "2025-01-01T00:00:00.000Z",
      messages: [{ id: "alpha-1", role: "assistant", content: "重点的一句话" }] }]
  }, "Rows");
  runtime.OD.app.openConversation("alpha");
  runtime.OD.app.addBookmark();
  runtime.OD.app.addAnnotation({ messageId: "alpha-1", selectedText: "重点", color: "green" });
  elements.get("searchQuery").value = "重点";
  runtime.OD.app.setSearchScope("library");
  runtime.OD.app.performSearch();

  assert.match(elements.get("conversationList").innerHTML, /class="conv[^"]*" data-id="alpha" draggable="true" tabindex="0" role="link"/);
  assert.match(elements.get("recentList").innerHTML, /class="recent-item" data-recent-id="alpha" role="link" tabindex="0"/);
  assert.match(elements.get("searchResults").innerHTML, /class="search-hit"[^>]* role="link" tabindex="0"/);
  // Rows that hold their own buttons are focusable but not links.
  assert.match(elements.get("bookmarksList").innerHTML, /class="bookmark" data-bookmark-id="[^"]+" tabindex="0">/);
  assert.match(elements.get("annotationsList").innerHTML, /class="annotation-item" data-annotation-item="[^"]+" tabindex="0">/);

  runtime.OD.app.setShelfSelecting(true);
  assert.match(elements.get("conversationList").innerHTML, /data-id="alpha" draggable="true" tabindex="0" role="checkbox" aria-checked="false"/,
    "in 整理 a row picks, so it reads as a checkbox");
  runtime.OD.app.setShelfSelecting(false);
  assert.match(elements.get("conversationList").innerHTML, /data-id="alpha" draggable="true" tabindex="0" role="link"/);
});

test("Enter and Space on a focused row open it, never on a control inside the row", async () => {
  const { elements } = await loadAppRuntime("asc");
  const lists = [["conversationList", ".conv"], ["recentList", ".recent-item"], ["bookmarksList", ".bookmark"],
    ["annotationsList", ".annotation-item"], ["searchResults", ".search-hit"]];
  for (const [listId, selector] of lists) {
    let clicks = 0;
    let prevented = 0;
    const row = { matches: candidate => candidate === selector, click() { clicks++; } };
    const nested = { matches: () => false, click() { clicks += 100; } };
    const press = (target, details) => elements.get(listId).dispatch("keydown", target, { preventDefault() { prevented++; }, ...details });

    press(row, { key: "Enter" });
    press(row, { key: " " });
    assert.equal(clicks, 2, `${listId}: Enter and Space open the row`);
    assert.equal(prevented, 2, `${listId}: Space does not also scroll the sidebar`);
    press(nested, { key: "Enter" });
    press(nested, { key: " " });
    press(row, { key: "a" });
    press(row, { key: "Enter", isComposing: true });
    assert.equal(clicks, 2, `${listId}: keys on a nested control, other keys, and IME Enter are left alone`);
  }
});

test("☰ says whether the drawer is open, and the drawer takes focus in and hands it back", async () => {
  const mediaQuery = { matches: true, addEventListener() {} };
  const { runtime, elements } = await loadAppRuntime("asc", { matchMedia: () => mediaQuery });
  const sidebar = elements.get("sidebar");
  const toggle = elements.get("sidebarToggle");
  const focused = focusSpy(elements, ["sidebarClose", "sidebarToggle"]);
  assert.equal(sidebar.classList.contains("closed"), true);
  assert.equal(toggle.getAttribute("aria-expanded"), "false");

  // A pointer click (detail ≥ 1) opens the drawer and leaves focus alone…
  toggle.dispatch("click", toggle, { detail: 1 });
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  assert.deepEqual(focused, []);
  elements.get("sidebarBackdrop").click();
  // …a keyboard press (detail 0) takes focus into it.
  toggle.dispatch("click", toggle, { detail: 0 });
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  assert.deepEqual(focused, ["sidebarClose"], "opening from the keyboard on a narrow screen moves focus into the drawer");

  // Focus inside the drawer goes back to ☰ when the drawer shuts.
  runtime.document.activeElement = elements.get("sidebarClose");
  sidebar.contains = element => element === elements.get("sidebarClose");
  elements.get("sidebarClose").click();
  assert.equal(sidebar.classList.contains("closed"), true);
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  assert.deepEqual(focused, ["sidebarClose", "sidebarToggle"]);

  // A backdrop click while focus is out on the page leaves focus where it was.
  toggle.click();
  runtime.document.activeElement = { tagName: "MAIN" };
  elements.get("sidebarBackdrop").click();
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  assert.deepEqual(focused, ["sidebarClose", "sidebarToggle"]);

  // Focus a re-render inside the drawer dropped to the page also comes back to ☰.
  toggle.click();
  runtime.document.activeElement = runtime.document.body;
  elements.get("sidebarBackdrop").click();
  assert.deepEqual(focused, ["sidebarClose", "sidebarToggle", "sidebarToggle"]);
});

test("a catalog row that had focus keeps it when the catalog re-renders", async () => {
  const { runtime } = await loadAppRuntime("asc");
  const focusedIds = [];
  const freshRow = id => {
    const row = fakeElement("");
    row.dataset.id = id;
    row.focus = () => focusedIds.push(id);
    return row;
  };
  const listQuery = runtime.document.querySelectorAll;
  runtime.document.querySelectorAll = selector =>
    (selector === ".conv" ? [freshRow("alpha"), freshRow("beta")] : listQuery(selector));
  const one = id => ({ id, title: id, createdAt: "2025-01-01T00:00:00.000Z", messages: [{ id: `${id}-1`, role: "assistant", content: "正文" }] });
  runtime.OD.app.loadArchive({ conversations: [one("alpha"), one("beta")] }, "Focus");
  assert.deepEqual(focusedIds, [], "nothing is focused that was not focused before");

  // Opening beta from its focused row re-renders the list under it.
  runtime.document.activeElement = { closest: selector => (selector === "#conversationList .conv" ? { dataset: { id: "beta" } } : null) };
  runtime.OD.app.openConversation("beta");
  assert.deepEqual(focusedIds, ["beta"]);
});

test("on a wide screen ☰ still reports the sidebar's state but leaves focus alone", async () => {
  const { elements } = await loadAppRuntime("asc");
  const toggle = elements.get("sidebarToggle");
  const focused = focusSpy(elements, ["sidebarClose"]);
  assert.equal(toggle.getAttribute("aria-expanded"), "true", "desktop starts with the sidebar showing");
  toggle.dispatch("click", toggle, { detail: 0 });
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  toggle.dispatch("click", toggle, { detail: 0 });
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  assert.deepEqual(focused, [], "the sidebar sits beside the page here, so focus stays on ☰");
});

test("toolbar popover buttons report open and closed through every way out", async () => {
  const { runtime, elements, dispatchDocument } = await loadAppRuntime("asc");
  runtime.OD.app.loadArchive({
    conversations: [{ id: "only", title: "对话", messages: [{ id: "m1", role: "assistant", content: "正文" }] }]
  }, "Popovers");
  runtime.OD.app.openConversation("only");
  shutTransientLayers(elements);
  const expanded = id => elements.get(id).getAttribute("aria-expanded");
  const outside = { closest: () => null };
  const escape = () => dispatchDocument("keydown", { tagName: "MAIN" }, { key: "Escape", preventDefault() {} });
  // The page ships every panel hidden; the fakes were shut by hand above, so
  // let one ordinary click bring the buttons in step first.
  dispatchDocument("click", outside);

  for (const id of ["readerPrefsToggle", "readerMoreToggle", "exportToggle", "tagToggle"]) {
    assert.equal(expanded(id), "false", `${id} starts closed`);
  }

  elements.get("readerPrefsToggle").click();
  assert.equal(expanded("readerPrefsToggle"), "true");
  dispatchDocument("click", outside);
  assert.equal(elements.get("readerPrefsPanel").hidden, true);
  assert.equal(expanded("readerPrefsToggle"), "false", "an outside click closes it and says so");

  elements.get("readerPrefsToggle").click();
  elements.get("aaDone").click();
  assert.equal(expanded("readerPrefsToggle"), "false", "完成 closes it and says so");

  elements.get("readerMoreToggle").click();
  assert.equal(expanded("readerMoreToggle"), "true");
  elements.get("toTop").click();
  assert.equal(expanded("readerMoreToggle"), "false", "a menu action closes the menu and says so");

  elements.get("exportToggle").click();
  assert.equal(expanded("exportToggle"), "true");
  escape();
  assert.equal(elements.get("exportMenu").hidden, true);
  assert.equal(expanded("exportToggle"), "false", "Esc closes it and says so");

  elements.get("tagToggle").click();
  assert.equal(expanded("tagToggle"), "true");
  elements.get("tagToggle").click();
  assert.equal(expanded("tagToggle"), "false");
});

test("Esc folds the library pane's own menus back to their buttons", async () => {
  const { elements, dispatchDocument } = await loadAppRuntime("asc");
  shutTransientLayers(elements);
  const focused = focusSpy(elements, ["filterMenuToggle", "sourceAddToggle", "sidebarToggle"]);
  const escape = () => dispatchDocument("keydown", { tagName: "MAIN" }, { key: "Escape", preventDefault() {} });

  elements.get("filterMenuToggle").click();
  assert.equal(elements.get("filterMenu").hidden, false);
  escape();
  assert.equal(elements.get("filterMenu").hidden, true);
  assert.equal(elements.get("filterMenuToggle").getAttribute("aria-pressed"), "false");
  assert.deepEqual(focused, ["filterMenuToggle"]);

  elements.get("sourceAddToggle").click();
  escape();
  assert.equal(elements.get("sourceAddMenu").hidden, true);
  elements.get("sourceManageToggle").click();
  assert.equal(elements.get("sourceManagePanel").hidden, false);
  escape();
  assert.equal(elements.get("sourceManagePanel").hidden, true);
  assert.deepEqual(focused, ["filterMenuToggle", "sourceAddToggle", "sourceAddToggle"], "管理 returns to ＋, which opened it");

  // A menu left open inside a closed sidebar is not on screen; Esc is not spent on it.
  elements.get("filterMenuToggle").click();
  elements.get("sidebar").classList.add("closed");
  escape();
  assert.equal(elements.get("filterMenu").hidden, false);
  assert.deepEqual(focused, ["filterMenuToggle", "sourceAddToggle", "sourceAddToggle"]);
});

test("a source's ··· button says whether its menu is open", async () => {
  const { runtime, elements } = await loadAppRuntime("asc");
  const menu = fakeElement("menu");
  menu.hidden = true;
  const button = fakeElement("sourceMenuButton");
  button.closest = selector => (selector === ".source-group" ? { querySelector: () => menu } : null);
  const listQuery = runtime.document.querySelectorAll;
  runtime.document.querySelectorAll = selector =>
    (selector === "#conversationList [data-source-menu]" ? [button] : listQuery(selector));
  runtime.OD.app.loadArchive({
    conversations: [{ id: "only", title: "对话", messages: [{ id: "m1", role: "assistant", content: "正文" }] }]
  }, "Menus");
  assert.match(elements.get("conversationList").innerHTML, /data-source-menu="[^"]+"[^>]* aria-haspopup="true" aria-expanded="false"/);

  const quiet = { preventDefault() {}, stopPropagation() {} };
  button.dispatch("click", button, quiet);
  assert.equal(menu.hidden, false);
  assert.equal(button.getAttribute("aria-expanded"), "true");
  button.dispatch("click", button, quiet);
  assert.equal(menu.hidden, true);
  assert.equal(button.getAttribute("aria-expanded"), "false");
});

test("a single SillyTavern chat with damaged lines says how many it skipped", async () => {
  const { runtime, elements } = await loadAppRuntime("asc");
  vm.runInContext(await readFile(path.join(repositoryRoot, "src/adapters/sillytavern.js"), "utf8"), runtime, { filename: "src/adapters/sillytavern.js" });
  runtime.OD.registry = {
    async parseJSON(lines) {
      return { archive: { conversations: [{ id: "st", title: "ST", messages: lines.map((line, i) => ({ id: `l${i}`, role: "assistant", content: String(line.mes) })) }] }, adapter: { label: "SillyTavern" } };
    }
  };
  const chat = ['{"mes":"Synthetic one"}', '{"mes":"Synthetic tw', '{"mes":"Synthetic three"}'].join("\n");
  const input = elements.get("fileInput");
  input.files = [new File([chat], "synthetic.jsonl")];
  await input.dispatch("change");
  assert.equal(runtime.OD.app.getState().archive.conversations[0].messages.length, 2);
  assert.match(elements.get("status").textContent, /1 行损坏已跳过/);
});
