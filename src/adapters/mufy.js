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

  function hasClassPattern(node, pattern) {
    return [...classNames(node)].some(name => pattern.test(name));
  }

  function safeVariant(value) {
    const normalized = String(value || "generic").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
    return normalized || "generic";
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

  function topLevelDescendants(node, predicate, output = []) {
    for (const child of (node?.children || [])) {
      if (child.type !== "element") continue;
      if (predicate(child)) output.push(child);
      else topLevelDescendants(child, predicate, output);
    }
    return output;
  }

  function directElementChildren(node) {
    return (node?.children || []).filter(child => child.type === "element");
  }

  function textOfNode(node) {
    return cleanText(nodeText(node));
  }

  function firstText(node, predicate) {
    return textOfNode(firstDescendant(node, predicate));
  }

  function uniqueText(items) {
    const seen = new Set();
    return items.map(cleanText).filter(item => item && !seen.has(item) && seen.add(item));
  }

  const LABEL_CLASSES = [
    "fog-label", "wg-label", "f-label", "p-label", "label", "xs-lbl",
    "task-label-v1", "nb-label", "status-label", "meta-label", "k", "gl", "L"
  ];
  const VALUE_CLASSES = [
    "fog-value", "wg-value", "f-value", "value", "xs-val", "task-value-v1",
    "nb-value", "status-value", "meta-value", "v", "gv", "V"
  ];
  const ROW_CLASSES = [
    "fog-status-row", "wg-row", "f-row", "xs-row-item", "task-row-v1",
    "nb-row", "status-row", "meta-row", "R", "i", "h"
  ];
  const NOTE_CLASSES = [
    "fog-comment-box", "wg-comment", "comment-box", "note", "f-note",
    "xs-note-section", "xs-quote-block", "task-desc-box-v1", "status-note"
  ];
  const TITLE_CLASSES = [
    "xs-status-summary", "zc-chapter-head", "censy-main-title-en", "task-title-main-v1",
    "nb-folder-title", "forum-title", "post-title", "thread-title", "section-title"
  ];

  function classFamily(node) {
    const names = [...classNames(node)].map(name => name.toLowerCase());
    for (const family of ["zc", "xs", "censy", "nb", "zero", "mufy", "fog", "wg", "forum", "post", "thread", "task"]) {
      if (names.some(name => name === family || name.startsWith(`${family}-`))) return family;
    }
    if (names.some(name => ["h", "b", "d", "s"].includes(name))) return "compact";
    return "generic";
  }

  function isLabelNode(node) {
    return hasClass(node, LABEL_CLASSES) || hasClassPattern(node, /(?:^|[-_])(label|lbl|key)(?:$|[-_])/i);
  }

  function isValueNode(node) {
    return hasClass(node, VALUE_CLASSES) || hasClassPattern(node, /(?:^|[-_])(value|val)(?:$|[-_])/i);
  }

  function isRowNode(node) {
    return hasClass(node, ROW_CLASSES) || hasClassPattern(node, /(?:^|[-_])(?:status|meta|task|info)[-_]row(?:$|[-_])/i);
  }

  function progressFromNode(node) {
    const bar = firstDescendant(node, child => hasClass(child, ["p-bar", "progress-bar", "censy-progress-fill"])
      || hasClassPattern(child, /(?:^|[-_])progress[-_](?:bar|fill)(?:$|[-_])/i));
    if (!bar) return null;
    const match = String(bar.attributes.style || "").match(/(?:^|;)\s*width\s*:\s*(-?\d+(?:\.\d+)?)\s*%/i);
    const rawValue = match ? Number(match[1]) : Number(bar.attributes["aria-valuenow"]);
    if (!Number.isFinite(rawValue)) return null;
    const value = Math.max(0, Math.min(100, rawValue));
    const container = firstDescendant(node, child => child.children?.includes(bar)) || node;
    const labelNode = firstDescendant(container, isLabelNode)
      || firstDescendant(node, child => hasClass(child, ["censy-progress-ps"]));
    return { label: cleanText(nodeText(labelNode)) || "进度", value };
  }

  function rowFromNode(row) {
    const labelNode = firstDescendant(row, isLabelNode);
    if (!labelNode) return null;
    const valueNode = firstDescendant(row, child => child !== labelNode && isValueNode(child));
    const label = cleanText(nodeText(labelNode));
    const value = valueNode
      ? cleanText(nodeText(valueNode))
      : cleanText((row.children || []).filter(child => child !== labelNode).map(nodeText).join(""));
    return label && value ? { label, value } : null;
  }

  function rowsFromNode(node) {
    const rows = descendants(node, isRowNode).map(rowFromNode).filter(Boolean);
    const seen = new Set();
    return rows.filter(row => {
      const key = `${row.label}\u0000${row.value}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function sectionsFromNode(node) {
    const sections = [];
    const labels = descendants(node, child => hasClass(child, ["censy-sub-title", "xs-note-title"])
      || hasClassPattern(child, /(?:^|[-_])sub[-_]title(?:$|[-_])/i));
    for (const labelNode of labels) {
      const parent = directElementChildren(node).includes(labelNode)
        ? node
        : descendants(node, child => directElementChildren(child).includes(labelNode))[0];
      const siblings = directElementChildren(parent);
      const valueNode = siblings[siblings.indexOf(labelNode) + 1] || null;
      const label = textOfNode(labelNode);
      const value = textOfNode(valueNode);
      if (label && value) sections.push({ label, value });
    }
    return sections;
  }

  function listItemsFromNode(node) {
    const candidates = topLevelDescendants(node, child => hasClass(child, [
      "xs-list-item", "task-obj-item-v1", "thread-item", "reply-item", "post-item", "mission",
      "censy-msg-row", "censy-bk-item", "task-reward-v1"
    ]) || hasClassPattern(child, /(?:^|[-_])(?:objective|list|thread|reply|post|message|msg)[-_]item(?:$|[-_])/i));
    return uniqueText(candidates.map(textOfNode)).map(text => ({ text }));
  }

  function noteTexts(node) {
    return uniqueText(topLevelDescendants(node, child => hasClass(child, NOTE_CLASSES)
      || hasClassPattern(child, /(?:^|[-_])(?:comment|note|quote|description|desc)[-_](?:box|section|text|content)(?:$|[-_])/i))
      .map(textOfNode));
  }

  function titleText(node, summary = null) {
    return textOfNode(summary)
      || firstText(node, child => hasClass(child, TITLE_CLASSES))
      || firstText(node, child => ["h1", "h2", "h3", "h4"].includes(child.tag))
      || firstText(node, child => hasClassPattern(child, /(?:^|[-_])(?:main[-_])?(?:title|heading|header|head)(?:$|[-_])/i));
  }

  function structuralTemplate(node) {
    if (hasClass(node, ["zc-status-wrapper", "zc-status-box"])) return { kind: "scene-heading", variant: "zc" };
    if (hasClass(node, ["censy-hud-top"])) return { kind: "hud", variant: "censy" };
    if (hasClass(node, ["censy-dashboard-wrapper"])) return { kind: "dashboard", variant: "censy" };
    if (hasClass(node, ["task-card-v1-container"])) return { kind: "task-card", variant: "task" };
    if (hasClass(node, ["forum-container"])) return { kind: "forum", variant: "forum" };
    if (hasClass(node, ["nb-folder"])) return { kind: "folder-panel", variant: "nb" };
    if (hasClass(node, ["xs-status-container"])) return { kind: "details", variant: "xs" };
    if (hasClass(node, ["fog-status-card"])) return { kind: "status-card", variant: "fog" };
    if (hasClass(node, ["wg-box"])) return { kind: "status-card", variant: "wg" };
    if (node.tag === "details") return { kind: "details", variant: classFamily(node) === "generic" ? "details" : classFamily(node) };

    const isNamedContainer = hasClassPattern(node,
      /(?:^|[-_])(?:status|dashboard|hud|scene|info)[-_](?:container|wrapper|box|card|panel)(?:$|[-_])/i)
      || hasClassPattern(node, /(?:^|[-_])(?:folder|forum)[-_](?:container|wrapper|box|panel)(?:$|[-_])/i);
    if (!isNamedContainer) return null;
    const family = classFamily(node);
    const isHeading = hasClassPattern(node, /(?:^|[-_])scene[-_](?:heading|header|title)(?:$|[-_])/i);
    return { kind: isHeading ? "scene-heading" : "status-card", variant: family };
  }

  function richBlockFromNode(node) {
    const template = structuralTemplate(node);
    if (!template) return null;
    const summary = node.tag === "details"
      ? directElementChildren(node).find(child => child.tag === "summary") || null
      : null;
    const rows = rowsFromNode(node);
    if (template.kind === "hud") {
      const location = firstText(node, child => hasClass(child, ["censy-location-scroll", "location", "scene-location"]));
      const characters = firstText(node, child => hasClass(child, ["censy-char-list", "character-list"]));
      if (location) rows.push({ label: "地点", value: location });
      if (characters) rows.push({ label: "人物", value: characters });
    }
    const notes = noteTexts(node);
    const sections = sectionsFromNode(node);
    const items = listItemsFromNode(node);
    const progress = progressFromNode(node);
    const title = template.kind === "scene-heading" && template.variant === "zc"
      ? firstText(node, child => hasClass(child, ["zc-chapter-head"]))
      : (template.kind === "hud"
          ? firstText(node, child => hasClass(child, ["censy-time-main", "hud-title"]))
          : titleText(node, summary));
    const eyebrow = template.kind === "scene-heading"
      ? firstText(node, child => hasClass(child, ["zc-meta-info", "scene-meta", "scene-eyebrow"]))
      : "";
    const subtitle = template.kind === "scene-heading"
      ? firstText(node, child => hasClass(child, ["zc-chapter-sub", "scene-subtitle"]))
      : (template.kind === "hud" ? firstText(node, child => hasClass(child, ["censy-day-abbrev", "hud-subtitle"])) : "");
    let body = "";
    if (template.kind === "folder-panel" && !rows.length && !notes.length && !sections.length && !items.length) {
      body = firstText(node, child => hasClass(child, ["nb-folder-content", "folder-content"]));
    } else if (template.kind === "details" && !rows.length && !notes.length && !sections.length && !items.length) {
      body = cleanText((node.children || []).filter(child => child !== summary).map(nodeText).join(""));
    } else if (!["scene-heading", "hud"].includes(template.kind)
      && !rows.length && !notes.length && !sections.length && !items.length) {
      body = cleanText(nodeText(node));
    }
    const text = cleanText([
      eyebrow, title, subtitle,
      ...rows.map(row => `${row.label} ${row.value}`),
      ...sections.map(section => `${section.label} ${section.value}`),
      ...notes, ...items.map(item => item.text), body,
      progress ? `${progress.label} ${progress.value}%` : ""
    ].filter(Boolean).join("\n"));
    if (!text) return null;
    return {
      type: "source-rich-block",
      source: "mufy",
      kind: template.kind,
      variant: safeVariant(template.variant),
      text,
      eyebrow,
      title,
      subtitle,
      rows,
      sections,
      notes,
      items,
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

  function sessionTitleInfo(pack, session, index) {
    const messages = (session?.dialogs || []).map((dialog, dialogIndex) => {
      const semantic = normalizeMufyContent(dialog?.content);
      return {
        id: dialog?.id || dialog?.dialogsId || `${session?.sessionId || index}-${dialogIndex}`,
        role: dialog?.role,
        content: semantic.content,
        thinking: semantic.thinking,
        metadata: { originalRole: dialog?.role }
      };
    });
    const titleInfo = OD.mufyTitleResolver.resolve({ pack, session, index, messages });
    return { title: titleInfo.title, source: titleInfo.titleSource };
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
      const titleInfo = OD.mufyTitleResolver.resolve({
        pack,
        session,
        index,
        messages: messages.filter(message => message.metadata?.sourceField !== "greeting")
      });
      return {
        id: session.sessionId || `mufy-session-${index}`,
        title: titleInfo.title,
        createdAt: sourceTime(session) || messages.find(message => message.createdAt != null)?.createdAt || null,
        updatedAt: session.updatedTime ?? session.updatedAt ?? null,
        context: {
          sourceMetadata: {
            characterId: pack.characterId ?? null,
            characterName: pack.name ?? null,
            titleSource: titleInfo.titleSource,
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
        metadata: { titleSource: titleInfo.titleSource },
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
