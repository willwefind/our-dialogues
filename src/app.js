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
    annotations: [],
    annotationColor: "yellow",
    importOpen: null,
    readingProgress: {},
    readingOrder: [],
    searchScope: "current",
    searchSourceId: "all",
    toolTab: null,
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
      const gaps = [
        stats.missingMessageCount ? `缺消息 ${stats.missingMessageCount}` : "",
        stats.missingAudioCount ? `缺音频 ${stats.missingAudioCount}` : ""
      ].filter(Boolean).join(" · ");
      return `语音已连接 ${stats.attachedPlayerCount} 段（strong ${stats.strongMappingsTotal}）${gaps ? ` · ${gaps}` : ""}`;
    }
    if (state.solVoiceMapping && !state.archive) return "语音映射就绪 · 请先导入对应的聊天导出";
    if (state.solVoiceMapping) return "语音映射就绪 · 请选择 VoiceArchive 或音频文件夹";
    if (state.solVoiceAudioFiles.length) return `音频文件夹就绪（${state.solVoiceAudioFiles.length} 个文件）· 请选择映射`;
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
      annotations: state.annotations.map(annotation => ({ ...annotation })),
      annotationColor: state.annotationColor,
      importOpen: state.importOpen,
      readingProgress: state.readingProgress,
      searchScope: state.searchScope,
      searchSourceId: state.searchSourceId,
      toolTab: state.toolTab,
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

  /* Every save also settles the per-conversation account: message anchor
     first, then page and scroll — the pattern proven per character in the
     standalone Mufy reader. */
  function recordReadingProgress() {
    if (!state.current) return;
    const source = state.library.sourceForConversation(state.current);
    const messageId = messageAnchor();
    state.readingProgress = OD.readingProgress.record(state.readingProgress, state.current.id, {
      sourceId: source?.id ?? null,
      messageId,
      page: state.pageIndex,
      scrollTop: Number($("main").scrollTop || 0),
      percent: OD.readingProgress.percent(state.current.messages, messageId)
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

  function progressLabel(entry) {
    if (!entry) return "";
    if (OD.readingProgress.isFinished(entry)) return "已读完";
    return entry.percent > 0 ? `读到 ${entry.percent}%` : "";
  }

  function conversationMarkup(c) {
    const active = state.current?.id === c.id ? " on" : "";
    const room = c.context?.room?.name ? ` · ${esc(c.context.room.name)}` : "";
    const progress = progressLabel(state.readingProgress[c.id]);
    return `<div class="conv${active}" data-id="${esc(c.id)}">
      <div class="conv-title">${esc(displayConversationTitle(c))}</div>
      <div class="conv-meta">${c.messages.length} 条${room}${c.createdAt ? ` · ${esc(fmtDate(c.createdAt))}` : ""}${progress ? ` · <span class="conv-progress">${esc(progress)}</span>` : ""}</div>
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
        return `<details class="character-group" data-character-key="${esc(characterKey)}"${open ? " open" : ""}>
        <summary>
          <span class="character-summary-label">${esc(character.name)}${character.id ? `<small class="character-identity">${esc(character.id)}</small>` : ""}</span>
          <span class="character-count">${character.conversations.length}</span>
        </summary>
        <div class="character-conversations">${ordered.map(conversationMarkup).join("")}</div>
      </details>`;
      }).join("");
    } else {
      readingOrder?.push(...conversations);
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
    $("main").scrollTop = scrollTop;
  }

  function addAnnotation(fields) {
    if (!state.current) {
      setStatus("先打开一段对话，再划线。", true);
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
      setStatus("没有可以标记的文字。", true);
      return null;
    }
    state.annotationColor = annotation.color;
    state.annotations = OD.annotations.add(state.annotations, annotation);
    refreshCurrentMessages();
    renderAnnotations();
    void saveReaderState();
    setStatus(`🖍 已划线${annotation.note ? "，小注也存了" : ""}。`);
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
      setStatus("这条划线指向的来源不在当前书库里；重新导入该来源后就能跳转。", true);
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
      list.innerHTML = `<div class="bookmarks-empty">在正文里划选一段文字，点冒出来的「🖍 标记这段」，可以挑颜色、写小注。</div>`;
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
            <button type="button" data-annotation-remove="${esc(annotation.id)}" title="删除划线" aria-label="删除划线">✕</button>
          </span>
        </div>
        ${annotation.note ? `<div class="bookmark-snippet">📝 ${esc(annotation.note)}</div>` : ""}
        <div class="bookmark-meta">${esc(annotation.conversationTitle || "")}${missing ? " ·（来源不在书库中）" : ""}${annotation.createdAt ? ` · ${esc(fmtDate(annotation.createdAt))}` : ""}</div>
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
      list.innerHTML = `<div class="bookmarks-empty">打开任意一段对话，这里会记住你读到哪。</div>`;
      return;
    }
    const conversations = new Map((state.archive?.conversations || []).map(conversation => [conversation.id, conversation]));
    list.innerHTML = entries.map(entry => {
      const conversation = conversations.get(entry.conversationId);
      const missing = !conversation;
      const title = conversation ? displayConversationTitle(conversation) : entry.conversationId;
      const finished = OD.readingProgress.isFinished(entry);
      const label = finished ? "已读完" : (entry.percent > 0 ? `读到 ${entry.percent}%` : "刚开始");
      return `<div class="recent-item${missing ? " missing" : ""}" data-recent-id="${esc(entry.conversationId)}">
        <div class="bookmark-head">
          <div class="bookmark-title">${esc(title)}</div>
          <span class="recent-progress${finished ? " finished" : ""}">${esc(label)}</span>
        </div>
        <div class="bookmark-meta">${missing ? "（来源不在书库中）" : esc(fmtDate(entry.updatedAt))}</div>
      </div>`;
    }).join("");
    [...document.querySelectorAll("#recentList .recent-item")].forEach(element => {
      element.addEventListener("click", () => {
        const id = element.dataset.recentId;
        if ((state.archive?.conversations || []).some(conversation => conversation.id === id)) {
          openConversation(id);
        } else {
          setStatus("这段对话的来源不在当前书库里；重新导入该来源后就能继续读。", true);
        }
      });
    });
  }

  const TOOL_PANES = {
    recent: ["toolTabRecent", "recentPane"],
    bookmarks: ["toolTabBookmarks", "bookmarksPane"],
    annotations: ["toolTabAnnotations", "annotationsPane"],
    search: ["toolTabSearch", "searchPane"]
  };

  function syncToolTabs() {
    const panels = $("toolPanels");
    if (!panels) return;
    panels.hidden = !state.toolTab;
    for (const [name, [tabId, paneId]] of Object.entries(TOOL_PANES)) {
      $(tabId)?.setAttribute?.("aria-pressed", String(state.toolTab === name));
      const pane = $(paneId);
      if (pane) pane.hidden = state.toolTab !== name;
    }
  }

  function setToolTab(name) {
    state.toolTab = state.toolTab === name ? null : name;
    syncToolTabs();
    if (state.toolTab === "search") $("searchQuery")?.focus?.();
    void saveReaderState();
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
      results.innerHTML = `<div class="bookmarks-empty">输入关键词后回车。「当前对话」搜正在读的这一段，「全部书库」搜所有来源。</div>`;
      return [];
    }
    let outcome;
    if (state.searchScope === "current") {
      if (!state.current) {
        countElement.textContent = "";
        results.innerHTML = `<div class="bookmarks-empty">先打开一段对话，或切换到「全部书库」。</div>`;
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
      results.innerHTML = `<div class="bookmarks-empty">没搜到。${state.searchScope === "current" ? "可以试试「全部书库」范围。" : ""}</div>`;
      return hits;
    }
    const titles = new Map((state.archive?.conversations || []).map(conversation =>
      [conversation.id, displayConversationTitle(conversation)]
    ));
    results.innerHTML = [
      truncated ? `<div class="bookmarks-empty">命中太多，只列前 ${OD.messageSearch.DEFAULT_LIMIT} 处；换个更具体的词。</div>` : "",
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
      `<option value="all">全部来源</option>`,
      ...sources.map(source => `<option value="${esc(source.id)}">${esc(source.label)}（${source.conversations.length}）</option>`)
    ].join("");
    control.value = state.searchSourceId;
  }

  function renderSourceControls() {
    const sources = state.library.sources();
    document.body.classList.toggle("has-library", sources.length > 0);
    syncImportPanel();
    renderSearchSourceControl();
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
    [...document.querySelectorAll("[data-remove-source]")].forEach(button => {
      button.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        removeSource(button.dataset.removeSource);
      });
    });

    $("archiveMeta").textContent = `${state.filtered.length} / ${all.length} 段对话 · ${state.library.size} 个来源`;
    renderBookmarks();
    renderAnnotations();
    renderRecent();
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
        <span>${esc(clip.voiceLabel || "语音")}</span>
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
      ? "Tool activity · recorded in the official export"
      : "Exporter source trace · heuristic, not official thinking";
    const sourceTraceHTML = sourceTrace.length ? `<div class="source-trace"><strong>${esc(traceLabel)}</strong>\n${sourceTrace.map(item => item.type === "marker"
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
    const order = state.readingOrder.length ? state.readingOrder : state.filtered;
    const conversationIndex = order.findIndex(conversation => conversation.id === state.current?.id);
    const hasPrevious = state.pageIndex > 0 || conversationIndex > 0;
    const hasNext = state.pageIndex < state.pages.length - 1 || (conversationIndex >= 0 && conversationIndex < order.length - 1);
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
    if (resumed && switching) setStatus("回到上次读到的地方。");
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
    state.statusText = state.archiveStatusText;
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
    if (Array.isArray(settings.annotations)) state.annotations = OD.annotations.normalize(settings.annotations);
    if (typeof settings.annotationColor === "string") state.annotationColor = OD.annotations.normalizeColor(settings.annotationColor);
    if (typeof settings.importOpen === "boolean") state.importOpen = settings.importOpen;
    if (settings.readingProgress && typeof settings.readingProgress === "object") {
      state.readingProgress = OD.readingProgress.normalize(settings.readingProgress);
    }
    if (["current", "library"].includes(settings.searchScope)) state.searchScope = settings.searchScope;
    if (typeof settings.searchSourceId === "string" && settings.searchSourceId) state.searchSourceId = settings.searchSourceId;
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
  $("toolTabRecent").addEventListener("click", () => setToolTab("recent"));
  $("toolTabBookmarks").addEventListener("click", () => setToolTab("bookmarks"));
  $("toolTabAnnotations").addEventListener("click", () => setToolTab("annotations"));
  $("toolTabSearch").addEventListener("click", () => setToolTab("search"));
  syncToolTabs();
  $("readerPrefsPanel").hidden = true;
  $("readerPrefsToggle").addEventListener("click", event => {
    event.stopPropagation?.();
    $("readerPrefsPanel").hidden = !$("readerPrefsPanel").hidden;
  });
  document.addEventListener("click", event => {
    const panel = $("readerPrefsPanel");
    if (!panel || panel.hidden) return;
    if (event?.target?.closest?.("#readerPrefsPanel, #readerPrefsToggle")) return;
    panel.hidden = true;
  });
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
    if (position) placeFloating(editor, position.x, position.y);
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

  $("annotationColors").innerHTML = OD.annotations.COLORS.map(color =>
    `<button type="button" class="annotation-swatch hl-${color}" data-annotation-color="${color}" title="${
      ({ yellow: "黄", green: "绿", pink: "粉", blue: "蓝", purple: "紫" })[color] || color
    }" aria-label="荧光笔：${color}"></button>`
  ).join("");
  [...document.querySelectorAll("[data-annotation-color]")].forEach(swatch => {
    swatch.addEventListener("click", () => {
      if (!annotationEditorState) return;
      annotationEditorState.color = swatch.dataset.annotationColor;
      syncAnnotationSwatches(annotationEditorState.color);
    });
  });
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
    addAnnotation,
    updateAnnotation,
    removeAnnotation,
    jumpToAnnotation,
    performSearch,
    setSearchScope,
    jumpToSearchHit,
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
