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

  /* Personal documents export as pages, not transcripts: no speaker lines,
     a quiet collection · author byline under the title. Gated on the same
     explicit contentKind marker the Reader uses; chats are untouched.
     Returns null for ordinary conversations, the byline string (possibly
     empty) for personal documents. */
  function documentByline(conversation) {
    const sourceMetadata = conversation?.context?.sourceMetadata;
    if (sourceMetadata?.contentKind !== "personal-document") return null;
    return [sourceMetadata.collectionName, sourceMetadata.authorName]
      .filter(Boolean).map(String).join(" · ");
  }

  function conversationToMarkdown(conversation, { sourceLabel = "" } = {}) {
    const byline = documentByline(conversation);
    const lines = [];
    lines.push(`# ${String(conversation.title || conversation.id || "对话")}`);
    lines.push("");
    if (byline !== null) {
      if (byline) lines.push(`*${byline}*`, "");
    } else {
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
    }
    for (const message of conversation.messages || []) {
      if (byline === null) {
        const speaker = message.speaker || message.role || "";
        const time = message.createdAt ? ` · ${message.createdAt}` : "";
        lines.push(`**${speaker}**${time}`, "");
      }
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

  function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[character]);
  }

  function htmlParagraphs(text) {
    return String(text).split(/\n{2,}/).map(block =>
      `<p>${escapeHTML(block).replace(/\n/g, "<br>")}</p>`
    ).join("\n");
  }

  /* One self-contained HTML file — readable anywhere, no installs, offline. */
  function conversationsToHTML(conversations, { title = "Our Dialogues", sourceLabelOf } = {}) {
    const list = conversations || [];
    const toc = list.length > 1
      ? `<nav class="toc"><h2>目录</h2><ol>${list.map((conversation, index) =>
          `<li><a href="#c${index + 1}">${escapeHTML(conversation.title || conversation.id || `对话 ${index + 1}`)}</a></li>`
        ).join("")}</ol></nav>`
      : "";
    const sections = list.map((conversation, index) => {
      const hidden = countHidden(conversation);
      const hiddenNote = (hidden.thinking || hidden.trace)
        ? `<p class="hidden-note">未包含在本文件中：${[
            hidden.thinking ? `思考 ${hidden.thinking} 条` : "",
            hidden.trace ? `工具轨迹 ${hidden.trace} 条` : ""
          ].filter(Boolean).join(" · ")}（仍保留在原始导出与阅读器中）</p>`
        : "";
      const byline = documentByline(conversation);
      const meta = byline !== null
        ? escapeHTML(byline)
        : [
            sourceLabelOf?.(conversation) || "",
            conversation.createdAt || "",
            `${(conversation.messages || []).length} 条`
          ].filter(Boolean).map(escapeHTML).join(" · ");
      const messages = (conversation.messages || []).map(message => {
        const speaker = escapeHTML(message.speaker || message.role || "");
        const time = message.createdAt ? ` · ${escapeHTML(message.createdAt)}` : "";
        const body = textOf(message.content);
        const attachments = (message.attachments || [])
          .map(attachment => `<p class="attachment">[附件：${escapeHTML(attachment?.name || "未命名文件")}]</p>`)
          .join("");
        return `<div class="msg ${byline !== null ? "document" : (message.role === "user" ? "user" : "assistant")}">
${byline !== null ? "" : `<p class="who">${speaker}${time}</p>\n`}${body ? htmlParagraphs(body) : ""}${attachments}
</div>`;
      }).join("\n");
      return `<section id="c${index + 1}">
<h1>${escapeHTML(conversation.title || conversation.id || "对话")}</h1>
${meta ? `<p class="meta">${meta}</p>` : ""}
${hiddenNote}
${messages}
</section>`;
    }).join("\n<hr>\n");
    return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHTML(title)}</title>
<style>
body{max-width:760px;margin:0 auto;padding:28px 20px 80px;background:#f7f5f0;color:#221f1b;
font-family:ui-serif,"Noto Serif SC","Source Han Serif SC","Songti SC",serif;line-height:1.9}
h1{font-size:1.25em;font-weight:600}
.toc{border:1px solid #ddd6c8;border-radius:10px;padding:12px 18px;background:#fbf9f5}
.toc h2{font-size:.95em;margin:0 0 6px}
.toc ol{margin:0;padding-left:1.4em}
.toc a{color:#8a5a1d;text-decoration:none}
.meta,.hidden-note,.who,.attachment{color:#6d675d;font-size:.82em}
.who{margin-bottom:.2em;letter-spacing:.06em}
.msg{margin:1.3em 0}
.msg.user{border-left:2px solid #d8d0c0;padding-left:.9em}
.msg.user p{color:#4c463d}
hr{border:0;border-top:1px solid #ddd6c8;margin:2.2em 0}
</style>
</head>
<body>
${toc}
${sections}
<footer class="meta"><p>由 Our Dialogues 在本地生成；文件未经过任何服务器。</p></footer>
</body>
</html>
`;
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
    conversationsToHTML,
    conversationToJSON,
    conversationsToJSONL,
    safeFilename,
    _internals: { countHidden, escapeHTML }
  };
})(window.OD);
