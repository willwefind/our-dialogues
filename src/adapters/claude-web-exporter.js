window.OD = window.OD || {};
OD.adapters = OD.adapters || [];

(function(){
  const POWERED_BY = "Claude Exporter (https://www.ai-chat-exporter.net)";

  function claudeConversationId(link) {
    try {
      const url = new URL(link);
      if (url.hostname !== "claude.ai") return null;
      const match = url.pathname.match(/^\/chat\/([^/]+)\/?$/);
      return match?.[1] || null;
    } catch (_) {
      return null;
    }
  }

  function localExporterTime(value) {
    if (value == null || value === "") return null;
    const match = String(value).trim().match(
      /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})$/
    );
    if (!match) return value;
    const [, month, day, year, hour, minute, second] = match.map(Number);
    const date = new Date(year, month - 1, day, hour, minute, second);
    if (
      date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day ||
      date.getHours() !== hour || date.getMinutes() !== minute || date.getSeconds() !== second
    ) return value;
    return date.toISOString();
  }

  function isClaudeWebExporter(data) {
    if (!data || typeof data !== "object" || Array.isArray(data)) return false;
    if (!Array.isArray(data.messages) || !data.metadata || typeof data.metadata !== "object") return false;
    if (String(data.metadata.powered_by || "").trim() !== POWERED_BY) return false;
    if (!claudeConversationId(data.metadata.link)) return false;
    if (typeof data.metadata.title !== "string" || !data.metadata.dates || typeof data.metadata.dates !== "object") {
      return false;
    }
    return data.messages.every(message =>
      message && typeof message === "object" && !Array.isArray(message) &&
      ["human", "assistant"].includes(message.role) &&
      typeof message.say === "string" && typeof message.time === "string"
    );
  }

  function convert(data) {
    const metadata = data.metadata;
    const id = claudeConversationId(metadata.link);
    const messages = data.messages.map((message, index) => ({
      id: `${id}-message-${index + 1}`,
      role: message.role,
      speaker: message.role === "human" ? "You" : "Claude",
      createdAt: localExporterTime(message.time),
      content: message.say,
      thinking: [],
      attachments: [],
      metadata: {
        originalRole: message.role,
        original: message
      }
    }));
    const dates = metadata.dates || {};

    return OD.schema.archive({
      platform: "claude",
      exporter: "ai-chat-exporter.net",
      formatVersion: "observed-2026",
      exportedAt: localExporterTime(dates.exported),
      conversations: [{
        id,
        title: metadata.title.trim() || "Claude conversation",
        createdAt: localExporterTime(dates.created) || messages[0]?.createdAt || null,
        updatedAt: localExporterTime(dates.updated) || null,
        context: { sourceMetadata: { original: metadata } },
        participants: [
          { id: "human", name: "You", role: "user" },
          { id: "assistant", name: "Claude", role: "assistant" }
        ],
        messages
      }]
    });
  }

  OD.adapters.push({
    id: "claude-web-exporter",
    label: "Claude Exporter (ai-chat-exporter.net)",
    capabilities: {
      contract: "our-dialogues.adapter-capabilities.v1",
      json: true,
      zip: false,
      folder: false,
      thinking: "not-exported",
      attachments: "not-exported",
      sourceMarkup: "plain-or-markdown-text"
    },
    detectJSON: isClaudeWebExporter,
    parseJSON: convert,
    _internals: { claudeConversationId, localExporterTime, isClaudeWebExporter }
  });
})();
