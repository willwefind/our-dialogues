window.OD = window.OD || {};

/*
  Companionship: "met on ..., together for N days".

  A companion is whatever the reader already groups conversations by —
  one Mufy character, or a whole source (a ChatGPT export, a Claude export,
  a personal archive). This module only computes; it draws nothing.

  Honesty rules, in the same spirit as the year headings and the personal
  archive's date handling:

    - dates are never invented. No dated conversation means no date, and the
      card simply says nothing about when things began.
    - a time of day is shown only when the archive actually carries one.
      Date-only entries (personal archives store "2014-11-02") must never
      grow a fabricated "00:00".
    - the derived date is the earliest thing the archive can prove. It is
      often NOT the day the user remembers — history gets truncated, moved
      between platforms, or deleted — so a manual date always wins, and the
      two are told apart by `firstAtSource`.
    - day counts are calendar days in the reader's own timezone, so "met
      today" reads 0 and turns over at the local midnight, not at UTC's.
*/
(function(OD){
  const SEPARATOR = "::";

  function isoOrNull(value) {
    if (value == null) return null;
    const text = String(value).trim();
    if (!text) return null;
    const time = Date.parse(text);
    return Number.isNaN(time) ? null : text;
  }

  // Does the stored value carry a clock, or only a calendar day?
  // "2014-11-02" → false. "2026-06-26T05:50:16.582Z" → true.
  function hasClock(value) {
    return /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(String(value ?? ""));
  }

  function earlier(a, b) {
    if (!a) return b;
    if (!b) return a;
    return Date.parse(a) <= Date.parse(b) ? a : b;
  }

  function later(a, b) {
    if (!a) return b;
    if (!b) return a;
    return Date.parse(a) >= Date.parse(b) ? a : b;
  }

  function localMidnight(ms) {
    const date = new Date(ms);
    return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  }

  /*
    A date with no clock means a calendar day, not an instant. Date.parse reads
    "2014-11-02" as UTC midnight, which lands on the previous day west of
    Greenwich — so a bare date is read as local midnight instead, and the day
    count says what the calendar says wherever the reader is sitting.
  */
  const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
  function startOfDay(value) {
    const text = String(value ?? "").trim();
    const parts = DATE_ONLY.exec(text);
    if (parts) {
      return new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3])).getTime();
    }
    const time = Date.parse(text);
    return Number.isNaN(time) ? NaN : localMidnight(time);
  }

  /*
    Calendar days between two instants, counted in the reader's timezone.
    Rounding absorbs the 23- and 25-hour days that daylight saving creates,
    so a day never silently goes missing in spring.
  */
  function daysBetween(fromISO, nowMs = Date.now()) {
    const from = isoOrNull(fromISO);
    if (!from) return null;
    const start = startOfDay(from);
    if (Number.isNaN(start)) return null;
    const end = localMidnight(nowMs);
    return Math.round((end - start) / 86400000);
  }

  function companionKey(sourceId, characterKey) {
    const source = String(sourceId ?? "").trim();
    if (!source) return null;
    const character = characterKey == null ? "" : String(characterKey).trim();
    return character ? `${source}${SEPARATOR}${character}` : source;
  }

  /*
    One companion's shape, computed from its conversations.

    Cheap mode (the default) reads conversation-level dates, which every
    adapter already fills — Mufy derives a session's date from its first
    dated message, so this is both fast and accurate enough for a list.
    Precise mode also scans messages, which is what a single card wants
    when it means to print an hour and a minute.
  */
  function summarize(conversations, options = {}) {
    const list = Array.isArray(conversations) ? conversations : [];
    const precise = options.precise === true;
    let firstAt = null;
    let lastAt = null;
    let datedConversations = 0;
    let messageCount = 0;

    for (const conversation of list) {
      if (!conversation || typeof conversation !== "object") continue;
      const messages = Array.isArray(conversation.messages) ? conversation.messages : [];
      messageCount += messages.length;

      let conversationFirst = isoOrNull(conversation.createdAt);
      let conversationLast = isoOrNull(conversation.updatedAt);

      // A conversation-level date can be missing, or (for adapters that take
      // the first message in array order) merely near the truth. Scanning
      // messages is the only way to be sure of a minute.
      if (precise || !conversationFirst) {
        for (const message of messages) {
          const at = isoOrNull(message?.createdAt);
          if (!at) continue;
          conversationFirst = earlier(conversationFirst, at);
          conversationLast = later(conversationLast, at);
        }
      }

      if (conversationFirst) datedConversations += 1;
      firstAt = earlier(firstAt, conversationFirst);
      lastAt = later(lastAt, later(conversationFirst, conversationLast));
    }

    return {
      firstAt,
      lastAt,
      firstAtHasTime: hasClock(firstAt),
      conversationCount: list.length,
      messageCount,
      datedConversations,
      // How much of this companion actually carries dates. A caller that
      // wants the year-headings treatment can refuse to render below a
      // threshold instead of showing a date derived from one stray record.
      dateCoverage: list.length ? datedConversations / list.length : 0
    };
  }

  /* A reader's own name for a companion. The archive's label — a source name
     like "ChatGPT official export (2026 validated)" — is the honest default
     but rarely what the person was called, so the card lets it be renamed and
     keeps the archive's own name one click away, exactly as dates do. */
  const MAX_NAME_LENGTH = 40;

  function readerName(value) {
    const text = String(value ?? "").replace(/\s+/g, " ").trim();
    return text ? text.slice(0, MAX_NAME_LENGTH) : null;
  }

  function overrideRecord(firstAt, name) {
    const record = {};
    if (firstAt) record.firstAt = firstAt;
    if (name) record.name = name;
    return record;
  }

  function normalizeOverrides(value) {
    const overrides = {};
    if (value && typeof value === "object" && !Array.isArray(value)) {
      for (const [rawKey, rawEntry] of Object.entries(value)) {
        const key = String(rawKey ?? "").trim();
        if (!key || !rawEntry || typeof rawEntry !== "object") continue;
        const firstAt = isoOrNull(rawEntry.firstAt);
        const name = readerName(rawEntry.name);
        // An entry holding neither is not an override at all.
        if (!firstAt && !name) continue;
        overrides[key] = overrideRecord(firstAt, name);
      }
    }
    return overrides;
  }

  // The two overrides are independent: restoring the archive's date must not
  // take the reader's name down with it, and renaming must not touch the date.
  function setOverride(overrides, key, firstAt) {
    const next = normalizeOverrides(overrides);
    const id = String(key ?? "").trim();
    if (!id) return next;
    const value = isoOrNull(firstAt);
    const name = next[id]?.name || null;
    if (value || name) next[id] = overrideRecord(value, name);
    else delete next[id];
    return next;
  }

  function clearOverride(overrides, key) {
    return setOverride(overrides, key, null);
  }

  function setName(overrides, key, name) {
    const next = normalizeOverrides(overrides);
    const id = String(key ?? "").trim();
    if (!id) return next;
    const value = readerName(name);
    const firstAt = next[id]?.firstAt || null;
    if (value || firstAt) next[id] = overrideRecord(firstAt, value);
    else delete next[id];
    return next;
  }

  function clearName(overrides, key) {
    return setName(overrides, key, null);
  }

  function overrideFor(overrides, key) {
    const anniversaries = normalizeOverrides(overrides);
    const id = String(key ?? "").trim();
    return id && anniversaries[id] ? (anniversaries[id].firstAt || null) : null;
  }

  function nameFor(overrides, key) {
    const overridden = normalizeOverrides(overrides);
    const id = String(key ?? "").trim();
    return id && overridden[id] ? (overridden[id].name || null) : null;
  }

  /*
    The value a card should print. A manual date always wins over the derived
    one, and `firstAtSource` keeps the difference visible so the interface can
    say "you set this" rather than pretending the archive knew.
  */
  function resolve(conversations, options = {}) {
    const summary = summarize(conversations, options);
    const manual = overrideFor(options.overrides, options.key);
    const firstAt = manual || summary.firstAt;
    const now = typeof options.now === "number" ? options.now : Date.now();
    return {
      ...summary,
      key: options.key == null ? null : String(options.key),
      firstAt,
      firstAtHasTime: manual ? hasClock(manual) : summary.firstAtHasTime,
      firstAtSource: manual ? "manual" : (summary.firstAt ? "derived" : null),
      derivedFirstAt: summary.firstAt,
      days: daysBetween(firstAt, now)
    };
  }

  OD.companionship = {
    SEPARATOR,
    companionKey,
    daysBetween,
    summarize,
    resolve,
    normalizeOverrides,
    setOverride,
    clearOverride,
    setName,
    clearName,
    nameFor,
    MAX_NAME_LENGTH,
    overrideFor
  };
})(window.OD);
