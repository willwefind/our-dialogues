/* Our Dialogues — UI locale core (Phase 1).
   Classic script, no build step, no dependencies. Dictionaries live in
   src/locales/<tag>.js and register themselves on OD.i18nDictionaries;
   lookup is lazy, so the order between this file and the locale files
   never matters — only that all of them load before src/app.js.

   The locale SETTING is one of "auto" | "zh-CN" | "en" and is owned and
   persisted by the app's reader settings. This module only resolves and
   applies it: manual choices win, "auto" follows the browser's primary
   language (zh-* → zh-CN, anything else → en). Archive content is data
   and never passes through here. */
window.OD = window.OD || {};

(function (OD) {
  const SETTINGS = ["auto", "zh-CN", "en"];
  /* zh-CN is the dictionary of record: every key exists there first, and a
     key missing from another locale falls back to it (tests keep the key
     sets identical, so the fallback is a safety net, not a workflow). */
  const DEFAULT_LOCALE = "zh-CN";

  let setting = "auto";
  let resolved = null;
  const listeners = new Set();
  const pluralRules = {};

  function dictionaries() {
    return OD.i18nDictionaries || {};
  }

  function normalizeSetting(value) {
    return SETTINGS.includes(value) ? value : "auto";
  }

  function browserPrimaryLanguage() {
    const nav = typeof navigator === "undefined" ? null : navigator;
    if (nav?.languages?.length) return String(nav.languages[0] || "");
    return String(nav?.language || "");
  }

  function resolveLocale(value) {
    const normalized = normalizeSetting(value);
    if (normalized !== "auto") return normalized;
    return /^zh(-|$)/i.test(browserPrimaryLanguage()) ? "zh-CN" : "en";
  }

  function currentSetting() {
    return setting;
  }

  function currentLocale() {
    if (!resolved) resolved = resolveLocale(setting);
    return resolved;
  }

  function applyHtmlLang() {
    const root = typeof document === "undefined" ? null : document.documentElement;
    if (root) root.lang = currentLocale();
  }

  function setLocale(value) {
    const before = currentLocale();
    setting = normalizeSetting(value);
    resolved = resolveLocale(setting);
    applyHtmlLang();
    if (resolved !== before) {
      for (const listener of [...listeners]) {
        try { listener(resolved); } catch (error) { console.warn("i18n listener failed", error); }
      }
    }
    return resolved;
  }

  function onChange(listener) {
    if (typeof listener !== "function") return () => {};
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  /* Dictionary values are strings, or {one, other, ...} plural objects picked
     by Intl.PluralRules over params.count (zh-CN only ever needs strings). */
  function pickPlural(value, params, locale) {
    if (value === null || typeof value !== "object") return value;
    const count = Number(params?.count);
    let category = "other";
    if (Number.isFinite(count)) {
      try {
        const rules = pluralRules[locale] || (pluralRules[locale] = new Intl.PluralRules(locale));
        category = rules.select(count);
      } catch (_) {}
    }
    return value[category] ?? value.other ?? Object.values(value)[0] ?? "";
  }

  function format(template, params) {
    if (!params) return String(template);
    return String(template).replace(/\{(\w+)\}/g, (match, name) =>
      Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match);
  }

  function t(key, params) {
    const dicts = dictionaries();
    const locale = currentLocale();
    let value = dicts[locale]?.[key];
    if (value === undefined) value = dicts[DEFAULT_LOCALE]?.[key];
    if (value === undefined) return String(key);
    return format(pickPlural(value, params, locale), params);
  }

  /* Static chrome: markup keeps its zh-CN text inline as the no-JS default;
     data-i18n markers re-point it on boot and on locale change. data-i18n
     must sit on a pure-text element (wrap mixed content in a span) because
     it replaces textContent. */
  const STATIC_ATTRIBUTES = [
    ["data-i18n", null],
    ["data-i18n-title", "title"],
    ["data-i18n-aria-label", "aria-label"],
    ["data-i18n-placeholder", "placeholder"],
    ["data-i18n-label", "label"]
  ];

  function applyStatic(root) {
    const scope = root || (typeof document === "undefined" ? null : document);
    if (typeof scope?.querySelectorAll !== "function") return;
    for (const [marker, attribute] of STATIC_ATTRIBUTES) {
      for (const element of scope.querySelectorAll(`[${marker}]`) || []) {
        const key = element.getAttribute?.(marker);
        if (!key) continue;
        const text = t(key);
        if (attribute) element.setAttribute?.(attribute, text);
        else element.textContent = text;
      }
    }
    applyHtmlLang();
  }

  OD.i18n = {
    normalizeSetting,
    resolveLocale,
    currentSetting,
    currentLocale,
    setLocale,
    onChange,
    t,
    applyStatic
  };
})(window.OD);
