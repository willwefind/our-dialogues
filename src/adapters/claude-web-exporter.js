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

  function markerKind(value) {
    const line = String(value || "").split("\n").find(part => part.trim())?.trim() || "";
    if (/^(?:✓\s*)?Done(?:[.!…]+)?$/i.test(line)) return "done";
    if (/^(?:Viewed|Viewing|Read|Reading|Opened|Opening|Edited|Editing|Created|Creating|Wrote|Writing|Searched|Searching|Ran|Running|Executed|Executing|Fetched|Fetching|Called|Calling)\s+(?:file|files|folder|folders|command|commands|tool|tools|web|the web|reminder|task)\b/i.test(line)) {
      return "tool";
    }
    if (/^(?:Search(?:ing)?|Web search|Create reminder|Created reminder|Tool action)(?:\.{3}|…|:|\b)/i.test(line)) {
      return "tool";
    }
    return null;
  }

  /*
    The exporter flattens UI trace, tool activity, and replies into one string.
    Split only marker-bounded runs. Anything not clearly inside one stays in
    visible text, and rawSay is retained by convert() regardless of the result.
  */
  function splitAssistantSay(value) {
    const rawSay = String(value ?? "").replace(/\r\n?/g, "\n");
    const blocks = rawSay.split(/\n[ \t]*\n+/).map(text => text.trim()).filter(Boolean);
    if (!blocks.length) return { visibleText: "", sourceTrace: [], applied: false, conservativeFallback: false };

    const kinds = blocks.map(markerKind);
    const firstMarker = kinds.find(Boolean) || null;
    let traceMode = firstMarker === "done";
    const visible = [];
    const sourceTrace = [];

    for (let index = 0; index < blocks.length; index += 1) {
      const text = blocks[index];
      const kind = kinds[index];
      if (kind === "done") {
        sourceTrace.push({ type: "marker", marker: "done", text });
        traceMode = false;
        continue;
      }
      if (kind === "tool") {
        sourceTrace.push({ type: "marker", marker: "tool-action", text });
        traceMode = kinds.slice(index + 1).includes("done");
        continue;
      }
      if (traceMode) sourceTrace.push({ type: "trace", text });
      else visible.push(text);
    }

    if (!sourceTrace.length) {
      return { visibleText: rawSay.trim(), sourceTrace: [], applied: false, conservativeFallback: false };
    }
    if (!visible.length) {
      return {
        visibleText: rawSay.trim(),
        sourceTrace,
        applied: false,
        conservativeFallback: true
      };
    }
    return {
      visibleText: visible.join("\n\n").trim(),
      sourceTrace,
      applied: true,
      conservativeFallback: false
    };
  }

  function convert(data) {
    const metadata = data.metadata;
    const id = claudeConversationId(metadata.link);
    const messages = data.messages.map((message, index) => {
      const split = message.role === "assistant"
        ? splitAssistantSay(message.say)
        : { visibleText: message.say, sourceTrace: [], applied: false, conservativeFallback: false };
      return {
        id: `${id}-message-${index + 1}`,
        role: message.role,
        speaker: message.role === "human" ? "You" : "Claude",
        createdAt: localExporterTime(message.time),
        content: split.visibleText,
        thinking: [],
        attachments: [],
        metadata: {
          originalRole: message.role,
          original: message,
          rawSay: message.say,
          sourceTrace: split.sourceTrace,
          sourceTraceHeuristic: {
            format: "ai-chat-exporter-marker-bounded-v1",
            applied: split.applied,
            conservativeFallback: split.conservativeFallback
          }
        }
      };
    });
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
      thinking: "not-structured; conservative-source-trace",
      attachments: "not-exported",
      sourceMarkup: "plain-or-markdown-text"
    },
    detectJSON: isClaudeWebExporter,
    parseJSON: convert,
    _internals: { claudeConversationId, localExporterTime, isClaudeWebExporter, markerKind, splitAssistantSay }
  });
})();
