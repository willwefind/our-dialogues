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

  /* What a merged conversation already holds, kept beside it as messages
     arrive, so each new message is checked once rather than against every
     earlier one again (two overlapping exports of a long chat took half a
     minute the old way). */
  const mergeIndexes = new WeakMap();
  function mergeIndex(target) {
    let index = mergeIndexes.get(target);
    if (!index) {
      index = { fingerprints: new Set(), stableIds: new Set(), ids: new Set() };
      for (const existing of target.messages) remember(index, existing);
      mergeIndexes.set(target, index);
    }
    return index;
  }
  function remember(index, message) {
    index.fingerprints.add(exactMessageFingerprint(message));
    const stableId = messageStableId(message);
    if (stableId) index.stableIds.add(stableId);
    index.ids.add(String(message.id));
  }

  function appendUniqueMessage(target, message, stats) {
    const index = mergeIndex(target);
    const push = value => { target.messages.push(value); remember(index, value); };
    const stableId = messageStableId(message);
    const fingerprint = exactMessageFingerprint(message);
    if (index.fingerprints.has(fingerprint)) {
      stats.duplicateMessageCount += 1;
      return;
    }

    if (stableId && index.stableIds.has(stableId)) {
      stats.conflictingMessageIdCount += 1;
      const suffix = stats.conflictingMessageIdCount + 1;
      push({
        ...message,
        id: `${message.id || stableId}#conflict-${suffix}`,
        metadata: { ...message.metadata, folderMergeConflict: true }
      });
      return;
    }

    let id = String(message?.id || `message-${target.messages.length + 1}`);
    if (index.ids.has(id)) {
      let suffix = 2;
      while (index.ids.has(`${id}#${suffix}`)) suffix += 1;
      id = `${id}#${suffix}`;
    }
    push(id === message.id ? message : { ...message, id });
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

  function titleSourceRank(value) {
    return ({
      "greeting": 0,
      "remark": 0,
      "exported": 1,
      "current": 2,
      "assistant-first-line": 3,
      "dialogue-derived": 4,
      "fallback": 5
    })[value] ?? 6;
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
        if (titleSourceRank(incoming.titleSource) < titleSourceRank(current.titleSource)) {
          existing.title = conversation.title;
          existing.metadata = { ...(existing.metadata || {}), titleSource: incoming.titleSource };
        }
        const batches = [
          ...(Array.isArray(current.sourceBatches) ? current.sourceBatches : []),
          { batchFrom: current.batchFrom ?? null, totalSessions: current.totalSessions ?? null },
          { batchFrom: incoming.batchFrom ?? null, totalSessions: incoming.totalSessions ?? null }
        ];
        existing.context = {
          ...existing.context,
          sourceMetadata: {
            ...current,
            ...(titleSourceRank(incoming.titleSource) < titleSourceRank(current.titleSource)
              ? { titleSource: incoming.titleSource }
              : {}),
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

  /* SillyTavern keeps one JSON Lines file per chat. Its own backups/ copies
     every chat many times over, and extensions/ belongs to third parties,
     so both are left alone. */
  function sillyTavernCandidates(fileList) {
    return Array.from(fileList || [])
      .filter(file => /\.jsonl$/i.test(filePath(file)))
      .filter(file => !filePath(file).split("/").some(part => /^(backups|extensions)$/i.test(part)))
      .sort((a, b) => filePath(a).localeCompare(filePath(b)));
  }

  /* The header line can be long — cards that keep a status database put it
     in chat_metadata — so reading goes on until the first line ends. */
  async function firstLine(file) {
    if (typeof file?.slice !== "function") return ((await file.text()).replace(/^﻿/, "").split(/\r?\n/).find(line => line.trim())) || "";
    let size = 65536;
    for (;;) {
      const head = (await file.slice(0, size).text()).replace(/^﻿/, "");
      const lines = head.split(/\r?\n/);
      const index = lines.findIndex(line => line.trim());
      if (index !== -1 && (index < lines.length - 1 || size >= file.size)) return lines[index];
      if (size >= file.size) return "";
      size *= 4;
    }
  }

  async function looksLikeSillyTavern(file) {
    try { return !!OD.sillyTavern?.isHeader(JSON.parse(await firstLine(file))); } catch (_) { return false; }
  }

  async function readSillyTavernGroups(fileList) {
    const groups = [];
    for (const file of Array.from(fileList || [])) {
      const parts = filePath(file).split("/");
      if (parts.length < 2 || parts[parts.length - 2].toLowerCase() !== "groups" || !/\.json$/i.test(parts[parts.length - 1])) continue;
      try {
        const group = JSON.parse((await file.text()).replace(/^﻿/, ""));
        if (group && typeof group === "object" && Array.isArray(group.chats)) groups.push(group);
      } catch (_) {}
    }
    return groups;
  }

  /* A character card keeps its JSON in a PNG text chunk ("ccv3", else
     "chara"), base64 — written after the image data. Only the chunk headers
     are read on the way there; the image itself never leaves the disk. */
  async function readCardJSON(file) {
    const bytes = async (start, end) => new Uint8Array(await file.slice(start, end).arrayBuffer());
    const signature = await bytes(0, 8);
    if (signature.length < 8 || signature[0] !== 0x89 || signature[1] !== 0x50) return null;
    const found = {};
    for (let position = 8; position + 8 <= file.size;) {
      const head = await bytes(position, position + 8);
      const length = ((head[0] << 24) >>> 0) + (head[1] << 16) + (head[2] << 8) + head[3];
      const type = String.fromCharCode(head[4], head[5], head[6], head[7]);
      if (type === "IEND") break;
      if (type === "tEXt") {
        const body = await bytes(position + 8, position + 8 + length);
        const split = body.indexOf(0);
        const keyword = String.fromCharCode(...body.slice(0, Math.max(0, split)));
        if (split > 0 && (keyword === "ccv3" || keyword === "chara")) found[keyword] = body.slice(split + 1);
      }
      position += 12 + length;
    }
    const payload = found.ccv3 || found.chara;
    if (!payload) return null;
    try {
      const base64 = new TextDecoder("latin1").decode(payload);
      const binary = atob(base64);
      const utf8 = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) utf8[index] = binary.charCodeAt(index);
      return JSON.parse(new TextDecoder("utf-8").decode(utf8));
    } catch (_) {
      return null;
    }
  }

  async function readJSONFile(file) {
    try { return JSON.parse((await file.text()).replace(/^﻿/, "")); } catch (_) { return null; }
  }

  /* The display rules SillyTavern would run for these chats: global ones,
     the active preset's when that preset is allowed to run rules, and each
     card's own when that card is allowed. They exist only when the user
     folder itself (data/default-user) was picked; secrets.json is never
     opened. */
  async function readSillyTavernRules(fileList, folders) {
    const files = Array.from(fileList || []);
    const dirOf = path => path.split("/").slice(0, -1).join("/");
    // The user folder is whatever holds chats/ or "group chats/".
    const chatDirs = new Set(sillyTavernCandidates(files).map(file => {
      const parts = filePath(file).split("/");
      const index = parts.findIndex(part => /^(chats|group chats)$/i.test(part));
      return index === -1 ? null : parts.slice(0, index).join("/");
    }).filter(dir => dir !== null));
    const settingsFile = files.find(file => {
      const path = filePath(file);
      return /(^|\/)settings\.json$/i.test(path) && chatDirs.has(dirOf(path));
    });
    if (!settingsFile) return { rules: null, stats: { settingsFound: false } };
    const base = dirOf(filePath(settingsFile));
    const at = relative => files.find(file => filePath(file) === (base ? `${base}/${relative}` : relative));
    const settings = await readJSONFile(settingsFile) || {};
    const extensions = settings.extension_settings || {};
    const listOf = value => Array.isArray(value) ? value : [];
    const global = listOf(extensions.regex);

    let preset = [];
    let presetName = null;
    if ((settings.main_api || "openai") === "openai") {
      presetName = settings.oai_settings?.preset_settings_openai || null;
      const allowed = listOf(extensions.preset_allowed_regex?.openai).includes(presetName);
      const presetFile = presetName ? at(`OpenAI Settings/${presetName}.json`) : null;
      if (allowed && presetFile) preset = listOf((await readJSONFile(presetFile))?.extensions?.regex_scripts);
    }

    const allowedCards = new Set(listOf(extensions.character_allowed_regex));
    const byCharacter = {};
    let cardsRead = 0;
    for (const folder of folders) {
      const avatar = `${folder}.png`;
      const card = allowedCards.has(avatar) ? at(`characters/${avatar}`) : null;
      if (!card) continue;
      const json = await readCardJSON(card);
      cardsRead += 1;
      const scripts = listOf((json?.data || json)?.extensions?.regex_scripts);
      if (scripts.length) byCharacter[folder] = scripts;
    }
    return {
      rules: { shared: [...global, ...preset], byCharacter },
      stats: { settingsFound: true, globalRules: global.length, presetName, presetRules: preset.length, cardsRead, cardsWithRules: Object.keys(byCharacter).length }
    };
  }

  async function parseSillyTavern(fileList) {
    const candidates = sillyTavernCandidates(fileList);
    const chats = [];
    let skippedFiles = 0;
    let invalidLines = 0;
    for (const file of candidates) {
      const { lines, invalid } = OD.sillyTavern.parseLines(await file.text());
      invalidLines += invalid;
      if (OD.sillyTavern.isChat(lines)) chats.push({ path: filePath(file), lines });
      else skippedFiles += 1;
    }
    const groups = await readSillyTavernGroups(fileList);
    const folders = new Set(chats
      .map(chat => chat.path.split("/"))
      .filter(parts => parts.length >= 2 && !parts.some(part => part.toLowerCase() === "group chats") && parts[parts.length - 2].toLowerCase() !== "chats")
      .map(parts => parts[parts.length - 2]));
    const { rules, stats: ruleStats } = await readSillyTavernRules(fileList, folders);
    const archive = OD.sillyTavern.convertChats(chats, { groups, rules });
    const characters = new Set(archive.conversations.filter(c => !c.context.sourceMetadata.isGroupChat).map(c => c.context.sourceMetadata.characterId));
    const groupChats = archive.conversations.filter(c => c.context.sourceMetadata.isGroupChat).length;
    const messages = archive.conversations.flatMap(conversation => conversation.messages);
    return {
      archive,
      stats: {
        candidateFileCount: candidates.length, chatCount: chats.length, characterCount: characters.size, groupChatCount: groupChats, skippedFiles, invalidLines,
        ...ruleStats,
        prettifiedMessages: messages.filter(message => message.metadata?.displayRules?.length).length,
        foldedBlocks: messages.reduce((sum, message) => sum + (message.metadata?.foldedBlocks || 0), 0)
      }
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
    },
    {
      id: "sillytavern-folder",
      label: "SillyTavern",
      async detect(files) {
        if (await OD.chatgptExportFolder?.detect?.(files)) return false;
        for (const file of sillyTavernCandidates(files).slice(0, 8)) {
          if (await looksLikeSillyTavern(file)) return true;
        }
        return false;
      },
      async parse(files) {
        const { archive, stats } = await parseSillyTavern(files);
        if (!archive.conversations.length) throw new Error("这个文件夹里没有可以读取的 SillyTavern 聊天记录。");
        const details = [`${stats.chatCount} 段聊天`, `${stats.characterCount} 个角色`];
        if (stats.groupChatCount) details.push(`${stats.groupChatCount} 段群聊`);
        if (stats.skippedFiles) details.push(`${stats.skippedFiles} 个文件无法识别已跳过`);
        if (stats.invalidLines) details.push(`${stats.invalidLines} 行损坏已跳过`);
        if (stats.prettifiedMessages) details.push(`${stats.prettifiedMessages} 条按卡片美化规则显示`);
        if (stats.foldedBlocks) details.push(`${stats.foldedBlocks} 处状态栏已折叠`);
        if (!stats.settingsFound) details.push("没读到美化规则（选 data/default-user 文件夹才有）");
        return {
          archive,
          adapter: { id: "sillytavern-chat", label: "SillyTavern" },
          assetSession: null,
          importDetails: details.join(" · "),
          folderSourceId: "sillytavern-folder",
          stats
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
    return `暂时无法识别这个文件夹。请选择解压后的 ChatGPT 官方 Export 文件夹、包含 Mufy ZIP 的文件夹，或 SillyTavern 的 data/default-user 文件夹（检测到 ${diagnostics?.zipFileCount || 0} 个 ZIP）。`;
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
    _internals: { filePath, zipFiles, inspectMufy, sillyTavernCandidates, parseSillyTavern, readCardJSON, readSillyTavernRules, mergeMufyArchives, stableConversationIdentity, titleSourceRank }
  };
})(window.OD);
