window.OD = window.OD || {};
OD.adapters = OD.adapters || [];

/*
  Claude official data-export adapter (claude.ai → Settings → Export data).
  Validated against a real 2026 export: a top-level array of conversations,
  each with uuid/name/created_at/chat_messages; messages carry typed content
  parts (text, thinking, tool_use, tool_result, token_budget, flag), a
  sender of human/assistant, and parent_message_uuid links that can branch
  when a message was edited or retried.

  Fidelity boundaries, chosen deliberately:
  - `thinking` parts are official stored thinking and map to normalized
    message.thinking — unlike the webpage-exporter's heuristic sourceTrace.
  - tool_use/tool_result become compact sourceTrace entries with payloads
    capped per entry; the cap is recorded, never silent. The export file on
    disk remains the authority for full payloads.
  - attachment `extracted_content` bodies are not copied into the library;
    their presence and length are preserved as metadata.
  - The active branch is followed (the chain ending at the newest leaf);
    alternate-branch message counts are recorded in sourceMetadata.
*/
(function(){
  const TRACE_CHAR_LIMIT = 2000;

  function isRecord(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
  }

  function isClaudeOfficialMessage(message) {
    if (!isRecord(message)) return false;
    if (typeof message.uuid !== "string" || !["human", "assistant"].includes(message.sender)) return false;
    return Array.isArray(message.content) || typeof message.text === "string";
  }

  function isClaudeOfficialExport(data) {
    if (!Array.isArray(data) || !data.length) return false;
    return data.every(conversation =>
      isRecord(conversation) &&
      typeof conversation.uuid === "string" &&
      typeof conversation.name === "string" &&
      typeof conversation.created_at === "string" &&
      Array.isArray(conversation.chat_messages) &&
      conversation.chat_messages.every(isClaudeOfficialMessage)
    );
  }

  /* Branches: several messages may share one parent after edits/retries.
     The active thread is the parent chain that ends at the newest leaf. */
  function activeBranch(messages) {
    const byUuid = new Map(messages.map(message => [message.uuid, message]));
    const referencedAsParent = new Set(messages.map(message => message.parent_message_uuid));
    const leaves = messages.filter(message => !referencedAsParent.has(message.uuid));
    if (!leaves.length) return { thread: messages, branchPoints: 0, alternateMessageCount: 0 };
    const newestLeaf = leaves.reduce((best, leaf) =>
      String(leaf.created_at || "") >= String(best.created_at || "") ? leaf : best
    );
    const thread = [];
    const seen = new Set();
    for (let cursor = newestLeaf; cursor && !seen.has(cursor.uuid); cursor = byUuid.get(cursor.parent_message_uuid)) {
      seen.add(cursor.uuid);
      thread.push(cursor);
    }
    thread.reverse();
    const childCounts = new Map();
    for (const message of messages) {
      childCounts.set(message.parent_message_uuid, (childCounts.get(message.parent_message_uuid) || 0) + 1);
    }
    const branchPoints = [...childCounts.values()].filter(count => count > 1).length;
    return { thread, branchPoints, alternateMessageCount: messages.length - thread.length };
  }

  function cappedTracePayload(value) {
    let serialized;
    try {
      serialized = typeof value === "string" ? value : JSON.stringify(value);
    } catch (_) {
      serialized = String(value);
    }
    serialized = String(serialized ?? "");
    if (serialized.length <= TRACE_CHAR_LIMIT) return { text: serialized, truncated: false, originalLength: serialized.length };
    return {
      text: `${serialized.slice(0, TRACE_CHAR_LIMIT)}… [truncated; full payload remains in the export file, ${serialized.length} chars]`,
      truncated: true,
      originalLength: serialized.length
    };
  }

  function convertMessage(message, index) {
    const content = [];
    const thinking = [];
    const sourceTrace = [];
    const housekeeping = {};
    for (const part of (Array.isArray(message.content) ? message.content : [])) {
      const type = String(part?.type || "");
      if (type === "text") {
        if (typeof part.text === "string" && part.text) content.push({ type: "text", text: part.text });
      } else if (type === "thinking") {
        const text = typeof part.thinking === "string" && part.thinking.trim()
          ? part.thinking
          : (Array.isArray(part.summaries) ? part.summaries.map(item => item?.summary ?? item?.text ?? "").filter(Boolean).join("\n") : "");
        if (text) thinking.push({ type: "text", text });
      } else if (type === "tool_use" || type === "tool_result") {
        const payload = cappedTracePayload(type === "tool_use" ? part.input : (part.content ?? part.structured_content));
        sourceTrace.push({
          type,
          name: part.name || part.integration_name || "",
          text: `${type === "tool_use" ? "→" : "←"} ${part.name || part.integration_name || "tool"}${payload.text ? `\n${payload.text}` : ""}`,
          truncated: payload.truncated,
          originalLength: payload.originalLength,
          isError: part.is_error === true || undefined
        });
      } else {
        housekeeping[type] = (housekeeping[type] || 0) + 1;
      }
    }
    if (!content.length && typeof message.text === "string" && message.text.trim()) {
      content.push({ type: "text", text: message.text });
    }
    const attachments = [
      ...(Array.isArray(message.attachments) ? message.attachments : []).map(item => ({
        type: "file",
        name: item?.file_name || "attachment",
        mimeType: item?.file_type || null,
        size: item?.file_size ?? null,
        extractedContentLength: typeof item?.extracted_content === "string" ? item.extracted_content.length : null
      })),
      ...(Array.isArray(message.files) ? message.files : []).map(item => ({
        type: "file",
        name: item?.file_name || "file",
        fileUuid: item?.file_uuid || null
      }))
    ];
    const metadata = {
      original: {
        uuid: message.uuid,
        sender: message.sender,
        created_at: message.created_at ?? null,
        updated_at: message.updated_at ?? null,
        parent_message_uuid: message.parent_message_uuid ?? null,
        contentPartTypes: (Array.isArray(message.content) ? message.content : []).map(part => String(part?.type || ""))
      }
    };
    if (sourceTrace.length) {
      metadata.sourceTrace = sourceTrace;
      metadata.sourceTraceKind = "official-tools";
    }
    if (Object.keys(housekeeping).length) metadata.housekeepingParts = housekeeping;
    return {
      id: message.uuid || `claude-message-${index}`,
      role: message.sender === "human" ? "user" : "assistant",
      speaker: message.sender === "human" ? "You" : "Claude",
      createdAt: message.created_at ?? null,
      content,
      thinking,
      attachments,
      metadata
    };
  }

  function conversationTitle(conversation, index) {
    const name = String(conversation.name || "").trim();
    if (name) return name;
    const summary = String(conversation.summary || "").trim().split("\n").find(line => line.trim());
    if (summary) return summary.length > 60 ? `${summary.slice(0, 57).trimEnd()}…` : summary;
    return `Claude conversation ${index + 1}`;
  }

  function convert(data) {
    const conversations = data.map((conversation, index) => {
      const { thread, branchPoints, alternateMessageCount } = activeBranch(conversation.chat_messages || []);
      const mapped = thread.map(convertMessage);
      /* Real exports contain fully empty turn pairs (no parts, no text —
         aborted or placeholder turns). They carry nothing readable, so they
         are dropped from the reading surface with the count recorded. */
      const messages = mapped.filter(message =>
        message.content.length || message.thinking.length ||
        message.attachments.length || message.metadata.sourceTrace?.length
      );
      return {
        id: conversation.uuid || `claude-conversation-${index}`,
        title: conversationTitle(conversation, index),
        createdAt: conversation.created_at ?? null,
        updatedAt: conversation.updated_at ?? null,
        context: {
          sourceMetadata: {
            accountUuid: conversation.account?.uuid ?? null,
            summary: conversation.summary || null,
            messageCount: (conversation.chat_messages || []).length,
            branchPoints,
            alternateMessageCount,
            emptyMessagesDropped: mapped.length - messages.length
          }
        },
        participants: [
          { id: "user", name: "You", role: "user" },
          { id: "assistant", name: "Claude", role: "assistant" }
        ],
        messages
      };
    });
    return OD.schema.archive({
      platform: "claude",
      exporter: "claude-official-export",
      conversations
    });
  }

  const zipProbeCache = new WeakMap();

  function conversationsEntryName(zip) {
    return zip.names.find(name => name === "conversations.json" || name.endsWith("/conversations.json")) || null;
  }

  async function probeZIP(zip) {
    const name = conversationsEntryName(zip);
    if (!name) return null;
    const cached = zipProbeCache.get(zip);
    if (cached?.name === name) return cached;
    const data = await zip.readJSON(name);
    if (!isClaudeOfficialExport(data)) return null;
    const probe = { name, data };
    zipProbeCache.set(zip, probe);
    return probe;
  }

  OD.adapters.push({
    id: "claude-official",
    label: "Claude official export",
    capabilities: {
      contract: "our-dialogues.adapter-capabilities.v1",
      json: true,
      zip: true,
      folder: false,
      thinking: "official-stored-thinking",
      attachments: "metadata-only; extracted text not copied",
      sourceMarkup: "typed-content-parts"
    },
    detectJSON: isClaudeOfficialExport,
    parseJSON: convert,
    async detectZIP(zip) {
      return !!(await probeZIP(zip));
    },
    async parseZIP(zip) {
      const probe = await probeZIP(zip);
      if (!probe) throw new Error("conversations.json exists, but its schema is not a strict Claude official-export match.");
      return convert(probe.data);
    },
    _internals: { isClaudeOfficialExport, activeBranch, convertMessage, cappedTracePayload, conversationTitle }
  });
})();
