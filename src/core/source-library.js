window.OD = window.OD || {};

/*
  In-memory multi-source library. It deliberately keeps File-backed asset
  sessions out of persistence while giving every import a stable fingerprint.
*/
(function(OD){
  function textOf(value) {
    return OD.schema?.textOf ? OD.schema.textOf(value) : String(value ?? "");
  }

  function createTokenHasher() {
    let left = 0x811c9dc5;
    let right = 0x9e3779b9;
    return {
      update(token) {
        const value = `${String(token ?? "")}\u0000`;
        for (let index = 0; index < value.length; index += 1) {
          const code = value.charCodeAt(index);
          left ^= code;
          left = Math.imul(left, 0x01000193) >>> 0;
          right ^= code + index;
          right = Math.imul(right, 0x85ebca6b) >>> 0;
        }
      },
      digest() {
        return `${left.toString(16).padStart(8, "0")}${right.toString(16).padStart(8, "0")}`;
      }
    };
  }

  function hashTokens(tokens) {
    const hasher = createTokenHasher();
    for (const token of tokens) {
      hasher.update(token);
    }
    return hasher.digest();
  }

  function archiveFingerprint(archive) {
    const hasher = createTokenHasher();
    [
      archive?.source?.platform,
      archive?.source?.exporter,
      archive?.source?.formatVersion,
      archive?.exportedAt
    ].forEach(token => hasher.update(token));
    for (const conversation of (archive?.conversations || [])) {
      ["conversation", conversation?.id, conversation?.title, conversation?.createdAt, conversation?.updatedAt]
        .forEach(token => hasher.update(token));
      for (const message of (conversation?.messages || [])) {
        [
          "message",
          message?.id,
          message?.role,
          message?.createdAt,
          textOf(message?.content),
          textOf(message?.thinking),
          message?.metadata?.rawSay
        ].forEach(token => hasher.update(token));
        for (const attachment of (message?.attachments || [])) {
          ["attachment", attachment?.id, attachment?.path, attachment?.name, attachment?.mimeType, attachment?.size]
            .forEach(token => hasher.update(token));
        }
      }
    }
    return hasher.digest();
  }

  function disposeAssetSession(session) {
    if (!session) return;
    try {
      if (typeof session.dispose === "function") session.dispose();
      else session.objectURLs?.revokeAll?.();
    } catch (error) {
      console.warn("Could not dispose a local source asset session", error);
    }
  }

  function create() {
    const sources = [];
    const sourceById = new Map();
    const conversationSource = new Map();
    const usedConversationIds = new Set();

    function uniqueConversationId(sourceId, originalId, index) {
      const base = String(originalId || `conversation-${index + 1}`);
      if (!usedConversationIds.has(base)) return base;
      let candidate = `${sourceId}:${base}`;
      let suffix = 2;
      while (usedConversationIds.has(candidate)) {
        candidate = `${sourceId}:${base}#${suffix}`;
        suffix += 1;
      }
      return candidate;
    }

    function add({ archive, label, adapterId=null, assetSession=null, importDetails="" } = {}) {
      if (!archive?.conversations?.length) throw new Error("识别成功，但没有找到任何对话。");
      const fingerprint = archiveFingerprint(archive);
      const duplicate = sources.find(source => source.fingerprint === fingerprint);
      if (duplicate) {
        disposeAssetSession(assetSession);
        return { source: duplicate, duplicate: true };
      }

      let id = `source-${fingerprint}`;
      let suffix = 2;
      while (sourceById.has(id)) {
        id = `source-${fingerprint}-${suffix}`;
        suffix += 1;
      }

      const conversations = archive.conversations.map((conversation, index) => {
        const originalConversationId = String(conversation.id || `conversation-${index + 1}`);
        const conversationId = uniqueConversationId(id, originalConversationId, index);
        usedConversationIds.add(conversationId);
        conversationSource.set(conversationId, id);
        return {
          ...conversation,
          id: conversationId,
          context: {
            ...(conversation.context || {}),
            library: {
              sourceId: id,
              sourceLabel: String(label || archive.source?.platform || "Source"),
              originalConversationId
            }
          }
        };
      });

      const source = {
        id,
        fingerprint,
        label: String(label || archive.source?.platform || "Source"),
        adapterId,
        importDetails: String(importDetails || ""),
        source: { ...(archive.source || {}) },
        exportedAt: archive.exportedAt || null,
        assetSession,
        conversations
      };
      sources.push(source);
      sourceById.set(id, source);
      return { source, duplicate: false };
    }

    function remove(sourceId) {
      const source = sourceById.get(String(sourceId));
      if (!source) return null;
      const index = sources.indexOf(source);
      if (index >= 0) sources.splice(index, 1);
      sourceById.delete(source.id);
      for (const conversation of source.conversations) {
        conversationSource.delete(conversation.id);
        usedConversationIds.delete(conversation.id);
      }
      disposeAssetSession(source.assetSession);
      return source;
    }

    function clear() {
      const removed = [...sources];
      for (const source of removed) remove(source.id);
      return removed.length;
    }

    function archive(sourceId="all") {
      const selected = sourceId && sourceId !== "all"
        ? sources.filter(source => source.id === sourceId)
        : sources;
      return {
        schema: "our-dialogues.normalized.v1",
        source: { platform: "library", exporter: "our-dialogues-memory", formatVersion: 1 },
        exportedAt: null,
        conversations: selected.flatMap(source => source.conversations)
      };
    }

    function sourceForConversation(conversationOrId) {
      const id = typeof conversationOrId === "object" ? conversationOrId?.id : conversationOrId;
      return sourceById.get(conversationSource.get(String(id))) || null;
    }

    return {
      add,
      remove,
      clear,
      archive,
      sourceForConversation,
      get(sourceId) { return sourceById.get(String(sourceId)) || null; },
      sources() { return [...sources]; },
      get size() { return sources.length; }
    };
  }

  OD.sourceLibrary = { create, archiveFingerprint, _internals: { createTokenHasher, hashTokens, disposeAssetSession } };
})(window.OD);
