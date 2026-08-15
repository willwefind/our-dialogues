window.OD = window.OD || {};

(function(OD){
  const $ = id => document.getElementById(id);
  const state = {
    library: OD.sourceLibrary.create(),
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
    renderToken: 0
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
  }

  function setStatus(text, error=false) {
    state.statusText = text;
    state.statusError = error;
    renderStatus();
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

  function conversationMarkup(c) {
    const active = state.current?.id === c.id ? " on" : "";
    const room = c.context?.room?.name ? ` · ${esc(c.context.room.name)}` : "";
    return `<div class="conv${active}" data-id="${esc(c.id)}">
      <div class="conv-title">${esc(c.title)}</div>
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

  function sourceMarkup(source, conversations) {
    let children = "";
    if (source.source?.platform === "mufy") {
      const characters = new Map();
      for (const conversation of conversations) {
        const character = mufyCharacter(conversation);
        const group = characters.get(character.key) || { ...character, conversations: [] };
        group.conversations.push(conversation);
        characters.set(character.key, group);
      }
      children = [...characters.values()].map(character => `<details class="character-group">
        <summary>
          <span class="character-summary-label">${esc(character.name)}${character.id ? `<small class="character-identity">${esc(character.id)}</small>` : ""}</span>
          <span class="character-count">${character.conversations.length}</span>
        </summary>
        <div class="character-conversations">${character.conversations.map(conversationMarkup).join("")}</div>
      </details>`).join("");
    } else {
      children = `<div class="source-conversations">${conversations.map(conversationMarkup).join("")}</div>`;
    }
    return `<details class="source-group" data-source-id="${esc(source.id)}" open>
      <summary>
        <span class="source-summary-label">${esc(source.label)}</span>
        <span class="source-count">${conversations.length}</span>
        <button class="remove-source" type="button" data-remove-source="${esc(source.id)}" title="移除这个来源" aria-label="移除 ${esc(source.label)}">×</button>
      </summary>
      ${children}
    </details>`;
  }

  function renderSourceControls() {
    const sources = state.library.sources();
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
    state.filtered = OD.conversationOrder.filterAndSort(
      all,
      $("search").value,
      conversationHaystack,
      state.sortMode
    );

    const filteredIds = new Set(state.filtered.map(conversation => conversation.id));
    $("conversationList").innerHTML = visibleSources.map(source => sourceMarkup(
      source,
      OD.conversationOrder.sortConversations(
        source.conversations.filter(conversation => filteredIds.has(conversation.id)),
        state.sortMode
      )
    )).join("");

    [...document.querySelectorAll(".conv")].forEach(el => {
      el.addEventListener("click", () => openConversation(el.dataset.id));
    });
    [...document.querySelectorAll("[data-remove-source]")].forEach(button => {
      button.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        removeSource(button.dataset.removeSource);
      });
    });

    $("archiveMeta").textContent = `${state.filtered.length} / ${all.length} 段对话 · ${state.library.size} 个来源`;
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
    const availability = canOpen ? "滚动到此处时载入" : "仅显示附件信息";

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

  function openConversation(id) {
    const c = (state.archive?.conversations || []).find(x => x.id === id);
    if (!c) return;
    releaseRenderedAssets();
    const source = state.library.sourceForConversation(c);
    state.assetSession = source?.assetSession || null;
    state.current = c;
    $("welcome").classList.add("hidden");
    $("reader").classList.remove("hidden");
    $("currentTitle").textContent = c.title;
    $("readerTitle").textContent = c.title;

    const bits = [];
    if (source?.label) bits.push(`Source: ${source.label}`);
    if (c.context?.room?.name) bits.push(`Room: ${c.context.room.name}`);
    if (c.createdAt) bits.push(fmtDate(c.createdAt));
    bits.push(`${c.messages.length} 条消息`);
    $("readerMeta").innerHTML = bits.map(x => `<span class="badge">${esc(x)}</span>`).join("");

    const renderedAttachments = [];
    const renderedSolVoice = [];
    $("messages").innerHTML = (c.messages || []).map(m => {
      const text = OD.schema.textOf(m.content);
      const thinking = OD.schema.textOf(m.thinking);
      const recaps = Array.isArray(m.metadata?.reasoningRecap) ? m.metadata.reasoningRecap.filter(Boolean) : [];
      const sourceTrace = Array.isArray(m.metadata?.sourceTrace)
        ? m.metadata.sourceTrace.filter(item => item?.text)
        : [];
      const attachments = Array.isArray(m.attachments) ? m.attachments : [];
      const reasoningOnly = !!m.metadata?.reasoningOnly;
      const attachmentHTML = attachments.map(attachment => {
        const index = renderedAttachments.push(attachment) - 1;
        return attachmentMarkup(attachment, index);
      }).join("");
      const solVoiceHTML = state.solVoiceSession?.clipsForMessage(m.id).map(clip => {
        const index = renderedSolVoice.push(clip) - 1;
        return solVoiceMarkup(clip, index);
      }).join("") || "";
      const sourceTraceHTML = sourceTrace.length ? `<div class="source-trace"><strong>Exporter source trace · heuristic, not official thinking</strong>\n${sourceTrace.map(item => item.type === "marker"
        ? `<span class="source-trace-marker">[${esc(item.marker || "marker")}] ${esc(item.text)}</span>`
        : esc(item.text)).join("\n\n")}</div>` : "";
      return `<section class="message${reasoningOnly ? " reasoning-only" : ""}" data-role="${esc(m.role)}">
        <div class="message-who">${esc(m.speaker || m.role)}</div>
        ${text ? `<div class="message-body">${esc(text)}</div>` : ""}
        ${attachmentHTML ? `<div class="attachments">${attachmentHTML}</div>` : ""}
        ${solVoiceHTML ? `<div class="solvoice-clips">${solVoiceHTML}</div>` : ""}
        ${(thinking || recaps.length) ? `<div class="thinking"><strong>Thinking / reasoning exported by source</strong>${recaps.length ? `\n${esc(recaps.join(" · "))}` : ""}${thinking ? `\n\n${esc(thinking)}` : ""}</div>` : ""}
        ${sourceTraceHTML}
        ${m.createdAt ? `<div class="message-time">${esc(fmtDate(m.createdAt))}</div>` : ""}
      </section>`;
    }).join("");

    $("main").scrollTop = 0;
    prepareLazyAttachments(renderedAttachments);
    prepareLazySolVoice(renderedSolVoice);
    renderList();
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

  function loadArchive(archive, adapterLabel, assetSession=null, importDetails="") {
    if (!archive?.conversations?.length) throw new Error("识别成功，但没有找到任何对话。");
    const added = state.library.add({
      archive,
      label: adapterLabel,
      adapterId: archive.source?.exporter || null,
      assetSession,
      importDetails
    });
    state.sourceFilter = "all";
    state.archive = state.library.archive();
    state.current = null;
    rebuildSolVoiceSession({ rerender: false });
    const detail = importDetails ? ` · ${importDetails}` : "";
    state.archiveStatusText = added.duplicate
      ? `已在书库中：${adapterLabel} · 未重复导入 · 共 ${state.library.size} 个来源`
      : `已加入：${adapterLabel} · ${added.source.conversations.length} 段对话${detail} · 共 ${state.library.size} 个来源`;
    setStatus(state.archiveStatusText);
    renderSourceControls();
    renderList();
    const first = OD.conversationOrder.sortConversations(added.source.conversations, state.sortMode)[0];
    openConversation(first.id);
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
    state.archiveStatusText = count
      ? `已清空 ${count} 个来源；数据只从当前内存移除。`
      : "书库目前为空。";
    setStatus(state.archiveStatusText);
    return count;
  }

  function requireRecognized(result) {
    if (result?.archive && result?.adapter) return result;
    const message = OD.registry.formatDiagnostics(result?.diagnostics);
    const error = new Error(message);
    error.diagnostics = result?.diagnostics || null;
    throw error;
  }

  async function loadFile(file) {
    setStatus(`正在本地解析：${file.name}`);
    if (/\.zip$/i.test(file.name) || file.type === "application/zip") {
      const result = requireRecognized(await OD.registry.parseZIP(file));
      return loadArchive(
        result.archive,
        result.adapter.label,
        result.assetSession || null,
        result.importDetails || ""
      );
      return;
    }
    const text = await file.text();
    const data = JSON.parse(text.replace(/^\uFEFF/, ""));
    const result = requireRecognized(await OD.registry.parseJSON(data));
    return loadArchive(result.archive, result.adapter.label);
  }

  /*
    Source-folder boundary (implemented by src/core/source-folder.js):
      OD.sourceFolder.parse(File[]) -> normalized archive plus optional assets.

    ChatGPT attachment File objects remain lazy. Mufy ZIP folders are combined
    in memory using stable source IDs and never persisted or uploaded.
  */
  async function loadSourceFolder(files) {
    if (typeof OD.sourceFolder?.parse !== "function") {
      throw new Error("当前版本缺少来源文件夹导入器。");
    }

    setStatus(`正在识别来源文件夹（${files.length} 个文件）…`);
    const result = await OD.sourceFolder.parse(files);
    return loadArchive(
      result.archive,
      result.adapter.label,
      result.assetSession || null,
      result.importDetails || ""
    );
  }

  // Backward-compatible public seam for existing browser tests and integrations.
  const loadChatGPTFolder = loadSourceFolder;

  $("fileInput").addEventListener("change", async event => {
    const files = [...event.target.files];
    if (!files.length) return;
    try {
      for (const file of files) await loadFile(file);
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
      await loadSourceFolder(files);
    } catch (error) {
      console.error(error);
      setStatus(error?.message || String(error), true);
    } finally {
      event.target.value = "";
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
  $("clearSources").addEventListener("click", clearSources);
  $("sourceFilter").addEventListener("change", event => {
    state.sourceFilter = event.target.value || "all";
    renderList();
  });

  $("search").addEventListener("input", renderList);
  for (const button of document.querySelectorAll("[data-sort-mode]")) {
    button.addEventListener("click", () => setSortMode(button.dataset.sortMode));
  }
  $("hideUser").addEventListener("change", event => document.body.classList.toggle("hide-user", event.target.checked));
  $("showThinking").addEventListener("change", event => document.body.classList.toggle("show-thinking", event.target.checked));
  $("theme").addEventListener("change", event => {
    document.documentElement.dataset.theme = event.target.value;
    localStorage.setItem("our-dialogues.theme", event.target.value);
  });
  $("sidebarToggle").addEventListener("click", () => $("sidebar").classList.toggle("closed"));
  window.addEventListener("beforeunload", releaseArchiveAssets, { once: true });

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
    openConversation,
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
      filteredIds: state.filtered.map(conversation => conversation.id)
    })
  };

  const savedTheme = localStorage.getItem("our-dialogues.theme");
  if (savedTheme) {
    $("theme").value = savedTheme;
    document.documentElement.dataset.theme = savedTheme;
  }

  renderSortControl();
  renderSourceControls();
  setStatus("文件只在本机浏览器中解析，不会上传。");
  state.archiveStatusText = state.statusText;
})(window.OD);
