import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadFixture() {
  const raw = await readFile(path.join(repositoryRoot, "fixtures", "personal-archive-v1-synthetic.json"), "utf8");
  return JSON.parse(raw);
}

async function loadRuntime() {
  const runtime = { console };
  runtime.window = runtime;
  vm.createContext(runtime);
  for (const relativePath of [
    "src/core/schema.js",
    "src/adapters/contract.js",
    "src/adapters/normalized.js",
    "src/adapters/personal-archive.js",
    "src/adapters/registry.js"
  ]) {
    const source = await readFile(path.join(repositoryRoot, relativePath), "utf8");
    vm.runInContext(source, runtime, { filename: relativePath });
  }
  return runtime.OD;
}

const ALLOWED_TYPES = ["diary", "dream", "essay", "microblog", "note", "letter", "fragment", "other"];

/* vm-realm objects fail deepStrictEqual against local literals (different
   Object prototypes); JSON round-tripping re-homes them in this realm. */
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

/* ── PA-1: the synthetic fixture honours the documented contract ────── */

test("personal-archive fixture matches the documented root contract", async () => {
  const data = await loadFixture();
  assert.equal(data.schema, "our-dialogues.personal-archive.v1");
  assert.ok(data.archive?.id && typeof data.archive.id === "string");
  assert.ok(data.archive?.name && typeof data.archive.name === "string");
  assert.ok(data.archive?.author?.id && data.archive?.author?.name, "the fixture exercises the author fields");
  assert.ok(Array.isArray(data.collections) && data.collections.length >= 2);
  for (const collection of data.collections) {
    assert.ok(collection.id && typeof collection.id === "string", "collection ids are required");
    assert.ok(collection.name && typeof collection.name === "string", "collection names are required");
    assert.ok(Array.isArray(collection.entries) && collection.entries.length > 0);
    const ids = collection.entries.map(entry => entry.id);
    assert.equal(new Set(ids).size, ids.length, `entry ids are unique within ${collection.id}`);
    for (const entry of collection.entries) {
      assert.ok(entry.id && typeof entry.id === "string", "entry ids are required");
      assert.ok(typeof entry.text === "string" && entry.text.length > 0, "entry text is required");
    }
  }
});

