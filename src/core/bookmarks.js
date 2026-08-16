window.OD = window.OD || {};

/*
  Multiple reading bookmarks. Each bookmark anchors to stable identity —
  sourceId + conversationId + messageId — never to a list index or DOM offset,
  so re-imports, re-sorts, and re-renders cannot move it. The list is kept
  newest-first; saving the same conversation + message again refreshes that
  bookmark instead of stacking duplicates.
*/
(function(OD){
  const LABEL_MAX = 120;
  const SNIPPET_MAX = 80;
  let counter = 0;

  function cleanText(value, max) {
    return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  }

  function normalizeOne(value) {
    if (!value || typeof value !== "object") return null;
    const conversationId = String(value.conversationId ?? "").trim();
    if (!conversationId) return null;
    return {
      id: String(value.id ?? "").trim() || newId(),
      sourceId: value.sourceId == null ? null : String(value.sourceId),
      sourceLabel: cleanText(value.sourceLabel, LABEL_MAX),
      conversationId,
      conversationTitle: cleanText(value.conversationTitle, LABEL_MAX),
      messageId: value.messageId == null || String(value.messageId).trim() === ""
        ? null
        : String(value.messageId),
      label: cleanText(value.label, LABEL_MAX),
      snippet: cleanText(value.snippet, SNIPPET_MAX),
      createdAt: typeof value.createdAt === "string" && value.createdAt ? value.createdAt : null
    };
  }

  function normalize(list) {
    if (!Array.isArray(list)) return [];
    const seen = new Set();
    const result = [];
    for (const item of list) {
      const bookmark = normalizeOne(item);
      if (!bookmark || seen.has(bookmark.id)) continue;
      seen.add(bookmark.id);
      result.push(bookmark);
    }
    return result;
  }

  function newId() {
    counter += 1;
    return `bookmark-${Date.now().toString(36)}-${counter}`;
  }

  function create(fields) {
    const bookmark = normalizeOne({ ...fields, id: fields?.id || newId() });
    if (bookmark && !bookmark.createdAt) bookmark.createdAt = new Date().toISOString();
    return bookmark;
  }

  function sameAnchor(a, b) {
    return a.conversationId === b.conversationId && a.messageId === b.messageId;
  }

  function add(list, bookmark) {
    const normalized = normalize(list);
    if (!bookmark) return normalized;
    const existing = normalized.find(item => sameAnchor(item, bookmark));
    const kept = normalized.filter(item => !sameAnchor(item, bookmark));
    // A refreshed anchor keeps a label the user already wrote for it.
    const merged = existing && !bookmark.label ? { ...bookmark, label: existing.label } : bookmark;
    return [merged, ...kept];
  }

  function remove(list, id) {
    return normalize(list).filter(item => item.id !== String(id));
  }

  function rename(list, id, label) {
    const cleaned = cleanText(label, LABEL_MAX);
    return normalize(list).map(item => item.id === String(id) ? { ...item, label: cleaned } : item);
  }

  function displayTitle(bookmark) {
    return bookmark.label || bookmark.conversationTitle || bookmark.conversationId;
  }

  OD.bookmarks = { normalize, create, add, remove, rename, displayTitle, _internals: { cleanText, sameAnchor } };
})(window.OD);
