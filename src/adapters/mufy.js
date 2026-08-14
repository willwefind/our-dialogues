window.OD = window.OD || {};
OD.adapters = OD.adapters || [];

(function(){
  function textFromMufyContent(content) {
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return content?.text ? String(content.text) : "";
    return content.map(part => {
      if (typeof part === "string") return part;
      if (part?.type === "text") return part.text || "";
      return part?.text || "";
    }).filter(Boolean).join("\n");
  }

  function convert(pack) {
    const conversations = (pack.sessions || []).map((s, i) => {
      const dialogs = [];
      if (i === 0 && pack.greeting && String(pack.greeting).trim()) {
        dialogs.push({ id: "greeting", role: "assistant", speaker: pack.name || "Assistant", content: String(pack.greeting) });
      }
      for (const d of (s.dialogs || [])) {
        dialogs.push({
          id: d.id || `${s.sessionId || i}-${dialogs.length}`,
          role: d.role,
          speaker: d.role === "user" ? "You" : (pack.name || "Assistant"),
          createdAt: d.createdAt || d.timestamp || null,
          content: textFromMufyContent(d.content),
          metadata: { original: d }
        });
      }
      return {
        id: s.sessionId || `mufy-session-${i}`,
        title: s.title || `${pack.name || "Mufy"} · ${i + 1}`,
        createdAt: s.createdAt || null,
        updatedAt: s.updatedAt || null,
        context: { sourceMetadata: { archives: s.archives || [] } },
        messages: dialogs
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
    detectJSON(data) { return !!(data && Array.isArray(data.sessions) && ("name" in data || "greeting" in data)); },
    parseJSON(data) { return convert(data); },
    detectZIP(zip) { return zip.names.some(n => n === "_原始数据.json" || n.endsWith("/_原始数据.json")); },
    async parseZIP(zip) {
      const name = zip.names.find(n => n === "_原始数据.json" || n.endsWith("/_原始数据.json"));
      return convert(await zip.readJSON(name));
    }
  });
})();
