window.OD = window.OD || {};

(function(OD){
  const $ = id => document.getElementById(id);
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
    archiveStatusText: "",
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
    booted: false
  };

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  }

  function fmtDate(value) {
    if (!value) return "";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleString();
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
      return `SolVoice strong ${stats.strongMappingsTotal} · messages ${stats.strongMappingsWhoseMessageIdExists}/${stats.strongMappingsTotal} · audio ${stats.audioFileResolvedCount}/${stats.strongMappingsTotal} · players ${stats.attachedPlayerCount} · missing message ${stats.missingMessageCount} · missing audio ${stats.missingAudioCount}`;
    }
    if (state.solVoiceMapping && !state.archive) return "SolVoice mapping ready · load a ChatGPT export";
    if (state.solVoiceMapping) return "SolVoice mapping ready · choose VoiceArchive or sol/audio";
    if (state.solVoiceAudioFiles.length) return `SolVoice audio folder ready (${state.solVoiceAudioFiles.length} files) · choose mapping`;
    return "";
  }

  function renderStatus() {
    $("status").textContent = [state.statusText, solVoiceStatusText()].filter(Boolean).join(" · ");
    $("status").classList.toggle("error", state.statusError);
    renderLocalLibraryStatus();
  }

  function renderLocalLibraryStatus() {
    const element = $("localLibraryStatus");
    if (!element) return;
    if (!state.persistence?.supported) {
      element.textContent = "本地书库：当前浏览器不支持 IndexedDB；本次仍只保存在页面内。";
    } else if (state.persistenceError) {
      element.textContent = `本地书库：${state.persistenceError}`;
    } else if (state.lastSavedAt) {
      element.textContent = `本地书库：已保存 · 最后更新 ${fmtDate(state.lastSavedAt)}`;
    } else {
      element.textContent = "本地书库：准备就绪；成功导入后会自动保存文字内容。";
    }
    const clear = $("clearLocalLibrary");
    if (clear) clear.disabled = state.library.size === 0 && !state.persistenceError;
  }

  function setStatus(text, error=false) {
    state.statusText = text;
    state.statusError = error;
    renderStatus();
  }

  function readSettingsMirror() {
    try {
      const value = JSON.parse(localStorage.getItem(SETTINGS_MIRROR_KEY) || "null");
      return value && typeof value === "object" ? value : null;
    } catch (_) {
      return null;
    }
  }

  function messageAnchor() {
    const messages = [...$("messages").querySelectorAll("[data-message-id]")];
    if (!messages.length) return null;
    const scrollTop = Number($("main").scrollTop || 0);
    const anchor = messages.find(element => Number(element.offsetTop || 0) >= scrollTop) || messages.at(-1);
    return anchor?.dataset?.messageId || null;
  }

  function readerSettings() {
    return {
      sourceFilter: state.sourceFilter,
      conversationSort: state.sortMode,
      hideUser: !!$("hideUser").checked,
      showThinking: !!$("showThinking").checked,
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
    root.style?.setProperty?.("--reader-font-size", `${state.readerPrefs.fontSize}px`);
    root.style?.setProperty?.("--reader-line-height", String(state.readerPrefs.lineHeight));
    root.style?.setProperty?.("--cw", `${state.readerPrefs.contentWidth}px`);
    root.style?.setProperty?.("--reader-font-family", OD.readerParity.FONT_FAMILIES[state.readerPrefs.fontFamily]);
    root.dataset.theme = state.readerPrefs.theme;
    $("theme").value = state.readerPrefs.theme;
    $("lineHeight").value = String(state.readerPrefs.lineHeight);
    $("contentWidth").value = String(state.readerPrefs.contentWidth);
    $("fontFamily").value = state.readerPrefs.fontFamily;
    $("readingMode").value = state.readerPrefs.readingMode;
    $("pageLength").value = state.readerPrefs.pageLength;
    $("pageLength").disabled = state.readerPrefs.readingMode !== "page";
    document.body.classList.toggle("page-mode", state.readerPrefs.readingMode === "page");
  }

  function saveReaderState({ immediate = false } = {}) {
    const settings = readerSettings();
    updateAcceptanceReadingPosition(settings.readingPosition);
    try { localStorage.setItem(SETTINGS_MIRROR_KEY, JSON.stringify(settings)); } catch (_) {}
    if (!state.persistence?.supported) return Promise.resolve();
    const write = async () => {
      state.saveTimer = null;
      try {
        await state.persistence.saveSettings(settings);
      } catch (error) {
        state.persistenceError = error?.message || "保存设置失败";
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
      state.persistenceError = error?.message || "保存失败；当前页面内容仍可继续阅读";
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

  function displayConversationTitle(conversation) {
    return state.titleLabels.get(String(conversation?.id)) || String(conversation?.title || "");
  }

  function conversationMarkup(c) {
    const active = state.current?.id === c.id ? " on" : "";
    const room = c.context?.room?.name ? ` · ${esc(c.context.room.name)}` : "";
    return `<div class="conv${active}" data-id="${esc(c.id)}">
      <div class="conv-title">${esc(displayConversationTitle(c))}</div>
      <div class="conv-meta">${c.messages.length} 条${room}${c.createdAt ? ` · ${esc(fmtDate(c.createdAt))}` : ""}</div>
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
      name: String(metadata.characterName || participant?.name || "未命名角色")
    };
  }

  function isGreetingConversation(conversation) {
    return conversation.context?.sourceMetadata?.isGreeting === true;
  }

  function sourceMarkup(source, conversations, searching) {
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
        const characterKey = `${source.id}::${character.key}`;
        const stored = state.groupState.characters[characterKey];
        const containsCurrent = character.conversations.some(conversation => conversation.id === state.current?.id);
        const open = searching || (stored === undefined ? containsCurrent : stored === true);
        return `<details class="character-group" data-character-key="${esc(characterKey)}"${open ? " open" : ""}>
        <summary>
          <span class="character-summary-label">${esc(character.name)}${character.id ? `<small class="character-identity">${esc(character.id)}</small>` : ""}</span>
          <span class="character-count">${character.conversations.length}</span>
        </summary>
        <div class="character-conversations">${ordered.map(conversationMarkup).join("")}</div>
      </details>`;
      }).join("");
    } else {
      children = `<div class="source-conversations">${conversations.map(conversationMarkup).join("")}</div>`;
    }
    const storedSource = state.groupState.sources[source.id];
    const sourceOpen = searching || (storedSource === undefined ? true : storedSource !== false);
    return `<details class="source-group" data-source-id="${esc(source.id)}"${sourceOpen ? " open" : ""}>
      <summary>
        <span class="source-summary-label">${esc(source.label)}</span>
        <span class="source-count">${conversations.length}</span>
        <button class="remove-source" type="button" data-remove-source="${esc(source.id)}" title="移除这个来源" aria-label="移除 ${esc(source.label)}">×</button>
      </summary>
      ${children}
    </details>`;
  }

  function bookmarkSnippet(conversation, messageId) {
    const message = (conversation.messages || []).find(item => String(item.id) === String(messageId));
    return message ? OD.schema.textOf(message.content) : "";
  }

  function addBookmark() {
    if (!state.current) {
      setStatus("先打开一段对话，再存书签。", true);
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
    setStatus(`🔖 已存书签：${OD.bookmarks.displayTitle(bookmark)}`);
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
      setStatus("这个书签指向的来源不在当前书库里；重新导入该来源后就能跳转。", true);
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
      list.innerHTML = `<div class="bookmarks-empty">读到想回来的地方，点上方「🔖 存书签」。</div>`;
      return;
    }
    const available = new Set((state.archive?.conversations || []).map(conversation => conversation.id));
    list.innerHTML = state.bookmarks.map(bookmark => {
      const missing = !available.has(bookmark.conversationId);
      const editing = state.editingBookmarkId === bookmark.id;
      const title = editing
        ? `<input class="bookmark-rename" data-bookmark-rename="${esc(bookmark.id)}" value="${esc(bookmark.label)}" placeholder="${esc(bookmark.conversationTitle)}" aria-label="书签名称">`
        : `<div class="bookmark-title">${esc(OD.bookmarks.displayTitle(bookmark))}</div>`;
      return `<div class="bookmark${missing ? " missing" : ""}" data-bookmark-id="${esc(bookmark.id)}">
        <div class="bookmark-head">
          ${title}
          <span class="bookmark-actions">
            <button type="button" data-bookmark-edit="${esc(bookmark.id)}" title="改名" aria-label="改名">✎</button>
            <button type="button" data-bookmark-remove="${esc(bookmark.id)}" title="删除书签" aria-label="删除书签">✕</button>
          </span>
        </div>
        ${bookmark.snippet ? `<div class="bookmark-snippet">${esc(bookmark.snippet)}</div>` : ""}
        <div class="bookmark-meta">${esc(bookmark.sourceLabel || "")}${missing ? " ·（来源不在书库中）" : ""}${bookmark.createdAt ? ` · ${esc(fmtDate(bookmark.createdAt))}` : ""}</div>
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

  function renderSourceControls() {
    const sources = state.library.sources();
    document.body.classList.toggle("has-library", sources.length > 0);
    const selected = sources.some(source => source.id === state.sourceFilter) ? state.sourceFilter : "all";
    state.sourceFilter = selected;
    $("sourceFilter").innerHTML = [
      `<option value="all">全部来源（${sources.length}）</option>`,
      ...sources.map(source => `<option value="${esc(source.id)}">${esc(source.label)}（${source.conversations.length}）</option>`)
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
    );

    const filteredIds = new Set(state.filtered.map(conversation => conversation.id));
    // While a search query is active every group is forced open so hits stay
    // visible; those forced states are not recorded as the user's choice.
    const searching = String($("search").value || "").trim() !== "";
    state.searchForcedOpen = searching;
    $("conversationList").innerHTML = visibleSources.map(source => sourceMarkup(
      source,
      OD.conversationOrder.sortConversations(
        source.conversations.filter(conversation => filteredIds.has(conversation.id)),
        state.sortMode
      ),
      searching
    )).join("");

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
    [...document.querySelectorAll("[data-remove-source]")].forEach(button => {
      button.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        removeSource(button.dataset.removeSource);
      });
    });

    $("archiveMeta").textContent = `${state.filtered.length} / ${all.length} 段对话 · ${state.library.size} 个来源`;
    renderBookmarks();
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
    const availability = canOpen ? "滚动到此处时载入" : (canReconnect ? "重新连接来源后打开" : "仅显示附件信息");
    const reconnect = canReconnect ? `<button class="attachment-reconnect" type="button" data-reconnect-source="${esc(source.id)}">重新连接来源</button>` : "";

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
      if (!url) throw new Error("本地归档中没有找到这个附件文件。");
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
        link.querySelector(".attachment-action").textContent = "下载";
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
      if (loading) loading.textContent = error?.message || "附件无法打开";
      const action = element.querySelector(".attachment-action");
      if (action) action.textContent = "无法打开";
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
        <span>SolVoice</span>
        <small title="Reader v1 only attaches confidence=strong mappings">local · strong</small>
      </figcaption>
      <div class="solvoice-viewport">
        <div class="solvoice-loading">Ready when this message scrolls into view</div>
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
      if (!url) throw new Error("The local SolVoice audio file is unavailable.");
      if (token !== state.renderToken || !element.isConnected) return;
      const audio = document.createElement("audio");
      audio.controls = true;
      audio.preload = "metadata";
      audio.src = url;
      audio.setAttribute("aria-label", "SolVoice local audio");
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
      if (loading) loading.textContent = "Local audio unavailable";
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
      ? { label: block.progress.label || "进度", value: Math.max(0, Math.min(100, Number(block.progress.value))) }
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
      return `<details class="source-rich-block source-rich-details source-rich-${variant}"><summary>${esc(block.title || "详情")}</summary><div class="source-rich-details-body">${content}</div></details>`;
    }
    return `<section class="source-rich-block source-rich-status source-rich-kind-${kind} source-rich-${variant}">${block.title ? `<header>${esc(block.title)}</header>` : ""}${block.subtitle ? `<div class="source-rich-subtitle">${esc(block.subtitle)}</div>` : ""}${content}</section>`;
  }

  function messageContentMarkup(content) {
    const items = Array.isArray(content) ? content : [{ type: "text", text: String(content ?? "") }];
    return items.map(item => {
      if (item?.type === "source-rich-block") return richBlockMarkup(item);
      const text = item?.text == null ? "" : String(item.text);
      return text ? `<div class="message-body">${esc(text)}</div>` : "";
    }).join("");
  }

  function messageMarkup(message, renderedAttachments, renderedSolVoice) {
    const contentHTML = messageContentMarkup(message.content);
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
    const sourceTraceHTML = sourceTrace.length ? `<div class="source-trace"><strong>Exporter source trace · heuristic, not official thinking</strong>\n${sourceTrace.map(item => item.type === "marker"
      ? `<span class="source-trace-marker">[${esc(item.marker || "marker")}] ${esc(item.text)}</span>`
      : esc(item.text)).join("\n\n")}</div>` : "";
    return `<section class="message${reasoningOnly ? " reasoning-only" : ""}" data-role="${esc(message.role)}" data-message-id="${esc(message.id)}">
      <div class="message-who">${esc(message.speaker || message.role)}</div>
      ${contentHTML}
      ${attachmentHTML ? `<div class="attachments">${attachmentHTML}</div>` : ""}
      ${solVoiceHTML ? `<div class="solvoice-clips">${solVoiceHTML}</div>` : ""}
      ${(thinking || recaps.length) ? `<div class="thinking"><strong>Thinking / reasoning exported by source</strong>${recaps.length ? `\n${esc(recaps.join(" · "))}` : ""}${thinking ? `\n\n${esc(thinking)}` : ""}</div>` : ""}
      ${sourceTraceHTML}
      ${message.createdAt ? `<div class="message-time">${esc(fmtDate(message.createdAt))}</div>` : ""}
    </section>`;
  }

  function renderPageNavigation() {
    const pageMode = state.readerPrefs.readingMode === "page";
    const conversationIndex = state.filtered.findIndex(conversation => conversation.id === state.current?.id);
    const hasPrevious = state.pageIndex > 0 || conversationIndex > 0;
    const hasNext = state.pageIndex < state.pages.length - 1 || (conversationIndex >= 0 && conversationIndex < state.filtered.length - 1);
    $("previousPage").disabled = !hasPrevious;
    $("nextPage").disabled = !hasNext;
    $("previousPage").textContent = state.pageIndex > 0 ? "← 上一页" : "← 上一段";
    $("nextPage").textContent = state.pageIndex < state.pages.length - 1 ? "下一页 →" : "下一段 →";
    $("pageIndicator").hidden = !pageMode;
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
    releaseRenderedAssets();
    const source = state.library.sourceForConversation(c);
    state.assetSession = source?.assetSession || null;
    state.current = c;
    $("welcome").classList.add("hidden");
    $("reader").classList.remove("hidden");
    const displayedTitle = displayConversationTitle(c);
    $("currentTitle").textContent = displayedTitle;
    $("readerTitle").textContent = displayedTitle;

    const bits = [];
    if (source?.label) bits.push(`Source: ${source.label}`);
    if (c.context?.room?.name) bits.push(`Room: ${c.context.room.name}`);
    if (c.createdAt) bits.push(fmtDate(c.createdAt));
    bits.push(`${c.messages.length} 条消息`);
    $("readerMeta").innerHTML = bits.map(x => `<span class="badge">${esc(x)}</span>`).join("");

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
    renderList();
    renderPageNavigation();
    void saveReaderState();
  }

  function goPrevious() {
    if (!state.current) return;
    if (state.pageIndex > 0) return openConversation(state.current.id, { page: state.pageIndex - 1 });
    const index = state.filtered.findIndex(conversation => conversation.id === state.current.id);
    const previous = state.filtered[index - 1];
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
    const index = state.filtered.findIndex(conversation => conversation.id === state.current.id);
    const next = state.filtered[index + 1];
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

    const chatGPTConversations = state.library.sources()
      .filter(source => source.source?.platform === "chatgpt")
      .flatMap(source => source.conversations);
    if (chatGPTConversations.length && state.solVoiceMapping) {
      state.solVoiceSession = OD.solVoiceSidecar.buildSession({
        archive: { ...state.archive, conversations: chatGPTConversations },
        mappingDocument: state.solVoiceMapping,
        audioFiles: state.solVoiceAudioFiles,
        urlAPI: URL
      });
    }
    state.statusError = false;
    if (rerender && currentId && state.archive) openConversation(currentId);
    renderStatus();
    return state.solVoiceSession;
  }

  async function loadSolVoiceMapping(file) {
    const document = OD.solVoiceSidecar.parseMapping(await file.text());
    state.solVoiceMapping = document;
    const session = rebuildSolVoiceSession();
    state.statusText = state.archiveStatusText;
    renderStatus();
    return session;
  }

  async function loadSolVoiceFolder(files) {
    const selected = [...files];
    const mappingFile = OD.solVoiceSidecar.findMappingFile(selected);
    if (mappingFile) {
      state.solVoiceMapping = OD.solVoiceSidecar.parseMapping(await mappingFile.text());
    }
    state.solVoiceAudioFiles = selected.filter(file =>
      /\.(?:mp3|m4a|aac|wav|ogg|oga|flac|opus)$/i.test(
        OD.solVoiceSidecar.normalizePath(file.webkitRelativePath || file.name)
      )
    );
    const session = rebuildSolVoiceSession();
    state.statusText = state.archiveStatusText;
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
    state.statusText = state.archiveStatusText;
    state.statusError = false;
    if (currentId && state.archive) openConversation(currentId);
    renderStatus();
  }

  function loadArchive(archive, adapterLabel, assetSession=null, importDetails="", options={}) {
    if (!archive?.conversations?.length) throw new Error("识别成功，但没有找到任何对话。");
    const expected = options.expectedSourceId ? state.library.get(options.expectedSourceId) : null;
    if (expected && expected.fingerprint !== OD.sourceLibrary.archiveFingerprint(archive)) {
      OD.sourceLibrary._internals.disposeAssetSession(assetSession);
      throw new Error("选择的文件与需要重新连接的来源不一致；文字书库未改变。");
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
    state.archiveStatusText = added.reconnected
      ? `已重新连接：${added.source.label} · 聊天文字未重复导入`
      : added.duplicate
      ? `已在书库中：${adapterLabel} · 未重复导入 · 共 ${state.library.size} 个来源`
      : `已加入：${adapterLabel} · ${added.source.conversations.length} 段对话${detail} · 共 ${state.library.size} 个来源`;
    setStatus(state.archiveStatusText);
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
    $("reader").classList.add("hidden");
    $("welcome").classList.remove("hidden");
    $("currentTitle").textContent = "尚未载入档案";
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
        state.persistenceError = error?.message || "移除本地来源失败";
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
    state.archiveStatusText = state.library.size
      ? `已移除：${source.label} · 书库剩余 ${state.library.size} 个来源`
      : "书库已清空；本页仍不会上传任何文件。";
    setStatus(state.archiveStatusText);
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
        state.persistenceError = error?.message || "清除本地书库失败";
        renderLocalLibraryStatus();
      });
    state.archiveStatusText = count
      ? `已清空 ${count} 个来源；本地持久书库也已清除。`
      : "书库目前为空。";
    setStatus(state.archiveStatusText);
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
    setStatus(`正在本地解析：${file.name}`);
    if (/\.zip$/i.test(file.name) || file.type === "application/zip") {
      const result = requireRecognized(await OD.registry.parseZIP(file));
      return loadArchive(
        result.archive,
        result.adapter.label,
        result.assetSession || null,
        result.importDetails || "",
        { ...options, reconnectMode: "file" }
      );
    }
    const text = await file.text();
    const data = JSON.parse(text.replace(/^\uFEFF/, ""));
    const result = requireRecognized(await OD.registry.parseJSON(data));
    return loadArchive(result.archive, result.adapter.label, null, "", { ...options, reconnectMode: "file" });
  }

  /*
    Source-folder boundary (implemented by src/core/source-folder.js):
      OD.sourceFolder.parse(File[]) -> normalized archive plus optional assets.

    ChatGPT attachment File objects remain lazy. Mufy ZIP folders are combined
    in memory using stable source IDs and never persisted or uploaded.
  */
  async function loadSourceFolder(files, options={}) {
    if (typeof OD.sourceFolder?.parse !== "function") {
      throw new Error("当前版本缺少来源文件夹导入器。");
    }

    setStatus(`正在识别来源文件夹（${files.length} 个文件）…`);
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
      setStatus(`请选择“${source.label}”原来的本地${source.reconnectMode === "file" ? "文件" : "文件夹"}；聊天文字仍可阅读。`);
      return true;
    } catch (error) {
      if (error?.name === "AbortError") return false;
      console.error(error);
      setStatus(error?.message || "无法重新连接本地来源。", true);
      return false;
    }
  }

  function applyReaderSettings(settings) {
    if (!settings || typeof settings !== "object") return;
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
      state.archiveStatusText = restored.sources.length
        ? `从本地书库恢复 ${restored.sources.length} 个来源 / ${conversations.length} 段对话；聊天文字可直接阅读。`
        : "文件只在本机浏览器中解析，不会上传。";
      setStatus(state.archiveStatusText);
      state.booted = true;
      return { sourceCount: restored.sources.length, conversationCount: conversations.length };
    } catch (error) {
      console.error("Could not restore the local library", error);
      state.persistenceError = `${error?.message || "恢复失败"}；可清除本地书库后重新导入`;
      state.archiveStatusText = "本地书库恢复失败；Reader 仍可继续添加来源。";
      setStatus(state.archiveStatusText, true);
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
      setStatus(error?.message || "无法打开来源文件夹。", true);
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
        setStatus(error?.message || "无法重置本地书库。", true);
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
  function updateReaderPreference(key, value, { rerender = true } = {}) {
    const position = readerSettings().readingPosition;
    state.readerPrefs = OD.readerParity.normalizePreferences({ ...state.readerPrefs, [key]: value });
    applyReaderPreferences();
    if (rerender && state.current) openConversation(state.current.id, { restorePosition: position });
    void saveReaderState();
  }
  $("fontSmaller").addEventListener("click", () => updateReaderPreference("fontSize", state.readerPrefs.fontSize - 1, { rerender: false }));
  $("fontLarger").addEventListener("click", () => updateReaderPreference("fontSize", state.readerPrefs.fontSize + 1, { rerender: false }));
  $("lineHeight").addEventListener("change", event => updateReaderPreference("lineHeight", event.target.value, { rerender: false }));
  $("contentWidth").addEventListener("change", event => updateReaderPreference("contentWidth", event.target.value, { rerender: false }));
  $("fontFamily").addEventListener("change", event => updateReaderPreference("fontFamily", event.target.value, { rerender: false }));
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
    if (typeof main.scrollTo === "function") main.scrollTo({ top, behavior: "smooth" });
    else main.scrollTop = top;
  }
  $("toTop").addEventListener("click", () => scrollMain("top"));
  $("toEnd").addEventListener("click", () => scrollMain("end"));
  $("sidebarToggle").addEventListener("click", () => $("sidebar").classList.toggle("closed"));
  $("bookmarkAdd").addEventListener("click", () => addBookmark());
  $("main").addEventListener("scroll", () => void saveReaderState());
  document.addEventListener?.("keydown", event => {
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
      filteredCount: state.filtered.length,
      filteredIds: state.filtered.map(conversation => conversation.id),
      lastSavedAt: state.lastSavedAt,
      persistenceSupported: !!state.persistence?.supported,
      persistenceError: state.persistenceError,
      readerPreferences: { ...state.readerPrefs },
      page: state.pageIndex,
      pageCount: state.pages.length,
      readingPosition: readerSettings().readingPosition,
      bookmarks: state.bookmarks.map(bookmark => ({ ...bookmark }))
    }),
    auditPersistentLibrary: refreshAcceptanceAudit
  };

  const savedTheme = localStorage.getItem("our-dialogues.theme");
  if (savedTheme) {
    state.readerPrefs = OD.readerParity.normalizePreferences({ ...state.readerPrefs, theme: savedTheme });
  }
  applyReaderPreferences();

  renderSortControl();
  renderSourceControls();
  setStatus("文件只在本机浏览器中解析，不会上传。");
  state.archiveStatusText = state.statusText;
  OD.app.ready = bootPersistentLibrary();
})(window.OD);
