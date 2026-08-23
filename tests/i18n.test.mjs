import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadI18n({ navigatorLanguage = "zh-CN", withNavigator = true, withDictionaries = true } = {}) {
  const runtime = {
    console,
    Date,
    Intl,
    document: { documentElement: { lang: "zh-CN" } }
  };
  if (withNavigator) {
    runtime.navigator = {
      language: navigatorLanguage,
      languages: navigatorLanguage ? [navigatorLanguage] : []
    };
  }
  runtime.window = runtime;
  vm.createContext(runtime);
  const files = withDictionaries
    ? ["src/locales/zh-CN.js", "src/locales/en.js", "src/i18n.js"]
    : ["src/i18n.js"];
  for (const file of files) {
    const source = await readFile(path.join(repositoryRoot, ...file.split("/")), "utf8");
    vm.runInContext(source, runtime, { filename: file });
  }
  return runtime;
}

/* ── Dictionary integrity ─────────────────────────────────────────── */

/* The handoff's fixed semantic keys must exist verbatim in both locales. */
const REQUIRED_KEYS = [
  "nav.library", "nav.history", "nav.search",
  "source.label", "source.add", "source.manage",
  "history.recent", "history.bookmarks", "history.highlights",
  "reader.bookmark", "reader.more", "reader.backToTop",
  "settings.title", "settings.done", "settings.theme", "settings.printStyle",
  "settings.typography", "settings.fonts", "settings.display",
  "settings.language", "settings.reset",
  "theme.paper", "theme.readingGreen", "theme.nightInk",
  "preset.anthology", "preset.oldPress", "preset.typescript", "preset.correspondence",
  "search.current", "search.library", "search.placeholder",
  "status.localOnly", "status.libraryReady", "status.saved"
];

function valueTexts(value) {
  if (value === null || value === undefined) return [];
  if (typeof value === "string") return [value];
  if (typeof value === "object") return Object.values(value).map(String);
  return [String(value)];
}

function placeholderNames(value) {
  const names = new Set();
  for (const text of valueTexts(value)) {
    for (const match of text.matchAll(/\{(\w+)\}/g)) names.add(match[1]);
  }
  return [...names].sort();
}

test("locale dictionaries carry identical key sets (zh-CN === en)", async () => {
  const { OD } = await loadI18n();
  const zh = OD.i18nDictionaries["zh-CN"];
  const en = OD.i18nDictionaries.en;
  assert.ok(zh && typeof zh === "object", "zh-CN dictionary registers itself");
  assert.ok(en && typeof en === "object", "en dictionary registers itself");
  assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort(),
    "a key added to one locale must be added to the other");
});

test("the handoff's fixed semantic keys exist in both dictionaries", async () => {
  const { OD } = await loadI18n();
  for (const key of REQUIRED_KEYS) {
    assert.notEqual(OD.i18nDictionaries["zh-CN"][key], undefined, `zh-CN missing ${key}`);
    assert.notEqual(OD.i18nDictionaries.en[key], undefined, `en missing ${key}`);
  }
});

test("translations keep the same interpolation placeholders in both locales", async () => {
  const { OD } = await loadI18n();
  const zh = OD.i18nDictionaries["zh-CN"];
  const en = OD.i18nDictionaries.en;
  for (const key of Object.keys(zh)) {
    assert.deepEqual(placeholderNames(en[key]), placeholderNames(zh[key]),
      `placeholder mismatch for ${key}`);
  }
});

test("dictionary values are strings or plural objects with an \"other\" branch", async () => {
  const { OD } = await loadI18n();
  for (const [tag, table] of Object.entries(OD.i18nDictionaries)) {
    for (const [key, value] of Object.entries(table)) {
      if (typeof value === "string") continue;
      assert.ok(value && typeof value === "object" && typeof value.other === "string",
        `${tag}:${key} must be a string or a plural object with "other"`);
    }
  }
});

/* ── Locale resolution ────────────────────────────────────────────── */

test("manual locales win; auto follows the browser primary language", async () => {
  const zhBrowser = (await loadI18n({ navigatorLanguage: "zh-CN" })).OD.i18n;
  assert.equal(zhBrowser.resolveLocale("zh-CN"), "zh-CN");
  assert.equal(zhBrowser.resolveLocale("en"), "en");
  assert.equal(zhBrowser.resolveLocale("auto"), "zh-CN");

  assert.equal((await loadI18n({ navigatorLanguage: "zh-TW" })).OD.i18n.resolveLocale("auto"), "zh-CN",
    "any zh-* browser resolves auto to zh-CN");
  assert.equal((await loadI18n({ navigatorLanguage: "zh" })).OD.i18n.resolveLocale("auto"), "zh-CN");
  assert.equal((await loadI18n({ navigatorLanguage: "en-US" })).OD.i18n.resolveLocale("auto"), "en");
  assert.equal((await loadI18n({ navigatorLanguage: "ja-JP" })).OD.i18n.resolveLocale("auto"), "en",
    "auto falls back to en for non-Chinese browsers");
  assert.equal((await loadI18n({ withNavigator: false })).OD.i18n.resolveLocale("auto"), "en",
    "no navigator at all still resolves");
});

