window.OD = window.OD || {};

/*
  Per-conversation reading progress. Every conversation keeps its own account
  of where the reader stopped — message anchor first, then page and scroll —
  the same idea the standalone Mufy reader proved per character. The map is
  capped by recency so a multi-thousand-conversation library cannot grow an
  unbounded settings object.
*/
(function(OD){
  const MAX_ENTRIES = 1000;
  let sequence = 0;

  function normalizeEntry(value) {
    if (!value || typeof value !== "object") return null;
    const updatedAt = typeof value.updatedAt === "string" && value.updatedAt ? value.updatedAt : null;
    if (!updatedAt) return null;
    return {
      sourceId: value.sourceId == null ? null : String(value.sourceId),
      messageId: value.messageId == null || String(value.messageId).trim() === "" ? null : String(value.messageId),
      page: Number.isFinite(Number(value.page)) ? Math.max(0, Math.round(Number(value.page))) : 0,
      scrollTop: Number.isFinite(Number(value.scrollTop)) ? Math.max(0, Math.round(Number(value.scrollTop))) : 0,
      percent: Number.isFinite(Number(value.percent)) ? Math.max(0, Math.min(100, Math.round(Number(value.percent)))) : 0,
      updatedAt,
      seq: Number.isFinite(Number(value.seq)) ? Number(value.seq) : 0
    };
  }

  function normalize(map) {
    if (!map || typeof map !== "object" || Array.isArray(map)) return {};
    const entries = [];
    for (const [conversationId, value] of Object.entries(map)) {
      const key = String(conversationId).trim();
      const entry = normalizeEntry(value);
      if (!key || !entry) continue;
      entries.push([key, entry]);
    }
    entries.sort((a, b) =>
      String(b[1].updatedAt).localeCompare(String(a[1].updatedAt)) || b[1].seq - a[1].seq
    );
    return Object.fromEntries(entries.slice(0, MAX_ENTRIES));
  }

  function record(map, conversationId, entry) {
    const key = String(conversationId ?? "").trim();
    const normalized = normalizeEntry({ ...entry, updatedAt: entry?.updatedAt || new Date().toISOString() });
    if (!key || !normalized) return normalize(map);
    sequence += 1;
    normalized.seq = sequence;
    return normalize({ ...normalize(map), [key]: normalized });
  }

  function recent(map, limit = 10) {
    return Object.entries(normalize(map))
      .slice(0, Math.max(0, limit))
      .map(([conversationId, entry]) => ({ conversationId, ...entry }));
  }

  /* The anchor is the topmost visible message. The optional `fraction`
     (0..1) says how far the viewport has travelled through that anchored
     message, so one long document (a diary entry is a single message) no
     longer counts as finished the moment it opens. Callers that cannot
     measure layout omit it and keep the historical behaviour: the anchored
     message counts as fully read. Percent stays an approximation for
     orientation, not a precise character count. */
  function percent(messages, messageId, fraction) {
    const list = Array.isArray(messages) ? messages : [];
    if (!list.length || messageId == null) return 0;
    const index = list.findIndex(message => String(message?.id) === String(messageId));
    if (index < 0) return 0;
    const part = Number.isFinite(Number(fraction)) ? Math.max(0, Math.min(1, Number(fraction))) : 1;
    return Math.round(((index + part) / list.length) * 100);
  }

  function isFinished(entry) {
    return !!entry && Number(entry.percent) >= 99;
  }

  OD.readingProgress = { MAX_ENTRIES, normalize, record, recent, percent, isFinished };
})(window.OD);
