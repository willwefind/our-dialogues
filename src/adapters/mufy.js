window.OD = window.OD || {};
OD.adapters = OD.adapters || [];

(function(){
  const RAW_DATA_FILENAME = "_原始数据.json";
  const BLOCK_TAGS = /<\/?(?:address|article|aside|blockquote|dd|details|div|dl|dt|fieldset|figcaption|figure|footer|h[1-6]|header|hr|li|main|nav|ol|p|pre|section|summary|table|tbody|td|tfoot|th|thead|tr|ul)\b[^>]*>/gi;
  const BLOCK_NAMES = new Set(["address","article","aside","blockquote","dd","details","div","dl","dt","fieldset","figcaption","figure","footer","h1","h2","h3","h4","h5","h6","header","hr","li","main","nav","ol","p","pre","section","summary","table","tbody","td","tfoot","th","thead","tr","ul"]);
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

  function parseAttributes(source) {
    const attributes = {};
    const pattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
    let match;
    while ((match = pattern.exec(source || ""))) {
      attributes[String(match[1] || "").toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? "");
    }
    return attributes;
  }

  function parseMarkupTree(value) {
    const root = { type: "element", tag: "root", attributes: {}, children: [] };
    const stack = [root];
    const tokens = stripNonContentMarkup(value).match(/<[^>]*>|[^<]+/g) || [];
    for (const token of tokens) {
      if (!token.startsWith("<")) {
        stack.at(-1).children.push({ type: "text", value: token });
        continue;
      }
      if (/^<\s*\//.test(token)) {
        const closing = token.match(/^<\s*\/\s*([a-z0-9-]+)/i)?.[1]?.toLowerCase();
        if (!closing) continue;
        for (let index = stack.length - 1; index > 0; index -= 1) {
          if (stack[index].tag !== closing) continue;
          stack.length = index;
          break;
        }
        continue;
      }
      const opening = token.match(/^<\s*([a-z0-9-]+)([\s\S]*?)\/?\s*>$/i);
      if (!opening) continue;
      const tag = opening[1].toLowerCase();
      const node = { type: "element", tag, attributes: parseAttributes(opening[2]), children: [] };
      stack.at(-1).children.push(node);
      if (!/\/$/.test(opening[2].trim()) && !["br","hr","img","input","meta","link"].includes(tag)) stack.push(node);
    }
    return root;
  }

  function cleanText(value) {
    return String(value ?? "")
      .replace(/\u00A0/g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n[ \t]+/g, "\n")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\n{2,}/g, "\n")
      .trim();
  }

  function nodeText(node) {
    if (!node) return "";
    if (node.type === "text") return decodeEntities(node.value);
    if (node.tag === "br") return "\n";
    const text = (node.children || []).map(nodeText).join("");
    return BLOCK_NAMES.has(node.tag) && node.tag !== "root" ? `\n${text}\n` : text;
  }

  function classNames(node) {
    return new Set(String(node?.attributes?.class || "").split(/\s+/).filter(Boolean));
  }

  function hasClass(node, names) {
    const classes = classNames(node);
    return names.some(name => classes.has(name));
  }

  function descendants(node, predicate, output = []) {
    for (const child of (node?.children || [])) {
      if (child.type !== "element") continue;
      if (predicate(child)) output.push(child);
      descendants(child, predicate, output);
    }
    return output;
  }

  function firstDescendant(node, predicate) {
    return descendants(node, predicate, [])[0] || null;
  }

  function progressFromNode(node) {
    const bar = firstDescendant(node, child => hasClass(child, ["p-bar", "progress-bar"]));
    if (!bar) return null;
    const match = String(bar.attributes.style || "").match(/(?:^|;)\s*width\s*:\s*(-?\d+(?:\.\d+)?)\s*%/i);
    const rawValue = match ? Number(match[1]) : Number(bar.attributes["aria-valuenow"]);
    if (!Number.isFinite(rawValue)) return null;
    const value = Math.max(0, Math.min(100, rawValue));
    const container = firstDescendant(node, child => child.children?.includes(bar)) || node;
    const labelNode = firstDescendant(container, child => hasClass(child, ["fog-label", "wg-label", "f-label", "p-label"]));
    return { label: cleanText(nodeText(labelNode)) || "进度", value };
  }

  function rowFromNode(row) {
    const labelNode = firstDescendant(row, child => hasClass(child, ["fog-label", "wg-label", "f-label", "label"]));
    if (!labelNode) return null;
    const label = cleanText(nodeText(labelNode));
    const value = cleanText((row.children || []).filter(child => child !== labelNode).map(nodeText).join(""));
    return label && value ? { label, value } : null;
  }

  function richBlockFromNode(node) {
    const isFog = hasClass(node, ["fog-status-card"]);
    const isWG = hasClass(node, ["wg-box"]);
    const isDetails = node.tag === "details";
    if (!isFog && !isWG && !isDetails) return null;

    const summary = isDetails ? (node.children || []).find(child => child.type === "element" && child.tag === "summary") : null;
    const heading = summary || firstDescendant(node, child => ["h1","h2","h3","h4","summary"].includes(child.tag));
    const rowNodes = descendants(node, child => hasClass(child, ["fog-status-row", "wg-row", "f-row"]));
    const rows = rowNodes.map(rowFromNode).filter(Boolean);
    const commentNodes = descendants(node, child => hasClass(child, ["fog-comment-box", "wg-comment", "comment-box", "note", "f-note"]));
    const notes = commentNodes.map(item => cleanText(nodeText(item))).filter(Boolean);
    const progress = progressFromNode(node);
    const title = cleanText(nodeText(heading));
    let body = "";
    if (isDetails) {
      body = cleanText((node.children || []).filter(child => child !== summary).map(nodeText).join(""));
    } else if (!rows.length && !notes.length) {
      body = cleanText(nodeText(node));
    }
    const text = cleanText([title, ...rows.map(row => `${row.label} ${row.value}`), ...notes, body, progress ? `${progress.label} ${progress.value}%` : ""].filter(Boolean).join("\n"));
    return {
      type: "source-rich-block",
      source: "mufy",
      kind: isDetails ? "details" : "status-card",
      variant: isFog ? "fog" : (isWG ? "wg" : "details"),
      text,
      title,
      rows,
      notes,
      body,
      progress
    };
  }

  function hasRichDescendant(node) {
    return !!richBlockFromNode(node) || descendants(node, child => !!richBlockFromNode(child)).length > 0;
  }

  function richContentMarkup(value) {
    const root = parseMarkupTree(value);
    const content = [];
    let textBuffer = "";
    const flush = () => {
      const text = cleanText(textBuffer);
      if (text) content.push({ type: "text", text });
      textBuffer = "";
    };
    const collect = node => {
      const block = node.type === "element" ? richBlockFromNode(node) : null;
      if (block) {
        flush();
        content.push(block);
        return;
      }
      if (node.type === "text") {
        textBuffer += decodeEntities(node.value);
        return;
      }
      if (!hasRichDescendant(node)) {
        textBuffer += nodeText(node);
        return;
      }
      for (const child of (node.children || [])) collect(child);
    };
    for (const child of root.children) collect(child);
    flush();
    if (!content.length) {
      const text = visibleMarkupText(value);
      if (text) content.push({ type: "text", text });
    }
    return content;
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
    const content = richContentMarkup(withoutThinking);
    return {
      content,
      text: content.map(item => item.text || "").filter(Boolean).join("\n").replace(/\n{3,}/g, "\n\n").trim(),
      thinking
    };
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
      visible.push(...semantic.content);
      thinking.push(...semantic.thinking);
    }
    return {
      content: visible,
      text: visible.map(item => item.text || "").filter(Boolean).join("\n").replace(/\n{3,}/g, "\n\n").trim(),
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

  function sessionTitleInfo(pack, session, index) {
    const archiveRemark = latestArchiveRemark(session);
    if (archiveRemark) return { title: archiveRemark, source: "archive-remark" };
    const name = lineForTitle(pack?.name) || "Mufy";
    if (session?.isCurrent === true) return { title: `${name} · current conversation`, source: "current-marker" };
    const firstAssistant = (session?.dialogs || []).find(dialog =>
      ["assistant", "ai", "bot", "model", "character"].includes(String(dialog?.role || "").toLowerCase())
    );
    const assistantLine = lineForTitle(firstAssistant?.content);
    if (assistantLine) return { title: assistantLine, source: "assistant-text" };
    const time = sourceTime(session);
    if (time) {
      const date = new Date(time);
      if (!Number.isNaN(date.getTime())) return { title: `${name} · ${date.toISOString().slice(0, 10)}`, source: "date-fallback" };
    }
    return { title: `${name} conversation ${index + 1}`, source: "generic-fallback" };
  }

  function sessionTitle(pack, session, index) {
    return sessionTitleInfo(pack, session, index).title;
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
      const titleInfo = sessionTitleInfo(pack, session, index);
      const messages = [];
      if (index === 0 && pack.greeting != null && String(pack.greeting).trim()) {
        const greeting = normalizeMufyContent(pack.greeting);
        messages.push({
          id: "greeting",
          role: "assistant",
          speaker: pack.name || "Assistant",
          createdAt: sourceTime(pack),
          content: greeting.content,
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
          content: semantic.content,
          thinking: semantic.thinking,
          metadata: { originalRole, original: dialog }
        });
      }
      return {
        id: session.sessionId || `mufy-session-${index}`,
        title: titleInfo.title,
        createdAt: sourceTime(session) || messages.find(message => message.createdAt != null)?.createdAt || null,
        updatedAt: session.updatedTime ?? session.updatedAt ?? null,
        context: {
          sourceMetadata: {
            characterId: pack.characterId ?? null,
            characterName: pack.name ?? null,
            titleSource: titleInfo.source,
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
      sourceMarkup: "html-to-safe-rich-blocks"
    },
    detectJSON: isMufyPack,
    parseJSON: convert,
    async detectZIP(zip) { return !!(await probeZIP(zip)); },
    async parseZIP(zip) {
      const probe = await probeZIP(zip);
      if (!probe) throw new Error("Mufy raw-data filename exists, but its schema is not a strict Mufy match.");
      return convert(probe.data);
    },
    _internals: {
      decodeEntities,
      visibleMarkupText,
      normalizeMufyContent,
      parseMarkupTree,
      richContentMarkup,
      richBlockFromNode,
      sessionTitle,
      sessionTitleInfo,
      isMufyPack
    }
  });
})();
