import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// vm 跨 realm 的对象过不了 deepStrictEqual（原型不同）——JSON 往返一遍再比
const plain = value => JSON.parse(JSON.stringify(value));

async function loadShijuEmbed(extra = {}) {
  const created = [];
  const runtime = {
    console,
    Date,
    document: {
      createElement(tag) {
        const el = { tagName: tag, src: "", onload: null, onerror: null };
        created.push(el);
        return el;
      },
      head: { appendChild() {} },
      documentElement: { children: [] },
    },
    ...extra,
  };
  runtime.window = runtime;
  vm.createContext(runtime);
  const source = await readFile(path.join(repositoryRoot, "src", "core", "shiju-embed.js"), "utf8");
  vm.runInContext(source, runtime, { filename: "src/core/shiju-embed.js" });
  return { studio: runtime.OD.shijuStudio, runtime, created };
}

const chatgptSource = { id: "src-internal-1", label: "Sol 的对话", source: { platform: "chatgpt" } };
const claudeSource = { id: "src-internal-2", label: "Ciel 的对话", source: { platform: "claude" } };
const mufySource = { id: "src-internal-3", label: "Mufy 存档", source: { platform: "mufy" } };
const paSource = { id: "src-internal-4", label: "半夏的字纸箱", source: { platform: "personal-archive" } };

test("载荷映射：assistant 带平台尾巴，user 裸名，文档走作者", async () => {
  const { studio } = await loadShijuEmbed();
  assert.equal(
    studio.sourceLine({ conversation: {}, message: { role: "assistant", speaker: "Sol" }, source: chatgptSource }),
    "Sol · ChatGPT");
  assert.equal(
    studio.sourceLine({ conversation: {}, message: { role: "assistant", speaker: "Ciel" }, source: claudeSource }),
    "Ciel · Claude");
  assert.equal(
    studio.sourceLine({ conversation: {}, message: { role: "assistant", speaker: "长夜" }, source: mufySource }),
    "长夜 · Mufy");
  assert.equal(
    studio.sourceLine({ conversation: {}, message: { role: "user", speaker: "Dawn" }, source: chatgptSource }),
    "Dawn");
  assert.equal(
    studio.sourceLine({
      conversation: { contentKind: "personal-document" },
      message: { role: "other", speaker: "半夏" },
      source: paSource,
    }),
    "半夏");
  // 说话人本身就是平台名 → 不加尾巴（避免「ChatGPT · ChatGPT」）
  assert.equal(
    studio.sourceLine({ conversation: {}, message: { role: "assistant", speaker: "ChatGPT" }, source: chatgptSource }),
    "ChatGPT");
  // 拿不到说话人 → 来源标签兜底；内部 id 永不上纸面
  const fallback = studio.sourceLine({ conversation: {}, message: { role: "assistant" }, source: claudeSource });
  assert.equal(fallback, "Ciel 的对话");
  assert.ok(!fallback.includes("src-internal"), "内部 id 泄漏到来源行");
});

test("载荷整体：text/title/source/date 上纸，context 留阅读器侧", async () => {
  const { studio } = await loadShijuEmbed();
  const payload = plain(studio.buildPayload({
    text: "有记忆，就意味着存在。",
    title: "琥珀",
    conversation: { id: "conv-9", contentKind: undefined },
    message: { id: "msg-3", role: "assistant", speaker: "Ciel", createdAt: "2026-08-23T12:34:56.000Z" },
    source: claudeSource,
  }));
  assert.deepEqual(payload, {
    text: "有记忆，就意味着存在。",
    title: "琥珀",
    source: "Ciel · Claude",
    date: "2026.08.23",
    context: {
      platform: "claude", sourceId: "src-internal-2",
      conversationId: "conv-9", messageId: "msg-3", speaker: "Ciel",
    },
  });
});

test("日期：ISO → 拾句风格；没有时间戳给空，绝不盖今天的章", async () => {
  const { studio } = await loadShijuEmbed();
  assert.equal(studio.shijuDate({ createdAt: "2019-02-03T00:10:00+08:00" }), "2019.02.03");
  assert.equal(studio.shijuDate({}), "");
  assert.equal(studio.shijuDate({ createdAt: "not-a-date" }), "");
});