test("unknown stored settings normalize to auto", async () => {
  const { OD } = await loadI18n();
  assert.equal(OD.i18n.normalizeSetting("zh-CN"), "zh-CN");
  assert.equal(OD.i18n.normalizeSetting("en"), "en");
  assert.equal(OD.i18n.normalizeSetting("auto"), "auto");
  assert.equal(OD.i18n.normalizeSetting("fr"), "auto");
  assert.equal(OD.i18n.normalizeSetting(undefined), "auto");
  assert.equal(OD.i18n.normalizeSetting(null), "auto");
  assert.equal(OD.i18n.normalizeSetting(42), "auto");
  assert.equal(OD.i18n.resolveLocale("legacy-junk"), OD.i18n.resolveLocale("auto"));
});

test("setLocale resolves, records the setting, and stamps <html lang> immediately", async () => {
  const runtime = await loadI18n({ navigatorLanguage: "zh-CN" });
  const i18n = runtime.OD.i18n;
  assert.equal(i18n.setLocale("en"), "en");
  assert.equal(i18n.currentSetting(), "en");
  assert.equal(i18n.currentLocale(), "en");
  assert.equal(runtime.document.documentElement.lang, "en");
  assert.equal(i18n.setLocale("auto"), "zh-CN");
  assert.equal(i18n.currentSetting(), "auto");
  assert.equal(runtime.document.documentElement.lang, "zh-CN");
});

test("onChange fires only when the resolved locale actually changes", async () => {
  const { OD } = await loadI18n({ navigatorLanguage: "zh-CN" });
  const seen = [];
  OD.i18n.onChange(locale => seen.push(locale));
  OD.i18n.setLocale("zh-CN");   // auto already resolved to zh-CN
  assert.deepEqual(seen, []);
  OD.i18n.setLocale("en");
  OD.i18n.setLocale("auto");    // back to zh-CN via the browser
  assert.deepEqual(seen, ["en", "zh-CN"]);
});

/* ── Lookup behavior ──────────────────────────────────────────────── */

test("t() translates per locale, interpolates params, and never throws on gaps", async () => {
  const runtime = await loadI18n({ withDictionaries: false });
  runtime.OD.i18nDictionaries = {
    "zh-CN": { "x.plain": "你好", "x.count": "共 {count} 段", "x.zhOnly": "只有中文" },
    en: { "x.plain": "Hello", "x.count": { one: "{count} item", other: "{count} items" } }
  };
  const i18n = runtime.OD.i18n;

  assert.equal(i18n.t("x.plain"), "你好");
  assert.equal(i18n.t("x.count", { count: 3 }), "共 3 段");

  i18n.setLocale("en");
  assert.equal(i18n.t("x.plain"), "Hello");
  assert.equal(i18n.t("x.count", { count: 1 }), "1 item", "Intl.PluralRules picks the one branch");
  assert.equal(i18n.t("x.count", { count: 3 }), "3 items");
  assert.equal(i18n.t("x.zhOnly"), "只有中文", "missing en entries fall back to zh-CN");
  assert.equal(i18n.t("x.missing"), "x.missing", "unknown keys return the key itself");
  assert.equal(i18n.t("x.count"), "{count} items", "missing params leave the placeholder visible");
});

/* ── Static application ───────────────────────────────────────────── */

function fakeElement(attributes) {
  return {
    attributes: { ...attributes },
    textContent: "原文",
    getAttribute(name) { return this.attributes[name] ?? null; },
    setAttribute(name, value) { this.attributes[name] = String(value); }
  };
}

test("applyStatic rewrites text and title/aria-label/placeholder attributes", async () => {
  const runtime = await loadI18n({ withDictionaries: false });
  runtime.OD.i18nDictionaries = {
    "zh-CN": { "s.text": "书库", "s.title": "全文搜索", "s.aria": "存书签", "s.placeholder": "搜关键词", "s.label": "内置字体" },
    en: { "s.text": "Library", "s.title": "Search everything", "s.aria": "Add bookmark", "s.placeholder": "Search", "s.label": "Bundled fonts" }
  };
  const elements = {
    text: fakeElement({ "data-i18n": "s.text" }),
    title: fakeElement({ "data-i18n-title": "s.title" }),
    aria: fakeElement({ "data-i18n-aria-label": "s.aria" }),
    placeholder: fakeElement({ "data-i18n-placeholder": "s.placeholder" }),
    label: fakeElement({ "data-i18n-label": "s.label" })
  };
  const root = {
    querySelectorAll(selector) {
      const marker = selector.slice(1, -1);
      return Object.values(elements).filter(element => element.getAttribute(marker) !== null);
    }
  };
  const i18n = runtime.OD.i18n;

  i18n.setLocale("en");
  i18n.applyStatic(root);
  assert.equal(elements.text.textContent, "Library");
  assert.equal(elements.title.attributes.title, "Search everything");
  assert.equal(elements.aria.attributes["aria-label"], "Add bookmark");
  assert.equal(elements.placeholder.attributes.placeholder, "Search");
  assert.equal(elements.label.attributes.label, "Bundled fonts");
  assert.equal(runtime.document.documentElement.lang, "en");

  i18n.setLocale("zh-CN");
  i18n.applyStatic(root);
  assert.equal(elements.text.textContent, "书库");
  assert.equal(elements.title.attributes.title, "全文搜索");
  assert.equal(runtime.document.documentElement.lang, "zh-CN");
});
