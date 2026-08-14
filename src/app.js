window.OD = window.OD || {};

(function(OD){
  const $ = id => document.getElementById(id);
  const state = {
    archive: null,
    filtered: [],
    current: null,
    sortMode: OD.conversationOrder.readStoredMode(window.localStorage),
    assetSession: null,
    mediaObserver: null,
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

  function setStatus(text, error=false) {
    $("status").textContent = text;
    $("status").classList.toggle("error", error);
  }

  function conversationHaystack(c) {
    const body = (c.messages || []).map(m => OD.schema.textOf(m.content)).join("\n");
    return `${c.title}\n${body}`.toLowerCase();
  }

  function releaseRenderedAssets() {
    state.renderToken += 1;
    state.mediaObserver?.disconnect();
    state.mediaObserver = null;
    try {
      state.assetSession?.objectURLs?.revokeAll?.();
    } catch (error) {
      console.warn("Could not release attachment object URLs", error);
    }
  }

  function releaseArchiveAssets() {
    const assetSession = state.assetSession;
    releaseRenderedAssets();
    try {
      assetSession?.dispose?.();
    } catch (error) {
      console.warn("Could not dispose attachment session", error);
    }
    state.assetSession = null;
  }

  function renderList() {
    const all = state.archive?.conversations || [];
    state.filtered = OD.conversationOrder.filterAndSort(
      all,
      $("search").value,
      conversationHaystack,
      state.sortMode
    );

    $("conversationList").innerHTML = state.filtered.map(c => {
      const active = state.current?.id === c.id ? " on" : "";
      const room = c.context?.room?.name ? ` · ${esc(c.context.room.name)}` : "";
      return `<div class="conv${active}" data-id="${esc(c.id)}">
        <div class="conv-title">${esc(c.title)}</div>
        <div class="conv-meta">${c.messages.length} 条${room}${c.createdAt ? ` · ${esc(fmtDate(c.createdAt))}` : ""}</div>
      </div>`;
    }).join("");

    [...document.querySelectorAll(".conv")].forEach(el => {
      el.addEventListener("click", () => openConversation(el.dataset.id));
    });

    $("archiveMeta").textContent = `${state.filtered.length} / ${all.length} 段对话`;
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

  function openConversation(id) {
    const c = (state.archive?.conversations || []).find(x => x.id === id);
    if (!c) return;
    releaseRenderedAssets();
    state.current = c;
    $("welcome").classList.add("hidden");
    $("reader").classList.remove("hidden");
    $("currentTitle").textContent = c.title;
    $("readerTitle").textContent = c.title;

    const bits = [];
    if (c.context?.room?.name) bits.push(`Room: ${c.context.room.name}`);
    if (c.createdAt) bits.push(fmtDate(c.createdAt));
    bits.push(`${c.messages.length} 条消息`);
    $("readerMeta").innerHTML = bits.map(x => `<span class="badge">${esc(x)}</span>`).join("");

    const renderedAttachments = [];
    $("messages").innerHTML = (c.messages || []).map(m => {
      const text = OD.schema.textOf(m.content);
      const thinking = OD.schema.textOf(m.thinking);
      const recaps = Array.isArray(m.metadata?.reasoningRecap) ? m.metadata.reasoningRecap.filter(Boolean) : [];
      const attachments = Array.isArray(m.attachments) ? m.attachments : [];
      const reasoningOnly = !!m.metadata?.reasoningOnly;
      const attachmentHTML = attachments.map(attachment => {
        const index = renderedAttachments.push(attachment) - 1;
        return attachmentMarkup(attachment, index);
      }).join("");
      return `<section class="message${reasoningOnly ? " reasoning-only" : ""}" data-role="${esc(m.role)}">
        <div class="message-who">${esc(m.speaker || m.role)}</div>
        ${text ? `<div class="message-body">${esc(text)}</div>` : ""}
        ${attachmentHTML ? `<div class="attachments">${attachmentHTML}</div>` : ""}
        ${(thinking || recaps.length) ? `<div class="thinking"><strong>Thinking / reasoning exported by source</strong>${recaps.length ? `\n${esc(recaps.join(" · "))}` : ""}${thinking ? `\n\n${esc(thinking)}` : ""}</div>` : ""}
        ${m.createdAt ? `<div class="message-time">${esc(fmtDate(m.createdAt))}</div>` : ""}
      </section>`;
    }).join("");

    $("main").scrollTop = 0;
    prepareLazyAttachments(renderedAttachments);
    renderList();
  }

  function loadArchive(archive, adapterLabel, assetSession=null, importDetails="") {
    if (!archive?.conversations?.length) throw new Error("识别成功，但没有找到任何对话。");
    releaseArchiveAssets();
    state.assetSession = assetSession;
    state.archive = archive;
    state.current = null;
    const detail = importDetails ? ` · ${importDetails}` : "";
    setStatus(`已识别：${adapterLabel} · ${archive.conversations.length} 段对话${detail}`);
    renderList();
    const first = OD.conversationOrder.sortConversations(archive.conversations, state.sortMode)[0];
    openConversation(first.id);
  }

  async function loadFile(file) {
    setStatus(`正在本地解析：${file.name}`);
    if (/\.zip$/i.test(file.name) || file.type === "application/zip") {
      const result = await OD.registry.parseZIP(file);
      loadArchive(
        result.archive,
        result.adapter.label,
        result.assetSession || null,
        result.importDetails || ""
      );
      return;
    }
    const text = await file.text();
    const data = JSON.parse(text.replace(/^\uFEFF/, ""));
    const result = await OD.registry.parseJSON(data);
    loadArchive(result.archive, result.adapter.label);
  }

  /*
    Folder importer boundary (implemented by src/core/chatgpt-export-folder.js):
      OD.chatgptExportFolder.parse(File[]) ->
        { conversations, shardPaths, assetIndex, objectURLs, stats }

    assetIndex.resolve(attachment) returns availability and metadata without
    reading bytes. The backing asset may be a browser File or a lazy ZIP entry.
    objectURLs.get(attachment) is the only operation that creates a blob URL,
    and is called by the viewport observer above.
  */
  async function loadChatGPTFolder(files) {
    if (typeof OD.chatgptExportFolder?.parse !== "function") {
      throw new Error("当前版本缺少 ChatGPT Export 文件夹导入器。");
    }

    setStatus(`正在读取 ChatGPT Export 文件夹索引（${files.length} 个文件）…`);
    const folder = await OD.chatgptExportFolder.parse(files);
    const parsed = await OD.registry.parseJSON(folder.conversations);
    const objectURLs = folder.objectURLs || (folder.assetIndex?.createObjectURL ? {
      get: ref => folder.assetIndex.createObjectURL(ref),
      revoke: ref => folder.assetIndex.revokeObjectURL?.(ref),
      revokeAll: () => folder.assetIndex.revokeAllObjectURLs?.()
    } : null);
    const assetSession = { assetIndex: folder.assetIndex, objectURLs };
    const details = [];
    if (folder.shardPaths?.length) details.push(`${folder.shardPaths.length} 个分片`);
    const assetCount = folder.stats?.availableAssetCount ?? folder.stats?.assetCount ??
      folder.stats?.indexedAssets ?? folder.assetIndex?.size;
    if (Number.isFinite(assetCount)) details.push(`${assetCount} 个本地附件`);
    loadArchive(parsed.archive, parsed.adapter.label, assetSession, details.join(" · "));
  }

  $("fileInput").addEventListener("change", async event => {
    const files = [...event.target.files];
    if (!files.length) return;
    try {
      await loadFile(files[0]);
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
      await loadChatGPTFolder(files);
    } catch (error) {
      console.error(error);
      setStatus(error?.message || String(error), true);
    } finally {
      event.target.value = "";
    }
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
    loadArchive,
    openConversation,
    getState: () => ({
      archive: state.archive,
      current: state.current,
      sortMode: state.sortMode,
      hasLocalAssets: !!state.assetSession,
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
  setStatus("文件只在本机浏览器中解析，不会上传。");
})(window.OD);
