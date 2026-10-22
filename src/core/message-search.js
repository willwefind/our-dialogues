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

  /* Lower-casing can change a string's length ("İ" becomes two units), so
     positions found in the folded copy are mapped back to the original;
     the common case, where nothing changes length, skips the map. */
  function folded(raw) {
    const lower = raw.toLowerCase();
    if (lower.length === raw.length) return { lower, at: index => index };
    let text = "";
    const positions = [];
    for (const character of raw) {
      const start = positions.length ? positions.at(-1).next : 0;
      const piece = character.toLowerCase();
      for (let unit = 0; unit < piece.length; unit += 1) positions.push({ start, next: start + character.length });
      text += piece;
    }
    return { lower: text, at: index => index >= positions.length ? raw.length : positions[index].start };
  }

  // Context edges never cut an emoji (or any surrogate pair) in half.
  const lowSurrogate = code => code >= 0xDC00 && code <= 0xDFFF;
  const highSurrogate = code => code >= 0xD800 && code <= 0xDBFF;
  function contextStart(raw, index) {
    return index > 0 && lowSurrogate(raw.charCodeAt(index)) ? index + 1 : index;
  }
  function contextEnd(raw, index) {
    return index < raw.length && highSurrogate(raw.charCodeAt(index - 1)) ? index - 1 : index;
  }

  function occurrences(text, query) {
    const raw = String(text ?? "");
    const needle = String(query ?? "");
    if (!needle) return [];
    const { lower, at } = folded(raw);
    const lowerNeedle = needle.toLowerCase();
    const found = [];
    let from = 0;
    for (;;) {
      const foldedIndex = lower.indexOf(lowerNeedle, from);
      if (foldedIndex < 0) break;
      const index = at(foldedIndex);
      const end = at(foldedIndex + lowerNeedle.length);
      found.push({
        index,
        before: raw.slice(contextStart(raw, Math.max(0, index - BEFORE_CONTEXT)), index),
        match: raw.slice(index, end),
        after: raw.slice(end, contextEnd(raw, Math.min(raw.length, end + AFTER_CONTEXT)))
      });
      from = foldedIndex + Math.max(1, lowerNeedle.length);
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
