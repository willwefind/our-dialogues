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

/* A small in-memory IndexedDB, just enough for the real driver: stores with a
   keyPath, one index, cursors, and transactions that commit all-or-nothing.
   failPut(record) makes the transaction holding that put abort, the way a
   full disk does. */
function fakeIndexedDB({ failPut = () => false } = {}) {
  const databases = new Map();
  const later = fn => setTimeout(fn, 0);
  const request = () => ({ onsuccess: null, onerror: null, result: undefined });
  function openConnection(data) {
    const connection = {
      closed: false,
      onversionchange: null,
      objectStoreNames: { contains: name => data.stores.has(name) },
      createObjectStore(name, { keyPath }) {
        const store = { keyPath, indexes: new Map(), rows: new Map() };
        data.stores.set(name, store);
        return { createIndex(indexName, indexKeyPath) { store.indexes.set(indexName, indexKeyPath); } };
      },
      close() { connection.closed = true; data.connections.delete(connection); },
      transaction(names) {
        if (connection.closed) throw new DOMException("The connection is closing.", "InvalidStateError");
        // Reads see a snapshot; writes are replayed onto the live rows at
        // commit, so transactions that overlap in time don't undo each other.
        const staged = new Map([...data.stores].map(([name, store]) => [name, new Map(store.rows)]));
        const writes = [];
        const tx = { oncomplete: null, onerror: null, onabort: null, error: null };
        let failed = null;
        let open = 0;
        let finished = false;
        // Like a real transaction: it stays alive while requests are pending
        // and commits once the last one has been answered.
        const maybeCommit = () => later(() => {
          if (open > 0 || finished) return;
          finished = true;
          if (failed) { tx.error = failed; tx.onabort?.(); return; }
          for (const write of writes) write(data.stores);
          tx.oncomplete?.();
        });
        const settle = request => value => {
          open += 1;
          later(() => { request.result = value; request.onsuccess?.(); open -= 1; maybeCommit(); });
        };
        tx.objectStore = name => {
          const store = data.stores.get(name);
          const rows = staged.get(name);
          const indexed = (indexName, key) => [...rows.values()].filter(row => row[store.indexes.get(indexName)] === key);
          return {
            put(value) {
              if (failPut(value)) failed = new DOMException("Synthetic full disk", "QuotaExceededError");
              rows.set(value[store.keyPath], structuredClone(value));
              writes.push(live => live.get(name).rows.set(value[store.keyPath], structuredClone(value)));
              const r = request(); settle(r)(value[store.keyPath]); return r;
            },
            delete(key) { rows.delete(key); writes.push(live => live.get(name).rows.delete(key)); const r = request(); settle(r)(undefined); return r; },
            clear() { rows.clear(); writes.push(live => live.get(name).rows.clear()); const r = request(); settle(r)(undefined); return r; },
            get(key) { const r = request(); settle(r)(structuredClone(rows.get(key))); return r; },
            getAll() { const r = request(); settle(r)([...rows.values()].map(row => structuredClone(row))); return r; },
            index(indexName) {
              return {
                getAll(key) { const r = request(); settle(r)(indexed(indexName, key).map(row => structuredClone(row))); return r; },
                openCursor(key) {
                  const r = request();
                  const matches = indexed(indexName, key);
                  let position = 0;
                  const step = () => {
                    open += 1;
                    later(() => {
                      const row = matches[position++];
                      r.result = row ? {
                        value: structuredClone(row),
                        delete() {
                          rows.delete(row[store.keyPath]);
                          writes.push(live => live.get(name).rows.delete(row[store.keyPath]));
                        },
                        continue() { step(); }
                      } : null;
                      r.onsuccess?.();
                      open -= 1;
                      maybeCommit();
                    });
                  };
                  step();
                  return r;
                }
              };
            }
          };
        };
        maybeCommit();
        return tx;
      }
    };
    data.connections.add(connection);
    return connection;
  }
  return {
    databases,
    open(name, version) {
      const r = { ...request(), onupgradeneeded: null, onblocked: null };
      later(() => {
        if (!databases.has(name)) databases.set(name, { version: 0, stores: new Map(), connections: new Set() });
        const data = databases.get(name);
        const oldVersion = data.version;
        r.result = openConnection(data);
        if (oldVersion < version) { data.version = version; r.onupgradeneeded?.({ oldVersion }); }
        r.onsuccess?.();
      });
      return r;
    },
    deleteDatabase(name) {
      const r = request();
      later(() => {
        const data = databases.get(name);
        for (const connection of [...(data?.connections || [])]) connection.onversionchange?.();
        databases.delete(name);
        r.onsuccess?.();
      });
      return r;
    }
  };
}

