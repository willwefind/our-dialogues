import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadRuntime() {
  const runtime = { console, Blob, File, Date, setTimeout, clearTimeout };
  runtime.window = runtime;
  vm.createContext(runtime);
  for (const relativePath of [
    "src/core/schema.js",
    "src/core/source-library.js",
    "src/core/persistent-library.js"
  ]) {
    vm.runInContext(await readFile(path.join(repositoryRoot, relativePath), "utf8"), runtime, { filename: relativePath });
  }
  return runtime.OD;
}

function sourceArchive(OD, id="session-one") {
  return OD.schema.archive({
    platform: "mufy",
    exporter: "mufy-synthetic",
    conversations: [{
      id,
      title: "Persistent synthetic session",
      context: { sourceMetadata: { characterId: "character-synthetic", characterName: "Synthetic" } },
      messages: [{
        id: `${id}-assistant`,
        role: "assistant",
        content: [{
          type: "source-rich-block",
          source: "mufy",
          kind: "status-card",
          text: "Mood calm",
          rows: [{ label: "Mood", value: "calm" }]
        }],
        attachments: [{ id: "file-synthetic", name: "synthetic.png", mimeType: "image/png" }],
        metadata: {
          sourceTrace: [{ type: "text", text: "Synthetic trace" }],
          accidentalBinary: new File(["must not persist"], "private.bin")
        }
      }]
    }]
  });
}

function containsBinary(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object") return false;
  if (value instanceof Blob || value instanceof File) return true;
  if (seen.has(value)) return false;
  seen.add(value);
  return Object.values(value).some(item => containsBinary(item, seen));
}

test("persistent library round-trips normalized sources without binary payloads", async () => {
  const OD = await loadRuntime();
  const driver = OD.persistentLibrary._internals.createMemoryDriver({ version: 0 });
  const persistence = OD.persistentLibrary.create({ driver });
  const library = OD.sourceLibrary.create();
  const directoryHandle = {
    kind: "directory",
    name: "synthetic-export",
    async queryPermission() { return "prompt"; },
    async requestPermission() { return "granted"; }
  };
  const added = library.add({
    archive: sourceArchive(OD),
    label: "Synthetic Mufy folder",
    assetSession: { objectURLs: { revokeAll() {} } },
    directoryHandle,
    reconnectMode: "folder"
  });

  await persistence.saveSource(added.source);
  const stored = driver.inspect();
  assert.equal(stored.version, 1, "opening an older empty store migrates it to schema v1");
  assert.equal(stored.sources.length, 1);
  assert.equal(stored.conversations.length, 1);
  assert.equal(containsBinary(stored), false, "File and Blob objects must never enter persistent records");
  assert.equal(stored.sources[0].directoryHandle, directoryHandle, "a safe directory handle may be retained");
  const audit = await persistence.audit();
  assert.equal(audit.name, "our-dialogues.library.v1");
  assert.equal(audit.version, 1);
  assert.equal(audit.sourceRecords, 1);
  assert.equal(audit.conversationRecords, 1);
  assert.equal(audit.binaryCount, 0);
  assert.equal(audit.directoryHandleRecords, 1);

  const restored = await persistence.restore();
  assert.equal(restored.sources.length, 1);
  assert.equal(restored.sources[0].assetSession, undefined);
  assert.equal(restored.sources[0].assetMode, "local-reconnect");
  assert.equal(restored.sources[0].conversations[0].context.sourceMetadata.characterId, "character-synthetic");
  const message = restored.sources[0].conversations[0].messages[0];
  assert.equal(message.content[0].type, "source-rich-block");
  assert.equal(message.metadata.sourceTrace[0].text, "Synthetic trace");
  assert.equal("accidentalBinary" in message.metadata, false);
});

