import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadRuntime() {
  const runtime = { console };
  runtime.window = runtime;
  vm.createContext(runtime);
  for (const relativePath of ["src/core/schema.js", "src/core/source-library.js"]) {
    vm.runInContext(await readFile(path.join(repositoryRoot, relativePath), "utf8"), runtime, { filename: relativePath });
  }
  return runtime.OD;
}

function archive(OD, platform, id, text) {
  return OD.schema.archive({
    platform,
    exporter: `${platform}-synthetic`,
    conversations: [{
      id,
      title: `${platform} conversation`,
      messages: [{ id: `${id}-message`, role: "assistant", content: text }]
    }]
  });
}

test("Mufy then Claude then ChatGPT imports coexist in the in-memory library", async () => {
  const OD = await loadRuntime();
  const library = OD.sourceLibrary.create();

  const mufy = library.add({ archive: archive(OD, "mufy", "mufy-session", "Mufy reply"), label: "Mufy folder" });
  const claude = library.add({ archive: archive(OD, "claude", "claude-chat", "Claude reply"), label: "Claude JSON" });
  const chatgpt = library.add({ archive: archive(OD, "chatgpt", "chatgpt-chat", "ChatGPT reply"), label: "ChatGPT" });

  assert.equal(mufy.duplicate, false);
  assert.equal(claude.duplicate, false);
  assert.equal(chatgpt.duplicate, false);
  assert.equal(library.size, 3);
  assert.deepEqual(
    [...library.archive().conversations.map(conversation => conversation.context.library.sourceLabel)],
    ["Mufy folder", "Claude JSON", "ChatGPT"]
  );
});

test("duplicate import is skipped and its unused asset session is disposed", async () => {
  const OD = await loadRuntime();
  const library = OD.sourceLibrary.create();
  const sourceArchive = archive(OD, "chatgpt", "same-chat", "same body");
  let disposed = 0;

  const first = library.add({ archive: sourceArchive, label: "ChatGPT" });
  const duplicate = library.add({
    archive: sourceArchive,
    label: "Renamed file but same normalized archive",
    assetSession: { dispose() { disposed += 1; } }
  });

  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.source.id, first.source.id);
  assert.equal(library.size, 1);
  assert.equal(disposed, 1);
});

test("removing one source retains the others and clear disposes remaining assets", async () => {
  const OD = await loadRuntime();
  const library = OD.sourceLibrary.create();
  let disposed = 0;
  const assetSession = () => ({ dispose() { disposed += 1; } });
  const mufy = library.add({ archive: archive(OD, "mufy", "shared-id", "one"), label: "Mufy", assetSession: assetSession() });
  const claude = library.add({ archive: archive(OD, "claude", "shared-id", "two"), label: "Claude", assetSession: assetSession() });
  const chatgpt = library.add({ archive: archive(OD, "chatgpt", "chatgpt-id", "three"), label: "ChatGPT", assetSession: assetSession() });

  assert.notEqual(
    mufy.source.conversations[0].id,
    claude.source.conversations[0].id,
    "conversation IDs that collide across sources must remain independently addressable"
  );
  assert.equal(library.remove(claude.source.id)?.label, "Claude");
  assert.equal(disposed, 1);
  assert.equal(library.size, 2);
  assert.deepEqual([...library.sources().map(source => source.label)], ["Mufy", "ChatGPT"]);
  assert.equal(library.archive().conversations.length, 2);
  assert.equal(library.sourceForConversation(chatgpt.source.conversations[0])?.id, chatgpt.source.id);

  assert.equal(library.clear(), 2);
  assert.equal(disposed, 3);
  assert.equal(library.size, 0);
});
