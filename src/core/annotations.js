window.OD = window.OD || {};

/*
  Highlights and notes. Each annotation anchors to a stable messageId plus the
  selected text and a little surrounding context — never a DOM offset — so
  re-renders, re-sorts, and re-imports cannot move it. Colors are a small fixed
  highlighter palette; unknown colors normalize to the default.

  Rendering rule learned the hard way in the standalone Mufy reader: find the
  highlight positions in the RAW text first, then escape slice by slice.
  Escaping first would shift every character index after an entity.
*/
(function(OD){
  const COLORS = ["yellow", "green", "pink", "blue", "purple"];
  const DEFAULT_COLOR = "yellow";
  const TEXT_MAX = 500;
  const CONTEXT_MAX = 40;
  const NOTE_MAX = 1000;
  const LABEL_MAX = 120;
  let counter = 0;

  function cleanLine(value, max) {
    return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  }

  function cleanExact(value, max) {
    return String(value ?? "").slice(0, max);
  }

  function normalizeColor(value) {
    return COLORS.includes(value) ? value : DEFAULT_COLOR;
  }

  function newId() {
    counter += 1;
    return `annotation-${Date.now().toString(36)}-${counter}`;
  }

  function normalizeOne(value) {
    if (!value || typeof value !== "object") return null;
    const conversationId = String(value.conversationId ?? "").trim();
    const messageId = String(value.messageId ?? "").trim();
    const selectedText = cleanExact(value.selectedText, TEXT_MAX);
    if (!conversationId || !messageId || !selectedText.trim()) return null;
    return {
      id: String(value.id ?? "").trim() || newId(),
      sourceId: value.sourceId == null ? null : String(value.sourceId),
      sourceLabel: cleanLine(value.sourceLabel, LABEL_MAX),
      conversationId,
      conversationTitle: cleanLine(value.conversationTitle, LABEL_MAX),
      messageId,
      selectedText,
      contextBefore: cleanExact(value.contextBefore, CONTEXT_MAX),
      contextAfter: cleanExact(value.contextAfter, CONTEXT_MAX),
      note: String(value.note ?? "").trim().slice(0, NOTE_MAX),
      color: normalizeColor(value.color),
      createdAt: typeof value.createdAt === "string" && value.createdAt ? value.createdAt : null
    };
  }

  function normalize(list) {
    if (!Array.isArray(list)) return [];
    const seen = new Set();
    const result = [];
    for (const item of list) {
      const annotation = normalizeOne(item);
      if (!annotation || seen.has(annotation.id)) continue;
      seen.add(annotation.id);
      result.push(annotation);
    }
    return result;
  }

  function create(fields) {
    const annotation = normalizeOne({ ...fields, id: fields?.id || newId() });
    if (annotation && !annotation.createdAt) annotation.createdAt = new Date().toISOString();
    return annotation;
  }

  function sameAnchor(a, b) {
    return a.conversationId === b.conversationId &&
      a.messageId === b.messageId &&
      a.selectedText === b.selectedText &&
      a.contextBefore === b.contextBefore &&
      a.contextAfter === b.contextAfter;
  }

  function add(list, annotation) {
    const normalized = normalize(list);
    if (!annotation) return normalized;
    const existing = normalized.find(item => sameAnchor(item, annotation));
    const kept = normalized.filter(item => !sameAnchor(item, annotation));
    // Re-marking the same span updates its color but never discards a written note.
    const merged = existing && !annotation.note ? { ...annotation, note: existing.note } : annotation;
    return [merged, ...kept];
  }

  function remove(list, id) {
    return normalize(list).filter(item => item.id !== String(id));
  }

  function update(list, id, patch) {
    return normalize(list).map(item => {
      if (item.id !== String(id)) return item;
      const next = { ...item };
      if (patch && "note" in patch) next.note = String(patch.note ?? "").trim().slice(0, NOTE_MAX);
      if (patch && "color" in patch) next.color = normalizeColor(patch.color);
      return next;
    });
  }

  function forMessage(list, conversationId, messageId) {
    return normalize(list).filter(item =>
      item.conversationId === String(conversationId) && item.messageId === String(messageId)
    );
  }

  /* Every occurrence of the selected text is a candidate; the stored context
     picks between repeats. An annotation whose text no longer occurs returns
     null and simply stops rendering — it is never guessed to a nearby spot. */
  function locate(text, annotation) {
    const raw = String(text ?? "");
    const needle = annotation.selectedText;
    if (!needle) return null;
    const candidates = [];
    let from = 0;
    for (;;) {
      const index = raw.indexOf(needle, from);
      if (index < 0) break;
      candidates.push(index);
      from = index + Math.max(1, needle.length);
    }
    if (!candidates.length) return null;
    const scored = candidates.map(start => {
      const before = raw.slice(Math.max(0, start - annotation.contextBefore.length), start);
      const after = raw.slice(start + needle.length, start + needle.length + annotation.contextAfter.length);
      let score = 0;
      if (annotation.contextBefore && before === annotation.contextBefore) score += 1;
      if (annotation.contextAfter && after === annotation.contextAfter) score += 1;
      return { start, score };
    });
    scored.sort((a, b) => b.score - a.score || a.start - b.start);
    const best = scored[0];
    return { start: best.start, end: best.start + needle.length };
  }

  const escapeHTML = value => String(value ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /* Raw text + located annotations → escaped HTML with <mark> wrappers.
     Overlapping spans keep the first located one; the loser stays listed in
     the panel and can still be jumped to and deleted. */
  function markupText(text, annotations, { escape = escapeHTML } = {}) {
    const raw = String(text ?? "");
    const spans = [];
    for (const annotation of annotations || []) {
      const position = locate(raw, annotation);
      if (!position) continue;
      if (spans.some(span => position.start < span.end && position.end > span.start)) continue;
      spans.push({ ...position, annotation });
    }
    if (!spans.length) return escape(raw);
    spans.sort((a, b) => a.start - b.start);
    let html = "";
    let cursor = 0;
    for (const span of spans) {
      html += escape(raw.slice(cursor, span.start));
      html += `<mark class="annotation hl-${span.annotation.color}${span.annotation.note ? " noted" : ""}" ` +
        `data-annotation-id="${escape(span.annotation.id)}">${escape(raw.slice(span.start, span.end))}</mark>`;
      cursor = span.end;
    }
    return html + escape(raw.slice(cursor));
  }

  OD.annotations = {
    COLORS,
    DEFAULT_COLOR,
    normalize,
    normalizeColor,
    create,
    add,
    remove,
    update,
    forMessage,
    locate,
    markupText,
    _internals: { sameAnchor, escapeHTML }
  };
})(window.OD);
