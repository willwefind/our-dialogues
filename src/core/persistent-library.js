window.OD = window.OD || {};

/*
  IndexedDB-backed text library. Normalized conversations are stored once,
  one record per conversation. File/Blob values and runtime asset sessions are
  deliberately excluded; a FileSystemDirectoryHandle may be retained when the
  browser supports structured-cloning it into IndexedDB.
*/
(function(OD){
  const DB_NAME = "our-dialogues.library.v1";
  const DB_VERSION = 1;
  const SOURCE_STORE = "sources";
  const CONVERSATION_STORE = "conversations";
  const SETTINGS_STORE = "settings";
  const READER_SETTINGS_KEY = "reader";
  const BATCH_SIZE = 24;

  function requestResult(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("IndexedDB request failed."));
    });
  }

  function transactionDone(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("IndexedDB transaction failed."));
      transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction was aborted."));
    });
  }

  function isBinary(value) {
    if (!value || typeof value !== "object") return false;
    if (typeof Blob !== "undefined" && value instanceof Blob) return true;
    return Object.prototype.toString.call(value) === "[object Blob]" ||
      Object.prototype.toString.call(value) === "[object File]";
  }

  function isDirectoryHandle(value) {
    return !!value && typeof value === "object" && value.kind === "directory" &&
      typeof value.queryPermission === "function";
  }

  function auditRecords({ sources = [], conversations = [], settings = [] } = {}) {
    let binaryCount = 0;
    const seen = new WeakSet();
    const visit = value => {
      if (!value || typeof value !== "object" || seen.has(value)) return;
      seen.add(value);
      if (isBinary(value)) {
        binaryCount += 1;
        return;
      }
      if (Array.isArray(value)) value.forEach(visit);
      else Object.values(value).forEach(visit);
    };
    sources.forEach(visit);
    conversations.forEach(visit);
    settings.forEach(visit);
    return {
      sourceRecords: sources.length,
      conversationRecords: conversations.length,
      settingsRecords: settings.length,
      binaryCount,
      directoryHandleRecords: sources.filter(source => isDirectoryHandle(source?.directoryHandle)).length
    };
  }

  function lightweightClone(value, seen = new WeakMap()) {
    if (value == null || ["string", "number", "boolean"].includes(typeof value)) return value;
    if (["function", "symbol", "bigint"].includes(typeof value) || isBinary(value)) return undefined;
    if (value instanceof Date) return value.toISOString();
    if (typeof value !== "object") return undefined;
    if (isDirectoryHandle(value)) return value;
    if (seen.has(value)) return undefined;
    seen.set(value, true);
    if (Array.isArray(value)) {
      return value.map(item => lightweightClone(item, seen)).filter(item => item !== undefined);
    }
    const output = {};
    for (const [key, item] of Object.entries(value)) {
      const cloned = lightweightClone(item, seen);
      if (cloned !== undefined) output[key] = cloned;
    }
    return output;
  }

  function sourceRecords(source, savedAt = new Date().toISOString()) {
    const metadata = lightweightClone({
      id: source.id,
      fingerprint: source.fingerprint,
      label: source.label,
      adapterId: source.adapterId,
      importDetails: source.importDetails,
      source: source.source,
      exportedAt: source.exportedAt,
      assetMode: source.assetMode,
      reconnectMode: source.reconnectMode,
      directoryHandle: isDirectoryHandle(source.directoryHandle) ? source.directoryHandle : null,
      conversationCount: source.conversations?.length || 0,
      savedAt,
      state: "ready"
    });
    const conversations = (source.conversations || []).map((conversation, order) => ({
      key: `${source.id}\u0000${conversation.id}`,
      sourceId: source.id,
      order,
      conversation: lightweightClone(conversation)
    }));
    return { metadata, conversations };
  }

  function openDatabase(indexedDB, name = DB_NAME, version = DB_VERSION) {
    if (!indexedDB?.open) return Promise.reject(new Error("IndexedDB is unavailable."));
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(name, version);
      request.onupgradeneeded = event => {
        const db = request.result;
        if (event.oldVersion < 1) {
          if (!db.objectStoreNames.contains(SOURCE_STORE)) db.createObjectStore(SOURCE_STORE, { keyPath: "id" });
          if (!db.objectStoreNames.contains(CONVERSATION_STORE)) {
            const conversations = db.createObjectStore(CONVERSATION_STORE, { keyPath: "key" });
            conversations.createIndex("sourceId", "sourceId", { unique: false });
          }
          if (!db.objectStoreNames.contains(SETTINGS_STORE)) db.createObjectStore(SETTINGS_STORE, { keyPath: "id" });
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => db.close();
        resolve(db);
      };
      request.onerror = () => reject(request.error || new Error("Could not open the local library."));
      request.onblocked = () => reject(new Error("The local library upgrade is blocked by another Reader tab."));
    });
  }

  function createIndexedDBDriver(indexedDB, { name = DB_NAME, version = DB_VERSION } = {}) {
    let databasePromise = null;
    const database = () => databasePromise ||= openDatabase(indexedDB, name, version);

    async function deleteConversations(sourceId) {
      const db = await database();
      const transaction = db.transaction(CONVERSATION_STORE, "readwrite");
      const cursorRequest = transaction.objectStore(CONVERSATION_STORE).index("sourceId").openCursor(sourceId);
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor) return;
        cursor.delete();
        cursor.continue();
      };
      await transactionDone(transaction);
    }

    return {
      async open() { await database(); return { name, version }; },
      async replaceSource(metadata, conversations, batchSize = BATCH_SIZE) {
        const db = await database();
        const started = db.transaction(SOURCE_STORE, "readwrite");
        started.objectStore(SOURCE_STORE).put({ ...metadata, state: "writing" });
        await transactionDone(started);
        await deleteConversations(metadata.id);
        for (let index = 0; index < conversations.length; index += batchSize) {
          const transaction = db.transaction(CONVERSATION_STORE, "readwrite");
          const store = transaction.objectStore(CONVERSATION_STORE);
          for (const record of conversations.slice(index, index + batchSize)) store.put(record);
          await transactionDone(transaction);
          await new Promise(resolve => setTimeout(resolve, 0));
        }
        const finished = db.transaction(SOURCE_STORE, "readwrite");
        finished.objectStore(SOURCE_STORE).put({ ...metadata, state: "ready" });
        await transactionDone(finished);
      },
      async listSources() {
        const db = await database();
        const transaction = db.transaction(SOURCE_STORE, "readonly");
        const done = transactionDone(transaction);
        const result = await requestResult(transaction.objectStore(SOURCE_STORE).getAll());
        await done;
        return result;
      },
      async listConversations(sourceId) {
        const db = await database();
        const transaction = db.transaction(CONVERSATION_STORE, "readonly");
        const done = transactionDone(transaction);
        const result = await requestResult(transaction.objectStore(CONVERSATION_STORE).index("sourceId").getAll(sourceId));
        await done;
        return result;
      },
      async removeSource(sourceId) {
        const db = await database();
        await deleteConversations(sourceId);
        const transaction = db.transaction(SOURCE_STORE, "readwrite");
        transaction.objectStore(SOURCE_STORE).delete(sourceId);
        await transactionDone(transaction);
      },
      async clearSources() {
        const db = await database();
        const transaction = db.transaction([SOURCE_STORE, CONVERSATION_STORE], "readwrite");
        transaction.objectStore(SOURCE_STORE).clear();
        transaction.objectStore(CONVERSATION_STORE).clear();
        await transactionDone(transaction);
      },
      async getSettings() {
        const db = await database();
        const transaction = db.transaction(SETTINGS_STORE, "readonly");
        const done = transactionDone(transaction);
        const result = await requestResult(transaction.objectStore(SETTINGS_STORE).get(READER_SETTINGS_KEY));
        await done;
        return result?.value || null;
      },
      async setSettings(value) {
        const db = await database();
        const transaction = db.transaction(SETTINGS_STORE, "readwrite");
        transaction.objectStore(SETTINGS_STORE).put({ id: READER_SETTINGS_KEY, value: lightweightClone(value) });
        await transactionDone(transaction);
      },
      async audit() {
        const db = await database();
        const transaction = db.transaction([SOURCE_STORE, CONVERSATION_STORE, SETTINGS_STORE], "readonly");
        const stores = [SOURCE_STORE, CONVERSATION_STORE, SETTINGS_STORE];
        const results = await Promise.all(stores.map(store => requestResult(transaction.objectStore(store).getAll())));
        await transactionDone(transaction);
        return { name, version, ...auditRecords({ sources: results[0], conversations: results[1], settings: results[2] }) };
      },
      async reset() {
        const db = await database().catch(() => null);
        db?.close();
        databasePromise = null;
        await new Promise((resolve, reject) => {
          const request = indexedDB.deleteDatabase(name);
          request.onsuccess = () => resolve();
          request.onerror = () => reject(request.error || new Error("Could not reset the local library."));
          request.onblocked = () => reject(new Error("Close other Reader tabs before resetting the local library."));
        });
        await database();
      }
    };
  }

  function createMemoryDriver({ version = 0, sources = [], conversations = [], settings = null } = {}) {
    const sourceMap = new Map(sources.map(record => [record.id, lightweightClone(record)]));
    const conversationMap = new Map(conversations.map(record => [record.key, lightweightClone(record)]));
    let storedSettings = lightweightClone(settings);
    let currentVersion = version;
    return {
      async open() { currentVersion = DB_VERSION; return { name: DB_NAME, version: currentVersion }; },
      async replaceSource(metadata, records) {
        sourceMap.set(metadata.id, lightweightClone({ ...metadata, state: "ready" }));
        for (const [key, record] of conversationMap) if (record.sourceId === metadata.id) conversationMap.delete(key);
        for (const record of records) conversationMap.set(record.key, lightweightClone(record));
      },
      async listSources() { return [...sourceMap.values()].map(value => lightweightClone(value)); },
      async listConversations(sourceId) {
        return [...conversationMap.values()].filter(record => record.sourceId === sourceId).map(value => lightweightClone(value));
      },
      async removeSource(sourceId) {
        sourceMap.delete(sourceId);
        for (const [key, record] of conversationMap) if (record.sourceId === sourceId) conversationMap.delete(key);
      },
      async clearSources() { sourceMap.clear(); conversationMap.clear(); },
      async getSettings() { return lightweightClone(storedSettings); },
      async setSettings(value) { storedSettings = lightweightClone(value); },
      async audit() {
        return {
          name: DB_NAME,
          version: currentVersion,
          ...auditRecords({
            sources: [...sourceMap.values()],
            conversations: [...conversationMap.values()],
            settings: storedSettings == null ? [] : [{ id: READER_SETTINGS_KEY, value: storedSettings }]
          })
        };
      },
      async reset() { sourceMap.clear(); conversationMap.clear(); storedSettings = null; currentVersion = DB_VERSION; },
      inspect() { return { version: currentVersion, sources: [...sourceMap.values()], conversations: [...conversationMap.values()], settings: storedSettings }; }
    };
  }

  function create({ driver } = {}) {
    const selectedDriver = driver || (typeof indexedDB !== "undefined" ? createIndexedDBDriver(indexedDB) : null);
    const supported = !!selectedDriver;
    return {
      supported,
      async open() {
        if (!selectedDriver) return null;
        return selectedDriver.open();
      },
      async saveSource(source) {
        if (!selectedDriver) return null;
        await selectedDriver.open();
        const records = sourceRecords(source);
        try {
          await selectedDriver.replaceSource(records.metadata, records.conversations, BATCH_SIZE);
          source.directoryHandlePersisted = !!records.metadata.directoryHandle;
        } catch (error) {
          if (!records.metadata.directoryHandle) throw error;
          // Some browsers expose File System Access but cannot structured-clone
          // a handle into IndexedDB. Text persistence must still succeed.
          delete records.metadata.directoryHandle;
          await selectedDriver.replaceSource(records.metadata, records.conversations, BATCH_SIZE);
          source.directoryHandlePersisted = false;
        }
        return records.metadata.savedAt;
      },
      async restore() {
        if (!selectedDriver) return { sources: [], savedAt: null };
        await selectedDriver.open();
        const metadata = (await selectedDriver.listSources())
          .filter(source => source?.state === "ready")
          .sort((a, b) => String(a.savedAt || "").localeCompare(String(b.savedAt || "")));
        const sources = [];
        for (const source of metadata) {
          const records = (await selectedDriver.listConversations(source.id)).sort((a, b) => a.order - b.order);
          if (records.length !== Number(source.conversationCount || 0)) continue;
          sources.push({ ...source, conversations: records.map(record => record.conversation) });
        }
        return {
          sources,
          savedAt: sources.map(source => source.savedAt).filter(Boolean).sort().at(-1) || null
        };
      },
      async removeSource(sourceId) { if (selectedDriver) await selectedDriver.removeSource(String(sourceId)); },
      async clearSources() { if (selectedDriver) await selectedDriver.clearSources(); },
      async loadSettings() { return selectedDriver ? selectedDriver.getSettings() : null; },
      async saveSettings(value) { if (selectedDriver) await selectedDriver.setSettings(value); },
      async audit() { return selectedDriver?.audit ? selectedDriver.audit() : null; },
      async reset() { if (selectedDriver) await selectedDriver.reset(); }
    };
  }

  OD.persistentLibrary = {
    create,
    constants: { DB_NAME, DB_VERSION, SOURCE_STORE, CONVERSATION_STORE, SETTINGS_STORE, BATCH_SIZE },
    _internals: { lightweightClone, sourceRecords, isBinary, isDirectoryHandle, auditRecords, createIndexedDBDriver, createMemoryDriver }
  };
})(window.OD);
