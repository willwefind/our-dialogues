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
    pageLength: "mid",
    printPreset: null
  });
  /* Print presets are a nullable presentation alias layered above fontFamily.
     Old records without printPreset keep their stored fontFamily untouched;
     choosing a preset renders its composite CJK/Latin family without ever
     rewriting the stored fontFamily value. Typescript is opt-in, never the
     default. Suggested size/line-height apply only at the moment the user
     picks the preset — their later manual adjustments win. */
  const PRINT_PRESETS = Object.freeze({
    anthology: Object.freeze({
      label: "文集",
      family: '"OD Anthology Serif","Huiwen Mincho","IM Fell English","Noto Serif SC","Source Han Serif SC","Songti SC",serif',
      fontSize: 18, lineHeight: 1.9, letterSpacing: "0", headingSize: 30, headingLineHeight: 1.4
    }),
    "old-press": Object.freeze({
      label: "旧刊",
      family: '"OD Anthology Serif","Huiwen Mincho","IM Fell English","Noto Serif SC","Source Han Serif SC","Songti SC",serif',
      fontSize: 17, lineHeight: 1.82, letterSpacing: ".01em", headingSize: 28, headingLineHeight: 1.32
    }),
    typescript: Object.freeze({
      label: "打字稿",
      family: '"OD Typescript","Zhuque Fangsong","Special Elite","FangSong","STFangsong","Noto Serif SC",serif',
      fontSize: 18, lineHeight: 1.92, letterSpacing: "0", headingSize: 27, headingLineHeight: 1.42
    }),
    correspondence: Object.freeze({
      label: "书信",
      family: '"OD Correspondence","Zhuque Fangsong","IM Fell English","FangSong","STFangsong","Noto Serif SC",serif',
      fontSize: 18, lineHeight: 2.02, letterSpacing: "0", headingSize: 29, headingLineHeight: 1.45
    })
  });
  /* Bundled faces come first in their stacks so a present font wins and a
     missing file falls straight through to the system fonts behind it. */
  const FONT_FAMILIES = Object.freeze({
    serif: 'ui-serif,"Noto Serif SC","Source Han Serif SC","Songti SC",serif',
    huiwen: '"Huiwen Mincho","Noto Serif SC","Songti SC",serif',
    zhuque: '"Zhuque Fangsong","FangSong","STFangsong",serif',
    kinghwa: '"KingHwa OldSong","Noto Serif SC","Songti SC",serif',
    typewriter: '"Special Elite","Huiwen Mincho","Noto Serif SC",serif',
    fell: '"IM Fell English","Huiwen Mincho","Noto Serif SC",serif',
    song: '"Songti SC","STSong","Noto Serif CJK SC","SimSun",serif',
    kai: '"Kaiti SC","STKaiti","KaiTi",serif',
    fangsong: '"FangSong","STFangsong","仿宋",serif',
    sans: '"PingFang SC","Microsoft YaHei","Noto Sans CJK SC",sans-serif',
    dengxian: '"DengXian","等线","PingFang SC",sans-serif'
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
      pageLength: oneOf(value.pageLength, Object.keys(PAGE_CHARS), DEFAULTS.pageLength),
      printPreset: oneOf(value.printPreset, Object.keys(PRINT_PRESETS), DEFAULTS.printPreset)
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
    PRINT_PRESETS,
    normalizePreferences,
    messageCharacters,
    visibleMessages,
    paginateMessages,
    pageForMessage,
    clampPage
  };
})(window.OD);
