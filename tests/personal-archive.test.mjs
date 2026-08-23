import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadFixture() {
  const raw = await readFile(path.join(repositoryRoot, "fixtures", "personal-archive-v1-synthetic.json"), "utf8");
  return JSON.parse(raw);
}

const ALLOWED_TYPES = ["diary", "dream", "essay", "microblog", "note", "letter", "fragment", "other"];

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
