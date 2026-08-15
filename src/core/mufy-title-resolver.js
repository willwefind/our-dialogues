window.OD = window.OD || {};

(function(OD){
  const TITLE_SOURCES = Object.freeze([
    "remark", "exported", "current", "assistant-first-line", "dialogue-derived", "fallback"
  ]);
  const ASSISTANT_ROLES = new Set(["assistant", "ai", "bot", "model", "character"]);
  const USER_ROLES = new Set(["user", "human", "me"]);

  function decodeEntities(value) {
    const named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
    return String(value ?? "").replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
      const lower = entity.toLowerCase();
      if (lower[0] === "#") {
        const code = lower[1] === "x" ? parseInt(lower.slice(2), 16) : parseInt(lower.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : match;
      }
      return named[lower] ?? match;
    });
  }

  function plainText(value) {
    return decodeEntities(String(value ?? "")
      .replace(/<\s*(?:script|style|think)\b[^>]*>[\s\S]*?<\s*\/\s*(?:script|style|think)\s*>/gi, " ")
      .replace(/<[^>]*>/g, " "))
      .replace(/\s+/g, " ")
      .trim();
  }

  function safeCut(value, maximum = 80) {
    const text = plainText(value);
    const points = typeof Intl?.Segmenter === "function"
      ? [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)].map(item => item.segment)
      : Array.from(text);
    if (points.length <= maximum) return text;
    const candidate = points.slice(0, maximum - 1).join("");
    const sentence = candidate.match(/^([\s\S]{12,}?[。！？!?；;](?:[”’"']?))(?=\s|$|.)/);
    if (sentence && Array.from(sentence[1]).length >= 12) return sentence[1].trim();
    const boundary = Math.max(candidate.lastIndexOf("，"), candidate.lastIndexOf(","), candidate.lastIndexOf(" "));
    const cut = boundary >= Math.floor(maximum * 0.55) ? candidate.slice(0, boundary) : candidate;
    return `${cut.trimEnd()}…`;
  }

  function sourceTime(value) {
    return value?.createdTime ?? value?.createdAt ?? value?.timestamp ?? value?.updatedTime ?? value?.updatedAt ?? null;
  }

  function archiveRemark(session) {
    const archives = (Array.isArray(session?.archives) ? session.archives : [])
      .filter(item => item && typeof item === "object" && plainText(item.remark));
    const marked = archives.find(item => item.isCurrent === true || item.current === true || item.selected === true);
    if (marked) return safeCut(marked.remark);
    return archives
      .map((item, index) => ({ item, index, time: Date.parse(sourceTime(item) || "") }))
      .sort((a, b) => {
        const at = Number.isFinite(a.time) ? a.time : -Infinity;
        const bt = Number.isFinite(b.time) ? b.time : -Infinity;
        return bt - at || b.index - a.index;
      })
      .map(entry => safeCut(entry.item.remark))
      .find(Boolean) || "";
  }

  function explicitTitle(session) {
    for (const value of [session?.title, session?.name, session?.sessionTitle, session?.displayName]) {
      const title = safeCut(value);
      if (title) return title;
    }
    return "";
  }

  function scaffoldLine(value) {
    const text = plainText(value).replace(/^[\s#>*_`\-–—|:：]+|[\s#>*_`\-–—|]+$/g, "").trim();
    if (!text) return true;
    if (/^(?:tool|function|ui|system|api|status|progress|loading|source\s*trace|thinking|reasoning)(?:\s*(?:call|result|message|marker|status))?\s*[:：]?$/i.test(text)) return true;
    if (/^(?:时间|日期|地点|场景|人物|角色|状态|好感度|进度|任务|天气|服装|心情|情绪|当前时间|当前地点|TIME|DATE|LOCATION|CHARACTERS?|STATUS|PROGRESS|MOOD)\s*[:：]\s*\S.{0,72}$/i.test(text)) return true;
    if (/^(?:\[?(?:system|tool|function|ui|status|progress|thinking|sourceTrace)\]?|<\/?think>)$/i.test(text)) return true;
    if (/^(?:[-=*_#·•~]{3,}|\d{1,3}%|(?:loading|处理中|生成中)\.{0,3})$/i.test(text)) return true;
    return false;
  }

  function narrativeText(message) {
    if (!message || message.metadata?.reasoningOnly || ["tool", "system"].includes(message.role)) return "";
    const lines = (Array.isArray(message.content) ? message.content : [])
      .filter(item => item?.type === "text")
      .flatMap(item => String(item.text || "").split(/\r?\n/))
      .map(plainText)
      .filter(line => line && !scaffoldLine(line));
    return safeCut(lines[0] || "");
  }

  function roleOf(message) {
    return String(message?.metadata?.originalRole ?? message?.role ?? "").toLowerCase();
  }

  function resolve({ pack = {}, session = {}, index = 0, messages = [] } = {}) {
    const remark = archiveRemark(session);
    if (remark) return { title: remark, titleSource: "remark" };
    const exported = explicitTitle(session);
    if (exported) return { title: exported, titleSource: "exported" };
    const characterName = safeCut(pack?.name, 42) || "Mufy";
    if (session?.isCurrent === true || session?.current === true) {
      return { title: `${characterName} · 当前对话`, titleSource: "current" };
    }
    const assistant = messages.find(message => ASSISTANT_ROLES.has(roleOf(message)) && narrativeText(message));
    const assistantLine = narrativeText(assistant);
    if (Array.from(assistantLine).length >= 8) {
      return { title: assistantLine, titleSource: "assistant-first-line" };
    }
    const user = messages.find(message => USER_ROLES.has(roleOf(message)) && narrativeText(message));
    const userLine = narrativeText(user);
    if (userLine && assistantLine) {
      return { title: safeCut(`${userLine} / ${assistantLine}`), titleSource: "dialogue-derived" };
    }
    if (assistantLine) return { title: assistantLine, titleSource: "assistant-first-line" };
    if (userLine) {
      return { title: safeCut(userLine), titleSource: "dialogue-derived" };
    }

    const time = sourceTime(session) || messages.find(message => message?.createdAt)?.createdAt || null;
    const date = new Date(time || "");
    const prefix = Number.isNaN(date.getTime()) ? "" : `${date.toISOString().slice(0, 10)} · `;
    return { title: `${prefix}第 ${index + 1} 段`, titleSource: "fallback" };
  }

  function disambiguate(conversations) {
    const labels = new Map();
    const groups = new Map();
    for (const conversation of (conversations || [])) {
      const character = String(conversation?.context?.sourceMetadata?.characterId ?? conversation?.context?.sourceMetadata?.characterName ?? "");
      const key = `${character}\u0000${String(conversation?.title || "")}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(conversation);
    }
    for (const group of groups.values()) {
      if (group.length === 1) {
        labels.set(String(group[0].id), String(group[0].title || ""));
        continue;
      }
      const used = new Map();
      for (const conversation of group) {
        const parsed = new Date(conversation.createdAt || "");
        const suffix = Number.isNaN(parsed.getTime()) ? "" : ` · ${parsed.toISOString().slice(0, 10)}`;
        const base = `${conversation.title}${suffix}`;
        const count = (used.get(base) || 0) + 1;
        used.set(base, count);
        labels.set(String(conversation.id), count === 1 && suffix ? base : `${base}（${count}）`);
      }
    }
    return labels;
  }

  OD.mufyTitleResolver = {
    TITLE_SOURCES,
    resolve,
    disambiguate,
    _internals: { decodeEntities, plainText, safeCut, scaffoldLine, narrativeText, archiveRemark, explicitTitle }
  };
})(window.OD);
