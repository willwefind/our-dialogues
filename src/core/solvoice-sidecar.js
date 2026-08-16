window.OD = window.OD || {};

/*
  Optional, local-only SolVoice sidecar support.

  The mapping and audio Files remain separate from the normalized archive.
  Matching is intentionally exact and conservative: Reader v1 only exposes
  strong mappings whose assistant message ID and audio file both exist.
*/
(function(OD){
  const FORMAT = "our-dialogues.solvoice-chatgpt-mapping";
  const VERSION = 2;
  const AUTO_ATTACH_CONFIDENCES = Object.freeze(["strong"]);
  const AUTO_ATTACH_SET = new Set(AUTO_ATTACH_CONFIDENCES);
  const MAPPING_FILE_NAME = "chatgpt-solvoice.json";
  /* One sidecar mechanism, several voice mappings. Each mapping format binds
     to exactly one source platform so clips can never attach across sources. */
  /* defaultVoiceLabel names the capture tool, not a person; a private mapping
     file may override it with `voiceLabel` for a personal display name. */
  const MAPPING_KINDS = Object.freeze({
    [FORMAT]: Object.freeze({ version: VERSION, platform: "chatgpt", fileName: MAPPING_FILE_NAME, defaultVoiceLabel: "SolVoice" }),
    "our-dialogues.cielvoice-claude-mapping": Object.freeze({ version: 1, platform: "claude", fileName: "claude-cielvoice.json", defaultVoiceLabel: "CielVoice" })
  });

  function normalizePath(value) {
    return String(value || "")
      .replace(/\\/g, "/")
      .replace(/^\.\//, "")
      .replace(/\/{2,}/g, "/")
      .replace(/^\/+|\/+$/g, "");
  }

  function parseMapping(value) {
    const document = typeof value === "string"
      ? JSON.parse(value.replace(/^\uFEFF/, ""))
      : value;
    if (!document || typeof document !== "object") {
      throw new Error("SolVoice mapping must be a JSON object.");
    }
    const kind = MAPPING_KINDS[document.format];
    if (!kind || Number(document.version) !== kind.version) {
      throw new Error(`Unsupported voice mapping; expected one of: ${
        Object.entries(MAPPING_KINDS).map(([format, item]) => `${format} v${item.version}`).join(", ")
      }.`);
    }
    if (!Array.isArray(document.mappings)) {
      throw new Error("Voice mapping has no mappings array.");
    }
    return document;
  }

  function mappingPlatform(document) {
    return MAPPING_KINDS[document?.format]?.platform || null;
  }

  function filePath(file) {
    return normalizePath(file?.webkitRelativePath || file?.relativePath || file?.name);
  }

  function findMappingFiles(files) {
    const names = Object.values(MAPPING_KINDS).map(kind => kind.fileName);
    return [...(files || [])].filter(file => {
      const candidate = filePath(file).toLowerCase();
      return names.some(name => candidate === name || candidate.endsWith(`/mappings/${name}`));
    });
  }

  function findMappingFile(files) {
    return findMappingFiles(files)[0] || null;
  }

  function createAudioIndex(files) {
    const bySuffix = new Map();

    function add(key, file) {
      const normalized = normalizePath(key).toLowerCase();
      if (!normalized) return;
      const matches = bySuffix.get(normalized) || new Set();
      matches.add(file);
      bySuffix.set(normalized, matches);
    }

    for (const file of files || []) {
      const relativePath = filePath(file);
      if (!relativePath || !/\.(?:mp3|m4a|aac|wav|ogg|oga|flac|opus)$/i.test(relativePath)) continue;
      const parts = relativePath.split("/").filter(Boolean);
      for (let index = 0; index < parts.length; index += 1) {
        add(parts.slice(index).join("/"), file);
      }
    }

    function resolve(audioPath) {
      const requested = normalizePath(audioPath).toLowerCase();
      if (!requested) return null;
      const direct = bySuffix.get(requested);
      if (direct?.size === 1) return [...direct][0];
      const basename = requested.split("/").pop();
      const byName = bySuffix.get(basename);
      return byName?.size === 1 ? [...byName][0] : null;
    }

    return { resolve, size: [...new Set(files || [])].length };
  }

  function createObjectURLPool(urlAPI = URL) {
    const cache = new Map();

    function get(clip) {
      const file = clip?.file;
      if (!file) return null;
      if (cache.has(file)) return cache.get(file);
      const url = urlAPI.createObjectURL(file);
      cache.set(file, url);
      return url;
    }

    function revokeAll() {
      for (const url of cache.values()) urlAPI.revokeObjectURL(url);
      cache.clear();
    }

    return {
      get,
      revokeAll,
      get size() { return cache.size; }
    };
  }

  function messageIndex(archive, platform) {
    const messages = new Map();
    if (archive?.source?.platform !== platform) return messages;
    for (const conversation of archive?.conversations || []) {
      for (const message of conversation?.messages || []) {
        if (message?.role !== "assistant" || !message?.id || messages.has(String(message.id))) continue;
        messages.set(String(message.id), { conversation, message });
      }
    }
    return messages;
  }

  function clipFrom(mapping, file, conversationId, voiceLabel) {
    return {
      voiceLabel: voiceLabel || null,
      historyItemId: mapping.historyItemId == null ? null : String(mapping.historyItemId),
      audioPath: mapping.audioPath == null ? null : String(mapping.audioPath),
      voiceCreatedAt: mapping.voiceCreatedAt || null,
      conversationId,
      messageId: String(mapping.messageId),
      confidence: mapping.confidence,
      score: Number.isFinite(mapping.score) ? mapping.score : null,
      messageCreatedAt: mapping.messageCreatedAt || null,
      effectiveAnchorAt: mapping.effectiveAnchorAt || null,
      effectiveAnchorSource: mapping.effectiveAnchorSource || null,
      effectiveAnchorMessageId: mapping.effectiveAnchorMessageId || null,
      timeDeltaSec: Number.isFinite(mapping.timeDeltaSec) ? mapping.timeDeltaSec : null,
      timeEvidence: mapping.evidence?.time || null,
      file
    };
  }

  function compareClips(left, right) {
    const leftTime = Date.parse(left.voiceCreatedAt || "");
    const rightTime = Date.parse(right.voiceCreatedAt || "");
    const safeLeft = Number.isFinite(leftTime) ? leftTime : Number.POSITIVE_INFINITY;
    const safeRight = Number.isFinite(rightTime) ? rightTime : Number.POSITIVE_INFINITY;
    return safeLeft - safeRight
      || String(left.historyItemId || "").localeCompare(String(right.historyItemId || ""));
  }

  function buildSession({ archive, mappingDocument, audioFiles = [], urlAPI = URL } = {}) {
    const document = parseMapping(mappingDocument);
    const messages = messageIndex(archive, mappingPlatform(document));
    const voiceLabel = (typeof document.voiceLabel === "string" && document.voiceLabel.trim())
      ? document.voiceLabel.trim()
      : MAPPING_KINDS[document.format].defaultVoiceLabel;
    const audioIndex = createAudioIndex(audioFiles);
    const clipsByMessageId = new Map();
    let strongMappingsTotal = 0;
    let strongMappingsWhoseMessageIdExists = 0;
    let audioFileResolvedCount = 0;
    let attachedPlayerCount = 0;

    for (const mapping of document.mappings) {
      if (!AUTO_ATTACH_SET.has(mapping?.confidence)) continue;
      strongMappingsTotal += 1;

      const target = mapping?.messageId == null ? null : messages.get(String(mapping.messageId));
      if (target) {
        strongMappingsWhoseMessageIdExists += 1;
      }

      const file = audioIndex.resolve(mapping?.audioPath);
      if (file) audioFileResolvedCount += 1;
      if (!target || !file) continue;

      const messageId = String(mapping.messageId);
      const clips = clipsByMessageId.get(messageId) || [];
      clips.push(clipFrom(mapping, file, target.conversation.id, voiceLabel));
      clipsByMessageId.set(messageId, clips);
      attachedPlayerCount += 1;
    }

    for (const clips of clipsByMessageId.values()) clips.sort(compareClips);
    const objectURLs = createObjectURLPool(urlAPI);
    const stats = Object.freeze({
      strongMappingsTotal,
      strongMappingsWhoseMessageIdExists,
      audioFileResolvedCount,
      attachedPlayerCount,
      attachedMessageCount: clipsByMessageId.size,
      missingMessageCount: strongMappingsTotal - strongMappingsWhoseMessageIdExists,
      missingAudioCount: strongMappingsTotal - audioFileResolvedCount
    });

    return {
      mappingFormat: document.format,
      mappingVersion: Number(document.version),
      policy: { autoAttachConfidences: [...AUTO_ATTACH_CONFIDENCES] },
      stats,
      objectURLs,
      clipsForMessage(messageId) {
        return clipsByMessageId.get(String(messageId)) || [];
      },
      entries() {
        return [...clipsByMessageId.entries()];
      },
      dispose() {
        objectURLs.revokeAll();
        clipsByMessageId.clear();
      }
    };
  }

  /* Several per-platform sessions presented as one. The shared URL pool can
     mint object URLs for any clip because clips carry their own File. */
  function combineSessions(sessions, urlAPI = URL) {
    const active = (sessions || []).filter(Boolean);
    if (!active.length) return null;
    if (active.length === 1) return active[0];
    const stats = {};
    for (const session of active) {
      for (const [key, value] of Object.entries(session.stats || {})) {
        if (Number.isFinite(value)) stats[key] = (stats[key] || 0) + value;
      }
    }
    const objectURLs = createObjectURLPool(urlAPI);
    return {
      mappingFormat: "combined",
      mappingVersion: 0,
      policy: { autoAttachConfidences: [...AUTO_ATTACH_CONFIDENCES] },
      stats: Object.freeze(stats),
      objectURLs,
      clipsForMessage(messageId) {
        return active.flatMap(session => session.clipsForMessage(messageId));
      },
      entries() {
        return active.flatMap(session => session.entries());
      },
      dispose() {
        objectURLs.revokeAll();
        for (const session of active) session.dispose();
      }
    };
  }

  OD.solVoiceSidecar = {
    FORMAT,
    VERSION,
    AUTO_ATTACH_CONFIDENCES,
    MAPPING_FILE_NAME,
    MAPPING_KINDS,
    normalizePath,
    parseMapping,
    mappingPlatform,
    findMappingFile,
    findMappingFiles,
    createAudioIndex,
    createObjectURLPool,
    buildSession,
    combineSessions
  };
})(window.OD);
