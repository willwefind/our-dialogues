window.OD = window.OD || {};
OD.adapters = OD.adapters || [];

/*
  ChatGPT official export adapter.

  Validated against a real 2026 official export shard (`conversations-009.json`).
  The observed schema uses a conversation-level `mapping`, parent-linked nodes,
  and `current_node` to identify the active branch. Message content types observed:

    - text
    - multimodal_text
    - thoughts
    - reasoning_recap

  Thinking/reasoning is only surfaced when the export itself contains it.
*/
(function(){
  function asArray(value) {
    return Array.isArray(value) ? value : (value == null ? [] : [value]);
  }

  function looksLikeArray(data) {
    return Array.isArray(data) && data.length > 0 && data.every(x =>
      x && typeof x === "object" && !Array.isArray(x) &&
      x.mapping && typeof x.mapping === "object" &&
      (x.current_node || x.id || x.conversation_id)
    );
  }

  function activeNodes(conv) {
    const mapping = conv?.mapping || {};
    const nodes = [];

    if (conv?.current_node && mapping[conv.current_node]) {
      let id = conv.current_node;
      const seen = new Set();
      while (id && mapping[id] && !seen.has(id)) {
        seen.add(id);
        nodes.push(mapping[id]);
        id = mapping[id].parent;
      }
      nodes.reverse();
      return nodes;
    }

    return Object.values(mapping)
      .filter(n => n?.message)
      .sort((a,b) => (a.message?.create_time || 0) - (b.message?.create_time || 0));
  }

  function cleanExportMarkup(text) {
    return String(text ?? "")
      .replace(/\uE200(?:cite|filecite|entity|image_group|navlist|finance|schedule|standing|forecast)\uE202[\s\S]*?\uE201/g, "")
      .replace(/[\uE200\uE201\uE202]/g, "")
      .replace(/[ \t]+\n/g, "\n")
      .trim();
  }

  function textFromPart(part) {
    if (typeof part === "string") return part;
    if (!part || typeof part !== "object") return "";
    if (typeof part.text === "string") return part.text;
    if (typeof part.content === "string" && !part.content_type) return part.content;
    return "";
  }

  function visibleText(content) {
    if (!content || typeof content !== "object") return "";
    if (Array.isArray(content.parts)) {
      return cleanExportMarkup(content.parts.map(textFromPart).filter(Boolean).join("\n"));
    }
    if (typeof content.text === "string") return cleanExportMarkup(content.text);
    if (content.content_type === "reasoning_recap" && typeof content.content === "string") {
      return cleanExportMarkup(content.content);
    }
    if (typeof content.content === "string") return cleanExportMarkup(content.content);
    return "";
  }

  function thinkingItems(content) {
    if (content?.content_type !== "thoughts" || !Array.isArray(content.thoughts)) return [];
    return content.thoughts
      .map((item, i) => {
        const text = cleanExportMarkup(item?.content || "");
        const summary = cleanExportMarkup(item?.summary || "");
        if (!text && !summary) return null;
        return {
          type: "text",
          text: text || summary,
          summary: summary || null,
          finished: item?.finished ?? null,
          index: i
        };
      })
      .filter(Boolean);
  }

  function reasoningSource(msg, contentType) {
    return {
      messageId: msg?.id || null,
      createTime: msg?.create_time ?? null,
      contentType: contentType || null,
      toolIcons: asArray(msg?.metadata?.tool_icons).filter(Boolean)
    };
  }

  function attachmentType(mime) {
    const m = String(mime || "").toLowerCase();
    if (m.startsWith("image/")) return "image";
    if (m.startsWith("audio/")) return "audio";
    if (m.startsWith("video/")) return "video";
    return "file";
  }

  function normalizeAttachments(msg) {
    const meta = msg?.metadata || {};
    const result = [];
    const seen = new Set();

    for (const a of asArray(meta.attachments)) {
      if (!a || typeof a !== "object") continue;
      const id = a.id || a.asset_pointer || a.name || `attachment-${result.length}`;
      if (seen.has(id)) continue;
      seen.add(id);
      result.push({
        id: a.id || null,
        type: attachmentType(a.mime_type),
        name: a.name || a.id || "attachment",
        mimeType: a.mime_type || null,
        size: a.size ?? null,
        width: a.width ?? null,
        height: a.height ?? null,
        source: a.source || null,
        libraryFileId: a.library_file_id || null,
        src: null,
        metadata: { original: a }
      });
    }

    const parts = msg?.content?.parts;
    if (Array.isArray(parts)) {
      for (const part of parts) {
        if (!part || typeof part !== "object" || part.content_type !== "image_asset_pointer") continue;
        const pointer = part.asset_pointer || "";
        const id = pointer.replace(/^sediment:\/\//, "") || `image-${result.length}`;
        if (seen.has(id)) continue;
        seen.add(id);
        result.push({
          id,
          type: "image",
          name: id,
          mimeType: null,
          size: part.size_bytes ?? null,
          width: part.width ?? null,
          height: part.height ?? null,
          source: "asset_pointer",
          libraryFileId: null,
          src: pointer || null,
          metadata: { original: part }
        });
      }
    }

    return result;
  }

  function sourceMetadata(conv) {
    const out = {};
    for (const key of [
      "conversation_id", "conversation_template_id", "default_model_slug",
      "is_archived", "is_do_not_remember", "is_read_only", "is_starred",
      "is_study_mode", "memory_scope", "pinned_time", "plugin_ids", "voice"
    ]) {
      if (key in conv) out[key] = conv[key];
    }

    const mapping = conv?.mapping || {};
    const childCounts = new Map();
    for (const node of Object.values(mapping)) {
      if (!node?.parent) continue;
      childCounts.set(node.parent, (childCounts.get(node.parent) || 0) + 1);
    }
    const branchPoints = [...childCounts.values()].filter(n => n > 1).length;
    const totalMessages = Object.values(mapping).filter(n => n?.message).length;
    const activeMessages = activeNodes(conv).filter(n => n?.message).length;

    out.current_node = conv?.current_node || null;
    out.branch_points = branchPoints;
    out.alternate_message_count = Math.max(0, totalMessages - activeMessages);
    return out;
  }

  function makeMessage(msg, node, index, extra = {}) {
    const originalRole = msg?.author?.role || "other";
    const text = visibleText(msg?.content);
    const attachments = normalizeAttachments(msg);
    const metadata = msg?.metadata || {};

    return {
      id: msg?.id || node?.id || `message-${index}`,
      role: originalRole,
      speaker: originalRole === "user" ? "You" : (originalRole === "assistant" ? "ChatGPT" : originalRole),
      createdAt: msg?.create_time ?? null,
      content: text,
      thinking: extra.thinking || [],
      attachments,
      metadata: {
        originalRole,
        contentType: msg?.content?.content_type || null,
        model: metadata.model_slug || null,
        reasoningRecap: extra.reasoningRecap || [],
        reasoningToolIcons: extra.reasoningToolIcons || [],
        reasoningSourceMessageIds: extra.reasoningSourceMessageIds || [],
        reasoningSources: extra.reasoningSources || [],
        originalMetadata: metadata
      }
    };
  }

  function convertConversation(conv, index) {
    const out = [];
    let pendingThinking = [];
    let pendingRecaps = [];
    let pendingReasoningToolIcons = [];
    let pendingReasoningSourceMessageIds = [];
    let pendingReasoningSources = [];
    let pendingReasoningTime = null;

    function flushReasoningOnly() {
      if (!pendingThinking.length && !pendingRecaps.length) return;
      out.push({
        id: `reasoning-only-${conv.id || index}-${out.length}`,
        role: "assistant",
        speaker: "ChatGPT",
        createdAt: pendingReasoningTime,
        content: "",
        thinking: pendingThinking,
        attachments: [],
        metadata: {
          contentType: "reasoning_only",
          reasoningRecap: pendingRecaps,
          reasoningToolIcons: pendingReasoningToolIcons,
          reasoningSourceMessageIds: pendingReasoningSourceMessageIds,
          reasoningSources: pendingReasoningSources,
          reasoningOnly: true
        }
      });
      pendingThinking = [];
      pendingRecaps = [];
      pendingReasoningToolIcons = [];
      pendingReasoningSourceMessageIds = [];
      pendingReasoningSources = [];
      pendingReasoningTime = null;
    }

    for (const node of activeNodes(conv)) {
      const msg = node?.message;
      if (!msg) continue;
      const role = msg?.author?.role || "other";
      const content = msg?.content || {};
      const type = content.content_type;

      if (role === "assistant" && type === "thoughts") {
        if (pendingReasoningTime == null) pendingReasoningTime = msg.create_time ?? null;
        pendingThinking.push(...thinkingItems(content));
        pendingReasoningToolIcons.push(...asArray(msg?.metadata?.tool_icons).filter(Boolean));
        if (msg?.id) pendingReasoningSourceMessageIds.push(msg.id);
        pendingReasoningSources.push(reasoningSource(msg, type));
        continue;
      }

      if (role === "assistant" && type === "reasoning_recap") {
        if (pendingReasoningTime == null) pendingReasoningTime = msg.create_time ?? null;
        const recap = visibleText(content);
        if (recap) pendingRecaps.push(recap);
        pendingReasoningToolIcons.push(...asArray(msg?.metadata?.tool_icons).filter(Boolean));
        if (msg?.id) pendingReasoningSourceMessageIds.push(msg.id);
        pendingReasoningSources.push(reasoningSource(msg, type));
        continue;
      }

      if (role !== "assistant") flushReasoningOnly();

      if (role === "assistant") {
        out.push(makeMessage(msg, node, out.length, {
          thinking: pendingThinking,
          reasoningRecap: pendingRecaps,
          reasoningToolIcons: [...new Set(pendingReasoningToolIcons)],
          reasoningSourceMessageIds: pendingReasoningSourceMessageIds,
          reasoningSources: pendingReasoningSources
        }));
        pendingThinking = [];
        pendingRecaps = [];
        pendingReasoningToolIcons = [];
        pendingReasoningSourceMessageIds = [];
        pendingReasoningSources = [];
        pendingReasoningTime = null;
      } else {
        out.push(makeMessage(msg, node, out.length));
      }
    }

    flushReasoningOnly();

    return {
      id: conv.id || conv.conversation_id || `chatgpt-${index}`,
      title: conv.title || `ChatGPT conversation ${index + 1}`,
      createdAt: conv.create_time || null,
      updatedAt: conv.update_time || null,
      context: { sourceMetadata: sourceMetadata(conv) },
      participants: [
        { id: "user", name: "You", role: "user" },
        { id: "assistant", name: "ChatGPT", role: "assistant" }
      ],
      messages: out
    };
  }

  function convert(data) {
    return OD.schema.archive({
      platform: "chatgpt",
      exporter: "official",
      formatVersion: "2026-observed",
      exportedAt: null,
      conversations: data.map(convertConversation)
    });
  }

  function shardNames(zip) {
    if (zip.has("conversations.json")) return ["conversations.json"];
    return zip.names
      .filter(n => /(^|\/)conversations-\d+\.json$/i.test(n))
      .sort((a,b) => {
        const na = Number((a.match(/conversations-(\d+)\.json$/i) || [])[1] || 0);
        const nb = Number((b.match(/conversations-(\d+)\.json$/i) || [])[1] || 0);
        return na - nb;
      });
  }

  const zipProbeCache = new WeakMap();

  function conversationsInChunk(chunk) {
    if (Array.isArray(chunk)) return chunk;
    return Array.isArray(chunk?.conversations) ? chunk.conversations : [];
  }

  async function probeZIP(zip) {
    const names = shardNames(zip);
    if (!names.length) return null;
    const cached = zipProbeCache.get(zip);
    if (cached?.name === names[0]) return cached;
    const data = await zip.readJSON(names[0]);
    if (!looksLikeArray(conversationsInChunk(data))) return null;
    const probe = { name: names[0], data };
    zipProbeCache.set(zip, probe);
    return probe;
  }

  OD.adapters.push({
    id: "chatgpt-official-2026",
    label: "ChatGPT official export (2026 validated)",
    capabilities: {
      contract: "our-dialogues.adapter-capabilities.v1",
      json: true,
      zip: true,
      folder: true,
      thinking: "extract",
      attachments: "metadata-and-lazy-folder",
      sourceMarkup: "source-token-cleanup"
    },
    detectJSON: looksLikeArray,
    parseJSON: convert,
    async detectZIP(zip) {
      return !!(await probeZIP(zip));
    },
    async parseZIP(zip) {
      const names = shardNames(zip);
      const probe = await probeZIP(zip);
      if (!probe) throw new Error("ChatGPT conversation filenames exist, but their schema is not a strict official-export match.");
      let all = [];
      for (const name of names) {
        const chunk = name === probe.name ? probe.data : await zip.readJSON(name);
        all = all.concat(conversationsInChunk(chunk));
      }
      if (!looksLikeArray(all)) {
        throw new Error("找到了 ChatGPT conversation JSON，但实际结构与当前 adapter 不一致。");
      }
      return convert(all);
    }
  });
})();
