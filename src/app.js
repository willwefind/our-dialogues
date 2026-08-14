window.OD = window.OD || {};

(function(OD){
  const $ = id => document.getElementById(id);
  const state = { archive: null, filtered: [], current: null };

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  }

  function fmtDate(value) {
    if (!value) return "";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleString();
  }

  function setStatus(text, error=false) {
    $("status").textContent = text;
    $("status").style.color = error ? "#b33224" : "";
  }

  function conversationHaystack(c) {
    const body = (c.messages || []).map(m => OD.schema.textOf(m.content)).join("\n");
    return `${c.title}\n${body}`.toLowerCase();
  }

  function renderList() {
    const q = $("search").value.trim().toLowerCase();
    const all = state.archive?.conversations || [];
    state.filtered = q ? all.filter(c => conversationHaystack(c).includes(q)) : all;

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
  }

  function openConversation(id) {
    const c = (state.archive?.conversations || []).find(x => x.id === id);
    if (!c) return;
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

    $("messages").innerHTML = (c.messages || []).map(m => {
      const text = OD.schema.textOf(m.content);
      const thinking = OD.schema.textOf(m.thinking);
      return `<section class="message" data-role="${esc(m.role)}">
        <div class="message-who">${esc(m.speaker || m.role)}</div>
        <div class="message-body">${esc(text)}</div>
        ${thinking ? `<div class="thinking"><strong>Thinking / reasoning exported by source</strong>\n\n${esc(thinking)}</div>` : ""}
        ${m.createdAt ? `<div class="message-time">${esc(fmtDate(m.createdAt))}</div>` : ""}
      </section>`;
    }).join("");

    renderList();
    $("main").scrollTop = 0;
  }

  function loadArchive(archive, adapterLabel) {
    if (!archive?.conversations?.length) throw new Error("识别成功，但没有找到任何对话。");
    state.archive = archive;
    state.current = null;
    setStatus(`已识别：${adapterLabel} · ${archive.conversations.length} 段对话`);
    renderList();
    openConversation(archive.conversations[0].id);
  }

  async function loadFile(file) {
    setStatus(`正在本地解析：${file.name}`);
    if (/\.zip$/i.test(file.name) || file.type === "application/zip") {
      const result = await OD.registry.parseZIP(file);
      loadArchive(result.archive, result.adapter.label);
      return;
    }
    const text = await file.text();
    const data = JSON.parse(text.replace(/^\uFEFF/, ""));
    const result = await OD.registry.parseJSON(data);
    loadArchive(result.archive, result.adapter.label);
  }

  $("fileInput").addEventListener("change", async ev => {
    const files = [...ev.target.files];
    if (!files.length) return;
    try { await loadFile(files[0]); }
    catch (e) { console.error(e); setStatus(e?.message || String(e), true); }
    finally { ev.target.value = ""; }
  });

  $("search").addEventListener("input", renderList);
  $("hideUser").addEventListener("change", ev => document.body.classList.toggle("hide-user", ev.target.checked));
  $("showThinking").addEventListener("change", ev => document.body.classList.toggle("show-thinking", ev.target.checked));
  $("theme").addEventListener("change", ev => {
    document.documentElement.dataset.theme = ev.target.value;
    localStorage.setItem("our-dialogues.theme", ev.target.value);
  });
  $("sidebarToggle").addEventListener("click", () => $("sidebar").classList.toggle("closed"));

  const savedTheme = localStorage.getItem("our-dialogues.theme");
  if (savedTheme) {
    $("theme").value = savedTheme;
    document.documentElement.dataset.theme = savedTheme;
  }

  setStatus("文件只在本机浏览器中解析。");
})(window.OD);
