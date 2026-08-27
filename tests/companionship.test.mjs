import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// vm objects carry a different prototype, so deepStrictEqual refuses them —
// round-trip through JSON before comparing shapes.
const plain = value => JSON.parse(JSON.stringify(value));

async function loadCompanionship() {
  const runtime = { console, Date };
  runtime.window = runtime;
  vm.createContext(runtime);
  const source = await readFile(path.join(repositoryRoot, "src", "core", "companionship.js"), "utf8");
  vm.runInContext(source, runtime, { filename: "src/core/companionship.js" });
  return runtime.OD.companionship;
}

// One Mufy character, shaped the way the adapter delivers it: session dates
// derived from the first dated message, messages carrying the real clock.
function mufyLike() {
  return [
    {
      id: "greeting",
      createdAt: null,
      updatedAt: null,
      messages: [{ id: "g1", createdAt: null }]
    },
    {
      id: "s1",
      createdAt: "2026-06-26T05:50:16.582Z",
      updatedAt: "2026-06-26T07:10:00.000Z",
      messages: [
        { id: "m1", createdAt: "2026-06-26T05:50:16.582Z" },
        { id: "m2", createdAt: "2026-06-26T07:10:00.000Z" }
      ]
    },
    {
      id: "s2",
      createdAt: "2026-03-22T12:43:29.359Z",
      updatedAt: "2026-03-22T13:00:00.000Z",
      messages: [
        { id: "m3", createdAt: "2026-03-22T12:43:29.359Z" },
        { id: "m4", createdAt: "2026-03-22T13:00:00.000Z" }
      ]
    }
  ];
}

test("earliest dated message becomes the meeting date; the undated greeting is ignored", async () => {
  const companionship = await loadCompanionship();
  const summary = companionship.summarize(mufyLike());
  assert.equal(summary.firstAt, "2026-03-22T12:43:29.359Z");
  assert.equal(summary.lastAt, "2026-06-26T07:10:00.000Z");
  assert.equal(summary.conversationCount, 3);
  assert.equal(summary.messageCount, 5);
  assert.equal(summary.datedConversations, 2);
  assert.ok(Math.abs(summary.dateCoverage - 2 / 3) < 1e-9);
});

test("an archive with no dates at all yields no date, never an invented one", async () => {
  const companionship = await loadCompanionship();
  const summary = companionship.summarize([
    { id: "a", createdAt: null, messages: [{ id: "m", createdAt: null }] },
    { id: "b", messages: [] }
  ]);
  assert.equal(summary.firstAt, null);
  assert.equal(summary.lastAt, null);
  assert.equal(summary.datedConversations, 0);
  assert.equal(summary.dateCoverage, 0);
  assert.equal(companionship.daysBetween(null), null);
});

test("unparseable dates are refused rather than passed through as text", async () => {
  const companionship = await loadCompanionship();
  // The schema lets a garbage date survive as a raw string; it must not
  // become a meeting day.
  const summary = companionship.summarize([
    { id: "a", createdAt: "sometime last spring", messages: [] }
  ]);
  assert.equal(summary.firstAt, null);
  assert.equal(summary.datedConversations, 0);
});

test("a time of day is reported only when the archive carries one", async () => {
  const companionship = await loadCompanionship();
  const withClock = companionship.summarize([
    { id: "a", createdAt: "2026-06-26T05:50:16.582Z", messages: [] }
  ]);
  assert.equal(withClock.firstAtHasTime, true);
  // Personal archives keep date-only strings; a fabricated 00:00 would be a lie.
  const dateOnly = companionship.summarize([
    { id: "b", createdAt: "2014-11-02", messages: [] }
  ]);
  assert.equal(dateOnly.firstAt, "2014-11-02");
  assert.equal(dateOnly.firstAtHasTime, false);
});

test("precise mode finds a message earlier than its conversation's own date", async () => {
  const companionship = await loadCompanionship();
  // An adapter that takes the first message in array order can land slightly
  // late when the export is not perfectly ordered.
  const conversations = [{
    id: "s1",
    createdAt: "2026-05-02T09:00:00.000Z",
    messages: [
      { id: "m1", createdAt: "2026-05-02T09:00:00.000Z" },
      { id: "m0", createdAt: "2026-05-01T22:15:00.000Z" }
    ]
  }];
  assert.equal(companionship.summarize(conversations).firstAt, "2026-05-02T09:00:00.000Z");
  assert.equal(companionship.summarize(conversations, { precise: true }).firstAt, "2026-05-01T22:15:00.000Z");
});

test("days are counted as local calendar days, so today is 0 and midnight turns it over", async () => {
  const companionship = await loadCompanionship();
  const now = new Date(2026, 7, 24, 9, 30).getTime();       // 2026-08-24 09:30 local
  const sameDay = new Date(2026, 7, 24, 1, 5).toISOString();
  const yesterdayLate = new Date(2026, 7, 23, 23, 59).toISOString();
  assert.equal(companionship.daysBetween(sameDay, now), 0);
  assert.equal(companionship.daysBetween(yesterdayLate, now), 1);
  // A whole year, counted across a leap day.
  const lastYear = new Date(2025, 7, 24, 12, 0).toISOString();
  assert.equal(companionship.daysBetween(lastYear, now), 365);
});

