window.OD = window.OD || {};

/*
  Strict orchestration for browser-selected source folders.

  A strict ChatGPT manifest is checked first to keep its binary assets lazy.
  Without it, the Mufy handler probes only ZIP candidates and never guesses by
  title, folder name, or generic conversation keys.
*/
(function(OD){
  const mufyZIPCache = new WeakMap();

  function filePath(file) {
    return String(file?.webkitRelativePath || file?.relativePath || file?.name || "")
      .replace(/\\/g, "/")
      .replace(/^\.\//, "")
      .replace(/^\/+/, "");
  }

  function zipFiles(fileList) {
    return Array.from(fileList || [])
      .filter(file => /\.zip$/i.test(filePath(file)) || file?.type === "application/zip")
      .sort((a, b) => filePath(a).localeCompare(filePath(b)));
  }

  async function parseMufyZIP(file) {
    let pending = mufyZIPCache.get(file);
    if (!pending) {
      pending = OD.registry.parseZIP(file);
      mufyZIPCache.set(file, pending);
    }
    return pending;
  }

  async function inspectMufy(fileList) {
    const candidates = zipFiles(fileList);
    const matches = [];
    for (const file of candidates) {
      try {
        const result = await parseMufyZIP(file);
        if (result?.recognized && result.adapter?.id === "mufy-raw") {
          matches.push({ file, result });
        }
      } catch (_) {}
    }
    return { candidates, matches };
  }

  function stableString(value) {
    if (value == null) return "";
    if (Array.isArray(value)) return `[${value.map(stableString).join(",")}]`;
    if (typeof value === "object") {
      return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableString(value[key])}`).join(",")}}`;
    }
    return JSON.stringify(value);
  }

  function nonEmpty(value) {
    return value != null && String(value).trim() !== "";
  }

  function messageStableId(message) {
    if (message?.metadata?.sourceField === "greeting") return "greeting";
    const original = message?.metadata?.original;
    const value = original?.id ?? original?.dialogsId ?? original?.dialogId ?? null;
    return nonEmpty(value) ? String(value) : null;
  }

  function exactMessageFingerprint(message) {
    return stableString({
      role: message?.role,
      createdAt: message?.createdAt,
      content: message?.content,
      thinking: message?.thinking,
      original: message?.metadata?.original
    });
  }

  function appendUniqueMessage(target, message, stats) {
    const stableId = messageStableId(message);
    const fingerprint = exactMessageFingerprint(message);
    const exact = target.messages.find(existing => exactMessageFingerprint(existing) === fingerprint);
    if (exact) {
      stats.duplicateMessageCount += 1;
      return;
    }

    if (stableId) {
      const sameStableId = target.messages.find(existing => messageStableId(existing) === stableId);
      if (sameStableId) {
        stats.conflictingMessageIdCount += 1;
        const suffix = stats.conflictingMessageIdCount + 1;
        target.messages.push({
          ...message,
          id: `${message.id || stableId}#conflict-${suffix}`,
          metadata: { ...message.metadata, folderMergeConflict: true }
        });
        return;
      }
    }

    let id = String(message?.id || `message-${target.messages.length + 1}`);
    const used = new Set(target.messages.map(existing => String(existing.id)));
    if (used.has(id)) {
      let suffix = 2;
      while (used.has(`${id}#${suffix}`)) suffix += 1;
      id = `${id}#${suffix}`;
    }
    target.messages.push(id === message.id ? message : { ...message, id });
  }

  function stableConversationIdentity(conversation) {
    const metadata = conversation?.context?.sourceMetadata || {};
    const characterId = metadata.characterId;
    const sessionId = metadata.sessionId;
    if (!nonEmpty(characterId) || !nonEmpty(sessionId)) return null;
    return { characterId: String(characterId), sessionId: String(sessionId) };
  }

  function publicConversationId(identity) {
    return `mufy:${encodeURIComponent(identity.characterId)}:${encodeURIComponent(identity.sessionId)}`;
  }

  function mergeMufyArchives(entries) {
    const conversations = [];
    const byStableIdentity = new Map();
    const stats = {
      sourceSessionCount: 0,
      duplicateSessionCount: 0,
      duplicateMessageCount: 0,
      conflictingMessageIdCount: 0
    };

    for (const [zipIndex, entry] of entries.entries()) {
      for (const [conversationIndex, conversation] of entry.result.archive.conversations.entries()) {
        stats.sourceSessionCount += 1;
        const identity = stableConversationIdentity(conversation);
        if (!identity) {
          conversations.push({
            ...conversation,
            id: `mufy-folder:${zipIndex + 1}:${conversationIndex + 1}:${conversation.id}`
          });
          continue;
        }

        const key = `${identity.characterId}\u0000${identity.sessionId}`;
        const existing = byStableIdentity.get(key);
        if (!existing) {
          const copy = { ...conversation, id: publicConversationId(identity), messages: [...conversation.messages] };
          byStableIdentity.set(key, copy);
          conversations.push(copy);
          continue;
        }

        stats.duplicateSessionCount += 1;
        for (const message of conversation.messages) appendUniqueMessage(existing, message, stats);
        existing.createdAt = existing.createdAt || conversation.createdAt;
        existing.updatedAt = conversation.updatedAt || existing.updatedAt;
        const current = existing.context?.sourceMetadata || {};
        const incoming = conversation.context?.sourceMetadata || {};
        const batches = [
          ...(Array.isArray(current.sourceBatches) ? current.sourceBatches : []),
          { batchFrom: current.batchFrom ?? null, totalSessions: current.totalSessions ?? null },
          { batchFrom: incoming.batchFrom ?? null, totalSessions: incoming.totalSessions ?? null }
        ];
        existing.context = {
          ...existing.context,
          sourceMetadata: {
            ...current,
            sourceBatches: batches.filter((batch, index, all) =>
              all.findIndex(other => stableString(other) === stableString(batch)) === index
            )
          }
        };
      }
    }

    return {
      archive: OD.schema.archive({
        platform: "mufy",
        exporter: "mufy-folder-batch",
        formatVersion: null,
        exportedAt: null,
        conversations
      }),
      stats
    };
  }

  const handlers = [
    {
      id: "chatgpt-official-folder",
      label: "ChatGPT official Export Folder",
      async detect(files) {
        return !!(await OD.chatgptExportFolder?.detect?.(files));
      },
      async parse(files) {
        const folder = await OD.chatgptExportFolder.parse(files);
        const parsed = await OD.registry.parseJSON(folder.conversations);
        if (!parsed?.recognized) throw new Error(OD.registry.formatDiagnostics(parsed?.diagnostics));
        const objectURLs = folder.objectURLs || (folder.assetIndex?.createObjectURL ? {
          get: reference => folder.assetIndex.createObjectURL(reference),
          revoke: reference => folder.assetIndex.revokeObjectURL?.(reference),
          revokeAll: () => folder.assetIndex.revokeAllObjectURLs?.()
        } : null);
        const details = [];
        if (folder.shardPaths?.length) details.push(`${folder.shardPaths.length} 个分片`);
        const assetCount = folder.stats?.availableAssetCount ?? folder.stats?.assetCount ??
          folder.stats?.indexedAssets ?? folder.assetIndex?.size;
        if (Number.isFinite(assetCount)) details.push(`${assetCount} 个本地附件`);
        return {
          archive: parsed.archive,
          adapter: parsed.adapter,
          assetSession: { assetIndex: folder.assetIndex, objectURLs },
          importDetails: details.join(" · "),
          folderSourceId: "chatgpt-official-folder",
          stats: folder.stats
        };
      }
    },
    {
      id: "mufy-zip-folder",
      label: "Mufy ZIP folder",
      async detect(files) {
        // A valid official manifest is decisive and keeps ZIP attachments lazy.
        if (await OD.chatgptExportFolder?.detect?.(files)) return false;
        return (await inspectMufy(files)).matches.length > 0;
      },
      async parse(files) {
        const inspection = await inspectMufy(files);
        const merged = mergeMufyArchives(inspection.matches);
        const skipped = inspection.candidates.length - inspection.matches.length;
        const details = [
          `${inspection.matches.length} 个 Mufy ZIP`,
          `${merged.stats.sourceSessionCount} 个源会话`,
          `${merged.archive.conversations.length} 段去重后对话`
        ];
        if (merged.stats.duplicateSessionCount) details.push(`${merged.stats.duplicateSessionCount} 个重复 session 已合并`);
        if (skipped) details.push(`${skipped} 个非 Mufy ZIP 已跳过`);
        return {
          archive: merged.archive,
          adapter: { id: "mufy-raw", label: "Mufy ZIP folder" },
          assetSession: null,
          importDetails: details.join(" · "),
          folderSourceId: "mufy-zip-folder",
          stats: {
            ...merged.stats,
            zipCandidateCount: inspection.candidates.length,
            importedZipCount: inspection.matches.length,
            skippedZipCount: skipped,
            conversationCount: merged.archive.conversations.length
          }
        };
      }
    }
  ];

  async function inspect(fileList) {
    const files = Array.from(fileList || []);
    const matches = [];
    for (const handler of handlers) {
      if (await handler.detect(files)) matches.push(handler);
    }
    return {
      recognized: matches.length === 1,
      handler: matches.length === 1 ? matches[0] : null,
      diagnostics: {
        format: "our-dialogues.source-folder-diagnostics.v1",
        reason: matches.length > 1 ? "ambiguous-folder" : matches.length ? null : "unknown-folder",
        selectedFileCount: files.length,
        zipFileCount: zipFiles(files).length,
        matchedSourceIds: matches.map(handler => handler.id)
      }
    };
  }

  function formatDiagnostics(diagnostics) {
    if (diagnostics?.reason === "ambiguous-folder") {
      return `这个文件夹同时匹配多个来源（${diagnostics.matchedSourceIds.join("、")}）。请选择单一导出来源的文件夹。`;
    }
    return `暂时无法识别这个文件夹。请选择解压后的 ChatGPT 官方 Export 文件夹，或包含 Mufy ZIP 的文件夹（检测到 ${diagnostics?.zipFileCount || 0} 个 ZIP）。`;
  }

  async function parse(fileList) {
    const inspection = await inspect(fileList);
    if (!inspection.recognized) {
      const error = new Error(formatDiagnostics(inspection.diagnostics));
      error.diagnostics = inspection.diagnostics;
      throw error;
    }
    return inspection.handler.parse(Array.from(fileList || []));
  }

  OD.sourceFolder = {
    inspect,
    parse,
    formatDiagnostics,
    _internals: { filePath, zipFiles, inspectMufy, mergeMufyArchives, stableConversationIdentity }
  };
})(window.OD);
