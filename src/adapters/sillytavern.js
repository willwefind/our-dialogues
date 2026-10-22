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

  /* ── Display regex: the cards' own prettifying rules ──────────────────
     SillyTavern rewrites a message for display with the regex scripts
     that are switched on — global, then the active preset's, then the
     character card's — when the script is marked "markdown only" (display
     only). This mirrors its engine (public/scripts/extensions/regex/
     engine.js): the same order, placements, depth window, `{{match}}` and
     `$n` / `$<name>` groups, trim strings, and macro substitution in the
     find pattern. It is pure text substitution; no card script is run.
     Scripts that are neither display- nor prompt-only already changed the
     stored message when it was written, so they are not applied again. */
  const PLACEMENT = { USER_INPUT: 1, AI_OUTPUT: 2, SLASH_COMMAND: 3, REASONING: 6 };

  /* SillyTavern's regexFromString, unchanged in behavior. */
  function regexFromString(input) {
    try {
      const match = String(input).match(/(\/?)(.+)\1([a-z]*)/i);
      if (match[3] && !/^(?!.*?(.).*?\1)[gmixXsuUAJ]+$/.test(match[3])) return new RegExp(input);
      return new RegExp(match[2], match[3]);
    } catch (_) {
      return null;
    }
  }

  function macroValue(name, ctx) {
    const key = name.trim().toLowerCase();
    if (key === "user") return ctx.user;
    if (key === "char" || key === "charifnotgroup") return ctx.char;
    if (key === "group") return ctx.char;
    return null;
  }

  /* {{user}} / {{char}} and the legacy <USER> / <BOT> / <CHAR>. Any other
     macro names a value only a live SillyTavern has (variables, time,
     random rolls); inside a rule's output it is dropped rather than shown as
     braces, since the reader cannot know what it said. */
  function substituteMacros(value, ctx, { dropUnknown = false, escape = null } = {}) {
    const wrap = text => escape ? escape(text) : text;
    return String(value ?? "")
      .replace(/<(USER|BOT|CHAR)>/g, (whole, name) => wrap(name === "USER" ? ctx.user : ctx.char))
      .replace(/\{\{([^{}]*)\}\}/g, (whole, name) => {
        const known = macroValue(name, ctx);
        if (known != null) return wrap(known);
        return dropUnknown ? "" : whole;
      });
  }

  function sanitizeRegexMacro(value) {
    return String(value ?? "").replace(/[\n\r\t\v\f\0.^$*+?{}[\]\\/|()]/gs, character => ({
      "\n": "\\n", "\r": "\\r", "\t": "\\t", "\v": "\\v", "\f": "\\f", "\0": "\\0"
    }[character] || `\\${character}`));
  }

  function findRegexOf(script, ctx) {
    const mode = Number(script.substituteRegex);
    const pattern = mode === 1
      ? substituteMacros(script.findRegex, ctx)
      : mode === 2
        ? substituteMacros(script.findRegex, ctx, { escape: sanitizeRegexMacro })
        : script.findRegex;
    return regexFromString(pattern);
  }

  function replacementFor(script, match, ctx) {
    const template = String(script.replaceString ?? "").replace(/{{match}}/gi, "$0");
    const withGroups = template.replace(/\$(\d+)|\$<([^>]+)>/g, (_, number, name) => {
      const value = number ? match[Number(number)] : match.groups?.[name];
      if (!value) return "";
      let trimmed = value;
      for (const trim of Array.isArray(script.trimStrings) ? script.trimStrings : []) {
        const cut = substituteMacros(trim, ctx);
        if (cut) trimmed = trimmed.split(cut).join("");
      }
      return trimmed;
    });
    return substituteMacros(withGroups, ctx, { dropUnknown: true });
  }

  /* A rule whose output carries a <script> draws a page that only
     JavaScript fills in — 酒馆助手 front-end cards that wrap the whole
     message and read it back by script. Without that script the page is an
     empty shell and the message would vanish, so such a rule is not run and
     the text reads as it was stored. */
  function needsScript(script) {
    return /<script\b/i.test(String(script?.replaceString ?? ""));
  }

  function scriptApplies(script, ctx) {
    if (!script || script.disabled || !script.findRegex || !script.markdownOnly || needsScript(script)) return false;
    if (!(Array.isArray(script.placement) ? script.placement : []).includes(ctx.placement)) return false;
    if (typeof ctx.depth === "number") {
      const min = script.minDepth;
      const max = script.maxDepth;
      if (min !== null && min !== undefined && min !== "" && !Number.isNaN(Number(min)) && Number(min) >= -1 && ctx.depth < Number(min)) return false;
      if (max !== null && max !== undefined && max !== "" && !Number.isNaN(Number(max)) && Number(max) >= 0 && ctx.depth > Number(max)) return false;
    }
    return true;
  }

  /* Runs the scripts and remembers where each rule's output landed, so a
     status panel a rule draws can be folded away while inline touches stay
     in the prose. A later rule that rewrites an earlier rule's output takes
     that region over. */
  function applyDisplayRegex(text, scripts, ctx) {
    let current = String(text ?? "");
    let regions = [];
    const applied = [];
    for (const script of scripts || []) {
      if (!current || !scriptApplies(script, ctx)) continue;
      const find = findRegexOf(script, ctx);
      if (!find) continue;
      const matches = [];
      if (find.global) {
        find.lastIndex = 0;
        for (const match of current.matchAll(find)) matches.push(match);
      } else {
        find.lastIndex = 0;
        const match = find.exec(current);
        if (match) matches.push(match);
      }
      if (!matches.length) continue;
      let output = "";
      let cursor = 0;
      const edits = [];
      for (const match of matches) {
        const start = match.index;
        const end = start + match[0].length;
        if (start < cursor) continue;
        output += current.slice(cursor, start);
        const replacement = replacementFor(script, match, ctx);
        edits.push({ start, end, at: output.length, length: replacement.length, source: match[0] });
        output += replacement;
        cursor = end;
      }
      output += current.slice(cursor);
      // Earlier outputs survive this pass, shifted: an edit wholly inside one
      // only stretches it (a rule touching up a panel keeps it a panel); an
      // edit that crosses one, or replaces all of it, takes it over.
      const shiftAt = position => edits.reduce((shift, edit) => edit.end <= position ? shift + edit.length - (edit.end - edit.start) : shift, 0);
      const strictlyInside = (edit, region) => edit.start >= region.start && edit.end <= region.end && !(edit.start === region.start && edit.end === region.end);
      const next = [];
      const kept = [];
      for (const region of regions) {
        const overlapping = edits.filter(edit => edit.start < region.end && edit.end > region.start);
        if (overlapping.some(edit => !strictlyInside(edit, region))) continue;
        kept.push(region);
        next.push({ ...region, start: region.start + shiftAt(region.start), end: region.end + shiftAt(region.end) });
      }
      for (const edit of edits) {
        // An empty output hides text (as in SillyTavern) and leaves no region.
        if (!edit.length || kept.some(region => strictlyInside(edit, region))) continue;
        next.push({ start: edit.at, end: edit.at + edit.length, scriptName: String(script.scriptName || ""), sourceLength: edit.end - edit.start, source: edit.source });
      }
      current = output;
      regions = next.sort((a, b) => a.start - b.start);
      applied.push(String(script.scriptName || ""));
    }
    return { text: current, regions, applied };
  }

  /* ── Folding: status panels into a closed box ── */
  const BLOCKISH = /<(?:div|table|details|section|article|aside|header|footer|ul|ol|dl|style|hr|h[1-6]|iframe|html|body|center|fieldset)\b/i;

  function unfence(value) {
    return value.replace(/```[a-z]*\s*\n?([\s\S]*?)```/gi, "$1");
  }

  function foldBlock(title, body, variant) {
    const text = String(body || "").replace(/\n{3,}/g, "\n\n").trim();
    if (!text) return null;
    return {
      type: "source-rich-block",
      source: "mufy",
      kind: "details",
      variant,
      title: String(title || "").trim() || "状态栏",
      body: text,
      text
    };
  }

  function cleanScriptName(name) {
    return String(name || "").replace(/^[\s\-_#|·.]+|[\s\-_#|·.]+$/g, "").slice(0, 40);
  }

  /* A raw status block the card's rules never reached: a `<-NAME->` marker
     line and/or runs of `|…|…|` rows. Two such lines (blank lines between
     them allowed) make a block; the marker names it. */
  const MARKER_LINE = /^\s*<-\s*([^<>\n]{1,40}?)\s*->\s*$/;
  function isPipeRow(line) {
    const trimmed = line.trim();
    return (/^\|.*\|$/.test(trimmed) && trimmed.length > 2) || (trimmed.split("|").length - 1 >= 3);
  }

  function foldStatusRuns(text) {
    const lines = String(text).split("\n");
    const items = [];
    let prose = [];
    const flushProse = () => {
      const value = prose.join("\n").replace(/^\n+|\n+$/g, "");
      if (value.trim()) items.push({ type: "text", text: value });
      prose = [];
    };
    for (let index = 0; index < lines.length;) {
      const statusish = line => MARKER_LINE.test(line) || isPipeRow(line);
      if (!statusish(lines[index])) { prose.push(lines[index]); index += 1; continue; }
      let end = index;
      let count = 0;
      let last = index;
      while (end < lines.length && (statusish(lines[end]) || !lines[end].trim())) {
        if (statusish(lines[end])) { count += 1; last = end; }
        end += 1;
      }
      if (count < 2) { prose.push(lines[index]); index += 1; continue; }
      const run = lines.slice(index, last + 1);
      const marker = run.map(line => MARKER_LINE.exec(line)).find(Boolean);
      const body = run.filter(line => !MARKER_LINE.test(line)).join("\n");
      const block = foldBlock(marker ? marker[1] : "状态栏", body || run.join("\n"), "st-status");
      if (block) { flushProse(); items.push(block); }
      index = last + 1;
    }
    flushProse();
    return items;
  }

  function foldStatusInContent(content) {
    const out = [];
    for (const item of content) {
      const lines = item?.type === "text" && typeof item.text === "string" ? item.text.split("\n") : null;
      if (lines && lines.some(line => MARKER_LINE.test(line) || isPipeRow(line))) {
        out.push(...foldStatusRuns(item.text));
      } else {
        out.push(item);
      }
    }
    return out;
  }

  /* One rule firing many times in a row — a phone screen that draws every
     text message as its own bubble — reads as one box holding all of them,
     not a stack of identical boxes. */
  function mergeRuns(content) {
    const merged = [];
    for (const item of content) {
      const previous = merged[merged.length - 1];
      if (item?.variant === "st-regex" && previous?.variant === "st-regex" && previous.baseTitle === item.title) {
        previous.count += 1;
        previous.body = `${previous.body}\n${item.body}`;
        previous.text = previous.body;
        previous.title = `${previous.baseTitle} · ${previous.count}`;
        continue;
      }
      merged.push(item?.variant === "st-regex" ? { ...item, baseTitle: item.title, count: 1 } : item);
    }
    return merged.map(item => {
      if (item?.variant !== "st-regex") return item;
      const { baseTitle, count, ...rest } = item;
      return rest;
    });
  }

  /* The message as SillyTavern would show it, read into Reader content:
     prose and inline rule output flow together; a rule output that is a
     block decoration and not the body itself folds into a box named after
     the rule. */
  function displayContent(mes, read, scripts, ctx) {
    const { text, regions, applied } = applyDisplayRegex(mes, scripts, ctx);
    const content = [];
    const thinking = [];
    let buffer = "";
    const flush = () => {
      if (!buffer) return;
      const normalized = messageText(buffer, read);
      content.push(...normalized.content);
      thinking.push(...normalized.thinking);
      buffer = "";
    };
    let cursor = 0;
    let folded = 0;
    for (const region of [...regions].sort((a, b) => a.start - b.start)) {
      if (region.start < cursor) continue;
      buffer += text.slice(cursor, region.start);
      const output = text.slice(region.start, region.end);
      cursor = region.end;
      const decorative = (BLOCKISH.test(output) || /```/.test(output)) && region.sourceLength < 0.6 * mes.length;
      if (!decorative) { buffer += output; continue; }
      const inner = read ? read(protectLiteralAngles(unfence(output))) : { text: unfence(output), thinking: [] };
      // A panel that only a script could draw (an HTML shell filled in by
      // JavaScript) reads as nothing here; the data the rule was given is
      // folded instead, so it stays one click away rather than vanishing.
      const shown = inner.text.trim()
        ? inner.text
        : (read ? read(protectLiteralAngles(unfence(region.source || ""))).text : region.source);
      const block = foldBlock(cleanScriptName(substituteMacros(region.scriptName, ctx, { dropUnknown: true })), shown, "st-regex");
      if (block) { flush(); content.push(block); folded += 1; }
    }
    buffer += text.slice(cursor);
    flush();
    const withStatus = foldStatusInContent(mergeRuns(content));
    folded += withStatus.filter(item => item.variant === "st-status").length;
    // A message that is nothing but a panel (a phone screen, say) shows it
    // open: folding it would leave the message looking empty.
    const hasProse = withStatus.some(item => item.type === "text" && item.text.trim());
    const opened = hasProse ? withStatus : withStatus.map(item => item.variant === "st-regex" || item.variant === "st-status" ? { ...item, kind: "status-card" } : item);
    const finalContent = opened.length ? opened : (mes.trim() ? [{ type: "text", text: mes }] : []);
    return {
      content: finalContent,
      text: finalContent.map(item => item.text || "").filter(Boolean).join("\n").trim(),
      thinking,
      applied,
      folded
    };
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

  /* ctx: { scripts, user, depth } — the display rules that apply to this
     chat, the user's name for {{user}}, and the message's depth from the end
     of the chat (undefined for hidden messages, as in SillyTavern). */
  function convertMessage(line, index, read, ctx = {}) {
    const extra = line.extra && typeof line.extra === "object" ? line.extra : {};
    const mes = String(line.mes ?? "");
    const placement = line.is_user ? PLACEMENT.USER_INPUT : extra.type === "narrator" ? PLACEMENT.SLASH_COMMAND : PLACEMENT.AI_OUTPUT;
    const ruleContext = { user: ctx.user || "User", char: String(line.name || ""), depth: ctx.depth };
    const normalized = displayContent(mes, read, ctx.scripts, { ...ruleContext, placement });
    const thinking = [];
    if (typeof extra.reasoning === "string" && extra.reasoning.trim()) {
      const reasoning = applyDisplayRegex(extra.reasoning, ctx.scripts, { ...ruleContext, placement: PLACEMENT.REASONING });
      const shown = reasoning.applied.length && read ? read(protectLiteralAngles(unfence(reasoning.text))).text : extra.reasoning;
      thinking.push(shown || extra.reasoning);
    }
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
    if (normalized.applied.length) metadata.displayRules = [...new Set(normalized.applied)];
    if (normalized.folded) metadata.foldedBlocks = normalized.folded;
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
    rules:  { shared: [script, …], byCharacter: { folder: [script, …] } } —
            global and active-preset display rules, and each allowed card's
            own, keyed by the card's file name (= its chat folder).
  */
  function convertChats(chats, { groups = [], rules = null } = {}) {
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
      // The same "unused" placeholder can stand in for the user's name.
      const userName = (header.user_name && header.user_name !== "unused" ? header.user_name : null) ||
        messages.find(line => line.is_user && line.name)?.name || "User";
      const characterName = group ? group.name : (headerName || firstSpeaker || folder || "Character");
      const characterId = group ? `group:${group.id}` : (folder || characterName);
      const named = stem ? chatNameDate(stem) : null;
      // Group chats run no card rules: SillyTavern has no single character then.
      const scripts = [...(rules?.shared || []), ...(!group && folder ? (rules?.byCharacter?.[folder] || []) : [])];
      const visible = messages.filter(line => !(line.is_system === true || line.is_system === "true"));
      const converted = messages.map((line, index) => {
        const position = visible.indexOf(line);
        const depth = position === -1 ? undefined : visible.length - position - 1;
        return convertMessage(line, index + 1, read, { scripts, user: userName, depth });
      });
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
            userName,
            titleSource: named ? "chat-name-date" : stem ? "chat-name" : "fallback",
            path: chat.path || null
          }
        },
        metadata: { titleSource: named ? "chat-name-date" : stem ? "chat-name" : "fallback" },
        participants: [{ id: "user", name: userName, role: "user" }, ...speakers.values()],
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

  OD.sillyTavern = { parseLines, isChat, isHeader, convertChats, readDate, isGroupChatPath, applyDisplayRegex, foldStatusRuns, regexFromString };

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