test("a bare date counts as a local calendar day, not UTC midnight", async () => {
  const companionship = await loadCompanionship();
  // Date.parse reads "2026-08-24" as UTC midnight, which is still the 23rd in
  // the Americas; the day count must follow the reader's own calendar.
  const now = new Date(2026, 7, 26, 10, 0).getTime();
  assert.equal(companionship.daysBetween("2026-08-26", now), 0);
  assert.equal(companionship.daysBetween("2026-08-25", now), 1);
  assert.equal(companionship.daysBetween("2025-08-26", now), 365);
});

test("a manual date wins over the derived one and says so", async () => {
  const companionship = await loadCompanionship();
  const key = "src-1::id:char-9";
  const overrides = companionship.setOverride({}, key, "2025-11-01T20:00:00.000Z");
  const resolved = companionship.resolve(mufyLike(), { key, overrides, now: Date.now() });
  assert.equal(resolved.firstAt, "2025-11-01T20:00:00.000Z");
  assert.equal(resolved.firstAtSource, "manual");
  // The archive's own answer stays visible next to it, never overwritten.
  assert.equal(resolved.derivedFirstAt, "2026-03-22T12:43:29.359Z");
  assert.equal(resolved.key, key);
});

test("without an override the derived date is used and labelled derived", async () => {
  const companionship = await loadCompanionship();
  const resolved = companionship.resolve(mufyLike(), { key: "src-1::id:char-9", overrides: {} });
  assert.equal(resolved.firstAt, "2026-03-22T12:43:29.359Z");
  assert.equal(resolved.firstAtSource, "derived");
  assert.ok(typeof resolved.days === "number");
});

test("a companion with nothing dated resolves to no date and no source label", async () => {
  const companionship = await loadCompanionship();
  const resolved = companionship.resolve([{ id: "a", messages: [] }], { key: "src-1" });
  assert.equal(resolved.firstAt, null);
  assert.equal(resolved.firstAtSource, null);
  assert.equal(resolved.days, null);
});

test("overrides survive a hostile settings blob and drop what they cannot trust", async () => {
  const companionship = await loadCompanionship();
  const normalized = companionship.normalizeOverrides({
    "src-1::id:a": { firstAt: "2026-01-01T00:00:00.000Z" },
    "src-1::id:b": { firstAt: "not a date" },
    "src-1::id:c": { firstAt: null },
    "   ": { firstAt: "2026-01-01T00:00:00.000Z" },
    "src-1::id:d": "just a string",
    "src-1::id:e": null
  });
  assert.deepEqual(Object.keys(normalized), ["src-1::id:a"]);
  assert.deepEqual(plain(normalized), { "src-1::id:a": { firstAt: "2026-01-01T00:00:00.000Z" } });
  // Normalizing is not destructive to the caller's object.
  assert.equal(companionship.overrideFor(normalized, "src-1::id:a"), "2026-01-01T00:00:00.000Z");
  assert.equal(companionship.overrideFor(normalized, "src-1::id:b"), null);
});

test("clearing an override returns to the archive's own answer", async () => {
  const companionship = await loadCompanionship();
  const key = "src-1::id:char-9";
  let overrides = companionship.setOverride({}, key, "2025-11-01T20:00:00.000Z");
  overrides = companionship.clearOverride(overrides, key);
  assert.deepEqual(plain(overrides), {});
  assert.equal(companionship.resolve(mufyLike(), { key, overrides }).firstAtSource, "derived");
});

test("companion keys compose the way the sidebar already groups", async () => {
  const companionship = await loadCompanionship();
  assert.equal(companionship.companionKey("src-1", "id:char-9"), "src-1::id:char-9");
  // A whole source is a companion too — a ChatGPT export, a Claude export.
  assert.equal(companionship.companionKey("src-1", null), "src-1");
  assert.equal(companionship.companionKey("src-1", "  "), "src-1");
  assert.equal(companionship.companionKey("", "id:char-9"), null);
});

test("a reader's name for a companion is stored beside the date, not instead of it", async () => {
  const companionship = await loadCompanionship();
  const key = "source-a::id:7";

  let overrides = companionship.setName({}, key, "  小 C  ");
  assert.equal(companionship.nameFor(overrides, key), "小 C", "whitespace is tidied, not kept");
  assert.equal(companionship.overrideFor(overrides, key), null);

  // Setting a date must not take the name down with it, and vice versa.
  overrides = companionship.setOverride(overrides, key, "2024-06-17T23:41");
  assert.equal(companionship.nameFor(overrides, key), "小 C");
  assert.ok(companionship.overrideFor(overrides, key));

  // Restoring the archive's date leaves the name alone.
  overrides = companionship.clearOverride(overrides, key);
  assert.equal(companionship.overrideFor(overrides, key), null);
  assert.equal(companionship.nameFor(overrides, key), "小 C", "the name survives a date restore");

  // Restoring the archive's name drops the whole record once nothing is left.
  overrides = companionship.clearName(overrides, key);
  assert.equal(companionship.nameFor(overrides, key), null);
  assert.deepEqual(plain(overrides), {}, "an override holding neither is not an override");

  // Blank names never become a name, and long ones are cut rather than refused.
  assert.deepEqual(plain(companionship.setName({}, key, "   ")), {});
  const long = companionship.setName({}, key, "名".repeat(200));
  assert.equal(companionship.nameFor(long, key).length, companionship.MAX_NAME_LENGTH);

  // A stored record carrying only a name survives normalization, which the
  // old date-only rule would have thrown away.
  const restored = companionship.normalizeOverrides({ [key]: { name: "Sol" } });
  assert.equal(companionship.nameFor(restored, key), "Sol");
});

