window.OD = window.OD || {};

/*
  Message-level full-text search. Two scopes — one conversation or the whole
  library — and every hit carries the exact messageId so the reader can jump
  precisely, never "somewhere near". A long message can match many times;
  each occurrence is its own hit (reporting only the first hides the rest,
  a lesson from the standalone Mufy reader). Results are capped and the cap
  is reported, never silent.
*/
(function(OD){
  const DEFAULT_LIMIT = 200;
  const BEFORE_CONTEXT = 22;
  const AFTER_CONTEXT = 42;

  function occurrences(text, query) {
    const raw = String(text ?? "");
    const needle = String(query ?? "");
    if (!needle) return [];
    const lower = raw.toLowerCase();
    const lowerNeedle = needle.toLowerCase();
    const found = [];
    let from = 0;
    for (;;) {
      const index = lower.indexOf(lowerNeedle, from);
      if (index < 0) break;
      found.push({
        index,
        before: raw.slice(Math.max(0, index - BEFORE_CONTEXT), index),
        match: raw.slice(index, index + needle.length),
        after: raw.slice(index + needle.length, index + needle.length + AFTER_CONTEXT)
      });
      from = index + Math.max(1, needle.length);
    }
    return found;
  }

  function searchConversation(conversation, query, { limit = DEFAULT_LIMIT } = {}) {
    const hits = [];
    let truncated = false;
    const needle = String(query ?? "").trim();
    if (!conversation || !needle) return { hits, truncated };
    for (const message of conversation.messages || []) {
      const content = message?.content;
      const text = typeof content === "string" ? content : OD.schema.textOf(content);
      if (!text) continue;
      for (const occurrence of occurrences(text, needle)) {
        if (hits.length >= limit) {
          truncated = true;
          return { hits, truncated };
        }
        hits.push({
          conversationId: String(conversation.id),
          messageId: String(message.id),
          speaker: message.speaker || message.role || "",
          ...occurrence
        });
      }
    }
    return { hits, truncated };
  }

  function searchLibrary(conversations, query, { limit = DEFAULT_LIMIT } = {}) {
    const hits = [];
    let truncated = false;
    for (const conversation of Array.isArray(conversations) ? conversations : []) {
      const remaining = limit - hits.length;
      if (remaining <= 0) {
        truncated = true;
        break;
      }
      const result = searchConversation(conversation, query, { limit: remaining });
      hits.push(...result.hits);
      if (result.truncated) {
        truncated = true;
        break;
      }
    }
    return { hits, truncated };
  }

  OD.messageSearch = {
    DEFAULT_LIMIT,
    searchConversation,
    searchLibrary,
    _internals: { occurrences }
  };
})(window.OD);