function syntheticSource(id, count, tag) {
  return {
    id,
    label: id,
    conversations: Array.from({ length: count }, (_, index) => ({ id: `c${index}`, title: `${tag} ${index}`, messages: [] }))
  };
}

test("a re-save that fails halfway keeps the copy that was already saved", async () => {
  const OD = await loadRuntime();
  let failing = false;
  const indexedDB = fakeIndexedDB({ failPut: record => failing && record.conversation?.id === "c30" });
  const persistence = OD.persistentLibrary.create({ driver: OD.persistentLibrary._internals.createIndexedDBDriver(indexedDB) });

  await persistence.saveSource(syntheticSource("source-safe", 50, "Old"));
  failing = true;
  await assert.rejects(persistence.saveSource(syntheticSource("source-safe", 50, "New")), /full disk/);
  failing = false;

  const restored = await persistence.restore();
  assert.equal(restored.sources.length, 1, "the source is still there after the failed save");
  assert.equal(restored.sources[0].conversations.length, 50);
  assert.ok(restored.sources[0].conversations.every(conversation => conversation.title.startsWith("Old")));
  assert.equal((await persistence.audit()).conversationRecords, 50, "the partial new rows are tidied away");

  await persistence.saveSource(syntheticSource("source-safe", 3, "Newer"));
  const resaved = await persistence.restore();
  assert.equal(resaved.sources[0].conversations.map(conversation => conversation.title).join("|"), "Newer 0|Newer 1|Newer 2");
  assert.equal((await persistence.audit()).conversationRecords, 3, "a successful save leaves no old rows behind");
});

test("rows saved before generations existed still restore, and the next save replaces them", async () => {
  const OD = await loadRuntime();
  const driver = OD.persistentLibrary._internals.createMemoryDriver({
    version: 1,
    sources: [{ id: "source-legacy", label: "Legacy", state: "ready", conversationCount: 1, savedAt: "2026-08-16T00:00:00.000Z" }],
    conversations: [{
      key: "source-legacy\u0000one",
      sourceId: "source-legacy",
      order: 0,
      conversation: { id: "one", title: "Legacy record", messages: [] }
    }]
  });
  const persistence = OD.persistentLibrary.create({ driver });
  assert.equal((await persistence.restore()).sources[0].conversations[0].title, "Legacy record");
  await persistence.saveSource(syntheticSource("source-legacy", 2, "Fresh"));
  const restored = await persistence.restore();
  assert.deepEqual(restored.sources[0].conversations.map(conversation => conversation.title).join("|"), "Fresh 0|Fresh 1");
  assert.equal(driver.inspect().conversations.length, 2);
});

test("removing or clearing a source while it is still being saved keeps it removed", async () => {
  const OD = await loadRuntime();
  for (const action of ["remove", "clear"]) {
    const persistence = OD.persistentLibrary.create({
      driver: OD.persistentLibrary._internals.createIndexedDBDriver(fakeIndexedDB())
    });
    await persistence.open();
    const saving = persistence.saveSource(syntheticSource("source-busy", 100, "Busy"));
    await new Promise(resolve => setTimeout(resolve, 3));
    if (action === "remove") await persistence.removeSource("source-busy");
    else await persistence.clearSources();
    await saving;
    assert.equal((await persistence.restore()).sources.length, 0, `${action} wins over the save in flight`);
    assert.equal((await persistence.audit()).conversationRecords, 0, `${action} leaves no orphaned rows`);
  }
});

test("a tab whose library was reset from another tab reconnects instead of failing", async () => {
  const OD = await loadRuntime();
  const indexedDB = fakeIndexedDB();
  const { createIndexedDBDriver } = OD.persistentLibrary._internals;
  const tabA = OD.persistentLibrary.create({ driver: createIndexedDBDriver(indexedDB) });
  const tabB = OD.persistentLibrary.create({ driver: createIndexedDBDriver(indexedDB) });
  await tabA.saveSource(syntheticSource("source-shared", 2, "Shared"));
  assert.equal((await tabB.restore()).sources.length, 1);

  await tabA.reset();
  assert.equal((await tabB.restore()).sources.length, 0);
  await tabB.saveSource(syntheticSource("source-after", 1, "After"));
  assert.equal((await tabB.restore()).sources[0].id, "source-after");
});
