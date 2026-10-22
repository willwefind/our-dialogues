import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadShelf() {
  const runtime = { console, Date, Math };
  runtime.window = runtime;
  vm.createContext(runtime);
  const source = await readFile(path.join(repositoryRoot, "src", "core", "source-shelf.js"), "utf8");
  vm.runInContext(source, runtime, { filename: "src/core/source-shelf.js" });
  return runtime.OD.sourceShelf;
}

const plain = value => JSON.parse(JSON.stringify(value));

test("a source keeps its archive label until the reader names it, and restoring is one step", async () => {
  const shelf = await loadShelf();
  const source = { id: "source-a", label: "ChatGPT official export (2026 validated)" };
  let state = shelf.normalize(null);
  assert.equal(shelf.displayName(state, source), source.label);
  assert.equal(shelf.hasCustomName(state, source.id), false);

  state = shelf.rename(state, source.id, "  和 Sol   的对话  ", source.label);
  assert.equal(shelf.displayName(state, source), "和 Sol 的对话");
  assert.equal(shelf.hasCustomName(state, source.id), true);

  assert.equal(shelf.hasCustomName(shelf.rename(state, source.id, "", source.label), source.id), false, "an emptied field restores");
  assert.equal(shelf.hasCustomName(shelf.rename(state, source.id, ` ${source.label} `, source.label), source.id), false, "typing the archive label back restores");
  assert.equal(shelf.displayName(shelf.rename(state, source.id, "长".repeat(80)), source).length, shelf.NAME_MAX_LENGTH, "long names are cut, not refused");
});

test("groups are created by name, reused by name, and vanish with their last source", async () => {
  const shelf = await loadShelf();
  let state = shelf.normalize(null);
  let result = shelf.assignToNewGroup(state, "source-a", "  旧日  ");
  state = result.shelf;
  const groupId = result.groupId;
  assert.ok(groupId);
  assert.deepEqual(plain(state.groups), [{ id: groupId, name: "旧日" }]);

  result = shelf.assignToNewGroup(state, "source-b", "旧日");
  assert.equal(result.groupId, groupId, "a second group with the same name is the same group");
  state = result.shelf;
  assert.equal(shelf.groupOf(state, "source-b").name, "旧日");

  state = shelf.assign(state, "source-a", null);
  assert.equal(state.groups.length, 1, "one source still holds the group");
  state = shelf.assign(state, "source-b", "");
  assert.equal(state.groups.length, 0, "the last source out takes the group with it");
  assert.deepEqual(plain(state.members), {});

  assert.equal(shelf.assignToNewGroup(state, "source-a", "   ").groupId, null, "a blank group name creates nothing");
  assert.equal(shelf.groupOf(shelf.assign(state, "source-a", "no-such-group"), "source-a"), null, "an unknown group files nothing");
});

test("renaming a group refuses an empty name, and dissolving sends every source back", async () => {
  const shelf = await loadShelf();
  let { shelf: state, groupId } = shelf.assignToNewGroup(null, "source-a", "工作");
  state = shelf.assign(state, "source-b", groupId);
  state = shelf.renameGroup(state, groupId, "   ");
  assert.equal(state.groups[0].name, "工作");
  state = shelf.renameGroup(state, groupId, "客户");
  assert.equal(shelf.groupOf(state, "source-b").name, "客户");

  state = shelf.dissolveGroup(state, groupId);
  assert.deepEqual(plain(state), { names: {}, groups: [], members: {} });
});

test("arrange keeps library order and seats each group where its first source stood", async () => {
  const shelf = await loadShelf();
  const sources = ["a", "b", "c", "d", "e"].map(id => ({ id, label: id.toUpperCase() }));
  let { shelf: state, groupId: later } = shelf.assignToNewGroup(null, "d", "后来");
  state = shelf.assign(state, "b", later);
  const made = shelf.assignToNewGroup(state, "e", "单独");
  state = made.shelf;

  const rows = plain(shelf.arrange(state, sources).map(row => row.type === "source"
    ? row.source.id
    : `${row.group.name}[${row.sources.map(source => source.id).join(",")}]`));
  assert.deepEqual(rows, ["a", "后来[b,d]", "c", "单独[e]"]);

  const absent = shelf.arrange(state, sources.filter(source => source.id !== "e"));
  assert.equal(absent.some(row => row.type === "group" && row.group.name === "单独"), false, "a group with no present source is not drawn");
  assert.equal(state.groups.length, 2, "…but it is kept for when the source comes back");
});

test("normalize drops broken records and memberships that point nowhere", async () => {
  const shelf = await loadShelf();
  const state = shelf.normalize({
    names: { "source-a": "  小 C ", "source-b": "   ", "": "x" },
    groups: [{ id: "g1", name: "一" }, { id: "g1", name: "重复" }, { id: "g2", name: "" }, { id: "g3", name: "无人" }, null],
    members: { "source-a": "g1", "source-b": "g2", "source-c": "missing" }
  });
  assert.deepEqual(plain(state), {
    names: { "source-a": "小 C" },
    groups: [{ id: "g1", name: "一" }],
    members: { "source-a": "g1" }
  });
  assert.deepEqual(plain(shelf.normalize("nonsense")), { names: {}, groups: [], members: {} });
});

test("several sources move into a group, a new group, or out, in one step", async () => {
  const shelf = await loadShelf();
  let { shelf: state, groupId } = shelf.assignToNewGroup(null, ["a", "b", "a", " ", "c"], "一起");
  assert.deepEqual(plain(state.members), { a: groupId, b: groupId, c: groupId }, "duplicates and blanks are ignored");

  const made = shelf.assignToNewGroup(state, ["b", "c"], "另一组");
  state = made.shelf;
  assert.equal(shelf.groupOf(state, "a").id, groupId);
  assert.equal(shelf.groupOf(state, "c").id, made.groupId);

  state = shelf.assign(state, ["a", "b"], made.groupId);
  assert.equal(state.groups.length, 1, "the emptied group disappears");
  state = shelf.assign(state, ["a", "b", "c"], null);
  assert.deepEqual(plain(state), { names: {}, groups: [], members: {} });
  assert.equal(shelf.assignToNewGroup(state, [], "空").groupId, null, "an empty selection creates nothing");
});
