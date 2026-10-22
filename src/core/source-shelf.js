window.OD = window.OD || {};

/*
  The source shelf: what the reader calls each imported source, and the
  reader's own groups. A group can hold whole sources and single
  conversations side by side — three Mufy chats, a SillyTavern chat, and a
  whole ChatGPT export can share one shelf. Presentation only — nothing in
  an archive is touched, and the archive's own label stays the default.

  Everything is keyed by ID. Source IDs come from the archive's content
  fingerprint and conversation IDs are built on them, so a source that is
  removed and imported again comes back under its name, and it and its
  conversations come back in the groups they had.

    names:         { sourceId: name }
    groups:        [{ id, name }]           in creation order
    members:       { sourceId: groupId }
    conversations: { conversationId: groupId }

  A conversation filed in a group is shown there instead of under its
  source; taking it out of the group puts it back. A group exists only
  while something is filed in it: moving its last item out, or dissolving
  it, removes the group. Items filed in a group that are not in the library
  right now keep the group alive but invisible.
*/
(function(OD){
  const NAME_MAX_LENGTH = 40;

  function cleanName(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, NAME_MAX_LENGTH);
  }

  function plainMap(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  }

  function normalize(value) {
    const names = {};
    const groups = [];
    const members = {};
    const conversations = {};
    if (value && typeof value === "object") {
      for (const [sourceId, name] of Object.entries(plainMap(value.names) || {})) {
        const key = String(sourceId).trim();
        const cleaned = cleanName(name);
        if (key && cleaned) names[key] = cleaned;
      }
      const seen = new Set();
      for (const group of Array.isArray(value.groups) ? value.groups : []) {
        const id = String(group?.id ?? "").trim();
        const name = cleanName(group?.name);
        if (!id || !name || seen.has(id)) continue;
        seen.add(id);
        groups.push({ id, name });
      }
      for (const [target, raw] of [[members, value.members], [conversations, value.conversations]]) {
        for (const [itemId, groupId] of Object.entries(plainMap(raw) || {})) {
          const key = String(itemId).trim();
          const group = String(groupId ?? "").trim();
          if (key && seen.has(group)) target[key] = group;
        }
      }
    }
    return prune({ names, groups, members, conversations });
  }

  function prune(shelf) {
    const used = new Set([...Object.values(shelf.members), ...Object.values(shelf.conversations)]);
    shelf.groups = shelf.groups.filter(group => used.has(group.id));
    return shelf;
  }

  /* The name the reader gave the source, else the archive's own label. */
  function displayName(shelf, source) {
    const id = String(source?.id ?? "");
    return shelf?.names?.[id] || source?.label || "";
  }

  function hasCustomName(shelf, sourceId) {
    return !!shelf?.names?.[String(sourceId)];
  }

  /* An empty name, or one equal to the archive's label, is a restore. */
  function rename(shelf, sourceId, name, archiveLabel = "") {
    const next = normalize(shelf);
    const key = String(sourceId ?? "").trim();
    if (!key) return next;
    const cleaned = cleanName(name);
    if (!cleaned || cleaned === cleanName(archiveLabel)) delete next.names[key];
    else next.names[key] = cleaned;
    return next;
  }

  function groupById(shelf, groupId) {
    return (shelf?.groups || []).find(group => group.id === groupId) || null;
  }

  function groupOf(shelf, sourceId) {
    return groupById(shelf, shelf?.members?.[String(sourceId)]);
  }

  function groupOfConversation(shelf, conversationId) {
    return groupById(shelf, shelf?.conversations?.[String(conversationId)]);
  }

  function newGroupId(groups) {
    const taken = new Set(groups.map(group => group.id));
    let id;
    do {
      id = `group-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    } while (taken.has(id));
    return id;
  }

  /* "新分组", then "新分组 2", "新分组 3" … — the first name no group has. */
  function availableGroupName(shelf, base) {
    const cleaned = cleanName(base) || "Group";
    const taken = new Set((shelf?.groups || []).map(group => group.name));
    if (!taken.has(cleaned)) return cleaned;
    let suffix = 2;
    while (taken.has(cleanName(`${cleaned} ${suffix}`))) suffix += 1;
    return cleanName(`${cleaned} ${suffix}`);
  }

  function keysOf(ids) {
    const keys = [];
    for (const id of Array.isArray(ids) ? ids : [ids]) {
      const key = String(id ?? "").trim();
      if (key && !keys.includes(key)) keys.push(key);
    }
    return keys;
  }

  /* items: { sources: [ids], conversations: [ids] }. */
  function itemKeys(items) {
    return { sources: keysOf(items?.sources || []), conversations: keysOf(items?.conversations || []) };
  }

  /* File items under groupId; null takes them out of any group. */
  function file(shelf, items, groupId) {
    const next = normalize(shelf);
    const { sources, conversations } = itemKeys(items);
    const target = String(groupId ?? "").trim();
    const known = target && next.groups.some(group => group.id === target);
    for (const [map, keys] of [[next.members, sources], [next.conversations, conversations]]) {
      for (const key of keys) {
        if (known) map[key] = target;
        else delete map[key];
      }
    }
    return prune(next);
  }

  /* File items under a group by name — reusing a group already called
     that, otherwise creating it. Returns the new shelf and the group's ID. */
  function fileToNewGroup(shelf, items, name) {
    const next = normalize(shelf);
    const keys = itemKeys(items);
    const cleaned = cleanName(name);
    if ((!keys.sources.length && !keys.conversations.length) || !cleaned) return { shelf: next, groupId: null };
    let group = next.groups.find(item => item.name === cleaned);
    if (!group) {
      group = { id: newGroupId(next.groups), name: cleaned };
      next.groups.push(group);
    }
    // Filed here rather than through file(): its normalize would prune the
    // new group as empty before anything reached it.
    for (const key of keys.sources) next.members[key] = group.id;
    for (const key of keys.conversations) next.conversations[key] = group.id;
    return { shelf: prune(next), groupId: group.id };
  }

  /* Source-only forms, kept for the source menus: one ID or a list. */
  function assign(shelf, sourceIds, groupId) {
    return file(shelf, { sources: keysOf(sourceIds) }, groupId);
  }

  function assignToNewGroup(shelf, sourceIds, name) {
    return fileToNewGroup(shelf, { sources: keysOf(sourceIds) }, name);
  }

  /* An emptied group name is refused rather than read as a dissolve. */
  function renameGroup(shelf, groupId, name) {
    const next = normalize(shelf);
    const cleaned = cleanName(name);
    const group = next.groups.find(item => item.id === String(groupId));
    if (group && cleaned) group.name = cleaned;
    return next;
  }

  /* Every source in the group goes back to the top level, and every
     conversation back under its own source. */
  function dissolveGroup(shelf, groupId) {
    const next = normalize(shelf);
    const target = String(groupId);
    for (const map of [next.members, next.conversations]) {
      for (const [itemId, member] of Object.entries(map)) {
        if (member === target) delete map[itemId];
      }
    }
    return prune(next);
  }

  /* The sidebar's top level, in the library's own source order. A group
     takes the place where its first present item stood — a filed source, or
     the source a filed conversation came from — and holds its sources in
     library order and its conversations as { conversation, source } pairs. */
  function arrange(shelf, sources) {
    const groupsById = new Map((shelf?.groups || []).map(group => [group.id, group]));
    const rows = [];
    const groupRows = new Map();
    const rowFor = group => {
      let row = groupRows.get(group.id);
      if (!row) {
        row = { type: "group", group: { ...group }, sources: [], conversations: [] };
        groupRows.set(group.id, row);
        rows.push(row);
      }
      return row;
    };
    for (const source of sources || []) {
      const group = groupsById.get(shelf?.members?.[String(source?.id)]);
      if (group) rowFor(group).sources.push(source);
      else rows.push({ type: "source", source });
      for (const conversation of source?.conversations || []) {
        const filed = groupsById.get(shelf?.conversations?.[String(conversation?.id)]);
        if (filed) rowFor(filed).conversations.push({ conversation, source });
      }
    }
    return rows;
  }

  OD.sourceShelf = {
    NAME_MAX_LENGTH,
    normalize,
    displayName,
    hasCustomName,
    rename,
    groupOf,
    groupOfConversation,
    availableGroupName,
    file,
    fileToNewGroup,
    assign,
    assignToNewGroup,
    renameGroup,
    dissolveGroup,
    arrange,
    _internals: { cleanName }
  };
})(window.OD);