test("personal-archive fixture covers every case the handoff demands", async () => {
  const data = await loadFixture();
  const collections = data.collections;
  const entries = collections.flatMap(collection => collection.entries.map(entry => ({ collection, entry })));

  // Dated diary entry without a title.
  assert.ok(entries.some(({ collection, entry }) =>
    collection.type === "diary" && entry.title == null && entry.createdAt), "diary with a date and no title");
  // Dream with an explicit original title.
  assert.ok(entries.some(({ collection, entry }) =>
    collection.type === "dream" && typeof entry.title === "string" && entry.title.length > 0), "dream with a title");
  // Microblog entry with an exact timestamp.
  assert.ok(entries.some(({ collection, entry }) =>
    collection.type === "microblog" && /T\d{2}:\d{2}/.test(String(entry.createdAt))), "microblog with an exact timestamp");
  // Entirely undated entry.
  assert.ok(entries.some(({ entry }) => entry.createdAt == null), "an undated fragment exists");
  // At least two collections span more than one year.
  const spanning = collections.filter(collection => {
    const years = new Set(collection.entries
      .map(entry => String(entry.createdAt || "").slice(0, 4))
      .filter(year => /^\d{4}$/.test(year)));
    return years.size >= 2;
  });
  assert.ok(spanning.length >= 2, "two collections span multiple years");
  // Non-Chinese text and mixed-language text.
  assert.ok(entries.some(({ entry }) => !/[一-鿿]/.test(entry.text) && /[A-Za-z]/.test(entry.text)),
    "an English-only entry exists");
  assert.ok(entries.some(({ entry }) => /[一-鿿]/.test(entry.text) && /[A-Za-z]{4,}/.test(entry.text)),
    "a mixed-language entry exists");
  // Multiline text with blank lines survives as written.
  assert.ok(entries.some(({ entry }) => entry.text.includes("\n\n")), "a multiline entry with blank lines exists");
  // Two entries on the same day carry distinct deterministic ids.
  const byDay = new Map();
  for (const { entry } of entries) {
    const day = String(entry.createdAt || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    byDay.set(day, [...(byDay.get(day) || []), entry.id]);
  }
  assert.ok([...byDay.values()].some(ids => ids.length >= 2 && new Set(ids).size === ids.length),
    "duplicate dates resolve through distinct ids");
  // An out-of-enum collection type exercises the unknown-type fallback.
  assert.ok(collections.some(collection => !ALLOWED_TYPES.includes(collection.type)),
    "an unknown collection type exists for the fallback path");
  // A markdown-style heading first line exercises the title chain.
  assert.ok(entries.some(({ entry }) => entry.title == null && /^# .+/m.test(entry.text.split("\n")[0])),
    "an entry whose first line is clearly a heading exists");
  // Tags and free-form metadata are exercised.
  assert.ok(entries.some(({ entry }) => Array.isArray(entry.tags) && entry.tags.length > 0), "an entry with tags");
  assert.ok(entries.some(({ entry }) => entry.metadata && Object.keys(entry.metadata).length > 0),
    "an entry with free-form metadata");
  // A minimal entry (id + text only) stays valid.
  assert.ok(entries.some(({ entry }) => !("createdAt" in entry) && !("title" in entry)),
    "a minimal id+text entry exists");
});

/* ── PA-2: deterministic detection ──────────────────────────────────── */

test("personal-archive detection is strict schema equality and steals nothing", async () => {
  const OD = await loadRuntime();
  const adapter = OD.adapters.find(item => item.id === "personal-archive-v1");
  assert.ok(adapter, "the adapter registers itself");

  assert.equal(adapter.detectJSON(await loadFixture()), true);
  assert.equal(adapter.detectJSON({ schema: "our-dialogues.normalized.v1", conversations: [] }), false);
  assert.equal(adapter.detectJSON({ schema: "our-dialogues.personal-archive.v2" }), false);
  assert.equal(adapter.detectJSON({ collections: [{ entries: [] }] }), false, "shape alone never triggers detection");
  assert.equal(adapter.detectJSON(null), false);

  const normalized = OD.adapters.find(item => item.id === "normalized-v1");
  assert.equal(normalized.detectJSON(await loadFixture()), false, "the sibling schema adapter stays blind to it");
});

test("the registry recognizes the fixture through the personal-archive adapter", async () => {
  const OD = await loadRuntime();
  const result = await OD.registry.parseJSON(await loadFixture());
  assert.equal(result.recognized, true);
  assert.equal(result.adapter.id, "personal-archive-v1");
  assert.equal(result.archive.schema, "our-dialogues.normalized.v1");
  assert.equal(result.archive.source.platform, "personal-archive");
  assert.equal(result.archive.source.exporter, "our-dialogues-personal-archive");
  assert.equal(result.archive.source.formatVersion, 1);
});

/* ── PA-2: normalization mapping ────────────────────────────────────── */

test("each entry maps to one document-marked conversation with exact text", async () => {
  const OD = await loadRuntime();
  const data = await loadFixture();
  const { archive } = await OD.registry.parseJSON(data);

  const sourceEntries = data.collections.flatMap(collection =>
    collection.entries.map(entry => ({ collection, entry })));
  assert.equal(archive.conversations.length, sourceEntries.length, "every valid entry becomes one conversation");

  const byId = new Map(archive.conversations.map(conversation => [conversation.id, conversation]));
  for (const { collection, entry } of sourceEntries) {
    const conversation = byId.get(`personal:${collection.id}:${entry.id}`);
    assert.ok(conversation, `stable id for ${entry.id}`);
    const sourceMetadata = conversation.context.sourceMetadata;
    assert.equal(sourceMetadata.contentKind, "personal-document");
    assert.equal(sourceMetadata.collectionId, collection.id);
    assert.equal(sourceMetadata.collectionName, collection.name);
    assert.equal(conversation.messages.length, 1, "one body message per entry");
    const body = conversation.messages[0];
    assert.equal(body.id, `personal:${collection.id}:${entry.id}:body`);
    assert.equal(body.role, "other", "never a fake user/assistant");
    assert.equal(body.speaker, "半夏");
    assert.equal(body.metadata.personalDocument, true);
    assert.equal(body.content[0].text, entry.text, `text is byte-identical for ${entry.id}`);
  }

  // Collection type preservation, including the unknown-type fallback.
  const poem = byId.get("personal:col-poetry:poem-0001");
  assert.equal(poem.context.sourceMetadata.documentType, "other");
  assert.equal(poem.context.sourceMetadata.documentTypeOriginal, "poetry");
  const diary = byId.get("personal:col-diary:diary-2016-03-17");
  assert.equal(diary.context.sourceMetadata.documentType, "diary");
  assert.equal(diary.context.sourceMetadata.documentTypeOriginal, undefined);

  // Tags and free-form metadata ride along as provenance.
  const dream = byId.get("personal:col-dream:dream-2024-09-08-01");
  assert.deepEqual(plain(dream.context.sourceMetadata.entryTags), ["图书馆", "雾", "反复出现"]);
  const weibo = byId.get("personal:col-weibo:weibo-3550419208");
  assert.equal(weibo.context.sourceMetadata.entryMetadata.place, "白盏镇·汐洲路站");

  // Participants carry the author with role "other".
  assert.deepEqual(plain(diary.participants), [{ id: "author-banxia", name: "半夏", role: "other" }]);

  // Dates: never invented; date-only strings keep their day.
  assert.ok(String(diary.createdAt).startsWith("2016-03-17"));
  const fragment = byId.get("personal:col-fragment:fragment-0001");
  assert.equal(fragment.createdAt, null);
});

test("titles follow the conservative provenance chain", async () => {
  const OD = await loadRuntime();
  const { archive } = await OD.registry.parseJSON(await loadFixture());
  const byId = new Map(archive.conversations.map(conversation => [conversation.id, conversation]));

  const dated = byId.get("personal:col-diary:diary-2016-03-17");
  assert.equal(dated.title, "2016-03-17");
  assert.equal(dated.context.sourceMetadata.titleSource, "date");
  const datedTwin = byId.get("personal:col-diary:diary-2016-03-17-02");
  assert.equal(datedTwin.title, "2016-03-17", "same day, same displayed date, distinct id");

  const original = byId.get("personal:col-dream:dream-2024-09-08-01");
  assert.equal(original.title, "灯塔图书馆");
  assert.equal(original.context.sourceMetadata.titleSource, "original");

  const heading = byId.get("personal:col-fragment:fragment-0003");
  assert.equal(heading.title, "越冬清单");
  assert.equal(heading.context.sourceMetadata.titleSource, "heading");
  assert.ok(heading.messages[0].content[0].text.startsWith("# 越冬清单"), "the body keeps its heading line untouched");

  const firstLine = byId.get("personal:col-fragment:fragment-0001");
  assert.equal(firstLine.context.sourceMetadata.titleSource, "first-line");
  assert.equal(firstLine.title, "夹在旧课本里的一句话，没头没尾：“先把水烧上，其…");
});

test("edge titles: long first lines truncate, blank bodies fall back to 无题", async () => {
  const OD = await loadRuntime();
  const document = {
    schema: "our-dialogues.personal-archive.v1",
    archive: { id: "edge", name: "边界", author: { id: "e", name: "边" } },
    collections: [{
      id: "edge-col",
      name: "边界集",
      type: "note",
      entries: [
        { id: "long-line", text: "这一行非常非常长，专门用来验证保守摘录会在第二十四个字符处截断并加上省略号标记。" },
        { id: "blank-body", text: "   \n\n  " }
      ]
    }]
  };
  const { archive } = await OD.registry.parseJSON(document);
  const byId = new Map(archive.conversations.map(conversation => [conversation.id, conversation]));

  const long = byId.get("personal:edge-col:long-line");
  assert.equal(long.context.sourceMetadata.titleSource, "first-line");
  assert.equal(Array.from(long.title).length, 25, "24 characters plus the ellipsis");
  assert.ok(long.title.endsWith("…"));

  const blank = byId.get("personal:edge-col:blank-body");
  assert.equal(blank.context.sourceMetadata.titleSource, "fallback");
  assert.equal(blank.title, "无题");
  assert.equal(blank.messages[0].content[0].text, "   \n\n  ", "even whitespace bodies stay untouched");
});

test("conversion is deterministic: converting twice yields identical archives", async () => {
  const OD = await loadRuntime();
  const first = await OD.registry.parseJSON(await loadFixture());
  const second = await OD.registry.parseJSON(await loadFixture());
  assert.deepEqual(
    first.archive.conversations.map(conversation => conversation.id),
    second.archive.conversations.map(conversation => conversation.id)
  );
  assert.deepEqual(first.archive, second.archive);
});

test("malformed collections and entries are skipped and counted, never guessed at", async () => {
  const OD = await loadRuntime();
  const document = {
    schema: "our-dialogues.personal-archive.v1",
    archive: { id: "messy", name: "混乱箱" },
    collections: [
      { id: "ok", name: "好集合", type: "note", entries: [
        { id: "keep-1", text: "留下来的一条。" },
        { text: "没有 id，跳过。" },
        { id: "empty-text", text: "" },
        null
      ] },
      { name: "没有 id 的集合", entries: [{ id: "lost", text: "整个集合被跳过。" }] },
      "not-an-object"
    ]
  };
  const { archive } = await OD.registry.parseJSON(document);
  assert.equal(archive.conversations.length, 1);
  assert.equal(archive.conversations[0].id, "personal:ok:keep-1");
  assert.deepEqual(plain(archive.source.personalImport), {
    collections: 1,
    entries: 1,
    datedEntries: 0,
    undatedEntries: 1,
    skippedCollections: 2,
    skippedEntries: 3,
    types: { note: 1 }
  });
});

test("the source root carries the archive label and counts-only import stats", async () => {
  const OD = await loadRuntime();
  const { archive } = await OD.registry.parseJSON(await loadFixture());
  assert.equal(archive.source.sourceLabel, "半夏的字纸箱");
  assert.equal(archive.source.archiveId, "archive-banxia-01");
  assert.deepEqual(plain(archive.source.personalImport), {
    collections: 5,
    entries: 16,
    datedEntries: 12,
    undatedEntries: 4,
    skippedCollections: 0,
    skippedEntries: 0,
    types: { diary: 1, dream: 1, microblog: 1, fragment: 1, other: 1 }
  });
  const flattened = JSON.stringify(archive.source.personalImport);
  assert.ok(!flattened.includes("纸上"), "diagnostics stay counts-only, no names or body text");
});
