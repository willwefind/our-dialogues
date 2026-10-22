window.OD = window.OD || {};
OD.adapters = OD.adapters || [];

/*
  SillyTavern chats (`data/<user>/chats/<character>/<chat>.jsonl` and
  `data/<user>/group chats/<chat id>.jsonl`).

  A chat file is JSON Lines: one header object (`user_name`,
  `character_name`, `chat_metadata`; older builds add `create_date`) and then
  one object per message — `name`, `is_user`, `is_system`, `send_date`,
  `mes`, and optionally `extra.reasoning`, `swipes` / `swipe_id` /
  `swipe_info`. The importer hands this adapter the parsed lines as an array.

  - `mes` is the swipe the chat settled on and becomes the content. Card
    HTML (status bars, HUDs, <think>) goes through the same Reader-owned
    rich-block reading the Mufy adapter uses — these cards come from the same
    makers — and the untouched string is kept in `metadata.sourceText`
    whenever that reading changed it.
  - The other swipes are kept whole in `metadata.swipes` for a later reader;
    nothing is dropped.
  - `extra.reasoning` is real exported reasoning and goes to `thinking`.
  - `is_system` marks a message SillyTavern hides from the prompt; it is kept
    as `metadata.hidden` and still shown. `extra.type: "narrator"` reads as a
    system line.
  - Times are never invented: ISO strings, epoch numbers, and the two
    humanized formats SillyTavern has written over the years are read;
    anything else stays null. A default chat name carries its creation time
    (`Name - 2026-08-18@06h20m32s187ms`), which becomes the title and the
    conversation date; a renamed chat keeps its name as the title.
*/
(function(){
  const MONTHS = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
  const GROUP_FALLBACK_NAME = "群聊";

  function pad(value) { return String(value).padStart(2, "0"); }

  function validLocal(year, month, day, hour = 0, minute = 0, second = 0, ms = 0) {
    const date = new Date(year, month - 1, day, hour, minute, second, ms);
    if (Number.isNaN(date.getTime()) || date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
    return plausible(date);
  }

  function plausible(date) {
    const year = date.getUTCFullYear();
    return year >= 1990 && year <= 2100 ? date : null;
  }

  /* Returns a Date or null. */
  function readDate(value) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return plausible(new Date(value < 1e12 ? value * 1000 : value));
    }
    const text = String(value ?? "").trim();
    if (!text) return null;
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(text)) {
      const date = new Date(text);
      return Number.isNaN(date.getTime()) ? null : plausible(date);
    }
    if (/^\d{12,13}$/.test(text)) return readDate(Number(text));
    let match = /^(\d{4})-(\d{1,2})-(\d{1,2})\s*@\s*(\d{1,2})h\s*(\d{1,2})m\s*(\d{1,2})s(?:\s*(\d{1,3})ms)?$/i.exec(text);
    if (match) {
      const [, y, mo, d, h, mi, s, ms] = match.map(Number);
      return validLocal(y, mo, d, h, mi, s, ms || 0);
    }
    match = /^([A-Za-z]{3,9})\s+(\d{1,2}),\s*(\d{4})\s+(\d{1,2}):(\d{2})\s*(am|pm)$/i.exec(text);
    if (match) {
      const month = MONTHS.indexOf(match[1].slice(0, 3).toLowerCase()) + 1;
      if (!month) return null;
      let hour = Number(match[4]) % 12;
      if (match[6].toLowerCase() === "pm") hour += 12;
      return validLocal(Number(match[3]), month, Number(match[2]), hour, Number(match[5]));
    }
    return null;
  }

  function isoOf(value) {
    const date = readDate(value);
    return date ? date.toISOString() : null;
  }

  function isHeader(line) {
    return !!line && typeof line === "object" && !Array.isArray(line) &&
      typeof line.user_name === "string" && typeof line.character_name === "string" && !("mes" in line);
  }

  function isMessage(line) {
    return !!line && typeof line === "object" && !Array.isArray(line) &&
      typeof line.mes === "string" && typeof line.is_user === "boolean";
  }

  function isChat(lines) {
    return Array.isArray(lines) && lines.length > 0 && isHeader(lines[0]) && lines.slice(1).every(isMessage);
  }

  /* JSON Lines text → array. Blank lines are skipped; a line that does not
     parse is counted rather than guessed at. */
  function parseLines(text) {
    const lines = [];
    let invalid = 0;
    for (const raw of String(text ?? "").replace(/^﻿/, "").split(/\r?\n/)) {
      if (!raw.trim()) continue;
      try { lines.push(JSON.parse(raw)); } catch (_) { invalid += 1; }
    }
    return { lines, invalid };
  }

  function pathParts(path) {
    return String(path || "").replace(/\\/g, "/").split("/").filter(Boolean);
  }

  function stemOf(path) {
    const name = pathParts(path).pop() || "";
    return name.replace(/\.jsonl$/i, "");
  }

  function isGroupChatPath(path) {
    return pathParts(path).some(part => part.toLowerCase() === "group chats");
  }

  /* `Name - 2026-08-18@06h20m32s187ms` or a bare group-chat id. */
  function chatNameDate(stem) {
    const match = /^(?:(.*?)\s+-\s+)?(\d{4}-\d{1,2}-\d{1,2}\s*@\s*\d{1,2}h\s*\d{1,2}m\s*\d{1,2}s(?:\s*\d{1,3}ms)?)$/i.exec(stem);
    if (!match) return null;
    const date = readDate(match[2]);
    return date ? { date, prefix: match[1] || "" } : null;
  }

  function dateTitle(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function markupReader() {
    const mufy = (OD.adapters || []).find(adapter => adapter?.id === "mufy-raw");
    return mufy?._internals?.normalizeMufyContent || null;
  }

  /* A "<" that cannot open an HTML tag — `<正文>`, `<3` — is shown by
     SillyTavern as the character itself, so it is escaped before the markup
     reading, which would otherwise take `<正文>` for a tag and drop it.
     `</正文>`, `<!…>` and `<?…>` are left alone: a browser reads those as
     comments and SillyTavern never shows them either. */
  function protectLiteralAngles(value) {
    return value.replace(/<(?![A-Za-z\/!?])/g, "&lt;");
  }

  function messageText(mes, read) {
    if (!read) return { content: [{ type: "text", text: mes }], text: mes, thinking: [] };
    const normalized = read(protectLiteralAngles(mes));
    if (!normalized.content.length && mes.trim()) return { content: [{ type: "text", text: mes }], text: mes, thinking: normalized.thinking };
    return normalized;
  }

  function swipesOf(line) {
    if (!Array.isArray(line.swipes) || line.swipes.length < 2) return null;
    const info = Array.isArray(line.swipe_info) ? line.swipe_info : [];
    return {
      index: Number.isInteger(line.swipe_id) ? line.swipe_id : null,
      count: line.swipes.length,
      items: line.swipes.map((text, index) => ({
        index,
        text: String(text ?? ""),
        createdAt: isoOf(info[index]?.send_date),
        reasoning: typeof info[index]?.extra?.reasoning === "string" && info[index].extra.reasoning.trim()
          ? info[index].extra.reasoning
          : null
      }))
    };
  }

  function convertMessage(line, index, read) {
    const extra = line.extra && typeof line.extra === "object" ? line.extra : {};
    const mes = String(line.mes ?? "");
    const normalized = messageText(mes, read);
    const thinking = [];
    if (typeof extra.reasoning === "string" && extra.reasoning.trim()) thinking.push(extra.reasoning);
    thinking.push(...normalized.thinking);
    const role = line.is_user ? "user" : extra.type === "narrator" ? "system" : "assistant";
    const metadata = {
      original: {
        name: line.name ?? null,
        is_user: line.is_user,
        is_system: line.is_system ?? null,
        send_date: line.send_date ?? null,
        swipe_id: line.swipe_id ?? null
      }
    };
    if (normalized.text !== mes) metadata.sourceText = mes;
    if (line.is_system === true || line.is_system === "true") metadata.hidden = true;
    if (extra.type) metadata.originalRole = String(extra.type);
    if (extra.model) metadata.model = String(extra.model);
    if (extra.api) metadata.api = String(extra.api);
    const swipes = swipesOf(line);
    if (swipes) metadata.swipes = swipes;
    return {
      id: `m${index}`,
      role,
      speaker: String(line.name || (line.is_user ? "User" : "Character")),
      createdAt: isoOf(line.send_date),
      content: normalized.content,
      thinking: thinking.map(text => ({ type: "text", text })),
      attachments: [],
      metadata
    };
  }

  /*
    chats:  [{ path, lines }]  — path is the file's relative path, or null for
            a lone file; lines are the parsed JSON Lines.
    groups: [{ id, name, chats: [chat id, …] }] from `groups/*.json`.
  */
  function convertChats(chats, { groups = [] } = {}) {
    const read = markupReader();
    const groupByChat = new Map();
    for (const group of groups || []) {
      for (const chatId of Array.isArray(group?.chats) ? group.chats : []) {
        groupByChat.set(String(chatId), { id: String(group.id ?? chatId), name: String(group.name || GROUP_FALLBACK_NAME) });
      }
    }
    const conversations = [];
    const usedIds = new Set();
    for (const chat of chats || []) {
      if (!isChat(chat?.lines)) continue;
      const [header, ...messages] = chat.lines;
      const stem = stemOf(chat.path) || null;
      const parts = pathParts(chat.path);
      // Current builds write character_name "unused" into every header, solo
      // chats included, so only the folder says a chat is a group chat.
      const group = isGroupChatPath(chat.path)
        ? (groupByChat.get(stem) || { id: stem || "unknown", name: GROUP_FALLBACK_NAME })
        : null;
      const folder = !group && parts.length >= 2 && parts[parts.length - 2].toLowerCase() !== "chats" ? parts[parts.length - 2] : null;
      const headerName = header.character_name && header.character_name !== "unused" ? header.character_name : null;
      const firstSpeaker = messages.find(line => !line.is_user && line.name)?.name || null;
      const characterName = group ? group.name : (headerName || firstSpeaker || folder || "Character");
      const characterId = group ? `group:${group.id}` : (folder || characterName);
      const named = stem ? chatNameDate(stem) : null;
      const converted = messages.map((line, index) => convertMessage(line, index + 1, read));
      const dated = converted.map(message => message.createdAt).filter(Boolean);
      const createdAt = named ? named.date.toISOString() : (isoOf(header.create_date) || dated[0] || null);
      const title = named ? dateTitle(named.date) : (stem || (createdAt ? dateTitle(new Date(createdAt)) : characterName));

      let id = `${characterId}/${stem || "chat"}`;
      for (let suffix = 2; usedIds.has(id); suffix += 1) id = `${characterId}/${stem || "chat"}#${suffix}`;
      usedIds.add(id);

      const speakers = new Map();
      for (const message of converted) {
        if (message.role === "user" || speakers.has(message.speaker)) continue;
        speakers.set(message.speaker, { id: `speaker:${message.speaker}`, name: message.speaker, role: message.role === "system" ? "system" : "assistant" });
      }
      if (!group && !speakers.size) speakers.set(characterName, { id: "character", name: characterName, role: "assistant" });

      conversations.push({
        id,
        title,
        createdAt,
        updatedAt: dated.length ? dated[dated.length - 1] : null,
        context: {
          room: group ? { name: group.name } : null,
          sourceMetadata: {
            characterId,
            characterName,
            isGroupChat: !!group,
            chatName: stem,
            userName: header.user_name,
            titleSource: named ? "chat-name-date" : stem ? "chat-name" : "fallback",
            path: chat.path || null
          }
        },
        metadata: { titleSource: named ? "chat-name-date" : stem ? "chat-name" : "fallback" },
        participants: [{ id: "user", name: header.user_name || "User", role: "user" }, ...speakers.values()],
        messages: converted
      });
    }
    const archive = OD.schema.archive({
      platform: "sillytavern",
      exporter: "sillytavern-chats",
      formatVersion: null,
      exportedAt: null,
      conversations
    });
    archive.source.sourceLabel = "SillyTavern";
    return archive;
  }

  OD.sillyTavern = { parseLines, isChat, isHeader, convertChats, readDate, isGroupChatPath };

  OD.adapters.push({
    id: "sillytavern-chat",
    label: "SillyTavern",
    capabilities: {
      contract: "our-dialogues.adapter-capabilities.v1",
      json: true,
      zip: false,
      folder: true,
      thinking: "preserve",
      attachments: "none",
      sourceMarkup: "mufy-rich-blocks"
    },
    detectJSON(data) {
      return isChat(data);
    },
    parseJSON(data) {
      return convertChats([{ path: null, lines: data }]);
    },
    _internals: { readDate, chatNameDate, convertMessage }
  });
})();