test("refresh reconstruction restores prefs, recent conversation, and reading position", async () => {
  const OD = await loadRuntime();
  const driver = OD.persistentLibrary._internals.createMemoryDriver();
  const persistence = OD.persistentLibrary.create({ driver });
  const firstRuntime = OD.sourceLibrary.create();
  const added = firstRuntime.add({ archive: sourceArchive(OD), label: "Mufy", reconnectMode: "folder" });
  await persistence.saveSource(added.source);
  await persistence.saveSettings({
    sourceFilter: added.source.id,
    conversationSort: "desc",
    hideUser: true,
    showThinking: true,
    theme: "night",
    recentConversationId: added.source.conversations[0].id,
    readingPosition: {
      conversationId: added.source.conversations[0].id,
      messageId: "session-one-assistant",
      scrollTop: 418,
      timestamp: "2026-08-16T04:00:00.000Z"
    }
  });

  const refreshedRuntime = OD.sourceLibrary.create();
  const snapshot = await persistence.restore();
  snapshot.sources.forEach(source => refreshedRuntime.restore(source));
  const prefs = await persistence.loadSettings();
  assert.equal(refreshedRuntime.size, 1);
  assert.equal(refreshedRuntime.archive().conversations.length, 1);
  assert.equal(prefs.sourceFilter, added.source.id);
  assert.equal(prefs.recentConversationId, "session-one");
  assert.equal(prefs.readingPosition.messageId, "session-one-assistant");
  assert.equal(prefs.readingPosition.scrollTop, 418);
  assert.equal(prefs.theme, "night");
  assert.equal(prefs.hideUser, true);
  assert.equal(prefs.showThinking, true);
});

test("source add, remove, clear, reset, and duplicate-after-restore stay synchronized", async () => {
  const OD = await loadRuntime();
  const driver = OD.persistentLibrary._internals.createMemoryDriver();
  const persistence = OD.persistentLibrary.create({ driver });
  const archive = sourceArchive(OD);
  const initial = OD.sourceLibrary.create();
  const added = initial.add({ archive, label: "Mufy" });
  await persistence.saveSource(added.source);

  const refreshed = OD.sourceLibrary.create();
  const snapshot = await persistence.restore();
  snapshot.sources.forEach(source => refreshed.restore(source));
  const duplicate = refreshed.add({ archive, label: "Same source again" });
  assert.equal(duplicate.duplicate, true);
  assert.equal(refreshed.size, 1);

  await persistence.removeSource(added.source.id);
  assert.equal((await persistence.restore()).sources.length, 0);
  const second = initial.add({ archive: sourceArchive(OD, "session-two"), label: "Mufy two" });
  await persistence.saveSource(added.source);
  await persistence.saveSource(second.source);
  assert.equal((await persistence.restore()).sources.length, 2);
  await persistence.clearSources();
  assert.equal((await persistence.restore()).sources.length, 0);
  assert.equal((await persistence.audit()).conversationRecords, 0);

  await persistence.saveSettings({ theme: "mist" });
  await persistence.reset();
  assert.equal((await persistence.restore()).sources.length, 0);
  assert.equal(await persistence.loadSettings(), null);
  assert.equal(driver.inspect().version, 1);
});

test("incomplete or mismatched batches are ignored during safe restore", async () => {
  const OD = await loadRuntime();
  const driver = OD.persistentLibrary._internals.createMemoryDriver({
    version: 1,
    sources: [{
      id: "source-incomplete",
      fingerprint: "incomplete",
      label: "Incomplete",
      state: "ready",
      conversationCount: 2,
      savedAt: "2026-08-16T00:00:00.000Z"
    }],
    conversations: [{
      key: "source-incomplete\u0000one",
      sourceId: "source-incomplete",
      order: 0,
      conversation: { id: "one", title: "Only one record", messages: [] }
    }]
  });
  const persistence = OD.persistentLibrary.create({ driver });
  assert.deepEqual([...(await persistence.restore()).sources], []);
});

test("unsupported directory-handle cloning falls back to a restorable text library", async () => {
  const OD = await loadRuntime();
  const base = OD.persistentLibrary._internals.createMemoryDriver();
  let rejectedHandle = false;
  const driver = {
    ...base,
    async replaceSource(metadata, records, batchSize) {
      if (metadata.directoryHandle && !rejectedHandle) {
        rejectedHandle = true;
        throw new DOMException("Handle cannot be cloned", "DataCloneError");
      }
      return base.replaceSource(metadata, records, batchSize);
    }
  };
  const persistence = OD.persistentLibrary.create({ driver });
  const library = OD.sourceLibrary.create();
  const source = library.add({
    archive: sourceArchive(OD),
    label: "Mufy",
    directoryHandle: {
      kind: "directory",
      async queryPermission() { return "prompt"; },
      async requestPermission() { return "granted"; }
    }
  }).source;

  await persistence.saveSource(source);
  const restored = await persistence.restore();
  assert.equal(rejectedHandle, true);
  assert.equal(source.directoryHandlePersisted, false);
  assert.equal(restored.sources.length, 1);
  assert.equal(restored.sources[0].directoryHandle, undefined);
  assert.equal(restored.sources[0].conversations[0].title, "Persistent synthetic session");
});
