window.OD = window.OD || {};
OD.adapters = OD.adapters || [];

/*
  PROVISIONAL adapter.
  This must be validated against a real 2026 ChatGPT official export before support is marked verified.
*/
(function(){
  function partToText(part) {
    if (typeof part === "string") return part;
    if (part == null) return "";
    if (typeof part === "object") {
      if (typeof part.text === "string") return part.text;
      if (typeof part.content === "string") return part.content;
      return "";
    }
    return String(part);
  }

  function messageText(msg) {
    const c = msg?.content;
    if (!c) return "";
    if (Array.isArray(c.parts)) return c.parts.map(partToText).filter(Boolean).join("\n");
    if (typeof c.text === "string") return c.text;
    if (typeof c === "string") return c;
    return "";
  }

  function linearNodes(conv) {
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

  function convertConversation(conv, index) {
    const messages = [];
    for (const node of linearNodes(conv)) {
      const msg = node?.message;
      if (!msg) continue;
      const text = messageText(msg);
      if (!text && !msg?.metadata) continue;
      const originalRole = msg?.author?.role || "other";
      messages.push({
        id: msg.id || node.id || `${conv.id || index}-${messages.length}`,
        role: originalRole,
        speaker: originalRole === "user" ? "You" : (originalRole === "assistant" ? "ChatGPT" : originalRole),
        createdAt: msg.create_time || null,
        content: text,
        attachments: [],
        metadata: {
          originalRole,
          contentType: msg?.content?.content_type || null,
          model: msg?.metadata?.model_slug || msg?.metadata?.model || null,
          originalMetadata: msg?.metadata || {}
        }
      });
    }

    return {
      id: conv.id || conv.conversation_id || `chatgpt-${index}`,
      title: conv.title || `ChatGPT conversation ${index + 1}`,
      createdAt: conv.create_time || null,
      updatedAt: conv.update_time || null,
      context: { sourceMetadata: { currentNode: conv.current_node || null, gizmoId: conv.gizmo_id || null } },
      messages
    };
  }

  function looksLikeArray(data) {
    return Array.isArray(data) && data.some(x => x && typeof x === "object" && ("mapping" in x || "current_node" in x));
  }

  function convert(data) {
    return OD.schema.archive({
      platform: "chatgpt",
      exporter: "official",
      formatVersion: null,
      exportedAt: null,
      conversations: data.map(convertConversation)
    });
  }

  OD.adapters.push({
    id: "chatgpt-official-provisional",
    label: "ChatGPT official export (provisional)",
    detectJSON: looksLikeArray,
    parseJSON: convert,
    detectZIP(zip) {
      return zip.has("conversations.json") || zip.names.some(n => /^conversations-\d+\.json$/i.test(n));
    },
    async parseZIP(zip) {
      const names = zip.has("conversations.json")
        ? ["conversations.json"]
        : zip.names.filter(n => /^conversations-\d+\.json$/i.test(n)).sort();
      let all = [];
      for (const name of names) {
        const chunk = await zip.readJSON(name);
        if (Array.isArray(chunk)) all = all.concat(chunk);
        else if (Array.isArray(chunk?.conversations)) all = all.concat(chunk.conversations);
      }
      if (!looksLikeArray(all)) {
        throw new Error("找到了 ChatGPT conversation JSON，但实际结构与当前 provisional adapter 不一致。请把真实 export 样本交给 Sol 校准。");
      }
      return convert(all);
    }
  });
})();
