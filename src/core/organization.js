window.OD = window.OD || {};

/*
  Library organization: favorites and tags, keyed by conversation ID.
  Favorites store their timestamp so a future timeline can order them.
  Tags are short user-written labels — normalized, deduplicated, and capped
  so the settings object stays lightweight at library scale.
*/
(function(OD){
  const TAG_MAX_LENGTH = 24;
  const TAGS_PER_CONVERSATION = 12;

  function cleanTag(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, TAG_MAX_LENGTH);
  }

  function normalize(value) {
    const favorites = {};
    const tags = {};
    if (value && typeof value === "object") {
      const rawFavorites = value.favorites;
      if (rawFavorites && typeof rawFavorites === "object" && !Array.isArray(rawFavorites)) {
        for (const [conversationId, at] of Object.entries(rawFavorites)) {
          const key = String(conversationId).trim();
          if (!key) continue;
          favorites[key] = typeof at === "string" && at ? at : new Date(0).toISOString();
        }
      }
      const rawTags = value.tags;
      if (rawTags && typeof rawTags === "object" && !Array.isArray(rawTags)) {
        for (const [conversationId, list] of Object.entries(rawTags)) {
          const key = String(conversationId).trim();
          if (!key || !Array.isArray(list)) continue;
          const cleaned = [];
          for (const tag of list) {
            const normalized = cleanTag(tag);
            if (normalized && !cleaned.includes(normalized)) cleaned.push(normalized);
            if (cleaned.length >= TAGS_PER_CONVERSATION) break;
          }
          if (cleaned.length) tags[key] = cleaned;
        }
      }
    }
    return { favorites, tags };
  }

  function isFavorite(organization, conversationId) {
    return !!organization?.favorites?.[String(conversationId)];
  }

  function toggleFavorite(organization, conversationId, at) {
    const next = normalize(organization);
    const key = String(conversationId ?? "").trim();
    if (!key) return next;
    if (next.favorites[key]) delete next.favorites[key];
    else next.favorites[key] = typeof at === "string" && at ? at : new Date().toISOString();
    return next;
  }

  function tagsOf(organization, conversationId) {
    return [...(organization?.tags?.[String(conversationId)] || [])];
  }

  function setTags(organization, conversationId, list) {
    const next = normalize(organization);
    const key = String(conversationId ?? "").trim();
    if (!key) return next;
    const cleaned = [];
    for (const tag of Array.isArray(list) ? list : []) {
      const normalized = cleanTag(tag);
      if (normalized && !cleaned.includes(normalized)) cleaned.push(normalized);
      if (cleaned.length >= TAGS_PER_CONVERSATION) break;
    }
    if (cleaned.length) next.tags[key] = cleaned;
    else delete next.tags[key];
    return next;
  }

  function addTag(organization, conversationId, tag) {
    return setTags(organization, conversationId, [...tagsOf(organization, conversationId), tag]);
  }

  function removeTag(organization, conversationId, tag) {
    const target = cleanTag(tag);
    return setTags(organization, conversationId, tagsOf(organization, conversationId).filter(item => item !== target));
  }

  /* Every distinct tag with its usage count, most-used first, ties by locale order. */
  function allTags(organization) {
    const counts = new Map();
    for (const list of Object.values(organization?.tags || {})) {
      for (const tag of list) counts.set(tag, (counts.get(tag) || 0) + 1);
    }
    return [...counts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, "zh"));
  }

  function matches(organization, conversationId, { favoritesOnly = false, tag = null } = {}) {
    if (favoritesOnly && !isFavorite(organization, conversationId)) return false;
    if (tag && !tagsOf(organization, conversationId).includes(cleanTag(tag))) return false;
    return true;
  }

  OD.organization = {
    TAG_MAX_LENGTH,
    TAGS_PER_CONVERSATION,
    normalize,
    isFavorite,
    toggleFavorite,
    tagsOf,
    setTags,
    addTag,
    removeTag,
    allTags,
    matches,
    _internals: { cleanTag }
  };
})(window.OD);
