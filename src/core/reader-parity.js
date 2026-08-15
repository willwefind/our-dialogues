window.OD = window.OD || {};

(function(OD){
  const PAGE_CHARS = Object.freeze({ short: 2500, mid: 5000, long: 9000 });
  const DEFAULTS = Object.freeze({
    fontSize: 18,
    lineHeight: 1.95,
    contentWidth: 800,
    fontFamily: "serif",
    theme: "paper",
    readingMode: "scroll",
    pageLength: "mid"
  });
  const FONT_FAMILIES = Object.freeze({
    serif: 'ui-serif,"Noto Serif SC","Source Han Serif SC","Songti SC",serif',
    song: '"Songti SC","STSong","Noto Serif CJK SC","SimSun",serif',
    kai: '"Kaiti SC","STKaiti","KaiTi",serif',
    sans: '"PingFang SC","Microsoft YaHei","Noto Sans CJK SC",sans-serif'
  });

  function oneOf(value, allowed, fallback) {
    return allowed.includes(value) ? value : fallback;
  }

  function boundedNumber(value, fallback, minimum, maximum) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback;
  }

  function normalizePreferences(value = {}) {
    return {
      fontSize: Math.round(boundedNumber(value.fontSize, DEFAULTS.fontSize, 14, 30)),
      lineHeight: boundedNumber(value.lineHeight, DEFAULTS.lineHeight, 1.5, 2.5),
      contentWidth: Math.round(boundedNumber(value.contentWidth, DEFAULTS.contentWidth, 560, 1040)),
      fontFamily: oneOf(value.fontFamily, Object.keys(FONT_FAMILIES), DEFAULTS.fontFamily),
      theme: oneOf(value.theme, ["paper", "night", "mist"], DEFAULTS.theme),
      readingMode: oneOf(value.readingMode, ["scroll", "page"], DEFAULTS.readingMode),
      pageLength: oneOf(value.pageLength, Object.keys(PAGE_CHARS), DEFAULTS.pageLength)
    };
  }

  function messageCharacters(message) {
    const items = Array.isArray(message?.content)
      ? message.content
      : [{ type: "text", text: message?.content ?? "" }];
    return items.reduce((total, item) => {
      if (!item || typeof item !== "object") return total;
      return total + Array.from(String(item.text || "")).length;
    }, 0);
  }

  function visibleMessages(messages, { hideUser = false } = {}) {
    return (Array.isArray(messages) ? messages : []).filter(message => {
      if (hideUser && message?.role === "user") return false;
      return true;
    });
  }

  function paginateMessages(messages, { mode = DEFAULTS.readingMode, pageLength = DEFAULTS.pageLength, hideUser = false } = {}) {
    const items = visibleMessages(messages, { hideUser });
    if (mode !== "page") return [items];
    const limit = PAGE_CHARS[pageLength] || PAGE_CHARS.mid;
    const pages = [];
    let page = [];
    let characters = 0;
    for (const message of items) {
      page.push(message);
      characters += Math.max(1, messageCharacters(message));
      if (characters >= limit) {
        pages.push(page);
        page = [];
        characters = 0;
      }
    }
    if (page.length) pages.push(page);
    return pages.length ? pages : [[]];
  }

  function pageForMessage(pages, messageId) {
    if (!messageId) return -1;
    return (pages || []).findIndex(page => page.some(message => String(message?.id) === String(messageId)));
  }

  function clampPage(value, pages) {
    const last = Math.max(0, (pages?.length || 1) - 1);
    const number = Number(value);
    return Math.max(0, Math.min(Number.isFinite(number) ? Math.round(number) : 0, last));
  }

  OD.readerParity = {
    PAGE_CHARS,
    DEFAULTS,
    FONT_FAMILIES,
    normalizePreferences,
    messageCharacters,
    visibleMessages,
    paginateMessages,
    pageForMessage,
    clampPage
  };
})(window.OD);
