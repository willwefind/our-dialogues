window.OD = window.OD || {};

(function(OD){
  const CONTRACT = "our-dialogues.adapter-capabilities.v1";
  const DIAGNOSTICS = "our-dialogues.source-diagnostics.v1";
  const ROOT_KEY_LIMIT = 50;
  const PATTERN_LIMIT = 30;

  function rootType(value) {
    if (value === null) return "null";
    if (Array.isArray(value)) return "array";
    return typeof value === "object" ? "object" : typeof value;
  }

  function sortedKeys(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    return Object.keys(value).sort().slice(0, ROOT_KEY_LIMIT);
  }

  function pathSegment(key) {
    const structural = /^(?:archive|archives|data|export|history|items|payload|records|result|root|tables|world|conversations?|sessions?|threads?|chats?|messages?|dialogs?|turns?)$/i;
    return structural.test(key) ? `.${key}` : ".*";
  }

  function candidateKeyPatterns(root) {
    const patterns = [];
    const seen = new Set();
    const queue = [{ value: root, path: "$", depth: 0 }];
    const candidateKeys = new Set([
      "conversation", "conversations", "session", "sessions", "thread", "threads",
      "chat", "chats", "chat_messages", "message", "messages", "dialog", "dialogs",
      "turn", "turns", "history", "author", "author_name", "sender", "sender_name",
      "role", "content", "text", "title", "created_at", "created_time", "create_time",
      "updated_at", "updated_time", "timestamp", "time", "date"
    ]);

    function isCandidateKey(key) {
      const normalized = String(key)
        .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
        .replace(/[^a-z0-9]+/gi, "_")
        .replace(/^_+|_+$/g, "")
        .toLowerCase();
      return candidateKeys.has(normalized);
    }

    while (queue.length && patterns.length < PATTERN_LIMIT) {
      const { value, path, depth } = queue.shift();
      if (Array.isArray(value)) {
        const firstObject = value.find(item => item && typeof item === "object");
        if (firstObject) queue.push({ value: firstObject, path: `${path}[]`, depth });
        continue;
      }
      if (!value || typeof value !== "object" || seen.has(value)) continue;
      seen.add(value);

      const keys = sortedKeys(value);
      const matching = keys.filter(isCandidateKey);
      if (matching.length) patterns.push({ path, keys: matching });
      if (depth >= 2) continue;

      for (const key of keys) {
        const child = value[key];
        if (!child || typeof child !== "object") continue;
        queue.push({ value: child, path: `${path}${pathSegment(key)}`, depth: depth + 1 });
      }
    }
    return patterns;
  }

  function jsonDiagnostics(data, extra = {}) {
    const type = rootType(data);
    return {
      schema: DIAGNOSTICS,
      kind: "json",
      recognized: false,
      reason: extra.reason || "unknown-format",
      rootType: type,
      topLevelKeys: type === "object" ? sortedKeys(data) : [],
      arrayLength: type === "array" ? data.length : null,
      candidateKeyPatterns: candidateKeyPatterns(data),
      matchedAdapterIds: Array.isArray(extra.matchedAdapterIds) ? extra.matchedAdapterIds : []
    };
  }

  function zipDiagnostics(zip, extra = {}) {
    const names = Array.isArray(zip?.names) ? zip.names : [];
    return {
      schema: DIAGNOSTICS,
      kind: "zip",
      recognized: false,
      reason: extra.reason || "unknown-format",
      entryCount: names.length,
      jsonFilenames: names.filter(name => /\.json$/i.test(name)).slice(0, 50),
      matchedAdapterIds: Array.isArray(extra.matchedAdapterIds) ? extra.matchedAdapterIds : [],
      candidateJSON: Array.isArray(extra.candidateJSON) ? extra.candidateJSON : []
    };
  }

  function validateAdapter(adapter) {
    if (!adapter || typeof adapter !== "object") throw new Error("Adapter must be an object.");
    if (!adapter.id || !adapter.label) throw new Error("Adapter must declare id and label.");
    const capabilities = adapter.capabilities;
    if (!capabilities || capabilities.contract !== CONTRACT) {
      throw new Error(`Adapter ${adapter.id} is missing ${CONTRACT} capabilities.`);
    }
    for (const kind of ["json", "zip"]) {
      if (typeof capabilities[kind] !== "boolean") {
        throw new Error(`Adapter ${adapter.id} must declare capabilities.${kind}.`);
      }
      const detect = adapter[`detect${kind.toUpperCase()}`];
      const parse = adapter[`parse${kind.toUpperCase()}`];
      if (capabilities[kind] && (typeof detect !== "function" || typeof parse !== "function")) {
        throw new Error(`Adapter ${adapter.id} declares ${kind} support without detect/parse methods.`);
      }
    }
    if (typeof capabilities.folder !== "boolean") {
      throw new Error(`Adapter ${adapter.id} must declare capabilities.folder.`);
    }
    for (const key of ["thinking", "attachments", "sourceMarkup"]) {
      if (typeof capabilities[key] !== "string" || !capabilities[key]) {
        throw new Error(`Adapter ${adapter.id} must declare capabilities.${key}.`);
      }
    }
    return adapter;
  }

  function formatDiagnostics(diagnostics) {
    if (!diagnostics) return "Unknown source format.";
    const reason = diagnostics.reason === "ambiguous-format"
      ? `Multiple adapters matched: ${(diagnostics.matchedAdapterIds || []).join(", ")}`
      : "No strict adapter match.";
    if (diagnostics.kind === "zip") {
      const names = diagnostics.jsonFilenames?.length
        ? diagnostics.jsonFilenames.join(", ")
        : "none";
      const shapes = (diagnostics.candidateJSON || []).map(candidate => {
        if (candidate.invalidJSON) return `${candidate.filename}: invalid JSON`;
        const keys = candidate.topLevelKeys?.length ? candidate.topLevelKeys.join(", ") : "none";
        const length = candidate.arrayLength == null ? "" : `, array length ${candidate.arrayLength}`;
        const patterns = (candidate.candidateKeyPatterns || [])
          .map(item => `${item.path} [${item.keys.join(", ")}]`)
          .join("; ") || "none";
        return `${candidate.filename}: root ${candidate.rootType}${length}, keys ${keys}, candidate patterns ${patterns}`;
      }).join(" | ") || "none";
      return `ZIP format not recognized. ${reason} Entries: ${diagnostics.entryCount ?? 0}. JSON files: ${names}. JSON shapes: ${shapes}. No field values or conversation text were displayed.`;
    }
    const keys = diagnostics.topLevelKeys?.length ? diagnostics.topLevelKeys.join(", ") : "none";
    const length = diagnostics.arrayLength == null ? "" : ` Array length: ${diagnostics.arrayLength}.`;
    const patterns = (diagnostics.candidateKeyPatterns || [])
      .map(item => `${item.path}: ${item.keys.join(", ")}`)
      .join("; ") || "none";
    return `JSON format not recognized. ${reason} Root: ${diagnostics.rootType}.${length} Top-level keys: ${keys}. Candidate key patterns: ${patterns}. No field values or conversation text were displayed.`;
  }

  OD.adapterContract = {
    CONTRACT,
    DIAGNOSTICS,
    validateAdapter,
    jsonDiagnostics,
    zipDiagnostics,
    formatDiagnostics
  };
})(window.OD);
