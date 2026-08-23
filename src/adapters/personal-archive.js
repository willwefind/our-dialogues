/* Personal Archive v1 adapter (docs/personal-archive-v1.md).
   Converts `our-dialogues.personal-archive.v1` — already-existing personal
   writing (diaries, dreams, microblog posts, essays, letters, fragments) —
   into the unchanged normalized v1 contract: one entry becomes one
   conversation with a single `role: "other"` body message, and everything
   collection/entry-specific rides under context.sourceMetadata with the
   explicit `contentKind: "personal-document"` marker.

   Absolute rule: entry text is archival source text and is carried
   byte-for-byte. Titles are picked conservatively with provenance
   (original → markdown heading → date → first-line excerpt → 无题) and
   dates are never invented. Detection is strict schema equality — this
   adapter never guesses at unrelated JSON. */
window.OD = window.OD || {};
window.OD.adapters = window.OD.adapters || [];

(function (OD) {
  const SCHEMA = "our-dialogues.personal-archive.v1";
  const TYPES = ["diary", "dream", "essay", "microblog", "note", "letter", "fragment", "other"];
  const EXCERPT_LENGTH = 24;

  function normalizeType(value) {
    const raw = String(value ?? "").trim();
    return TYPES.includes(raw) ? raw : "other";
  }

  function untitledLabel() {
    return OD.i18n?.t?.("personal.untitled") || "无题";
  }

  /* Title chain per the contract; the body text itself is never altered.
     The date title comes from the entry's original createdAt string, so a
     date-only source day never shifts through timezone parsing. */
  function pickTitle(entry) {
    const original = entry.title == null ? "" : String(entry.title).trim();
    if (original) return { title: original, titleSource: "original" };
    const text = String(entry.text ?? "");
    const firstLine = (text.split("\n").find(line => line.trim() !== "") || "").trim();
    const heading = firstLine.match(/^#\s+(.+)$/);
    if (heading && heading[1].trim()) return { title: heading[1].trim(), titleSource: "heading" };
    const day = String(entry.createdAt ?? "").slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(day)) return { title: day, titleSource: "date" };
    if (firstLine) {
      const characters = Array.from(firstLine);
      const title = characters.length > EXCERPT_LENGTH
        ? `${characters.slice(0, EXCERPT_LENGTH).join("")}…`
        : firstLine;
      return { title, titleSource: "first-line" };
    }
    return { title: untitledLabel(), titleSource: "fallback" };
  }

  function convertEntry(author, collection, documentType, entry) {
    const conversationId = `personal:${collection.id}:${entry.id}`;
    const { title, titleSource } = pickTitle(entry);
    const sourceMetadata = {
      contentKind: "personal-document",
      collectionId: String(collection.id),
      collectionName: String(collection.name),
      documentType,
      titleSource
    };
    if (collection.type != null && documentType !== String(collection.type)) {
      sourceMetadata.documentTypeOriginal = String(collection.type);
    }
    if (author.id) sourceMetadata.authorId = author.id;
    if (author.name) sourceMetadata.authorName = author.name;
    if (Array.isArray(entry.tags) && entry.tags.length) {
      sourceMetadata.entryTags = entry.tags.map(tag => String(tag));
    }
    if (entry.metadata && typeof entry.metadata === "object" && Object.keys(entry.metadata).length) {
      sourceMetadata.entryMetadata = entry.metadata;
    }
    return {
      id: conversationId,
      title,
      createdAt: entry.createdAt ?? null,
      updatedAt: entry.updatedAt ?? null,
      context: { room: null, sourceMetadata },
      participants: [{ id: author.id || "author", name: author.name || "", role: "other" }],
      messages: [{
        id: `${conversationId}:body`,
        role: "other",
        speaker: author.name || "",
        createdAt: entry.createdAt ?? null,
        content: [{ type: "text", text: String(entry.text) }],
        metadata: { personalDocument: true }
      }]
    };
  }

  function convert(data) {
    const info = data?.archive && typeof data.archive === "object" ? data.archive : {};
    const author = {
      id: info.author?.id == null ? "" : String(info.author.id),
      name: info.author?.name == null ? "" : String(info.author.name)
    };
    /* Counts only — diagnostics never carry body text, titles, or paths. */
    const stats = {
      collections: 0,
      entries: 0,
      datedEntries: 0,
      undatedEntries: 0,
      skippedCollections: 0,
      skippedEntries: 0,
      types: {}
    };
    const conversations = [];
    for (const collection of Array.isArray(data?.collections) ? data.collections : []) {
      if (!collection || typeof collection !== "object" ||
          !collection.id || typeof collection.id !== "string" ||
          !collection.name || typeof collection.name !== "string" ||
          !Array.isArray(collection.entries)) {
        stats.skippedCollections += 1;
        continue;
      }
      stats.collections += 1;
      const documentType = normalizeType(collection.type);
      stats.types[documentType] = (stats.types[documentType] || 0) + 1;
      for (const entry of collection.entries) {
        if (!entry || typeof entry !== "object" ||
            !entry.id || typeof entry.id !== "string" ||
            typeof entry.text !== "string" || entry.text === "") {
          stats.skippedEntries += 1;
          continue;
        }
        stats.entries += 1;
        if (entry.createdAt) stats.datedEntries += 1;
        else stats.undatedEntries += 1;
        conversations.push(convertEntry(author, collection, documentType, entry));
      }
    }
    const archive = OD.schema.archive({
      platform: "personal-archive",
      exporter: "our-dialogues-personal-archive",
      formatVersion: 1,
      exportedAt: data?.exportedAt ?? null,
      conversations
    });
    /* Adapter-owned decoration after normalization: the archive's own name
       becomes the visible source label, and counts-only import stats ride
       along for the status line and diagnostics. */
    if (info.name) archive.source.sourceLabel = String(info.name);
    if (info.id) archive.source.archiveId = String(info.id);
    archive.source.personalImport = stats;
    return archive;
  }

  OD.adapters.push({
    id: "personal-archive-v1",
    label: "Personal Archive v1",
    capabilities: {
      contract: "our-dialogues.adapter-capabilities.v1",
      json: true,
      zip: false,
      folder: false,
      thinking: "none",
      attachments: "text-first-v1",
      sourceMarkup: "personal-document"
    },
    detectJSON(data) {
      return data?.schema === SCHEMA;
    },
    parseJSON(data) {
      return convert(data);
    }
  });
})(window.OD);