test("懒加载：模块加载零副作用，首次 ensureLoaded 才插脚本，失败可重试", async () => {
  const { studio, runtime, created } = await loadShijuEmbed();
  assert.equal(created.length, 0, "boot 阶段不许碰 createElement");
  const p1 = studio.ensureLoaded();
  assert.equal(created.length, 1);
  assert.equal(created[0].src, "vendor/shiju/shiju-embed.js");
  // 第二次调用共用同一个在途 Promise，不再插标签
  studio.ensureLoaded();
  assert.equal(created.length, 1);
  // 失败 → 拒绝 → 允许重试（再插一个新标签）
  created[0].onerror();
  await assert.rejects(p1);
  const p2 = studio.ensureLoaded();
  assert.equal(created.length, 2);
  // 成功路：挂出 __shijuEmbed 再 onload
  runtime.__shijuEmbed = { openPanel() {} };
  created[1].onload();
  assert.equal(await p2, runtime.__shijuEmbed);
  // 已加载后不再插
  await studio.ensureLoaded();
  assert.equal(created.length, 2);
});

test("isOpen 看真 DOM；open 把语言和 onClose 接给拾句", async () => {
  const { studio, runtime } = await loadShijuEmbed();
  assert.equal(studio.isOpen(), false);
  runtime.document.documentElement.children = [
    { shadowRoot: { querySelector: sel => (sel === ".mask" ? {} : null) } },
  ];
  assert.equal(studio.isOpen(), true);

  let got = null;
  runtime.__shijuEmbed = { openPanel(text, init) { got = { text, init }; } };
  runtime.OD.i18n = { currentLocale: () => "en" };
  let closed = 0;
  await studio.open(
    { text: "quoted", title: "T", source: "S", date: "2026.08.23" },
    { onClose: () => { closed++; } });
  assert.equal(got.text, "quoted");
  assert.equal(got.init.title, "T");
  assert.equal(got.init.locale, "en");
  got.init.onClose();
  assert.equal(closed, 1);
});

test("素材接线：registerUrlPack 收到清单里的信纸包，字体表原样返回", async () => {
  const { studio } = await loadShijuEmbed();
  const calls = [];
  const embed = { registerUrlPack: sets => { calls.push(plain(sets)); return sets.length; } };
  const fonts = studio.wireVendorAssets(embed, {
    fonts: { beau: "vendor/shiju/fonts/Beau_Rivage/x.ttf" },
    papers: { sets: [{ key: "soft01", cn: "象牙", portrait: "vendor/shiju/papers/soft01_portrait.webp" }] },
  });
  assert.deepEqual(plain(fonts), { beau: "vendor/shiju/fonts/Beau_Rivage/x.ttf" });
  assert.deepEqual(calls, [[{ key: "soft01", cn: "象牙", portrait: "vendor/shiju/papers/soft01_portrait.webp" }]]);
  // 清单缺席 → 登记空表；老 vendor 没有该导出 → 安静跳过，不抛
  assert.deepEqual(plain(studio.wireVendorAssets(embed, null)), {});
  assert.deepEqual(calls[1], []);
  studio.wireVendorAssets({}, { papers: { sets: [{}] } });
});

test("vendor 清单带信纸包：20 套 40 张在位，URL 与文件一一对上", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(repositoryRoot, "vendor", "shiju", "manifest.json"), "utf8"));
  const sets = manifest.papers && manifest.papers.sets;
  assert.ok(Array.isArray(sets) && sets.length === 20, "该有 20 套，实得 " + (sets ? sets.length : 0));
  for (const s of sets) {
    for (const orient of ["portrait", "landscape"]) {
      const rel = s[orient];
      assert.ok(rel && rel.startsWith("vendor/shiju/papers/"), s.key + " 的 " + orient + " URL 形状不对");
      assert.ok(fs.existsSync(path.join(repositoryRoot, rel)), rel + " 文件不在位");
    }
    assert.ok(Array.isArray(s.mean) && s.mean.length === 3, s.key + " 缺代表色");
    assert.ok(s.cn || s.en, s.key + " 缺名字");
    assert.ok(!String(s.portrait).startsWith("data:"), "dataURL 不许进清单");
  }
});

test("vendor 包在位且版本对账", () => {
  const bundle = fs.readFileSync(path.join(repositoryRoot, "vendor", "shiju", "shiju-embed.js"), "utf8");
  const manifest = JSON.parse(fs.readFileSync(path.join(repositoryRoot, "vendor", "shiju", "manifest.json"), "utf8"));
  assert.ok(bundle.startsWith("// 拾句 · 嵌入包（生成物，别手改）"), "vendor 包该带生成物横幅");
  assert.ok(bundle.includes("const SHIJU_VERSION = '" + manifest.version + "'"), "包内版本与清单不一致");
  assert.ok(bundle.includes("window.__shijuEmbed"), "导出面丢了");
  assert.ok(!/GM_registerMenuCommand\(/.test(bundle), "嵌入包不该带油猴菜单");
  assert.ok(!bundle.includes("mountSillyTavern"), "嵌入包不该带酒馆入口");
});
