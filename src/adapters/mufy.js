window.OD = window.OD || {};
OD.adapters = OD.adapters || [];

(function(){
  const RAW_DATA_FILENAME = "_原始数据.json";
  const BLOCK_TAGS = /<\/?(?:address|article|aside|blockquote|dd|details|div|dl|dt|fieldset|figcaption|figure|footer|h[1-6]|header|hr|li|main|nav|ol|p|pre|section|summary|table|tbody|td|tfoot|th|thead|tr|ul)\b[^>]*>/gi;
  const ENTITY_MAP = {
    amp: "&", apos: "'", copy: "©", gt: ">", hellip: "…", laquo: "«",
    ldquo: "“", lsquo: "‘", lt: "<", mdash: "—", middot: "·", nbsp: " ",
    ndash: "–", quot: '"', raquo: "»", rdquo: "”", reg: "®", rsquo: "’"
  };
  const zipProbeCache = new WeakMap();

  function stripNonContentMarkup(value) {
    return String(value ?? "")
      .replace(/<!--[\s\S]*?(?:-->|$)/g, "")
      .replace(/<\s*(script|style|noscript|template)\b[^>]*>[\s\S]*?(?:<\s*\/\s*\1\s*>|$)/gi, "");
  }

  function decodeEntities(value) {
    return String(value ?? "").replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);/gi, (whole, token) => {
      if (token[0] === "#") {
        const radix = token[1]?.toLowerCase() === "x" ? 16 : 10;
        const digits = radix === 16 ? token.slice(2) : token.slice(1);
        const codePoint = Number.parseInt(digits, radix);
        if (!Number.isFinite(codePoint) || codePoint < 0 || codePoint > 0x10FFFF) return whole;
        try { return String.fromCodePoint(codePoint); } catch (_) { return whole; }
      }
      return ENTITY_MAP[token.toLowerCase()] ?? whole;
    });
  }

  function visibleMarkupText(value) {
    return decodeEntities(stripNonContentMarkup(value)
      .replace(/\r\n?/g, "\n")
      .replace(/<\s*br\s*\/?\s*>/gi, "\n")
      .replace(BLOCK_TAGS, "\n")
      .replace(/<\/?span\b[^>]*>/gi, " ")
      .replace(/<[^>]*>/g, ""))
      .replace(/\u00A0/g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n[ \t]+/g, "\n")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\n{2,}/g, "\n")
      .trim();
  }

  function semanticMarkup(value) {
    const thinking = [];
    const withoutThinking = stripNonContentMarkup(value).replace(
      /<\s*think\b[^>]*>([\s\S]*?)<\s*\/\s*think\s*>/gi,
      (_, body) => {
        const text = visibleMarkupText(body);
        if (text) thinking.push(text);
        return "\n";
      }
    );
    return { text: visibleMarkupText(withoutThinking), thinking };
  }

  function contentParts(content) {
    if (typeof content === "string") return [{ value: content, type: "text" }];
    if (Array.isArray(content)) return content.map(part => {
      if (typeof part === "string") return { value: part, type: "text" };
      return {
        value: part?.text ?? part?.content ?? "",
        type: String(part?.type || part?.content_type || "text").toLowerCase()
      };
    });
    if (content && typeof content === "object") {
      return [{
        value: content.text ?? content.content ?? "",
        type: String(content.type || content.content_type || "text").toLowerCase()
      }];
    }
    return [];
  }

  function normalizeMufyContent(content) {
    const visible = [];
    const thinking = [];
    for (const part of contentParts(content)) {
      if (["think", "thinking", "reasoning"].includes(part.type)) {
        const text = visibleMarkupText(part.value);
        if (text) thinking.push(text);
        continue;
      }
      const semantic = semanticMarkup(part.value);
      if (semantic.text) visible.push(semantic.text);
      thinking.push(...semantic.thinking);
    }
    return {
      text: visible.join("\n").replace(/\n{2,}/g, "\n").trim(),
      thinking
    };
  }

  function sourceTime(value) {
    return value?.createdTime ?? value?.createdAt ?? value?.timestamp ?? null;
  }

  function lineForTitle(value) {
    const text = normalizeMufyContent(value).text.replace(/\s+/g, " ").trim();
    if (!text) return "";
    return text.length > 80 ? `${text.slice(0, 77).trimEnd()}…` : text;
  }

  function latestArchiveRemark(session) {
    const archives = (Array.isArray(session?.archives) ? session.archives : [])
      .filter(item => item && typeof item === "object" && String(item.remark || "").trim());
    const marked = archives.find(item => item.isCurrent === true || item.current === true || item.selected === true);
    if (marked) return lineForTitle(marked.remark);
    return archives
      .map((item, index) => ({ item, index, time: Date.parse(sourceTime(item) || "") }))
      .sort((a, b) => {
        const at = Number.isFinite(a.time) ? a.time : -Infinity;
        const bt = Number.isFinite(b.time) ? b.time : -Infinity;
        return bt - at || b.index - a.index;
      })
      .map(entry => lineForTitle(entry.item.remark))
      .find(Boolean) || "";
  }

  function sessionTitle(pack, session, index) {
    const explicit = lineForTitle(session?.title || session?.remark || session?.name || "");
    if (explicit) return explicit;
    const archiveRemark = latestArchiveRemark(session);
    if (archiveRemark) return archiveRemark;
    const firstAssistant = (session?.dialogs || []).find(dialog =>
      ["assistant", "ai", "bot", "model", "character"].includes(String(dialog?.role || "").toLowerCase())
    );
    const assistantLine = lineForTitle(firstAssistant?.content);
    if (assistantLine) return assistantLine;
    const name = lineForTitle(pack?.name) || "Mufy";
    if (session?.isCurrent === true) return `${name} · current conversation`;
    const time = sourceTime(session);
    if (time) {
      const date = new Date(time);
      if (!Number.isNaN(date.getTime())) return `${name} · ${date.toISOString().slice(0, 10)}`;
    }
    return `${name} conversation ${index + 1}`;
  }

  function isMufyPack(data) {
    if (!data || typeof data !== "object" || Array.isArray(data) || !Array.isArray(data.sessions)) return false;
    const rootIdentity = typeof data.name === "string" && ("characterId" in data || "archiveCount" in data || "greeting" in data);
    if (!rootIdentity) return false;
    if (!data.sessions.length) return true;
    return data.sessions.every(session => {
      if (!session || typeof session !== "object" || !Array.isArray(session.dialogs)) return false;
      if (!("sessionId" in session) && !("archives" in session) && !("isCurrent" in session)) return false;
      return session.dialogs.every(dialog => dialog && typeof dialog === "object" && "role" in dialog && "content" in dialog);
    });
  }

  function rawDataName(zip) {
    return zip.names.find(name => name === RAW_DATA_FILENAME || name.endsWith(`/${RAW_DATA_FILENAME}`));
  }

  async function probeZIP(zip) {
    const name = rawDataName(zip);
    if (!name) return null;
    const cached = zipProbeCache.get(zip);
    if (cached?.name === name) return cached;
    const data = await zip.readJSON(name);
    if (!isMufyPack(data)) return null;
    const probe = { name, data };
    zipProbeCache.set(zip, probe);
    return probe;
  }

  function convert(pack) {
    const conversations = (pack.sessions || []).map((session, index) => {
      const messages = [];
      if (index === 0 && pack.greeting != null && String(pack.greeting).trim()) {
        const greeting = normalizeMufyContent(pack.greeting);
        messages.push({
          id: "greeting",
          role: "assistant",
          speaker: pack.name || "Assistant",
          createdAt: sourceTime(pack),
          content: greeting.text,
          thinking: greeting.thinking,
          metadata: { original: pack.greeting, sourceField: "greeting" }
        });
      }
      for (const dialog of (session.dialogs || [])) {
        const semantic = normalizeMufyContent(dialog.content);
        const originalRole = dialog.role;
        messages.push({
          id: dialog.id || dialog.dialogsId || `${session.sessionId || index}-${messages.length}`,
          role: originalRole,
          speaker: ["user", "human", "me"].includes(String(originalRole || "").toLowerCase())
            ? "You"
            : (pack.name || "Assistant"),
          createdAt: sourceTime(dialog),
          content: semantic.text,
          thinking: semantic.thinking,
          metadata: { originalRole, original: dialog }
        });
      }
      return {
        id: session.sessionId || `mufy-session-${index}`,
        title: sessionTitle(pack, session, index),
        createdAt: sourceTime(session) || messages.find(message => message.createdAt != null)?.createdAt || null,
        updatedAt: session.updatedTime ?? session.updatedAt ?? null,
        context: {
          sourceMetadata: {
            characterId: pack.characterId ?? null,
            sessionId: session.sessionId ?? null,
            batchFrom: pack.batchFrom ?? null,
            totalSessions: pack.totalSessions ?? null,
            archives: session.archives || [],
            isCurrent: session.isCurrent ?? null,
            messageCount: session.messageCount ?? null,
            error: session.error ?? null,
            original: session
          }
        },
        participants: [
          { id: "user", name: "You", role: "user" },
          { id: pack.characterId || "assistant", name: pack.name || "Assistant", role: "assistant" }
        ],
        messages
      };
    });

    return OD.schema.archive({
      platform: "mufy",
      exporter: "mufy-batch-export",
      formatVersion: pack.version || null,
      exportedAt: pack.exportedAt || null,
      conversations
    });
  }

  OD.adapters.push({
    id: "mufy-raw",
    label: "Mufy raw export",
    capabilities: {
      contract: "our-dialogues.adapter-capabilities.v1",
      json: true,
      zip: true,
      folder: true,
      thinking: "extract-explicit-only",
      attachments: "none",
      sourceMarkup: "html-to-readable-text"
    },
    detectJSON: isMufyPack,
    parseJSON: convert,
    async detectZIP(zip) { return !!(await probeZIP(zip)); },
    async parseZIP(zip) {
      const probe = await probeZIP(zip);
      if (!probe) throw new Error("Mufy raw-data filename exists, but its schema is not a strict Mufy match.");
      return convert(probe.data);
    },
    _internals: { decodeEntities, visibleMarkupText, normalizeMufyContent, sessionTitle, isMufyPack }
  });
})();
