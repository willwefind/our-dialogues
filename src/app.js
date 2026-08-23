window.OD = window.OD || {};

(function(OD){
  const $ = id => document.getElementById(id);
  const t = (key, params) => OD.i18n ? OD.i18n.t(key, params) : String(key);
  const SETTINGS_MIRROR_KEY = "our-dialogues.reader-state.v1";
  const state = {
    library: OD.sourceLibrary.create(),
    persistence: OD.persistentLibrary?.create?.() || null,
    archive: null,
    filtered: [],
    current: null,
    sourceFilter: "all",
    sortMode: OD.conversationOrder.readStoredMode(window.localStorage),
    assetSession: null,
    solVoiceSession: null,
    solVoiceMapping: null,
    solVoiceAudioFiles: [],
    mediaObserver: null,
    solVoiceObserver: null,
    statusText: "",
    archiveStatus: null,
    statusError: false,
    renderToken: 0,
    lastSavedAt: null,
    persistenceError: "",
    saveTimer: null,
    pendingReconnectSourceId: null,
    restoredPosition: null,
    readerPrefs: OD.readerParity.normalizePreferences(),
    pages: [[]],
    pageIndex: 0,
    titleLabels: new Map(),
    groupState: { sources: {}, characters: {} },
    searchForcedOpen: false,
    bookmarks: [],
    editingBookmarkId: null,
    annotations: [],
    annotationColor: "yellow",
    organization: { favorites: {}, tags: {} },
    favoritesOnly: false,
    tagFilter: "",
    importOpen: null,
    readingProgress: {},
    readingOrder: [],
    searchScope: "current",
    searchSourceId: "all",
    toolTab: null,
    locale: "auto",
    booted: false
  };

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  }

  /* Dates and relative times follow the resolved UI locale via Intl, per
     the i18n handoff. Formatter instances are cached per locale; the option
     set is chosen to match the old toLocaleString() output for zh-CN. */
  const dateFormatters = {};
  const dateOnlyFormatters = {};
  const relativeFormatters = {};
  function uiLocaleTag() {
    return OD.i18n?.currentLocale?.() || "zh-CN";
  }

  function fmtDateOnly(value) {
    if (!value) return "";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    const locale = uiLocaleTag();
    try {
      const formatter = dateOnlyFormatters[locale] ||
        (dateOnlyFormatters[locale] = new Intl.DateTimeFormat(locale, { dateStyle: "long" }));
      return formatter.format(d);
    } catch (_) {
      return String(value).slice(0, 10);
    }
  }

  function fmtDate(value) {
    if (!value) return "";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    const locale = uiLocaleTag();
    try {
      const formatter = dateFormatters[locale] ||
        (dateFormatters[locale] = new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "medium" }));
      return formatter.format(d);
    } catch (_) {
      return d.toLocaleString();
    }
  }

  function fmtRelative(value) {
    const time = Date.parse(value ?? "");
    if (!Number.isFinite(time)) return "";
    const minutes = Math.round((Date.now() - time) / 60000);
    if (minutes < 1) return t("time.justNow");
    const locale = uiLocaleTag();
    let formatter = relativeFormatters[locale];
    if (formatter === undefined) {
      try { formatter = new Intl.RelativeTimeFormat(locale, { numeric: "always" }); }
      catch (_) { formatter = null; }
      relativeFormatters[locale] = formatter;
    }
    if (minutes < 60) return formatter ? formatter.format(-minutes, "minute") : `${minutes} min`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return formatter ? formatter.format(-hours, "hour") : `${hours} h`;
    const days = Math.round(hours / 24);
    if (days < 30) return formatter ? formatter.format(-days, "day") : `${days} d`;
    return fmtDate(value);
  }

  function fmtBytes(value) {
    const bytes = Number(value);
    if (!Number.isFinite(bytes) || bytes < 0) return "";
    if (bytes < 1024) return `${bytes} B`;
    const units = ["KB", "MB", "GB", "TB"];
    let amount = bytes / 1024;
    let unit = units[0];
    for (let i = 1; i < units.length && amount >= 1024; i += 1) {
      amount /= 1024;
      unit = units[i];
    }
    return `${amount >= 10 ? amount.toFixed(0) : amount.toFixed(1)} ${unit}`;
  }

  function solVoiceStatusText() {
    const stats = state.solVoiceSession?.stats;
    if (stats) {
      const gaps = [
        stats.missingMessageCount ? t("voice.missingMessages", { count: stats.missingMessageCount }) : "",
        stats.missingAudioCount ? t("voice.missingAudio", { count: stats.missingAudioCount }) : ""
      ].filter(Boolean).join(" · ");
      return `${t("voice.connected", { count: stats.attachedPlayerCount, strong: stats.strongMappingsTotal })}${gaps ? ` · ${gaps}` : ""}`;
    }
    if (state.solVoiceMapping && !state.archive) return t("voice.mappingReadyNeedChat");
    if (state.solVoiceMapping) return t("voice.mappingReadyNeedAudio");
    if (state.solVoiceAudioFiles.length) return t("voice.audioReadyNeedMapping", { count: state.solVoiceAudioFiles.length });
    return "";
  }

  function renderStatus() {
    $("status").textContent = [state.statusText, solVoiceStatusText()].filter(Boolean).join(" · ");
    $("status").classList.toggle("error", state.statusError);
    const voiceLine = $("voiceStatusLine");
    if (voiceLine) {
      const voice = solVoiceStatusText();
      voiceLine.textContent = voice;
      voiceLine.hidden = !voice;
    }
    renderLocalLibraryStatus();
  }

  function renderLocalLibraryStatus() {
    const element = $("localLibraryStatus");
    if (!element) return;
    if (!state.persistence?.supported) {
      element.textContent = t("status.noIndexedDB");
    } else if (state.persistenceError) {
      element.textContent = t("status.libraryError", { error: state.persistenceError });
    } else if (state.lastSavedAt) {
      element.textContent = t("status.librarySaved", { time: fmtDate(state.lastSavedAt) });
    } else {
      element.textContent = t("status.libraryReady");
    }
    const clear = $("clearLocalLibrary");
    if (clear) clear.disabled = state.library.size === 0 && !state.persistenceError;
  }

  function setStatus(text, error=false) {
    state.statusText = text;
    state.statusError = error;
    renderStatus();
  }

  /* The archive line ("已加入：… · 共 N 个来源") is replayed after voice
     operations and on locale change, so it is stored as {key, params} and
     rendered through t() each time instead of caching a finished string. */
  function archiveStatusText() {
    return state.archiveStatus ? t(state.archiveStatus.key, state.archiveStatus.params) : "";
  }

  function setArchiveStatus(key, params, error=false) {
    state.archiveStatus = key ? { key, params } : null;
    setStatus(archiveStatusText(), error);
  }

  function readSettingsMirror() {
    try {
      const value = JSON.parse(localStorage.getItem(SETTINGS_MIRROR_KEY) || "null");
      return value && typeof value === "object" ? value : null;
    } catch (_) {
      return null;
    }
  }

  function messageAnchorElement() {
    const messages = [...$("messages").querySelectorAll("[data-message-id]")];
    if (!messages.length) return null;
    const scrollTop = Number($("main").scrollTop || 0);
    return messages.find(element => Number(element.offsetTop || 0) >= scrollTop) || messages.at(-1);
  }

  function messageAnchor() {
    return messageAnchorElement()?.dataset?.messageId || null;
  }

  function readerSettings() {
    return {
      sourceFilter: state.sourceFilter,
      conversationSort: state.sortMode,
      hideUser: !!$("hideUser").checked,
      showThinking: !!$("showThinking").checked,
      locale: state.locale,
      ...state.readerPrefs,
      theme: $("theme").value || state.readerPrefs.theme,
      recentConversationId: state.current?.id || null,
      readingPosition: state.current ? {
        conversationId: state.current.id,
        messageId: messageAnchor(),
        page: state.pageIndex,
        scrollTop: Number($("main").scrollTop || 0),
        timestamp: new Date().toISOString()
      } : null,
      groupState: {
        sources: { ...state.groupState.sources },
        characters: { ...state.groupState.characters }
      },
      bookmarks: state.bookmarks.map(bookmark => ({ ...bookmark })),
      annotations: state.annotations.map(annotation => ({ ...annotation })),
      annotationColor: state.annotationColor,
      importOpen: state.importOpen,
      readingProgress: state.readingProgress,
      searchScope: state.searchScope,
      searchSourceId: state.searchSourceId,
      toolTab: state.toolTab,
      organization: OD.organization.normalize(state.organization),
      favoritesOnly: !!state.favoritesOnly,
      tagFilter: state.tagFilter || "",
      updatedAt: new Date().toISOString()
    };
  }

  function diagnosticToken(value) {
    let hash = 0x811c9dc5;
    for (const character of String(value ?? "")) {
      hash ^= character.codePointAt(0);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, "0");
  }

  function readingPositionDiagnostic(position) {
    return position ? {
      conversationToken: diagnosticToken(position.conversationId),
      messageToken: diagnosticToken(position.messageId),
      page: Number(position.page || 0),
      scrollTop: Math.round(Number(position.scrollTop || 0))
    } : null;
  }

  function updateAcceptanceReadingPosition(position) {
    const element = $("acceptanceAudit");
    if (!element) return;
    let current = {};
    try { current = JSON.parse(element.textContent || "{}"); } catch (_) {}
    element.textContent = JSON.stringify({
      ...current,
      readerPreferences: { ...state.readerPrefs },
      readingPosition: readingPositionDiagnostic(position)
    });
  }

  function applyReaderPreferences(value = state.readerPrefs) {
    state.readerPrefs = OD.readerParity.normalizePreferences(value);
    const root = document.documentElement;
    /* printPreset is a presentation alias above fontFamily: rendering prefers
       the preset's composite CJK/Latin family, but the stored fontFamily is
       never rewritten and takes over again the moment the preset is cleared. */
    const preset = state.readerPrefs.printPreset
      ? OD.readerParity.PRINT_PRESETS[state.readerPrefs.printPreset]
      : null;
    root.style?.setProperty?.("--reader-font-size", `${state.readerPrefs.fontSize}px`);
    root.style?.setProperty?.("--reader-line-height", String(state.readerPrefs.lineHeight));
    root.style?.setProperty?.("--cw", `${state.readerPrefs.contentWidth}px`);
    root.style?.setProperty?.("--reader-font-family", preset ? preset.family : OD.readerParity.FONT_FAMILIES[state.readerPrefs.fontFamily]);
    root.style?.setProperty?.("--reader-letter-spacing", preset ? preset.letterSpacing : "0");
    root.style?.setProperty?.("--reader-heading-size", preset ? `${preset.headingSize}px` : "27px");
    root.style?.setProperty?.("--reader-heading-line-height", preset ? String(preset.headingLineHeight) : "1.4");
    root.dataset.theme = state.readerPrefs.theme;
    $("theme").value = state.readerPrefs.theme;
    $("lineHeight").value = String(state.readerPrefs.lineHeight);
    $("contentWidth").value = String(state.readerPrefs.contentWidth);
    $("fontFamily").value = state.readerPrefs.fontFamily;
    const presetControl = $("printPreset");
    if (presetControl) presetControl.value = state.readerPrefs.printPreset || "";
    $("readingMode").value = state.readerPrefs.readingMode;
    $("pageLength").value = state.readerPrefs.pageLength;
    $("pageLength").disabled = state.readerPrefs.readingMode !== "page";
    document.body.classList.toggle("page-mode", state.readerPrefs.readingMode === "page");
    renderAaCards();
  }

  /* Style-only preference changes (size, leading, width, family, preset) do
     not re-render, so the layout shifts under the fixed scrollTop. Re-seat the
     view on the same anchored message instead of letting the text drift. */
  function restoreStyleAnchor(position) {
    if (!state.current || !position?.messageId) return;
    restoreReadingPosition({ messageId: position.messageId, scrollTop: position.scrollTop });
  }

  /* Aa panel cards mirror the normalized preferences; selection never relies
     on color alone (aria-pressed carries the state). */
  function renderAaCards() {
    for (const card of document.querySelectorAll?.("[data-theme-card]") || []) {
      card.setAttribute?.("aria-pressed", String(card.dataset?.themeCard === state.readerPrefs.theme));
    }
    for (const card of document.querySelectorAll?.("[data-preset-card]") || []) {
      card.setAttribute?.("aria-pressed", String(card.dataset?.presetCard === (state.readerPrefs.printPreset || "")));
    }
  }

  /* Every save also settles the per-conversation account: message anchor
     first, then page and scroll — the pattern proven per character in the
     standalone Mufy reader. */
  function recordReadingProgress() {
    if (!state.current) return;
    const source = state.library.sourceForConversation(state.current);
    const anchor = messageAnchorElement();
    const messageId = anchor?.dataset?.messageId || null;
    const main = $("main");
    /* How far the viewport bottom has travelled through the anchored
       message: neutral (clamps to 1) for chat messages shorter than the
       viewport, meaningful for one long personal document. Layouts that
       cannot be measured (fake DOM, zero heights) leave it undefined and
       keep the historical anchored-message-counts-as-read behaviour. */
    const anchorTop = Number(anchor?.offsetTop);
    const anchorHeight = Number(anchor?.offsetHeight);
    const viewportBottom = Number(main.scrollTop || 0) + Number(main.clientHeight);
    const fraction = anchorHeight > 0 && Number.isFinite(anchorTop) && Number.isFinite(viewportBottom)
      ? (viewportBottom - anchorTop) / anchorHeight
      : undefined;
    state.readingProgress = OD.readingProgress.record(state.readingProgress, state.current.id, {
      sourceId: source?.id ?? null,
      messageId,
      page: state.pageIndex,
      scrollTop: Number(main.scrollTop || 0),
      percent: OD.readingProgress.percent(state.current.messages, messageId, fraction)
    });
  }

  function saveReaderState({ immediate = false } = {}) {
    recordReadingProgress();
    const settings = readerSettings();
    updateAcceptanceReadingPosition(settings.readingPosition);
    try { localStorage.setItem(SETTINGS_MIRROR_KEY, JSON.stringify(settings)); } catch (_) {}
    if (!state.persistence?.supported) return Promise.resolve();
    const write = async () => {
      state.saveTimer = null;
      renderRecent();
      try {
        await state.persistence.saveSettings(settings);
      } catch (error) {
        state.persistenceError = error?.message || t("error.saveSettings");
        renderLocalLibraryStatus();
      }
    };
    if (immediate) {
      clearTimeout(state.saveTimer);
      state.saveTimer = null;
      return write();
    }
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(() => void write(), 180);
    return Promise.resolve();
  }

  async function persistSource(source) {
    if (!state.persistence?.supported || !source) return;
    try {
      state.lastSavedAt = await state.persistence.saveSource(source);
      state.persistenceError = "";
      await saveReaderState({ immediate: true });
    } catch (error) {
      console.warn("Could not save the local text library", error);
      state.persistenceError = error?.message || t("error.saveSource");
    }
    renderLocalLibraryStatus();
  }

  function currentTitleSourceCounts() {
    const counts = {};
    let mufyConversations = 0;
    for (const source of state.library.sources()) {
      if (source.source?.platform !== "mufy") continue;
      for (const conversation of source.conversations) {
        mufyConversations += 1;
        const value = conversation.metadata?.titleSource || conversation.context?.sourceMetadata?.titleSource || "missing";
        counts[value] = (counts[value] || 0) + 1;
      }
    }
    return { mufyConversations, titleSourceCounts: counts };
  }

  async function refreshAcceptanceAudit() {
    const element = $("acceptanceAudit");
    if (!element) return null;
    try {
      const persistence = await state.persistence?.audit?.();
      const titles = currentTitleSourceCounts();
      const result = {
        ...persistence,
        ...titles,
        fallbackRatio: titles.mufyConversations
          ? (titles.titleSourceCounts.fallback || 0) / titles.mufyConversations
          : 0,
        readerPreferences: { ...state.readerPrefs },
        readingPosition: readingPositionDiagnostic(readerSettings().readingPosition)
      };
      element.textContent = JSON.stringify(result);
      return result;
    } catch (error) {
      element.textContent = JSON.stringify({ error: error?.message || String(error) });
      return null;
    }
  }

  function conversationHaystack(c) {
    const body = (c.messages || []).map(m => {
      const trace = Array.isArray(m.metadata?.sourceTrace)
        ? m.metadata.sourceTrace.map(item => item?.text || "").join("\n")
        : "";
      return [OD.schema.textOf(m.content), trace].filter(Boolean).join("\n");
    }).join("\n");
    return `${c.title}\n${body}`.toLowerCase();
  }

  function releaseRenderedAssets() {
    state.renderToken += 1;
    state.mediaObserver?.disconnect();
    state.mediaObserver = null;
    state.solVoiceObserver?.disconnect();
    state.solVoiceObserver = null;
    try {
      state.assetSession?.objectURLs?.revokeAll?.();
    } catch (error) {
      console.warn("Could not release attachment object URLs", error);
    }
    try {
      state.solVoiceSession?.objectURLs?.revokeAll?.();
    } catch (error) {
      console.warn("Could not release SolVoice object URLs", error);
    }
  }

  function releaseArchiveAssets() {
    releaseRenderedAssets();
    state.assetSession = null;
    state.library.clear();
    try {
      state.solVoiceSession?.dispose?.();
    } catch (error) {
      console.warn("Could not dispose SolVoice session", error);
    }
    state.solVoiceSession = null;
  }

  /* Personal documents enter document mode only through this explicit
     marker — never inferred from shape (one participant, one message, or
     role "other" alone must not trigger it). */
  function isDocumentConversation(conversation) {
    return conversation?.context?.sourceMetadata?.contentKind === "personal-document";
  }

  function displayConversationTitle(conversation) {
    const sourceMetadata = conversation?.context?.sourceMetadata;
    if (sourceMetadata?.contentKind === "personal-document" &&
        sourceMetadata.titleSource === "date" && conversation.createdAt) {
      const formatted = fmtDateOnly(conversation.createdAt);
      if (formatted) return formatted;
    }
    return state.titleLabels.get(String(conversation?.id)) || String(conversation?.title || "");
  }

  function progressLabel(entry) {
    if (!entry) return "";
    if (OD.readingProgress.isFinished(entry)) return t("progress.finished");
    return entry.percent > 0 ? t("progress.readTo", { percent: entry.percent }) : "";
  }

  function conversationMarkup(c) {
    const active = state.current?.id === c.id ? " on" : "";
    const documentRow = isDocumentConversation(c);
    const progress = progressLabel(state.readingProgress[c.id]);
    const favorite = OD.organization.isFavorite(state.organization, c.id) ? `<span class="conv-star" title="${esc(t("organize.favoritedTitle"))}">⭐</span> ` : "";
    const tagChips = OD.organization.tagsOf(state.organization, c.id).slice(0, 3)
      .map(tag => `<span class="conv-tag">${esc(tag)}</span>`).join("");
    /* Document rows skip the transcript message count, and a date-titled
       entry does not repeat its date in the meta line. */
    const metaBits = [];
    if (!documentRow) metaBits.push(esc(t("conv.messageCount", { count: c.messages.length })));
    if (c.context?.room?.name) metaBits.push(esc(c.context.room.name));
    if (c.createdAt && !(documentRow && c.context?.sourceMetadata?.titleSource === "date")) {
      metaBits.push(esc(documentRow ? fmtDateOnly(c.createdAt) : fmtDate(c.createdAt)));
    }
    if (progress) metaBits.push(`<span class="conv-progress">${esc(progress)}</span>`);
    return `<div class="conv${active}" data-id="${esc(c.id)}">
      <div class="conv-title">${favorite}${esc(displayConversationTitle(c))}</div>
      <div class="conv-meta">${metaBits.join(" · ")}${tagChips ? ` ${tagChips}` : ""}</div>
    </div>`;
  }

  function mufyCharacter(conversation) {
    const metadata = conversation.context?.sourceMetadata || {};
    const characterId = metadata.characterId == null || String(metadata.characterId).trim() === ""
      ? null
      : String(metadata.characterId);
    const participant = (conversation.participants || []).find(item => item?.role === "assistant");
    return {
      key: characterId ? `id:${characterId}` : `missing:${conversation.id}`,
      id: characterId,
      name: String(metadata.characterName || participant?.name || t("conv.unnamedCharacter"))
    };
  }

  function isGreetingConversation(conversation) {
    return conversation.context?.sourceMetadata?.isGreeting === true;
  }

  /* Optional year headings (display-only): shown only when one character or
     source holds >=12 conversations spanning >=2 years with >=70% valid
     dates. Headings never change the sort result or the reading order — the
     sorted sequence is walked as-is, and since undated items already sort
     last in both directions, 日期不详 lands at the bottom naturally. Pinned
     greetings render before any heading so the pin stays visibly first. */
  function conversationYear(conversation) {
    const time = Date.parse(conversation?.createdAt ?? "");
    return Number.isFinite(time) ? String(new Date(time).getFullYear()) : null;
  }

  function shouldGroupByYear(conversations) {
    if ((conversations?.length || 0) < 12) return false;
    const years = new Set();
    let dated = 0;
    for (const conversation of conversations) {
      const year = conversationYear(conversation);
      if (year) { years.add(year); dated += 1; }
    }
    return years.size >= 2 && dated / conversations.length >= 0.7;
  }

  function conversationListMarkup(ordered, { skipLeading = 0 } = {}) {
    if (!shouldGroupByYear(ordered)) return ordered.map(conversationMarkup).join("");
    let html = "";
    let currentYear;
    ordered.forEach((conversation, index) => {
      if (index < skipLeading) {
        html += conversationMarkup(conversation);
        return;
      }
      const year = conversationYear(conversation) || t("conv.unknownYear");
      if (year !== currentYear) {
        currentYear = year;
        html += `<div class="year-heading" aria-hidden="true">${esc(year)}</div>`;
      }
      html += conversationMarkup(conversation);
    });
    return html;
  }

  /* ── Personal Archive directory: Source → Collection → Year → Entry ──
     Collections are collapsible groups reusing the character-group
     machinery (same class, same groupState.characters storage under a
     "collection:"-prefixed key, same toggle listener). Year headings are
     display-only and appear once a collection's dated entries span more
     than one year; undated entries trail under 日期未知. Sort order inside
     a collection follows the Reader sort mode untouched — the rendered
     order is pushed into readingOrder exactly as the eye sees it. */
  function personalYearListMarkup(ordered) {
    const years = new Set(ordered.map(conversationYear).filter(Boolean));
    if (years.size < 2) return ordered.map(conversationMarkup).join("");
    let html = "";
    let currentHeading;
    for (const conversation of ordered) {
      const heading = conversationYear(conversation) || t("personal.unknownDate");
      if (heading !== currentHeading) {
        currentHeading = heading;
        html += `<div class="year-heading" aria-hidden="true">${esc(heading)}</div>`;
      }
      html += conversationMarkup(conversation);
    }
    return html;
  }

  function personalCollectionsMarkup(source, conversations, searching, readingOrder) {
    const groups = new Map();
    const groupFor = conversation => {
      const collectionId = String(conversation.context?.sourceMetadata?.collectionId ?? "");
      if (!groups.has(collectionId)) {
        groups.set(collectionId, {
          id: collectionId,
          name: conversation.context?.sourceMetadata?.collectionName || collectionId || source.label,
          type: conversation.context?.sourceMetadata?.documentType || "other",
          conversations: []
        });
      }
      return groups.get(collectionId);
    };
    // The archive's own declaration order decides collection order…
    for (const conversation of source.conversations) groupFor(conversation);
    // …and the caller's sorted, filtered list fills the visible entries.
    for (const conversation of conversations) groupFor(conversation).conversations.push(conversation);
    return [...groups.values()].filter(group => group.conversations.length).map(group => {
      readingOrder?.push(...group.conversations);
      const collectionKey = `${source.id}::collection:${group.id}`;
      const stored = state.groupState.characters[collectionKey];
      const containsCurrent = group.conversations.some(conversation => conversation.id === state.current?.id);
      const open = searching || (stored === undefined ? containsCurrent : stored === true);
      return `<details class="character-group" data-character-key="${esc(collectionKey)}"${open ? " open" : ""}>
        <summary>
          <span class="character-summary-label" title="${esc(t(`personal.type.${group.type}`))}">${esc(group.name)}</span>
          <span class="character-count">${group.conversations.length}</span>
        </summary>
        <div class="character-conversations">${personalYearListMarkup(group.conversations)}</div>
      </details>`;
    }).join("");
  }

  function sourceRowMenuMarkup(source, conversationCount) {
    const canReconnect = source.assetMode === "local-reconnect" || source.directoryHandle;
    return `<div class="source-row-menu" hidden>
      <div class="source-row-details">${esc(t("source.conversationCount", { count: conversationCount }))}${source.importDetails ? ` · ${esc(source.importDetails)}` : ""}</div>
      ${canReconnect ? `<button type="button" data-reconnect-source-row="${esc(source.id)}">${esc(t("source.reconnect"))}</button>` : ""}
      <button type="button" data-remove-source="${esc(source.id)}" class="od-danger-quiet">${esc(t("source.removeThis"))}</button>
    </div>`;
  }

  function sourceMarkup(source, conversations, searching, readingOrder) {
    let children = "";
    if (source.source?.platform === "mufy") {
      const characters = new Map();
      for (const conversation of conversations) {
        const character = mufyCharacter(conversation);
        const group = characters.get(character.key) || { ...character, conversations: [] };
        group.conversations.push(conversation);
        characters.set(character.key, group);
      }
      children = [...characters.values()].map(character => {
        // The greeting chapter stays pinned first inside its character,
        // regardless of the date sort — sessions keep the chosen order.
        const ordered = [
          ...character.conversations.filter(isGreetingConversation),
          ...character.conversations.filter(conversation => !isGreetingConversation(conversation))
        ];
        readingOrder?.push(...ordered);
        const characterKey = `${source.id}::${character.key}`;
        const stored = state.groupState.characters[characterKey];
        const containsCurrent = character.conversations.some(conversation => conversation.id === state.current?.id);
        const open = searching || (stored === undefined ? containsCurrent : stored === true);
        const pinnedCount = ordered.filter(isGreetingConversation).length;
        return `<details class="character-group" data-character-key="${esc(characterKey)}"${open ? " open" : ""}>
        <summary>
          <span class="character-summary-label">${esc(character.name)}${character.id ? `<small class="character-identity">${esc(character.id)}</small>` : ""}</span>
          <span class="character-count">${character.conversations.length}</span>
        </summary>
        <div class="character-conversations">${conversationListMarkup(ordered, { skipLeading: pinnedCount })}</div>
      </details>`;
      }).join("");
    } else if (source.source?.platform === "personal-archive") {
      children = personalCollectionsMarkup(source, conversations, searching, readingOrder);
    } else {
      readingOrder?.push(...conversations);
      children = `<div class="source-conversations">${conversationListMarkup(conversations)}</div>`;
    }
    const storedSource = state.groupState.sources[source.id];
    const sourceOpen = searching || (storedSource === undefined ? true : storedSource !== false);
    return `<details class="source-group" data-source-id="${esc(source.id)}"${sourceOpen ? " open" : ""}>
      <summary>
        <span class="source-summary-label">${esc(source.label)}</span>
        <span class="source-count">${conversations.length}</span>
        <button class="source-menu-button" type="button" data-source-menu="${esc(source.id)}" title="${esc(t("source.menuTitle"))}" aria-haspopup="true" aria-label="${esc(t("source.menuAria", { label: source.label }))}">···</button>
      </summary>
      ${sourceRowMenuMarkup(source, conversations.length)}
      ${children}
    </details>`;
  }

  function bookmarkSnippet(conversation, messageId) {
    const message = (conversation.messages || []).find(item => String(item.id) === String(messageId));
    return message ? OD.schema.textOf(message.content) : "";
  }

  function addBookmark() {
    if (!state.current) {
      setStatus(t("bookmark.needConversation"), true);
      return null;
    }
    const source = state.library.sourceForConversation(state.current);
    const messageId = messageAnchor();
    const bookmark = OD.bookmarks.create({
      sourceId: source?.id ?? null,
      sourceLabel: source?.label || "",
      conversationId: state.current.id,
      conversationTitle: displayConversationTitle(state.current),
      messageId,
      snippet: messageId ? bookmarkSnippet(state.current, messageId) : ""
    });
    state.bookmarks = OD.bookmarks.add(state.bookmarks, bookmark);
    renderBookmarks();
    void saveReaderState();
    setStatus(t("bookmark.saved", { title: OD.bookmarks.displayTitle(bookmark) }));
    return bookmark;
  }

  function removeBookmark(id) {
    state.bookmarks = OD.bookmarks.remove(state.bookmarks, id);
    if (state.editingBookmarkId === String(id)) state.editingBookmarkId = null;
    renderBookmarks();
    void saveReaderState();
  }

  function renameBookmark(id, label) {
    state.bookmarks = OD.bookmarks.rename(state.bookmarks, id, label);
    state.editingBookmarkId = null;
    renderBookmarks();
    void saveReaderState();
  }

  function jumpToBookmark(id) {
    const bookmark = state.bookmarks.find(item => item.id === String(id));
    if (!bookmark) return false;
    const exists = (state.archive?.conversations || []).some(item => item.id === bookmark.conversationId);
    if (!exists) {
      setStatus(t("bookmark.missingSource"), true);
      return false;
    }
    openConversation(bookmark.conversationId, { restorePosition: { messageId: bookmark.messageId } });
    if (bookmark.messageId) {
      const target = [...$("messages").querySelectorAll("[data-message-id]")]
        .find(element => element?.dataset?.messageId === bookmark.messageId);
      target?.classList?.add?.("bookmark-flash");
    }
    return true;
  }

  function renderBookmarks() {
    const list = $("bookmarksList");
    const count = $("bookmarksCount");
    if (!list || !count) return;
    count.textContent = state.bookmarks.length ? String(state.bookmarks.length) : "";
    if (!state.bookmarks.length) {
      list.innerHTML = `<div class="bookmarks-empty">${esc(t("bookmark.empty"))}</div>`;
      return;
    }
    const available = new Set((state.archive?.conversations || []).map(conversation => conversation.id));
    list.innerHTML = state.bookmarks.map(bookmark => {
      const missing = !available.has(bookmark.conversationId);
      const editing = state.editingBookmarkId === bookmark.id;
      const title = editing
        ? `<input class="bookmark-rename" data-bookmark-rename="${esc(bookmark.id)}" value="${esc(bookmark.label)}" placeholder="${esc(bookmark.conversationTitle)}" aria-label="${esc(t("bookmark.renameAria"))}">`
        : `<div class="bookmark-title">${esc(OD.bookmarks.displayTitle(bookmark))}</div>`;
      return `<div class="bookmark${missing ? " missing" : ""}" data-bookmark-id="${esc(bookmark.id)}">
        <div class="bookmark-head">
          ${title}
          <span class="bookmark-actions">
            <button type="button" data-bookmark-edit="${esc(bookmark.id)}" title="${esc(t("bookmark.rename"))}" aria-label="${esc(t("bookmark.rename"))}">✎</button>
            <button type="button" data-bookmark-remove="${esc(bookmark.id)}" title="${esc(t("bookmark.remove"))}" aria-label="${esc(t("bookmark.remove"))}">✕</button>
          </span>
        </div>
        ${bookmark.snippet ? `<div class="bookmark-snippet">${esc(bookmark.snippet)}</div>` : ""}
        <div class="bookmark-meta">${esc(bookmark.sourceLabel || "")}${missing ? esc(t("common.sourceMissingSuffix")) : ""}${bookmark.createdAt ? ` · ${esc(fmtDate(bookmark.createdAt))}` : ""}</div>
      </div>`;
    }).join("");
    [...document.querySelectorAll("#bookmarksList .bookmark")].forEach(element => {
      element.addEventListener("click", () => jumpToBookmark(element.dataset.bookmarkId));
    });
    [...document.querySelectorAll("[data-bookmark-remove]")].forEach(button => {
      button.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        removeBookmark(button.dataset.bookmarkRemove);
      });
    });
    [...document.querySelectorAll("[data-bookmark-edit]")].forEach(button => {
      button.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        state.editingBookmarkId = button.dataset.bookmarkEdit;
        renderBookmarks();
        const input = document.querySelector?.("[data-bookmark-rename]");
        input?.focus?.();
        input?.select?.();
      });
    });
    [...document.querySelectorAll("[data-bookmark-rename]")].forEach(input => {
      input.addEventListener("click", event => event.stopPropagation());
      input.addEventListener("keydown", event => {
        if (event.key === "Enter") renameBookmark(input.dataset.bookmarkRename, input.value);
        if (event.key === "Escape") {
          state.editingBookmarkId = null;
          renderBookmarks();
        }
      });
      input.addEventListener("blur", () => {
        if (state.editingBookmarkId === input.dataset.bookmarkRename) {
          renameBookmark(input.dataset.bookmarkRename, input.value);
        }
      });
    });
  }

  /* 3–5 character marks compress the full mother stroke (the one approved
     full-stroke scaling); everything longer composes the three-part assets.
     A DOM pass after render keeps annotations.js' anchoring untouched. */
  function markShortHighlights() {
    for (const mark of $("messages").querySelectorAll?.("mark.annotation") || []) {
      const characters = Array.from(String(mark.textContent || "").trim()).length;
      mark.classList?.toggle?.("od-hl-short", characters > 0 && characters <= 5);
    }
  }

  /* Re-render every t()-derived surface after the resolved locale changes,
     preserving the reading anchor. Archive data (titles, speakers, message
     text) is never touched — only chrome re-renders. */
  function applyLocaleToChrome() {
    const position = state.current ? readerSettings().readingPosition : null;
    OD.i18n?.applyStatic?.(document);
    renderAnnotationSwatches();
    renderSourceControls();
    if (state.current) {
      openConversation(state.current.id, { restorePosition: position });
    } else {
      renderList();
      if (libraryHomeVisible()) showLibraryHome();
      else $("currentTitle").textContent = t("reader.noArchive");
    }
    syncOrganizeControls();
    if ($("tagEditor")?.hidden === false) renderTagEditor();
    performSearch();
    state.statusText = archiveStatusText();
    renderStatus();
  }

  function setUiLocale(value) {
    if (!OD.i18n) return;
    const normalized = OD.i18n.normalizeSetting(value);
    state.locale = normalized;
    const control = $("uiLocale");
    if (control) control.value = normalized;
    const before = OD.i18n.currentLocale();
    if (OD.i18n.setLocale(normalized) !== before) applyLocaleToChrome();
    void saveReaderState();
  }

  /* Re-render the current page in place — saving or removing a highlight must
     not scroll the reader back to the top the way a full reopen would. */
  function refreshCurrentMessages() {
    if (!state.current) return;
    const scrollTop = Number($("main").scrollTop || 0);
    const renderedAttachments = [];
    const renderedSolVoice = [];
    $("messages").innerHTML = (state.pages[state.pageIndex] || [])
      .map(message => messageMarkup(message, renderedAttachments, renderedSolVoice))
      .join("");
    prepareLazyAttachments(renderedAttachments);
    prepareLazySolVoice(renderedSolVoice);
    markShortHighlights();
    $("main").scrollTop = scrollTop;
  }

  function addAnnotation(fields) {
    if (!state.current) {
      setStatus(t("annotate.needConversation"), true);
      return null;
    }
    const source = state.library.sourceForConversation(state.current);
    const annotation = OD.annotations.create({
      color: state.annotationColor,
      ...fields,
      sourceId: source?.id ?? null,
      sourceLabel: source?.label || "",
      conversationId: state.current.id,
      conversationTitle: displayConversationTitle(state.current)
    });
    if (!annotation) {
      setStatus(t("annotate.noText"), true);
      return null;
    }
    state.annotationColor = annotation.color;
    state.annotations = OD.annotations.add(state.annotations, annotation);
    refreshCurrentMessages();
    renderAnnotations();
    void saveReaderState();
    setStatus(annotation.note ? t("annotate.savedWithNote") : t("annotate.saved"));
    return annotation;
  }

  function updateAnnotation(id, patch) {
    state.annotations = OD.annotations.update(state.annotations, id, patch);
    if (patch && "color" in patch) state.annotationColor = OD.annotations.normalizeColor(patch.color);
    refreshCurrentMessages();
    renderAnnotations();
    void saveReaderState();
  }

  function removeAnnotation(id) {
    state.annotations = OD.annotations.remove(state.annotations, id);
    refreshCurrentMessages();
    renderAnnotations();
    void saveReaderState();
  }

  function jumpToAnnotation(id) {
    const annotation = state.annotations.find(item => item.id === String(id));
    if (!annotation) return false;
    const exists = (state.archive?.conversations || []).some(item => item.id === annotation.conversationId);
    if (!exists) {
      setStatus(t("annotate.missingSource"), true);
      return false;
    }
    openConversation(annotation.conversationId, { restorePosition: { messageId: annotation.messageId } });
    const mark = $("messages").querySelector?.(`mark[data-annotation-id="${annotation.id}"]`);
    mark?.classList?.add?.("annotation-flash");
    return true;
  }

  function renderAnnotations() {
    const list = $("annotationsList");
    const count = $("annotationsCount");
    if (!list || !count) return;
    count.textContent = state.annotations.length ? String(state.annotations.length) : "";
    if (!state.annotations.length) {
      list.innerHTML = `<div class="bookmarks-empty">${esc(t("annotate.empty"))}</div>`;
      return;
    }
    const available = new Set((state.archive?.conversations || []).map(conversation => conversation.id));
    list.innerHTML = state.annotations.map(annotation => {
      const missing = !available.has(annotation.conversationId);
      const excerpt = annotation.selectedText.length > 46
        ? `${annotation.selectedText.slice(0, 46)}…`
        : annotation.selectedText;
      return `<div class="annotation-item${missing ? " missing" : ""}" data-annotation-item="${esc(annotation.id)}">
        <div class="bookmark-head">
          <span class="annotation-dot hl-${esc(annotation.color)}" aria-hidden="true"></span>
          <div class="bookmark-title">${esc(excerpt)}</div>
          <span class="bookmark-actions">
            <button type="button" data-annotation-remove="${esc(annotation.id)}" title="${esc(t("annotate.remove"))}" aria-label="${esc(t("annotate.remove"))}">✕</button>
          </span>
        </div>
        ${annotation.note ? `<div class="bookmark-snippet">📝 ${esc(annotation.note)}</div>` : ""}
        <div class="bookmark-meta">${esc(annotation.conversationTitle || "")}${missing ? esc(t("common.sourceMissingSuffix")) : ""}${annotation.createdAt ? ` · ${esc(fmtDate(annotation.createdAt))}` : ""}</div>
      </div>`;
    }).join("");
    [...document.querySelectorAll("#annotationsList .annotation-item")].forEach(element => {
      element.addEventListener("click", () => jumpToAnnotation(element.dataset.annotationItem));
    });
    [...document.querySelectorAll("[data-annotation-remove]")].forEach(button => {
      button.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        removeAnnotation(button.dataset.annotationRemove);
      });
    });
  }

  /* The import section stays open while the library is empty (a first run
     needs those buttons front and center) and folds away once sources exist —
     unless the user has toggled it, which wins and persists. Programmatic
     toggles are consumed by the listener so they are never recorded as the
     user's choice (the toggle event fires asynchronously). */
  let pendingImportSync = null;
  function syncImportPanel() {
    const panel = $("importPanel");
    if (!panel) return;
    const shouldOpen = state.importOpen === null ? state.library.size === 0 : state.importOpen;
    if (panel.open === shouldOpen) return;
    pendingImportSync = shouldOpen;
    panel.open = shouldOpen;
  }

  function renderRecent() {
    const list = $("recentList");
    const count = $("recentCount");
    if (!list || !count) return;
    const entries = OD.readingProgress.recent(state.readingProgress, 10);
    count.textContent = entries.length ? String(entries.length) : "";
    if (!entries.length) {
      list.innerHTML = `<div class="bookmarks-empty">${esc(t("recent.empty"))}</div>`;
      return;
    }
    const conversations = new Map((state.archive?.conversations || []).map(conversation => [conversation.id, conversation]));
    list.innerHTML = entries.map(entry => {
      const conversation = conversations.get(entry.conversationId);
      const missing = !conversation;
      const title = conversation ? displayConversationTitle(conversation) : entry.conversationId;
      const finished = OD.readingProgress.isFinished(entry);
      const label = finished ? t("progress.finished") : (entry.percent > 0 ? t("progress.readTo", { percent: entry.percent }) : t("progress.justStarted"));
      return `<div class="recent-item${missing ? " missing" : ""}" data-recent-id="${esc(entry.conversationId)}">
        <div class="bookmark-head">
          <div class="bookmark-title">${esc(title)}</div>
          <span class="recent-progress${finished ? " finished" : ""}">${esc(label)}</span>
        </div>
        <div class="bookmark-meta">${missing ? esc(t("common.sourceMissing")) : esc(fmtDate(entry.updatedAt))}</div>
      </div>`;
    }).join("");
    [...document.querySelectorAll("#recentList .recent-item")].forEach(element => {
      element.addEventListener("click", () => {
        const id = element.dataset.recentId;
        if ((state.archive?.conversations || []).some(conversation => conversation.id === id)) {
          openConversation(id);
        } else {
          setStatus(t("recent.missingSource"), true);
        }
      });
    });
  }

  /* The sidebar shows exactly one primary mode at a time: 书库 (toolTab null),
     阅读痕迹 (recent/bookmarks/annotations as its inner segments), or 搜索.
     The persisted toolTab value keeps its historical five-value domain, so
     records written before this layout restore into the right mode. */
  /* ── Library Home (D1): a quiet archive entry, not a dashboard ── */
  function renderLibraryHome() {
    const home = $("libraryHome");
    if (!home) return;
    const conversations = state.archive?.conversations || [];
    const conversationById = new Map(conversations.map(conversation => [conversation.id, conversation]));

    const card = $("continueCard");
    if (card) {
      const entry = OD.readingProgress.recent(state.readingProgress, 5)
        .map(item => ({ ...item, conversation: conversationById.get(item.conversationId) }))
        .find(item => item.conversation) || null;
      if (!entry) {
        card.innerHTML = `<div class="continue-card continue-empty">${esc(t("home.continueEmpty"))}</div>`;
      } else {
        const conversation = entry.conversation;
        const source = state.library.sourceForConversation(conversation);
        const total = conversation.messages.length;
        const index = Math.max(1, conversation.messages.findIndex(message => String(message.id) === String(entry.messageId)) + 1);
        const excerpt = OD.schema.textOf(conversation.messages[index - 1]?.content ?? "")
          .trim().replace(/\s+/g, " ").slice(0, 64);
        const percent = Math.max(0, Math.min(100, Number(entry.percent) || 0));
        card.innerHTML = `<div class="continue-card" data-home-open="${esc(conversation.id)}" role="link" tabindex="0" aria-label="${esc(t("home.continueAria", { title: displayConversationTitle(conversation) }))}">
          <div class="continue-eyebrow">${esc(t("home.lastRead", { time: fmtRelative(entry.updatedAt) }))}</div>
          <div class="continue-title">${esc(displayConversationTitle(conversation))}</div>
          <div class="continue-meta">${esc(source?.label || "")}${conversation.createdAt ? ` · ${esc(fmtDate(conversation.createdAt))}` : ""} · ${esc(t("home.segmentPosition", { index, total }))}</div>
          ${excerpt ? `<div class="continue-excerpt">“${esc(excerpt)}”</div>` : ""}
          <div class="continue-foot">
            <div class="continue-progress" aria-hidden="true"><span style="width:${percent}%"></span></div>
            <span class="continue-cta">${esc(t("home.continueCta"))}</span>
          </div>
        </div>`;
      }
    }

    const additions = $("recentAdditions");
    if (additions) {
      const newest = OD.conversationOrder.sortConversations(conversations, "desc").slice(0, 3);
      additions.innerHTML = newest.length ? newest.map(conversation => {
        const source = state.library.sourceForConversation(conversation);
        return `<div class="home-addition" data-home-open="${esc(conversation.id)}" role="link" tabindex="0">
          <div class="home-addition-title">${esc(displayConversationTitle(conversation))}</div>
          <div class="home-addition-meta">${esc(source?.label || "")}${conversation.createdAt ? ` · ${esc(fmtDate(conversation.createdAt))}` : ""} · ${esc(t("conv.segmentCount", { count: conversation.messages.length }))}</div>
        </div>`;
      }).join("") : `<div class="bookmarks-empty">${esc(t("home.additionsEmpty"))}</div>`;
    }

    const summary = $("librarySummary");
    if (summary) {
      summary.innerHTML = `<div class="summary-grid">
        <div class="summary-item"><strong>${state.library.size}</strong><span>${esc(t("home.sourcesUnit", { count: state.library.size }))}</span></div>
        <div class="summary-item"><strong>${esc(conversations.length.toLocaleString(uiLocaleTag()))}</strong><span>${esc(t("home.conversationsUnit", { count: conversations.length }))}</span></div>
        <div class="summary-item"><strong>${state.bookmarks.length}</strong><span>${esc(t("home.bookmarksUnit", { count: state.bookmarks.length }))}</span></div>
        <div class="summary-item"><strong>${state.annotations.length}</strong><span>${esc(t("home.highlightsUnit", { count: state.annotations.length }))}</span></div>
      </div>
      <div class="summary-note">${esc(t("home.note"))}</div>`;
    }

    [...(home.querySelectorAll?.("[data-home-open]") || [])].forEach(element => {
      const open = () => openConversation(element.dataset.homeOpen);
      element.addEventListener("click", open);
      element.addEventListener("keydown", event => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault?.();
          open();
        }
      });
    });
  }

  function libraryHomeVisible() {
    return $("libraryHome")?.classList?.contains?.("hidden") === false;
  }

  function showLibraryHome() {
    if (!state.archive) return false;
    renderLibraryHome();
    $("reader").classList.add("hidden");
    $("welcome").classList.add("hidden");
    $("libraryHome")?.classList?.remove?.("hidden");
    $("currentTitle").textContent = t("nav.library");
    return true;
  }

  const TOOL_PANES = {
    recent: ["toolTabRecent", "recentPane"],
    bookmarks: ["toolTabBookmarks", "bookmarksPane"],
    annotations: ["toolTabAnnotations", "annotationsPane"]
  };
  const TRACE_TABS = ["recent", "bookmarks", "annotations"];
  let lastTraceTab = "recent";

  function sidebarMode() {
    if (state.toolTab === "search") return "search";
    return TRACE_TABS.includes(state.toolTab) ? "traces" : "library";
  }

  function syncToolTabs() {
    const mode = sidebarMode();
    if (TRACE_TABS.includes(state.toolTab)) lastTraceTab = state.toolTab;
    const libraryPane = $("libraryPane");
    if (libraryPane) libraryPane.hidden = mode !== "library";
    const tracesPane = $("tracesPane");
    if (tracesPane) tracesPane.hidden = mode !== "traces";
    const searchPane = $("searchPane");
    if (searchPane) searchPane.hidden = mode !== "search";
    $("navLibrary")?.setAttribute?.("aria-pressed", String(mode === "library"));
    $("navTraces")?.setAttribute?.("aria-pressed", String(mode === "traces"));
    $("toolTabSearch")?.setAttribute?.("aria-pressed", String(mode === "search"));
    const panels = $("toolPanels");
    if (panels) panels.hidden = mode !== "traces";
    for (const [name, [tabId, paneId]] of Object.entries(TOOL_PANES)) {
      $(tabId)?.setAttribute?.("aria-pressed", String(state.toolTab === name));
      const pane = $(paneId);
      if (pane) pane.hidden = mode !== "traces" || state.toolTab !== name;
    }
  }

  function setToolTab(name) {
    state.toolTab = name ?? null;
    syncToolTabs();
    if (state.toolTab === "search") $("searchQuery")?.focus?.();
    void saveReaderState();
  }

  /* One-click synthetic sample library, so a stranger can see what the
     Reader is before trusting it with real archives. Served from the repo's
     public fixtures; needs http(s), so the button stays hidden on file://. */
  const DEMO_FIXTURES = [
    "fixtures/normalized-v1.json",
    "fixtures/ciel-house-v1.json",
    "fixtures/chatgpt-official-2026.json",
    "fixtures/claude-official-2026.json",
    "fixtures/personal-archive-v1-synthetic.json"
  ];

  async function loadDemoLibrary(fetcher) {
    const fetchOne = fetcher || (url => window.fetch(url));
    let added = 0;
    for (const url of DEMO_FIXTURES) {
      try {
        const response = await fetchOne(url);
        if (!response?.ok) continue;
        const parsed = await OD.registry.parseJSON(await response.json());
        if (!parsed?.recognized) continue;
        loadArchive(parsed.archive, t("demo.sourceLabel", { label: parsed.archive?.source?.sourceLabel || parsed.adapter.label }));
        added += 1;
      } catch (error) {
        console.warn("示例文件载入失败", url, error);
      }
    }
    setStatus(added ? t("demo.loaded") : t("demo.failed"), !added);
    return added;
  }

  /* buildExport returns {filename, mimeType, content}; the download itself is
     a separate browser-only step so tests can assert on the payload. */
  function buildExport(kind) {
    const sourceLabelOf = conversation => state.library.sourceForConversation(conversation)?.label || "";
    if (["current-markdown", "current-json", "current-html"].includes(kind)) {
      if (!state.current) {
        setStatus(t("export.needConversation"), true);
        return null;
      }
      const title = displayConversationTitle(state.current);
      if (kind === "current-markdown") {
        return { filename: OD.exporter.safeFilename(title, "md"), mimeType: "text/markdown",
          content: OD.exporter.conversationToMarkdown(state.current, { sourceLabel: sourceLabelOf(state.current) }) };
      }
      if (kind === "current-html") {
        return { filename: OD.exporter.safeFilename(title, "html"), mimeType: "text/html",
          content: OD.exporter.conversationsToHTML([state.current], { title, sourceLabelOf }) };
      }
      return { filename: OD.exporter.safeFilename(title, "json"), mimeType: "application/json",
        content: OD.exporter.conversationToJSON(state.current) };
    }
    if (!state.filtered.length) {
      setStatus(t("export.emptyList"), true);
      return null;
    }
    const stamp = new Date().toISOString().slice(0, 10);
    const listName = extension =>
      OD.exporter.safeFilename(t("export.listFilename", { stamp, count: state.filtered.length }), extension);
    if (kind === "list-markdown") {
      return { filename: listName("md"), mimeType: "text/markdown",
        content: OD.exporter.conversationsToMarkdown(state.filtered, { sourceLabelOf }) };
    }
    if (kind === "list-epub") {
      return { filename: listName("epub"), mimeType: "application/epub+zip",
        content: OD.epub.buildEpub({
          title: `Our Dialogues · ${stamp}`,
          conversations: state.filtered,
          sourceLabelOf
        }) };
    }
    if (kind === "list-html") {
      return { filename: listName("html"), mimeType: "text/html",
        content: OD.exporter.conversationsToHTML(state.filtered, {
          title: `Our Dialogues · ${stamp}`,
          sourceLabelOf
        }) };
    }
    return { filename: listName("jsonl"), mimeType: "application/x-ndjson",
      content: OD.exporter.conversationsToJSONL(state.filtered) };
  }

  function triggerDownload(payload) {
    if (!payload) return false;
    if (typeof document.createElement !== "function" || typeof Blob === "undefined" || !URL?.createObjectURL) {
      setStatus(t("export.unsupported"), true);
      return false;
    }
    const url = URL.createObjectURL(new Blob([payload.content], { type: payload.mimeType }));
    const link = document.createElement("a");
    link.href = url;
    link.download = payload.filename;
    document.body?.appendChild?.(link);
    link.click();
    link.remove?.();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    setStatus(t("export.done", { filename: payload.filename }));
    return true;
  }

  function exportAs(kind) {
    return triggerDownload(buildExport(kind));
  }

  function syncOrganizeControls() {
    const star = $("favoriteToggle");
    if (star) {
      const active = state.current ? OD.organization.isFavorite(state.organization, state.current.id) : false;
      star.textContent = active ? t("organize.favorited") : t("organize.favorite");
      star.setAttribute?.("aria-pressed", String(active));
    }
    $("favoritesFilter")?.setAttribute?.("aria-pressed", String(!!state.favoritesOnly));
    const filter = $("tagFilter");
    if (filter) {
      const tags = OD.organization.allTags(state.organization);
      if (state.tagFilter && !tags.some(item => item.tag === state.tagFilter)) state.tagFilter = "";
      filter.innerHTML = [
        `<option value="">${esc(t("library.allTags"))}</option>`,
        ...tags.map(item => `<option value="${esc(item.tag)}">${esc(t("library.tagOption", { tag: item.tag, count: item.count }))}</option>`)
      ].join("");
      filter.value = state.tagFilter;
    }
  }

  function toggleFavorite(conversationId = state.current?.id) {
    if (!conversationId) {
      setStatus(t("organize.needConversation"), true);
      return false;
    }
    state.organization = OD.organization.toggleFavorite(state.organization, conversationId);
    const active = OD.organization.isFavorite(state.organization, conversationId);
    setStatus(active ? t("organize.favoritedStatus") : t("organize.unfavorited"));
    syncOrganizeControls();
    renderList();
    void saveReaderState();
    return active;
  }

  function setConversationTags(conversationId, tags) {
    if (!conversationId) return [];
    state.organization = OD.organization.setTags(state.organization, conversationId, tags);
    syncOrganizeControls();
    renderTagEditor();
    renderList();
    void saveReaderState();
    return OD.organization.tagsOf(state.organization, conversationId);
  }

  function setFavoritesOnly(value) {
    state.favoritesOnly = !!value;
    syncOrganizeControls();
    renderList();
    void saveReaderState();
  }

  function setTagFilter(tag) {
    state.tagFilter = String(tag ?? "");
    syncOrganizeControls();
    renderList();
    void saveReaderState();
  }

  function renderTagEditor() {
    const chips = $("tagChips");
    const suggestions = $("tagSuggestions");
    if (!chips || !suggestions) return;
    if (!state.current) {
      chips.innerHTML = `<span class="tag-empty">${esc(t("organize.tagNeedConversation"))}</span>`;
      suggestions.innerHTML = "";
      return;
    }
    const current = OD.organization.tagsOf(state.organization, state.current.id);
    chips.innerHTML = current.length
      ? current.map(tag => `<span class="tag-chip">${esc(tag)}<button type="button" data-remove-tag="${esc(tag)}" aria-label="${esc(t("organize.removeTagAria", { tag }))}">✕</button></span>`).join("")
      : `<span class="tag-empty">${esc(t("organize.noTags"))}</span>`;
    const others = OD.organization.allTags(state.organization)
      .filter(item => !current.includes(item.tag)).slice(0, 8);
    suggestions.innerHTML = others.length
      ? `<span class="tag-suggest-label">${esc(t("organize.existing"))}</span>` + others.map(item =>
          `<button type="button" class="tag-suggest" data-add-tag="${esc(item.tag)}">${esc(item.tag)}</button>`).join("")
      : "";
    [...document.querySelectorAll("#tagChips [data-remove-tag]")].forEach(button => {
      button.addEventListener("click", event => {
        event.stopPropagation?.();
        setConversationTags(state.current?.id, OD.organization.tagsOf(state.organization, state.current?.id)
          .filter(tag => tag !== button.dataset.removeTag));
      });
    });
    [...document.querySelectorAll("#tagSuggestions [data-add-tag]")].forEach(button => {
      button.addEventListener("click", event => {
        event.stopPropagation?.();
        setConversationTags(state.current?.id, [
          ...OD.organization.tagsOf(state.organization, state.current?.id),
          button.dataset.addTag
        ]);
      });
    });
  }

  function syncSearchScope() {
    $("searchScopeCurrent")?.setAttribute?.("aria-pressed", String(state.searchScope === "current"));
    $("searchScopeLibrary")?.setAttribute?.("aria-pressed", String(state.searchScope === "library"));
  }

  function jumpToSearchHit(conversationId, messageId) {
    if (!(state.archive?.conversations || []).some(conversation => conversation.id === conversationId)) return false;
    openConversation(conversationId, { restorePosition: { messageId } });
    const target = [...$("messages").querySelectorAll("[data-message-id]")]
      .find(element => element?.dataset?.messageId === String(messageId));
    target?.classList?.add?.("bookmark-flash");
    return true;
  }

  function performSearch() {
    const results = $("searchResults");
    const countElement = $("searchHitCount");
    if (!results || !countElement) return [];
    const query = String($("searchQuery").value || "").trim();
    syncSearchScope();
    if (!query) {
      countElement.textContent = "";
      results.innerHTML = `<div class="bookmarks-empty">${esc(t("search.hint"))}</div>`;
      return [];
    }
    let outcome;
    if (state.searchScope === "current") {
      if (!state.current) {
        countElement.textContent = "";
        results.innerHTML = `<div class="bookmarks-empty">${esc(t("search.needConversation"))}</div>`;
        return [];
      }
      outcome = OD.messageSearch.searchConversation(state.current, query);
    } else {
      // Library scope has its own source selector and deliberately ignores
      // both the catalog filter box and the catalog's source dropdown —
      // this pane chooses its own range.
      const allSources = state.library.sources();
      const targetSources = state.searchSourceId === "all"
        ? allSources
        : allSources.filter(source => source.id === state.searchSourceId);
      outcome = OD.messageSearch.searchLibrary(targetSources.flatMap(source => source.conversations), query);
    }
    const { hits, truncated } = outcome;
    countElement.textContent = hits.length ? `${hits.length}${truncated ? "+" : ""}` : "";
    if (!hits.length) {
      results.innerHTML = `<div class="bookmarks-empty">${esc(state.searchScope === "current" ? t("search.noHitsCurrentScope") : t("search.noHits"))}</div>`;
      return hits;
    }
    const titles = new Map((state.archive?.conversations || []).map(conversation =>
      [conversation.id, displayConversationTitle(conversation)]
    ));
    results.innerHTML = [
      truncated ? `<div class="bookmarks-empty">${esc(t("search.truncated", { limit: OD.messageSearch.DEFAULT_LIMIT }))}</div>` : "",
      ...hits.map(hit => `<div class="search-hit" data-search-conversation="${esc(hit.conversationId)}" data-search-message="${esc(hit.messageId)}">
        <div class="bookmark-meta">${esc(titles.get(hit.conversationId) || hit.conversationId)}${hit.speaker ? ` · ${esc(hit.speaker)}` : ""}</div>
        <div class="search-snippet">${hit.before ? "…" : ""}${esc(hit.before)}<b>${esc(hit.match)}</b>${esc(hit.after)}…</div>
      </div>`)
    ].join("");
    [...document.querySelectorAll("#searchResults .search-hit")].forEach(element => {
      element.addEventListener("click", () => {
        jumpToSearchHit(element.dataset.searchConversation, element.dataset.searchMessage);
      });
    });
    return hits;
  }

  function setSearchScope(scope) {
    state.searchScope = scope === "library" ? "library" : "current";
    syncSearchScope();
    void saveReaderState();
    if (String($("searchQuery")?.value || "").trim()) performSearch();
  }

  function renderSearchSourceControl() {
    const control = $("searchSource");
    if (!control) return;
    const sources = state.library.sources();
    if (state.searchSourceId !== "all" && !sources.some(source => source.id === state.searchSourceId)) {
      state.searchSourceId = "all";
    }
    control.innerHTML = [
      `<option value="all">${esc(t("library.allSources"))}</option>`,
      ...sources.map(source => `<option value="${esc(source.id)}">${esc(t("library.sourceOption", { label: source.label, count: source.conversations.length }))}</option>`)
    ].join("");
    control.value = state.searchSourceId;
  }

  /* Shared wiring for remove/reconnect controls, scoped to one container so
     re-rendering the catalog can never double-bind the manage panel's rows. */
  function wireSourceActions(scope) {
    if (typeof scope?.querySelectorAll !== "function") return;
    [...(scope.querySelectorAll("[data-remove-source]") || [])].forEach(button => {
      button.addEventListener("click", event => {
        event.preventDefault?.();
        event.stopPropagation?.();
        removeSource(button.dataset.removeSource);
      });
    });
    [...(scope.querySelectorAll("[data-reconnect-source-row]") || [])].forEach(button => {
      button.addEventListener("click", event => {
        event.preventDefault?.();
        event.stopPropagation?.();
        void reconnectSource(button.dataset.reconnectSourceRow);
      });
    });
  }

  function renderSourceManageList() {
    const list = $("sourceManageList");
    if (!list) return;
    const sources = state.library.sources();
    if (!sources.length) {
      list.innerHTML = `<div class="bookmarks-empty">${esc(t("source.manageEmpty"))}</div>`;
      return;
    }
    list.innerHTML = sources.map(source => {
      const canReconnect = source.assetMode === "local-reconnect" || source.directoryHandle;
      return `<div class="source-manage-row">
        <div class="source-manage-copy">
          <div class="source-manage-label">${esc(source.label)}</div>
          <small>${esc(t("conv.segmentCount", { count: source.conversations.length }))}${source.importDetails ? ` · ${esc(source.importDetails)}` : ""}</small>
        </div>
        <span class="source-manage-actions">
          ${canReconnect ? `<button type="button" data-reconnect-source-row="${esc(source.id)}" title="${esc(t("source.reconnectTitle"))}">${esc(t("source.reconnectShort"))}</button>` : ""}
          <button type="button" data-remove-source="${esc(source.id)}" title="${esc(t("source.removeTitle"))}">${esc(t("source.remove"))}</button>
        </span>
      </div>`;
    }).join("");
    wireSourceActions(list);
  }

  function renderSourceControls() {
    const sources = state.library.sources();
    document.body.classList.toggle("has-library", sources.length > 0);
    syncImportPanel();
    renderSearchSourceControl();
    if ($("sourceManagePanel")?.hidden === false) renderSourceManageList();
    const selected = sources.some(source => source.id === state.sourceFilter) ? state.sourceFilter : "all";
    state.sourceFilter = selected;
    $("sourceFilter").innerHTML = [
      `<option value="all">${esc(t("library.allSourcesCount", { count: sources.length }))}</option>`,
      ...sources.map(source => `<option value="${esc(source.id)}">${esc(t("library.sourceOption", { label: source.label, count: source.conversations.length }))}</option>`)
    ].join("");
    $("sourceFilter").value = selected;
    $("clearSources").disabled = sources.length === 0;
  }

  function renderList() {
    const allSources = state.library.sources();
    const visibleSources = state.sourceFilter === "all"
      ? allSources
      : allSources.filter(source => source.id === state.sourceFilter);
    const all = visibleSources.flatMap(source => source.conversations);
    state.titleLabels = OD.mufyTitleResolver.disambiguate(all);
    state.filtered = OD.conversationOrder.filterAndSort(
      all,
      $("search").value,
      conversationHaystack,
      state.sortMode
    ).filter(conversation => OD.organization.matches(state.organization, conversation.id, {
      favoritesOnly: state.favoritesOnly,
      tag: state.tagFilter || null
    }));

    const filteredIds = new Set(state.filtered.map(conversation => conversation.id));
    // While a search query is active every group is forced open so hits stay
    // visible; those forced states are not recorded as the user's choice.
    const searching = String($("search").value || "").trim() !== "";
    state.searchForcedOpen = searching;
    // The sidebar's visible order doubles as the reading order, so
    // previous/next always move to what the eye sees as the neighbour.
    const readingOrder = [];
    $("conversationList").innerHTML = visibleSources.map(source => sourceMarkup(
      source,
      OD.conversationOrder.sortConversations(
        source.conversations.filter(conversation => filteredIds.has(conversation.id)),
        state.sortMode
      ),
      searching,
      readingOrder
    )).join("");
    state.readingOrder = readingOrder;

    [...document.querySelectorAll(".conv")].forEach(el => {
      el.addEventListener("click", () => openConversation(el.dataset.id));
    });
    [...document.querySelectorAll("#conversationList details.source-group, #conversationList details.character-group")].forEach(el => {
      el.addEventListener("toggle", () => {
        if (state.searchForcedOpen) return;
        if (el.classList.contains("source-group")) {
          state.groupState.sources[el.dataset.sourceId] = el.open;
        } else if (el.dataset.characterKey) {
          state.groupState.characters[el.dataset.characterKey] = el.open;
        }
        void saveReaderState();
      });
    });
    wireSourceActions($("conversationList"));
    [...document.querySelectorAll("#conversationList [data-source-menu]")].forEach(button => {
      button.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        // Relative lookup instead of a selector built from the id, so odd
        // characters in a source id can never break out of the query.
        const group = button.closest?.(".source-group");
        const menu = group?.querySelector?.(".source-row-menu");
        if (menu) menu.hidden = !menu.hidden;
      });
    });

    $("archiveMeta").textContent = t("library.archiveMeta", { filtered: state.filtered.length, total: all.length, sources: state.library.size });
    renderBookmarks();
    renderAnnotations();
    renderRecent();
    if (libraryHomeVisible()) renderLibraryHome();
    return state.filtered;
  }

  function renderSortControl() {
    for (const button of document.querySelectorAll("[data-sort-mode]")) {
      button.setAttribute("aria-pressed", String(button.dataset.sortMode === state.sortMode));
    }
  }

  function setSortMode(mode) {
    state.sortMode = OD.conversationOrder.persistMode(window.localStorage, mode);
    renderSortControl();
    renderList();
    void saveReaderState();
  }

  function resolveAttachment(attachment) {
    const resolver = state.assetSession?.assetIndex?.resolve;
    if (typeof resolver !== "function") return null;
    try {
      return resolver.call(state.assetSession.assetIndex, attachment) || null;
    } catch (error) {
      console.warn("Could not resolve attachment metadata", attachment, error);
      return null;
    }
  }

  function attachmentKind(attachment, mimeType, name) {
    const mime = String(mimeType || "").toLowerCase();
    if (mime.startsWith("image/")) return "image";
    if (mime.startsWith("audio/")) return "audio";
    if (mime.startsWith("video/")) return "video";

    const declared = String(attachment?.type || "").toLowerCase();
    if (["image", "audio", "video"].includes(declared)) return declared;

    const extension = String(name || "").toLowerCase().split(".").pop();
    if (["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "svg"].includes(extension)) return "image";
    if (["mp3", "m4a", "aac", "wav", "ogg", "oga", "flac", "opus"].includes(extension)) return "audio";
    if (["mp4", "m4v", "webm", "mov", "ogv"].includes(extension)) return "video";
    return "file";
  }

  function attachmentInfo(attachment) {
    const resolved = resolveAttachment(attachment);
    const file = resolved?.file || null;
    const name = resolved?.originalName || attachment?.name || resolved?.exportedName || attachment?.id || "attachment";
    const mimeType = resolved?.mimeType || attachment?.mimeType || file?.type || "";
    const size = attachment?.size ?? resolved?.size ?? file?.size ?? null;
    const kind = attachmentKind(attachment, mimeType, name);
    const details = [mimeType, fmtBytes(size)].filter(Boolean).join(" · ");
    return { resolved, file, name, mimeType, size, kind, details };
  }

  function attachmentIcon(kind) {
    if (kind === "image") return "▧";
    if (kind === "audio") return "♪";
    if (kind === "video") return "▶";
    return "↗";
  }

  function attachmentMarkup(attachment, index) {
    const info = attachmentInfo(attachment);
    const canOpen = !!(info.resolved?.available && state.assetSession?.objectURLs?.get);
    const source = state.library.sourceForConversation(state.current);
    const canReconnect = !canOpen && source?.assetMode === "local-reconnect";
    const availability = canOpen ? t("attachment.lazyLoad") : (canReconnect ? t("attachment.reconnectToOpen") : t("attachment.infoOnly"));
    const reconnect = canReconnect ? `<button class="attachment-reconnect" type="button" data-reconnect-source="${esc(source.id)}">${esc(t("attachment.reconnectSource"))}</button>` : "";

    if (info.kind === "file") {
      return `<div class="attachment attachment-file lazy-attachment${canOpen ? "" : " is-unavailable"}" data-attachment-index="${index}">
        <a class="attachment-card" aria-disabled="true">
          <span class="attachment-icon" aria-hidden="true">${attachmentIcon(info.kind)}</span>
          <span class="attachment-copy">
            <span class="attachment-name">${esc(info.name)}</span>
            ${info.details ? `<small>${esc(info.details)}</small>` : ""}
          </span>
          <span class="attachment-action">${availability}</span>
        </a>
        ${reconnect}
      </div>`;
    }

    return `<figure class="attachment attachment-media attachment-${info.kind} lazy-attachment${canOpen ? "" : " is-unavailable"}" data-attachment-index="${index}">
      <div class="attachment-viewport">
        <div class="attachment-loading">
          <span class="attachment-icon" aria-hidden="true">${attachmentIcon(info.kind)}</span>
          <span>${availability}</span>
        </div>
      </div>
      <figcaption class="attachment-caption">
        <span class="attachment-name">${esc(info.name)}</span>
        ${info.details ? `<small>${esc(info.details)}</small>` : ""}
      </figcaption>
      ${reconnect}
    </figure>`;
  }

  async function materializeAttachment(element, attachment) {
    const manager = state.assetSession?.objectURLs;
    if (!manager?.get || element.dataset.attachmentState) return;
    const info = attachmentInfo(attachment);
    if (!info.resolved?.available) return;

    const token = state.renderToken;
    element.dataset.attachmentState = "loading";
    element.classList.add("is-loading");

    try {
      const url = await Promise.resolve(manager.get(attachment));
      if (!url) throw new Error(t("attachment.notFound"));
      if (token !== state.renderToken || !element.isConnected) {
        // The render transition already revoked its previous URL set. Revoking
        // by attachment here could accidentally revoke a newer render's URL
        // when the same local file appears in both conversations.
        return;
      }

      if (info.kind === "file") {
        const link = element.querySelector(".attachment-card");
        link.href = url;
        link.download = info.name;
        link.removeAttribute("aria-disabled");
        link.querySelector(".attachment-action").textContent = t("attachment.download");
      } else {
        const media = document.createElement(info.kind === "image" ? "img" : info.kind);
        media.src = url;
        if (info.kind === "image") {
          media.alt = info.name;
          media.loading = "lazy";
          media.decoding = "async";
        } else {
          media.controls = true;
          media.preload = "metadata";
        }
        media.addEventListener("error", () => element.classList.add("is-error"), { once: true });
        element.querySelector(".attachment-viewport").replaceChildren(media);
      }

      element.dataset.attachmentState = "loaded";
      element.classList.remove("is-loading");
      element.classList.add("is-loaded");
    } catch (error) {
      console.warn("Could not open local attachment", attachment, error);
      if (token !== state.renderToken || !element.isConnected) return;
      element.dataset.attachmentState = "error";
      element.classList.remove("is-loading");
      element.classList.add("is-error");
      const loading = element.querySelector(".attachment-loading");
      if (loading) loading.textContent = error?.message || t("attachment.openFailed");
      const action = element.querySelector(".attachment-action");
      if (action) action.textContent = t("attachment.cantOpen");
    }
  }

  function prepareLazyAttachments(attachments) {
    const elements = [...$("messages").querySelectorAll(".lazy-attachment")];
    const manager = state.assetSession?.objectURLs;
    for (const button of $("messages").querySelectorAll("[data-reconnect-source]")) {
      button.addEventListener("click", () => void reconnectSource(button.dataset.reconnectSource));
    }
    if (!elements.length || !manager?.get) return;

    const load = element => {
      const index = Number(element.dataset.attachmentIndex);
      const attachment = attachments[index];
      if (attachment) void materializeAttachment(element, attachment);
    };

    for (const element of elements) {
      element.addEventListener("pointerenter", () => load(element), { once: true });
      element.addEventListener("focusin", () => load(element), { once: true });
      const link = element.querySelector(".attachment-card");
      link?.addEventListener("click", async event => {
        if (element.dataset.attachmentState === "loaded") return;
        event.preventDefault();
        const index = Number(element.dataset.attachmentIndex);
        const attachment = attachments[index];
        if (!attachment) return;
        await materializeAttachment(element, attachment);
        if (element.dataset.attachmentState === "loaded") link.click();
      });
    }

    if (!("IntersectionObserver" in window)) {
      elements.forEach(load);
      return;
    }

    state.mediaObserver = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        state.mediaObserver?.unobserve(entry.target);
        load(entry.target);
      }
    }, {
      root: $("main"),
      rootMargin: "600px 0px",
      threshold: 0.01
    });
    elements.forEach(element => state.mediaObserver.observe(element));
  }

  function solVoiceMarkup(clip, index) {
    return `<figure class="solvoice-player lazy-solvoice" data-solvoice-index="${index}">
      <figcaption class="solvoice-caption">
        <span>${esc(clip.voiceLabel || t("voice.fallbackLabel"))}</span>
        <small title="Reader v1 only attaches confidence=strong mappings">local · strong</small>
      </figcaption>
      <div class="solvoice-viewport">
        <div class="solvoice-loading">${esc(t("voice.lazyReady"))}</div>
      </div>
    </figure>`;
  }

  async function materializeSolVoice(element, clip) {
    const manager = state.solVoiceSession?.objectURLs;
    if (!manager?.get || element.dataset.solvoiceState) return;
    const token = state.renderToken;
    element.dataset.solvoiceState = "loading";

    try {
      const url = await Promise.resolve(manager.get(clip));
      if (!url) throw new Error(t("voice.fileUnavailable"));
      if (token !== state.renderToken || !element.isConnected) return;
      const audio = document.createElement("audio");
      audio.controls = true;
      audio.preload = "metadata";
      audio.src = url;
      audio.setAttribute("aria-label", t("voice.playerAria"));
      audio.addEventListener("error", () => element.classList.add("is-unavailable"), { once: true });
      element.querySelector(".solvoice-viewport").replaceChildren(audio);
      element.dataset.solvoiceState = "loaded";
      element.classList.add("is-loaded");
    } catch (error) {
      console.warn("Could not open local SolVoice audio", error);
      if (token !== state.renderToken || !element.isConnected) return;
      element.dataset.solvoiceState = "unavailable";
      element.classList.add("is-unavailable");
      const loading = element.querySelector(".solvoice-loading");
      if (loading) loading.textContent = t("voice.unavailable");
    }
  }

  function prepareLazySolVoice(clips) {
    const elements = [...$("messages").querySelectorAll(".lazy-solvoice")];
    if (!elements.length || !state.solVoiceSession?.objectURLs?.get) return;

    const load = element => {
      const clip = clips[Number(element.dataset.solvoiceIndex)];
      if (clip) void materializeSolVoice(element, clip);
    };
    for (const element of elements) {
      element.addEventListener("pointerenter", () => load(element), { once: true });
      element.addEventListener("focusin", () => load(element), { once: true });
    }
    if (!("IntersectionObserver" in window)) {
      elements.forEach(load);
      return;
    }
    state.solVoiceObserver = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        state.solVoiceObserver?.unobserve(entry.target);
        load(entry.target);
      }
    }, {
      root: $("main"),
      rootMargin: "600px 0px",
      threshold: 0.01
    });
    elements.forEach(element => state.solVoiceObserver.observe(element));
  }

  function richBlockMarkup(block) {
    if (block?.type !== "source-rich-block" || block.source !== "mufy") return "";
    const rows = Array.isArray(block.rows) ? block.rows.filter(row => row?.label || row?.value) : [];
    const sections = Array.isArray(block.sections) ? block.sections.filter(section => section?.label || section?.value) : [];
    const notes = Array.isArray(block.notes) ? block.notes.filter(Boolean) : [];
    const items = Array.isArray(block.items) ? block.items.filter(item => item?.text) : [];
    const progress = block.progress && Number.isFinite(Number(block.progress.value))
      ? { label: block.progress.label || t("richblock.progressFallback"), value: Math.max(0, Math.min(100, Number(block.progress.value))) }
      : null;
    const variant = /^[a-z0-9-]+$/.test(String(block.variant || "")) ? String(block.variant) : "generic";
    const kind = /^[a-z0-9-]+$/.test(String(block.kind || "")) ? String(block.kind) : "status-card";
    const body = block.body ? `<div class="source-rich-body">${esc(block.body)}</div>` : "";
    const rowsHTML = rows.length ? `<dl class="source-rich-rows">${rows.map(row => `<div class="source-rich-row"><dt>${esc(row.label)}</dt><dd>${esc(row.value)}</dd></div>`).join("")}</dl>` : "";
    const sectionsHTML = sections.length ? `<div class="source-rich-sections">${sections.map(section => `<section><h4>${esc(section.label)}</h4><div>${esc(section.value)}</div></section>`).join("")}</div>` : "";
    const notesHTML = notes.map(note => `<div class="source-rich-note">${esc(note)}</div>`).join("");
    const itemsHTML = items.length ? `<ul class="source-rich-items">${items.map(item => `<li>${esc(item.text)}</li>`).join("")}</ul>` : "";
    const progressHTML = progress ? `<div class="source-rich-progress"><div class="source-rich-progress-copy"><span>${esc(progress.label)}</span><strong>${esc(progress.value)}%</strong></div><div class="source-rich-track" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${esc(progress.value)}"><span style="width:${esc(progress.value)}%"></span></div></div>` : "";
    const content = `${rowsHTML}${sectionsHTML}${notesHTML}${itemsHTML}${body}${progressHTML}`;
    if (block.kind === "scene-heading") {
      return `<header class="source-rich-block source-rich-heading source-rich-${variant}">${block.eyebrow ? `<div class="source-rich-eyebrow">${esc(block.eyebrow)}</div>` : ""}${block.title ? `<h3>${esc(block.title)}</h3>` : ""}${block.subtitle ? `<p>${esc(block.subtitle)}</p>` : ""}</header>`;
    }
    if (block.kind === "hud") {
      return `<section class="source-rich-block source-rich-hud source-rich-${variant}"><header><div>${block.title ? `<strong>${esc(block.title)}</strong>` : ""}${block.subtitle ? `<small>${esc(block.subtitle)}</small>` : ""}</div></header>${content}</section>`;
    }
    if (block.kind === "details") {
      return `<details class="source-rich-block source-rich-details source-rich-${variant}"><summary>${esc(block.title || t("richblock.detailsFallback"))}</summary><div class="source-rich-details-body">${content}</div></details>`;
    }
    return `<section class="source-rich-block source-rich-status source-rich-kind-${kind} source-rich-${variant}">${block.title ? `<header>${esc(block.title)}</header>` : ""}${block.subtitle ? `<div class="source-rich-subtitle">${esc(block.subtitle)}</div>` : ""}${content}</section>`;
  }

  function messageContentMarkup(message) {
    const content = message.content;
    const items = Array.isArray(content) ? content : [{ type: "text", text: String(content ?? "") }];
    const marks = state.current
      ? OD.annotations.forMessage(state.annotations, state.current.id, message.id)
      : [];
    return items.map(item => {
      if (item?.type === "source-rich-block") return richBlockMarkup(item);
      const text = item?.text == null ? "" : String(item.text);
      if (!text) return "";
      const body = marks.length ? OD.annotations.markupText(text, marks, { escape: esc }) : esc(text);
      return `<div class="message-body">${body}</div>`;
    }).join("");
  }

  function messageMarkup(message, renderedAttachments, renderedSolVoice) {
    const contentHTML = messageContentMarkup(message);
    const thinking = OD.schema.textOf(message.thinking);
    const recaps = Array.isArray(message.metadata?.reasoningRecap) ? message.metadata.reasoningRecap.filter(Boolean) : [];
    const sourceTrace = Array.isArray(message.metadata?.sourceTrace)
      ? message.metadata.sourceTrace.filter(item => item?.text)
      : [];
    const attachments = Array.isArray(message.attachments) ? message.attachments : [];
    const reasoningOnly = !!message.metadata?.reasoningOnly;
    const attachmentHTML = attachments.map(attachment => {
      const index = renderedAttachments.push(attachment) - 1;
      return attachmentMarkup(attachment, index);
    }).join("");
    const solVoiceHTML = state.solVoiceSession?.clipsForMessage(message.id).map(clip => {
      const index = renderedSolVoice.push(clip) - 1;
      return solVoiceMarkup(clip, index);
    }).join("") || "";
    const traceLabel = message.metadata?.sourceTraceKind === "official-tools"
      ? t("trace.official")
      : t("trace.heuristic");
    const sourceTraceHTML = sourceTrace.length ? `<div class="source-trace"><strong>${esc(traceLabel)}</strong>\n${sourceTrace.map(item => item.type === "marker"
      ? `<span class="source-trace-marker">[${esc(item.marker || "marker")}] ${esc(item.text)}</span>`
      : esc(item.text)).join("\n\n")}</div>` : "";
    return `<section class="message${reasoningOnly ? " reasoning-only" : ""}" data-role="${esc(message.role)}" data-message-id="${esc(message.id)}">
      <div class="message-who">${esc(message.speaker || message.role)}</div>
      ${contentHTML}
      ${attachmentHTML ? `<div class="attachments">${attachmentHTML}</div>` : ""}
      ${solVoiceHTML ? `<div class="solvoice-clips">${solVoiceHTML}</div>` : ""}
      ${(thinking || recaps.length) ? `<div class="thinking"><strong>${esc(t("message.thinkingLabel"))}</strong>${recaps.length ? `\n${esc(recaps.join(" · "))}` : ""}${thinking ? `\n\n${esc(thinking)}` : ""}</div>` : ""}
      ${sourceTraceHTML}
      ${message.createdAt ? `<div class="message-time">${esc(fmtDate(message.createdAt))}</div>` : ""}
    </section>`;
  }

  function renderPageNavigation() {
    const pageMode = state.readerPrefs.readingMode === "page";
    const order = state.readingOrder.length ? state.readingOrder : state.filtered;
    const conversationIndex = order.findIndex(conversation => conversation.id === state.current?.id);
    const hasPrevious = state.pageIndex > 0 || conversationIndex > 0;
    const hasNext = state.pageIndex < state.pages.length - 1 || (conversationIndex >= 0 && conversationIndex < order.length - 1);
    $("previousPage").disabled = !hasPrevious;
    $("nextPage").disabled = !hasNext;
    $("previousPage").textContent = state.pageIndex > 0 ? t("pager.prevPage") : t("pager.prevConversation");
    $("nextPage").textContent = state.pageIndex < state.pages.length - 1 ? t("pager.nextPage") : t("pager.nextConversation");
    $("pageIndicator").hidden = !pageMode;
    const progressLabel = $("readingProgressLabel");
    if (progressLabel) progressLabel.hidden = pageMode;
    $("pageJump").value = String(state.pageIndex + 1);
    $("pageJump").max = String(state.pages.length);
    $("pageCount").textContent = String(state.pages.length);
  }

  function restoreReadingPosition(position) {
    const main = $("main");
    main.scrollTop = 0;
    if (!position) return;
    const messageId = position.messageId == null ? "" : String(position.messageId);
    const selector = `[data-message-id="${messageId.replace(/["\\]/g, "\\$&")}"]`;
    const anchor = messageId && typeof $("messages").querySelector === "function"
      ? $("messages").querySelector(selector)
      : null;
    if (anchor && Number.isFinite(Number(anchor.offsetTop))) {
      main.scrollTop = Math.max(0, Number(anchor.offsetTop) - 72);
    } else {
      main.scrollTop = Math.max(0, Number(position.scrollTop || 0));
    }
  }

  function openConversation(id, { restorePosition = null, page = null } = {}) {
    const c = (state.archive?.conversations || []).find(x => x.id === id);
    if (!c) return;
    // A plain open (no explicit target) resumes this conversation's own
    // reading progress, like picking a book back up at its own bookmark.
    // Explicit targets — boot restore, page turns, bookmark and annotation
    // jumps — always win.
    const switching = state.current?.id !== c.id;
    let resumed = false;
    if (!restorePosition && page === null) {
      const progress = state.readingProgress[c.id];
      if (progress && (progress.messageId || progress.page > 0 || progress.scrollTop > 0)) {
        restorePosition = { messageId: progress.messageId, page: progress.page, scrollTop: progress.scrollTop };
        resumed = progress.percent > 0 || progress.page > 0 || progress.scrollTop > 0;
      }
    }
    releaseRenderedAssets();
    const source = state.library.sourceForConversation(c);
    state.assetSession = source?.assetSession || null;
    state.current = c;
    $("welcome").classList.add("hidden");
    $("libraryHome")?.classList?.add?.("hidden");
    $("reader").classList.remove("hidden");
    const displayedTitle = displayConversationTitle(c);
    $("currentTitle").textContent = displayedTitle;
    $("readerTitle").textContent = displayedTitle;

    const documentMode = isDocumentConversation(c);
    document.body.classList.toggle("document-mode", documentMode);
    const bits = [];
    if (documentMode) {
      /* A personal document reads as a page: collection · author (· date
         when the title itself is not already the date). No segment count —
         the body is one document, not a transcript. */
      const sourceMetadata = c.context?.sourceMetadata || {};
      if (sourceMetadata.collectionName) bits.push(sourceMetadata.collectionName);
      if (sourceMetadata.authorName) bits.push(sourceMetadata.authorName);
      if (c.createdAt && sourceMetadata.titleSource !== "date") bits.push(fmtDateOnly(c.createdAt));
    } else {
      if (source?.label) bits.push(source.label);
      if (c.context?.room?.name) bits.push(c.context.room.name);
      if (c.createdAt) bits.push(fmtDate(c.createdAt));
      bits.push(t("conv.segmentCount", { count: c.messages.length }));
    }
    $("readerMeta").innerHTML = bits.map(x => `<span>${esc(x)}</span>`).join('<span class="meta-dot" aria-hidden="true"> · </span>');

    state.pages = OD.readerParity.paginateMessages(c.messages, {
      mode: state.readerPrefs.readingMode,
      pageLength: state.readerPrefs.pageLength,
      hideUser: !!$("hideUser").checked
    });
    const anchorPage = OD.readerParity.pageForMessage(state.pages, restorePosition?.messageId);
    state.pageIndex = OD.readerParity.clampPage(
      anchorPage >= 0 ? anchorPage : (page ?? restorePosition?.page ?? 0),
      state.pages
    );
    const renderedAttachments = [];
    const renderedSolVoice = [];
    $("messages").innerHTML = state.pages[state.pageIndex]
      .map(message => messageMarkup(message, renderedAttachments, renderedSolVoice))
      .join("");

    restoreReadingPosition(restorePosition);
    prepareLazyAttachments(renderedAttachments);
    prepareLazySolVoice(renderedSolVoice);
    markShortHighlights();
    renderList();
    renderPageNavigation();
    closeSidebarOnNarrow();
    syncOrganizeControls();
    if (!$("tagEditor")?.hidden) renderTagEditor();
    if (resumed && switching) setStatus(t("status.resumedPosition"));
    void saveReaderState();
  }

  function goPrevious() {
    if (!state.current) return;
    if (state.pageIndex > 0) return openConversation(state.current.id, { page: state.pageIndex - 1 });
    const order = state.readingOrder.length ? state.readingOrder : state.filtered;
    const index = order.findIndex(conversation => conversation.id === state.current.id);
    const previous = index > 0 ? order[index - 1] : null;
    if (!previous) return;
    const pages = OD.readerParity.paginateMessages(previous.messages, {
      mode: state.readerPrefs.readingMode,
      pageLength: state.readerPrefs.pageLength,
      hideUser: !!$("hideUser").checked
    });
    openConversation(previous.id, { page: pages.length - 1 });
  }

  function goNext() {
    if (!state.current) return;
    if (state.pageIndex < state.pages.length - 1) return openConversation(state.current.id, { page: state.pageIndex + 1 });
    const order = state.readingOrder.length ? state.readingOrder : state.filtered;
    const index = order.findIndex(conversation => conversation.id === state.current.id);
    const next = index >= 0 ? order[index + 1] : null;
    if (next) openConversation(next.id, { page: 0 });
  }

  function rebuildSolVoiceSession({ rerender = true } = {}) {
    const currentId = state.current?.id || null;
    try {
      state.solVoiceSession?.dispose?.();
    } catch (error) {
      console.warn("Could not dispose the previous SolVoice session", error);
    }
    state.solVoiceSession = null;

    const documents = Array.isArray(state.solVoiceMapping)
      ? state.solVoiceMapping
      : (state.solVoiceMapping ? [state.solVoiceMapping] : []);
    if (!documents.length) {
      state.statusError = false;
      if (rerender && currentId && state.archive) openConversation(currentId);
      renderStatus();
      return null;
    }
    const sessions = documents.map(mappingDocument => {
      const platform = OD.solVoiceSidecar.mappingPlatform(mappingDocument);
      const conversations = state.library.sources()
        .filter(source => source.source?.platform === platform)
        .flatMap(source => source.conversations);
      if (!conversations.length) return null;
      return OD.solVoiceSidecar.buildSession({
        archive: { ...state.archive, source: { platform }, conversations },
        mappingDocument,
        audioFiles: state.solVoiceAudioFiles,
        urlAPI: URL
      });
    });
    state.solVoiceSession = OD.solVoiceSidecar.combineSessions(sessions, URL);
    state.statusError = false;
    if (rerender && currentId && state.archive) openConversation(currentId);
    renderStatus();
    return state.solVoiceSession;
  }

  /* Voice folders are additive: choosing the House audio after the
     VoiceArchive must never wipe the Sol/Ciel files already selected.
     The same path re-picked simply refreshes to the newer File. */
  function mergeVoiceAudioFiles(existing, incoming) {
    const keyOf = file => `${OD.solVoiceSidecar.normalizePath(file.webkitRelativePath || file.name).toLowerCase()}|${file.size}`;
    const merged = new Map((existing || []).map(file => [keyOf(file), file]));
    for (const file of incoming || []) merged.set(keyOf(file), file);
    return [...merged.values()];
  }

  function upsertVoiceMapping(document) {
    const existing = Array.isArray(state.solVoiceMapping) ? state.solVoiceMapping : [];
    state.solVoiceMapping = [
      ...existing.filter(item => item.format !== document.format),
      document
    ];
  }

  async function loadSolVoiceMapping(file) {
    upsertVoiceMapping(OD.solVoiceSidecar.parseMapping(await file.text()));
    const session = rebuildSolVoiceSession();
    state.statusText = archiveStatusText();
    renderStatus();
    return session;
  }

  async function loadSolVoiceFolder(files) {
    const selected = [...files];
    for (const mappingFile of OD.solVoiceSidecar.findMappingFiles(selected)) {
      try {
        upsertVoiceMapping(OD.solVoiceSidecar.parseMapping(await mappingFile.text()));
      } catch (error) {
        console.warn("Skipped an unrecognized voice mapping file", error);
      }
    }
    state.solVoiceAudioFiles = mergeVoiceAudioFiles(
      state.solVoiceAudioFiles,
      selected.filter(file =>
        /\.(?:mp3|m4a|aac|wav|ogg|oga|flac|opus)$/i.test(
          OD.solVoiceSidecar.normalizePath(file.webkitRelativePath || file.name)
        )
      )
    );
    const session = rebuildSolVoiceSession();
    state.statusText = archiveStatusText();
    renderStatus();
    return session;
  }

  function clearSolVoice() {
    const currentId = state.current?.id || null;
    releaseRenderedAssets();
    try {
      state.solVoiceSession?.dispose?.();
    } catch (error) {
      console.warn("Could not clear SolVoice session", error);
    }
    state.solVoiceSession = null;
    state.solVoiceMapping = null;
    state.solVoiceAudioFiles = [];
    state.statusText = archiveStatusText();
    state.statusError = false;
    if (currentId && state.archive) openConversation(currentId);
    renderStatus();
  }

  function loadArchive(archive, adapterLabel, assetSession=null, importDetails="", options={}) {
    if (!archive?.conversations?.length) throw new Error(t("error.noConversations"));
    const expected = options.expectedSourceId ? state.library.get(options.expectedSourceId) : null;
    if (expected && expected.fingerprint !== OD.sourceLibrary.archiveFingerprint(archive)) {
      OD.sourceLibrary._internals.disposeAssetSession(assetSession);
      throw new Error(t("error.reconnectMismatch"));
    }
    const added = state.library.add({
      archive,
      label: adapterLabel,
      adapterId: archive.source?.exporter || null,
      assetSession,
      importDetails,
      directoryHandle: options.directoryHandle || null,
      reconnectMode: options.reconnectMode || null
    });
    state.sourceFilter = "all";
    state.archive = state.library.archive();
    state.current = null;
    rebuildSolVoiceSession({ rerender: false });
    const detail = importDetails ? ` · ${importDetails}` : "";
    const personalImport = archive?.source?.platform === "personal-archive"
      ? archive.source.personalImport
      : null;
    if (added.reconnected) {
      setArchiveStatus("status.reconnected", { label: added.source.label });
    } else if (added.duplicate) {
      setArchiveStatus("status.duplicate", { label: adapterLabel, count: state.library.size });
    } else if (personalImport) {
      const summary = [
        t("personal.collectionsCount", { count: personalImport.collections }),
        t("personal.entriesCount", { count: personalImport.entries })
      ].join(t("common.listComma"));
      setArchiveStatus("personal.addedStatus", { label: adapterLabel, summary, sources: state.library.size });
    } else {
      setArchiveStatus("status.added", {
        label: adapterLabel,
        conversations: added.source.conversations.length,
        detail,
        sources: state.library.size
      });
    }
    renderSourceControls();
    renderList();
    const first = OD.conversationOrder.sortConversations(added.source.conversations, state.sortMode)[0];
    openConversation(first.id);
    void persistSource(added.source);
    return added;
  }

  function showEmptyLibrary() {
    state.current = null;
    state.assetSession = null;
    document.body.classList.toggle("document-mode", false);
    $("reader").classList.add("hidden");
    $("libraryHome")?.classList?.add?.("hidden");
    $("welcome").classList.remove("hidden");
    $("currentTitle").textContent = t("reader.noArchive");
    $("readerTitle").textContent = "";
    $("readerMeta").innerHTML = "";
    $("messages").innerHTML = "";
  }

  function removeSource(sourceId) {
    const source = state.library.get(sourceId);
    if (!source) return false;
    if (state.library.sourceForConversation(state.current)?.id === source.id) {
      releaseRenderedAssets();
      state.assetSession = null;
    }
    state.library.remove(source.id);
    void state.persistence?.removeSource?.(source.id)
      .then(() => refreshAcceptanceAudit())
      .catch(error => {
        state.persistenceError = error?.message || t("error.removeSource");
        renderLocalLibraryStatus();
      });
    state.archive = state.library.size ? state.library.archive() : null;
    state.current = null;
    if (state.sourceFilter === source.id) state.sourceFilter = "all";
    rebuildSolVoiceSession({ rerender: false });
    renderSourceControls();
    renderList();
    const first = OD.conversationOrder.sortConversations(state.archive?.conversations || [], state.sortMode)[0];
    if (first) openConversation(first.id);
    else showEmptyLibrary();
    if (state.library.size) setArchiveStatus("status.removed", { label: source.label, count: state.library.size });
    else setArchiveStatus("status.clearedEmpty");
    void saveReaderState();
    return true;
  }

  function clearSources() {
    releaseRenderedAssets();
    state.assetSession = null;
    const count = state.library.clear();
    state.archive = null;
    state.current = null;
    state.sourceFilter = "all";
    rebuildSolVoiceSession({ rerender: false });
    renderSourceControls();
    renderList();
    showEmptyLibrary();
    state.lastSavedAt = null;
    void state.persistence?.clearSources?.()
      .then(() => refreshAcceptanceAudit())
      .catch(error => {
        state.persistenceError = error?.message || t("error.clearLibrary");
        renderLocalLibraryStatus();
      });
    if (count) setArchiveStatus("status.clearedAll", { count });
    else setArchiveStatus("status.emptyLibrary");
    void saveReaderState();
    return count;
  }

  function requireRecognized(result) {
    if (result?.archive && result?.adapter) return result;
    const message = OD.registry.formatDiagnostics(result?.diagnostics);
    const error = new Error(message);
    error.diagnostics = result?.diagnostics || null;
    throw error;
  }

  async function loadFile(file, options={}) {
    setStatus(t("status.parsing", { name: file.name }));
    if (/\.zip$/i.test(file.name) || file.type === "application/zip") {
      const result = requireRecognized(await OD.registry.parseZIP(file));
      return loadArchive(
        result.archive,
        result.archive?.source?.sourceLabel || result.adapter.label,
        result.assetSession || null,
        result.importDetails || "",
        { ...options, reconnectMode: "file" }
      );
    }
    const text = await file.text();
    const data = JSON.parse(text.replace(/^\uFEFF/, ""));
    const result = requireRecognized(await OD.registry.parseJSON(data));
    /* Adapters may name the source themselves (a personal archive shows its
       own archive name instead of the generic adapter label). */
    return loadArchive(result.archive, result.archive?.source?.sourceLabel || result.adapter.label, null, "", { ...options, reconnectMode: "file" });
  }

  /*
    Source-folder boundary (implemented by src/core/source-folder.js):
      OD.sourceFolder.parse(File[]) -> normalized archive plus optional assets.

    ChatGPT attachment File objects remain lazy. Mufy ZIP folders are combined
    in memory using stable source IDs and never persisted or uploaded.
  */
  async function loadSourceFolder(files, options={}) {
    if (typeof OD.sourceFolder?.parse !== "function") {
      throw new Error(t("error.noFolderImporter"));
    }

    setStatus(t("status.scanningFolder", { count: files.length }));
    const result = await OD.sourceFolder.parse(files);
    return loadArchive(
      result.archive,
      result.adapter.label,
      result.assetSession || null,
      result.importDetails || "",
      { ...options, reconnectMode: "folder" }
    );
  }

  // Backward-compatible public seam for existing browser tests and integrations.
  const loadChatGPTFolder = loadSourceFolder;

  async function filesFromDirectoryHandle(directoryHandle) {
    const files = [];
    async function visit(handle, prefix="") {
      for await (const entry of handle.values()) {
        const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.kind === "directory") {
          await visit(entry, relativePath);
          continue;
        }
        const file = await entry.getFile();
        try { Object.defineProperty(file, "relativePath", { value: relativePath, configurable: true }); } catch (_) {}
        files.push(file);
      }
    }
    await visit(directoryHandle);
    return files;
  }

  async function chooseDirectory({ expectedSourceId=null } = {}) {
    if (typeof window.showDirectoryPicker !== "function") {
      state.pendingReconnectSourceId = expectedSourceId;
      $("folderInput").click();
      return null;
    }
    const directoryHandle = await window.showDirectoryPicker({ mode: "read" });
    const files = await filesFromDirectoryHandle(directoryHandle);
    return loadSourceFolder(files, { expectedSourceId, directoryHandle });
  }

  async function reconnectSource(sourceId) {
    const source = state.library.get(sourceId);
    if (!source) return false;
    try {
      if (source.directoryHandle) {
        let permission = await source.directoryHandle.queryPermission?.({ mode: "read" });
        if (permission !== "granted") permission = await source.directoryHandle.requestPermission?.({ mode: "read" });
        if (permission === "granted") {
          const files = await filesFromDirectoryHandle(source.directoryHandle);
          await loadSourceFolder(files, { expectedSourceId: source.id, directoryHandle: source.directoryHandle });
          return true;
        }
      }
      state.pendingReconnectSourceId = source.id;
      if (source.reconnectMode === "file") $("fileInput").click();
      else $("folderInput").click();
      setStatus(t("status.reconnectPrompt", {
        label: source.label,
        kind: t(source.reconnectMode === "file" ? "common.file" : "common.folder")
      }));
      return true;
    } catch (error) {
      if (error?.name === "AbortError") return false;
      console.error(error);
      setStatus(error?.message || t("error.reconnectFailed"), true);
      return false;
    }
  }

  function applyReaderSettings(settings) {
    if (!settings || typeof settings !== "object") return;
    if (OD.i18n) {
      const nextLocale = OD.i18n.normalizeSetting(settings.locale);
      state.locale = nextLocale;
      const control = $("uiLocale");
      if (control) control.value = nextLocale;
      const before = OD.i18n.currentLocale();
      if (OD.i18n.setLocale(nextLocale) !== before) applyLocaleToChrome();
    }
    state.sortMode = ["asc", "desc"].includes(settings.conversationSort) ? settings.conversationSort : state.sortMode;
    $("hideUser").checked = !!settings.hideUser;
    $("showThinking").checked = !!settings.showThinking;
    document.body.classList.toggle("hide-user", !!settings.hideUser);
    document.body.classList.toggle("show-thinking", !!settings.showThinking);
    applyReaderPreferences({ ...state.readerPrefs, ...settings });
    localStorage.setItem("our-dialogues.theme", state.readerPrefs.theme);
    state.restoredPosition = settings.readingPosition || null;
    const groupState = settings.groupState;
    if (groupState && typeof groupState === "object") {
      state.groupState = {
        sources: { ...(groupState.sources && typeof groupState.sources === "object" ? groupState.sources : {}) },
        characters: { ...(groupState.characters && typeof groupState.characters === "object" ? groupState.characters : {}) }
      };
    }
    if (Array.isArray(settings.bookmarks)) state.bookmarks = OD.bookmarks.normalize(settings.bookmarks);
    if (Array.isArray(settings.annotations)) state.annotations = OD.annotations.normalize(settings.annotations);
    if (typeof settings.annotationColor === "string") state.annotationColor = OD.annotations.normalizeColor(settings.annotationColor);
    if (typeof settings.importOpen === "boolean") state.importOpen = settings.importOpen;
    if (settings.readingProgress && typeof settings.readingProgress === "object") {
      state.readingProgress = OD.readingProgress.normalize(settings.readingProgress);
    }
    if (["current", "library"].includes(settings.searchScope)) state.searchScope = settings.searchScope;
    if (typeof settings.searchSourceId === "string" && settings.searchSourceId) state.searchSourceId = settings.searchSourceId;
    if (settings.organization && typeof settings.organization === "object") {
      state.organization = OD.organization.normalize(settings.organization);
    }
    if (typeof settings.favoritesOnly === "boolean") state.favoritesOnly = settings.favoritesOnly;
    if (typeof settings.tagFilter === "string") state.tagFilter = settings.tagFilter;
    if (settings.toolTab === null || ["recent", "bookmarks", "annotations", "search"].includes(settings.toolTab)) {
      state.toolTab = settings.toolTab ?? null;
    }
    syncToolTabs();
  }

  async function bootPersistentLibrary() {
    const mirror = readSettingsMirror();
    applyReaderSettings(mirror);
    if (!state.persistence?.supported) {
      state.booted = true;
      renderSortControl();
      renderSourceControls();
      renderLocalLibraryStatus();
      return { sourceCount: 0, conversationCount: 0 };
    }
    try {
      const [restored, settings] = await Promise.all([
        state.persistence.restore(),
        state.persistence.loadSettings()
      ]);
      applyReaderSettings(settings || mirror);
      for (const source of restored.sources) state.library.restore(source);
      state.lastSavedAt = restored.savedAt;
      state.archive = state.library.size ? state.library.archive() : null;
      const requestedFilter = settings?.sourceFilter || mirror?.sourceFilter || "all";
      state.sourceFilter = state.library.get(requestedFilter) ? requestedFilter : "all";
      renderSortControl();
      renderSourceControls();
      renderList();

      const conversations = state.archive?.conversations || [];
      const recentId = settings?.recentConversationId || mirror?.recentConversationId || null;
      const recent = conversations.find(conversation => conversation.id === recentId) ||
        OD.conversationOrder.sortConversations(conversations, state.sortMode)[0] || null;
      if (recent) {
        const position = (settings?.readingPosition || mirror?.readingPosition)?.conversationId === recent.id
          ? (settings?.readingPosition || mirror?.readingPosition)
          : null;
        openConversation(recent.id, { restorePosition: position });
      }
      if (restored.sources.length) {
        setArchiveStatus("status.restored", { sources: restored.sources.length, conversations: conversations.length });
      } else {
        setArchiveStatus("status.localOnly");
      }
      state.booted = true;
      return { sourceCount: restored.sources.length, conversationCount: conversations.length };
    } catch (error) {
      console.error("Could not restore the local library", error);
      state.persistenceError = t("status.restoreFailedDetail", { message: error?.message || t("error.restore") });
      setArchiveStatus("status.restoreFailed", null, true);
      state.booted = true;
      return { sourceCount: 0, conversationCount: 0, error };
    }
  }

  $("fileInput").addEventListener("change", async event => {
    const files = [...event.target.files];
    if (!files.length) return;
    try {
      const expectedSourceId = state.pendingReconnectSourceId;
      state.pendingReconnectSourceId = null;
      if (expectedSourceId) await loadFile(files[0], { expectedSourceId });
      else for (const file of files) await loadFile(file);
    } catch (error) {
      console.error(error);
      setStatus(error?.message || String(error), true);
    } finally {
      event.target.value = "";
    }
  });

  $("folderInput").addEventListener("change", async event => {
    const files = [...event.target.files];
    if (!files.length) return;
    try {
      const expectedSourceId = state.pendingReconnectSourceId;
      state.pendingReconnectSourceId = null;
      await loadSourceFolder(files, { expectedSourceId });
    } catch (error) {
      console.error(error);
      setStatus(error?.message || String(error), true);
    } finally {
      event.target.value = "";
    }
  });

  if ($("directoryPicker") && typeof window.showDirectoryPicker === "function") {
    $("directoryPicker").hidden = false;
  }
  $("directoryPicker")?.addEventListener("click", async () => {
    try {
      await chooseDirectory();
    } catch (error) {
      if (error?.name === "AbortError") return;
      console.error(error);
      setStatus(error?.message || t("error.openFolderFailed"), true);
    }
  });

  $("voiceMappingInput").addEventListener("change", async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      await loadSolVoiceMapping(file);
    } catch (error) {
      console.error(error);
      setStatus(error?.message || String(error), true);
    } finally {
      event.target.value = "";
    }
  });

  $("voiceArchiveInput").addEventListener("change", async event => {
    const files = [...event.target.files];
    if (!files.length) return;
    try {
      await loadSolVoiceFolder(files);
    } catch (error) {
      console.error(error);
      setStatus(error?.message || String(error), true);
    } finally {
      event.target.value = "";
    }
  });

  $("clearSolVoice").addEventListener("click", clearSolVoice);
  $("runAcceptanceAudit")?.addEventListener("click", () => void refreshAcceptanceAudit());
  $("clearSources").addEventListener("click", clearSources);
  $("clearLocalLibrary")?.addEventListener("click", async () => {
    if (state.persistenceError && state.persistence?.supported) {
      try {
        await state.persistence.reset();
        state.persistenceError = "";
      } catch (error) {
        setStatus(error?.message || t("error.resetLibrary"), true);
        return;
      }
    }
    clearSources();
  });
  $("sourceFilter").addEventListener("change", event => {
    state.sourceFilter = event.target.value || "all";
    renderList();
    void saveReaderState();
  });

  $("search").addEventListener("input", renderList);
  for (const button of document.querySelectorAll("[data-sort-mode]")) {
    button.addEventListener("click", () => setSortMode(button.dataset.sortMode));
  }
  $("hideUser").addEventListener("change", event => {
    const position = readerSettings().readingPosition;
    document.body.classList.toggle("hide-user", event.target.checked);
    if (state.current) openConversation(state.current.id, { restorePosition: position });
    void saveReaderState();
  });
  $("showThinking").addEventListener("change", event => {
    document.body.classList.toggle("show-thinking", event.target.checked);
    void saveReaderState();
  });
  $("theme").addEventListener("change", event => {
    state.readerPrefs = OD.readerParity.normalizePreferences({ ...state.readerPrefs, theme: event.target.value });
    applyReaderPreferences();
    localStorage.setItem("our-dialogues.theme", event.target.value);
    void saveReaderState();
  });
  $("uiLocale")?.addEventListener?.("change", event => setUiLocale(event.target.value));
  function updateReaderPreference(key, value, { rerender = true } = {}) {
    const position = readerSettings().readingPosition;
    state.readerPrefs = OD.readerParity.normalizePreferences({ ...state.readerPrefs, [key]: value });
    applyReaderPreferences();
    if (rerender && state.current) openConversation(state.current.id, { restorePosition: position });
    else restoreStyleAnchor(position);
    void saveReaderState();
  }
  function setPrintPreset(key) {
    const position = readerSettings().readingPosition;
    const preset = key ? OD.readerParity.PRINT_PRESETS[key] : null;
    /* Picking a preset applies its suggested size/leading as that one user
       action; clearing it only stops the presentation alias — the stored
       fontFamily and current size/leading stay exactly as they are. */
    state.readerPrefs = OD.readerParity.normalizePreferences({
      ...state.readerPrefs,
      printPreset: preset ? key : null,
      ...(preset ? { fontSize: preset.fontSize, lineHeight: preset.lineHeight } : {})
    });
    applyReaderPreferences();
    restoreStyleAnchor(position);
    void saveReaderState();
  }
  $("fontSmaller").addEventListener("click", () => updateReaderPreference("fontSize", state.readerPrefs.fontSize - 1, { rerender: false }));
  $("fontLarger").addEventListener("click", () => updateReaderPreference("fontSize", state.readerPrefs.fontSize + 1, { rerender: false }));
  $("lineHeight").addEventListener("change", event => updateReaderPreference("lineHeight", event.target.value, { rerender: false }));
  $("contentWidth").addEventListener("change", event => updateReaderPreference("contentWidth", event.target.value, { rerender: false }));
  $("printPreset")?.addEventListener?.("change", event => setPrintPreset(event.target.value || null));
  /* Aa cards (real-browser layer over the hidden selects) */
  [...(document.querySelectorAll?.("[data-theme-card]") || [])].forEach(card => {
    card.addEventListener("click", () => {
      state.readerPrefs = OD.readerParity.normalizePreferences({ ...state.readerPrefs, theme: card.dataset.themeCard });
      applyReaderPreferences();
      localStorage.setItem("our-dialogues.theme", state.readerPrefs.theme);
      void saveReaderState();
    });
  });
  [...(document.querySelectorAll?.("[data-preset-card]") || [])].forEach(card => {
    card.addEventListener("click", () => {
      const key = card.dataset.presetCard;
      setPrintPreset(state.readerPrefs.printPreset === key ? null : key);
    });
  });
  $("aaDone")?.addEventListener?.("click", () => {
    const panel = $("readerPrefsPanel");
    if (panel) panel.hidden = true;
    $("readerPrefsToggle")?.focus?.();
  });
  $("resetPrefs")?.addEventListener?.("click", () => {
    const position = readerSettings().readingPosition;
    state.readerPrefs = OD.readerParity.normalizePreferences({});
    $("hideUser").checked = false;
    $("showThinking").checked = false;
    document.body.classList.toggle("hide-user", false);
    document.body.classList.toggle("show-thinking", false);
    applyReaderPreferences();
    localStorage.setItem("our-dialogues.theme", state.readerPrefs.theme);
    if (state.current) openConversation(state.current.id, { restorePosition: position });
    void saveReaderState();
  });
  /* A manual choice under 字体 overrides and clears the print preset. */
  $("fontFamily").addEventListener("change", event => {
    const position = readerSettings().readingPosition;
    state.readerPrefs = OD.readerParity.normalizePreferences({
      ...state.readerPrefs, fontFamily: event.target.value, printPreset: null
    });
    applyReaderPreferences();
    restoreStyleAnchor(position);
    void saveReaderState();
  });
  $("readingMode").addEventListener("change", event => updateReaderPreference("readingMode", event.target.value));
  $("pageLength").addEventListener("change", event => updateReaderPreference("pageLength", event.target.value));
  $("previousPage").addEventListener("click", goPrevious);
  $("nextPage").addEventListener("click", goNext);
  const jumpToPage = () => {
    if (!state.current) return;
    const requested = Math.round(Number($("pageJump").value));
    if (!Number.isFinite(requested)) return;
    openConversation(state.current.id, { page: requested - 1 });
  };
  $("pageJump").addEventListener("change", jumpToPage);
  $("pageJump").addEventListener("keydown", event => {
    if (event.key === "Enter") {
      event.preventDefault();
      jumpToPage();
    }
  });
  function scrollMain(target) {
    const main = $("main");
    const top = target === "end" ? Number(main.scrollHeight || 0) : 0;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
    if (typeof main.scrollTo === "function") main.scrollTo({ top, behavior: reduced ? "auto" : "smooth" });
    else main.scrollTop = top;
  }

  /* ── Toolbar auto-hide ──
     Hide on >=32px of accumulated downward scroll; reveal on >=12px upward,
     near the top, on toolbar focus, or when any toolbar-owned popover opens.
     Frozen while text is selected, a note is being edited, audio plays, or a
     popover is open — reading chrome must never fight those states. */
  const toolbarHide = { downAccum: 0, upAccum: 0, lastTop: 0, hidden: false, audioPlaying: 0 };
  function anyToolbarPopoverOpen() {
    return ["readerPrefsPanel", "exportMenu", "tagEditor", "readerMoreMenu"].some(id => {
      const panel = $(id);
      return panel && !panel.hidden;
    });
  }
  function toolbarAutoHideFrozen() {
    if (typeof getSelection === "function" && getSelection()?.isCollapsed === false) return true;
    const editor = $("annotationEditor");
    if (editor && !editor.hidden) return true;
    if (toolbarHide.audioPlaying > 0) return true;
    if (anyToolbarPopoverOpen()) return true;
    return false;
  }
  function setToolbarHidden(hidden) {
    if (toolbarHide.hidden === hidden) return;
    toolbarHide.hidden = hidden;
    document.body.classList.toggle("toolbar-hidden", hidden);
  }
  function setBottomBarHidden(hidden) {
    document.body.classList.toggle("bottombar-hidden", !!hidden);
  }
  function updateReadingProgressLabel(main, top) {
    const label = $("readingProgressLabel");
    if (!label || label.hidden || !state.current) return;
    const room = Math.max(1, Number(main.scrollHeight || 0) - Number(main.clientHeight || 0));
    label.textContent = `${Math.max(0, Math.min(100, Math.round((top / room) * 100)))}%`;
  }
  function trackToolbarOnScroll() {
    const main = $("main");
    const top = Number(main.scrollTop || 0);
    const delta = top - toolbarHide.lastTop;
    toolbarHide.lastTop = top;
    updateReadingProgressLabel(main, top);
    // Phone thresholds per D3 (24 down / 16 up); PC keeps 32 / 12. Downward
    // scrolling hides both bars on phones; upward restores only the top bar —
    // the bottom controls come back on a deliberate tap or near the top.
    const phone = isPhoneScreen();
    const hideThreshold = phone ? 24 : 32;
    const revealThreshold = phone ? 16 : 12;
    if (toolbarAutoHideFrozen()) {
      setToolbarHidden(false);
      setBottomBarHidden(false);
      return;
    }
    if (top <= 16) {
      toolbarHide.downAccum = 0;
      toolbarHide.upAccum = 0;
      setToolbarHidden(false);
      setBottomBarHidden(false);
      return;
    }
    if (delta > 0) {
      toolbarHide.downAccum += delta;
      toolbarHide.upAccum = 0;
      if (toolbarHide.downAccum >= hideThreshold) {
        setToolbarHidden(true);
        if (phone) setBottomBarHidden(true);
      }
    } else if (delta < 0) {
      toolbarHide.upAccum -= delta;
      toolbarHide.downAccum = 0;
      if (toolbarHide.upAccum >= revealThreshold) setToolbarHidden(false);
    }
  }
  // Media events don't bubble, so listen in the capture phase; ended fires
  // pause as well, keeping the counter balanced.
  document.addEventListener?.("play", () => {
    toolbarHide.audioPlaying += 1;
    setToolbarHidden(false);
  }, true);
  document.addEventListener?.("pause", () => {
    toolbarHide.audioPlaying = Math.max(0, toolbarHide.audioPlaying - 1);
  }, true);
  $("readerToolbar")?.addEventListener?.("focusin", () => setToolbarHidden(false));
  /* Phone: a deliberate tap on blank reading surface toggles both bars —
     but never a tap on links, media, marks, editors, or while text is
     selected. Those interactions keep their own meaning. */
  $("main").addEventListener("click", event => {
    if (!isPhoneScreen()) return;
    if (event?.target?.closest?.("a, button, audio, video, input, textarea, select, mark, .attachment, .solvoice-player, .toolbar, .page-navigation, .annotation-editor")) return;
    if (typeof getSelection === "function" && getSelection()?.isCollapsed === false) return;
    const show = toolbarHide.hidden;
    setToolbarHidden(!show);
    setBottomBarHidden(!show);
  });
  /* Drawer swipe-to-close: a mostly-horizontal swipe of >=80px inside the
     open drawer closes it (narrow tiers only). */
  const drawerSwipe = { x: 0, y: 0, active: false };
  $("sidebar").addEventListener("touchstart", event => {
    const touch = event.touches?.[0];
    if (!touch) return;
    drawerSwipe.x = touch.clientX;
    drawerSwipe.y = touch.clientY;
    drawerSwipe.active = true;
  }, { passive: true });
  $("sidebar").addEventListener("touchend", event => {
    if (!drawerSwipe.active) return;
    drawerSwipe.active = false;
    if (!isNarrowScreen()) return;
    const touch = event.changedTouches?.[0];
    if (!touch) return;
    const dx = touch.clientX - drawerSwipe.x;
    const dy = touch.clientY - drawerSwipe.y;
    if (Math.abs(dx) >= 80 && Math.abs(dx) > Math.abs(dy)) {
      $("sidebar").classList.add("closed");
      syncSidebarBackdrop();
    }
  }, { passive: true });

  function closeMoreMenu() {
    const menu = $("readerMoreMenu");
    if (menu) menu.hidden = true;
  }
  $("readerMoreToggle")?.addEventListener?.("click", event => {
    event.stopPropagation?.();
    const menu = $("readerMoreMenu");
    if (menu) menu.hidden = !menu.hidden;
    setToolbarHidden(false);
  });
  $("toTop").addEventListener("click", () => {
    scrollMain("top");
    closeMoreMenu();
  });
  $("toEnd").addEventListener("click", () => {
    scrollMain("end");
    closeMoreMenu();
  });
  /* Sidebar behavior tiers: <=1359 the sidebar overlays the text as a drawer
     (the 936px paper plus its stage margins no longer fit beside 312px);
     >=1360 it sits in the flow. Phones (<=760) additionally get the compact
     reading chrome. */
  function isNarrowScreen() {
    return window.matchMedia?.("(max-width: 1359px)")?.matches === true;
  }
  function isPhoneScreen() {
    return window.matchMedia?.("(max-width: 760px)")?.matches === true;
  }

  function syncSidebarBackdrop() {
    const backdrop = $("sidebarBackdrop");
    if (!backdrop) return;
    backdrop.hidden = !isNarrowScreen() || $("sidebar").classList.contains("closed");
  }

  function closeSidebarOnNarrow() {
    if (!isNarrowScreen()) return;
    $("sidebar").classList.add("closed");
    syncSidebarBackdrop();
  }

  $("sidebarToggle").addEventListener("click", () => {
    $("sidebar").classList.toggle("closed");
    syncSidebarBackdrop();
  });
  $("sidebarBackdrop")?.addEventListener?.("click", () => {
    $("sidebar").classList.add("closed");
    syncSidebarBackdrop();
  });
  $("sidebarClose")?.addEventListener?.("click", () => {
    $("sidebar").classList.add("closed");
    syncSidebarBackdrop();
  });
  // Crossing the width breakpoint mid-session must never strand the drawer:
  // entering narrow closes it (☰ would be buried underneath), and leaving
  // narrow retires the backdrop. Both matchMedia change and window resize
  // are watched — some environments only deliver one of them.
  let wasNarrowScreen = isNarrowScreen();
  const onViewportChange = () => {
    const narrow = isNarrowScreen();
    if (narrow && !wasNarrowScreen) $("sidebar").classList.add("closed");
    wasNarrowScreen = narrow;
    syncSidebarBackdrop();
  };
  window.matchMedia?.("(max-width: 1359px)")?.addEventListener?.("change", onViewportChange);
  addEventListener("resize", onViewportChange);
  // Below 1360 the reading stage needs the full width, so the drawer starts
  // closed; phones additionally surface the folder-picker hint the standalone
  // Mufy reader's mobile trap taught us.
  if (isNarrowScreen()) {
    $("sidebar").classList.add("closed");
  }
  if (isPhoneScreen()) {
    const hint = $("mobileHint");
    if (hint) hint.hidden = false;
  }
  syncSidebarBackdrop();
  $("bookmarkAdd").addEventListener("click", () => addBookmark());
  $("navLibrary")?.addEventListener?.("click", () => {
    setToolTab(null);
    showLibraryHome();
  });
  $("navTraces")?.addEventListener?.("click", () => setToolTab(lastTraceTab));
  $("toolTabRecent").addEventListener("click", () => setToolTab("recent"));
  $("toolTabBookmarks").addEventListener("click", () => setToolTab("bookmarks"));
  $("toolTabAnnotations").addEventListener("click", () => setToolTab("annotations"));
  $("toolTabSearch").addEventListener("click", () => setToolTab("search"));
  syncToolTabs();

  /* Library-pane menus: 筛选 and 来源＋ expand in place; opening one closes
     the others so the tree never hides under two stacked panels. */
  function syncLibraryMenus({ filter = false, add = false, manage = false } = {}) {
    const filterMenu = $("filterMenu");
    if (filterMenu) filterMenu.hidden = !filter;
    const addMenu = $("sourceAddMenu");
    if (addMenu) addMenu.hidden = !add;
    const managePanel = $("sourceManagePanel");
    if (managePanel) managePanel.hidden = !manage;
    $("filterMenuToggle")?.setAttribute?.("aria-pressed", String(!!filter));
    $("sourceAddToggle")?.setAttribute?.("aria-pressed", String(!!add));
  }
  $("filterMenuToggle")?.addEventListener?.("click", event => {
    event.stopPropagation?.();
    syncLibraryMenus({ filter: $("filterMenu")?.hidden !== false });
  });
  $("sourceAddToggle")?.addEventListener?.("click", event => {
    event.stopPropagation?.();
    syncLibraryMenus({ add: $("sourceAddMenu")?.hidden !== false });
  });
  $("sourceManageToggle")?.addEventListener?.("click", event => {
    event.stopPropagation?.();
    renderSourceManageList();
    syncLibraryMenus({ manage: true });
  });
  $("sourceManageClose")?.addEventListener?.("click", () => syncLibraryMenus({}));
  $("readerPrefsPanel").hidden = true;
  $("readerPrefsToggle").addEventListener("click", event => {
    event.stopPropagation?.();
    $("readerPrefsPanel").hidden = !$("readerPrefsPanel").hidden;
  });
  // One document-level closer for every popover — the fake-DOM harness keeps
  // a single listener per event type, and real browsers don't need more either.
  document.addEventListener("click", event => {
    const prefs = $("readerPrefsPanel");
    if (prefs && !prefs.hidden && !event?.target?.closest?.("#readerPrefsPanel, #readerPrefsToggle")) {
      prefs.hidden = true;
    }
    const tagEditor = $("tagEditor");
    if (tagEditor && !tagEditor.hidden && !event?.target?.closest?.("#tagEditor, #tagToggle")) {
      tagEditor.hidden = true;
    }
    const exportMenu = $("exportMenu");
    if (exportMenu && !exportMenu.hidden && !event?.target?.closest?.("#exportMenu, #exportToggle")) {
      exportMenu.hidden = true;
    }
    const moreMenu = $("readerMoreMenu");
    if (moreMenu && !moreMenu.hidden && !event?.target?.closest?.("#readerMoreMenu, #readerMoreToggle")) {
      moreMenu.hidden = true;
    }
  });
  $("exportMenu").hidden = true;
  $("exportToggle").addEventListener("click", event => {
    event.stopPropagation?.();
    closeMoreMenu();
    $("exportMenu").hidden = !$("exportMenu").hidden;
  });
  $("exportCurrentMd").addEventListener("click", () => exportAs("current-markdown"));
  $("exportCurrentJson").addEventListener("click", () => exportAs("current-json"));
  $("exportListMd").addEventListener("click", () => exportAs("list-markdown"));
  $("exportListJsonl").addEventListener("click", () => exportAs("list-jsonl"));
  $("exportListEpub").addEventListener("click", () => exportAs("list-epub"));
  $("exportCurrentHtml").addEventListener("click", () => exportAs("current-html"));
  $("exportListHtml").addEventListener("click", () => exportAs("list-html"));
  $("tagEditor").hidden = true;
  $("favoriteToggle").addEventListener("click", () => toggleFavorite());
  $("tagToggle").addEventListener("click", event => {
    event.stopPropagation?.();
    closeMoreMenu();
    const editor = $("tagEditor");
    editor.hidden = !editor.hidden;
    if (!editor.hidden) {
      renderTagEditor();
      $("tagInput")?.focus?.();
    }
  });
  $("tagInput").addEventListener("keydown", event => {
    if (event.key !== "Enter") return;
    event.preventDefault?.();
    const value = String($("tagInput").value || "").trim();
    if (!value || !state.current) return;
    setConversationTags(state.current.id, [...OD.organization.tagsOf(state.organization, state.current.id), value]);
    $("tagInput").value = "";
  });
  $("favoritesFilter").addEventListener("click", () => setFavoritesOnly(!state.favoritesOnly));
  $("tagFilter").addEventListener("change", event => setTagFilter(event.target.value));
  syncOrganizeControls();
  if (window.location?.protocol?.startsWith("http") && $("demoImport")) {
    $("demoImport").hidden = false;
    $("demoImport").addEventListener("click", () => void loadDemoLibrary());
  }
  $("searchQuery").addEventListener("keydown", event => {
    if (event.key === "Enter") {
      event.preventDefault?.();
      performSearch();
    }
  });
  $("searchScopeCurrent").addEventListener("click", () => setSearchScope("current"));
  $("searchScopeLibrary").addEventListener("click", () => setSearchScope("library"));
  $("searchSource").addEventListener("change", event => {
    state.searchSourceId = event.target.value || "all";
    if (state.searchSourceId !== "all") state.searchScope = "library";
    syncSearchScope();
    void saveReaderState();
    if (String($("searchQuery")?.value || "").trim()) performSearch();
  });
  syncSearchScope();
  $("importPanel").addEventListener("toggle", () => {
    const panel = $("importPanel");
    if (pendingImportSync !== null && panel.open === pendingImportSync) {
      pendingImportSync = null;
      return;
    }
    pendingImportSync = null;
    state.importOpen = panel.open;
    void saveReaderState();
  });

  /* ── Highlight selection capture and editor (real-browser path) ──
     The anchor is computed against the raw part text via the selection's
     offset inside its .message-body, so what is stored matches what
     annotations.locate() will search for at render time. */
  let annotationEditorState = null;

  function selectionDraft() {
    if (typeof getSelection !== "function") return null;
    const selection = getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount || !state.current) return null;
    const range = selection.getRangeAt(0);
    const bodyOf = node => {
      for (let current = node; current; current = current.parentNode) {
        if (current.classList?.contains?.("message-body")) return current;
      }
      return null;
    };
    const body = bodyOf(range.startContainer);
    if (!body || body !== bodyOf(range.endContainer)) return null;
    const messageElement = body.closest?.("[data-message-id]");
    if (!messageElement) return null;
    const prefix = range.cloneRange();
    prefix.selectNodeContents(body);
    prefix.setEnd(range.startContainer, range.startOffset);
    const start = prefix.toString().length;
    const raw = body.textContent || "";
    const length = range.toString().length;
    const selectedText = raw.slice(start, start + length);
    if (selectedText.trim().length < 2) return null;
    const rect = range.getBoundingClientRect();
    return {
      messageId: messageElement.dataset.messageId,
      selectedText,
      contextBefore: raw.slice(Math.max(0, start - 30), start),
      contextAfter: raw.slice(start + length, start + length + 30),
      x: rect.left + rect.width / 2,
      y: rect.top
    };
  }

  function hideAnnotationUI() {
    $("highlightButton").hidden = true;
    $("annotationEditor").hidden = true;
    annotationEditorState = null;
  }

  function syncAnnotationSwatches(color) {
    for (const swatch of document.querySelectorAll("[data-annotation-color]")) {
      swatch.setAttribute("aria-pressed", String(swatch.dataset.annotationColor === color));
    }
  }

  function placeFloating(element, x, y) {
    if (!element.style) return;
    const width = Number(window.innerWidth || 1280);
    element.style.left = `${Math.max(8, Math.min(width - 300, x - 70))}px`;
    element.style.top = `${Math.max(8, y - 44)}px`;
  }

  function openAnnotationEditor(editorState, position) {
    annotationEditorState = editorState;
    const editor = $("annotationEditor");
    $("annotationNote").value = editorState.note || "";
    $("annotationDelete").hidden = editorState.mode !== "edit";
    syncAnnotationSwatches(editorState.color);
    editor.hidden = false;
    if (isPhoneScreen()) {
      // On phones the editor is a bottom sheet; clear any floating inline
      // position so the CSS placement wins.
      editor.style?.removeProperty?.("left");
      editor.style?.removeProperty?.("top");
    } else if (position) {
      placeFloating(editor, position.x, position.y);
    }
    $("annotationNote").focus?.();
  }

  document.addEventListener("pointerup", event => {
    if (event?.target?.closest?.("#annotationEditor, #highlightButton")) return;
    // A short delay lets the selection settle, especially on touch screens.
    setTimeout(() => {
      const draft = selectionDraft();
      const button = $("highlightButton");
      if (!draft) {
        if ($("annotationEditor").hidden) button.hidden = true;
        return;
      }
      $("annotationEditor").hidden = true;
      annotationEditorState = null;
      button.hidden = false;
      placeFloating(button, draft.x, draft.y);
      button.dataset.pending = JSON.stringify(draft);
    }, 30);
  });

  $("highlightButton").addEventListener("click", () => {
    const button = $("highlightButton");
    let draft = null;
    try { draft = JSON.parse(button.dataset.pending || "null"); } catch (_) {}
    button.hidden = true;
    if (!draft) return;
    openAnnotationEditor(
      { mode: "new", draft, color: state.annotationColor, note: "" },
      { x: draft.x, y: draft.y + 44 }
    );
  });

  $("messages").addEventListener("click", event => {
    const mark = event?.target?.closest?.("mark.annotation");
    if (!mark) return;
    const annotation = state.annotations.find(item => item.id === mark.dataset.annotationId);
    if (!annotation) return;
    const rect = mark.getBoundingClientRect?.() || { left: 120, top: 120, width: 0 };
    openAnnotationEditor(
      { mode: "edit", id: annotation.id, color: annotation.color, note: annotation.note },
      { x: rect.left + rect.width / 2, y: rect.top + 24 }
    );
  });

  $("annotationSave").addEventListener("click", () => {
    if (!annotationEditorState) return;
    const note = $("annotationNote").value;
    if (annotationEditorState.mode === "edit") {
      updateAnnotation(annotationEditorState.id, { note, color: annotationEditorState.color });
    } else {
      addAnnotation({ ...annotationEditorState.draft, color: annotationEditorState.color, note });
    }
    hideAnnotationUI();
    if (typeof getSelection === "function") getSelection()?.removeAllRanges?.();
  });
  $("annotationCancel").addEventListener("click", hideAnnotationUI);
  $("annotationDelete").addEventListener("click", () => {
    if (annotationEditorState?.mode === "edit") removeAnnotation(annotationEditorState.id);
    hideAnnotationUI();
  });

  /* Rebuilt on locale change as well as at boot; fresh buttons get fresh
     listeners, so re-running never double-binds an existing element. */
  const ANNOTATION_COLOR_KEYS = {
    yellow: "annotate.colorYellow",
    green: "annotate.colorGreen",
    pink: "annotate.colorPink",
    blue: "annotate.colorBlue",
    purple: "annotate.colorPurple"
  };
  function renderAnnotationSwatches() {
    $("annotationColors").innerHTML = OD.annotations.COLORS.map(color =>
      `<button type="button" class="annotation-swatch hl-${color}" data-annotation-color="${color}" title="${
        esc(ANNOTATION_COLOR_KEYS[color] ? t(ANNOTATION_COLOR_KEYS[color]) : color)
      }" aria-label="${esc(t("annotate.colorAria", { color }))}"></button>`
    ).join("");
    [...document.querySelectorAll("[data-annotation-color]")].forEach(swatch => {
      swatch.addEventListener("click", () => {
        if (!annotationEditorState) return;
        annotationEditorState.color = swatch.dataset.annotationColor;
        syncAnnotationSwatches(annotationEditorState.color);
      });
    });
  }
  renderAnnotationSwatches();
  $("main").addEventListener("scroll", () => {
    trackToolbarOnScroll();
    void saveReaderState();
  });
  document.addEventListener?.("keydown", event => {
    if (event.key === "Escape") {
      // Close the topmost transient layer first; never silently discard an
      // unsaved note — an edited annotation ignores Esc until saved/cancelled.
      const editor = $("annotationEditor");
      if (editor && !editor.hidden) {
        const note = String($("annotationNote")?.value ?? "");
        const baseline = String(annotationEditorState?.note ?? "");
        if (note.trim() && note !== baseline) return;
        hideAnnotationUI();
        return;
      }
      const FOCUS_RETURN = {
        readerMoreMenu: "readerMoreToggle",
        exportMenu: "exportToggle",
        tagEditor: "tagToggle",
        readerPrefsPanel: "readerPrefsToggle"
      };
      for (const id of ["readerMoreMenu", "exportMenu", "tagEditor", "readerPrefsPanel"]) {
        const panel = $(id);
        if (panel && !panel.hidden) {
          panel.hidden = true;
          $(FOCUS_RETURN[id])?.focus?.();
          return;
        }
      }
      if (!$("sidebar").classList.contains("closed") && isNarrowScreen()) {
        $("sidebar").classList.add("closed");
        syncSidebarBackdrop();
        $("sidebarToggle")?.focus?.();
        return;
      }
      setToolbarHidden(false);
      return;
    }
    const target = event.target;
    const tag = String(target?.tagName || "").toLowerCase();
    if (["input", "textarea", "select"].includes(tag) || target?.isContentEditable) return;
    if (event.key === "ArrowLeft") goPrevious();
    else if (event.key === "ArrowRight") goNext();
    else if (event.key === "Home") { event.preventDefault(); scrollMain("top"); }
    else if (event.key === "End") { event.preventDefault(); scrollMain("end"); }
  });
  document.addEventListener?.("visibilitychange", () => {
    if (document.visibilityState === "hidden") void saveReaderState({ immediate: true });
  });
  window.addEventListener("beforeunload", () => {
    void saveReaderState({ immediate: true });
    releaseArchiveAssets();
  }, { once: true });

  // Small public seam for browser smoke tests; import data remains in memory only.
  OD.app = {
    loadChatGPTFolder,
    loadSourceFolder,
    loadArchive,
    loadSolVoiceMapping,
    loadSolVoiceFolder,
    clearSolVoice,
    removeSource,
    clearSources,
    reconnectSource,
    chooseDirectory,
    openConversation,
    addBookmark,
    removeBookmark,
    renameBookmark,
    jumpToBookmark,
    addAnnotation,
    updateAnnotation,
    removeAnnotation,
    jumpToAnnotation,
    performSearch,
    setSearchScope,
    jumpToSearchHit,
    toggleFavorite,
    setConversationTags,
    setFavoritesOnly,
    setTagFilter,
    setPrintPreset,
    loadDemoLibrary,
    buildExport,
    exportAs,
    getState: () => ({
      archive: state.archive,
      current: state.current,
      sources: state.library.sources().map(source => ({
        id: source.id,
        label: source.label,
        platform: source.source?.platform || "unknown",
        conversationCount: source.conversations.length
      })),
      sourceFilter: state.sourceFilter,
      sortMode: state.sortMode,
      hasLocalAssets: !!state.assetSession,
      hasSolVoice: !!state.solVoiceSession,
      solVoiceStats: state.solVoiceSession?.stats || null,
      voiceAudioFileCount: state.solVoiceAudioFiles.length,
      organization: OD.organization.normalize(state.organization),
      favoritesOnly: !!state.favoritesOnly,
      tagFilter: state.tagFilter || "",
      filteredCount: state.filtered.length,
      filteredIds: state.filtered.map(conversation => conversation.id),
      lastSavedAt: state.lastSavedAt,
      persistenceSupported: !!state.persistence?.supported,
      persistenceError: state.persistenceError,
      readerPreferences: { ...state.readerPrefs },
      page: state.pageIndex,
      pageCount: state.pages.length,
      readingPosition: readerSettings().readingPosition,
      bookmarks: state.bookmarks.map(bookmark => ({ ...bookmark })),
      annotations: state.annotations.map(annotation => ({ ...annotation })),
      annotationColor: state.annotationColor,
      readingProgress: { ...state.readingProgress },
      recentConversations: OD.readingProgress.recent(state.readingProgress, 10).map(entry => entry.conversationId),
      searchScope: state.searchScope
    }),
    auditPersistentLibrary: refreshAcceptanceAudit
  };

  /* Resolve the UI locale before the first render pass: the stored setting
     rides in the reader-state mirror (missing or legacy values normalize to
     "auto"), and applying the static dictionary is visually a no-op for
     zh-CN because the markup's inline text already is the zh-CN copy. */
  if (OD.i18n) {
    state.locale = OD.i18n.normalizeSetting(readSettingsMirror()?.locale);
    OD.i18n.setLocale(state.locale);
    OD.i18n.applyStatic(document);
    $("currentTitle").textContent = OD.i18n.t("reader.noArchive");
    const localeControl = $("uiLocale");
    if (localeControl) localeControl.value = state.locale;
  }

  const savedTheme = localStorage.getItem("our-dialogues.theme");
  if (savedTheme) {
    state.readerPrefs = OD.readerParity.normalizePreferences({ ...state.readerPrefs, theme: savedTheme });
  }
  applyReaderPreferences();

  renderSortControl();
  renderSourceControls();
  setArchiveStatus("status.localOnly");
  OD.app.ready = bootPersistentLibrary();
})(window.OD);
