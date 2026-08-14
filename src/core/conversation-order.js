window.OD = window.OD || {};

(function(OD){
  const ASCENDING = "asc";
  const DESCENDING = "desc";
  const DEFAULT_MODE = ASCENDING;
  const STORAGE_KEY = "our-dialogues.conversation-sort";

  function normalizeMode(value) {
    return value === DESCENDING ? DESCENDING : DEFAULT_MODE;
  }

  function createdAtTime(conversation) {
    const value = conversation?.createdAt;
    if (value === null || value === undefined || value === "") return null;
    const time = new Date(value).getTime();
    return Number.isNaN(time) ? null : time;
  }

  function sortConversations(conversations, mode=DEFAULT_MODE) {
    const direction = normalizeMode(mode) === DESCENDING ? -1 : 1;
    return (Array.isArray(conversations) ? conversations : [])
      .map((conversation, importIndex) => ({
        conversation,
        importIndex,
        time: createdAtTime(conversation)
      }))
      .sort((a, b) => {
        const aHasDate = a.time !== null;
        const bHasDate = b.time !== null;
        if (aHasDate !== bHasDate) return aHasDate ? -1 : 1;
        if (aHasDate && a.time !== b.time) return (a.time - b.time) * direction;
        return a.importIndex - b.importIndex;
      })
      .map(item => item.conversation);
  }

  function filterAndSort(conversations, query, getSearchText, mode=DEFAULT_MODE) {
    const needle = String(query || "").trim().toLowerCase();
    const matching = needle
      ? (Array.isArray(conversations) ? conversations : []).filter(conversation =>
          String(getSearchText(conversation) || "").toLowerCase().includes(needle)
        )
      : conversations;
    return sortConversations(matching, mode);
  }

  function readStoredMode(storage) {
    try {
      return normalizeMode(storage?.getItem(STORAGE_KEY));
    } catch (error) {
      console.warn("Could not read the saved conversation sort mode", error);
      return DEFAULT_MODE;
    }
  }

  function persistMode(storage, mode) {
    const normalized = normalizeMode(mode);
    try {
      storage?.setItem(STORAGE_KEY, normalized);
    } catch (error) {
      console.warn("Could not save the conversation sort mode", error);
    }
    return normalized;
  }

  OD.conversationOrder = {
    ASCENDING,
    DESCENDING,
    DEFAULT_MODE,
    STORAGE_KEY,
    normalizeMode,
    sortConversations,
    filterAndSort,
    readStoredMode,
    persistMode
  };
})(window.OD);
