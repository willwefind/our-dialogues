import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadOrganization() {
  const runtime = { console, Date };
  runtime.window = runtime;
  vm.createContext(runtime);
  const source = await readFile(path.join(repositoryRoot, "src", "core", "organization.js"), "utf8");
  vm.runInContext(source, runtime, { filename: "src/core/organization.js" });
  return runtime.OD.organization;
}

test("favorites toggle on and off and keep their timestamp", async () => {
  const org = await loadOrganization();
  let state = org.normalize(null);
  state = org.toggleFavorite(state, "conv-1", "2026-08-20T10:00:00.000Z");
  assert.equal(org.isFavorite(state, "conv-1"), true);
  assert.equal(state.favorites["conv-1"], "2026-08-20T10:00:00.000Z");
  state = org.toggleFavorite(state, "conv-1");
  assert.equal(org.isFavorite(state, "conv-1"), false);
  assert.deepEqual({ ...state.favorites }, {});
});

test("tags normalize, deduplicate, cap, and remove cleanly", async () => {
  const org = await loadOrganization();
  let state = org.normalize(null);
  state = org.setTags(state, "conv-1", ["  日常  ", "日常", "重要", `${"长".repeat(40)}`, "", null]);
  assert.deepEqual([...org.tagsOf(state, "conv-1")], ["日常", "重要", "长".repeat(24)]);

  state = org.addTag(state, "conv-1", "新标签");
  assert.equal(org.tagsOf(state, "conv-1").length, 4);
  state = org.removeTag(state, "conv-1", "日常");
  assert.equal(org.tagsOf(state, "conv-1").includes("日常"), false);

  state = org.setTags(state, "conv-1", []);
  assert.equal("conv-1" in state.tags, false, "empty tag lists disappear from storage");

  const capped = org.setTags(org.normalize(null), "c", Array.from({ length: 30 }, (_, i) => `t${i}`));
  assert.equal(org.tagsOf(capped, "c").length, org.TAGS_PER_CONVERSATION);
});

test("allTags counts usage across conversations and matches() composes filters", async () => {
  const org = await loadOrganization();
  let state = org.normalize(null);
  state = org.setTags(state, "a", ["日常", "旅行"]);
  state = org.setTags(state, "b", ["日常"]);
  state = org.toggleFavorite(state, "a");

  assert.deepEqual(
    Array.from(org.allTags(state), item => `${item.tag}:${item.count}`),
    ["日常:2", "旅行:1"]
  );

  assert.equal(org.matches(state, "a", { favoritesOnly: true, tag: "旅行" }), true);
  assert.equal(org.matches(state, "b", { favoritesOnly: true }), false);
  assert.equal(org.matches(state, "b", { tag: "旅行" }), false);
  assert.equal(org.matches(state, "b", {}), true, "no filters means everything matches");
});

test("normalize survives garbage and legacy shapes", async () => {
  const org = await loadOrganization();
  const state = org.normalize({
    favorites: { "conv-1": 42, "": "2026-01-01T00:00:00.000Z", "conv-2": "2026-01-01T00:00:00.000Z" },
    tags: { "conv-1": "not-an-array", "conv-3": ["ok", 7, "  ok  "] , "": ["x"] }
  });
  assert.equal(org.isFavorite(state, "conv-2"), true);
  assert.equal(typeof state.favorites["conv-1"], "string", "non-string timestamps become a valid ISO string");
  assert.deepEqual([...org.tagsOf(state, "conv-3")], ["ok", "7"]);
  assert.equal("conv-1" in state.tags, false);
});
