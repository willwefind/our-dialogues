// 拾句嵌入 · 懒加载器与元数据适配器
//
// 阅读器闲着的时候拾句不存在：vendor 包只在第一次真要开 Studio 时注入
// （本仓第一处动态脚本加载）。载荷按图纸 §13：text/title/source/date 给拾句，
// context（platform/sourceId/conversationId/messageId/speaker）留在阅读器侧，
// 内部 id 绝不出现在纸面上。
(function () {
  "use strict";
  window.OD = window.OD || {};

  var VENDOR_URL = "vendor/shiju/shiju-embed.js";
  var loading = null;

  function ensureLoaded() {
    if (window.__shijuEmbed) return Promise.resolve(window.__shijuEmbed);
    if (loading) return loading;
    loading = new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = VENDOR_URL;
      s.onload = function () {
        if (window.__shijuEmbed) resolve(window.__shijuEmbed);
        else reject(new Error("shiju embed loaded but __shijuEmbed missing"));
      };
      s.onerror = function () { reject(new Error("failed to load " + VENDOR_URL)); };
      document.head.appendChild(s);
    });
    // 失败允许下次重试（脚本标签留在 head 无妨，重试会再插一个新的）
    loading.catch(function () { loading = null; });
    return loading;
  }

  var PLATFORM_LABELS = {
    chatgpt: "ChatGPT",
    claude: "Claude",
    mufy: "Mufy",
    "ciel-house": "Claude",
  };

  // 来源行（印在纸上的那一行）：
  //   文档（personal-document）→ 作者（message.speaker），没有就用来源标签；
  //   user 消息 → 裸说话人（Dawn 不用带平台尾巴）；
  //   assistant 消息 → 「说话人 · 平台」（Sol · ChatGPT / Ciel · Claude / 角色 · Mufy）；
  //   拿不到说话人 → 来源标签兜底。
  function sourceLine(ctx) {
    var conversation = ctx.conversation, message = ctx.message, source = ctx.source;
    var speaker = message && typeof message.speaker === "string" ? message.speaker.trim() : "";
    var label = source && source.label ? String(source.label) : "";
    if (conversation && conversation.contentKind === "personal-document") {
      return speaker || label;
    }
    if (message && message.role === "user") return speaker || label;
    var platform = source && source.source && source.source.platform;
    var plat = PLATFORM_LABELS[platform];
    // 说话人本身就叫平台名（如通用导出里的 "ChatGPT"）就别再加尾巴，
    // 免得印出「ChatGPT · ChatGPT」
    if (speaker && plat && speaker.toLowerCase() !== plat.toLowerCase()) {
      return speaker + " · " + plat;
    }
    return speaker || label;
  }

  function two(n) { return String(n).length < 2 ? "0" + n : String(n); }

  // 拾句的日期栏是纸上的内容，用它自己的 2026.08.23 风格；
  // 没有时间戳就给空 —— 旧文字绝不能被盖上今天的章。
  function shijuDate(message) {
    var iso = message && message.createdAt;
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return d.getFullYear() + "." + two(d.getMonth() + 1) + "." + two(d.getDate());
  }

  function buildPayload(input) {
    var conversation = input.conversation, message = input.message, source = input.source;
    return {
      text: String(input.text || ""),
      title: input.title != null ? String(input.title) : "",
      source: sourceLine({ conversation: conversation, message: message, source: source }),
      date: shijuDate(message),
      context: {
        platform: (source && source.source && source.source.platform) || null,
        sourceId: (source && source.id) || null,
        conversationId: (conversation && conversation.id) || null,
        messageId: (message && message.id) || null,
        speaker: (message && message.speaker) || null,
      },
    };
  }

  // Studio 开着没有：看真 DOM（拾句的面板是 documentElement 下的 shadow host）。
  // 不自己记账 —— 账本会和现实漂移，DOM 不会。
  function isOpen() {
    var kids = (document.documentElement && document.documentElement.children) || [];
    for (var i = 0; i < kids.length; i++) {
      var el = kids[i];
      if (el.shadowRoot && el.shadowRoot.querySelector(".mask")) return true;
    }
    return false;
  }

  // 阅读器已捆的字体给拾句复用（§9.1）：开面板前先把 @font-face 真正取下来，
  // 否则拾句的宽度探测量到的是回退字体，会把它们当「没装」。
  // 京華老宋的字体文件默认不在仓里（32MB 本地自备）——load 失败就当没装，探测如实变灰。
  var SHARED_FACES = ["Huiwen Mincho", "Zhuque Fangsong", "IM Fell English", "Special Elite", "KingHwa OldSong"];
  function preloadSharedFaces() {
    if (!document.fonts || typeof document.fonts.load !== "function") return Promise.resolve();
    var loads = SHARED_FACES.map(function (family) {
      return document.fonts.load('16px "' + family + '"').catch(function () {});
    });
    var timeout = new Promise(function (resolve) { setTimeout(resolve, 1500); });
    return Promise.race([Promise.all(loads), timeout]);
  }

  var vendorManifest = null;
  function loadVendorManifest() {
    if (vendorManifest) return Promise.resolve(vendorManifest);
    if (typeof fetch !== "function") return Promise.resolve({});
    return fetch("vendor/shiju/manifest.json")
      .then(function (r) { return r.ok ? r.json() : {}; })
      .then(function (m) { vendorManifest = m; return m; })
      .catch(function () { return {}; });
  }

  // 清单里的素材接线（open 时调用；单测也从这里进）：
  // 信纸 = registerUrlPack 登记静态 URL 素材包（图不进存储，选纸才取）；
  // 西文字体 = URL 表交给「字」屏按选中懒装。老 vendor 没有该导出就安静跳过。
  function wireVendorAssets(embed, manifest) {
    var m = manifest || {};
    if (embed && typeof embed.registerUrlPack === "function") {
      embed.registerUrlPack((m.papers && m.papers.sets) || []);
    }
    return m.fonts || {};
  }

  // 开 Studio：懒加载 + 共享字体预载 + 清单（字体 URL 表 + 信纸包）并行 →
  // 语言跟着阅读器 → onClose 由调用方收回锚点/焦点。
  function open(payload, opts) {
    var o = opts || {};
    return Promise.all([ensureLoaded(), preloadSharedFaces(), loadVendorManifest()])
      .then(function (results) {
        var embed = results[0];
        var fontUrls = wireVendorAssets(embed, results[2]);
        embed.openPanel(payload.text, {
          title: payload.title,
          source: payload.source,
          date: payload.date,
          locale: (window.OD.i18n && OD.i18n.currentLocale()) || "zh-CN",
          fontUrls: fontUrls,
          onClose: function () { if (typeof o.onClose === "function") o.onClose(); },
        });
        return embed;
      });
  }

  OD.shijuStudio = {
    VENDOR_URL: VENDOR_URL,
    ensureLoaded: ensureLoaded,
    buildPayload: buildPayload,
    sourceLine: sourceLine,
    shijuDate: shijuDate,
    wireVendorAssets: wireVendorAssets,
    isOpen: isOpen,
    open: open,
  };
})();
