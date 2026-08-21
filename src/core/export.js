window.OD = window.OD || {};

/*
  Reading-surface export. Markdown carries what the Reader shows — visible
  text, speakers, times, attachment names — and reports what it leaves out
  (thinking, tool traces) as counts instead of dropping them silently.
  JSONL/JSON carry the full normalized conversation for machine use.
*/
(function(OD){
  function textOf(content) {
    if (typeof content === "string") return content;
    return OD.schema.textOf(content);
  }

  function countHidden(conversation) {
    let thinking = 0;
    let trace = 0;
    for (const message of conversation?.messages || []) {
      if (textOf(message.thinking)) thinking += 1;
      if (message.metadata?.sourceTrace?.length) trace += 1;
    }
    return { thinking, trace };
  }

  function conversationToMarkdown(conversation, { sourceLabel = "" } = {}) {
    const lines = [];
    lines.push(`# ${String(conversation.title || conversation.id || "对话")}`);
    lines.push("");
    if (sourceLabel) lines.push(`- 来源：${sourceLabel}`);
    if (conversation.createdAt) lines.push(`- 开始时间：${conversation.createdAt}`);
    lines.push(`- 消息：${(conversation.messages || []).length} 条`);
    const hidden = countHidden(conversation);
    if (hidden.thinking || hidden.trace) {
      const parts = [];
      if (hidden.thinking) parts.push(`思考 ${hidden.thinking} 条`);
      if (hidden.trace) parts.push(`工具轨迹 ${hidden.trace} 条`);
      lines.push(`- 未包含在本导出中：${parts.join(" · ")}（仍保留在原始导出与阅读器中）`);
    }
    lines.push("", "---", "");
    for (const message of conversation.messages || []) {
      const speaker = message.speaker || message.role || "";
      const time = message.createdAt ? ` · ${message.createdAt}` : "";
      lines.push(`**${speaker}**${time}`, "");
      const body = textOf(message.content);
      if (body) lines.push(body, "");
      for (const attachment of message.attachments || []) {
        lines.push(`[附件：${attachment?.name || "未命名文件"}]`, "");
      }
    }
    return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
  }

  function conversationsToMarkdown(conversations, { sourceLabelOf } = {}) {
    return (conversations || [])
      .map(conversation => conversationToMarkdown(conversation, {
        sourceLabel: sourceLabelOf?.(conversation) || ""
      }))
      .join("\n---\n\n");
  }

  function conversationToJSON(conversation) {
    return `${JSON.stringify(conversation, null, 2)}\n`;
  }

  function conversationsToJSONL(conversations) {
    return `${(conversations || []).map(conversation => JSON.stringify(conversation)).join("\n")}\n`;
  }

  function safeFilename(title, extension) {
    const cleaned = String(title ?? "")
      .split("")
      .map(character => character.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(character) ? " " : character)
      .join("")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 60);
    return `${cleaned || "our-dialogues"}.${extension}`;
  }

  OD.exporter = {
    conversationToMarkdown,
    conversationsToMarkdown,
    conversationToJSON,
    conversationsToJSONL,
    safeFilename,
    _internals: { countHidden }
  };
})(window.OD);
