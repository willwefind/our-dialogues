window.OD = window.OD || {};
OD.adapters = OD.adapters || [];

(function(){
  function convert(root, manifest = null) {
    const source = manifest || root;
    const conversations = (root.conversations || []).map((c, i) => ({
      id: c.id || `ciel-${i}`,
      title: c.title || c.room?.name || `Conversation ${i + 1}`,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      context: { room: c.room || null, sourceMetadata: c.metadata || {} },
      participants: c.participants || [],
      messages: (c.messages || []).map((m, j) => ({
        id: m.id || `${c.id || i}-m${j}`,
        role: m.role,
        speaker: m.speaker || m.name || m.role,
        createdAt: m.createdAt,
        content: m.content ?? m.text ?? "",
        thinking: m.thinking || [],
        attachments: m.attachments || [],
        metadata: m.metadata || {}
      }))
    }));

    return OD.schema.archive({
      platform: "ciel-house",
      exporter: "ciel-house",
      formatVersion: source.version ?? 1,
      exportedAt: source.exportedAt ?? null,
      conversations
    });
  }

  OD.adapters.push({
    id: "ciel-house-v1",
    label: "Ciel House Export v1",
    detectJSON(data) {
      return data?.format === "ciel-house-export" && Number(data?.version) === 1;
    },
    parseJSON(data) { return convert(data); },
    detectZIP(zip) { return zip.has("manifest.json") && zip.has("conversations.json"); },
    async parseZIP(zip) {
      const manifest = await zip.readJSON("manifest.json");
      if (manifest?.format !== "ciel-house-export" || Number(manifest?.version) !== 1) {
        throw new Error("找到 manifest.json，但它不是 Ciel House Export v1。");
      }
      const dataFile = manifest.dataFile || "conversations.json";
      return convert(await zip.readJSON(dataFile), manifest);
    }
  });
})();
