window.OD = window.OD || {};
OD.adapters = OD.adapters || [];

OD.adapters.push({
  id: "normalized-v1",
  label: "Our Dialogues normalized v1",
  capabilities: {
    contract: "our-dialogues.adapter-capabilities.v1",
    json: true,
    zip: false,
    folder: false,
    thinking: "preserve",
    attachments: "preserve",
    sourceMarkup: "normalized-text"
  },
  detectJSON(data) {
    return data?.schema === "our-dialogues.normalized.v1";
  },
  parseJSON(data) {
    return OD.schema.archive({
      platform: data?.source?.platform || "unknown",
      exporter: data?.source?.exporter || "normalized",
      formatVersion: data?.source?.formatVersion ?? 1,
      exportedAt: data?.exportedAt ?? null,
      conversations: data?.conversations || []
    });
  }
});
