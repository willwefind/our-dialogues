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
    if (document.format !== FORMAT || Number(document.version) !== VERSION) {
      throw new Error(`Unsupported SolVoice mapping; expected ${FORMAT} v${VERSION}.`);
    }
    if (!Array.isArray(document.mappings)) {
      throw new Error("SolVoice mapping has no mappings array.");
    }
    return document;
  }

  function filePath(file) {
    return normalizePath(file?.webkitRelativePath || file?.relativePath || file?.name);
  }

  function findMappingFile(files) {
    return [...(files || [])].find(file => {
      const candidate = filePath(file).toLowerCase();
      return candidate === MAPPING_FILE_NAME
        || candidate.endsWith(`/mappings/${MAPPING_FILE_NAME}`);
    }) || null;
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

  function messageIndex(archive) {
    const messages = new Map();
    if (archive?.source?.platform !== "chatgpt") return messages;
    for (const conversation of archive?.conversations || []) {
      for (const message of conversation?.messages || []) {
        if (message?.role !== "assistant" || !message?.id || messages.has(String(message.id))) continue;
        messages.set(String(message.id), { conversation, message });
      }
    }
    return messages;
  }

  function clipFrom(mapping, file, conversationId) {
    return {
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
    const messages = messageIndex(archive);
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
      clips.push(clipFrom(mapping, file, target.conversation.id));
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

  OD.solVoiceSidecar = {
    FORMAT,
    VERSION,
    AUTO_ATTACH_CONFIDENCES,
    MAPPING_FILE_NAME,
    normalizePath,
    parseMapping,
    findMappingFile,
    createAudioIndex,
    createObjectURLPool,
    buildSession
  };
})(window.OD);
