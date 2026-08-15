window.OD = window.OD || {};

/*
  Local-first reader for a browser-selected ChatGPT official export folder.

  Only the manifest, conversation shards, and the two asset metadata JSON files
  are read during parsing. Binary File objects stay untouched until a renderer
  explicitly asks the object URL pool for a URL.
*/
(function(OD){
  const MANIFEST_NAME = "export_manifest.json";
  const ASSET_NAMES_NAME = "conversation_asset_file_names.json";
  const LIBRARY_FILES_NAME = "library_files.json";
  const CONVERSATION_FILE = /(^|\/)conversations(?:-(\d+))?\.json$/i;
  const SHARD_FILE = /(^|\/)conversations-(\d+)\.json$/i;

  const MIME_BY_EXTENSION = {
    apng: "image/apng", avif: "image/avif", bmp: "image/bmp", gif: "image/gif",
    jpeg: "image/jpeg", jpg: "image/jpeg", png: "image/png", svg: "image/svg+xml",
    tif: "image/tiff", tiff: "image/tiff", webp: "image/webp", heic: "image/heic",
    aac: "audio/aac", flac: "audio/flac", m4a: "audio/mp4", mp3: "audio/mpeg",
    oga: "audio/ogg", ogg: "audio/ogg", wav: "audio/wav", weba: "audio/webm",
    avi: "video/x-msvideo", m4v: "video/mp4", mkv: "video/x-matroska",
    mov: "video/quicktime", mp4: "video/mp4", mpeg: "video/mpeg", mpg: "video/mpeg",
    ogv: "video/ogg", webm: "video/webm", csv: "text/csv", htm: "text/html",
    html: "text/html", md: "text/markdown", txt: "text/plain", json: "application/json",
    pdf: "application/pdf", doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ppt: "application/vnd.ms-powerpoint",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    glb: "model/gltf-binary", gltf: "model/gltf+json", fbx: "application/octet-stream",
    rar: "application/vnd.rar", tar: "application/x-tar", zip: "application/zip"
  };

  function normalizePath(value) {
    return String(value || "")
      .replace(/\\/g, "/")
      .replace(/^\.\//, "")
      .replace(/^\/+|\/+$/g, "")
      .replace(/\/{2,}/g, "/");
  }

  function baseName(value) {
    const path = normalizePath(value);
    return path.slice(path.lastIndexOf("/") + 1);
  }

  function dirName(value) {
    const path = normalizePath(value);
    const slash = path.lastIndexOf("/");
    return slash < 0 ? "" : path.slice(0, slash);
  }

  function filePath(file) {
    return normalizePath(file?.webkitRelativePath || file?.relativePath || file?.name);
  }

  function addToMap(map, key, value) {
    if (!key) return;
    const normalized = String(key).toLowerCase();
    const bucket = map.get(normalized) || [];
    if (!bucket.includes(value)) bucket.push(value);
    map.set(normalized, bucket);
  }

  function buildFileCatalog(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) throw new Error("The selected folder does not contain any files.");

    const entries = files.map((file, index) => {
      if (!file || typeof file.text !== "function") {
        throw new Error(`Folder item ${index + 1} is not a browser File object.`);
      }
      const path = filePath(file);
      if (!path) throw new Error(`Folder item ${index + 1} has no usable file name.`);
      return { file, path, name: baseName(path), index };
    });

    const byPath = new Map();
    const byName = new Map();
    for (const entry of entries) {
      addToMap(byPath, entry.path, entry);
      addToMap(byName, entry.name, entry);
    }

    function only(entriesForKey, description) {
      if (!entriesForKey?.length) return null;
      if (entriesForKey.length > 1) {
        const paths = entriesForKey.map(entry => entry.path).join(", ");
        throw new Error(`The export contains more than one match for ${description}: ${paths}`);
      }
      return entriesForKey[0];
    }

    function find(reference, relativeTo = "") {
      const ref = normalizePath(reference);
      if (!ref) return null;
      const candidates = [];
      if (relativeTo) candidates.push(normalizePath(`${relativeTo}/${ref}`));
      candidates.push(ref);

      for (const candidate of candidates) {
        const exact = only(byPath.get(candidate.toLowerCase()), candidate);
        if (exact) return exact;
      }

      return only(byName.get(baseName(ref).toLowerCase()), baseName(ref));
    }

    return { files, entries, find };
  }

  function jsonText(text) {
    return String(text).replace(/^\uFEFF/, "");
  }

  async function readJSON(entry, label) {
    try {
      return JSON.parse(jsonText(await entry.file.text()));
    } catch (error) {
      const detail = error?.message ? `: ${error.message}` : "";
      throw new Error(`Could not parse ${label || entry.path}${detail}`);
    }
  }

  function manifestFieldName(object) {
    if (!object || typeof object !== "object" || Array.isArray(object)) return "";
    for (const key of [
      "logical_name", "logicalName", "name", "path", "filename", "file_name", "fileName"
    ]) {
      if (typeof object[key] === "string") return object[key];
    }
    return "";
  }

  function collectFileReferences(value, result, seen) {
    if (typeof value === "string") {
      const path = normalizePath(value);
      if (CONVERSATION_FILE.test(path)) result.push(path);
      return;
    }
    if (!value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value) collectFileReferences(item, result, seen);
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      const keyPath = normalizePath(key);
      if (CONVERSATION_FILE.test(keyPath)) result.push(keyPath);
      collectFileReferences(child, result, seen);
    }
  }

  function collectManifestConversationRefs(manifest) {
    const preferred = [];
    const allListed = [];
    const visited = new WeakSet();

    function visit(value) {
      if (!value || typeof value !== "object" || visited.has(value)) return;
      visited.add(value);
      if (Array.isArray(value)) {
        for (const item of value) visit(item);
        return;
      }

      const declaredName = normalizePath(manifestFieldName(value));
      if (baseName(declaredName).toLowerCase() === "conversations.json") {
        if (declaredName) preferred.push(declaredName);
        for (const key of [
          "shards", "parts", "files", "chunks", "file_names", "fileNames", "filenames", "paths"
        ]) {
          if (key in value) collectFileReferences(value[key], preferred, new WeakSet());
        }
      }

      for (const [key, child] of Object.entries(value)) {
        if (baseName(key).toLowerCase() === "conversations.json") {
          preferred.push(normalizePath(key));
          collectFileReferences(child, preferred, new WeakSet());
        }
        visit(child);
      }
    }

    visit(manifest);
    collectFileReferences(manifest, allListed, new WeakSet());

    const source = preferred.some(path => SHARD_FILE.test(path)) ? preferred : allListed;
    const shardRefs = source.filter(path => SHARD_FILE.test(path));
    const directRefs = source.filter(path => baseName(path).toLowerCase() === "conversations.json");
    const chosen = shardRefs.length ? shardRefs : directRefs;
    const unique = [];
    const seen = new Set();
    for (const path of chosen) {
      const key = normalizePath(path).toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      unique.push(normalizePath(path));
    }
    unique.sort((a, b) => {
      const aNumber = Number((a.match(SHARD_FILE) || [])[2] || -1);
      const bNumber = Number((b.match(SHARD_FILE) || [])[2] || -1);
      return aNumber - bNumber || a.localeCompare(b);
    });
    return unique;
  }

  function extractAssetNameMappings(data) {
    const result = [];
    const seenPairs = new Set();
    const visited = new WeakSet();

    function looksLikeExportedAssetName(value) {
      const name = baseName(value);
      if (/\.dat$/i.test(name)) return true;
      return /^file[-_]/i.test(name) &&
        !/^file[-_](?:id|name|path|size|type)$/i.test(name);
    }

    function add(exportedName, originalName) {
      const exported = normalizePath(exportedName);
      const original = String(originalName || "").trim();
      if (!exported || !original) return;
      const pair = `${exported.toLowerCase()}\u0000${original}`;
      if (seenPairs.has(pair)) return;
      seenPairs.add(pair);
      result.push({ exportedName: exported, originalName: original });
    }

    function visit(value) {
      if (!value || typeof value !== "object" || visited.has(value)) return;
      visited.add(value);
      if (Array.isArray(value)) {
        if (value.length >= 2 && typeof value[0] === "string" && typeof value[1] === "string") {
          if (looksLikeExportedAssetName(value[0])) add(value[0], value[1]);
          else if (looksLikeExportedAssetName(value[1])) add(value[1], value[0]);
        }
        for (const item of value) visit(item);
        return;
      }

      const exported = value.exported_file_name || value.exported_filename ||
        value.exportedName || value.asset_file_name || value.stored_file_name ||
        value.storage_name || value.dat_file_name;
      const original = value.original_file_name || value.original_filename ||
        value.originalName || value.file_name || value.filename || value.name;
      if (typeof exported === "string" && typeof original === "string") add(exported, original);

      for (const [key, child] of Object.entries(value)) {
        if (typeof child === "string") {
          if (looksLikeExportedAssetName(key)) add(key, child);
          else if (/\.dat$/i.test(baseName(child))) add(child, key);
        } else {
          if (/\.dat$/i.test(baseName(key)) && child && typeof child === "object") {
            const nestedOriginal = firstValue(child, [
              "original_file_name", "original_filename", "originalName",
              "file_name", "fileName", "filename", "name"
            ]);
            if (typeof nestedOriginal === "string") add(key, nestedOriginal);
          }
          visit(child);
        }
      }
    }

    visit(data);
    return result;
  }

  function firstValue(object, keys) {
    for (const key of keys) {
      const value = object?.[key];
      if (value !== undefined && value !== null && value !== "") return value;
    }
    return null;
  }

  function normalizeLibraryRecord(value, fallbackId) {
    const genericId = firstValue(value, ["id"]);
    const nestedId = genericId && typeof genericId === "object" && !Array.isArray(genericId)
      ? firstValue(genericId, ["id"])
      : null;
    const fileId = firstValue(value, ["file_id", "fileId", "asset_id", "assetId"]) ||
      (/^file[-_]/i.test(String(genericId || "")) ? genericId : null);
    const libraryFileId = firstValue(value, ["library_file_id", "libraryFileId", "libfile_id", "libfileId"]) ||
      (/^libfile[-_]/i.test(String(nestedId || "")) ? nestedId : null) ||
      (/^libfile[-_]/i.test(String(genericId || "")) ? genericId : null);
    const fileName = firstValue(value, [
      "file_name", "fileName", "original_file_name", "originalFileName", "filename", "name"
    ]);
    const exportedName = firstValue(value, [
      "exported_file_name", "exportedFileName", "stored_file_name", "storedFileName", "path"
    ]);
    const mimeType = firstValue(value, ["mime_type", "mimeType", "mime", "content_type", "contentType"]);
    const messageId = firstValue(value, [
      "origination_message_id", "originationMessageId", "message_id", "messageId"
    ]);
    const threadId = firstValue(value, [
      "origination_thread_id", "originationThreadId", "conversation_id", "conversationId", "thread_id", "threadId"
    ]);
    const size = firstValue(value, ["size", "size_bytes", "sizeBytes", "file_size", "fileSize"]);
    const fallback = String(fallbackId || "");
    const inferredFileId = fileId || (/^file[-_]/i.test(fallback) ? fallback : null);
    const inferredLibraryId = libraryFileId || (/^libfile[-_]/i.test(fallback) ? fallback : null);

    const hasIdentity = !!(inferredFileId || inferredLibraryId);
    const hasFileMetadata = !!(fileName && (exportedName || mimeType || messageId || threadId));
    if (!hasIdentity && !hasFileMetadata) {
      return null;
    }
    return {
      fileId: inferredFileId == null ? null : String(inferredFileId),
      libraryFileId: inferredLibraryId == null ? null : String(inferredLibraryId),
      fileName: fileName == null ? null : String(fileName),
      exportedName: exportedName == null ? null : normalizePath(exportedName),
      mimeType: mimeType == null ? null : String(mimeType),
      size: Number.isFinite(Number(size)) ? Number(size) : null,
      originationMessageId: messageId == null ? null : String(messageId),
      originationThreadId: threadId == null ? null : String(threadId),
      original: value
    };
  }

  function extractLibraryRecords(data) {
    const result = [];
    const visited = new WeakSet();

    function visit(value, fallbackId = "") {
      if (!value || typeof value !== "object" || visited.has(value)) return;
      visited.add(value);
      if (Array.isArray(value)) {
        for (const item of value) visit(item);
        return;
      }

      const record = normalizeLibraryRecord(value, fallbackId);
      if (record) {
        result.push(record);
        return;
      }
      for (const [key, child] of Object.entries(value)) visit(child, key);
    }

    visit(data);
    return result;
  }

  function extensionMime(name) {
    const match = String(name || "").toLowerCase().match(/\.([a-z0-9]+)$/);
    return match ? (MIME_BY_EXTENSION[match[1]] || null) : null;
  }

  function assetKind(mimeType) {
    const mime = String(mimeType || "").toLowerCase();
    if (mime.startsWith("image/")) return "image";
    if (mime.startsWith("audio/")) return "audio";
    if (mime.startsWith("video/")) return "video";
    return "file";
  }

  function referenceCandidates(reference) {
    if (reference == null) return [];
    if (typeof reference !== "object") return [String(reference)];
    const values = [];
    const visited = new WeakSet();

    function add(value) {
      if (typeof value === "string" && value) values.push(value);
    }
    function visit(value, depth) {
      if (!value || typeof value !== "object" || visited.has(value) || depth > 3) return;
      visited.add(value);
      for (const key of [
        "fileId", "file_id", "id", "libraryFileId", "library_file_id", "libfile_id",
        "asset_pointer", "assetPointer", "src", "exportedName", "exported_name", "path",
        "originalName", "original_name", "fileName", "file_name", "name"
      ]) add(value[key]);
      visit(value.metadata, depth + 1);
      visit(value.original, depth + 1);
    }
    visit(reference, 0);
    return values;
  }

  function aliasVariants(value) {
    let raw = String(value || "").trim();
    if (!raw) return [];
    try { raw = decodeURIComponent(raw); } catch (_) {}
    raw = raw.replace(/[?#].*$/, "").replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
    const path = normalizePath(raw);
    const name = baseName(path);
    const values = [raw, path, name];
    if (/\.dat$/i.test(name)) values.push(name.replace(/\.dat$/i, ""));
    else values.push(`${name}.dat`);
    return [...new Set(values.filter(Boolean).map(item => item.toLowerCase()))];
  }

  function buildAssetIndex(catalog, rootDir, excludedPaths, nameMappings, libraryRecords) {
    const records = [];
    const byFile = new Map();
    const byAlias = new Map();
    const lowerExcluded = new Set([...excludedPaths].map(path => normalizePath(path).toLowerCase()));

    function makeRecord(entry) {
      if (entry && byFile.has(entry.file)) return byFile.get(entry.file);
      const record = {
        id: null,
        file: entry?.file || null,
        available: !!entry?.file,
        path: entry?.path || null,
        exportedName: entry?.name || null,
        originalName: null,
        fileId: null,
        libraryFileId: null,
        mimeType: entry?.file?.type || null,
        type: "file",
        size: Number.isFinite(entry?.file?.size) ? entry.file.size : null,
        originationMessageId: null,
        originationThreadId: null,
        metadata: { nameMappings: [], libraryRecords: [] }
      };
      records.push(record);
      if (entry) byFile.set(entry.file, record);
      return record;
    }

    function findEntry(reference) {
      if (!reference) return null;
      const entry = catalog.find(reference, rootDir);
      if (!entry || lowerExcluded.has(entry.path.toLowerCase())) return null;
      return entry;
    }

    for (const mapping of nameMappings) {
      const entry = findEntry(mapping.exportedName);
      const record = makeRecord(entry);
      if (!record.exportedName) record.exportedName = baseName(mapping.exportedName);
      if (!record.path) record.path = normalizePath(mapping.exportedName);
      if (!record.originalName) record.originalName = mapping.originalName;
      record.metadata.nameMappings.push(mapping);
    }

    function recordAliases(record) {
      return [
        record.path, record.exportedName, record.originalName, record.fileId, record.libraryFileId
      ].flatMap(aliasVariants);
    }

    function findExistingForLibrary(library) {
      const candidates = [
        library.exportedName,
        library.fileId ? `${library.fileId}.dat` : null,
        library.fileId,
        library.libraryFileId,
        library.fileName
      ];
      for (const candidate of candidates) {
        const targets = aliasVariants(candidate);
        if (!targets.length) continue;
        const matches = records.filter(record => {
          const aliases = new Set(recordAliases(record));
          return targets.some(target => aliases.has(target));
        });
        if (matches.length === 1) return matches[0];
      }
      return null;
    }

    for (const library of libraryRecords) {
      let record = findExistingForLibrary(library);
      if (!record) {
        const entry = findEntry(library.exportedName) ||
          findEntry(library.fileId ? `${library.fileId}.dat` : null) ||
          findEntry(library.fileId) || findEntry(library.fileName);
        record = makeRecord(entry);
      }
      record.fileId ||= library.fileId;
      record.libraryFileId ||= library.libraryFileId;
      record.originalName ||= library.fileName;
      record.exportedName ||= library.exportedName ? baseName(library.exportedName) : null;
      record.path ||= library.exportedName;
      // Official library metadata is authoritative; a .dat File commonly has
      // either an empty type or the unhelpful application/octet-stream type.
      record.mimeType = library.mimeType || record.mimeType;
      record.size ??= library.size;
      record.originationMessageId ||= library.originationMessageId;
      record.originationThreadId ||= library.originationThreadId;
      record.metadata.libraryRecords.push(library);
    }

    for (const entry of catalog.entries) {
      if (lowerExcluded.has(entry.path.toLowerCase())) continue;
      if (/\.dat$/i.test(entry.name) && !byFile.has(entry.file)) makeRecord(entry);
    }

    for (const record of records) {
      const exportedStem = String(record.exportedName || "").replace(/\.dat$/i, "");
      record.fileId ||= /^file[-_]/i.test(exportedStem) ? exportedStem : null;
      record.originalName ||= record.exportedName && !/\.dat$/i.test(record.exportedName)
        ? record.exportedName : null;
      record.mimeType ||= extensionMime(record.originalName) || extensionMime(record.exportedName) ||
        "application/octet-stream";
      record.type = assetKind(record.mimeType);
      record.id = record.fileId || record.libraryFileId || record.path || `asset-${records.indexOf(record)}`;

      const aliases = new Set(recordAliases(record));
      for (const alias of aliases) addToMap(byAlias, alias, record);
    }

    function resolveAll(reference) {
      const accumulated = [];
      for (const candidate of referenceCandidates(reference)) {
        const matches = [];
        for (const alias of aliasVariants(candidate)) {
          for (const record of byAlias.get(alias) || []) {
            if (!matches.includes(record)) matches.push(record);
          }
        }
        if (matches.length === 1) return matches;
        for (const record of matches) {
          if (!accumulated.includes(record)) accumulated.push(record);
        }
      }
      return accumulated;
    }

    function resolve(reference) {
      const matches = resolveAll(reference);
      if (matches.length <= 1) return matches[0] || null;
      const available = matches.filter(record => record.available);
      return available.length === 1 ? available[0] : null;
    }

    return {
      records,
      resolve,
      resolveAll,
      getFile(reference) { return resolve(reference)?.file || null; }
    };
  }

  function createObjectURLPool(assetIndex, urlAPI) {
    const urls = new Map();
    const api = urlAPI || (typeof URL !== "undefined" ? URL : null);

    function get(reference) {
      const record = assetIndex.resolve(reference);
      if (!record?.file) return null;
      const cached = urls.get(record.file);
      if (cached) return cached.url;
      if (!api || typeof api.createObjectURL !== "function") {
        throw new Error("This browser cannot create local object URLs for attachments.");
      }
      const source = record.mimeType && record.file.type !== record.mimeType &&
        typeof record.file.slice === "function"
        ? record.file.slice(0, record.file.size, record.mimeType)
        : record.file;
      const url = api.createObjectURL(source);
      urls.set(record.file, { url, source });
      return url;
    }

    function revoke(reference) {
      const record = assetIndex.resolve(reference);
      const cached = record?.file ? urls.get(record.file) : null;
      if (!cached) return false;
      if (api && typeof api.revokeObjectURL === "function") api.revokeObjectURL(cached.url);
      urls.delete(record.file);
      return true;
    }

    function revokeAll() {
      if (api && typeof api.revokeObjectURL === "function") {
        for (const cached of urls.values()) api.revokeObjectURL(cached.url);
      }
      const count = urls.size;
      urls.clear();
      return count;
    }

    return { get, revoke, revokeAll, get size() { return urls.size; } };
  }

  async function parse(fileList, options = {}) {
    const catalog = buildFileCatalog(fileList);
    const manifestCandidates = catalog.entries.filter(entry => entry.name.toLowerCase() === MANIFEST_NAME);
    if (!manifestCandidates.length) {
      throw new Error(`This folder does not contain ${MANIFEST_NAME}. Select the extracted ChatGPT export folder itself.`);
    }
    if (manifestCandidates.length > 1) {
      throw new Error(`The selected folder contains more than one ${MANIFEST_NAME}. Select one export folder at a time.`);
    }

    const manifestEntry = manifestCandidates[0];
    const rootDir = dirName(manifestEntry.path);
    const manifest = await readJSON(manifestEntry, MANIFEST_NAME);
    const shardRefs = collectManifestConversationRefs(manifest);
    if (!shardRefs.length) {
      throw new Error(`${MANIFEST_NAME} does not list conversations.json or any conversation shards.`);
    }

    const shardEntries = shardRefs.map(reference => {
      const entry = catalog.find(reference, rootDir);
      if (!entry) throw new Error(`${MANIFEST_NAME} lists ${reference}, but that file was not selected.`);
      return entry;
    });
    const uniqueShardEntries = [];
    const seenShardPaths = new Set();
    for (const entry of shardEntries) {
      const key = entry.path.toLowerCase();
      if (seenShardPaths.has(key)) continue;
      seenShardPaths.add(key);
      uniqueShardEntries.push(entry);
    }

    const conversations = [];
    for (const entry of uniqueShardEntries) {
      const chunk = await readJSON(entry, entry.path);
      const items = Array.isArray(chunk) ? chunk : chunk?.conversations;
      if (!Array.isArray(items)) {
        throw new Error(`${entry.path} is listed as conversation data, but it does not contain a conversation array.`);
      }
      conversations.push(...items);
    }

    const warnings = [];
    async function optionalMetadata(name) {
      const entry = catalog.find(name, rootDir);
      if (!entry) {
        warnings.push(`${name} was not present in the selected folder.`);
        return { entry: null, data: null };
      }
      return { entry, data: await readJSON(entry, entry.path) };
    }

    const assetNames = await optionalMetadata(ASSET_NAMES_NAME);
    const libraryFiles = await optionalMetadata(LIBRARY_FILES_NAME);
    const nameMappings = extractAssetNameMappings(assetNames.data);
    const libraryRecords = extractLibraryRecords(libraryFiles.data);
    const excludedPaths = new Set([
      manifestEntry.path,
      ...uniqueShardEntries.map(entry => entry.path),
      ...(assetNames.entry ? [assetNames.entry.path] : []),
      ...(libraryFiles.entry ? [libraryFiles.entry.path] : [])
    ]);
    const assetIndex = buildAssetIndex(
      catalog, rootDir, excludedPaths, nameMappings, libraryRecords
    );
    const objectURLs = createObjectURLPool(assetIndex, options.urlAPI);

    // Convenience aliases keep renderers simple while retaining explicit lifetime control.
    assetIndex.createObjectURL = objectURLs.get;
    assetIndex.revokeObjectURL = objectURLs.revoke;
    assetIndex.revokeAllObjectURLs = objectURLs.revokeAll;

    return {
      manifest,
      manifestPath: manifestEntry.path,
      conversations,
      shardPaths: uniqueShardEntries.map(entry => entry.path),
      assetIndex,
      objectURLs,
      warnings,
      stats: {
        selectedFileCount: catalog.files.length,
        shardCount: uniqueShardEntries.length,
        conversationCount: conversations.length,
        assetCount: assetIndex.records.length,
        availableAssetCount: assetIndex.records.filter(record => record.available).length
      },
      dispose: objectURLs.revokeAll
    };
  }

  async function detect(fileList) {
    try {
      const catalog = buildFileCatalog(fileList);
      const manifestCandidates = catalog.entries.filter(
        entry => entry.name.toLowerCase() === MANIFEST_NAME
      );
      if (manifestCandidates.length !== 1) return false;

      const manifestEntry = manifestCandidates[0];
      const rootDir = dirName(manifestEntry.path);
      const manifest = await readJSON(manifestEntry, MANIFEST_NAME);
      const shardRefs = collectManifestConversationRefs(manifest);
      return shardRefs.length > 0 && shardRefs.every(reference => !!catalog.find(reference, rootDir));
    } catch (_) {
      return false;
    }
  }

  OD.chatgptExportFolder = {
    detect,
    parse,
    createObjectURLPool,
    _internals: {
      normalizePath,
      collectManifestConversationRefs,
      extractAssetNameMappings,
      extractLibraryRecords,
      buildFileCatalog,
      buildAssetIndex
    }
  };
})(window.OD);
