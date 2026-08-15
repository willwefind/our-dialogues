window.OD = window.OD || {};

(function(OD){
  const ISO = value => {
    if (value === null || value === undefined || value === "") return null;
    if (typeof value === "number") {
      const ms = value < 1e12 ? value * 1000 : value;
      const d = new Date(ms);
      return Number.isNaN(d.getTime()) ? null : d.toISOString();
    }
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? String(value) : d.toISOString();
  };

  const asArray = value => Array.isArray(value) ? value : (value == null ? [] : [value]);
  const textItem = text => ({ type: "text", text: text == null ? "" : String(text) });

  function normalizeContent(value) {
    if (Array.isArray(value)) return value.map(item => {
      if (typeof item === "string") return textItem(item);
      if (item && typeof item === "object") {
        if (item.type && "text" in item) return { ...item, text: String(item.text ?? "") };
        if ("text" in item) return { type: "text", ...item, text: String(item.text ?? "") };
        return { type: item.type || "unknown", metadata: { original: item } };
      }
      return textItem(item);
    });
    if (value && typeof value === "object" && "text" in value) return [textItem(value.text)];
    return [textItem(value)];
  }

  function role(value) {
    const r = String(value || "other").toLowerCase();
    if (["user","human","me"].includes(r)) return "user";
    if (["assistant","ai","bot","model"].includes(r)) return "assistant";
    if (r === "system") return "system";
    if (["tool","function"].includes(r)) return "tool";
    return "other";
  }

  function message(input = {}, fallbackId = "") {
    return {
      id: String(input.id ?? fallbackId),
      role: role(input.role ?? input.author ?? input.sender),
      speaker: String(input.speaker ?? input.name ?? input.role ?? "Unknown"),
      createdAt: ISO(input.createdAt ?? input.create_time ?? input.timestamp ?? null),
      content: normalizeContent(input.content ?? input.text ?? ""),
      thinking: input.thinking ? normalizeContent(input.thinking) : [],
      attachments: asArray(input.attachments),
      metadata: input.metadata && typeof input.metadata === "object" ? input.metadata : {}
    };
  }

  function conversation(input = {}, index = 0) {
    return {
      id: String(input.id ?? `conversation-${index}`),
      title: String(input.title ?? input.name ?? `Conversation ${index + 1}`),
      createdAt: ISO(input.createdAt ?? input.create_time ?? null),
      updatedAt: ISO(input.updatedAt ?? input.update_time ?? null),
      context: input.context && typeof input.context === "object" ? input.context : {},
      metadata: input.metadata && typeof input.metadata === "object" ? input.metadata : {},
      participants: asArray(input.participants),
      messages: asArray(input.messages).map((m, i) => message(m, `${input.id || index}-m${i}`))
    };
  }

  function archive({platform="unknown", exporter="unknown", formatVersion=null, exportedAt=null, conversations=[]} = {}) {
    return {
      schema: "our-dialogues.normalized.v1",
      source: { platform, exporter, formatVersion },
      exportedAt: ISO(exportedAt),
      conversations: asArray(conversations).map((c, i) => conversation(c, i))
    };
  }

  function textOf(items) { return asArray(items).map(x => x?.text ?? "").join("\n").trim(); }
  OD.schema = { ISO, asArray, textItem, normalizeContent, role, message, conversation, archive, textOf };
})(window.OD);
