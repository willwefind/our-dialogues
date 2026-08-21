window.OD = window.OD || {};

/*
  Minimal EPUB 3 builder: one chapter per conversation, reading-surface only
  (same boundary as Markdown export — excluded thinking/tool traces become a
  visible counts note, never a silent drop). Native e-reader TOC, bookmarks,
  and progress come free once the archive is a real book.
*/
(function(OD){
  function escapeXML(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[character]);
  }

  function textOf(content) {
    if (typeof content === "string") return content;
    return OD.schema.textOf(content);
  }

  function paragraphs(text) {
    return String(text).split(/\n{2,}/).map(block =>
      `<p>${escapeXML(block).replace(/\n/g, "<br/>")}</p>`
    ).join("\n");
  }

  function chapterXHTML(conversation, { sourceLabel = "" } = {}) {
    const title = escapeXML(conversation.title || conversation.id || "对话");
    const meta = [
      sourceLabel ? escapeXML(sourceLabel) : "",
      conversation.createdAt ? escapeXML(conversation.createdAt) : "",
      `${(conversation.messages || []).length} 条`
    ].filter(Boolean).join(" · ");
    let hiddenThinking = 0;
    let hiddenTrace = 0;
    const body = [];
    for (const message of conversation.messages || []) {
      if (textOf(message.thinking)) hiddenThinking += 1;
      if (message.metadata?.sourceTrace?.length) hiddenTrace += 1;
      const speaker = escapeXML(message.speaker || message.role || "");
      const time = message.createdAt ? ` · ${escapeXML(message.createdAt)}` : "";
      const text = textOf(message.content);
      const attachments = (message.attachments || [])
        .map(attachment => `<p class="attachment">[附件：${escapeXML(attachment?.name || "未命名文件")}]</p>`)
        .join("\n");
      body.push(`<div class="msg ${message.role === "user" ? "user" : "assistant"}">
<p class="who">${speaker}${time}</p>
${text ? paragraphs(text) : ""}
${attachments}
</div>`);
    }
    const hiddenNote = (hiddenThinking || hiddenTrace)
      ? `<p class="hidden-note">未包含在本书中：${[
          hiddenThinking ? `思考 ${hiddenThinking} 条` : "",
          hiddenTrace ? `工具轨迹 ${hiddenTrace} 条` : ""
        ].filter(Boolean).join(" · ")}（仍保留在原始导出与阅读器中）</p>`
      : "";
    return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="zh-CN" lang="zh-CN">
<head><title>${title}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body>
<section>
<h1>${title}</h1>
${meta ? `<p class="meta">${meta}</p>` : ""}
${hiddenNote}
${body.join("\n")}
</section>
</body>
</html>`;
  }

  const STYLE = `body{font-family:serif;line-height:1.9}
h1{font-size:1.3em;font-weight:600}
.meta,.hidden-note,.who,.attachment{color:#666;font-size:.82em}
.who{margin-bottom:.2em;letter-spacing:.06em}
.msg{margin:1.3em 0}
.msg.user p{color:#444}
.msg.user{border-left:2px solid #ccc;padding-left:.8em}`;

  function buildEpub({ title = "Our Dialogues", conversations = [], sourceLabelOf, identifier, modified } = {}) {
    const chapters = conversations.map((conversation, index) => ({
      id: `chapter-${index + 1}`,
      file: `chapter-${index + 1}.xhtml`,
      title: String(conversation.title || conversation.id || `对话 ${index + 1}`),
      xhtml: chapterXHTML(conversation, { sourceLabel: sourceLabelOf?.(conversation) || "" })
    }));
    const bookId = identifier || `urn:our-dialogues:${Date.now().toString(36)}`;
    const stamp = modified || new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
    const nav = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="zh-CN" lang="zh-CN">
<head><title>目录</title></head>
<body>
<nav epub:type="toc"><h1>目录</h1><ol>
${chapters.map(chapter => `<li><a href="${chapter.file}">${escapeXML(chapter.title)}</a></li>`).join("\n")}
</ol></nav>
</body>
</html>`;
    const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" xml:lang="zh-CN">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="book-id">${escapeXML(bookId)}</dc:identifier>
<dc:title>${escapeXML(title)}</dc:title>
<dc:language>zh-CN</dc:language>
<meta property="dcterms:modified">${escapeXML(stamp)}</meta>
</metadata>
<manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="style" href="style.css" media-type="text/css"/>
${chapters.map(chapter => `<item id="${chapter.id}" href="${chapter.file}" media-type="application/xhtml+xml"/>`).join("\n")}
</manifest>
<spine>
${chapters.map(chapter => `<itemref idref="${chapter.id}"/>`).join("\n")}
</spine>
</package>`;
    const container = `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`;

    const entries = [
      { name: "mimetype", data: "application/epub+zip" },
      { name: "META-INF/container.xml", data: container },
      { name: "OEBPS/content.opf", data: opf },
      { name: "OEBPS/nav.xhtml", data: nav },
      { name: "OEBPS/style.css", data: STYLE },
      ...chapters.map(chapter => ({ name: `OEBPS/${chapter.file}`, data: chapter.xhtml }))
    ];
    return OD.zipWriter.createZip(entries);
  }

  OD.epub = { buildEpub, _internals: { chapterXHTML, escapeXML } };
})(window.OD);
