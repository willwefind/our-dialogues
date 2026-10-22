window.OD = window.OD || {};

/*
  The source shelf: what the reader calls each imported source, and which
  of the reader's own groups it sits in. Presentation only — nothing in an
  archive is touched, and the archive's own label stays the default.

  Everything is keyed by source ID, which the library derives from the
  archive's content fingerprint, so a source that is removed and imported
  again comes back under the name and in the group it had.

    names:   { sourceId: name }
    groups:  [{ id, name }]           in creation order
    members: { sourceId: groupId }

  A group exists only while something is filed in it: moving its last
  source out, or dissolving it, removes the group. Sources filed in a group
  that are not in the library right now keep the group alive but invisible.
*/
(function(OD){
  const NAME_MAX_LENGTH = 40;

  function cleanName(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, NAME_MAX_LENGTH);
  }

  function normalize(value) {
    const names = {};
    const groups = [];
    const members = {};
    if (value && typeof value === "object") {
      const rawNames = value.names;
      if (rawNames && typeof rawNames === "object" && !Array.isArray(rawNames)) {
        for (const [sourceId, name] of Object.entries(rawNames)) {
          const key = String(sourceId).trim();
          const cleaned = cleanName(name);
          if (key && cleaned) names[key] = cleaned;
        }
      }
      const seen = new Set();
      for (const group of Array.isArray(value.groups) ? value.groups : []) {
        const id = String(group?.id ?? "").trim();
        const name = cleanName(group?.name);
        if (!id || !name || seen.has(id)) continue;
        seen.add(id);
        groups.push({ id, name });
      }
      const rawMembers = value.members;
      if (rawMembers && typeof rawMembers === "object" && !Array.isArray(rawMembers)) {
        for (const [sourceId, groupId] of Object.entries(rawMembers)) {
          const key = String(sourceId).trim();
          const target = String(groupId ?? "").trim();
          if (key && seen.has(target)) members[key] = target;
        }
      }
    }
    return prune({ names, groups, members });
  }

  function prune(shelf) {
    const used = new Set(Object.values(shelf.members));
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

  function groupOf(shelf, sourceId) {
    const groupId = shelf?.members?.[String(sourceId)];
    return (shelf?.groups || []).find(group => group.id === groupId) || null;
  }

  function newGroupId(groups) {
    const taken = new Set(groups.map(group => group.id));
    let id;
    do {
      id = `group-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    } while (taken.has(id));
    return id;
  }

  function sourceKeys(sourceIds) {
    const keys = [];
    for (const sourceId of Array.isArray(sourceIds) ? sourceIds : [sourceIds]) {
      const key = String(sourceId ?? "").trim();
      if (key && !keys.includes(key)) keys.push(key);
    }
    return keys;
  }

  /* File sources under groupId; null takes them out of any group. Takes one
     source ID or a list, so a multi-selection moves in one step. */
  function assign(shelf, sourceIds, groupId) {
    const next = normalize(shelf);
    const target = String(groupId ?? "").trim();
    const known = target && next.groups.some(group => group.id === target);
    for (const key of sourceKeys(sourceIds)) {
      if (known) next.members[key] = target;
      else delete next.members[key];
    }
    return prune(next);
  }

  /* File sources under a group by name — reusing a group already called
     that, otherwise creating it. Returns the new shelf and the group's ID. */
  function assignToNewGroup(shelf, sourceIds, name) {
    const next = normalize(shelf);
    const keys = sourceKeys(sourceIds);
    const cleaned = cleanName(name);
    if (!keys.length || !cleaned) return { shelf: next, groupId: null };
    let group = next.groups.find(item => item.name === cleaned);
    if (!group) {
      group = { id: newGroupId(next.groups), name: cleaned };
      next.groups.push(group);
    }
    for (const key of keys) next.members[key] = group.id;
    return { shelf: prune(next), groupId: group.id };
  }

  /* An emptied group name is refused rather than read as a dissolve. */
  function renameGroup(shelf, groupId, name) {
    const next = normalize(shelf);
    const cleaned = cleanName(name);
    const group = next.groups.find(item => item.id === String(groupId));
    if (group && cleaned) group.name = cleaned;
    return next;
  }

  /* Every source in the group goes back to the top level. */
  function dissolveGroup(shelf, groupId) {
    const next = normalize(shelf);
    const target = String(groupId);
    for (const [sourceId, member] of Object.entries(next.members)) {
      if (member === target) delete next.members[sourceId];
    }
    return prune(next);
  }

  /* The sidebar's top level, in the library's own source order: a group
     takes the place where its first present source would have stood, and
     its sources follow inside it in library order. */
  function arrange(shelf, sources) {
    const groupsById = new Map((shelf?.groups || []).map(group => [group.id, group]));
    const rows = [];
    const groupRows = new Map();
    for (const source of sources || []) {
      const group = groupsById.get(shelf?.members?.[String(source?.id)]);
      if (!group) {
        rows.push({ type: "source", source });
        continue;
      }
      let row = groupRows.get(group.id);
      if (!row) {
        row = { type: "group", group: { ...group }, sources: [] };
        groupRows.set(group.id, row);
        rows.push(row);
      }
      row.sources.push(source);
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
    assign,
    assignToNewGroup,
    renameGroup,
    dissolveGroup,
    arrange,
    _internals: { cleanName }
  };
})(window.OD);
