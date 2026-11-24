// 拾句 · 嵌入包（生成物，别手改）
// 事实源：willwefind/shiju 的 src/ 碎片；重新生成：node tools/build-vendor.mjs
// 版本：0.19.0 · 许可：AGPL-3.0（见源仓 LICENSE）
(function () {
'use strict';
const SHIJU_VERSION = '0.19.0';

// 🔴 iOS 上的 Userscripts **没有**同步的 GM_getValue/GM_setValue（它只给异步的 GM.getValue）。
//    照原样直接调，每次都落到 catch 里返回默认值 —— 表现是「改了纸改了字，换一页全没了」，
//    而且一声不吭。探不到 GM 存储就退到 localStorage。
// ⚠️ 两者不等价：GM 存储跨网站共享，localStorage 按站点分家（每个网站要各设一次），
//    而且只有 ~5MB，3MB 的信纸素材包多半塞不进去。这些都在自检里如实说。
const hasGM = (() => {
  try { return typeof GM_getValue === 'function' && typeof GM_setValue === 'function'; }
  catch { return false; }
})();
const LSK = 'shiju:';
// 存了什么就返回什么，没存过返回 undefined —— 「没存过」和「存了个默认值」得分得开
const rawCfg = k => {
  try {
    if (hasGM) return GM_getValue(k);
    const s = localStorage.getItem(LSK + k);
    return s === null ? undefined : JSON.parse(s);
  } catch { return undefined; }
};
const cfg = k => { const v = rawCfg(k); return v === undefined ? DEF[k] : v; };
// 返回「到底存下没有」—— localStorage 会因为超配额而失败，失败了就得让人知道
const setCfg = (k, v) => {
  try {
    if (k === 'myFonts' && typeof dropFontList === 'function') dropFontList();
    if (hasGM) GM_setValue(k, v); else localStorage.setItem(LSK + k, JSON.stringify(v));
    return true;
  } catch (e) { console.warn('[拾句] 存不下设置：', e.message); return false; }
};

// 一次性迁移：标题字号从「正文的百分比」改成绝对像素。
// 🔴 两种表示法并存必然对不上（同一件事写两套算法），所以迁完就把 titleScale 彻底扔掉，
//    代码里再也不认这个键。存下来的版式也一起迁，不然老版式一点就丢标题字号。
(function migrateTitleSize(){
  const px = (base, scale) => Math.round((base === undefined ? DEF.fontSize : base) * scale / 100);
  try {
    // 走 rawCfg/setCfg，别再直接摸 GM_* —— 那两个在 iOS 上根本不存在
    if (rawCfg('titleSize') === undefined && rawCfg('titleScale') !== undefined)
      setCfg('titleSize', px(rawCfg('fontSize'), rawCfg('titleScale')));
    const ps = rawCfg('presets');
    if (Array.isArray(ps) && ps.some(p => p && p.style && p.style.titleScale !== undefined))
      setCfg('presets', ps.map(p => {
        if (!p || !p.style || p.style.titleScale === undefined) return p;
        const style = { ...p.style };
        style.titleSize = px(style.fontSize, style.titleScale);
        delete style.titleScale;
        return { ...p, style };
      }));
  } catch (e) { console.warn('[拾句] 标题字号迁移没跑成：', e.message); }
})();

// ════════════════════════════════════════════════════════════════════
//  平台缝：排版/绘制这条路上，只有「造一块画布」和「造一张图」跟环境有关
// ════════════════════════════════════════════════════════════════════
// 收在这一处，Node 那边就只要换掉这两个函数，不用垫一整套 DOM ——
// 这样浏览器和服务端跑的是**同一份文件**，而不是两份会分叉的实现。
// 面板 UI 里的 createElement 不走这里（那些本来就只在浏览器里活）。
const PLATFORM = {
  canvas(w, h){
    const c = document.createElement('canvas');
    if (w != null) c.width = w;
    if (h != null) c.height = h;
    return c;
  },
  image(){ return new Image(); },
};
// 加载这份脚本之前先塞一个 globalThis.__shijuPlatform，就能整体替换掉上面两件
try { if (globalThis.__shijuPlatform) Object.assign(PLATFORM, globalThis.__shijuPlatform); } catch {}

// 量具：排版全程只要「量一段字有多宽」这一件能力。
// 排版那几个函数（planPages / chrome / titleBlock / wrapVertical）都收一个可选的
// 量具工厂，不自己去造画布 —— 这样核心离「一个不碰环境的纯排版模块」只差搬家。
// 🔑 工厂可以每次给新的，也可以每次都返回同一块（省着用）：调用链上每个用量具的
//    地方都会**先设 font 再量**，所以共用一块是安全的。planPages 里 probe.font
//    特意设在 chrome() 之后，就是为了共用时不被 chrome 改掉的 font 坑到。
const newMeasure = () => PLATFORM.canvas().getContext('2d');
// ════════════════════════════════════════════════════════════════════
//  0. 设置（GM 存储是跨网站共享的 —— 换纸换字设一次，全网通用）
// ════════════════════════════════════════════════════════════════════
const DEF = {
  paper: 'rice', font: 'auto', fontSize: 46, ink: 'black',
  orient: 'portrait', pages: 'auto',
  weight: 0,            // 字重：0 常规 / 1 中 / 2 粗
  latinFont: 'none',    // 西文字体：拼在中文字体前面，只接管拉丁字母和数字
  titleFont: 'same',    // 标题字体：same = 跟正文一样
  // 标题字号是**绝对像素**，不是正文的百分比 —— 早先按百分比算，于是一动正文字号
  // 标题就跟着变，「把标题和正文分开调」根本做不到。
  titleSize: 69,
  titleWeight: 1,
  inkLight: 0,          // 墨色明暗 −50…+50（正=往白走，负=往黑走）
  paperLight: 0,        // 纸张明暗 −50…+50
  theme: 'auto',        // 面板主题：auto 跟随系统 / day / night
  uiLang: 'auto',       // 面板语言：auto 跟着浏览器 / zh-CN / en（面板右上角那颗按钮换）
  myInks: [],           // [{id,name,c}] 自己调的墨
  align: 'left',        // 正文对齐（在版心里，不是贴纸边）
  titleAlign: 'center',
  vertical: false,      // 竖排：字从上往下，列从右往左
  offsetX: 0, offsetY: 0,   // 整块位移（在预览图上拖出来的）
  metaInk: 'auto',      // 题头/出处/日期/线的颜色。auto = 跟着纸深浅自动定
  // 引号里那段话的颜色。auto = 跟着纸深浅自动定（原来的橙）；same = 跟正文一个色
  // （＝不给引号变色）；也可以指定任何一支墨或直接一个 #rrggbb。
  quoteInk: 'auto',
  blind: null,          // 版式盲盒 {seed, own, calm}。null = 普通版式；只随版式预设存，不跨面板记
  presets: [],          // [{id,name,style}] 存下来的版式
  headRule: true,       // 题头下那道线
  titleRule: true,      // 标题下那道短横
  footRule: true,       // 页脚那道线
  sourcePrefix: '—— ',  // 出处前面的符号，想删就清空
  titleVertical: false, // 标题自己的排向，跟正文分开定
  headText: '摘 录',    // 题头。空手写日记随笔时「摘录」两个字不对味，所以可改
  showHeader: true, showSource: true, showDate: true,
  subdir: '摘录',
  myPapers: [], myFonts: [],
};
// ════════════════════════════════════════════════════════════════════
//  1. 皮肤 token
// ════════════════════════════════════════════════════════════════════
// 核心边界：这一层允许摸的外部名字只有 cfg（inkOf/allInks 读 cfg('myInks')）。
// 嵌入方给核心供的存储适配器必须带 cfg；除此之外不许碰环境。
const INKS = [
  { id:'black',   name:'墨黑', c:'#12100e' },
  { id:'sepia',   name:'深褐', c:'#4a3728' },
  { id:'indigo',  name:'靛青', c:'#1f3a55' },
  { id:'crimson', name:'绛红', c:'#6d2a24' },
  { id:'pine',    name:'松绿', c:'#26433a' },
  { id:'ash',     name:'烟灰', c:'#4b4a46' },
  // 浓色纸上黑字根本读不出来，下面这几支是给它们的
  { id:'paper',   name:'纸白', c:'#f6f2e9' },
  { id:'moon',    name:'月白', c:'#e9eef3' },
  { id:'gold',    name:'浅金', c:'#e3c987' },
  { id:'rose',    name:'藕荷', c:'#f1dade' },
  { id:'jade',    name:'霜青', c:'#d6e7df' },
];
// 墨可以是：预设 id ／ 存下来的 id ／ 直接一个 #rrggbb（临时调的，没存也能用）
function inkOf(id){
  if (typeof id === 'string' && id[0] === '#') return id;
  const mine = (cfg('myInks') || []).find(i => i.id === id);
  if (mine) return mine.c;
  return (INKS.find(i => i.id === id) || INKS[0]).c;
}
const allInks = () => INKS.concat(cfg('myInks') || []);
const QUOTE_ON_DARK = 'rgba(240,186,104,.92)';   // 深纸上橙引号要提亮，不然沉进去
const QUOTE  = 'rgba(199,113,12,.86)';
const RULE   = 'rgba(120,112,100,.34)';
const GREY   = 'rgba(90,84,76,.62)';
const SYS    = '"Songti SC","SimSun","宋体",serif';

// 版心。DPR=2，导出是这个尺寸的两倍。
// 横版是 5:4：与 2700×2160 的信纸素材严丝合缝，一个像素都不用裁。
const SIZES = {
  portrait : { name:'竖版', w:1080, h:1350, pad:104 },
  landscape: { name:'横版', w:1350, h:1080, pad:110 },
};
let DPR = 2;
// 预览的草样按一倍画，存图、复制之前一律补回两倍。效果里的像素量都按两倍写，缩到一倍时过 bPx
const withDPR = (k, fn) => { const was = DPR; DPR = k; try { return fn(); } finally { DPR = was; } };
const bPx = v => v * DPR / 2;

// ── 配色：按对比度挑墨，不靠拍脑袋 ──────────────────────────────────
const hex2rgb = h => [parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16)];
const chan = v => { v /= 255; return v <= 0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4); };
const relLum = ([r,g,b]) => 0.2126*chan(r) + 0.7152*chan(g) + 0.0722*chan(b);
function contrast(rgbA, rgbB){
  const a = relLum(rgbA), b = relLum(rgbB);
  return (Math.max(a,b) + 0.05) / (Math.min(a,b) + 0.05);
}
const bestInk = mean => allInks().reduce((best, i) =>
  contrast(hex2rgb(i.c), mean) > contrast(hex2rgb(best.c), mean) ? i : best, INKS[0]);

// 一套「版式」＝下面这些键（纸、字、色、排版全在内）。内容（正文/出处/日期）不在里面 —— 换版式不该动已经写好的字。
const STYLE_KEYS = ['paper','font','latinFont','fontSize','ink','metaInk','quoteInk','orient','pages',
                    'weight','titleFont','titleSize','titleWeight','inkLight','paperLight',
                    'align','titleAlign','vertical','offsetX','offsetY',
                    'headText','showHeader','showSource','showDate',
                    'headRule','titleRule','footRule','sourcePrefix','titleVertical','blind'];

const BUILTIN_PRESETS = [
  { id:'p_zhai', name:'摘录', style:{ headText:'摘 录', showHeader:true, showSource:true, showDate:true,
      align:'left', titleAlign:'center', vertical:false, orient:'portrait', paper:'rice',
      ink:'black', metaInk:'auto', quoteInk:'auto', fontSize:46, titleSize:69, titleWeight:1, weight:0,
      offsetX:0, offsetY:0 } },
  { id:'p_riji', name:'日记', style:{ headText:'日 记', showHeader:true, showSource:false, showDate:true,
      align:'left', titleAlign:'left', vertical:false, orient:'portrait', paper:'cream',
      ink:'sepia', metaInk:'auto', quoteInk:'auto', fontSize:44, titleSize:57, titleWeight:0, weight:1,
      offsetX:0, offsetY:0 } },
  { id:'p_xin',  name:'信件', style:{ headText:'', showHeader:false, showSource:true, showDate:true,
      align:'left', titleAlign:'left', vertical:false, orient:'portrait', paper:'linen',
      ink:'indigo', metaInk:'auto', quoteInk:'auto', fontSize:42, titleSize:59, titleWeight:0, weight:0,
      offsetX:0, offsetY:0 } },
  { id:'p_shu',  name:'竖排', style:{ headText:'', showHeader:false, showSource:true, showDate:true,
      align:'left', titleAlign:'center', vertical:true, orient:'portrait', paper:'rice',
      ink:'black', metaInk:'auto', quoteInk:'auto', fontSize:44, titleSize:66, titleWeight:0, weight:0,
      offsetX:0, offsetY:0 } },
];

// 每次打开随机拿一句。Alt+Q 已经能空手起稿了，那句「选中的话，排成纸」不再准确。
const TAGLINES = [
  '我想记住的',
  '文字也认得写字的人吗？',
  '加入了我的一点私心',
  '再靠近我一点吧',
  '纸短情长',
  '万物与我，都是荒诞的静寂',
  '物是人非事事休',
  '房子实际上并没有这么大',
];

// 明暗调节。t ∈ [−0.5, 0.5]，正=往白走，负=往黑走。
// 纸的调法是盖一层同 alpha 的白/黑，算式与这里完全一致 ——
// 所以「算对比度用的均色」和「画出来的纸」永远是同一个数，不会各说各话。
const shade = (rgb, t) => t >= 0
  ? rgb.map(v => Math.round(v + (255 - v) * t))
  : rgb.map(v => Math.round(v * (1 + t)));
const rgb2css = ([r,g,b]) => `rgb(${r},${g},${b})`;
const inkColorOf = st => rgb2css(shade(hex2rgb(inkOf(st.ink)), (st.inkLight || 0) / 100));

// ════════════════════════════════════════════════════════════════════
//  2. 字
//     每款给一串候选族名，探到哪个用哪个。为什么不能只写一个：
//       · Windows 族名硬上限 31 字符（GDI 的 LF_FACESIZE），
//         「Zhuque Fangsong (technical preview)」在系统里叫「…(technical prev」
//       · 有的字 Windows 只认英文族名（朝華標題 → ZhaohuaMinA），有的只认中文
//     猜单个名字猜错＝浏览器静默退回宋体，不报错也看不出来。
// ════════════════════════════════════════════════════════════════════
// 核心边界：这一层允许摸的外部名字只有 cfg 和 PLATFORM（fontStack 缺省参数
// 读 cfg('latinFont')，familyOf/cjkStack 读 cfg('myFonts')；量宽走 PLATFORM）。
const FONTS = [
  { id:'sys',      name:'系统宋体',  probes:[] },
  // 各条 probes 末尾的英文名是 Our Dialogues 阅读器捆包字体的 @font-face 族名 ——
  // 嵌入阅读器时靠它认出「阅读器已经带了这款字」，一个文件都不用重复装（去重清单 §9.1）
  { id:'zhuque',   name:'朱雀仿宋',  probes:['Zhuque Fangsong (technical preview)','Zhuque Fangsong (technical prev','朱雀仿宋（预览测试版）','朱雀仿宋','Zhuque Fangsong'] },
  { id:'jinghua',  name:'京華老宋',  probes:['KingHwaOldSong','京華老宋體','京華老宋体','KingHwa OldSong'] },
  { id:'huiwen',   name:'汇文明朝',  probes:['Huiwen-mincho','汇文明朝体','Huiwen Mincho'] },
  { id:'jinshu',   name:'寒蝉锦书',  probes:['寒蝉锦书宋','寒蟬錦書宋','ChillJinshuSong'] },
  { id:'chillhuo', name:'寒蝉活宋',  probes:['ChillHuoSong_F','寒蝉活宋体__'] },
  { id:'duanhei',  name:'寒蝉端黑',  probes:['寒蝉端黑宋Pro','寒蟬端黑宋Pro','ChillDuanHeiSongPro'] },
  { id:'nanxi',    name:'南西油墨',  probes:['NanxiYoumosong','南西油墨宋'] },
  { id:'nano',     name:'纳米老宋',  probes:['NanoOldSong-C','纳米老宋-C'] },
  { id:'chaohua',  name:'朝華標題',  probes:['ZhaohuaMinA','朝華標題A','朝华标题A','朝華見出明朝A'] },
  { id:'chaohuaB', name:'朝華標題B', probes:['ZhaohuaMinB Black','ZhaohuaMinB','朝華標題B','朝华标题B'] },
  // ⚠️ 鼎猎宋刻体：授权书禁止把字体「文件」嵌入网站/程序。这里只是调用系统里已装的字来
  //    渲染，属于正常用字，不是嵌入。但它的字体文件绝不可以随这个项目分发。
  { id:'dinglie',  name:'鼎猎宋刻',  probes:['dingliesongtypeface','鼎猎宋刻体'] },
  { id:'pixel',    name:'像素',      probes:['Fusion Pixel 12px Proportional'] },
];

// 西文字体：拼在中文字体**前面**，浏览器就只让它接管它有的字形（拉丁字母、数字、
// 西文标点），汉字自动落回后面的中文字体。这是字体栈本来的机制，不用做字符分流。
// 下面是 Windows/Office 自带的几款；自己下的字用「＋」装进来后也会出现在这一行。
const LATIN = [
  { id:'none',      name:'不指定',    probes:[] },
  // 系统自带
  { id:'georgia',   name:'Georgia',   probes:['Georgia'] },
  { id:'garamond',  name:'Garamond',  probes:['EB Garamond','Garamond','Adobe Garamond Pro'] },
  { id:'times',     name:'Times',     probes:['Times New Roman'] },
  { id:'cambria',   name:'Cambria',   probes:['Cambria'] },
  { id:'constantia',name:'Constantia',probes:['Constantia'] },
  { id:'palatino',  name:'Palatino',  probes:['Palatino Linotype','Book Antiqua'] },
  { id:'baskerv',   name:'Baskerville', probes:['Baskerville Old Face','Libre Baskerville','Baskerville'] },
  { id:'didot',     name:'Didot',     probes:['Bodoni MT','Didot','Playfair Display'] },
  // Google Fonts 上的几款（全部 OFL / Apache，可随包分发，见 docs/FONTS.md）
  { id:'fellEng',   name:'IM Fell English', probes:['IM FELL English'],    hint:'十七世纪活字' },
  { id:'fellPica',  name:'IM Fell DW Pica', probes:['IM FELL DW Pica'],    hint:'十七世纪活字' },
  { id:'elite',     name:'Special Elite',   probes:['Special Elite'],      hint:'打字机' },
  { id:'limelight', name:'Limelight',       probes:['Limelight'],          hint:'装饰体' },
  { id:'uncial',    name:'Uncial Antiqua',  probes:['Uncial Antiqua'],     hint:'安色尔' },
  { id:'smokum',    name:'Smokum',          probes:['Smokum'],             hint:'西部厚板' },
  { id:'beau',      name:'Beau Rivage',     probes:['Beau Rivage'],        hint:'花体' },
  { id:'jim',       name:'Jim Nightshade',  probes:['Jim Nightshade'],     hint:'哥特手写' },
  { id:'tages',     name:'Tagesschrift',    probes:['Tagesschrift'],       hint:'手写' },
  { id:'coral',     name:'Coral Pixels',    probes:['Coral Pixels'],       hint:'像素' },
];

// 宽度对比法：document.fonts.check() 在 Chrome 上对不存在的字体也返回 true，不能用
const probeCache = new Map();
// 网页字体是边用边下的：没下完的时候量出来像「没装」。下完了就把「没装」的结论作废，重新认
function dropFontProbes(){ for (const [k, v] of probeCache) if (!v) probeCache.delete(k); if (typeof bGlyphCache !== 'undefined') for (const [k, v] of bGlyphCache) if (!v) bGlyphCache.delete(k); }
function hasFont(family){
  if (!family) return true;
  if (probeCache.has(family)) return probeCache.get(family);
  const c = PLATFORM.canvas().getContext('2d');
  const s = '天地玄黄AWMil0';
  c.font = '72px monospace';               const base = c.measureText(s).width;
  c.font = `72px "${family}", monospace`;  const got  = c.measureText(s).width;
  const ok = Math.abs(got - base) > 0.5;
  probeCache.set(family, ok);
  return ok;
}
const resolveFont   = f => (f.probes || []).find(hasFont) || null;
const fontAvailable = f => !f.probes || !f.probes.length || !!resolveFont(f);

function cjkStack(id){
  if (id === 'auto'){
    for (const f of FONTS){ const hit = f.probes && f.probes.length && resolveFont(f); if (hit) return `"${hit}",${SYS}`; }
    return SYS;
  }
  const custom = myFontList().find(f => f.id === id);
  if (custom) return `"${custom.id}",${SYS}`;
  const f = FONTS.find(f => f.id === id);
  const hit = f && resolveFont(f);
  return hit ? `"${hit}",${SYS}` : SYS;
}
// 从任何一张表里把「系统里真正叫什么」解出来：自装的 → 中文表 → 西文表
// 自己装的字：存储里连着字体文件本身（一款好几兆）。挑字、排盲盒一次要问几十遍名字，
// 每问一遍都把文件整个搬出来一趟 —— 卡就卡在这儿。名单单独记着，改了再重取。
let fontList = null, fontListAt = 0;
const dropFontList = () => { fontList = null; };
const myFontList = () => { const now = Date.now(); if (!fontList || now - fontListAt > 4000){ fontList = (cfg('myFonts') || []).map(f => ({ id: f.id, name: f.name })); fontListAt = now; } return fontList; };
function familyOf(id){
  const custom = myFontList().find(f => f.id === id);
  if (custom) return custom.id;
  const f = FONTS.find(x => x.id === id); if (f) return resolveFont(f);
  const l = LATIN.find(x => x.id === id); if (l) return resolveFont(l);
  return null;
}
// 标题可以挑中文字，也可以挑英文字。挑了英文字时它管拉丁，汉字自动落回正文的中文字体。
function titleStack(st){
  const body = fontStack(st.font, st.latinFont);
  return (!st.titleFont || st.titleFont === 'same') ? body : pickStack(st.titleFont, st, body);
}
// 指名要某一款字（标题、局部样式）。认不出来 / 没装，就退回 fallback。
// 点名的字排在最前：连西文也归它，不再让全局的西文字体插队。
function pickStack(id, st, fallback){
  if (id === 'sys') return SYS;
  const hit = familyOf(id);
  return hit ? `"${hit}",${cjkStack(st.font)}` : fallback;
}

// 西文字体拼在最前面。它没有的字形（汉字）浏览器会自动往后找，不用我们分流字符。
function fontStack(id, latinId){
  const base = cjkStack(id);
  const lid = latinId === undefined ? cfg('latinFont') : latinId;
  if (!lid || lid === 'none') return base;
  const custom = myFontList().find(f => f.id === lid);
  if (custom) return `"${custom.id}",${base}`;
  const l = LATIN.find(x => x.id === lid);
  const hit = l && resolveFont(l);
  return hit ? `"${hit}",${base}` : base;
}

const loadedCustom = new Set();
async function ensureCustomFonts(){
  for (const f of cfg('myFonts')){
    if (loadedCustom.has(f.id)) continue;
    try { const face = new FontFace(f.id, `url(${f.data})`); await face.load(); document.fonts.add(face); loadedCustom.add(f.id); }
    catch (e){ console.warn('[拾句] 装不上字体', f.name, e.message); }
  }
}

// 嵌入方给可再分发西文字体提供文件 URL 时，**选中那一刻**才真正装载（§9.3 懒加载）。
// 装完清探测缓存，让 hasFont 重探出「装上了」。用户脚本路径不带 URL，此函数永不被调。
const urlFontLoaded = new Set();
async function ensureUrlFont(family, url){
  if (urlFontLoaded.has(family)) return;
  const face = new FontFace(family, 'url("' + url + '")');
  await face.load();
  document.fonts.add(face);
  urlFontLoaded.add(family);
  probeCache.clear();
}

// ════════════════════════════════════════════════════════════════════
//  3. 纸：内置的全部用代码生成，不带素材；用户自己的纸另存
// ════════════════════════════════════════════════════════════════════
// 核心边界：这一层允许摸的外部名字只有 cfg/setCfg 和 PLATFORM
// （myPaper/packs 读 cfg，installPack 写 setCfg('packs')；造图走 PLATFORM.image）。
// wash = 三层云斑的强度。给大了纸会花成做旧咖啡渍，深色纸尤其敏感，所以逐种调。
const PAPERS = {
  rice : { name:'宣纸', base:'#f7f5f0', fiber:'rgba(120,105,80,.28)', fibers:240, grain:8, wash:[.15,.11,.09] },
  cream: { name:'米黄', base:'#f4ecd9', fiber:'rgba(150,125,80,.16)', fibers:90,  grain:6, wash:[.07,.06,.06] },
  kraft: { name:'牛皮', base:'#cdaa82', fiber:'rgba(105, 70, 38,.20)', fibers:200, grain:7, wash:[.05,.05,.05] },
  linen: { name:'布纹', base:'#f2efe6', fiber:'rgba(120,110,90,.12)', fibers:40,  grain:5, wash:[.06,.06,.07], weave:true },
  // flat = 一点纹理都不加。纯黑就该是纯黑，加了云斑和草屑反而脏。
  black: { name:'纯黑', base:'#000000', flat:true },
};

function mulberry32(a){ return function(){ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }

function blobLayer(w, h, cell, rnd){
  const sw = Math.max(2, Math.ceil(w/cell)), sh = Math.max(2, Math.ceil(h/cell));
  const c = PLATFORM.canvas(sw, sh);
  const ctx = c.getContext('2d'), img = ctx.createImageData(sw, sh);
  for (let i = 0; i < sw*sh; i++){
    const v = 128 + (rnd()-0.5)*255;
    img.data[i*4] = img.data[i*4+1] = img.data[i*4+2] = v; img.data[i*4+3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

const paperCache = new Map();
function makePaper(kind, w, h, seedShift){
  const key = `${kind}:${w}x${h}:${seedShift || 0}`;
  if (paperCache.has(key)) return paperCache.get(key);
  if (paperCache.size > 24) paperCache.clear();          // 多页 × 多尺寸，别无限涨
  const spec = PAPERS[kind] || PAPERS.rice;
  // 每一页的纸纹都不一样（真的一叠纸就是这样），但同一页每次重画都一样
  const rnd = mulberry32(0x5E1F + kind.length*977 + kind.charCodeAt(0)*13 + (seedShift || 0)*7919);
  const cv = PLATFORM.canvas(w, h);
  const ctx = cv.getContext('2d');

  ctx.fillStyle = spec.base; ctx.fillRect(0, 0, w, h);
  if (spec.flat){ paperCache.set(key, cv); return cv; }

  // soft-light 而不是 overlay：overlay 会把中间调对比拉爆，纸就花了
  ctx.globalCompositeOperation = 'soft-light';
  const wash = spec.wash || [.15, .11, .09];
  [[110, wash[0]], [30, wash[1]], [9, wash[2]]].forEach(([cell, alpha]) => {
    ctx.globalAlpha = alpha; ctx.imageSmoothingEnabled = true;
    ctx.drawImage(blobLayer(w, h, cell, rnd), 0, 0, w, h);
  });
  ctx.globalAlpha = spec.grain / 100;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(blobLayer(w, h, 1.6, rnd), 0, 0, w, h);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1; ctx.imageSmoothingEnabled = true;

  // 织纹：不能画连续直线 —— 规则栅格在任何缩放比例下都起摩尔纹，缩略图上就成了方格纸
  if (spec.weave){
    ctx.lineWidth = 1; ctx.lineCap = 'butt';
    for (let y = 0; y < h; y += 3){
      let x = rnd()*6;
      while (x < w){
        const seg = 3 + rnd()*11;
        ctx.strokeStyle = `rgba(150,142,124,${(.035 + rnd()*.045).toFixed(3)})`;
        ctx.beginPath(); ctx.moveTo(x, y+.5); ctx.lineTo(Math.min(w, x+seg), y+.5); ctx.stroke();
        x += seg + 1 + rnd()*5;
      }
    }
    for (let x = 0; x < w; x += 3){
      let y = rnd()*6;
      while (y < h){
        const seg = 3 + rnd()*11;
        ctx.strokeStyle = `rgba(150,142,124,${(.030 + rnd()*.040).toFixed(3)})`;
        ctx.beginPath(); ctx.moveTo(x+.5, y); ctx.lineTo(x+.5, Math.min(h, y+seg)); ctx.stroke();
        y += seg + 1 + rnd()*5;
      }
    }
  }

  ctx.strokeStyle = spec.fiber; ctx.lineCap = 'round';
  for (let i = 0; i < spec.fibers; i++){
    const x = rnd()*w, y = rnd()*h, len = 4 + rnd()*26, ang = rnd()*Math.PI*2;
    ctx.lineWidth = rnd() < .18 ? 1.7 : 0.9;
    ctx.globalAlpha = .25 + rnd()*.65;
    ctx.beginPath(); ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + Math.cos(ang)*len*.6 + (rnd()-.5)*7,
                         y + Math.sin(ang)*len*.6 + (rnd()-.5)*7,
                         x + Math.cos(ang)*len,     y + Math.sin(ang)*len);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  const g = ctx.createRadialGradient(w/2, h/2, Math.min(w,h)*.32, w/2, h/2, Math.max(w,h)*.78);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(90,78,58,.09)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);

  paperCache.set(key, cv);
  return cv;
}

const myPaperImgs = new Map();
function myPaper(id){
  if (myPaperImgs.has(id)) return myPaperImgs.get(id);
  const rec = cfg('myPapers').find(p => p.id === id);
  if (!rec) return null;
  const img = PLATFORM.image(); img.src = rec.data;
  myPaperImgs.set(id, img);
  return img;
}

// ── 素材包：横竖成对，按当前版式自动取对应那张 ──────────────────────
// 3MB 的图不塞进脚本本体（脚本会被注入到你打开的每一个网页），
// 而是导入一次进 GM 存储 —— GM 存储是跨网站共享的，导完就等于常驻在插件里。
let _packs = null;
// 嵌入方登记的「URL 素材包」：图是页面同源的静态文件（比如阅读器 vendor 下的
// 40 张 webp），不进存储、不占配额，选纸那一刻浏览器才去取。与存储包并列出现；
// key 撞了存储包优先（packSet 找先出现的）。重复登记 = 整体替换，幂等。
let _urlPacks = [];
function registerUrlPack(sets){
  _urlPacks = (Array.isArray(sets) ? sets : [])
    .filter(s => s && s.key && (s.portrait || s.landscape));
  _packs = null; packImgs.clear(); meanCache.clear();
  return _urlPacks.length;
}
const packs = () => (_packs || (_packs = (cfg('packs') || []).concat(_urlPacks)));
const packSet = key => packs().find(s => s.key === key);
const packImgs = new Map();
function packImg(key, orient){
  const id = key + ':' + orient;
  if (packImgs.has(id)) return packImgs.get(id);
  const s = packSet(key); if (!s) return null;
  const img = PLATFORM.image(); img.src = s[orient] || s.portrait;
  packImgs.set(id, img);
  return img;
}

// 一张纸的代表色 —— 用来给它配墨。lightAdj 是「调完亮度之后」的样子。
const meanCache = new Map();
function paperMean(paperId, lightAdj){
  const base = paperMeanRaw(paperId);
  return lightAdj ? shade(base, lightAdj / 100) : base;
}
function paperMeanRaw(paperId){
  if (meanCache.has(paperId)) return meanCache.get(paperId);
  let rgb = [247, 245, 240];
  if (paperId.startsWith('pk:')){
    const s = packSet(paperId.slice(3));
    if (s && s.mean) rgb = s.mean;
  } else if (paperId.startsWith('my:')){
    const img = myPaper(paperId.slice(3));
    if (img && img.complete && img.naturalWidth){
      const c = PLATFORM.canvas(1, 1);
      const cx = c.getContext('2d'); cx.drawImage(img, 0, 0, 1, 1);
      const d = cx.getImageData(0, 0, 1, 1).data; rgb = [d[0], d[1], d[2]];
    } else return rgb;                       // 还没解码完，先别记进缓存
  } else if (PAPERS[paperId]){
    rgb = hex2rgb(PAPERS[paperId].base);
  }
  meanCache.set(paperId, rgb);
  return rgb;
}
function drawCover(ctx, src, w, h){
  const sw = src.width || src.naturalWidth, sh = src.height || src.naturalHeight;
  if (!sw || !sh) return false;
  const s = Math.max(w/sw, h/sh);
  ctx.drawImage(src, (w - sw*s)/2, (h - sh*s)/2, sw*s, sh*s);
  return true;
}


// 装素材包。抽成独立函数，好让自测直接喂真文件进来验（不用去点文件选择框）。
// opt.warm === false：装完**不**预解码。
// 🔴 预热那一步在浏览器里是必要的（导完包马上点纸，不预热会点开一张白的），
//    但它的代价是把 20 套 × 竖横两版 = 40 张 2160×2700 全解进内存 ≈ 930MB。
//    服务端（MCP）没人点纸，只在真要画的那一刻取一张，所以让它能关掉。
async function installPack(text, opt = {}){
  const data = JSON.parse(text);
  const sets = (data.sets || []).filter(s => s.key && (s.portrait || s.landscape));
  if (!sets.length) throw new Error('这个文件里没有可用的信纸');
  // 先把这一份记在内存里，再谈存不存得下 —— 存不下（localStorage 只有 ~5MB）也不该
  // 让刚导进来的纸当场消失。存不下的话回头告诉用户「这次能用，下次还得再导」。
  const kept = setCfg('packs', sets);
  _packs = null; packImgs.clear(); meanCache.clear();   // 重算合并视图（存储包 + URL 包）
  installPack.persisted = kept;
  // 等图真的解码完再说「装好了」，不然点开一张纸是白的
  if (opt.warm !== false)
    await Promise.all(sets.flatMap(s => ['portrait','landscape'].map(o => new Promise(r => {
      const im = packImg(s.key, o); if (!im || im.complete) return r();
      im.onload = r; im.onerror = r;
    }))));
  return sets.length;
}
// ════════════════════════════════════════════════════════════════════
//  4. 中文排版：避头尾 + 英文整词不断行 + 引号变色
// ════════════════════════════════════════════════════════════════════
const NO_START = '，。、；：？！）」』】》〉…—·%,.;:?!”’';
const NO_END   = '（「『【《〈“‘';
const ASCII    = /[A-Za-z0-9][A-Za-z0-9\-_.@/+']*/y;

function tokenize(str){
  const t = []; let i = 0;
  while (i < str.length){
    ASCII.lastIndex = i;
    const m = ASCII.exec(str);
    if (m && m[0].length > 1){ t.push(m[0]); i = ASCII.lastIndex; }
    else { t.push(str[i]); i++; }
  }
  return t;
}
// 一截字有多宽。rich ＝ 逐字样式（见 spans.js），同样式的连成一段一次量完；
// 没有 rich 就用 ctx 当前的 font，跟从前一样。
// 🔑 给了 rich 的话 ctx.font 会被改掉，调用方接着要量/画素字得自己设回来。
function textWidth(ctx, str, rich, a = 0, b = str.length){
  if (!rich) return ctx.measureText(str.slice(a, b)).width;
  let w = 0;
  for (let i = a; i < b;){
    let j = i + 1;
    while (j < b && rich[j] === rich[i]) j++;
    ctx.font = styleFont(rich[i]);
    w += ctx.measureText(str.slice(i, j)).width;
    i = j;
  }
  return w;
}
// track = 逐字字距。题头/出处是带字距画的，折行时不把它算进来，
// 行就会比版心宽（每字多几像素，三十来个字就多出上百）。
// 🔑 每一行都是原串里连续的一段 [a,b)，全部行首尾相接正好等于原串 ——
//    局部样式就靠这一条按下标跟过去，别在这里增删任何字符。
function wrap(ctx, str, width, track, rich){
  const t = track || 0;
  const W = (from, to) => textWidth(ctx, str, rich, from, to) + t * (to - from);
  const lines = []; let a = 0, b = 0, w = 0, at = 0;
  for (const tok of tokenize(str)){
    let from = at; const to = at + tok.length; at = to;
    let tw = W(from, to);
    if (b > a && w + tw > width){
      // 避尾：行尾不能是「（ 这类开引号，把它拉到下一行
      while (b > a && NO_END.includes(str[b - 1])){ b--; from = b; }
      lines.push([a, b]); a = b = from; w = 0;
      // 🔴 拉下来的开引号也占宽。早先没算它，这一行就比版心宽出一两个字 ——
      //    字小时看不出来，选中的字一调大就冲出去了。
      tw = W(from, to);
    }
    // 避头：句读不能站行首。先试着塞回上一行；塞不下就把上一行最后一个字一起拉下来（追出）。
    // 🔴 早先这里是无条件塞回去的 —— 行就悄悄超出版心，
    //    平时看不出来，一做对齐立刻露馅（右对齐会算出负偏移，字跑到版心左边去）。
    if (a === b && NO_START.includes(str[from]) && lines.length){
      const prev = lines[lines.length - 1];
      if (W(prev[0], to) <= width){ prev[1] = to; a = b = to; continue; }
      if (prev[1] - prev[0] > 1){
        // 🔴 拉下来的要是个句读（「走。」连着两个），它自己又站了行首 —— 一直拉到不是为止
        do prev[1]--; while (prev[1] - prev[0] > 1 && NO_START.includes(str[prev[1]]));
        a = prev[1]; w = W(a, from);
      }
    }
    b = to; w += tw;
  }
  if (b > a) lines.push([a, b]);
  return lines.map(([x, y]) => str.slice(x, y));
}
// 字重不用 bold 关键字：中文字体大多只装了 Regular，浏览器合成出来的假粗
// 各家不一样、也没法微调。改成描边加粗 —— 任何字体都吃，粗细可控。
// 同色的连续一段一次画完，而不是一个字一个字画 ——
// 逐字画会把西文的字距调整（kerning）全丢掉，接了西文字体后一眼就看得出松散。
// 只在引号变色的地方断开。
// 一段字走完之后，引号还剩几层没闭合。折行/翻页时用它把深度接上。
const Q_OPEN = '「『“', Q_CLOSE = '」』”';
function quoteDepthAfter(str, d = 0){
  for (const ch of str){
    if (Q_OPEN.includes(ch)) d++;
    else if (Q_CLOSE.includes(ch)) d = Math.max(0, d - 1);
  }
  return d;
}
// 翻到第 idx 页时，正文的引号深度应该是多少（段间空档归零）
function quoteDepthAtPage(pages, idx){
  let d = 0;
  for (let p = 0; p < idx; p++)
    for (const it of pages[p]) d = it.gap ? 0 : quoteDepthAfter(it.text, d);
  return d;
}
// 🔴 depth0：一段引号常常跨行（甚至跨页）。早先 depth 每行从 0 起，
//    于是「一句话说到第二行就变回墨色」—— 颜色在折行处断掉，看着像坏了。
//    现在由调用方把上一行结束时的深度传进来。
function drawRich(ctx, x, y, line, inkColor, quoteColor, stroke, depth0 = 0, rich = null){
  let depth = depth0, run = '', runCol = null, runSty = null;
  const drop = rich ? richBaseline(ctx, rich) : null;   // 大小字混排：全行坐在同一条基线上
  if (drop != null){ ctx.textBaseline = 'alphabetic'; y += drop; }
  const flush = () => {
    if (!run) return;
    const sw = runSty ? runSty.stroke : stroke;
    if (runSty) ctx.font = styleFont(runSty);
    const keep = ctx.globalAlpha; if (runSty && runSty.alpha !== undefined) ctx.globalAlpha = keep * runSty.alpha;
    ctx.fillStyle = runCol;
    if (sw > 0){
      ctx.strokeStyle = runCol; ctx.lineWidth = sw;
      ctx.lineJoin = 'round'; ctx.miterLimit = 2;
      ctx.strokeText(run, x, y);
    }
    ctx.fillText(run, x, y); ctx.globalAlpha = keep;
    x += ctx.measureText(run).width;
    run = '';
  };
  for (let i = 0; i < line.length; i++){
    const ch = line[i], sty = rich ? rich[i] : null;
    if (Q_OPEN.includes(ch)) depth++;
    // 自己挑过颜色的字，压过引号变色
    const col = (sty && sty.ink) || (depth > 0 ? quoteColor : inkColor);
    if (col !== runCol || sty !== runSty){ flush(); runCol = col; runSty = sty; }
    run += ch;
    if (Q_CLOSE.includes(ch)) depth = Math.max(0, depth - 1);
  }
  flush();
  if (drop != null) ctx.textBaseline = 'top';
}
// 'top' 基线到字母基线有多远。每款字的度量不同，只能现量；
// 两种基线下同一个字的上沿之差就是它，跟用哪个字量无关。
function baseDrop(ctx, font){
  ctx.font = font;
  ctx.textBaseline = 'alphabetic'; const a = ctx.measureText('永').actualBoundingBoxAscent;
  ctx.textBaseline = 'top';        const b = ctx.measureText('永').actualBoundingBoxAscent;
  return a - b;
}
// 一行的基线由最大的那几个字定。里头要是有没改过的素字就听它的 ——
// 只换了字体或颜色的行，其余的字不许跟着上下挪。
function richBaseline(ctx, rich){
  const M = maxSize(rich, 0);
  const top = [...new Set(rich.filter(r => r.size === M))];
  const pick = top.some(r => r.plain) ? top.filter(r => r.plain) : top;
  return Math.max(...pick.map(r => baseDrop(ctx, styleFont(r))));
}
const strokeFor = (weight, size) => [0, size * 0.020, size * 0.042][weight || 0] || 0;
const tracked      = (ctx, x, y, str, tr) => { for (const c of str){ ctx.fillText(c, x, y); x += ctx.measureText(c).width + tr; } };
const trackedWidth = (ctx, str, tr) => { let w = 0; for (const c of str) w += ctx.measureText(c).width; return w + tr*(str.length-1); };

// ── 竖排 ────────────────────────────────────────────────────────────
// 中文竖排不是「把横排转 90 度」：字要正着写、一个一个往下落，列从右往左走。
// 但标点得分三类各自处理，不然一眼就露馅。
const V_ROTATE = '「」『』（）〔〕【】《》〈〉〔〕()[]{}—…～~－-';  // 要转 90° 的
const V_CORNER = '。，、；：';                                     // 要挪到格子右上角的
const isLatin  = ch => /[A-Za-z0-9@#$%&*+=/\\|<>^_]/.test(ch);

// 一列拆成一格一格：连着的英文数字并成一格（整串转 90°），其余一字一格。
// 样式一变就断开，但「算不算同一串英文」看的是整列 —— 不然两个词样式不同，
// 中间那个空格会被当成一个汉字那么高。
// 🔑 量（vAdvance）和画（drawColumn）都走这一份格子 —— 折列时估一套、
//    画的时候走另一套，就一定会对不上。
function vCells(col, rich){
  const cells = [];
  for (let i = 0; i < col.length;){
    if (!isLatin(col[i])){ cells.push({ t: col[i], at: i, latin: false }); i++; continue; }
    let j = i;
    while (j < col.length && (isLatin(col[j]) || (col[j] === ' ' && isLatin(col[j+1] || '')))) j++;
    while (i < j){
      let k = i + 1;
      while (k < j && (!rich || rich[k] === rich[i])) k++;
      cells.push({ t: col.slice(i, k), at: i, latin: true });
      i = k;
    }
  }
  return cells;
}

// 一列排下来有多高。
// 🔴 英文串竖排时整体旋转，实际吃掉的高度＝它的渲染宽度，不是「字数×某个系数」。
//    早先按 0.5 估，估少了列就漏到纸外去。现在真去量。
function vAdvance(ctx, col, size, rich){
  let h = 0;
  for (const c of vCells(col, rich)){
    const sty = rich ? rich[c.at] : null;
    if (!c.latin){ h += sty ? sty.size : size; continue; }
    if (sty) ctx.font = styleFont(sty);
    h += ctx.measureText(c.t).width;
  }
  return h;
}

// 把一段话切成竖排的列。每列是一串字符，列高由版心高度决定。
// colH 是像素高度，不是格子数。跟 wrap 一样：各列首尾相接正好等于原串。
function wrapVertical(str, size, colH, ctx, mk, rich){
  if (!ctx){ const c = (mk || newMeasure)(); c.font = `${size}px serif`; ctx = c; }
  const H = (from, to) => vAdvance(ctx, str.slice(from, to), size, rich && rich.slice(from, to));
  const cols = [];
  let a = 0, b = 0, at = 0;
  for (const tok of tokenize(str)){
    let from = at; const to = at + tok.length; at = to;
    if (b > a && H(a, to) > colH){
      while (b > a && NO_END.includes(str[b - 1])){ b--; from = b; }
      if (b > a) cols.push([a, b]);
      a = b = from;
    }
    if (a === b && NO_START.includes(str[from]) && cols.length){ cols[cols.length-1][1] = to; a = b = to; continue; }
    b = to;
  }
  if (b > a) cols.push([a, b]);
  return cols.map(([x, y]) => str.slice(x, y));
}

// 画一列竖排的字。返回这一列实际用掉的高度。
// 大小字混排时，每个字都居中在这一列的中轴上（轴由最大的字定）。
function drawColumn(ctx, x, y, col, size, inkColor, quoteColor, stroke, depth0 = 0, rich = null){
  let depth = depth0, cy = y;
  const M = maxSize(rich, size);
  for (const cell of vCells(col, rich)){
    const ch = cell.t, sty = rich ? rich[cell.at] : null;
    const sz = sty ? sty.size : size, sw = sty ? sty.stroke : stroke;
    const gx = x + (M - sz) / 2, keep = ctx.globalAlpha;
    if (sty) ctx.font = styleFont(sty);
    if (sty && sty.alpha !== undefined) ctx.globalAlpha = keep * sty.alpha;
    if (Q_OPEN.includes(ch)) depth++;
    const c = (sty && sty.ink) || (depth > 0 ? quoteColor : inkColor);
    ctx.fillStyle = c;
    if (sw > 0){ ctx.strokeStyle = c; ctx.lineWidth = sw; ctx.lineJoin = 'round'; ctx.miterLimit = 2; }

    const cw = ctx.measureText(ch).width;
    // 英文/数字连成一串，整串顺时针转 90° 写，读起来才是正的
    if (cell.latin || V_ROTATE.includes(ch)){
      ctx.save();
      ctx.translate(gx + sz * 0.5, cy);
      ctx.rotate(Math.PI / 2);
      if (sw > 0) ctx.strokeText(ch, 0, -sz * 0.5);
      ctx.fillText(ch, 0, -sz * 0.5);
      ctx.restore();
    } else if (V_CORNER.includes(ch)){
      // 句读在竖排里坐格子的右上角
      const px = gx + sz * 0.42, py = cy - sz * 0.42;
      if (sw > 0) ctx.strokeText(ch, px, py);
      ctx.fillText(ch, px, py);
    } else {
      const px = gx + (sz - cw) / 2;
      if (sw > 0) ctx.strokeText(ch, px, cy);
      ctx.fillText(ch, px, cy);
    }
    if (Q_CLOSE.includes(ch)) depth = Math.max(0, depth - 1);
    ctx.globalAlpha = keep;
    cy += cell.latin ? cw : sz;
  }
  return cy - y;
}

const CN = '〇一二三四五六七八九';
function cnNum(n){
  if (n <= 10) return n === 10 ? '十' : CN[n];
  if (n < 20)  return '十' + CN[n-10];
  return CN[Math.floor(n/10)] + '十' + (n%10 ? CN[n%10] : '');
}

// ════════════════════════════════════════════════════════════════════
//  4b. 局部样式：选中的那几个字，单独的字号 / 字体 / 颜色 / 粗细 / 浓淡
// ════════════════════════════════════════════════════════════════════
// 存法：[{ s, e, size?, font?, ink?, weight? }]，s/e 是**原文**里的下标（左闭右开）。
// 没写的那几项＝跟着整篇走。它是内容不是版式，所以不进 STYLE_KEYS ——
// 换一套版式，已经单独改过的字不该跟着变。
// 字号是绝对像素，理由跟标题一样：按百分比算的话，一动正文字号它就跟着跑。
//
// 编辑期一律摊成「逐字一格」再收回来。几千字的文章摊开也就几千格，
// 换来的是：重叠、拆分、合并、插字、删字全都只有一种写法。
const SPAN_KEYS = ['size', 'font', 'ink', 'weight', 'alpha'];

function spanStyle(o){
  const r = {};
  if (Number.isFinite(+o.size) && +o.size > 0) r.size = Math.max(12, Math.min(300, Math.round(+o.size)));
  if (typeof o.font === 'string' && o.font && o.font !== 'same') r.font = o.font;
  if (typeof o.ink  === 'string' && o.ink  && o.ink  !== 'same') r.ink  = o.ink;
  if (o.weight === 0 || o.weight === 1 || o.weight === 2) r.weight = o.weight;
  if (typeof o.alpha === 'number' && o.alpha >= 0 && o.alpha < 1) r.alpha = Math.max(.05, Math.round(o.alpha * 100) / 100);      // 1 ＝ 不淡，等于没改
  return Object.keys(r).length ? r : null;
}
const sameMark = (a, b) => a === b || (!!a && !!b && SPAN_KEYS.every(k => a[k] === b[k]));

function spansToMarks(spans, len){
  const marks = new Array(len).fill(null);
  for (const sp of Array.isArray(spans) ? spans : []){
    const m = sp && spanStyle(sp);
    if (!m) continue;
    const s = Math.max(0, sp.s | 0), e = Math.min(len, sp.e | 0);
    for (let i = s; i < e; i++) marks[i] = marks[i] ? { ...marks[i], ...m } : m;
  }
  return marks;
}
function marksToSpans(marks){
  const out = [];
  for (let i = 0; i < marks.length;){
    let j = i + 1;
    while (j < marks.length && sameMark(marks[i], marks[j])) j++;
    if (marks[i]) out.push({ s: i, e: j, ...marks[i] });
    i = j;
  }
  return out;
}

// 给 [s,e) 盖一层样式。patch 里某项给 null ＝ 把那一项还给整篇。
function paintSpans(spans, len, s, e, patch){
  const marks = spansToMarks(spans, len);
  for (let i = Math.max(0, s); i < Math.min(len, e); i++){
    const m = { ...(marks[i] || {}) };
    for (const k of SPAN_KEYS) if (k in patch){ if (patch[k] == null) delete m[k]; else m[k] = patch[k]; }
    marks[i] = spanStyle(m);
  }
  return marksToSpans(marks);
}

// 改了字之后，样式要跟着自己的字走。caret ＝ 改完之后光标在哪 ——
// 「啊啊啊」里再敲一个「啊」，光看前后文分不出敲在第几个，得靠光标说了算。
// 规矩：在一截改过样式的字**中间**插字，跟着那一截；贴着它的尾巴往后写，不跟
// （改的是「选中的那几个字」，不是从此以后）。选中一截直接打字替换，跟被换掉的首字。
function shiftSpans(spans, oldText, newText, caret){
  if (!spans || !spans.length || oldText === newText) return spans || [];
  const ol = oldText.length, nl = newText.length;
  const c = caret == null ? nl : Math.max(0, Math.min(nl, caret));
  let suf = 0;
  const sufMax = Math.min(ol, nl - c);
  while (suf < sufMax && oldText[ol - 1 - suf] === newText[nl - 1 - suf]) suf++;
  let pre = 0;
  const preMax = Math.min(ol, nl) - suf;
  while (pre < preMax && oldText[pre] === newText[pre]) pre++;
  const marks = spansToMarks(spans, ol);
  const cut = ol - suf - pre, add = nl - suf - pre;       // 旧的去掉几个、新的添几个
  const left = marks[pre - 1] || null, right = marks[pre] || null;
  const carry = cut > 0 ? right : (sameMark(left, right) ? right : null);
  marks.splice(pre, cut, ...new Array(add).fill(carry));
  return marksToSpans(marks);
}

// 选中这一段眼下是什么样。某一项不统一时，mixed 里记一笔。
function spanCommon(spans, len, s, e){
  const marks = spansToMarks(spans, len).slice(s, e);
  const out = { mixed: {}, any: marks.some(Boolean) };
  for (const k of SPAN_KEYS){
    const v0 = marks[0] ? marks[0][k] : undefined;
    if (marks.every(m => (m ? m[k] : undefined) === v0)) out[k] = v0; else out.mixed[k] = true;
  }
  return out;
}

// 排版用：原文 → 逐字的「落定样式」。一处都没单独改过就返回 null，走老路，一个像素不动。
// base = { size, stack, weight }，就是整篇（或标题）自己的样子。
function richOf(spans, len, base, st){
  const marks = spansToMarks(spans, len);
  if (!marks.some(Boolean)) return null;
  const plain = { size: base.size, stack: base.stack, ink: null,
                  stroke: strokeFor(base.weight, base.size), plain: true };
  const seen = new Map();
  return marks.map(m => {
    if (!m) return plain;
    const key = JSON.stringify(SPAN_KEYS.map(k => m[k]));
    if (!seen.has(key)){
      const size = m.size || base.size;
      const weight = m.weight === undefined ? base.weight : m.weight;
      seen.set(key, { size, stack: m.font ? pickStack(m.font, st, base.stack) : base.stack,
                      ink: m.ink ? inkOf(m.ink) : null, stroke: strokeFor(weight, size), alpha: m.alpha });
    }
    return seen.get(key);
  });
}
// 截一行的样式。整行都没改过就给 null —— 老路画出来的才是从前那一行。
const sliceRich = (rich, a, b) => {
  if (!rich) return null;
  const r = rich.slice(a, b);
  return r.some(x => !x.plain) ? r : null;
};
const maxSize = (rich, size) => rich && rich.length ? rich.reduce((m, x) => Math.max(m, x.size), 0) : size;
const styleFont = s => `${s.size}px ${s.stack}`;

// ════════════════════════════════════════════════════════════════════
//  5. 分页
//     把正文压成一串「块」（行 / 段间空档），再按页容量流进若干张纸。
// ════════════════════════════════════════════════════════════════════
// cross = 与流动方向垂直的那条边：横排时是版心宽，竖排时是版心高。
// 两种排法都吐出同样形状的 items（一行 / 一列），所以下面的分页算法一字不用改。
//
// rich ＝ 原文逐字的样式（spans.js 的 richOf），没有就是 null。
function splitParas(text){
  // 空行＝分段（段间留空档）；单个换行＝硬换行（照断，不留空档）。
  // 每一行都记着自己在原文里的起点 at —— 局部样式按原文下标存，靠它对上号。
  const paras = []; let from = 0;
  for (const raw of text.split(/(\n{2,})/)){
    let at = from; from += raw.length;
    if (/^\n{2,}$/.test(raw)) continue;
    const parts = raw.split('\n');
    const lines = parts.map((s, i) => {
      const ln = { at, text: i < parts.length - 1 ? s.replace(/[ \t]+$/, '') : s };
      at += s.length + 1;
      return ln;
    });
    // 整段首尾的空白去掉（连带首尾的空行）
    while (lines.length && !lines[0].text.trim()) lines.shift();
    while (lines.length && !lines[lines.length-1].text.trim()) lines.pop();
    if (!lines.length) continue;
    const head = lines[0], tail = lines[lines.length-1];
    const t = head.text.trimStart(); head.at += head.text.length - t.length; head.text = t;
    tail.text = tail.text.trimEnd();
    paras.push(lines);
  }
  return paras;
}

function buildItems(ctx, text, cross, fontSize, vertical, rich){
  const LH = Math.round(fontSize * 1.72), GAP = Math.round(fontSize * .62);
  const font = ctx.font;
  const items = [];
  // 🔴 早先段内的单换行被 replace 抹掉了 —— 用户敲的回车在纸上凭空消失。
  splitParas(text).forEach((lines, i) => {
    if (i) items.push({ gap: true, h: GAP });
    for (const { text: hard, at } of lines){
      if (!hard.trim()){ items.push({ gap: true, h: LH }); continue; }   // 段内空行＝空一行
      items.push(...flowRows(ctx, hard, sliceRich(rich, at, at + hard.length),
                             { size: fontSize, cross, vertical, lead: 1.72, font, from: at }));
    }
  });
  return { items, LH, GAP };
}

// 一段不含换行的字 → 若干行（或竖排的列）。正文和标题都走这里。
// 行高跟着这一行里最大的字走：一行里有个大字，这一行就让出大字的高度，别的行不动。
function flowRows(ctx, str, rich, { size, cross, vertical, lead, font, from = 0 }){
  ctx.font = font;
  const parts = vertical ? wrapVertical(str, size, cross, ctx, null, rich) : wrap(ctx, str, cross, 0, rich);
  let at = 0;
  return parts.map(text => {
    const r = sliceRich(rich, at, at + text.length);
    const row = { text, h: Math.round(maxSize(r, size) * lead), at: from + at };
    at += text.length;
    if (r) row.rich = r;
    return row;
  });
}

// 贪心装箱；forceN 时按「剩余高度 / 剩余页数」均摊，让几页看起来一样满
function paginate(items, cap, forceN){
  const fill = capacity => {
    const total = items.reduce((a, it) => a + it.h, 0);
    const pages = [];
    let cur = [], curH = 0;
    let done = 0;      // 🔴 只能是「已翻篇的页」的高度。
                       //    把当前这页也算进去的话，目标高度会边填边缩，
                       //    前几页越切越早，剩下的全砸给最后一页（10/10/20 那个 bug）。
    for (let i = 0; i < items.length; i++){
      const it = items[i];
      const pagesLeft = forceN ? forceN - pages.length : Infinity;
      const target    = forceN ? (total - done) / Math.max(1, pagesLeft) : Infinity;
      const itemsLeft = items.length - i;
      const overflow  = curH + it.h > capacity;
      // 过了均摊线就翻篇，但要留够条目给后面的页，不然会凑不满 N 张
      const evened    = forceN && pagesLeft > 1 && curH > 0 && curH + it.h/2 > target;
      const mustBreak = forceN && pagesLeft > 1 && itemsLeft <= pagesLeft;
      if (cur.length && (overflow || evened || mustBreak)){
        pages.push(cur); done += curH; cur = []; curH = 0;
      }
      if (!cur.length && it.gap) continue;                   // 页首不留空档
      cur.push(it); curH += it.h;
    }
    if (cur.length) pages.push(cur);
    return pages;
  };

  let pages = fill(cap), grown = cap;
  // 页数被指定、但这么点高度装不下 —— 把每页一起加高，而不是偷偷多出一页
  while (forceN && pages.length > forceN && grown < cap * 12){
    grown = Math.ceil(grown * 1.12);
    pages = fill(grown);
  }
  return { pages, capacity: grown };
}

// ════════════════════════════════════════════════════════════════════
//  6. 画一页
// ════════════════════════════════════════════════════════════════════
// 标题字号：绝对像素，跟正文字号互不相干。夹一道上下限，别让旧值或手输的数字画出鬼来。
const titleFontSize = st => Math.max(12, Math.min(300, Math.round(st.titleSize || DEF.titleSize)));

// 标题排好之后占多高。只印第一页，但**每页都按它预留**——
// 各页版心一样高，正文垂直居中才对得齐，也绝不会溢出。
function titleBlock(st, COL, availH, mk){
  const raw = st.title || '', t = raw.trim();
  if (!t) return { lines: [], rows: [], h: 0, w: 0, size: 0, lh: 0, vertical: false };
  const size = titleFontSize(st);
  const lh = Math.round(size * 1.42);
  const ctx = (mk || newMeasure)();
  // 🔴 latinFont 必须显式从 st 传：不传的话 fontStack 会去读存储里的配置，
  //    当前状态被无声忽略 —— 会变成「选了西文字体却没反应」。
  const stack = titleStack(st), font = `${size}px ${stack}`;
  const rich = richOf(st.titleSpans, raw.length, { size, stack, weight: st.titleWeight }, st);
  const lead0 = raw.length - raw.trimStart().length;      // 下标是按没去空白的原串记的
  const flow = opt => [...t.matchAll(/[^\n]+/g)].flatMap(m =>
    flowRows(ctx, m[0], sliceRich(rich, lead0 + m.index, lead0 + m.index + m[0].length),
             { size, lead: 1.42, font, ...opt }));
  const sum = rows => rows.reduce((a, r) => a + r.h, 0);
  // 标题的排向跟正文分开定：竖排正文配横标题是常见排法，配竖标题也是，让用户自己挑
  if (st.titleVertical){
    const rows = flow({ vertical: true, cross: availH || 600 });
    const longest = rows.reduce((a, r) => { ctx.font = font; return Math.max(a, vAdvance(ctx, r.text, size, r.rich)); }, 0);
    return { lines: rows.map(r => r.text), rows, vertical: true, size, lh,
             w: sum(rows) + Math.round(size * 0.6),
             h: longest + Math.round(size * 0.9) };
  }
  const rows = flow({ vertical: false, cross: COL });
  return { lines: rows.map(r => r.text), rows, vertical: false, size, lh, w: COL,
           h: sum(rows) + Math.round(size * 0.9) };
}

// 版心之外那些固定占位。竖排时题头/出处/日期是竖着排在左右两侧的，
// 所以它们吃掉的是**横向**空间（headW/metaW），不是纵向。
const HEAD_SZ = 22, SRC_SZ = 26, DATE_SZ = 21;

// 题头和出处都不限字数，所以它们的占位必须按**实际折出来多少行/多少列**算，
// 不能写死。写死的后果是字一长就冲出版心。
function chrome(st, COL, availH, mk){
  const tb = titleBlock(st, COL, availH, mk);
  const head = st.showHeader ? (st.headText || '').trim() : '';
  const src  = st.showSource ? (st.source || '').trim() : '';
  const date = st.showDate ? (st.date || '').trim() : '';
  const ctx = (mk || newMeasure)();
  const stack = st.stack || fontStack(st.font, st.latinFont);

  if (st.vertical){
    const colH = (availH || 600) - (tb.vertical ? 0 : tb.h);
    ctx.font = `${HEAD_SZ + 2}px ${stack}`;
    const headCols = head ? wrapVertical(head.replace(/\s+/g, ''), HEAD_SZ + 2, colH, ctx) : [];
    ctx.font = `${SRC_SZ - 2}px ${stack}`;
    const srcCols  = src  ? wrapVertical((st.sourcePrefix || '') + src, SRC_SZ - 2, colH, ctx) : [];
    ctx.font = `${DATE_SZ}px ${stack}`;
    const dateCols = date ? wrapVertical(date, DATE_SZ, colH, ctx) : [];
    return {
      title : tb.vertical ? 0 : tb.h,
      titleW: tb.vertical ? tb.w : 0,
      headW : headCols.length ? headCols.length * 34 + 30 : 0,
      metaW : (srcCols.length + dateCols.length)
              ? srcCols.length * 38 + dateCols.length * 32 + 24 : 0,
      headCols, srcCols, dateCols,
      head: 0, src: 0, foot: 0 };
  }

  ctx.font = `${HEAD_SZ}px ${stack}`;
  const headLines = head ? wrap(ctx, head, COL, 5) : [];
  ctx.font = `${SRC_SZ}px ${stack}`;
  const srcLines = src ? wrap(ctx, (st.sourcePrefix || '') + src, COL, 1.4) : [];
  return { title: tb.h, titleW: 0,
    head: st.showHeader ? (headLines.length * 30 + 50) : 24,
    src : srcLines.length ? srcLines.length * 36 + 56 : 0,
    foot: 128,
    headLines, srcLines,
    headW: 0, metaW: 0 };
}

function planPages(st, mk){
  if (st.blind){ const p = planBlind(st, mk); if (p) return p; }     // 没有字可排就照常
  const S = SIZES[st.orient] || SIZES.portrait;
  const COL0 = S.w - S.pad * 2;
  const stack = st.stack || fontStack(st.font, st.latinFont);      // st.stack：盲盒内页直接给定字体栈
  const probe = (mk || newMeasure)();
  // 竖标题的列长受版心高度限制，而版心高度又要先知道标题占多少 —— 先按整页高度估一轮
  const ch = chrome(st, COL0, S.h - S.pad*2, mk);
  // 🔴 正文字号必须设在 chrome() **之后**：chrome 量题头/出处时会把 font 改成 22/26px，
  //    共用同一块量具的话，先设就被它改掉了 —— 正文会按 22px 折行，静默错到底。
  probe.font = `${st.fontSize}px ${stack}`;
  // 版心高度。按最坏情况留（题头、标题、出处都按每页都在算）：牺牲一点留白，换绝不溢出
  const box0 = S.h - S.pad*2 - ch.head - ch.title - ch.src - ch.foot;
  const rich = richOf(st.spans, st.text.length, { size: st.fontSize, stack, weight: st.weight }, st);
  const { items } = buildItems(probe, st.text, st.vertical ? box0 : COL0, st.fontSize, st.vertical, rich);
  // 横排流向是往下，装不下就加高；竖排流向是往左，装不下就加宽
  const cap0 = st.vertical ? (COL0 - ch.headW - ch.titleW - ch.metaW) : box0;
  const forceN = st.pages === 'auto' ? 0 : Math.max(1, parseInt(st.pages, 10) || 1);
  const { pages, capacity } = paginate(items, Math.max(cap0, 120), forceN);
  const grow = Math.max(0, capacity - cap0);
  const W = S.w + (st.vertical ? grow : 0);
  const H = S.h + (st.vertical ? 0 : grow);
  return { S, W, H, COL: W - S.pad*2, box: box0, stack, ch,
           pages: pages.length ? pages : [[]], title: titleBlock(st, COL0, S.h - S.pad*2, mk) };
}

// 对齐永远是在版心里对齐，不是贴到纸边
// 夹到 ≥0：万一还有哪条线比版心宽，也只会顶到版心左边，绝不会跑出去
const alignOffset = (align, avail, used) => Math.max(0,
  align === 'center' ? (avail - used) / 2 : align === 'right' ? (avail - used) : 0);

// 铺纸。图还没解码完就先拿宣纸垫着。
const groundPhoto = st => st.paper.startsWith('pk:') ? packImg(st.paper.slice(3), st.orient)
                        : st.paper.startsWith('my:') ? myPaper(st.paper.slice(3)) : null;
function drawGround(ctx, st, W, H, idx){
  const photo = groundPhoto(st);
  if (!(photo && drawCover(ctx, photo, W, H))) ctx.drawImage(makePaper(photo ? 'rice' : st.paper, W, H, idx), 0, 0);

  // 纸张明暗：盖一层白/黑。alpha 与 shade() 用的是同一个 t，两边算出来的颜色一致。
  const pl = (st.paperLight || 0) / 100;
  if (pl){
    ctx.fillStyle = pl > 0 ? `rgba(255,255,255,${pl})` : `rgba(0,0,0,${-pl})`;
    ctx.fillRect(0, 0, W, H);
  }
}

function renderPage(canvas, st, plan, idx){
  if (plan.blind) return renderBlind(canvas, st, plan, idx);
  const { S, W, H, COL, box, stack, pages, ch, title } = plan;
  const ctx = canvas.getContext('2d');
  const ink = inkColorOf(st);
  const last = idx === pages.length - 1;
  const many = pages.length > 1;

  // 纸深了就把辅助元素一起提亮，否则页码日期分隔线全沉进纸里。
  // 判据必须用「调完亮度之后」的纸色，不然纸调暗了这些还留在浅色上。
  const mean = paperMean(st.paper, st.paperLight);
  const dark = relLum(mean) < 0.34;
  // 题头/出处/日期/线的颜色：auto 就跟着纸深浅走，指定了就用指定的
  const custom = st.metaInk && st.metaInk !== 'auto' ? inkOf(st.metaInk) : null;
  const grey = custom || (dark ? 'rgba(248,245,238,.62)' : GREY);
  const rule = custom ? custom + '66' : (dark ? 'rgba(248,245,238,.30)' : RULE);
  // 引号里那段话的颜色。跟 metaInk 一个套路：auto 跟着纸深浅走，指定了就用指定的。
  // 多一个 same＝跟正文一个色，也就是「不要引号变色」——有人就是不想要那抹橙。
  const quote = st.quoteInk === 'same' ? ink
              : (st.quoteInk && st.quoteInk !== 'auto') ? inkOf(st.quoteInk)
              : (dark ? QUOTE_ON_DARK : QUOTE);

  canvas.width = W * DPR; canvas.height = H * DPR;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

  if (st.noGround){ /* 透明底：什么都不铺 */ }
  else if (plan.ground) plan.ground(ctx, idx);      // 盲盒的内页：跟封面同一张底
  else drawGround(ctx, st, W, H, idx);

  ctx.textBaseline = 'top';
  let y = S.pad;

  // 横排的题头在顶上；竖排的题头立在右边（下面竖排那一段里画）
  if (st.showHeader && !st.vertical && ch.headLines && ch.headLines.length){
    ctx.font = `${HEAD_SZ}px ${stack}`; ctx.fillStyle = grey;
    let hy = y;
    for (const ln of ch.headLines){ tracked(ctx, S.pad, hy, ln, 5); hy += 30; }
    if (st.headRule !== false){ ctx.fillStyle = rule; ctx.fillRect(S.pad, hy + 14, COL, 1); }
  }
  y += ch.head;

  // 每画一行都先把 font 设回来：有局部样式的行会把它改掉
  const titleFont = `${title.size}px ${titleStack(st)}`;
  const bodyFont  = `${st.fontSize}px ${stack}`;

  // 标题：只印第一页。横排正文时它占顶上那条带（横竖两种排向都在这条带里画）
  if (ch.title){
    if (idx === 0){
      const tsw = strokeFor(st.titleWeight, title.size);
      if (title.vertical){
        // 竖标题立在这条带里，列从右往左；titleAlign 管这一叠列往哪边靠
        const bw = title.rows.reduce((a, r) => a + r.h, 0);
        let tx = S.pad + alignOffset(st.titleAlign, COL, bw) + bw, tqd = 0;
        for (const row of title.rows){
          tx -= row.h;
          ctx.font = titleFont;
          drawColumn(ctx, tx, y, row.text, title.size, ink, quote, tsw, tqd, row.rich);
          tqd = quoteDepthAfter(row.text, tqd);
        }
        if (st.titleRule !== false){
          ctx.fillStyle = rule;
          ctx.fillRect(S.pad + alignOffset(st.titleAlign, COL, bw) - Math.round(title.size*0.34),
                       y, 1, ch.title - Math.round(title.size * 0.5));
        }
      } else {
        let ty = y, tqd = 0;
        for (const row of title.rows){
          ctx.font = titleFont;
          const w = textWidth(ctx, row.text, row.rich);
          drawRich(ctx, S.pad + alignOffset(st.titleAlign, COL, w), ty, row.text, ink, quote, tsw, tqd, row.rich);
          tqd = quoteDepthAfter(row.text, tqd);
          ty += row.h;
        }
        // 标题下的短横跟着标题走，不然居左的标题配居中的横线会很怪
        if (st.titleRule !== false){
          const rw = 88, rx = S.pad + alignOffset(st.titleAlign, COL, rw);
          ctx.fillStyle = rule;
          ctx.fillRect(rx, ty + Math.round(title.size * 0.30), rw, 1);
        }
      }
    }
    y += ch.title;
  }

  // 正文块在版心里居中。横版尤其需要 —— 顶对齐的话字全挤在上面，下面空一大片。
  // 各页用同一个版心尺寸，所以整叠看起来是齐的。
  const used = pages[idx].reduce((a, it) => a + it.h, 0);
  const ox = st.offsetX || 0, oy = st.offsetY || 0;
  const sw = strokeFor(st.weight, st.fontSize);

  if (st.vertical){
    // 竖排：从右往左依次是 题头 → 竖标题 → 正文 → 出处日期。
    const bandR = S.pad + COL - ch.headW - ch.titleW;   // 正文右界
    const bandL = S.pad + ch.metaW;                     // 正文左界
    const band  = bandR - bandL;
    const top   = S.pad + ch.title;
    const colH  = box;

    if (ch.headW && ch.headCols){
      ctx.font = `${HEAD_SZ + 2}px ${stack}`;
      let hx = S.pad + COL - 34;
      for (const c of ch.headCols){ drawColumn(ctx, hx, top, c, HEAD_SZ + 2, grey, grey, 0); hx -= 34; }
      if (st.headRule !== false){
        ctx.fillStyle = rule;
        ctx.fillRect(S.pad + COL - ch.headW, top, 1, colH);
      }
    }

    // 竖标题自成一栏，紧挨着题头的左边
    if (idx === 0 && ch.titleW){
      const tsw = strokeFor(st.titleWeight, title.size);
      let tx = S.pad + COL - ch.headW - Math.round(title.size * 0.3), tqd = 0;
      for (const row of title.rows){
        tx -= row.h;
        ctx.font = titleFont;
        const h = vAdvance(ctx, row.text, title.size, row.rich);
        ctx.font = titleFont;
        drawColumn(ctx, tx, top + alignOffset(st.titleAlign, colH, h),
                   row.text, title.size, ink, quote, tsw, tqd, row.rich);
        tqd = quoteDepthAfter(row.text, tqd);
      }
      if (st.titleRule !== false){ ctx.fillStyle = rule; ctx.fillRect(bandR, top, 1, colH); }
    }

    let x = bandR - Math.max(0, (band - used) / 2) + ox;
    let qd = quoteDepthAtPage(pages, idx);
    for (const it of pages[idx]){
      x -= it.h;
      if (it.gap){ qd = 0; continue; }
      ctx.font = bodyFont;
      const h = vAdvance(ctx, it.text, st.fontSize, it.rich);
      const cy = top + alignOffset(st.align, colH, h) + oy;
      drawColumn(ctx, x, cy, it.text, st.fontSize, ink, quote, sw, qd, it.rich);
      qd = quoteDepthAfter(it.text, qd);
    }

    if (ch.metaW){
      if (st.footRule !== false){ ctx.fillStyle = rule; ctx.fillRect(bandL, top, 1, colH); }
      let mx = S.pad + ch.metaW - 34;
      if (last && ch.srcCols){
        ctx.font = `${SRC_SZ - 2}px ${stack}`;
        for (const c of ch.srcCols){ drawColumn(ctx, mx, top, c, SRC_SZ - 2, grey, grey, 0); mx -= 38; }
      } else if (ch.srcCols) mx -= ch.srcCols.length * 38;
      if (ch.dateCols){
        ctx.font = `${DATE_SZ}px ${stack}`;
        for (const c of ch.dateCols){ drawColumn(ctx, mx, top, c, DATE_SZ, grey, grey, 0); mx -= 32; }
      }
    }
    if (many){
      ctx.font = `21px ${stack}`; ctx.fillStyle = grey;
      const t = `${cnNum(idx+1)} / ${cnNum(pages.length)}`;
      drawColumn(ctx, S.pad + COL - 40, H - S.pad - trackedWidth(ctx, t, 0) - 10, t, 21, grey, grey, 0);
    }
    return;                                    // 竖排的页眉页脚已经画完，别再走横排那套
  } else {
    y += Math.max(0, (box - used) / 2) + oy;
    let qd = quoteDepthAtPage(pages, idx);
    for (const it of pages[idx]){
      if (it.gap) qd = 0;                      // 换段就把没闭合的引号忘掉
      else {
        ctx.font = bodyFont;
        const w = textWidth(ctx, it.text, it.rich);
        drawRich(ctx, S.pad + alignOffset(st.align, COL, w) + ox, y, it.text, ink, quote, sw, qd, it.rich);
        qd = quoteDepthAfter(it.text, qd);
      }
      y += it.h;
    }
  }

  // 出处只印最后一页。前面那个符号是自己填的，想删就把那栏清空。多行时逐行右对齐。
  if (last && ch.src && ch.srcLines){
    ctx.font = `${SRC_SZ}px ${stack}`; ctx.fillStyle = grey;
    let sy = H - S.pad - ch.foot - ch.src + 20;
    for (const ln of ch.srcLines){
      tracked(ctx, S.pad + COL - trackedWidth(ctx, ln, 1.4), sy, ln, 1.4);
      sy += 36;
    }
  }

  const fy = H - S.pad - 46;
  if (st.footRule !== false){ ctx.fillStyle = rule; ctx.fillRect(S.pad, fy - 34, COL, 1); }
  ctx.font = `21px ${stack}`; ctx.fillStyle = grey;
  if (st.showDate && st.date.trim()) tracked(ctx, S.pad, fy, st.date.trim(), 2.2);
  if (many){
    const t = `${cnNum(idx+1)} / ${cnNum(pages.length)}`;
    tracked(ctx, S.pad + COL/2 - trackedWidth(ctx, t, 2)/2, fy, t, 2);
  }
}

// ════════════════════════════════════════════════════════════════════
//  9. 版式盲盒 ① 读字：断句、挑主角、挑字体、挑配色
// ════════════════════════════════════════════════════════════════════
// 盲盒 = 一颗种子 → 一张字体海报。同一颗种子、同一段字，永远拆出同一张，
// 所以能往回翻、能收藏。全部随机都走传进来的 rnd，别在这几个文件里碰 Math.random。
// 三条规矩（改的时候别破）：
//   1. 一个字都不丢 —— 每种构图排完要过 blindKeepsAll，漏字就作废换下一种；
//   2. 字上的效果只落在主字上，正文那一层不单独加工（整张修图的时候，它跟着一起过）；
//   3. 没有任何素材，也没有图形：盲盒只玩字。人想加图形，自己添。
const B_PUNCT = /^[\s，。、；：？！…—～·,.;:?!"'“”‘’「」『』（）()《》〈〉【】[\]–\-*#]+$/;

// 一段字拆成一个个「单位」：一个汉字算一个，一个英文词算一个。
function bUnits(str){
  const out = []; let at = 0, high = '';
  for (const tok of tokenize(str)){
    const t = high + tok, start = at - high.length;
    at += tok.length; high = '';
    if (/^[\uD800-\uDBFF]$/.test(tok)){ high = tok; continue; }     // 表情是两个半截，拼回一个
    if (/^\s+$/.test(t)) continue;
    const latin = /^[A-Za-z0-9]/.test(t), prev = out[out.length - 1];
    out.push({ t, at: start, latin, punct: B_PUNCT.test(t),
               sp: latin && !!prev && /\s/.test(str.slice(prev.at + prev.t.length, start)) });
  }
  return out;
}
// 断成一小句一小句。收尾的句号逗号扔掉（大字带着它们很难看），问叹省略留下。
function bClauses(text){
  const out = []; let cur = null;
  const close = () => { if (cur && cur.units.length) out.push(cur); cur = null; };
  let last = -1;
  for (const u of bUnits(text)){
    const gap = last >= 0 ? text.slice(last, u.at) : '';
    last = u.at + u.t.length;
    if (/\n/.test(gap)) close();
    if (u.punct){
      if (cur && /^[？！?!…]$/.test(u.t)) { cur.tail += u.t; }
      else if (cur && !/^[-'’·]$/.test(u.t)) close();
      continue;
    }
    if (cur && cur.tail) close();
    if (!cur) cur = { units: [], at: u.at, tail: '' };
    cur.units.push(u);
  }
  close();
  for (const c of out){
    c.n = c.units.length;
    c.t = c.units.map((u, i) => (i && u.sp ? ' ' : '') + u.t).join('');
    c.full = c.tail ? c.units.concat([...c.tail].map(t => ({ t, punct: true }))) : c.units;
  }
  return out;
}

const B_STOP = new Set([...'的了是在我你他她它们这那和与就也都不有没很又再把被让给到从向对于而且但或之其着过吗呢吧啊呀哦哪什么怎一个上下里来去说要会能可以还只才因为所以如果虽然已经自己什么时候没有我们你们他们']);
function bWords(text){
  const keep = [];
  try {
    const seg = new Intl.Segmenter('zh', { granularity: 'word' });
    for (const s of seg.segment(text)){
      const w = s.segment;
      if (!s.isWordLike || /^[A-Za-z0-9]/.test(w)) continue;
      const len = [...w].length;
      if (len < 1 || len > 2) continue;
      if ([...w].every(c => B_STOP.has(c))) continue;
      if (len === 1 && B_STOP.has(w)) continue;
      keep.push({ t: w, w: len === 2 ? 3 : 2 });
    }
  } catch {}
  return keep;
}
const B_THIN = '一二三十丁了人入八小不卜刁几儿乙厂';
const bDense = t => [...t].find(c => !B_THIN.includes(c)) || null;
function bWeighted(rnd, list){
  const sum = list.reduce((a, x) => a + (x.w || 1), 0);
  let r = rnd() * sum;
  for (const x of list){ r -= (x.w || 1); if (r <= 0) return x; }
  return list[list.length - 1];
}
// 这一小句单拎出来像不像话
function bJudge(src, c){
  const end = c.units[c.n - 1], a = src[c.at - 1] || '\n', b = src[end.at + end.t.length] || '\n'; let k = 1;
  if (a === '、' || b === '、') k *= .08;                                        // 列举里的一项，是半截话
  if (/[。！？!?…\n「『“]/.test(a) && /[。！？!?…\n」』”]/.test(b)) k *= 2.2;      // 自己就是完整的一句
  if (/[：:「『“]/.test(b)) k *= .12;                                             // 「它没有说」后头还有话
  if (/^[它他她这那]/.test(c.t)) k *= .7;
  if (/[「『“]/.test(src.slice(Math.max(0, src.lastIndexOf('\n', c.at - 1)), c.at))) k *= 1.8;   // 引语
  if (/^(而|却|但|并|也|又|且|因|所以|于是|如果|那么|虽|只是|甚至|尤其|反而|面对|来证明)/.test(c.t)) k *= .25;
  if (/(的|了|着|地|得|是|在|把|被|和|与|说|指出)$/.test(c.t)) k *= .35;
  if (src.length - end.at < src.length * .08) k *= 1.6;                           // 收尾那一句
  return k;
}
// 主角：你自己选中改过样式的字最优先，其次标题，其次正文里一小句。
function bHero(st, clauses, rnd){
  const cands = [];
  for (const sp of spansOfText(st.spans, st.text)) {
    const units = bUnits(sp.t).filter(u => !u.punct).map(u => ({ ...u, at: u.at + sp.at }));
    if (units.length >= 1 && units.length <= 12) cands.push({ t: sp.t, units, w: 14 });
  }
  const title = (st.title || '').trim();
  if (title){
    const units = bUnits(title).filter(u => !u.punct).map(u => ({ ...u, src: 'title' }));
    if (units.length && units.length <= 12) cands.push({ t: title, units, w: 5, title: true });
  }
  const src = st.text || '', many = clauses.length > 6, judge = c => many ? bJudge(src, c) : 1;
  for (const c of clauses)
    if (c.n >= 2 && c.n <= (many ? 12 : 10)) cands.push({ t: c.t, units: c.units, w: (c.n <= 7 ? 2 : many ? 1.5 : 1) * (c.n < 4 && many ? .5 : 1) * judge(c) });
  // 整句太长的，从句尾往回取几个词（「……肩上那一点没化的雪」取「没化的雪」）
  for (const c of clauses) if (c.n > 10 && (!many || bJudge(src, c) > 1.5)){      // 长文里只有引语、独句才值得从尾巴上取
    try {
      const ws = [...new Intl.Segmenter('zh', { granularity: 'word' }).segment(c.t)].map(q => q.segment).filter(q => q.trim()); let n = 0;
      for (let i = ws.length - 1; i > 0; i--){
        n += bUnits(ws[i]).length; if (n > 8) break;
        if (n >= 2 && !B_STOP.has(ws[i][0])) cands.push({ t: c.units.slice(-n).map((u, q) => (q && u.sp ? ' ' : '') + u.t).join(''), units: c.units.slice(-n), w: (n >= 3 && n <= 6 ? 2 : 1) * (many ? (n < 4 ? .15 : .6) : 1) });
      }
    } catch {}
  }
  if (!cands.length && clauses.length){
    const c = clauses.reduce((a, b) => (b.n < a.n ? b : a));
    cands.push({ t: c.units.slice(0, 8).map((u, q) => (q && u.sp ? ' ' : '') + u.t).join(''), units: c.units.slice(0, 8), w: 1 });
  }
  return cands.length ? bWeighted(rnd, cands) : null;
}
function spansOfText(spans, text){
  return marksToSpans(spansToMarks(spans, text.length)).map(s => { const raw = text.slice(s.s, s.e); return { t: raw.trim(), at: s.s + raw.length - raw.trimStart().length }; }).filter(s => s.t);
}

// ── 字体 ────────────────────────────────────────────────────────────
// 有的字库只收了常用字（或只收繁体），缺的字会悄悄落回宋体 —— 一句大字里混两款，
// 一眼就脏。所以挑之前真画出来比：跟系统宋体画得一模一样，就是它没有这个字。
const bGlyphCache = new Map(), B_CELL = 22;
let bBaseStrip = { key: '', data: null };
function bHasGlyphs(family, text){
  const chars = [...new Set(text)].filter(c => c >= '㐀' && c <= '鿿').slice(0, 160), todo = chars.filter(ch => !bGlyphCache.has(family + '\u0000' + ch));
  try {
    if (todo.length){
      const cv = PLATFORM.canvas(B_CELL * todo.length, B_CELL), c = cv.getContext('2d', { willReadFrequently: true }); if (!c.getImageData) return true;
      const strip = font => { c.clearRect(0, 0, cv.width, cv.height); c.font = font; c.textBaseline = 'top'; todo.forEach((ch, i) => { c.save(); c.beginPath(); c.rect(i * B_CELL, 0, B_CELL, B_CELL); c.clip(); c.fillText(ch, i * B_CELL + 1, 1); c.restore(); }); return c.getImageData(0, 0, cv.width, cv.height).data; };
      const key = todo.join(''), base = bBaseStrip.key === key ? bBaseStrip.data : strip(`20px ${SYS}`), got = strip(`20px "${family}",${SYS}`), row = cv.width * 4; bBaseStrip = { key, data: base };
      todo.forEach((ch, i) => { let diff = false; for (let y = 0; y < B_CELL && !diff; y++) for (let x = i * B_CELL * 4; x < (i + 1) * B_CELL * 4; x++) if (base[y * row + x] !== got[y * row + x]){ diff = true; break; } bGlyphCache.set(family + '\u0000' + ch, diff); });
    }
  } catch { return true; }
  return chars.every(ch => bGlyphCache.get(family + '\u0000' + ch));
}
// 海报上的字按「嗓门」分类，第三个数是分量；分量 0 的只是替补，前头的一款都没有才上。
// 🔑 老宋体（汇文、京華、活宋、朝華、南西、朱雀）是这套东西的体温。我一度嫌毛边把它们从
//    大字里剔了出去，只剩 Noto，海报一下子就冷了、刻板了。别再剔。
const B_TYPE = {
  heavySans : [['Noto Sans SC Black', '', 5], ['Source Han Sans SC Heavy', '', 4], ['思源黑体 CN Heavy', '', 4], ['ChillDuanHeiSongPro', '', 3], ['寒蝉端黑宋Pro', '', 3], ['HarmonyOS Sans SC Black', '', 2], ['MiSans Heavy', '', 2], ['PingFang SC', '600 ', 0], ['Microsoft YaHei', '700 ', 0], ['SimHei', '', 0]],
  lightSans : [['Noto Sans SC Thin', '', 3], ['Noto Sans SC Light', '', 2], ['Source Han Sans SC ExtraLight', '', 3], ['HarmonyOS Sans SC Thin', '', 2], ['PingFang SC', '200 ', 0], ['Microsoft YaHei Light', '', 0], ['DengXian Light', '', 0]],
  sans      : [['Noto Sans SC', '', 3], ['Noto Sans SC Medium', '', 1], ['Source Han Sans SC', '', 3], ['HarmonyOS Sans SC', '', 2], ['PingFang SC', '', 0], ['Microsoft YaHei', '', 0], ['DengXian', '', 0]],
  heavySerif: [['Noto Serif SC Black', '', 4], ['Source Han Serif SC Heavy', '', 4], ['ZhaohuaMinB Black', '', 3], ['ZhaohuaMinA', '', 2], ['KingHwaOldSong', '', 4], ['Huiwen-mincho', '', 3], ['NanxiYoumosong', '', 2], ['dingliesongtypeface', '', 2], ['ChillDuanHeiSongPro', '', 2], ['Noto Serif SC SemiBold', '', 1], ['Songti SC', '900 ', 0]],
  oldSerif  : [['KingHwaOldSong', '', 5], ['Huiwen-mincho', '', 5], ['NanxiYoumosong', '', 3], ['ChillHuoSong_F', '', 2], ['dingliesongtypeface', '', 1], ['Noto Serif SC Black', '', 1], ['Noto Serif SC SemiBold', '', 0], ['Songti SC', '900 ', 0]],      // 毛边就是它的好处：越大越要露出来
  lightSerif: [['Zhuque Fangsong (technical preview)', '', 4], ['Zhuque Fangsong (technical prev', '', 4], ['Huiwen-mincho', '', 4], ['Noto Serif SC Light', '', 2], ['Noto Serif SC ExtraLight', '', 2], ['ChillHuoSong_F', '', 2], ['ChillJinshuSong', '', 2], ['Songti SC', '300 ', 0], ['STSong', '', 0]],
  serif     : [['Huiwen-mincho', '', 6], ['KingHwaOldSong', '', 4], ['ChillHuoSong_F', '', 3], ['NanxiYoumosong', '', 2], ['Zhuque Fangsong (technical prev', '', 2], ['Noto Serif SC', '', 2], ['Noto Serif SC Medium', '', 2], ['Source Han Serif SC', '', 2], ['NanoOldSong-C', '', 1], ['Songti SC', '', 0], ['STSong', '', 0]],
};
const B_LATIN = ['georgia', 'garamond', 'constantia', 'palatino', 'baskerv', 'didot', 'fellEng', 'fellPica', 'elite'];
// 同一款字，系统里装的、嵌入方捆的，登记的名字不一样（Huiwen-mincho / Huiwen Mincho / 汇文明朝体）。
// 认得别名，不然阅读器里明明带着汇文明朝，盲盒也掷不到它
const bReal = fam => { if (hasFont(fam)) return fam; const f = FONTS.find(x => x.probes.includes(fam)); return (f && resolveFont(f)) || null; };
function bFace(cls, rnd, sample, lat = ''){
  const mine = /[sS]erif/.test(cls) ? myFontList().map(f => [f.id, '', 2]) : [], roll = rnd(), seen = new Set(), left = B_TYPE[cls].concat(mine).filter(f => f[2]).map(f => ({ f, w: f[2], real: bReal(f[0]) })).filter(q => q.real && !seen.has(q.real) && seen.add(q.real));
  let first = true;
  while (left.length){                                             // 先掷签再验字形，验不过再掷 —— 一次全验完要画几千个字
    const it = bWeighted(first ? () => roll : rnd, left); first = false;
    if (bHasGlyphs(it.real, sample)) return { stack: `${lat}"${it.real}",${SYS}`, w: it.f[1] || '', canon: it.f[0] };
    left.splice(left.indexOf(it), 1);
  }
  for (const [fam, w, k] of B_TYPE[cls]) if (!k && hasFont(fam) && bHasGlyphs(fam, sample)) return { stack: `${lat}"${fam}",${SYS}`, w: w || '', canon: fam };
  return { stack: lat + SYS, w: '', canon: '' };
}
// 垫在底下的淡字用干净的字形（它大过整张纸，毛边在那儿只显脏）。主角不许换：毛边就是要大到露出来
const B_READ = ['Huiwen-mincho', 'KingHwaOldSong', 'Zhuque Fangsong (technical prev', 'Zhuque Fangsong (technical preview)', 'ChillHuoSong_F', 'ChillJinshuSong', 'NanxiYoumosong', 'Noto Serif SC', 'Noto Serif SC Medium', 'Noto Serif SC Light', 'Noto Sans SC', 'Noto Sans SC Light', 'Source Han Serif SC'];      // 当正文也站得住的
const B_ROUGH = ['NanxiYoumosong', 'KingHwaOldSong', 'Huiwen-mincho', 'NanoOldSong-C', 'ChillHuoSong_F', 'ChillJinshuSong', 'dingliesongtypeface'];
function bClean(sample, thin){
  for (const fam of thin ? ['Noto Serif SC Light', 'Noto Serif SC', 'Source Han Serif SC', 'Songti SC'] : ['Noto Serif SC Black', 'Source Han Serif SC Heavy', 'ZhaohuaMinB Black', 'Noto Serif SC', 'Songti SC']) if (hasFont(fam) && bHasGlyphs(fam, sample)) return `"${fam}",${SYS}`;
  return SYS;
}
function bFonts(st, rnd, text, heroText, own){
  if (own) return { own: true, hero: titleStack(st), body: fontStack(st.font, st.latinFont), meta: fontStack(st.font, st.latinFont), heroW: '' };
  const roll = [rnd(), rnd(), rnd(), rnd(), rnd(), rnd()], seq = k => { let n = 0; return () => (roll[k] + n++ * .618) % 1; };      // 先掷好：换一种方案不至于连正文字体也跟着跳
  const latins = B_LATIN.map(id => familyOf(id)).filter(Boolean), lat = latins.length ? `"${latins[Math.floor(roll[4] * latins.length)]}",` : '';
  const pair = cls => {
    // 配对的规矩：要么同一款（或同一家的粗细），要么差得远；两款差不多的老宋放一块最难看
    const serif = /[sS]erif/.test(cls), h = bFace(cls, seq(0), heroText, serif ? lat : ''), fam = h.canon, readable = B_READ.includes(fam);
    const one = f => { const real = bReal(f); return real && bHasGlyphs(real, text) ? { stack: `${serif ? lat : ''}"${real}",${SYS}`, w: '' } : null; };
    let b = null;
    if (readable && roll[1] < .8) b = one(fam);
    else if (/Noto Serif SC/.test(h.stack)) b = one('Noto Serif SC');
    else if (/Noto Sans SC/.test(h.stack)) b = roll[1] < .62 ? one('Noto Sans SC') : null;
    if (!b) b = serif ? bFace('serif', seq(2), text, lat) : roll[1] < .6 ? bFace('sans', seq(2), text) : bFace('lightSerif', seq(2), text, lat);
    const m = roll[3] < .7 ? b : bFace('sans', () => 0, text);
    return { cls, canon: h.canon, big: B_ROUGH.includes(h.canon) ? bClean(heroText, cls === 'lightSerif' || cls === 'serif') : null, hero: h.stack, heroW: h.w, body: b.stack, bodyW: b.w, meta: m.stack, metaW: m.w || '' };
  };
  return { pair, ...pair('heavySans') };
}

// ── 配色的几样小工具（配色本身在 blind-colors）─────────────────────
const bMix = (h1, h2, t) => {
  const a = hex2rgb(h1), b = hex2rgb(h2);
  return '#' + a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, '0')).join('');
};
const bAlpha = (hex, a) => { const [r, g, b] = hex2rgb(hex); return `rgba(${r},${g},${b},${a})`; };
const bHex = rgb => '#' + rgb.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');

// 用一张真纸当底时，从它的代表色反推一套配色
function bPaletteForPaper(st, paper, light, rnd, ownInk){
  const mean = paperMean(paper, light), g = bHex(mean), dark = relLum(mean) < .3;
  const ink = ownInk ? bHex(shade(hex2rgb(inkOf(st.ink)), (st.inkLight || 0) / 100))
                     : (contrast(hex2rgb(bMix(g, '#000000', .86)), mean) > 7 ? bMix(g, '#0c0a09', .88) : bestInk(mean).c);
  const pool = B_PALETTES.flatMap(p => [p.a, p.b]).filter(c => contrast(hex2rgb(c), mean) >= 3);
  const take = () => pool.length ? pool[Math.floor(rnd() * pool.length)] : ink;
  return { id: 'paper', paper, light, g, i: ink, a: take(), b: take(), m: dark ? 'night' : 'clear' };
}
// 一套颜色有多少机会：泥不掷，灰扑扑的少掷，刺眼的少掷（面板上照样点得到）
function bPalW(p){
  const [L, C, h] = bLch(p.g);
  if (L < .45 && C > .012 && bHueIn(h, 26, 165)) return 0;        // 暗褐、暗橄榄
  if (L < .38 && C < .075 && bHueIn(h, 292, 335)) return .12;      // 发灰的暗紫
  if (bIsMud(L, C, h)) return 0;                                  // 土黄、竹青、摩卡
  if (L > .26 && L < .74 && C < (L < .36 ? .028 : .035)) return 0;                  // 不黑不白的灰
  if (bHueIn(h, 80, 112) && L < .86 && C > .05) return 0;       // 芥末
  if (bHueIn(h, 98, 136) && C > .13) return 0;                    // 荧光黄绿
  if (C > .165) return L > .88 ? .05 : .3;                        // 荧光
  return p.src === 'first' ? 1.3 : bIsQuiet(p) ? 2.2 : 1;
}
function bPalette(st, rnd, own){
  if (own.paper) return bPaletteForPaper(st, st.paper, st.paperLight, rnd, own.ink);
  const ps = packs(), k = rnd(), src = k < .3 ? 'first' : k < .5 ? 'cn' : k < .66 ? 'jp' : k < .82 ? 'intl' : 'tune';
  if (ps.length && !own.ink && rnd() < .1) return bPaletteForPaper(st, 'pk:' + ps[Math.floor(rnd() * ps.length)].key, 0, rnd, false);      // 偶尔铺一张装好的真纸
  let pal = src === 'tune' ? bTune(rnd) : { ...bWeighted(rnd, B_PALETTES.filter(p => p.src === src && bPalW(p)).map(p => ({ p, w: bPalW(p) }))).p };
  if (own.ink){
    const c = bHex(shade(hex2rgb(inkOf(st.ink)), (st.inkLight || 0) / 100));
    // 指定了自己的墨，底就得让墨：挑一张读得出来的
    if (contrast(hex2rgb(c), hex2rgb(pal.g)) < 4){
      const fit = B_PALETTES.filter(p => contrast(hex2rgb(c), hex2rgb(p.g)) >= 4.5);
      if (fit.length) pal = { ...fit[Math.floor(rnd() * fit.length)] };
    }
    pal.i = c;
  }
  pal.m = relLum(hex2rgb(pal.g)) < .3 ? 'night' : 'clear';
  return own.ink ? pal : bClean2(pal);
}

// ════════════════════════════════════════════════════════════════════
//  9. 版式盲盒：配色
// ════════════════════════════════════════════════════════════════════
// 四路来源：
//   cn   中国传统色（色值取自 zerosoul/chinese-colors，另补几个通行的色名）
//   jp   和田三造《配色总鉴》（色值取自 sanzo-wada.dmbk.io，w 后面是原书的组号）与日本传统色
//   intl 国际上公开通行的：包豪斯、风格派、瑞士、年度色、几套知名的界面配色
//   tune 按配色理论现调（OKLCH 里取同类／邻近／对比／分裂互补／三角），见 bTune
// 每套只写 底、墨、点睛、副色。进池子之前过一遍 bFitPal：墨压得住底（≥5.5），点睛看得见（≥2.8）——
// 底色一律不动，动的是墨和点睛的深浅，色相留着。
const B_RAW_PALETTES = {
  first: [                                                   // 第一版的那些
    ['晨霭', '#eef0ec', '#2d3440', '#6f9aa6', '#dc9c80'],
    ['信纸', '#f3ead8', '#3b2a20', '#c2703d', '#6c8a86'],
    ['藕荷', '#f3e3e1', '#43262f', '#c0576a', '#7c8fb5'],
    ['豆青', '#e3ead9', '#22352b', '#5f8f5e', '#d7884f'],
    ['新雪', '#f6f6f4', '#30343b', '#8aa4c8', '#d695a6'],
    ['杏子', '#fbe6c9', '#47271a', '#e2702f', '#3f7f86'],
    ['丁香', '#e9e4f1', '#2f2746', '#8067b7', '#e08aa4'],
    ['青瓷', '#d9e7ea', '#12323f', '#2d7f95', '#e08b5f'],
    ['旧报', '#e6dfcf', '#1d1b18', '#b3261e', '#6b6860'],
    ['薄荷', '#dcefe6', '#14342c', '#2f8f74', '#ea7f69'],
    ['柠檬', '#e9d15e', '#26221a', '#c23a26', '#2b57a4'],
    ['番茄', '#b8412c', '#fff3df', '#ffd15c', '#2a120c'],
    ['钴蓝', '#1f45b8', '#f4f1e6', '#ffd24a', '#ff9db0'],
    ['莓果', '#f6b3bf', '#3a0f22', '#cf2440', '#2d5aa8'],
    ['湖绿', '#2f6f69', '#fdf3df', '#ffd084', '#0c2f35'],
    ['胭脂', '#7c2434', '#f6e6df', '#e9b48c', '#4f8f7e'],
    ['靛夜', '#121a3d', '#eef0ff', '#f3cf7a', '#7d9bf0'],
    ['深海', '#07242f', '#e6f4f2', '#5fd0c0', '#f0a37a'],
    ['墨玉', '#0c1412', '#ecf2e6', '#7fd67a', '#e9c46a'],
    ['梅子', '#2a1636', '#f6eaf5', '#f09ab8', '#9c8cf0'],
    ['灯下', '#1d140e', '#f6e8d2', '#f0a94a', '#d0705a'],
    ['乌金', '#0d0c0b', '#f1e9da', '#d6ab5a', '#94826c'],
    ['霓虹', '#0b0b14', '#f5f4ff', '#ff4fa0', '#43e0ff'],
    ['暗房', '#1a0505', '#ffe3dc', '#ff4a3d', '#ff9a6c'],
  ],
  cn: [
    ['月白', '#d6ecf0', '#161823', '#177cb0', '#cb3a56'], ['鱼肚白', '#fcefe8', '#392f41', '#c83c23', '#425066'], ['象牙白', '#fffbf0', '#60281e', '#9d2933', '#4c8dae'], ['银白', '#e9e7ef', '#424c50', '#8c4356', '#177cb0'],
    ['蟹壳青', '#bbcdc5', '#161823', '#9d2933', '#425066'], ['藕荷', '#e4c6d0', '#4c221b', '#9d2933', '#425066'], ['藕色', '#edd1d8', '#392f41', '#8c4356', '#4c8dae'], ['丁香', '#cca4e3', '#161823', '#60281e', '#177cb0'], ['雪青', '#b0a4e3', '#161823', '#4c221b', '#ed5736'],
    ['艾绿', '#a4e2c6', '#161823', '#9d2933', '#425066'], ['竹青', '#789262', '#161823', '#fffbf0', '#f0c239'], ['松花', '#057748', '#fffbf0', '#f0c239', '#a4e2c6'], ['黛蓝', '#425066', '#fcefe8', '#f0c239', '#ed5736'], ['鸦青', '#424c50', '#e9e7ef', '#ffa631', '#7bcfa6'], ['群青', '#4c8dae', '#161823', '#fffbf0', '#f0c239'],
    ['靛青', '#177cb0', '#fffbf0', '#f0c239', '#161823'], ['漆黑', '#161823', '#e9e7ef', '#cb3a56', '#4c8dae'], ['乌黑', '#392f41', '#fcefe8', '#f0c239', '#cb3a56'], ['胭脂', '#9d2933', '#fffbf0', '#f0c239', '#e4c6d0'], ['绛紫', '#8c4356', '#fffbf0', '#f0c239', '#e4c6d0'], ['朱红', '#ff4c00', '#161823', '#fffbf0', '#425066'],
    ['妃色', '#ed5736', '#161823', '#fffbf0', '#60281e'], ['海棠', '#db5a6b', '#161823', '#fffbf0', '#9d2933'], ['缃色', '#f0c239', '#161823', '#9d2933', '#177cb0'], ['秋香', '#d9b611', '#161823', '#60281e', '#057748'], ['杏黄', '#ffa631', '#161823', '#9d2933', '#425066'], ['栗色', '#60281e', '#fffbf0', '#ffa631', '#e4c6d0'], ['紫檀', '#4c221b', '#fcefe8', '#f0c239', '#db5a6b'], ['檀', '#b36d61', '#161823', '#fffbf0', '#4c221b'], ['黛绿', '#426666', '#fffbf0', '#f0c239', '#ed5736'], ['豆绿', '#9ed048', '#161823', '#9d2933', '#057748'], ['墨色', '#50616d', '#fffbf0', '#f0c239', '#e4c6d0'],
  ],
  jp: [
    ['和田 69', '#9cb29e', '#000000', '#ffffff', '#172713'], ['和田 52', '#f5f5b8', '#000000', '#8a6a00', '#d60036'], ['和田 46', '#ff5200', '#000000', '#fff3e6', '#000831'], ['和田 62', '#ffff00', '#000000', '#d60036', '#0d75ff'], ['和田 112', '#ff616b', '#000000', '#fff3e6', '#000831'], ['和田 117', '#000000', '#f5f0e6', '#d60036', '#9cb29e'], ['和田 154', '#0d75ff', '#06004f', '#ffff00', '#d60036'], ['和田 169', '#ffa6d9', '#3a0a2a', '#a3005c', '#fff59e'],
    ['和田 190', '#ebd999', '#000000', '#de4500', '#651300'], ['和田 198', '#ffe600', '#651300', '#a93400', '#40c945'], ['和田 207', '#b3e8c2', '#000000', '#9b5348', '#172713'], ['和田 209', '#ebd999', '#000831', '#c25f00', '#96bfe6'], ['和田 211', '#000831', '#f5efe0', '#ff7340', '#99b333'], ['和田 213', '#abf5ed', '#000831', '#b0442f', '#ffe600'], ['和田 215', '#ffb852', '#06004f', '#0024cc', '#bf36e0'], ['和田 221', '#b5d1cc', '#000000', '#a10b2b', '#172713'],
    ['和田 229', '#172713', '#b5d1cc', '#fa9442', '#ebd999'], ['和田 232', '#f2ad78', '#000831', '#d60036', '#651300'], ['和田 235', '#bfabcc', '#06004f', '#ebd999', '#ff8c00'], ['和田 269', '#730f1f', '#f5efe0', '#e08a2c', '#b85e00'], ['和田 289', '#06004f', '#eef2ff', '#bdf226', '#202d85'], ['和田 289 反', '#bdf226', '#06004f', '#202d85', '#d60036'], ['和田 323', '#651300', '#ffbf6e', '#a6d40d', '#f5efe0'], ['和田 340', '#b5d1cc', '#000000', '#ff3319', '#0a5a36'], ['和田 344', '#0024cc', '#ffffff', '#ffbf6e', '#9c52f2'], ['和田 178', '#a6e6db', '#172713', '#0f6b55', '#ebd999'], ['和田 194', '#ffcfc4', '#000831', '#fa2b00', '#4f8fe6'], ['和田 276', '#ffcfc4', '#000000', '#ff5ec4', '#a6ff47'],
    ['白练', '#fcfaf2', '#1c1c1c', '#cb1b45', '#005caf'], ['生成', '#fbf7ec', '#43341b', '#b5495b', '#0d5661'], ['樱', '#fedfe1', '#3c2f41', '#cb1b45', '#8b81c3'], ['利休鼠', '#707c74', '#fcfaf2', '#ffb11b', '#1c1c1c'], ['绀', '#0f2540', '#fcfaf2', '#ffb11b', '#cb1b45'], ['琉璃', '#005caf', '#fcfaf2', '#ffb11b', '#fedfe1'], ['浅葱', '#33a6b8', '#0f2540', '#fcfaf2', '#ffb11b'], ['山吹', '#ffb11b', '#1c1c1c', '#cb1b45', '#005caf'], ['红', '#cb1b45', '#fcfaf2', '#ffb11b', '#1c1c1c'], ['宪法染', '#43341b', '#fbf7ec', '#ffb11b', '#cb1b45'], ['藤', '#8b81c3', '#0f2540', '#fcfaf2', '#ffb11b'], ['若竹', '#5dac81', '#0f2540', '#fcfaf2', '#ffb11b'],
  ],
  intl: [
    ['瑞士红', '#f4f2ee', '#0b0b0b', '#e30613', '#1a1aff'], ['瑞士反', '#e30613', '#ffffff', '#0b0b0b', '#ffd400'], ['克莱因', '#002fa7', '#ffffff', '#ffd400', '#ff5a3c'], ['克莱因反', '#f5f5f2', '#0a0a14', '#002fa7', '#e0402a'], ['包豪斯', '#f1e9d8', '#111111', '#d62718', '#1d4ea2'], ['包豪斯黄', '#f2b705', '#111111', '#d62718', '#1d4ea2'], ['风格派', '#ffffff', '#000000', '#dd0100', '#225095'], ['构成主义', '#efe6d3', '#14110f', '#c8261b', '#14110f'], ['莫兰迪 灰', '#d8d3ca', '#4a4640', '#8c6f62', '#6f7f7a'], ['莫兰迪 粉', '#e3d2cb', '#4b3f3c', '#9b6a60', '#75806f'], ['莫兰迪 绿', '#c9cdbf', '#3d433b', '#7b6a55', '#5f7470'], ['莫兰迪 蓝', '#c5ccd1', '#36404a', '#7f6a66', '#556b7c'],
    ['经典蓝 2020', '#0f4c81', '#f5f1e8', '#ffbe98', '#f3c53c'], ['活珊瑚 2019', '#ff6f61', '#1c0f12', '#fff4ec', '#0f4c81'], ['紫外光 2018', '#5f4b8b', '#f5f0fa', '#ffd662', '#f7cac9'], ['草木绿 2017', '#88b04b', '#14210d', '#fffbe8', '#5f4b8b'], ['石英粉 2016', '#f7cac9', '#33313f', '#92405e', '#92a8d1'], ['静谧蓝 2016', '#92a8d1', '#151b2e', '#fff3f2', '#b4415c'], ['玛萨拉 2015', '#955251', '#fff3ea', '#f3cf7a', '#2b1515'], ['长春花 2022', '#6667ab', '#f6f4ff', '#ffe08a', '#1a1a3a'], ['非凡洋红 2023', '#bb2649', '#fff0f2', '#ffd27a', '#2a0710'], ['柔桃 2024', '#ffbe98', '#3a1c12', '#a8321f', '#2f5d62'], ['摩卡慕斯 2025', '#a47864', '#1d120c', '#fff4e6', '#f4d7a8'],
    ['Nord', '#2e3440', '#eceff4', '#88c0d0', '#bf616a'], ['Nord 雪', '#eceff4', '#2e3440', '#5e81ac', '#bf616a'], ['Solarized', '#fdf6e3', '#073642', '#268bd2', '#dc322f'], ['Solarized 夜', '#002b36', '#eee8d5', '#b58900', '#2aa198'], ['Gruvbox', '#282828', '#ebdbb2', '#fabd2f', '#fb4934'], ['Gruvbox 日', '#fbf1c7', '#3c3836', '#9d0006', '#076678'], ['Rosé Pine', '#191724', '#e0def4', '#eb6f92', '#9ccfd8'], ['Rosé Pine 晨', '#faf4ed', '#575279', '#b4637a', '#286983'], ['Everforest', '#2d353b', '#d3c6aa', '#a7c080', '#e67e80'], ['Everforest 日', '#fdf6e3', '#4f5b62', '#3a7a4f', '#c9463d'], ['Tokyo Night', '#1a1b26', '#c0caf5', '#f7768e', '#7aa2f7'], ['Kanagawa', '#1f1f28', '#dcd7ba', '#e6c384', '#7e9cd8'], ['Flexoki', '#fffcf0', '#100f0f', '#af3029', '#205ea6'], ['Flexoki 夜', '#100f0f', '#cecdc3', '#d0a215', '#4385be'], ['Catppuccin', '#1e1e2e', '#cdd6f4', '#f5c2e7', '#89b4fa'],
    ['纸', '#f3f1ec', '#0d0d0d', '#e5321c', '#1f3fd6'], ['雾', '#dcdcd8', '#111111', '#1f35e0', '#e84a27'], ['雪', '#f7f7f5', '#2b2e33', '#6f7f90', '#b9826a'], ['灰', '#e9e7e3', '#3a3733', '#8f5640', '#4b6472'], ['茶', '#ece3d4', '#3b2c22', '#a0633a', '#4e6b5c'], ['银', '#c5c9ce', '#101418', '#0a34ff', '#e03a2f'], ['酸橙', '#d9f53c', '#0c0d08', '#3a21d6', '#e0331c'], ['碳', '#141518', '#d9dce0', '#c8ff3d', '#ff5f7a'], ['灯下', '#1a110b', '#f6e7d0', '#f0a03c', '#d8553b'], ['暗房', '#160303', '#ffd9d0', '#ff3a26', '#ff8a5c'], ['黑', '#0a0a0a', '#f4f2ee', '#ff3b24', '#3d6bff'],
  ],
};

// 往黑或往白调，直到够得着；色相不变
function bToward(c, g, need){
  const base = hex2rgb(g); let best = c;
  if (contrast(hex2rgb(c), base) >= need) return c;
  const end = relLum(base) > .22 ? '#000000' : '#ffffff';
  for (let t = .06; t <= 1.001; t += .06){ best = bMix(c, end, Math.min(1, t)); if (contrast(hex2rgb(best), base) >= need) return best; }
  return contrast(hex2rgb('#000000'), base) > contrast(hex2rgb('#ffffff'), base) ? '#000000' : '#ffffff';
}
function bFitPal(p){
  const q = { ...p, i: bToward(p.i, p.g, 5.5), a: bToward(p.a, p.g, 2.8), b: bToward(p.b, p.g, 2.2) };
  q.m = relLum(hex2rgb(q.g)) < .3 ? 'night' : 'clear';
  return q;
}
// 安静的底：颜色淡，或者很暗
const bIsQuiet = pal => { const [r, g, b] = hex2rgb(pal.g), c = Math.max(r, g, b) - Math.min(r, g, b); return c < 46; };

const B_PALETTES = Object.entries(B_RAW_PALETTES).flatMap(([src, list]) => list.map(([name, g, i, a, b], k) => bFitPal({ id: src + k, src, name, g, i, a, b })));

// ── 现调：OKLCH 里按配色关系取 ──────────────────────────────────────
function bOklch(L, C, h){
  const at = c => {
    const a = c * Math.cos(h * Math.PI / 180), b = c * Math.sin(h * Math.PI / 180), l = (L + .3963377774 * a + .2158037573 * b) ** 3, m = (L - .1055613458 * a - .0638541728 * b) ** 3, s = (L - .0894841775 * a - 1.291485548 * b) ** 3;
    return [4.0767416621 * l - 3.3077115913 * m + .2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - .3413193965 * s, -.0041960863 * l - .7034186147 * m + 1.707614701 * s];
  };
  let c = C; for (let k = 0; k < 24 && at(c).some(v => v < -.002 || v > 1.002); k++) c *= .92;      // 屏幕显示不了的，收彩度，不收色相
  return bHex(at(c).map(v => 255 * (v <= .0031308 ? 12.92 * Math.max(0, v) : 1.055 * Math.pow(Math.min(1, v), 1 / 2.4) - .055)));
}
const B_HARMONY = { mono: [0, 0], near: [28, -32], contra: [180, 150], split: [150, 210], tri: [120, 240] };
function bTune(rnd){
  const R = (a, b) => a + (b - a) * rnd(), h = rnd() * 360, rel = Object.keys(B_HARMONY)[Math.floor(rnd() * 5)], [da, db] = B_HARMONY[rel], k = rnd();
  let g, i, a, b;
  if (k < .42){ g = bOklch(R(.935, .975), R(.006, .022), h); i = bOklch(R(.2, .28), R(.02, .05), h + da * .5); a = bOklch(R(.48, .6), R(.12, .19), h + da); b = bOklch(R(.45, .58), R(.1, .17), h + db); }
  else if (k < .62){ g = bOklch(R(.84, .9), R(.035, .075), h); i = bOklch(R(.18, .25), R(.03, .06), h + da); a = bOklch(R(.42, .52), R(.13, .2), h + da); b = bOklch(R(.42, .52), R(.1, .16), h + db); }
  else if (k < .88){ g = bOklch(R(.15, .24), R(.015, .05), bDarkHue(h)); i = bOklch(R(.9, .95), R(.01, .03), h + da); a = bOklch(R(.7, .8), R(.11, .18), h + da); b = bOklch(R(.66, .76), R(.1, .16), h + db); }
  else { g = bHueIn(h, 35, 165) ? bOklch(R(.84, .9), R(.07, .13), h) : bOklch(R(.58, .86), R(.08, .15), h); i = bOklch(R(.14, .2), R(.02, .05), h + da); a = bOklch(R(.93, .97), R(.02, .05), h + da); b = bOklch(R(.4, .5), R(.14, .2), h + db); }
  return bFitPal({ id: 'tune', src: 'tune', name: rel, g, i, a, b });
}

// ════════════════════════════════════════════════════════════════════
//  9. 版式盲盒 ② 效果：焦外、错版、光、散沙、网点、裂缝……
// ════════════════════════════════════════════════════════════════════
// 每种效果吃一层画好的字（透明底的画布），吐一层新的。
// 🔑 模糊不用 ctx.filter —— Safari 没有它，会一声不吭地不糊。自己缩小再放大，
//    哪儿都一样；而且几百像素的大糊也不费劲。
// 画布是 2160×2700 一张 23MB，所以用完就还回池子，同一时刻最多三四张。
const bPool = [];
function bCanvas(w, h){
  const i = bPool.findIndex(c => c.width === w && c.height === h);
  if (i >= 0){
    const c = bPool.splice(i, 1)[0], x = c.getContext('2d');
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.globalAlpha = 1; x.globalCompositeOperation = 'source-over';
    x.clearRect(0, 0, w, h);
    return c;
  }
  return PLATFORM.canvas(w, h);
}
// 颜色没变就别重设：几十万粒沙，一粒解析一遍颜色字符串，比画还费
let bLastRGB = -1, bLastCtx = null;
const bFillRGB = (x, r, g, b) => { const k = r >> 2 << 12 | g >> 2 << 6 | b >> 2; if (k !== bLastRGB || x !== bLastCtx){ bLastRGB = k; bLastCtx = x; x.fillStyle = `rgb(${r},${g},${b})`; } };
const bFree = c => { if (c && bPool.length < 4 && c.width > 400){ if (bPool.length && bPool[0].width !== c.width && bPool[0].height !== c.height) bPool.length = 0; bPool.push(c); } };
const bDrain = () => { bPool.length = 0; };        // 一张画完就放掉，别常驻近百兆

// 糊。r 是设备像素的半径量级。逐级减半再逐级放大，比一步到位平滑得多。
function bBlur(cv, r){
  const W = cv.width, H = cv.height, n = Math.max(1, Math.round(Math.log2(Math.max(2, r))));
  const chain = []; let src = cv, w = W, h = H;
  for (let i = 0; i < n; i++){
    w = Math.max(2, Math.round(w / 2)); h = Math.max(2, Math.round(h / 2));
    const c = PLATFORM.canvas(w, h), x = c.getContext('2d');
    x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
    x.drawImage(src, 0, 0, w, h);
    chain.push(c); src = c;
  }
  for (let i = chain.length - 2; i >= 0; i--){
    const c = chain[i], x = c.getContext('2d');
    x.clearRect(0, 0, c.width, c.height);
    x.drawImage(src, 0, 0, c.width, c.height); src = c;
  }
  const out = bCanvas(W, H), x = out.getContext('2d');
  x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
  x.drawImage(src, 0, 0, W, H);
  return out;
}
function bTint(cv, color){
  const out = bCanvas(cv.width, cv.height), x = out.getContext('2d');
  x.drawImage(cv, 0, 0);
  x.globalCompositeOperation = 'source-in';
  x.fillStyle = color; x.fillRect(0, 0, cv.width, cv.height);
  return out;
}
// 用渐变留住一部分（其余变透明）。直接改 cv。
function bMask(cv, grad){
  const x = cv.getContext('2d');
  x.globalCompositeOperation = 'destination-in';
  x.fillStyle = grad; x.fillRect(0, 0, cv.width, cv.height);
  x.globalCompositeOperation = 'source-over';
  return cv;
}
function bLinear(x, W, H, ang, stops){
  const cx = W / 2, cy = H / 2, L = Math.abs(Math.cos(ang)) * W / 2 + Math.abs(Math.sin(ang)) * H / 2;
  const g = x.createLinearGradient(cx - Math.cos(ang) * L, cy - Math.sin(ang) * L, cx + Math.cos(ang) * L, cy + Math.sin(ang) * L);
  for (const [p, a] of stops) g.addColorStop(p, `rgba(0,0,0,${a})`);
  return g;
}
// 这一层字实际占着哪一块（设备像素）。效果要落在字上，不是落在纸中央。
const bBox = (layer, E) => {
  const r = layer.rect || { x: 0, y: 0, w: E.W, h: E.H };
  return { x: r.x * DPR, y: r.y * DPR, w: r.w * DPR, h: r.h * DPR };
};

const BLIND_FX = {
  // 渐糊：从刀锋一路化到雾，四档糊叠成一条顺的坡
  melt(cv, E, L){
    const { R, P } = E, b = bBox(L, E), a = P([0, Math.PI, Math.PI / 2, -Math.PI / 2]), W = cv.width, H = cv.height, len = Math.abs(Math.cos(a)) * b.w + Math.abs(Math.sin(a)) * b.h, cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    const top = Math.max(8, Math.min(150, L.avg * DPR * (L.body ? .12 : L.gentle ? .13 : R(.2, .34)))), p0 = L.gentle || L.body ? R(.42, .56) : R(.2, .4), out = bCanvas(W, H), x = out.getContext('2d'), rs = [0, top * .16, top * .45, top];
    x.globalCompositeOperation = 'lighter';
    rs.forEach((r, i) => {
      const c = r ? bBlur(cv, r) : bCopy(cv), y = c.getContext('2d'), g = y.createLinearGradient(cx - Math.cos(a) * len / 2, cy - Math.sin(a) * len / 2, cx + Math.cos(a) * len / 2, cy + Math.sin(a) * len / 2), at = k => Math.min(1, Math.max(0, p0 + (1 - p0) * k / 3));
      if (i === 0){ g.addColorStop(0, '#000'); g.addColorStop(at(0), '#000'); g.addColorStop(at(1), 'rgba(0,0,0,0)'); }
      else { g.addColorStop(at(i - 1), 'rgba(0,0,0,0)'); g.addColorStop(at(i), '#000'); if (i < 3) g.addColorStop(at(i + 1), 'rgba(0,0,0,0)'); else g.addColorStop(1, '#000'); }
      bMask(c, g); x.drawImage(c, 0, 0); bFree(c);
    });
    x.globalCompositeOperation = 'source-over';
    return out;
  },
  // 错切：等宽的条，按一个节拍错开
  cuts(cv, E, L){
    const { R, I, P } = E, b = bBox(L, E), out = bCanvas(cv.width, cv.height), x = out.getContext('2d'), n = L.gentle ? I(3, 5) : I(4, 9), amp = (L.gentle ? R(.02, .045) : R(.04, .1)) * b.w, kind = P(['alt', 'sin', 'stair', 'one']), ph = R(0, 6.28), y0 = Math.floor(b.y - 8), h = (b.h + 16) / n, hit = I(0, n - 1);
    x.drawImage(cv, 0, 0, cv.width, Math.max(0, y0), 0, 0, cv.width, Math.max(0, y0));
    for (let i = 0; i < n; i++){ const a = Math.round(y0 + h * i), e = Math.round(y0 + h * (i + 1)), k = kind === 'alt' ? (i % 2 ? 1 : -1) * .5 : kind === 'sin' ? Math.sin(i / n * 6.28 + ph) : kind === 'stair' ? (i - (n - 1) / 2) / n * 1.4 : i === hit ? 1 : 0; x.drawImage(cv, 0, a, cv.width, e - a, Math.round(k * amp), a, cv.width, e - a); }
    const z = Math.round(y0 + h * n); if (z < cv.height) x.drawImage(cv, 0, z, cv.width, cv.height - z, 0, z, cv.width, cv.height - z);
    return out;
  },
  // 点阵：一头是实的，一头散成方格子（拜耳抖动，一格一格都对得齐）
  dither(cv, E, L){
    const { R, P, u } = E, b = bBox(L, E), W = cv.width, H = cv.height, p = Math.round(R(5, 9) * u) * DPR, w = Math.ceil(W / p), h = Math.ceil(H / p), c = PLATFORM.canvas(w, h), y = c.getContext('2d', { willReadFrequently: true });
    y.imageSmoothingQuality = 'high'; y.drawImage(cv, 0, 0, w, h);
    const im = y.getImageData(0, 0, w, h), d = im.data, B8 = [0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36, 14, 46, 6, 38, 60, 28, 52, 20, 62, 30, 54, 22, 3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25, 15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21];
    const a = P([0, Math.PI / 2, Math.PI, -Math.PI / 2, R(0, 6.28)]), ca = Math.cos(a), sa = Math.sin(a), len = Math.abs(ca) * b.w + Math.abs(sa) * b.h, cx = b.x + b.w / 2, cy = b.y + b.h / 2, p0 = L.gentle ? .5 : R(.12, .34), low = L.gentle ? .3 : .06;
    for (let r = 0, i = 0; r < h; r++) for (let q = 0; q < w; q++, i += 4){
      const t = ((q * p - cx) * ca + (r * p - cy) * sa) / len + .5, k = t < p0 ? 1.02 : 1 - (1 - low) * Math.min(1, (t - p0) / (1 - p0));
      d[i + 3] = d[i + 3] / 255 * k > (B8[(r & 7) * 8 + (q & 7)] + .5) / 64 ? 255 : 0;
    }
    y.putImageData(im, 0, 0);
    const out = bCanvas(W, H), x = out.getContext('2d'); x.imageSmoothingEnabled = false; x.drawImage(c, 0, 0, w, h, 0, 0, w * p, h * p); x.imageSmoothingEnabled = true;
    return out;
  },
  // 晕染：墨落在生宣上，慢慢往外洇。近处浓、远处淡，边缘有纸的纤维
  ink(cv, E, L){
    const { R, u } = E, W = cv.width, H = cv.height, q = .5, w = Math.round(W * q), h = Math.round(H * q), seed = (E.rnd() * 4294967295) >>> 0, far = Math.max(5, Math.min(34, L.avg * (L.body ? .06 : L.gentle ? .075 : R(.085, .13)))) * u;
    const small = PLATFORM.canvas(w, h), sx = small.getContext('2d', { willReadFrequently: true }); sx.imageSmoothingQuality = 'high'; sx.drawImage(cv, 0, 0, w, h);
    const a = bBlur(small, bPx(far * 2.2)), A = a.getContext('2d').getImageData(0, 0, w, h).data, src = sx.getImageData(0, 0, w, h), d = src.data; bFree(a);
    let top = 1; for (let i = 3; i < A.length; i += 4 * 31) if (A[i] > top) top = A[i];                 // 细字糊开来很淡，按它自己最浓的地方归一
    const g = (cell, sd) => { const gw = Math.ceil(w / cell) + 2, gh = Math.ceil(h / cell) + 2, v = new Float32Array(gw * gh), r = mulberry32(sd); for (let i = 0; i < v.length; i++) v[i] = r(); return (x, y) => { const fx = x / cell, fy = y / cell, ix = fx | 0, iy = fy | 0, tx = fx - ix, ty = fy - iy, sX = tx * tx * (3 - 2 * tx), sY = ty * ty * (3 - 2 * ty), o = iy * gw + ix; return (v[o] * (1 - sX) + v[o + 1] * sX) * (1 - sY) + (v[o + gw] * (1 - sX) + v[o + gw + 1] * sX) * sY; }; };
    const n1 = g(bPx(190 * u), seed), n2 = g(bPx(34 * u), seed + 1), n3 = g(Math.max(2, bPx(9 * u)), seed + 2), n4 = g(Math.max(1.5, bPx(3)), seed + 3);
    for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i += 4){
      const f = A[i + 3] / top, o = d[i + 3] / 255; if (f < .02 && !o) continue;
      const m = n1(x, y), k = n2(x, y) * .5 + n3(x, y) * .34 + n4(x, y) * .16, reach = .1 + .34 * (1 - m), t = Math.max(0, Math.min(1, (f - reach * (.55 + k * .9)) / .5)), v = t * t * (3 - 2 * t) * (.34 + .3 * m);
      const out = Math.max(v, o * (.9 + .1 * k));
      if (o < .6 && A[i + 3] > 2){ d[i] = A[i]; d[i + 1] = A[i + 1]; d[i + 2] = A[i + 2]; }
      d[i + 3] = out * 255;
    }
    sx.putImageData(src, 0, 0);
    const out = bCanvas(W, H), x = out.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(small, 0, 0, W, H); x.globalAlpha = .5; x.drawImage(cv, 0, 0); x.globalAlpha = 1;
    return out;
  },
  // 消散：一头还在，一头化成极细的尘，顺着一股气流走远
  drift(cv, E, L){
    bLastCtx = null;
    const { R, rnd, u } = E, b = bBox(L, E), W = cv.width, H = cv.height, a = R(-.7, .7) + (E.maybe(.5) ? 0 : Math.PI), ca = Math.cos(a), sa = Math.sin(a), len = Math.abs(ca) * b.w + Math.abs(sa) * b.h || 1, p0 = L.gentle || L.body ? R(.5, .62) : R(.28, .46), out = bCanvas(W, H), x = out.getContext('2d');
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2, keep = bCopy(cv), g = keep.getContext('2d').createLinearGradient(cx - ca * len / 2, cy - sa * len / 2, cx + ca * len / 2, cy + sa * len / 2);
    g.addColorStop(0, '#000'); g.addColorStop(p0, '#000'); g.addColorStop(Math.min(1, p0 + (1 - p0) * .55), 'rgba(0,0,0,.32)'); g.addColorStop(1, 'rgba(0,0,0,0)'); bMask(keep, g); x.drawImage(keep, 0, 0); bFree(keep);
    const bx = Math.max(0, b.x | 0), by = Math.max(0, b.y | 0), bw = Math.min(W - bx, Math.ceil(b.w)), bh = Math.min(H - by, Math.ceil(b.h)); if (bw < 4 || bh < 4) return out;
    const d = cv.getContext('2d').getImageData(bx, by, bw, bh).data, n = Math.min(420000, bw * bh / 3.2), fly = (L.gentle || L.body ? 150 : 420) * u * DPR / 2, p1 = R(0, 6.28), p2 = R(0, 6.28), f1 = R(.0016, .003) * 2 / DPR, f2 = R(.005, .008) * 2 / DPR;
    for (let i = 0; i < n; i++){
      const px = (rnd() * bw) | 0, py = (rnd() * bh) | 0, o = (py * bw + px) * 4; if (d[o + 3] < 100) continue;
      const X = bx + px, Y = by + py, t = (((X - cx) * ca + (Y - cy) * sa) / len + .5 - p0) / (1 - p0); if (t <= 0 || rnd() > .12 + t * .95) continue;
      const go = Math.pow(rnd(), 2.6) * fly * (.15 + t * 1.5), th = a + Math.sin(X * f1 + Y * f1 * 1.3 + p1) * .55 + Math.sin(X * f2 - Y * f2 + p2) * .28 * (go / fly), lift = Math.sin(X * f1 * 2 + p2) * go * .2;
      const s = (.5 + Math.pow(rnd(), 5) * 2.2) * u * DPR / 2; x.globalAlpha = (.3 + rnd() * .6) * (1 - Math.min(.75, go / fly * .6)); bFillRGB(x, d[o], d[o + 1], d[o + 2]); x.fillRect(X + Math.cos(th) * go, Y + Math.sin(th) * go + lift, s, s);
    }
    x.globalAlpha = 1; return out;
  },
  // 狭缝：从某一行起，机器只剩下那一行，一直拉到纸边
  slit(cv, E, L){
    const b = bBox(L, E), W = cv.width, H = cv.height, yc = Math.round(b.y + (Math.min(b.h, H - b.y)) * (L.cutAt || E.R(.6, .8))), out = bCanvas(W, H), x = out.getContext('2d');
    x.drawImage(cv, 0, 0, W, yc, 0, 0, W, yc); x.imageSmoothingEnabled = false; x.drawImage(cv, 0, yc, W, 1, 0, yc, W, H - yc); x.imageSmoothingEnabled = true;
    return out;
  },
  // 局部焦外：一头清楚，一头化开。焦点落在哪、往哪边化，都是掷出来的。
  focus(cv, E, L){
    const { R, maybe } = E, b = bBox(L, E), W = cv.width, H = cv.height;
    // 糊多少看字有多大：同样的半径，大字是焦外，小字就成了一团
    const far = bBlur(cv, Math.max(5, Math.min(90, L.avg * DPR * (L.body ? R(.07, .1) : L.gentle ? R(.05, .085) : R(.1, .24)))));
    const sharp = bCanvas(W, H), sx = sharp.getContext('2d'); sx.drawImage(cv, 0, 0);
    const x = sharp.getContext('2d');
    let keep, lose;
    if (maybe(.5)){
      const fx = b.x + b.w * R(.2, .8), fy = b.y + b.h * R(.2, .8), rad = Math.max(b.w, b.h) * (L.gentle ? R(.5, .7) : R(.3, .5));
      const mk = inv => { const g = x.createRadialGradient(fx, fy, rad * .35, fx, fy, rad);
        g.addColorStop(0, `rgba(0,0,0,${inv ? 0 : 1})`); g.addColorStop(1, `rgba(0,0,0,${inv ? 1 : 0})`); return g; };
      keep = mk(false); lose = mk(true);
    } else {
      const a = R(0, Math.PI * 2), p = L.gentle ? R(.58, .72) : R(.35, .6);
      const g = inv => { const c = [b.x + b.w / 2, b.y + b.h / 2], len = Math.abs(Math.cos(a)) * b.w / 2 + Math.abs(Math.sin(a)) * b.h / 2;
        const gr = x.createLinearGradient(c[0] - Math.cos(a) * len, c[1] - Math.sin(a) * len, c[0] + Math.cos(a) * len, c[1] + Math.sin(a) * len);
        gr.addColorStop(0, `rgba(0,0,0,${inv ? 0 : 1})`); gr.addColorStop(p, `rgba(0,0,0,${inv ? 0 : 1})`);
        gr.addColorStop(Math.min(1, p + .28), `rgba(0,0,0,${inv ? 1 : 0})`); gr.addColorStop(1, `rgba(0,0,0,${inv ? 1 : 0})`); return gr; };
      keep = g(false); lose = g(true);
    }
    bMask(sharp, keep); bMask(far, lose);
    sx.drawImage(far, 0, 0); bFree(far);
    return sharp;
  },
  // 洇开：字还是清楚的，底下有一层晕
  haze(cv, E){
    const far = bBlur(cv, bPx(E.R(16, 34) * E.u)), out = bCanvas(cv.width, cv.height), x = out.getContext('2d');
    x.globalAlpha = E.dark ? .75 : .5; x.drawImage(far, 0, 0);
    x.globalAlpha = 1; x.drawImage(cv, 0, 0); bFree(far);
    return out;
  },
  // 发光：暗底才像光。亮底上改成暖色的投影
  glow(cv, E){
    const out = bCanvas(cv.width, cv.height), x = out.getContext('2d');
    const tint = bTint(cv, E.maybe(.6) ? E.pal.a : E.pal.b);
    for (const [r, a] of E.dark ? [[120, .9], [48, .9], [14, .8]] : [[90, .55], [36, .5]]){
      const g = bBlur(tint, bPx(r * E.u)); x.globalAlpha = a; x.drawImage(g, 0, 0); bFree(g);
    }
    bFree(tint);
    x.globalAlpha = 1; x.drawImage(cv, 0, 0);
    return out;
  },
  // 错版：两色各印一遍，对不准。叠住的地方自己会变深（亮底）或变亮（暗底）
  misreg(cv, E, L){
    const { R, u, pal } = E, out = bCanvas(cv.width, cv.height), x = out.getContext('2d');
    const d = (L.gentle ? R(4, 8) : R(7, 20)) * u * DPR / 2, a = R(0, Math.PI * 2);
    const A = bTint(cv, pal.a), B = bTint(cv, pal.b);
    x.drawImage(A, Math.cos(a) * d, Math.sin(a) * d);
    x.globalCompositeOperation = E.dark ? 'screen' : 'multiply';
    x.drawImage(B, -Math.cos(a) * d, -Math.sin(a) * d);
    x.globalCompositeOperation = 'source-over';
    // 两色要是都不够深，字就立不住：墨版压在中间
    const weak = Math.max(contrast(hex2rgb(pal.a), hex2rgb(pal.g)), contrast(hex2rgb(pal.b), hex2rgb(pal.g))) < 4;
    if (weak || L.gentle || E.maybe(.45)) x.drawImage(cv, 0, 0);
    bFree(A); bFree(B);
    return out;
  },
  // 切片：横着切成几条，各自滑开
  slice(cv, E, L){
    const { R, I, u } = E, b = bBox(L, E), out = bCanvas(cv.width, cv.height), x = out.getContext('2d');
    const n = L.gentle ? I(3, 5) : I(4, 11), amp = (L.gentle ? R(8, 16) : R(18, 70)) * u * DPR;
    let y = 0;
    const edges = [0]; for (let i = 1; i < n; i++) edges.push(b.y + b.h * (i + R(-.25, .25)) / n); edges.push(cv.height);
    edges.sort((p, q) => p - q);
    for (let i = 0; i + 1 < edges.length; i++){
      y = Math.round(edges[i]); const h = Math.round(edges[i + 1]) - y; if (h <= 0) continue;
      const dx = (i % 2 ? 1 : -1) * amp * R(0, 1);
      x.drawImage(cv, 0, y, cv.width, h, dx, y, cv.width, h);
    }
    return out;
  },
  // 裂缝：斜着断开，两半错位。缝合的时候，沿着缝有针脚
  split(cv, E, L){ return bSplit(cv, E, L, false); },
  stitch(cv, E, L){ return bSplit(cv, E, L, true); },
  // 水纹
  ripple(cv, E, L){
    const { R, u } = E, out = bCanvas(cv.width, cv.height), x = out.getContext('2d');
    const amp = (L.gentle ? R(5, 9) : R(10, 26)) * u * DPR, lam = bPx(R(44, 130) * u), ph = R(0, 6.28), step = DPR;
    for (let y = 0; y < cv.height; y += step){
      const k = L.mirror ? Math.min(1, Math.max(0, (y - L.mirror * DPR) / (260 * u * DPR))) * 1.3 + .12 : 1;
      const dx = Math.sin(y / lam + ph) * amp * k + Math.sin(y / (lam * .37) + ph * 2) * amp * .3 * k;
      x.drawImage(cv, 0, y, cv.width, step, dx, y, cv.width, step);
    }
    return out;
  },
  // 放射：从字里往外散的光
  burst(cv, E, L){
    const { R } = E, b = bBox(L, E), out = bCanvas(cv.width, cv.height), x = out.getContext('2d');
    const cx = b.x + b.w * R(.3, .7), cy = b.y + b.h * R(.2, .8), n = 26, k = L.gentle ? .006 : R(.008, .02);
    E.rnd(); const tint = bTint(cv, L.ghost || E.pal.a);
    for (let i = n; i >= 1; i--){
      const s = 1 + i * k;
      x.globalAlpha = .09 * (1 - i / (n + 1)) + .012;
      x.setTransform(s, 0, 0, s, cx * (1 - s), cy * (1 - s)); x.drawImage(tint, 0, 0);
    }
    x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = 1; x.drawImage(cv, 0, 0); bFree(tint);
    return out;
  },
  // 拖影
  trail(cv, E, L){
    const { R, u } = E, out = bCanvas(cv.width, cv.height), x = out.getContext('2d');
    const a = E.P([0, Math.PI / 2, -Math.PI / 2, Math.PI, R(0, 6.28)]), len = (L.gentle ? Math.min(90, L.avg * R(.5, .9)) : R(110, 320)) * u * DPR, n = 46;
    const tint = bTint(cv, L.ghost || E.pal.a);
    for (let i = n; i >= 1; i--){
      const t = i / n; x.globalAlpha = (L.gentle ? .055 : .1) * Math.pow(1 - t, 1.5) + .004;
      x.drawImage(tint, Math.cos(a) * len * t, Math.sin(a) * len * t);
    }
    x.globalAlpha = 1; x.drawImage(cv, 0, 0); bFree(tint);
    return out;
  },
  // 叠影：往一个方向错开印几遍，一遍比一遍淡
  echo(cv, E, L){
    const { R, I, u } = E, out = bCanvas(cv.width, cv.height), x = out.getContext('2d');
    const n = I(2, 4), a = R(0, 6.28), d = (L.gentle ? R(9, 15) : R(14, 40)) * u * DPR / 2;
    const tint = bTint(cv, L.ghost || E.pal.a);
    for (let i = n; i >= 1; i--){ x.globalAlpha = .5 / i; x.drawImage(tint, Math.cos(a) * d * i, Math.sin(a) * d * i); }
    x.globalAlpha = 1; x.drawImage(cv, 0, 0); bFree(tint);
    return out;
  },
  // 拉丝：扫描仪上抽走了纸
  smear(cv, E, L){
    const { R, u } = E, b = bBox(L, E), W = cv.width, H = cv.height, out = bCanvas(W, H), x = out.getContext('2d');
    const yc = Math.round(b.y + b.h * R(.58, .8)), len = R(260, 620) * u * DPR;      // 淌到正文上也由它，盖住本身就是效果
    x.drawImage(cv, 0, yc, W, 2, 0, yc, W, len);
    const g = x.createLinearGradient(0, yc, 0, yc + len); g.addColorStop(0, 'rgba(0,0,0,.95)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    bMask(out, g); x.drawImage(cv, 0, 0, W, yc, 0, 0, W, yc);
    return out;
  },
  // 散沙：字的一边碎成沙，被风带走
  sand(cv, E, L){
    bLastCtx = null;
    const { R, rnd, u } = E, b = bBox(L, E), W = cv.width, H = cv.height;
    const out = bCanvas(W, H), x = out.getContext('2d');
    const a = R(0, 6.28), ca = Math.cos(a), sa = Math.sin(a), from = L.gentle ? R(.62, .75) : R(.42, .6);
    const len = Math.abs(ca) * b.w + Math.abs(sa) * b.h || 1;
    const pos = (px, py) => ((px - b.x - b.w / 2) * ca + (py - b.y - b.h / 2) * sa) / len + .5;
    const keep = bCanvas(W, H), kx = keep.getContext('2d'); kx.drawImage(cv, 0, 0);
    const g = kx.createLinearGradient(b.x + b.w / 2 - ca * len / 2, b.y + b.h / 2 - sa * len / 2, b.x + b.w / 2 + ca * len / 2, b.y + b.h / 2 + sa * len / 2);
    g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(from, 'rgba(0,0,0,1)');
    g.addColorStop(Math.min(1, from + .3), 'rgba(0,0,0,.28)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    bMask(keep, g); x.drawImage(keep, 0, 0); bFree(keep);
    const bx = Math.max(0, b.x | 0), by = Math.max(0, b.y | 0);
    const bw = Math.min(W - bx, Math.ceil(b.w)), bh = Math.min(H - by, Math.ceil(b.h));
    if (bw < 4 || bh < 4) return out;
    const d = cv.getContext('2d').getImageData(bx, by, bw, bh).data;
    const tries = Math.min(260000, bw * bh / 6), fly = (L.gentle ? 120 : 300) * u * DPR / 2;
    for (let i = 0; i < tries; i++){
      const px = (rnd() * bw) | 0, py = (rnd() * bh) | 0, o = (py * bw + px) * 4;
      if (d[o + 3] < 120) continue;
      const t = (pos(bx + px, by + py) - from) / (1 - from);
      if (t <= 0 || rnd() > .25 + t) continue;
      const far = Math.pow(rnd(), 1.8) * fly * (t * 1.5 + .1), side = (rnd() - .5) * fly * .5 * t;
      const sz = (.6 + rnd() * rnd() * 3.2) * u * DPR / 2;
      x.globalAlpha = .35 + rnd() * .6;
      bFillRGB(x, d[o], d[o + 1], d[o + 2]);
      x.fillRect(bx + px + ca * far - sa * side, by + py + sa * far + ca * side, sz, sz);
    }
    x.globalAlpha = 1;
    return out;
  },
  // 网点：一头是实的，一头化成半调网点
  dots(cv, E, L){
    const { R, u } = E, b = bBox(L, E), W = cv.width, H = cv.height;
    const out = bCanvas(W, H), x = out.getContext('2d');
    const p = (L.gentle ? R(9, 12) : R(11, 20)) * u * DPR / 2 * 1.4, a = R(0, 6.28), rot = R(.2, .7);
    const ca = Math.cos(a), sa = Math.sin(a), len = Math.abs(ca) * b.w + Math.abs(sa) * b.h || 1;
    const lo = L.gentle ? .58 : .34;
    x.fillStyle = '#000'; x.beginPath();
    const cr = Math.cos(rot), sr = Math.sin(rot), cx = b.x + b.w / 2, cy = b.y + b.h / 2, span = Math.hypot(b.w, b.h) / 2 + p * 2;
    for (let v = -span; v < span; v += p) for (let w = -span; w < span; w += p){
      const px = cx + w * cr - v * sr, py = cy + w * sr + v * cr;
      const t = ((px - cx) * ca + (py - cy) * sa) / len + .5;
      const r = p * Math.max(lo, .86 - t * .62);
      x.moveTo(px + r, py); x.arc(px, py, r, 0, 6.2832);
    }
    x.fill();
    x.globalCompositeOperation = 'source-in'; x.drawImage(cv, 0, 0); x.globalCompositeOperation = 'source-over';
    if (E.maybe(.5) || L.gentle){ x.globalCompositeOperation = 'destination-over'; x.globalAlpha = .3; x.drawImage(cv, 0, 0); x.globalAlpha = 1; x.globalCompositeOperation = 'source-over'; }
    return out;
  },
  // 散落：碎成小方块，越往一头散得越开
  scatter(cv, E, L){
    const { R, rnd, u } = E, b = bBox(L, E), out = bCanvas(cv.width, cv.height), x = out.getContext('2d');
    const s = Math.max(12, Math.round(L.avg * DPR * (L.gentle ? .3 : .22))), a = R(0, 6.28), ca = Math.cos(a), sa = Math.sin(a), len = Math.abs(ca) * b.w + Math.abs(sa) * b.h || 1, t0 = L.gentle ? .5 : .25, amp = (L.gentle ? 26 : 90) * u * DPR / 2;
    for (let y = Math.max(0, b.y | 0); y < b.y + b.h; y += s) for (let px = Math.max(0, b.x | 0); px < b.x + b.w; px += s){
      const t = Math.max(0, (((px + s / 2 - b.x - b.w / 2) * ca + (y + s / 2 - b.y - b.h / 2) * sa) / len + .5 - t0) / (1 - t0)), k = t * t;
      x.save(); x.translate(px + s / 2 + (R(-1, 1) * .5 + ca * rnd()) * amp * k, y + s / 2 + (R(-1, 1) * .5 + sa * rnd()) * amp * k); x.rotate(R(-1, 1) * k * 1.2); const q = 1 - k * R(0, .4); x.scale(q, q);
      x.drawImage(cv, px, y, s, s, -s / 2, -s / 2, s + .5, s + .5); x.restore();
    }
    return out;
  },
  // 粒子：字是一粒一粒聚出来的
  motes(cv, E, L){
    bLastCtx = null;
    const { rnd, u } = E, b = bBox(L, E), out = bCanvas(cv.width, cv.height), x = out.getContext('2d');
    const bx = Math.max(0, b.x | 0), by = Math.max(0, b.y | 0), bw = Math.min(cv.width - bx, Math.ceil(b.w)), bh = Math.min(cv.height - by, Math.ceil(b.h)); if (bw < 4 || bh < 4) return cv;
    const d = cv.getContext('2d').getImageData(bx, by, bw, bh).data;
    x.globalAlpha = L.gentle ? .5 : .22; x.drawImage(cv, 0, 0);
    const n = Math.min(160000, bw * bh / (L.gentle ? 12 : 16));
    for (let i = 0; i < n; i++){
      const px = (rnd() * bw) | 0, py = (rnd() * bh) | 0, o = (py * bw + px) * 4; if (d[o + 3] < 110) continue;
      const loose = rnd() < .1, s = (.8 + Math.pow(rnd(), 3) * 3.6) * u * DPR / 2, j = loose ? 46 * u * DPR / 2 * rnd() : 2.4, a = rnd() * 6.28;
      x.globalAlpha = loose ? .3 + rnd() * .4 : .55 + rnd() * .45; bFillRGB(x, d[o], d[o + 1], d[o + 2]); x.beginPath(); x.arc(bx + px + Math.cos(a) * j, by + py + Math.sin(a) * j, s, 0, 6.2832); x.fill();
    }
    x.globalAlpha = 1; return out;
  },
  // 残墨：老铅字没上匀的墨
  wear(cv, E, L){
    const { R, rnd, u } = E, b = bBox(L, E), out = bCanvas(cv.width, cv.height), x = out.getContext('2d');
    x.drawImage(cv, 0, 0);
    x.globalCompositeOperation = 'destination-out';
    const n = Math.min(26000, b.w * b.h / (L.gentle ? 190 : 110));
    for (let i = 0; i < n; i++){
      x.globalAlpha = .25 + rnd() * .7;
      const s = (.5 + rnd() * rnd() * 4.2) * u * DPR / 2;
      x.fillRect(b.x + rnd() * b.w, b.y + rnd() * b.h, s, s * R(.5, 1.6));
    }
    // 大块的没压实
    for (let i = 0; i < 14; i++){
      const px = b.x + rnd() * b.w, py = b.y + rnd() * b.h, r = R(30, 150) * u * DPR / 2;
      const g = x.createRadialGradient(px, py, 0, px, py, r);
      g.addColorStop(0, `rgba(0,0,0,${L.gentle ? .22 : .42})`); g.addColorStop(1, 'rgba(0,0,0,0)');
      x.globalAlpha = 1; x.fillStyle = g; x.fillRect(px - r, py - r, r * 2, r * 2);
    }
    x.globalAlpha = 1; x.globalCompositeOperation = 'source-over';
    return out;
  },
  // 扫描线
  scan(cv, E, L){
    const out = bCanvas(cv.width, cv.height), x = out.getContext('2d');
    x.drawImage(cv, 0, 0); x.globalCompositeOperation = 'destination-out'; x.globalAlpha = L.gentle ? .4 : .75;
    const p = Math.round(E.R(8, 16) * E.u * DPR / 2) + 3;
    for (let y = 0; y < cv.height; y += p) x.fillRect(0, y, cv.width, Math.max(1.5, p * .26));
    x.globalAlpha = 1; x.globalCompositeOperation = 'source-over';
    return out;
  },
  // 渐染：一行字从墨色走到点睛色
  wash(cv, E, L){
    const b = bBox(L, E), out = bCanvas(cv.width, cv.height), x = out.getContext('2d');
    x.drawImage(cv, 0, 0); x.globalCompositeOperation = 'source-in';
    const a = E.R(0, 6.28), cx = b.x + b.w / 2, cy = b.y + b.h / 2, len = (Math.abs(Math.cos(a)) * b.w + Math.abs(Math.sin(a)) * b.h) / 2;
    const g = x.createLinearGradient(cx - Math.cos(a) * len, cy - Math.sin(a) * len, cx + Math.cos(a) * len, cy + Math.sin(a) * len);
    g.addColorStop(0, E.pal.i); g.addColorStop(E.R(.3, .55), E.pal.i); g.addColorStop(E.R(.7, .85), E.pal.a); g.addColorStop(1, E.maybe(.5) ? E.pal.b : E.pal.a);
    x.fillStyle = g; x.fillRect(0, 0, cv.width, cv.height); x.globalCompositeOperation = 'source-over';
    return out;
  },
  // 倒影往下淡出（水面构图专用）
  fade(cv, E, L){
    const b = bBox(L, E), out = bCanvas(cv.width, cv.height), x = out.getContext('2d');
    x.drawImage(cv, 0, 0);
    const g = x.createLinearGradient(0, b.y, 0, b.y + b.h); g.addColorStop(0, 'rgba(0,0,0,.72)'); g.addColorStop(1, 'rgba(0,0,0,.06)');
    return bMask(out, g);
  },
};

function bSplit(cv, E, L, sew){
  const { R, u, pal } = E, b = bBox(L, E), W = cv.width, H = cv.height, out = bCanvas(W, H), x = out.getContext('2d');
  const a = R(-.5, .5), cx = b.x + b.w * R(.4, .6), cy = b.y + b.h * R(.4, .6), far = W + H;
  const ca = Math.cos(a), sa = Math.sin(a);
  const d = (sew ? R(7, 14) : L.gentle ? R(8, 14) : R(16, 46)) * u * DPR, slide = (sew || L.gentle ? R(4, 16) : R(14, 60)) * u * DPR;
  for (const side of [-1, 1]){
    x.save();
    x.translate(-sa * side * d / 2 + ca * side * slide / 2, ca * side * d / 2 + sa * side * slide / 2);
    x.beginPath();
    x.moveTo(cx - ca * far, cy - sa * far); x.lineTo(cx + ca * far, cy + sa * far);
    x.lineTo(cx + ca * far - sa * side * far, cy + sa * far + ca * side * far);
    x.lineTo(cx - ca * far - sa * side * far, cy - sa * far + ca * side * far);
    x.closePath(); x.clip(); x.drawImage(cv, 0, 0); x.restore();
  }
  if (sew){
    const half = Math.min(Math.hypot(b.w, b.h) / 2, b.w * .52), gap = R(30, 44) * u * DPR / 2, arm = R(15, 24) * u * DPR / 2 + d * .5;
    x.strokeStyle = pal.a; x.lineCap = 'round'; x.lineWidth = 3.2 * u * DPR / 2;
    x.beginPath(); x.moveTo(cx - ca * half, cy - sa * half); x.lineTo(cx + ca * half, cy + sa * half);
    for (let t = -half + gap / 2; t < half; t += gap){
      const px = cx + ca * t, py = cy + sa * t, j = R(-.16, .16), vx = -Math.sin(a + j), vy = Math.cos(a + j), k = R(.8, 1.15);
      x.moveTo(px - vx * arm * k, py - vy * arm * k); x.lineTo(px + vx * arm * k, py + vy * arm * k);
    }
    x.stroke();
  }
  return out;
}

function bStar(x, cx, cy, r, color){
  x.fillStyle = color; x.beginPath();
  for (let i = 0; i < 8; i++){
    const a = i * Math.PI / 4, k = i % 2 ? r * .14 : r;
    x[i ? 'lineTo' : 'moveTo'](cx + Math.sin(a) * k, cy - Math.cos(a) * k);
  }
  x.closePath(); x.fill();
}
function bFlower(x, cx, cy, r, rot, color, E){
  x.save(); x.translate(cx, cy); x.rotate(rot);
  x.lineWidth = 1.5 * E.u; x.strokeStyle = bAlpha(color, .85); x.fillStyle = bAlpha(color, .14);
  const n = E.I(6, 9);
  for (let i = 0; i < n; i++){
    x.save(); x.rotate(i * 6.2832 / n); const k = E.R(.82, 1.08);
    x.beginPath(); x.moveTo(0, r * .12);
    x.bezierCurveTo(r * .24, r * .34, r * .2, r * .78 * k, 0, r * k); x.bezierCurveTo(-r * .2, r * .78 * k, -r * .24, r * .34, 0, r * .12);
    x.fill(); x.stroke(); x.restore();
  }
  x.fillStyle = bAlpha(color, .9);
  for (let i = 0; i < 7; i++){ x.beginPath(); x.arc(Math.cos(i * .9) * r * .1 * (i ? 1 : 0), Math.sin(i * .9) * r * .1 * (i ? 1 : 0), r * .045, 0, 6.2832); x.fill(); }
  x.restore();
}

// ── 遮盖 ───────────────────────────────────────────────────────────
// 盖住也是一种手法（2026-11-24 定的）：字都在原处，只是被挡了一部分。
// 两种用法：盖在某一层字上（BLIND_FX 里的 cover 类），或整张排完再盖一层（BLIND_OVER）。
// k ＝ 盖多少：主角可以盖狠一点，正文那一层轻一点。
const bOn = (c, pal) => contrast(hex2rgb(c), hex2rgb(pal.g)) >= contrast(hex2rgb(c), hex2rgb(pal.i)) ? pal.g : pal.i;

// 干刷一道：一束平行的毛，有的断、有的飞白
function bBrush(x, E, cx, cy, len, wid, ang, color){
  const { R, rnd } = E, n = Math.max(40, Math.round(wid / 1.15)), base = x.globalAlpha;
  x.save(); x.translate(cx, cy); x.rotate(ang); x.lineCap = 'butt';
  const bow = R(-.06, .06) * len, dry = R(.25, .55);
  x.strokeStyle = color; x.globalAlpha = base * .42; x.lineWidth = wid * .9; x.beginPath(); for (let k = 0; k <= 20; k++){ const q = -len * .485 + len * .86 * k / 20; x[k ? 'lineTo' : 'moveTo'](q, bow * (1 - Math.pow(q / len * 2, 2))); } x.stroke();
  for (let i = 0; i < n; i++){
    const f = i / (n - 1), v = (f - .5) * wid, edge = Math.abs(f - .5) * 2, load = .45 + rnd() * .55;      // 每根毛蘸的墨不一样多
    let a = -len / 2 + rnd() * len * .03 + Math.pow(edge, 3) * rnd() * len * .1;
    const end = len / 2 - Math.pow(rnd(), 1.6) * len * (dry * .5 + edge * .2);
    x.strokeStyle = bMix(color, rnd() < .5 ? '#ffffff' : '#000000', rnd() * .1);
    while (a < end){
      const seg = Math.min(end - a, len * R(.06, .34) * (1 + load)), t = (a + len / 2) / len;
      x.globalAlpha = base * Math.max(.1, load * (1 - t * dry) * R(.8, 1.1)); x.lineWidth = wid / n * R(.8, 2);
      x.beginPath();
      for (let k = 0; k <= 5; k++){ const q = a + seg * k / 5; x[k ? 'lineTo' : 'moveTo'](q, v + bow * (1 - Math.pow(q / len * 2, 2)) + Math.sin(q / 70 + i * .3) * .7); }
      x.stroke(); a += seg + (rnd() < t * dry * 1.5 ? len * rnd() * .06 : 0);
    }
  }
  x.restore();
}
// 撕下来的一条纸：毛边、露一线白茬、压一点影子
function bTorn(x, E, cx, cy, w, h, ang, color){
  const { rnd, u } = E, pts = [];
  const side = (x0, y0, x1, y1, amp) => {
    const L = Math.hypot(x1 - x0, y1 - y0), n = Math.max(3, Math.round(L / (7 * u))), nx = -(y1 - y0) / L, ny = (x1 - x0) / L; let d = 0;
    for (let k = 0; k < n; k++){ d = d * .86 + (rnd() - .5) * amp; const e = d + (rnd() - .5) * amp * .18; pts.push([x0 + (x1 - x0) * k / n + nx * e, y0 + (y1 - y0) * k / n + ny * e]); }
  };
  side(-w / 2, -h / 2, w / 2, -h / 2, 13 * u); side(w / 2, -h / 2, w / 2 - h * .12, h / 2, 12 * u);
  side(w / 2 - h * .12, h / 2, -w / 2 + h * .1, h / 2, 13 * u); side(-w / 2 + h * .1, h / 2, -w / 2, -h / 2, 12 * u);
  const path = () => { x.beginPath(); pts.forEach(([a, b], i) => x[i ? 'lineTo' : 'moveTo'](a, b)); x.closePath(); };
  x.save(); x.translate(cx, cy); x.rotate(ang); x.lineJoin = 'round';
  x.shadowColor = 'rgba(0,0,0,.34)'; x.shadowBlur = 20 * u; x.shadowOffsetY = 6 * u;
  path(); x.fillStyle = bMix(color, '#ffffff', .62); x.fill();
  x.shadowColor = 'transparent'; path(); x.strokeStyle = bMix(color, '#ffffff', .62); x.lineWidth = 6 * u; x.stroke(); path(); x.fillStyle = color; x.fill();
  x.restore();
}
function bSnow(x, E, spots, r0){
  const { R, pal } = E, c = E.dark ? pal.i : bMix(pal.g, '#ffffff', .75);
  for (const [px, py] of spots){
    const r = r0 * R(.35, 1.15), g = x.createRadialGradient(px, py, 0, px, py, r);
    g.addColorStop(0, bAlpha(c, .96)); g.addColorStop(.55, bAlpha(c, .85)); g.addColorStop(1, bAlpha(c, 0));
    x.fillStyle = g; x.beginPath(); x.arc(px, py, r, 0, 6.2832); x.fill();
  }
}
// 在一层字的上头画东西（坐标是版面像素）
const bAtop = (cv, draw) => {
  const out = bCanvas(cv.width, cv.height), x = out.getContext('2d');
  x.drawImage(cv, 0, 0); x.setTransform(DPR, 0, 0, DPR, 0, 0); x.save(); draw(x); x.restore(); x.setTransform(1, 0, 0, 1, 0, 0);
  return out;
};
Object.assign(BLIND_FX, {
  // 墨条：涂掉一截，像没解密的信
  bars(cv, E, L){
    const { R, rnd, pal } = E, gs = L.ops.filter(o => 'glv'.includes(o.k)), c = E.maybe(.65) ? pal.i : pal.a;
    return bAtop(cv, x => {
      x.fillStyle = c;
      if (L.rot){ x.translate(L.rot.cx, L.rot.cy); x.rotate(L.rot.r); x.translate(-L.rot.cx, -L.rot.cy); }
      const k = L.body ? .12 : L.gentle ? .16 : .3;
      for (const o of gs){
        if (o.k === 'g'){
          if (rnd() > k) continue;
          const w = o.fit ? o.fit[0] : (o.len || o.s * Math.max(1, [...o.t].length * .62)), h = o.fit ? o.fit[1] : o.s;
          x.save(); x.translate(o.x, o.y); x.rotate((o.r || 0) + R(-.02, .02));
          x.fillRect(-w * .54, -h * R(.02, .5), w * 1.08, h * R(.3, .62)); x.restore();
        } else {
          if (rnd() > k * 2.6) continue;
          const a = o.len * R(0, .6), n = Math.min(o.len - a, o.s * R(1.6, 5.5));
          if (o.k === 'l') x.fillRect(o.x + a, o.y + o.s * .02, n, o.s * 1.04); else x.fillRect(o.x - o.s * .02, o.y + a, o.s * 1.04, n);
        }
      }
    });
  },
  // 半掩：被底色的一块挡住，只露一部分
  veil(cv, E, L){
    const { R } = E, b = bBox(L, E), out = bCanvas(cv.width, cv.height), x = out.getContext('2d');
    x.drawImage(cv, 0, 0); x.globalCompositeOperation = 'destination-out';
    const k = L.gentle || L.body ? R(.1, .2) : R(.18, .34), a = E.P([0, 0, R(-.22, .22), Math.PI / 2]);
    x.translate(b.x + b.w / 2, b.y + b.h / 2); x.rotate(a);
    const W = Math.abs(Math.cos(a)) * b.w + Math.abs(Math.sin(a)) * b.h, H = Math.abs(Math.cos(a)) * b.h + Math.abs(Math.sin(a)) * b.w, side = E.P([-1, 1, 0]);
    const h = H * k, y = side ? side * (H / 2) - (side > 0 ? h : 0) : -h / 2 + H * R(-.14, .14);
    x.globalAlpha = .9; x.fillRect(-W, y - (side < 0 ? 4 : 0), W * 2, h + 4); x.globalAlpha = 1;      // 掩住，不是挖掉：后头还看得见一点
    x.setTransform(1, 0, 0, 1, 0, 0); x.globalCompositeOperation = 'source-over';
    if (!side && L.heavy && E.maybe(.4)) return bAtop(out, z => { z.translate((b.x + b.w / 2) / DPR, (b.y + b.h / 2) / DPR); z.rotate(a); z.fillStyle = E.pal.a; z.fillRect(-W / DPR / 2, y / DPR, W / DPR, 2.4 * E.u); z.fillRect(-W / DPR / 2, (y + h) / DPR, W / DPR, 2.4 * E.u); });
    return out;
  },
  // 百叶
  blinds(cv, E, L){
    const { R, u } = E, b = bBox(L, E), out = bCanvas(cv.width, cv.height), x = out.getContext('2d');
    x.drawImage(cv, 0, 0); x.globalCompositeOperation = 'destination-out';
    const p = Math.max(16 * u, L.avg * R(.16, .34)) * DPR, a = E.P([0, Math.PI / 2, R(-.6, .6)]), lo = .1, hi = L.gentle || L.body ? .34 : .68, far = Math.hypot(b.w, b.h);
    x.translate(b.x + b.w / 2, b.y + b.h / 2); x.rotate(a);
    for (let y = -far / 2; y < far / 2; y += p) x.fillRect(-far, y, far * 2, p * (lo + (hi - lo) * ((y + far / 2) / far)));
    return out;
  },
  // 反色圆：一枚圆压上来，圆里的字翻成另一个颜色
  disc(cv, E, L){
    const { R, pal } = E, b = bBox(L, E), c = E.maybe(.65) ? pal.a : pal.b, out = bCanvas(cv.width, cv.height), x = out.getContext('2d');
    const r = Math.min(Math.max(Math.min(b.w, b.h) * R(.36, .62), 90 * DPR), cv.width * .36), cx = b.x + b.w * R(.15, .85), cy = b.y + b.h * R(.2, .8);
    x.drawImage(cv, 0, 0);
    x.fillStyle = c; x.beginPath(); x.arc(cx, cy, r, 0, 6.2832); x.fill();
    const on = bTint(cv, bOn(c, pal)); x.save(); x.beginPath(); x.arc(cx, cy, r, 0, 6.2832); x.clip(); x.drawImage(on, 0, 0); x.restore(); bFree(on);
    return out;
  },
  torn(cv, E, L){
    const { R, I, u, pal } = E, r = L.rect, n = L.gentle || L.body ? 1 : I(1, 2);
    return bAtop(cv, x => { for (let i = 0; i < n; i++) bTorn(x, E, r.x + r.w * R(.3, .7), r.y + r.h * R(.2, .85), Math.max(260 * u, r.w * R(.5, 1.15)), Math.min(150 * u, Math.max(30 * u, Math.min(r.h * (L.body ? .08 : R(.14, .28)), L.avg * 1.1))), R(-.24, .24), E.P([bMix(pal.g, pal.a, .34), pal.a, bMix(pal.g, E.dark ? '#ffffff' : '#000000', .1)])); });
  },
  brush(cv, E, L){
    const { R, u, pal } = E, r = L.rect, tall = r.h > r.w * 1.6;
    return bAtop(cv, x => bBrush(x, E, r.x + r.w * R(.4, .6), r.y + r.h * R(.25, .75), Math.max(r.w, 300 * u) * R(.7, 1.1), Math.min(230 * u, Math.max(34 * u, Math.min(L.avg * (L.gentle || L.body ? R(.5, .9) : R(.7, 1.2)), (tall ? r.w : r.h) * .6))), R(-.3, .3), E.P([pal.a, pal.b, bMix(pal.g, pal.a, .6)])));
  },
  petals(cv, E, L){
    const { R, I, u, pal, rnd } = E, r = L.rect;
    return bAtop(cv, x => { for (let i = 0, n = L.body ? I(3, 5) : I(4, 9); i < n; i++) { x.save(); x.translate(r.x + r.w * rnd(), r.y + r.h * rnd()); x.rotate(R(0, 6.28)); BLIND_ITEMS.bloom(x, { r: Math.max(22 * u, Math.min(130 * u, L.avg * R(.35, .85))) }, E, E.P([pal.a, pal.b, bMix(pal.a, '#ffffff', .4)])); x.restore(); } });
  },
  // 积雪：一点一点落在字上，盖住笔画的上沿
  snow(cv, E, L){
    const { rnd, R, u } = E, r = L.rect, n = Math.min(90, Math.round(r.w * r.h / (L.gentle || L.body ? 16000 : 8000)) + 8), spots = [];
    for (let i = 0; i < n; i++) spots.push([r.x + r.w * rnd(), r.y + r.h * rnd()]);
    return bAtop(cv, x => bSnow(x, E, spots, Math.max(9 * u, Math.min(46 * u, L.avg * .24))));
  },
});

// ════════════════════════════════════════════════════════════════════
//  9. 版式盲盒 ⑤ 物件：光、环、星、花、线……纸上每一样能单独拿起来的东西
// ════════════════════════════════════════════════════════════════════
// 一件东西 = { id, seed, x, y, r, q, rot, c, a, front, t }
//   x,y 中心｜r 半径（版面像素）｜q 扁的程度｜rot 角度｜c 颜色（a/b/i/g/w 或 #rrggbb）
//   a 浓淡｜front 盖在字上还是垫在字下｜t 线的粗细｜seed 它自己的长相
// 盲盒掷出来的和人自己摆上去的，是同一种东西 —— 所以拆完还能接着改：
// 拖它就是改 x,y，换形状就是改 id，位置大小颜色都还在原处。
const bRng = seed => {
  const rnd = mulberry32(seed >>> 0); rnd(); rnd(); rnd();
  const R = (a, b) => a + (b - a) * rnd();
  return { rnd, R, I: (a, b) => Math.floor(R(a, b + 1)), P: arr => arr[Math.floor(rnd() * arr.length)], maybe: p => rnd() < p };
};
const bSub = (seed, salt) => (Math.imul((seed ^ Math.imul(salt + 1, 0x9E3779B1)) >>> 0, 0x85EBCA6B) ^ (seed >>> 13)) >>> 0;
const bCol = (pal, c) => (typeof c === 'string' && c[0] === '#') ? c : c === 'w' ? '#ffffff' : (pal[c] || pal.a);

// 穿过这些点的一条柔线（Catmull-Rom），密密地取点
function bSpline(ctrl, step = 4){
  const out = [], n = ctrl.length;
  if (n < 2) return ctrl.slice();
  for (let i = 0; i < n - 1; i++){
    const p0 = ctrl[Math.max(0, i - 1)], p1 = ctrl[i], p2 = ctrl[i + 1], p3 = ctrl[Math.min(n - 1, i + 2)];
    const m = Math.max(3, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / step));
    for (let k = 0; k < m; k++){
      const t = k / m, t2 = t * t, t3 = t2 * t;
      out.push([0, 1].map(d => .5 * (2 * p1[d] + (p2[d] - p0[d]) * t + (2 * p0[d] - 5 * p1[d] + 4 * p2[d] - p3[d]) * t2 + (3 * p1[d] - p0[d] - 3 * p2[d] + p3[d]) * t3)));
    }
  }
  out.push(ctrl[n - 1]);
  return out;
}
function bTrace(x, pts){ x.beginPath(); pts.forEach(([a, b], i) => x[i ? 'lineTo' : 'moveTo'](a, b)); x.stroke(); }

// ── 毛线 ───────────────────────────────────────────────────────────
// 字在哪，线才知道往哪绕：从排好的字里找落脚点。有「你」有「我」就先系住这两个。
function bAnchors(B){
  const out = [];
  for (const l of B.layers){
    if (l.role === 'meta' || l.role === 'back' || l.role === 'deco' || l.bleed || l.twin) continue;
    for (const op of l.ops){
      const push = (t, x, y, s) => { const r = blindTurn({ x: x - s / 2, y: y - s / 2, w: s, h: s }, l.rot); out.push({ t, x: r.x + r.w / 2, y: r.y + r.h / 2, s, hero: l.role === 'hero' && !l.body }); };
      if (op.k === 'g' && op.t.length <= 8){ const s = op.fit ? Math.min(...op.fit) : op.s * Math.max(1, B.em(op.t, op.f) * .7); push(op.t, op.x, op.y, s); }
      else if (op.k === 'l' || op.k === 'v'){
        let p = 0;
        [...op.t].forEach((ch, i) => { const s = op.rich && op.rich[i] ? op.rich[i].size : op.s, w = op.k === 'v' ? s : B.em(ch, 'body') * s; if (!B_PUNCT.test(ch)) push(ch, op.k === 'v' ? op.x + s / 2 : op.x + p + w / 2, op.k === 'v' ? op.y + p + s / 2 : op.y + s / 2, s); p += w; });
      }
    }
  }
  return out;
}
// 走法（mode）：sweep 一笔带过 ／ coil 一路打圈 ／ tie 系住两个字 ／ orbit 绕着主角
// 🔑 一根线只做一件事。早先一根线又荡又绕又打结，十次有六次是一团乱。
const B_LINE_MODES = ['sweep', 'coil', 'tie', 'orbit'];
function bYouMe(B, an){
  const find = list => { const c = an.filter(a => list.includes(a.t.toLowerCase())); return c.length ? c.reduce((p, q) => (q.s > p.s ? q : p)) : null; };
  return [find(['我', '吾', 'me', 'i']), find(['你', '您', '妳', 'you'])];
}
function bThreadPath(it, B){
  const { R, I, P, maybe } = bRng(it.seed), { W, H, u } = B, an = bAnchors(B), [me, you] = bYouMe(B, an), big = an.filter(a => a.hero).length >= 2 ? an.filter(a => a.hero) : an;
  const mode = it.mode || (me && you ? 'tie' : P(['sweep', 'sweep', 'coil', 'orbit']));
  let pts = [];
  const add = (x, y) => pts.push([x, y]);
  if (mode === 'tie' && an.length >= 2){
    let p = me, q = you; if (!(p && q)) { p = big[0]; q = big[big.length - 1]; }
    const loop = (g, a0, dir, turns) => { const s = Math.max(g.s, 30 * u); for (let k = 0; k <= 26 * turns; k++){ const a = a0 + dir * k / 26 * 6.2832; add(g.x + Math.cos(a) * s * .78, g.y + Math.sin(a) * s * .72); } };
    const dx = q.x - p.x, dy = q.y - p.y, L = Math.hypot(dx, dy) || 1, ang = Math.atan2(dy, dx), dir = maybe(.5) ? 1 : -1, sag = Math.min(260 * u, L * R(.18, .42)) * (maybe(.5) ? 1 : -1), nx = -dy / L, ny = dx / L;
    const e = [p.x < W / 2 ? -80 : W + 80, p.y + R(-.12, .12) * H]; add(...e); add((e[0] + p.x) / 2, (e[1] + p.y) / 2 + R(-70, 70) * u);
    loop(p, ang + Math.PI * .9, dir, 1.35);
    for (const t of [.3, .5, .7]) add(p.x + dx * t + nx * sag * Math.sin(Math.PI * t), p.y + dy * t + ny * sag * Math.sin(Math.PI * t));
    loop(q, ang + Math.PI * 1.1, -dir, 1.35);
    const f = [q.x < W / 2 ? -80 : W + 80, q.y + R(-.14, .14) * H]; add((q.x + f[0]) / 2, (q.y + f[1]) / 2 + R(-70, 70) * u); add(...f);
  } else if (mode === 'orbit'){
    const r = B.heroRect || { x: W * .2, y: H * .25, w: W * .6, h: H * .3 }, cx = r.x + r.w / 2, cy = r.y + r.h / 2, rx = Math.min(W * .56, r.w * .58 + 30 * u), ry = Math.min(H * .4, r.h * R(.3, .56) + 24 * u), n = I(2, 4), tilt = R(-.35, .35), turn = R(.16, .34);
    for (let k = 0; k <= n * 60; k++){ const a = k / 60 * 6.2832, th = tilt + turn * a / 6.2832, x = Math.cos(a) * rx, y = Math.sin(a) * ry; add(cx + x * Math.cos(th) - y * Math.sin(th), cy + x * Math.sin(th) + y * Math.cos(th)); }
  } else if (mode === 'coil'){
    const vert = maybe(.4), n = I(4, 9), rad = (vert ? W : H) * R(.05, .12), y0 = R(.2, .8), bend = R(-.14, .14), L = (vert ? H : W) + 160;
    for (let k = 0; k <= n * 48; k++){ const t = k / (n * 48), a = t * n * 6.2832, m = -80 + L * t - Math.sin(a) * rad * .82, c = ((vert ? W : H) * (y0 + bend * Math.sin(t * Math.PI))) - Math.cos(a) * rad; vert ? add(c, m) : add(m, c); }
  } else {
    const vert = maybe(.5), n = P([2, 3, 3]), amp = R(.22, .46) * (vert ? W : H) * (maybe(.5) ? 1 : -1), mid = R(.36, .64);
    for (let k = 0; k <= 80; k++){ const t = k / 80, m = -80 + ((vert ? H : W) + 160) * t, c = (vert ? W : H) * mid + Math.sin(t * Math.PI * n * .5 + .3) * amp * (1 - t * .3); vert ? add(c, m) : add(m, c); }
  }
  const line = bKnead(bEven(bKnead(bEven(bSpline(pts, 6 * u), 4 * u), mode === 'tie' ? 12 : 7), 3.2 * u), 4);
  const k = it.r / (W / 2), ox = it.x - W / 2, oy = it.y - H / 2, ca = Math.cos(it.rot || 0), sa = Math.sin(it.rot || 0);
  return line.map(([x, y]) => { const dx = (x - W / 2) * k, dy = (y - H / 2) * k; return [W / 2 + dx * ca - dy * sa + ox, H / 2 + dx * sa + dy * ca + oy]; });
}
// 按等距重新取点
function bEven(pts, step){
  const out = [pts[0]]; let acc = 0;
  for (let i = 1; i < pts.length; i++){
    let [x0, y0] = pts[i - 1]; const [x1, y1] = pts[i]; let d = Math.hypot(x1 - x0, y1 - y0);
    while (acc + d >= step){ const t = (step - acc) / d; x0 += (x1 - x0) * t; y0 += (y1 - y0) * t; out.push([x0, y0]); d = Math.hypot(x1 - x0, y1 - y0); acc = 0; }
    acc += d;
  }
  out.push(pts[pts.length - 1]); return out;
}
// 揉：每一点往左右邻居的平均靠，来回两遍
function bKnead(pts, w){
  for (let pass = 0; pass < 2; pass++){
    const n = pts.length, sx = new Float64Array(n + 1), sy = new Float64Array(n + 1);
    for (let i = 0; i < n; i++){ sx[i + 1] = sx[i] + pts[i][0]; sy[i + 1] = sy[i] + pts[i][1]; }
    pts = pts.map((p, i) => { const q = Math.min(w, i, n - 1 - i), a = i - q, b = i + q + 1; return [(sx[b] - sx[a]) / (b - a), (sy[b] - sy[a]) / (b - a)]; });
  }
  return pts;
}
// 碰到字的地方一前一后：这个字从它前面过，下一个字从它后面过
function bWeave(pts, B){
  const boxes = B.layers.filter(l => l.role !== 'meta' && l.role !== 'deco' && l.role !== 'back' && !l.bleed && !l.twin)
    .flatMap(l => l.ops.filter(o => 'glv'.includes(o.k)).map(o => blindTurn(blindOpRect(B, o), l.rot)));
  const hit = ([x, y]) => boxes.some(q => x > q.x && x < q.x + q.w && y > q.y && y < q.y + q.h);
  let on = false, over = true; const flag = new Array(pts.length).fill(false);
  for (let i = 0; i < pts.length; i++){
    const h = hit(pts[i]);
    if (h && !on) over = !over;
    on = h; flag[i] = h && over;
  }
  return flag;
}
// 质感（feel）：line 干净的单线（默认）／ yarn 毛线
function bPlain(x, pts, flag, want, w, color){
  x.lineCap = 'butt'; x.lineJoin = 'round'; x.strokeStyle = color; x.lineWidth = w;
  for (let s = 0; s < pts.length;){ if (flag[s] !== want){ s++; continue; } let e = s; while (e + 1 < pts.length && flag[e + 1] === want) e++; const run = pts.slice(Math.max(0, s - 1), Math.min(pts.length, e + 2)); if (run.length > 1) bTrace(x, run); s = e + 1; }
}
function bYarn(x, pts, flag, want, w, color, seed, E){
  const dark = bMix(color, '#000000', .34), light = bMix(color, '#ffffff', .36), n = pts.length;
  x.lineCap = 'round'; x.lineJoin = 'round';
  for (let s = 0; s < n;){
    if (flag[s] !== want){ s++; continue; }
    let e = s; while (e + 1 < n && flag[e + 1] === want) e++;
    const a = Math.max(0, s - 2), b = Math.min(n - 1, e + 2), run = pts.slice(a, b + 1);
    if (run.length > 1){
      x.save(); x.shadowColor = want ? 'rgba(0,0,0,.4)' : 'rgba(0,0,0,.2)'; x.shadowBlur = w * 1.7 * DPR; x.shadowOffsetX = w * .25 * DPR; x.shadowOffsetY = w * (want ? .7 : .3) * DPR;
      x.strokeStyle = dark; x.lineWidth = w; bTrace(x, run); x.restore();
      x.strokeStyle = color; x.lineWidth = w * .74; bTrace(x, run);
      // 捻：一道一道斜着的股
      for (let i = a; i < b; i += Math.max(1, Math.round(w * .2))){
        const p = pts[i], q = pts[Math.min(n - 1, i + 1)], ang = Math.atan2(q[1] - p[1], q[0] - p[0]) + .72, h = w * .46, c = Math.cos(ang) * h, d = Math.sin(ang) * h;
        x.strokeStyle = (i / Math.max(1, Math.round(w * .2)) | 0) % 2 ? bAlpha(light, .62) : bAlpha(dark, .5); x.lineWidth = Math.max(.7, w * .13);
        x.beginPath(); x.moveTo(p[0] - c, p[1] - d); x.quadraticCurveTo(p[0] + d * .2, p[1] - c * .2, p[0] + c, p[1] + d); x.stroke();
      }
      // 绒：往外炸的细毛
      for (let i = a; i <= b; i++){
        const r = mulberry32(seed + i * 7919); r();
        for (let k = 0; k < 3; k++){
          if (r() > .6) continue;
          const p = pts[i], ang = r() * 6.2832, len = w * (.4 + r() * r() * 1.25), bend = (r() - .5) * len;
          x.strokeStyle = bAlpha(r() < .5 ? light : color, .16 + r() * .26); x.lineWidth = .5 + r() * .55;
          x.beginPath(); x.moveTo(p[0], p[1]); x.quadraticCurveTo(p[0] + Math.cos(ang) * len * .6 - Math.sin(ang) * bend, p[1] + Math.sin(ang) * len * .6 + Math.cos(ang) * bend, p[0] + Math.cos(ang) * len, p[1] + Math.sin(ang) * len); x.stroke();
        }
      }
    }
    s = e + 1;
  }
}

// ── 形状 ───────────────────────────────────────────────────────────
// draw(x, it, E)：画布已经移到它的中心、转好角度；color 是解好的颜色，E.rnd 走它自己的种子。
const bPetal = (x, r, w, k) => { x.beginPath(); x.moveTo(0, 0); x.bezierCurveTo(r * w, r * .24, r * w * .86, r * .84 * k, 0, r * k); x.bezierCurveTo(-r * w * .86, r * .84 * k, -r * w, r * .24, 0, 0); };
const BLIND_ITEMS = {
  // 形
  ring(x, it, E, c){ for (const [w, a] of [[26, .07], [12, .13], [2, .85]]){ x.lineWidth = w * E.u; x.strokeStyle = bAlpha(c, a); x.beginPath(); x.ellipse(0, 0, it.r, it.r * (it.q || 1), 0, 0, 6.2832); x.stroke(); } },
  ellipse(x, it, E, c){ BLIND_ITEMS.ring(x, { ...it, q: it.q && it.q < .9 ? it.q : .38 }, E, c); },
  disc(x, it, E, c){ x.fillStyle = c; x.beginPath(); x.arc(0, 0, it.r, 0, 6.2832); x.fill(); },
  bubble(x, it, E, c){ const g = x.createRadialGradient(0, 0, it.r * .55, 0, 0, it.r); g.addColorStop(0, bAlpha(c, 0)); g.addColorStop(.8, bAlpha(c, .16)); g.addColorStop(.96, bAlpha(c, .62)); g.addColorStop(1, bAlpha(c, 0)); x.fillStyle = g; x.beginPath(); x.arc(0, 0, it.r, 0, 6.2832); x.fill(); x.fillStyle = bAlpha('#ffffff', .75); x.beginPath(); x.ellipse(-it.r * .38, -it.r * .45, it.r * .17, it.r * .09, -.7, 0, 6.2832); x.fill(); },
  moon(x, it, E, c){ const r = it.r; x.fillStyle = c; x.beginPath(); x.arc(0, 0, r, 1.15, -1.15 + 6.2832); x.quadraticCurveTo(-r * .62, 0, Math.cos(1.15) * r, Math.sin(1.15) * r); x.fill(); },
  star(x, it, E, c){ bStar(x, 0, 0, it.r, c); },
  flake(x, it, E, c){
    const r = it.r, n = 3 + Math.floor(E.rnd() * 2), sp = Array.from({ length: n }, () => .25 + E.rnd() * .62), ln = sp.map(() => .16 + E.rnd() * .26);
    x.strokeStyle = c; x.lineWidth = Math.max(1.1, r * .045); x.lineCap = 'round';
    for (let k = 0; k < 6; k++){ x.save(); x.rotate(k * Math.PI / 3); x.beginPath(); x.moveTo(0, 0); x.lineTo(0, -r); sp.forEach((p, i) => { for (const s of [-1, 1]){ x.moveTo(0, -r * p); x.lineTo(s * r * ln[i] * (1.15 - p * .5), -r * (p + ln[i] * .62)); } }); x.stroke(); x.restore(); }
  },
  flower(x, it, E, c){ bFlower(x, 0, 0, it.r, 0, c, E); },
  // 水彩的花：一层一层洇上去，盖得住字
  bloom(x, it, E, c){
    const n = E.I(5, 8), r = it.r;
    for (let i = 0; i < n; i++){
      x.save(); x.rotate(i * 6.2832 / n + E.R(-.12, .12));
      for (let k = 0; k < 3; k++){ x.fillStyle = bAlpha(bMix(c, '#ffffff', E.R(.02, .3)), .34); bPetal(x, r * E.R(.9, 1.06), E.R(.36, .5), E.R(.9, 1.06)); x.fill(); }
      const g = x.createRadialGradient(0, 0, 0, 0, 0, r * .6); g.addColorStop(0, bAlpha(bMix(c, '#000000', .25), .5)); g.addColorStop(1, bAlpha(c, 0)); x.fillStyle = g; bPetal(x, r, .42, .96); x.fill();
      x.strokeStyle = bAlpha(bMix(c, '#000000', .2), .26); x.lineWidth = Math.max(.6, r * .012); x.stroke(); x.restore();
    }
    x.fillStyle = bMix(c, E.dark ? '#ffffff' : '#3a2410', .6);
    for (let i = 0; i < 11; i++){ const a = E.R(0, 6.28), q = r * .13 * Math.sqrt(E.rnd()); x.beginPath(); x.arc(Math.cos(a) * q, Math.sin(a) * q, r * E.R(.014, .03), 0, 6.2832); x.fill(); }
  },
  drop(x, it, E, c){ const r = it.r; x.beginPath(); x.moveTo(0, -r); x.bezierCurveTo(r * .2, -r * .4, r * .66, 0, r * .62, r * .42); x.bezierCurveTo(r * .56, r * 1.02, -r * .56, r * 1.02, -r * .62, r * .42); x.bezierCurveTo(-r * .66, 0, -r * .2, -r * .4, 0, -r); x.fillStyle = bAlpha(c, .5); x.fill(); x.strokeStyle = bAlpha(c, .9); x.lineWidth = Math.max(1, r * .03); x.stroke(); x.strokeStyle = bAlpha('#ffffff', .75); x.lineCap = 'round'; x.lineWidth = Math.max(1, r * .06); x.beginPath(); x.arc(0, r * .36, r * .4, 2.2, 3.1); x.stroke(); },
  leaf(x, it, E, c){ const r = it.r; x.fillStyle = bAlpha(c, .82); x.beginPath(); x.moveTo(0, -r); x.bezierCurveTo(r * .62, -r * .4, r * .5, r * .5, 0, r); x.bezierCurveTo(-r * .5, r * .5, -r * .62, -r * .4, 0, -r); x.fill(); x.strokeStyle = bAlpha(bMix(c, '#ffffff', .5), .8); x.lineWidth = Math.max(.8, r * .02); x.beginPath(); x.moveTo(0, -r * .9); x.lineTo(0, r * 1.2); for (let k = -3; k <= 3; k++){ x.moveTo(0, r * k * .22); x.quadraticCurveTo(r * .2, r * (k * .22 - .1), r * .3 * (1 - Math.abs(k) * .16), r * (k * .22 - .24)); x.moveTo(0, r * k * .22); x.quadraticCurveTo(-r * .2, r * (k * .22 - .1), -r * .3 * (1 - Math.abs(k) * .16), r * (k * .22 - .24)); } x.stroke(); },
  feather(x, it, E, c){
    const r = it.r, bow = r * .22; x.lineCap = 'round';
    for (let s = -1; s <= 1; s += 2) for (let k = 0; k < 70; k++){
      const t = k / 69, y = -r * .92 + t * r * 1.55, px = bow * (1 - Math.pow((y / r), 2)), len = r * .42 * Math.sin(Math.PI * Math.min(1, t * .9 + .1)) * E.R(.82, 1.06), gap = E.rnd() < .05;
      if (gap) continue;
      x.strokeStyle = bAlpha(bMix(c, '#ffffff', E.R(0, .32)), E.R(.38, .8)); x.lineWidth = Math.max(.6, r * .012);
      x.beginPath(); x.moveTo(px, y); x.quadraticCurveTo(px + s * len * .6, y - r * .03, px + s * len, y - r * E.R(.12, .2)); x.stroke();
    }
    x.strokeStyle = c; x.lineWidth = Math.max(1, r * .02); x.beginPath(); for (let k = 0; k <= 30; k++){ const y = -r + k / 30 * r * 2, px = bow * (1 - Math.pow(y / r, 2)); x[k ? 'lineTo' : 'moveTo'](px, y); } x.stroke();
  },
  // 含着泪的眼睛
  eye(x, it, E, c){
    const r = it.r; x.strokeStyle = c; x.lineCap = 'round'; x.lineWidth = Math.max(1.2, r * .032);
    x.beginPath(); x.moveTo(-r, 0); x.bezierCurveTo(-r * .5, -r * .62, r * .5, -r * .62, r, 0); x.bezierCurveTo(r * .5, r * .46, -r * .5, r * .46, -r, 0); x.fillStyle = bAlpha(E.dark ? c : '#ffffff', .12); x.fill(); x.stroke();
    const g = x.createRadialGradient(0, -r * .04, r * .06, 0, -r * .04, r * .34); g.addColorStop(0, bAlpha(bMix(c, '#000000', .5), .95)); g.addColorStop(.5, bAlpha(c, .8)); g.addColorStop(1, bAlpha(c, .5)); x.fillStyle = g; x.beginPath(); x.arc(0, -r * .04, r * .32, 0, 6.2832); x.fill();
    x.fillStyle = '#ffffff'; x.beginPath(); x.arc(-r * .1, -r * .15, r * .075, 0, 6.2832); x.arc(r * .1, r * .07, r * .035, 0, 6.2832); x.fill();
    for (let k = 0; k < 9; k++){ const t = k / 8, px = -r * .86 + t * r * 1.72, py = -r * .46 * Math.sin(Math.PI * (t * .94 + .03)); x.beginPath(); x.moveTo(px, py); x.quadraticCurveTo(px + (t - .5) * r * .2, py - r * .16, px + (t - .5) * r * .46, py - r * E.R(.2, .28)); x.stroke(); }
    x.save(); x.translate(r * .34, r * .62); x.fillStyle = bAlpha(bMix(c, '#ffffff', .5), .85); x.beginPath(); x.moveTo(0, -r * .26); x.bezierCurveTo(r * .05, -r * .1, r * .13, 0, r * .11, r * .1); x.bezierCurveTo(r * .09, r * .22, -r * .09, r * .22, -r * .11, r * .1); x.bezierCurveTo(-r * .13, 0, -r * .05, -r * .1, 0, -r * .26); x.fill(); x.restore();
  },
  heart(x, it, E, c){ const r = it.r; x.beginPath(); for (let k = 0; k <= 80; k++){ const a = k / 80 * 6.2832; x[k ? 'lineTo' : 'moveTo'](Math.pow(Math.sin(a), 3) * r, -(13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a)) / 16 * r); } x.closePath(); x.fillStyle = bAlpha(c, .2); x.fill(); x.strokeStyle = c; x.lineWidth = Math.max(1.4, r * .04); x.lineJoin = 'round'; x.stroke(); },
  // 缝合的疤
  scar(x, it, E, c){
    const r = it.r, pts = bSpline([[-r, E.R(-.1, .1) * r], [-r * .4, E.R(-.2, .2) * r], [r * .3, E.R(-.2, .2) * r], [r, E.R(-.1, .1) * r]], 3); x.strokeStyle = c; x.lineCap = 'round'; x.lineWidth = Math.max(1.4, r * .02); bTrace(x, pts);
    for (let i = 6; i < pts.length - 4; i += Math.max(5, Math.round(r * .05))){ const a = Math.atan2(pts[i + 1][1] - pts[i][1], pts[i + 1][0] - pts[i][0]) + 1.5708 + E.R(-.2, .2), h = Math.max(7, r * .1) * E.R(.8, 1.15); x.beginPath(); x.moveTo(pts[i][0] - Math.cos(a) * h, pts[i][1] - Math.sin(a) * h); x.lineTo(pts[i][0] + Math.cos(a) * h, pts[i][1] + Math.sin(a) * h); x.stroke(); }
  },
  // 光
  orb(x, it, E, c0){
    const c = E.dark && relLum(hex2rgb(c0)) < relLum(hex2rgb(E.pal.g)) + .04 ? bMix(E.pal.a, E.pal.i, .3)      // 比底还暗的「光」是个黑洞
            : !E.dark && relLum(hex2rgb(c0)) < .14 ? bMix(c0, E.pal.g, .5) : c0;
    const g = x.createRadialGradient(0, 0, 0, 0, 0, it.r);
    for (let k = 0; k <= 14; k++){ const t = k / 14; g.addColorStop(t, bAlpha(c, Math.exp(-4.2 * t * t) * (1 - t * t * t))); }   // 高斯，中心没有尖
    x.fillStyle = g; x.beginPath(); x.arc(0, 0, it.r, 0, 6.2832); x.fill();
  },
  beam(x, it, E, c){
    x.globalCompositeOperation = E.dark ? 'screen' : 'soft-light'; const col = E.dark ? c : '#ffffff', L = Math.hypot(E.W, E.H);
    for (let i = 0, n = E.I(2, 4); i < n; i++){ const w = it.r * E.R(.2, .6), off = it.r * E.R(-.8, .8), g = x.createLinearGradient(off - w, 0, off + w, 0); g.addColorStop(0, bAlpha(col, 0)); g.addColorStop(.5, bAlpha(col, E.dark ? E.R(.5, 1) : 1)); g.addColorStop(1, bAlpha(col, 0)); x.fillStyle = g; x.fillRect(off - w, -L, w * 2, L * 2); }
  },
  // 撒开的
  dust(x, it, E, c){ for (let i = 0, n = E.I(26, 60); i < n; i++){ x.fillStyle = bAlpha(E.maybe(.5) ? c : E.pal.i, E.R(.15, .6)); x.beginPath(); x.arc(E.R(-1, 1) * it.r, E.R(-1, 1) * it.r * E.H / E.W, E.R(.6, 1.9) * E.u, 0, 6.2832); x.fill(); } },
  snow(x, it, E, c){ const s = []; for (let i = 0, n = E.I(50, 120); i < n; i++) s.push([E.R(-1, 1) * it.r, (Math.pow(E.rnd(), .7) * 2 - 1) * it.r * E.H / E.W]); bSnow(x, E, s, 20 * E.u); },
  marks(x, it, E, c){
    const { W, H, u, pal } = E, m = 34 * u; x.translate(-W / 2, -H / 2); x.strokeStyle = bAlpha(pal.i, .5); x.lineWidth = 1.2 * u;
    for (const [px, py] of [[m, m], [W - m, m], [m, H - m], [W - m, H - m]]){ x.beginPath(); x.arc(px, py, 7 * u, 0, 6.2832); x.moveTo(px - 13 * u, py); x.lineTo(px + 13 * u, py); x.moveTo(px, py - 13 * u); x.lineTo(px, py + 13 * u); x.stroke(); }
    [pal.i, pal.a, pal.b, bMix(pal.g, pal.i, .4)].forEach((col, i) => { x.fillStyle = col; x.fillRect(W / 2 - 34 * u + i * 17 * u, H - m - 5 * u, 15 * u, 10 * u); });
  },
  // 几缕软线
  strand(x, it, E, c){
    const { W, H, u } = E, k = it.r / (W / 2), vert = E.maybe(.5), n = E.I(2, 5), sway = E.R(.05, .2), base = [];
    for (let i = 0; i < 6; i++) base.push([((vert ? E.R(-1, 1) * sway : -0.56 + i * .224) + (vert ? E.R(-.3, .3) * .1 : 0)) * W * k, (vert ? -0.56 + i * .224 : E.R(-1, 1) * sway) * H * k]);
    x.strokeStyle = bAlpha(c, .6); x.lineCap = 'round';
    for (let j = 0; j < n; j++){ x.lineWidth = E.R(.7, 1.7) * u; const d = j * E.R(8, 20) * u; bTrace(x, bSpline(base.map(([a, b], i) => [a + (vert ? d : 0) + E.R(-9, 9) * u, b + (vert ? 0 : d) + E.R(-9, 9) * u]), 4)); }
  },
  // 盖的
  torn(x, it, E, c){ bTorn(x, E, 0, 0, it.r * 2, (it.t || 90) * E.u, 0, c); },
  brush(x, it, E, c){ bBrush(x, E, 0, 0, it.r * 2, (it.t || 100) * E.u, 0, c); },
  invert(x, it, E){ x.globalCompositeOperation = 'difference'; x.globalAlpha = 1; x.fillStyle = '#fff'; x.beginPath(); x.arc(0, 0, it.r, 0, 6.2832); x.fill(); },
  band(x, it, E){ x.globalCompositeOperation = 'difference'; x.globalAlpha = 1; x.fillStyle = '#fff'; x.fillRect(-it.r, -(it.t || 130) * E.u / 2, it.r * 2, (it.t || 130) * E.u); },
};
// 人能换来换去的，分几堆（面板上照这个顺序排）
const B_SHAPES = {
  shape: ['ring', 'ellipse', 'disc', 'moon', 'star', 'flake', 'flower', 'bloom', 'feather', 'eye', 'heart', 'drop', 'leaf', 'bubble', 'scar'],
  line : ['thread', 'strand'],
  light: ['orb', 'beam', 'dust', 'marks'],
  cover: ['torn', 'brush', 'snow', 'invert', 'band'],
};
const B_FIELD = ['dust', 'marks', 'snow', 'strand', 'beam'];         // 铺满整页的，点不着，只在单子里选
// 新添一件时的默认样子
function blindNewItem(id, seed, pal, W, H){
  const { R, P } = bRng(seed), u = Math.min(W, H) / 1080, dark = relLum(hex2rgb(pal.g)) < .3;
  const it = { id, seed, x: W / 2, y: H / 2, r: 120 * u, rot: 0, c: P(['a', 'b', 'a']), a: 1, front: false };
  if (id === 'thread'){
    const red = dark ? '#d9343f' : '#b41f2b';
    return { ...it, r: W / 2, feel: 'line', t: P([1.4, 2.2, 4, 7]) * u, c: contrast(hex2rgb(red), hex2rgb(pal.g)) >= 1.9 && R(0, 1) < .78 ? red : 'a' };
  }
  if (B_FIELD.includes(id)) Object.assign(it, { r: W / 2, a: id === 'beam' ? (dark ? R(.2, .34) : R(.6, .95)) : 1, rot: id === 'beam' ? R(-.9, .9) : 0, front: id === 'snow' });
  if (id === 'orb') Object.assign(it, { r: Math.max(W, H) * R(.28, .6), a: dark ? R(.28, .5) : R(.22, .44) });
  if (id === 'ellipse') it.q = R(.28, .5);
  if (id === 'star' || id === 'flake' || id === 'flower') it.r = R(30, 56) * u;
  if (id === 'bloom') Object.assign(it, { r: R(50, 96) * u, front: true });
  if (id === 'torn') Object.assign(it, { r: W * R(.45, .75), t: R(60, 140), rot: R(-.28, .28), front: true, c: P(['a', 'b', bMix(pal.g, pal.a, .4)]) });
  if (id === 'brush') Object.assign(it, { r: W * R(.3, .5), t: R(60, 150), rot: R(-.5, .5), front: true });
  if (id === 'invert') Object.assign(it, { r: W * R(.16, .32), front: true });
  if (id === 'band') Object.assign(it, { r: W, t: R(90, 240), rot: R(-.3, .3), front: true });
  if (id === 'disc') it.a = .92;
  if (['frost', 'reed', 'mosaic', 'blurp', 'lens'].includes(id)) Object.assign(it, { front: true, x: W * R(.25, .75), y: H * R(.2, .8), r: (id === 'lens' || id === 'blurp' ? R(110, 240) : R(200, 380)) * u, t: R(180, 460), rot: id === 'lens' || id === 'blurp' ? 0 : P([0, 0, R(-.2, .2)]) });
  return it;
}
const blindItemBox = it => {
  const q = it.id === 'ellipse' ? (it.q && it.q < .9 ? it.q : .38) : ['torn', 'brush', 'band', 'frost', 'reed', 'mosaic'].includes(it.id) ? 0 : 1;
  const hx = it.r, hy = q ? it.r * q : (it.t || 90) / 2, c = Math.abs(Math.cos(it.rot || 0)), s = Math.abs(Math.sin(it.rot || 0));
  const w = (hx * c + hy * s) * 2, h = (hx * s + hy * c) * 2;
  return { x: it.x - w / 2, y: it.y - h / 2, w, h };
};

// ── 掷景：一个「景」掷成几件独立的东西 ─────────────────────────────
function blindScene(group, B, seed){
  const E = bRng(seed), { R, I, P, maybe, rnd } = E, { W, H, u, pal } = B, out = [];
  const put = (id, o = {}) => { const it = { ...blindNewItem(id, Math.floor(rnd() * 4294967295), pal, W, H), ...o }; out.push(it); return it; };
  const spot = (r, strict, tries = 30) => { for (let k = 0; k < tries; k++){ const x = W * R(.04, .96), y = H * R(.04, .96); if (!B.hit(x, y, r, strict)) return [x, y]; } return null; };
  if (group === 'orbs') for (let i = 0, n = I(2, 4); i < n; i++) put('orb', { x: W * R(-.05, 1.05), y: H * R(-.05, 1.05), c: P(['a', 'b', 'a']) });
  else if (group === 'halo'){
    const h = B.heroRect || { x: W * .3, y: H * .3, w: W * .4, h: H * .3 };
    for (let k = 0; k < 26; k++){
      // 先想套住主角，套不住就去空地上挂一个
      const free = k > 7, x = free ? W * R(.1, .9) : h.x + h.w / 2, y = free ? H * R(.1, .9) : h.y + h.h / 2, q = maybe(.4) ? R(.28, .5) : 1;
      const r = free ? W * R(.12, .34) : Math.min(W * .46, Math.max(h.w, h.h) * R(.5, .68) + 40), rot = R(-.5, .5); let bad = false;
      for (let i = 0; i < 72 && !bad; i++){ const a = i * 6.2832 / 72, px = Math.cos(a) * r, py = Math.sin(a) * r * q; bad = B.hit(x + px * Math.cos(rot) - py * Math.sin(rot), y + px * Math.sin(rot) + py * Math.cos(rot), 8, free); }
      if (!bad){ put(q < 1 ? 'ellipse' : 'ring', { x, y, r, rot, q, c: 'a' }); break; }
    }
  }
  else if (group === 'stars'){ put('dust', { c: 'a' }); for (let i = 0, n = I(3, 7); i < n; i++){ const r = R(7, 24) * u, p = spot(r, true); if (p) put('star', { x: p[0], y: p[1], r, c: 'a', a: R(.6, .95) }); } }
  else if (group === 'flower'){
    const id = P(['flower', 'flower', 'flake']);
    for (let i = 0, n = I(2, 5), k = 0; i < n && k < 40; k++){
      const side = maybe(.5), x = side ? P([R(.03, .13), R(.87, .97)]) * W : W * R(.05, .95), y = side ? H * R(.05, .95) : P([R(.03, .1), R(.9, .97)]) * H, r = R(16, 46) * u;
      if (B.hit(x, y, r, true) || out.some(o => Math.hypot(o.x - x, o.y - y) < o.r + r)) continue;
      put(id, { x, y, r, rot: R(0, 6.28) }); i++;
    }
  }
  else if (group === 'motif'){ const id = P(['moon', 'feather', 'eye', 'heart', 'drop', 'bubble', 'scar', 'leaf']), r = R(54, 120) * u, p = spot(r, true, 60); if (p) put(id, { x: p[0], y: p[1], r, rot: id === 'eye' || id === 'heart' || id === 'drop' ? R(-.2, .2) : R(-.8, .8) }); }
  else if (group === 'petals'){ const cx = W * R(.1, .9), cy = H * R(.1, .9); for (let i = 0, n = I(6, 12); i < n; i++) put('bloom', { x: cx + (rnd() + rnd() - 1) * W * .36, y: cy + (rnd() + rnd() - 1) * H * .3, r: R(22, 84) * u, rot: R(0, 6.28), c: P(['a', 'b', bMix(pal.a, '#ffffff', .4)]) }); }
  else if (group === 'torn') put('torn', { x: W * R(.3, .7), y: H * R(.15, .85) });
  else if (group === 'brush') put('brush', { x: W * R(.35, .65), y: H * R(.2, .8) });
  else if (group === 'invert') maybe(.6) ? put('invert', { x: W * R(.2, .8), y: H * R(.2, .8) }) : put('band', { x: W / 2, y: H * R(.2, .8) });
  else if (group === 'beam') put('beam', { x: W * R(.25, .75), c: 'a' });
  else if (group === 'lines') put('strand', { x: W * R(.1, .9), y: H * R(.1, .9), c: 'a' });
  else if (BLIND_ITEMS[group] || group === 'thread') put(group);
  return out;
}

function blindDrawItem(x, it, B, pass){
  const { pal, W, H, u } = B, c = bCol(pal, it.c);
  if (it.id === 'thread'){
    const pts = bThreadPath(it, B), flag = bWeave(pts, B), all = it.front ? flag.map(() => true) : flag;
    x.save(); x.globalAlpha = it.a === undefined ? 1 : it.a;
    if (it.feel === 'yarn') bYarn(x, pts, all, pass === 'front', it.t || 6 * u, c, it.seed, B); else bPlain(x, pts, all, pass === 'front', it.t || 3 * u, c);
    x.restore();
    return;
  }
  if ((pass === 'front') !== !!it.front) return;
  const E = { ...bRng(it.seed), u, W, H, pal, dark: B.dark };
  x.save(); x.globalAlpha = it.a === undefined ? 1 : it.a; x.translate(it.x, it.y); if (it.rot) x.rotate(it.rot);
  BLIND_ITEMS[it.id](x, it, E, c); x.restore();
}

// ════════════════════════════════════════════════════════════════════
//  9. 版式盲盒 ⑥ 修图：整张排好之后再过一遍
// ════════════════════════════════════════════════════════════════════
// 跟 BLIND_FX 的区别：那些落在某一层字上，这些吃的是整张成品（纸、字、物件全在内）。
// 每一种就地改 cv（设备像素，2160×2700）。E 里的 rnd 走它自己的种子。
// 逐像素的尽量在半幅上算 —— 全幅五百八十万像素，多来两遍就顿了。
const bCopy = cv => { const c = bCanvas(cv.width, cv.height); c.getContext('2d').drawImage(cv, 0, 0); return c; };
// 收 (x, W, H) 的按两倍图的坐标画（草样时坐标系自己缩）；只收 x 的是整张搬图，按真像素
const bFull = (cv, fn) => { const x = cv.getContext('2d'), k = fn.length > 1 ? DPR / 2 : 1; x.save(); x.setTransform(k, 0, 0, k, 0, 0); fn(x, cv.width / k, cv.height / k); x.restore(); };
// 缩到 w×h 上逐像素改，再放回来
function bPixels(cv, scale, fn, smooth = true){
  const w = Math.max(2, Math.round(cv.width * scale)), h = Math.max(2, Math.round(cv.height * scale)), c = PLATFORM.canvas(w, h), x = c.getContext('2d', { willReadFrequently: true });
  x.imageSmoothingQuality = 'high'; x.drawImage(cv, 0, 0, w, h);
  const im = x.getImageData(0, 0, w, h); const out = fn(im, w, h) || im; x.putImageData(out, 0, 0);
  bFull(cv, (y, W, H) => { y.imageSmoothingEnabled = smooth; y.imageSmoothingQuality = 'high'; y.drawImage(c, 0, 0, W, H); });
}
const bNoisePat = x => x.createPattern(blindGrain(), 'repeat');

const BLIND_POST = {
  // 反色
  negate(cv){ const src = bCopy(cv); bFull(cv, (x, W, H) => { x.globalCompositeOperation = 'difference'; x.fillStyle = '#fff'; x.fillRect(0, 0, W, H); x.globalCompositeOperation = 'hue'; x.drawImage(src, 0, 0, W, H); }); bFree(src); },
  // 正片叠底：压一层颜色上去（暗底上正片叠底看不见，用它的反面：滤色）
  multiply(cv, E){
    const { R, pal } = E;
    bFull(cv, (x, W, H) => {
      const a = R(0, 6.28), g = x.createLinearGradient(W / 2 - Math.cos(a) * W, H / 2 - Math.sin(a) * H, W / 2 + Math.cos(a) * W, H / 2 + Math.sin(a) * H);
      const h = bAnchor(pal), s = E.maybe(.5) ? 1 : -1;      // 压上去的颜色跟底是一家的，不然一叠就灰
      if (E.dark){ x.globalCompositeOperation = 'screen'; g.addColorStop(0, bAlpha(bOklch(.42, .12, bDarkHue(h)), .6)); g.addColorStop(.6, bAlpha(bOklch(.36, .1, bDarkNear(h, s * 24)), .2)); g.addColorStop(1, bAlpha(bOklch(.4, .11, bDarkNear(h, s * 40)), .5)); }
      else { x.globalCompositeOperation = 'multiply'; g.addColorStop(0, bOklch(.85, .095, h)); g.addColorStop(.5, '#ffffff'); g.addColorStop(1, bOklch(.88, .08, h + s * 44)); }
      x.fillStyle = g; x.fillRect(0, 0, W, H);
    });
  },
  // 移轴的高斯模糊：留一条清楚的带子
  gauss(cv, E){
    const { R, u } = E, far = bBlur(cv, bPx(R(9, 20) * u)), far2 = far.getContext('2d'), a = R(-.4, .4), z = (E.bodyRect && E.maybe(.65) ? E.bodyRect : E.heroRect), p = z ? Math.max(.14, Math.min(.86, (z.y + z.h / 2) / E.H)) : R(.3, .7), k = R(.17, .28);
    far2.globalCompositeOperation = 'destination-in'; far2.setTransform(1, 0, 0, 1, 0, 0);
    const W = cv.width, H = cv.height, g = far2.createLinearGradient(W / 2 - Math.sin(a) * H / 2, H / 2 - Math.cos(a) * H / 2, W / 2 + Math.sin(a) * H / 2, H / 2 + Math.cos(a) * H / 2);
    for (const [t, v] of [[0, 1], [Math.max(.01, p - k - .16), 1], [Math.max(.02, p - k), 0], [Math.min(.98, p + k), 0], [Math.min(.99, p + k + .16), 1], [1, 1]]) g.addColorStop(t, `rgba(0,0,0,${v})`);
    far2.fillStyle = g; far2.fillRect(0, 0, W, H); far2.globalCompositeOperation = 'source-over';
    bFull(cv, x => x.drawImage(far, 0, 0)); bFree(far);
  },
  // 失焦：整张都虚着，像没戴眼镜
  defocus(cv, E){
    const a = bBlur(cv, bPx(E.R(5, 8) * E.u)), b = bBlur(cv, bPx(26 * E.u));
    bFull(cv, x => { x.globalAlpha = .82; x.drawImage(a, 0, 0); x.globalAlpha = .4; x.globalCompositeOperation = E.dark ? 'screen' : 'soft-light'; x.drawImage(b, 0, 0); }); bFree(a); bFree(b);
  },
  // 旋焦：中间清楚，越往边上越转
  swirl(cv, E){
    const W = cv.width, H = cv.height, h = E.heroRect || { x: 0, y: 0, w: E.W, h: E.H }, bd = E.bodyRect, mid = (a, w) => a + w / 2, cx = bd ? (mid(bd.x, bd.w) * .62 + mid(h.x, h.w) * .38) * DPR : mid(h.x, h.w) * DPR * .6 + W * .2, cy = bd ? (mid(bd.y, bd.h) * .62 + mid(h.y, h.h) * .38) * DPR : mid(h.y, h.h) * DPR * .6 + H * .2, src = bCopy(cv), acc = bCanvas(W, H), x = acc.getContext('2d'), n = 22, sweep = E.full ? E.R(.035, .06) : E.R(.07, .14);
    for (let i = 0; i < n; i++){ x.globalAlpha = 1 / (i + 1); x.setTransform(1, 0, 0, 1, cx, cy); x.rotate((i / (n - 1) - .5) * sweep); x.drawImage(src, -cx, -cy); }
    x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = 1; x.globalCompositeOperation = 'destination-in';
    const r = Math.max(W, H), g = x.createRadialGradient(cx, cy, r * (E.full ? .24 : .17), cx, cy, r * (E.full ? .56 : .46)); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,1)'); x.fillStyle = g; x.fillRect(0, 0, W, H); x.globalCompositeOperation = 'source-over';
    bFull(cv, y => y.drawImage(acc, 0, 0)); bFree(src); bFree(acc);
  },
  // 柔光
  soft(cv, E){ const b = bBlur(cv, bPx(34 * E.u)); bFull(cv, x => { x.globalCompositeOperation = 'soft-light'; x.globalAlpha = .8; x.drawImage(b, 0, 0); x.globalCompositeOperation = 'screen'; x.globalAlpha = E.dark ? .45 : .22; x.drawImage(b, 0, 0); }); bFree(b); },
  // 光晕：亮处漫出一圈暖边
  halation(cv, E){
    const warm = bHueGap(bAnchor(E.pal), 20) < 60 || bLch(E.pal.g)[1] < .012, tint = hex2rgb(warm ? '#ff6834' : bOklch(.66, .15, E.dark ? bDarkHue(bAnchor(E.pal)) : bAnchor(E.pal)));
    const c = PLATFORM.canvas(cv.width >> 2, cv.height >> 2), x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(cv, 0, 0, c.width, c.height);
    const im = x.getImageData(0, 0, c.width, c.height), d = im.data;
    for (let i = 0; i < d.length; i += 4){ const l = (d[i] * .3 + d[i + 1] * .59 + d[i + 2] * .11) / 255, sat = (Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2])) / 255, k = E.dark ? Math.max(0, l - .42) * 1.7 : Math.max(0, sat - .3) * 1.1; d[i] = Math.min(255, tint[0] * k); d[i + 1] = Math.min(255, tint[1] * k); d[i + 2] = Math.min(255, tint[2] * k); d[i + 3] = 255; }
    x.putImageData(im, 0, 0); const b = bBlur(c, bPx(13));
    bFull(cv, (y, W, H) => { y.imageSmoothingQuality = 'high'; y.globalCompositeOperation = E.dark ? 'screen' : 'soft-light'; y.globalAlpha = E.dark ? .95 : .7; y.drawImage(b, 0, 0, W, H); });
  },
  // 光斑
  bokeh(cv, E){
    // 镜头外的光：大、软、少，聚在一角；硬边的小圆片撒一地，是素材，不是光
    const { R, I, P, pal } = E, h = bAnchor(pal);
    bFull(cv, (x, W, H) => {
      x.globalCompositeOperation = E.dark ? 'screen' : 'soft-light';
      const cx = W * P([R(-.05, .2), R(.8, 1.05)]), cy = H * R(.02, .98);
      for (let i = 0, n = I(6, 11); i < n; i++){
        const px = cx + (E.rnd() + E.rnd() - 1) * W * .5, py = cy + (E.rnd() + E.rnd() - 1) * H * .42, r = W * R(.06, .2), c = E.dark ? P([bOklch(.6, .11, bDarkHue(h)), bOklch(.52, .1, bDarkNear(bDarkHue(h), 30))]) : P(['#ffffff', bMix(pal.a, '#ffffff', .5)]), k = E.dark ? R(.1, .24) : R(.3, .6);
        const g = x.createRadialGradient(px, py, 0, px, py, r); g.addColorStop(0, bAlpha(c, k)); g.addColorStop(.55, bAlpha(c, k * .8)); g.addColorStop(.8, bAlpha(c, k * .42)); g.addColorStop(1, bAlpha(c, 0));
        x.fillStyle = g; x.beginPath(); x.arc(px, py, r, 0, 6.2832); x.fill();
      }
    });
  },
  // 暗闪：压暗四周，撒一把碎亮片
  spark(cv, E){
    const { R, I, P, pal, rnd } = E;
    bFull(cv, (x, W, H) => {
      const cx = W * R(.35, .65), cy = H * R(.35, .65), g = x.createRadialGradient(cx, cy, W * .18, cx, cy, H * .74); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, E.dark ? 'rgba(0,0,0,.6)' : 'rgba(20,10,24,.42)');
      x.globalCompositeOperation = 'multiply'; x.fillStyle = g; x.fillRect(0, 0, W, H); x.globalCompositeOperation = 'source-over';
      for (let i = 0, n = I(420, 900); i < n; i++){ const s = Math.pow(rnd(), 5) * 5 + .8; x.globalAlpha = .25 + rnd() * .75; x.fillStyle = P(['#ffffff', bMix(pal.a, '#ffffff', .5), bMix(pal.b, '#ffffff', .4)]); x.fillRect(W * rnd(), H * rnd(), s * 1.2, s * 1.2); }
      for (let i = 0, n = I(14, 30); i < n; i++){ x.globalAlpha = R(.5, 1); bStar(x, W * rnd(), H * rnd(), R(8, 38) * E.u, P(['#ffffff', bMix(pal.a, '#ffffff', .6)])); }
    });
  },
  // 珠光：贝壳里面那种随角度变的虹彩
  pearl(cv, E){
    const { R } = E;
    bFull(cv, (x, W, H) => {
      const cols = ['#ffd9ec', '#d9e4ff', '#d6fff4', '#fff6cf', '#f0d6ff', '#cfe9ff', '#ffe0d6'], a = R(0, 6.28), g = x.createLinearGradient(W / 2 - Math.cos(a) * W, H / 2 - Math.sin(a) * H, W / 2 + Math.cos(a) * W, H / 2 + Math.sin(a) * H);
      for (let i = 0; i <= 13; i++) g.addColorStop(i / 13, cols[i % 7]);
      x.globalCompositeOperation = E.dark ? 'overlay' : 'multiply'; x.globalAlpha = E.dark ? .5 : .78; x.fillStyle = g; x.fillRect(0, 0, W, H);
      for (let i = 0; i < 5; i++){ const px = W * R(0, 1), py = H * R(0, 1), r = W * R(.3, .7), q = x.createRadialGradient(px, py, 0, px, py, r); q.addColorStop(0, 'rgba(255,255,255,.55)'); q.addColorStop(1, 'rgba(255,255,255,0)'); x.globalCompositeOperation = 'soft-light'; x.globalAlpha = .8; x.fillStyle = q; x.fillRect(0, 0, W, H); }
    });
  },
  // 胶片：压浅黑位、偏暖、划痕、灰尘、一角漏光
  film(cv, E){
    const { R, I, rnd } = E;
    bFull(cv, (x, W, H) => {
      const h = bAnchor(E.pal), warm = bHueGap(h, 30) < 50, leak = E.dark ? bOklch(.5, .15, bDarkNear(h, warm ? -14 : 18)) : warm || bLch(E.pal.g)[1] < .02 ? '#ff7a3c' : bOklch(.74, .13, h + 24);
      x.globalCompositeOperation = 'lighten'; x.fillStyle = E.dark ? bOklch(.22, .02, bDarkHue(h)) : '#26222a'; x.fillRect(0, 0, W, H);
      if (!E.dark && warm){ x.globalCompositeOperation = 'soft-light'; x.fillStyle = 'rgba(255,196,120,.3)'; x.fillRect(0, 0, W, H); }
      const left = rnd() < .5, g = x.createLinearGradient(left ? 0 : W, H * R(0, 1), left ? W * R(.25, .5) : W * R(.5, .75), H * R(0, 1)); g.addColorStop(0, bAlpha(leak, .72)); g.addColorStop(.35, bAlpha(leak, .28)); g.addColorStop(1, bAlpha(leak, 0));
      x.globalCompositeOperation = 'screen'; x.fillStyle = g; x.fillRect(0, 0, W, H);
      x.globalCompositeOperation = 'source-over'; x.strokeStyle = 'rgba(255,255,255,.35)';
      for (let i = 0, n = I(5, 11); i < n; i++){ const px = W * rnd(); x.globalAlpha = R(.2, .7); x.lineWidth = R(.7, 1.8); x.beginPath(); x.moveTo(px, 0); for (let y = 0; y <= H; y += H / 10) x.lineTo(px + R(-3, 3), y); x.stroke(); }
      for (let i = 0, n = I(60, 130); i < n; i++){ x.globalAlpha = R(.25, .8); x.fillStyle = rnd() < .7 ? '#fff' : '#1a1410'; const s = Math.pow(rnd(), 3) * 7 + 1; x.beginPath(); x.ellipse(W * rnd(), H * rnd(), s, s * R(.3, 1), rnd() * 3, 0, 6.2832); x.fill(); }
      x.globalAlpha = .32; x.globalCompositeOperation = 'overlay'; x.fillStyle = bNoisePat(x); x.fillRect(0, 0, W, H);
    });
  },
  // 复古：褪色、泛黄、折痕
  retro(cv, E){
    const { R, I } = E;
    bFull(cv, (x, W, H) => {
      x.globalCompositeOperation = 'saturation'; x.globalAlpha = .5; x.fillStyle = '#808080'; x.fillRect(0, 0, W, H); x.globalAlpha = 1;
      x.globalCompositeOperation = E.dark ? 'screen' : 'multiply'; x.fillStyle = E.dark ? '#2a1c10' : '#f0d9ae'; x.fillRect(0, 0, W, H);
      const g = x.createRadialGradient(W / 2, H / 2, W * .35, W / 2, H / 2, H * .72); g.addColorStop(0, 'rgba(90,50,14,0)'); g.addColorStop(1, 'rgba(70,36,8,.5)'); x.globalCompositeOperation = 'multiply'; x.fillStyle = g; x.fillRect(0, 0, W, H);
      for (let i = 0, n = I(1, 3); i < n; i++){                         // 折过的印子
        const v = E.rnd() < .5, p = R(.3, .7) * (v ? W : H), w = 26; const q = v ? x.createLinearGradient(p - w, 0, p + w, 0) : x.createLinearGradient(0, p - w, 0, p + w);
        q.addColorStop(0, 'rgba(0,0,0,0)'); q.addColorStop(.48, 'rgba(60,36,10,.07)'); q.addColorStop(.5, 'rgba(255,248,228,.2)'); q.addColorStop(.56, 'rgba(255,248,228,.1)'); q.addColorStop(1, 'rgba(0,0,0,0)'); x.globalCompositeOperation = 'source-over'; x.fillStyle = q; v ? x.fillRect(p - w, 0, w * 2, H) : x.fillRect(0, p - w, W, w * 2);
      }
      x.globalAlpha = .22; x.globalCompositeOperation = 'overlay'; x.fillStyle = bNoisePat(x); x.fillRect(0, 0, W, H);
    });
  },
  // 磨砂：像隔着一层砂面看
  matte(cv, E){
    const seed = (E.rnd() * 4294967295) >>> 0, amp = E.R(1.2, 2.2) * E.u * (DPR > 1 ? 1 : .8);
    bPixels(cv, DPR > 1 ? .62 : 1, (im, w, h) => {
      const s = im.data, out = new ImageData(w, h), d = out.data, src = new Uint32Array(s.buffer), dst = new Uint32Array(d.buffer), r = mulberry32(seed), k = amp * 2;
      for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i++){
        const q = r(), xx = x + ((q * k * 2 - k) | 0), yy = y + ((q * 997 % 1 * k * 2 - k) | 0);
        dst[i] = src[(yy < 0 ? 0 : yy >= h ? h - 1 : yy) * w + (xx < 0 ? 0 : xx >= w ? w - 1 : xx)];
      }
      return out;
    });
    bFull(cv, (x, W, H) => { x.globalAlpha = .28; x.globalCompositeOperation = 'soft-light'; x.fillStyle = bNoisePat(x); x.fillRect(0, 0, W, H); });
  },
  // 油画：Kuwahara —— 每一点看四个角，取最匀的那个角的颜色，边就变成了笔触
  oil(cv, E){
    const fine = DPR > 1, R0 = Math.max(2, Math.round(E.R(2, 3.7) * E.u * (fine ? 1 : .72)));
    bPixels(cv, fine ? .5 : .72, (im, w, h) => {
      const s = im.data, W1 = w + 1, N = W1 * (h + 1), sr = new Float64Array(N), sg = new Float64Array(N), sb = new Float64Array(N), sl = new Float64Array(N);
      for (let y = 0; y < h; y++){ let a = 0, b = 0, c = 0, l2 = 0; for (let x = 0; x < w; x++){ const i = (y * w + x) * 4, r = s[i], g = s[i + 1], q = s[i + 2], l = r * .3 + g * .59 + q * .11; a += r; b += g; c += q; l2 += l * l; const o = (y + 1) * W1 + x + 1, p = y * W1 + x + 1; sr[o] = sr[p] + a; sg[o] = sg[p] + b; sb[o] = sb[p] + c; sl[o] = sl[p] + l2; } }
      const out = new ImageData(w, h), d = out.data;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
        let best = 1e18, br = 0, bg = 0, bb = 0;
        for (let q = 0; q < 4; q++){
          const x0 = Math.max(0, q & 1 ? x : x - R0), x1 = Math.min(w, (q & 1 ? x + R0 : x) + 1), y0 = Math.max(0, q & 2 ? y : y - R0), y1 = Math.min(h, (q & 2 ? y + R0 : y) + 1), n = (x1 - x0) * (y1 - y0);
          const A = y1 * W1 + x1, B2 = y0 * W1 + x1, C = y1 * W1 + x0, D = y0 * W1 + x0;
          const r = (sr[A] - sr[B2] - sr[C] + sr[D]) / n, g = (sg[A] - sg[B2] - sg[C] + sg[D]) / n, b = (sb[A] - sb[B2] - sb[C] + sb[D]) / n, l = r * .3 + g * .59 + b * .11, v = (sl[A] - sl[B2] - sl[C] + sl[D]) / n - l * l;
          if (v < best){ best = v; br = r; bg = g; bb = b; }
        }
        const i = (y * w + x) * 4; d[i] = br; d[i + 1] = bg; d[i + 2] = bb; d[i + 3] = 255;
      }
      return out;
    });
    // 一层画布的纹
    bFull(cv, (x, W, H) => { x.globalCompositeOperation = 'soft-light'; x.globalAlpha = .2; x.strokeStyle = '#000'; x.lineWidth = 1.2; x.beginPath(); for (let i = 0; i < W; i += 7){ x.moveTo(i, 0); x.lineTo(i, H); } for (let i = 0; i < H; i += 7){ x.moveTo(0, i); x.lineTo(W, i); } x.stroke(); x.globalAlpha = .3; x.fillStyle = bNoisePat(x); x.fillRect(0, 0, W, H); });
  },
  // 像素
  pixel(cv, E){
    const cell = E.I(3, 5) * E.u, lv = E.I(14, 20);
    bPixels(cv, 1 / (cell * DPR), im => { const d = im.data; for (let i = 0; i < d.length; i++) if (i % 4 !== 3) d[i] = Math.round(d[i] / 255 * lv) / lv * 255; }, false);
  },
  // 低画质：被转发了很多遍
  lowq(cv, E){
    const q = Math.min(1, E.R(.16, .24) * 2 / DPR);
    bPixels(cv, q, (im, w, h) => {
      const d = im.data;
      for (let by = 0; by < h; by += 8) for (let bx = 0; bx < w; bx += 8){                   // 一块一块的，色彩糊在一起
        let a = 0, b = 0, n = 0; const x1 = Math.min(w, bx + 8), y1 = Math.min(h, by + 8);
        for (let y = by; y < y1; y++) for (let x = bx; x < x1; x++){ const i = (y * w + x) * 4, l = d[i] * .3 + d[i + 1] * .59 + d[i + 2] * .11; a += d[i] - l; b += d[i + 2] - l; n++; }
        a /= n; b /= n; const jit = (E.rnd() - .5) * 9;
        for (let y = by; y < y1; y++) for (let x = bx; x < x1; x++){ const i = (y * w + x) * 4; let l = d[i] * .3 + d[i + 1] * .59 + d[i + 2] * .11; l = Math.round((l + jit) / 9) * 9; d[i] = l + a; d[i + 2] = l + b; d[i + 1] = l - (a * .3 + b * .11) / .59; }
      }
    });
  },
  // 录像带
  vhs(cv, E){
    const { R, I, rnd, u } = E, src = bCopy(cv), d = R(5, 12) * u * DPR / 2, W = cv.width, H = cv.height;
    const ch = col => { const c = bCopy(src), x = c.getContext('2d'); x.globalCompositeOperation = 'multiply'; x.fillStyle = col; x.fillRect(0, 0, W, H); x.globalCompositeOperation = 'source-over'; return c; };
    const r = ch('#ff0000'), gb = ch('#00ffff');
    bFull(cv, x => {
      x.fillStyle = '#000'; x.fillRect(0, 0, W, H); x.globalCompositeOperation = 'lighter'; x.drawImage(r, -d, 0); x.drawImage(gb, d, 0); x.globalCompositeOperation = 'source-over';
      const snap = bCopy(cv);
      for (let i = 0, n = I(3, 6); i < n; i++){ const y = H * rnd() | 0, h = R(10, 70) * u | 0, dx = R(-60, 60) * u; x.drawImage(snap, 0, y, W, h, dx, y, W, h); x.fillStyle = `rgba(255,255,255,${R(.05, .18)})`; x.fillRect(0, y, W, R(1, 5)); }
      bFree(snap);
      x.fillStyle = 'rgba(0,0,0,.2)'; for (let y = 0; y < H; y += bPx(6)) x.fillRect(0, y, W, bPx(2.4));
      x.globalCompositeOperation = 'overlay'; x.globalAlpha = .4; x.fillStyle = bNoisePat(x); x.fillRect(0, 0, W, H);
    });
    bFree(src); bFree(r); bFree(gb);
  },
  // 长虹玻璃：整张隔着一排竖棱看
  reeded(cv, E){
    const src = bCopy(cv), W = cv.width, H = cv.height, p = E.R(30, 64) * E.u * DPR / 2 * 1.6, from = E.maybe(.6) ? W * E.R(.36, .6) : 0;
    bFull(cv, x => bReed(x, src, from, 0, W - from, H, p, E)); bFree(src);
  },
  // 字幕：上下黑边，底下一行白字黄字
  subtitle(cv, E){
    const W = cv.width, H = cv.height, src = bCopy(cv), k = .8, top = H * .075;
    bFull(cv, x => {
      x.fillStyle = '#060606'; x.fillRect(0, 0, W, H); const h = H * k, full = W / H > 1;
      const w = full ? W * k : W, hh = full ? h : h; x.save(); x.beginPath(); x.rect((W - w) / 2, top, w, hh); x.clip(); const s = Math.max(w / W, hh / H); x.drawImage(src, (W - W * s) / 2, top + (hh - H * s) / 2, W * s, H * s); x.restore();
      const t = E.subtitle || ''; if (!t) return;
      let s1 = 40 * E.u * DPR; x.font = `${s1}px ${E.fonts.body}`; const tw = x.measureText(t).width; if (tw > W * .86){ s1 *= W * .86 / tw; x.font = `${s1}px ${E.fonts.body}`; }
      x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = E.maybe(.5) ? '#f4e27a' : '#f5f2ea'; x.strokeStyle = 'rgba(0,0,0,.8)'; x.lineWidth = s1 * .09; x.lineJoin = 'round'; const y = top + hh + (H - top - hh) * .46; x.strokeText(t, W / 2, y); x.fillText(t, W / 2, y);
    });
    bFree(src);
  },
};
// 竖棱：每一条把背后的画面压窄一点、错开一点，再各有一道明暗
function bReed(x, src, X, Y, W, H, p, E){
  for (let i = 0; i < W; i += p){
    const w = Math.min(p, W - i), take = p * 2.3, sx = X + i + w / 2 - take / 2;
    const a = Math.max(0, sx), b = Math.min(src.width, sx + take); if (b - a > 1) x.drawImage(src, a, Y, b - a, H, X + i, Y, w + .6, H);
    const g = x.createLinearGradient(X + i, 0, X + i + p, 0); g.addColorStop(0, 'rgba(0,0,0,.2)'); g.addColorStop(.18, 'rgba(255,255,255,.2)'); g.addColorStop(.5, 'rgba(255,255,255,0)'); g.addColorStop(.9, 'rgba(0,0,0,.05)'); g.addColorStop(1, 'rgba(0,0,0,.22)');
    x.fillStyle = g; x.fillRect(X + i, Y, w + .6, H);
  }
}
const B_POST_ORDER = ['oil', 'matte', 'swirl', 'gauss', 'defocus', 'reeded', 'multiply', 'soft', 'halation', 'bokeh', 'pearl', 'spark', 'retro', 'film', 'vhs', 'lowq', 'pixel', 'negate', 'subtitle'];
const B_POST_W = { oil: 2, matte: 3, swirl: 2, gauss: 3, defocus: 1, reeded: 3, multiply: 3, soft: 3, halation: 3, bokeh: 3, pearl: 3, spark: 2, retro: 3, film: 4, vhs: 2, lowq: 1, pixel: 1, negate: 1, subtitle: 2 };

// ── 一片一片的：毛玻璃、长虹玻璃、马赛克、模糊、水珠 ────────────────
// 它们看的是「已经画到这一步的画面」，所以必须垫在字上面；能拖、能放大、能转。
function bSnapshot(x){ const c = bCanvas(x.canvas.width, x.canvas.height); c.getContext('2d').drawImage(x.canvas, 0, 0); return c; }
function bPaneClip(x, it, E, fn, round){
  // 进来时坐标系已经在它的中心转好了；取景用的是没转的整张画面
  const src = bSnapshot(x), w = it.r * 2, h = it.q ? it.r * 2 * it.q : (it.t || 300) * E.u, m = x.getTransform();
  x.save(); x.beginPath();
  if (round === 'circle') x.arc(0, 0, it.r, 0, 6.2832);
  else { const k = Math.min(round || 0, w / 2, h / 2); x.moveTo(-w / 2 + k, -h / 2); x.arcTo(w / 2, -h / 2, w / 2, h / 2, k); x.arcTo(w / 2, h / 2, -w / 2, h / 2, k); x.arcTo(-w / 2, h / 2, -w / 2, -h / 2, k); x.arcTo(-w / 2, -h / 2, w / 2, -h / 2, k); x.closePath(); }
  x.clip(); x.setTransform(1, 0, 0, 1, 0, 0); fn(src, m, w, h); x.restore(); bFree(src);
}
Object.assign(BLIND_ITEMS, {
  frost(x, it, E, c){
    bPaneClip(x, it, E, src => { const b = bBlur(src, bPx(34 * E.u)); x.globalAlpha = 1; x.drawImage(b, 0, 0); bFree(b); x.globalAlpha = 1; x.fillStyle = E.dark ? 'rgba(255,255,255,.09)' : 'rgba(255,255,255,.3)'; x.fillRect(0, 0, x.canvas.width, x.canvas.height); x.globalCompositeOperation = 'soft-light'; x.globalAlpha = .4; x.fillStyle = bNoisePat(x); x.fillRect(0, 0, x.canvas.width, x.canvas.height); }, 26 * E.u);
    const w = it.r * 2, h = it.q ? it.r * 2 * it.q : (it.t || 300) * E.u, k = 26 * E.u; x.strokeStyle = 'rgba(255,255,255,.5)'; x.lineWidth = 1.4 * E.u; x.beginPath(); x.moveTo(-w / 2 + k, -h / 2); x.arcTo(w / 2, -h / 2, w / 2, h / 2, k); x.arcTo(w / 2, h / 2, -w / 2, h / 2, k); x.arcTo(-w / 2, h / 2, -w / 2, -h / 2, k); x.arcTo(-w / 2, -h / 2, w / 2, -h / 2, k); x.closePath(); x.stroke();
  },
  reed(x, it, E){ bPaneClip(x, it, E, src => bReed(x, src, 0, 0, src.width, src.height, 38 * E.u * DPR / 2 * 1.6, E)); },
  mosaic(x, it, E){
    bPaneClip(x, it, E, src => { const s = 1 / (E.R(13, 22) * E.u * DPR), c = PLATFORM.canvas(Math.max(2, Math.round(src.width * s)), Math.max(2, Math.round(src.height * s))), y = c.getContext('2d'); y.imageSmoothingQuality = 'high'; y.drawImage(src, 0, 0, c.width, c.height); x.imageSmoothingEnabled = false; x.drawImage(c, 0, 0, src.width, src.height); });
  },
  blurp(x, it, E){
    const src = bSnapshot(x), b = bBlur(src, bPx(34 * E.u)), y = b.getContext('2d'), m = x.getTransform();
    y.globalCompositeOperation = 'destination-in'; y.setTransform(m); const g = y.createRadialGradient(0, 0, it.r * .45, 0, 0, it.r); g.addColorStop(0, '#000'); g.addColorStop(1, 'rgba(0,0,0,0)'); y.fillStyle = g; y.beginPath(); y.arc(0, 0, it.r * 4, 0, 6.2832); y.fill(); y.setTransform(1, 0, 0, 1, 0, 0); y.globalCompositeOperation = 'source-over';
    x.save(); x.setTransform(1, 0, 0, 1, 0, 0); x.drawImage(b, 0, 0); x.restore(); bFree(src); bFree(b);
  },
  // 水珠：底下的字被它放大
  lens(x, it, E, c){
    bPaneClip(x, it, E, (src, m) => { const cx = m.e, cy = m.f, n = 14; for (let i = 0; i < n; i++){ const r = it.r * DPR * (1 - i / n), k = 1.12 + .5 * (i / n); x.save(); x.beginPath(); x.arc(cx, cy, r, 0, 6.2832); x.clip(); x.setTransform(k, 0, 0, k, cx * (1 - k), cy * (1 - k)); x.drawImage(src, 0, 0); x.restore(); } }, 'circle');
    const g = x.createRadialGradient(-it.r * .2, -it.r * .25, it.r * .2, 0, 0, it.r); g.addColorStop(0, 'rgba(255,255,255,.1)'); g.addColorStop(.78, 'rgba(255,255,255,0)'); g.addColorStop(.95, 'rgba(0,0,0,.18)'); g.addColorStop(1, 'rgba(0,0,0,.3)'); x.fillStyle = g; x.beginPath(); x.arc(0, 0, it.r, 0, 6.2832); x.fill();
    x.fillStyle = 'rgba(255,255,255,.85)'; x.beginPath(); x.ellipse(-it.r * .4, -it.r * .5, it.r * .2, it.r * .09, -.7, 0, 6.2832); x.fill(); x.strokeStyle = 'rgba(255,255,255,.5)'; x.lineWidth = it.r * .035; x.beginPath(); x.arc(0, 0, it.r * .84, .5, 1.6); x.stroke();
  },
});
B_SHAPES.pane = ['frost', 'reed', 'mosaic', 'blurp', 'lens'];
const B_PANES = B_SHAPES.pane;

// ════════════════════════════════════════════════════════════════════
//  9. 版式盲盒 ③ 台面：尺、格、摆字的手
// ════════════════════════════════════════════════════════════════════
// B 的坐标是版面像素（1080×1350），设备像素在效果层才乘 DPR。
// 一个字的 op：{ k:'g', t, x, y, s, r, f, c, cell?, fit?, at, src }
//   at/src ＝ 它是原文（或标题）里的第几个字。人选中改样式的时候，靠它找到画面上的是哪一个 ——
//   样式在排完之后才盖上去（blindStyle），所以改几个字，版面一动不动。
function blindStage(st, S, rnd, pal, fonts, mk, margin = .056){
  const W = S.w, H = S.h, M = Math.round(Math.min(W, H) * margin);
  const ctx = (mk || newMeasure)();
  const R = (a, b) => a + (b - a) * rnd();
  const I = (a, b) => Math.floor(R(a, b + 1));
  const P = arr => arr[Math.floor(rnd() * arr.length)];
  const maybe = p => rnd() < p;
  const B = { st, W, H, M, u: Math.min(W, H) / 1080, rnd, R, I, P, maybe, pal, fonts: { ...fonts }, layers: [], items: [],
              dark: relLum(hex2rgb(pal.g)) < .3 };

  const emCache = new Map();
  B.em = (t, f = 'hero') => {
    if (!/[ -~]/.test(t)) return [...t].length;
    const k = f + B.fonts[f] + t;
    if (!emCache.has(k)){ ctx.font = bFont(B, f, 100); emCache.set(k, ctx.measureText(t).width / 100); }
    return emCache.get(k);
  };
  // 一串单位的总宽（em）。gap 是字间距（em）
  B.emOf = (units, f = 'hero', gap = 0) => units.reduce((a, x, i) => a + B.em(x.t, f) + (i ? gap + (x.sp ? .28 : 0) : 0), 0);
  B.layer = (role, o = {}) => { const l = { role, ops: [], fx: [], ...o }; B.layers.push(l); return l; };
  // u 可以是一个单位（带着原文下标），也可以就是一个字符串
  B.glyph = (l, u, x, y, s, o = {}) => { const op = { k: 'g', t: u.t || u, x, y, s, f: 'hero', ...(u.at !== undefined ? { at: u.at, src: u.src || 'text' } : {}), ...o }; l.ops.push(op); return op; };

  // 横着放一串，cx 是中心（align:'left' 时是左边）
  B.row = (l, units, x, y, s, { f = 'hero', gap = 0, align = 'center', ...o } = {}) => {
    const w = B.emOf(units, f, gap) * s;
    let px = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
    units.forEach((u, i) => {
      if (i) px += (gap + (u.sp ? .28 : 0)) * s;
      const ew = B.em(u.t, f) * s;
      B.glyph(l, u, px + ew / 2, y, s, { f, ...o });
      px += ew;
    });
    return w;
  };
  // 竖着放一串，从 top 往下；西文整词转 90°
  B.colLen = (units, f = 'hero', gap = 0) => units.reduce((a, x, i) => a + (x.latin ? B.em(x.t, f) : 1) + (i ? gap + (x.sp ? .25 : 0) : 0), 0);
  B.col = (l, units, x, top, s, { f = 'hero', gap = 0, ...o } = {}) => {
    let py = top;
    units.forEach((u, i) => {
      if (i) py += (gap + (u.sp ? .25 : 0)) * s;
      const len = (u.latin ? B.em(u.t, f) : 1) * s;
      B.glyph(l, u, x, py + len / 2, s, { f, r: u.latin ? Math.PI / 2 : 0, ...o });
      py += len;
    });
    return py - top;
  };
  // 拉伸着放：一串字撑满一个矩形（横着排）。每个字按字框拉，「一」不会被拉成一堵墙
  B.fill = (l, units, x, y, w, h, { f = 'hero', pad = 0, ...o } = {}) => {
    const em = B.emOf(units, f, 0); let px = x;
    units.forEach((u, i) => {
      if (i && u.sp) px += .28 / em * w;
      const cw = B.em(u.t, f) / em * w;
      B.glyph(l, u, px + cw / 2, y + h / 2, 100, { f, cell: [Math.max(4, cw - pad * 2), Math.max(4, h)], ...o });
      px += cw;
    });
  };
  // 同上，竖着撑满
  B.fillCol = (l, units, x, y, w, h, { f = 'hero', pad = 0, ...o } = {}) => {
    const n = B.colLen(units, f); let py = y;
    units.forEach(u => {
      const len = (u.latin ? B.em(u.t, f) : 1) / n * h;
      B.glyph(l, u, x + w / 2, py + len / 2, 100, u.latin ? { f, r: Math.PI / 2, cell: [len - pad * 2, w], ...o } : { f, cell: [w, Math.max(4, len - pad * 2)], ...o });
      py += len;
    });
  };
  // 词缝：大字、诗行断开的时候，不许断在一个词当中
  let seams = null;
  const isSeam = u => { if (u.at === undefined || u.src === 'title') return true; if (!seams){ seams = new Set(); try { for (const s of new Intl.Segmenter('zh', { granularity: 'word' }).segment(B.text)) seams.add(s.index); } catch { return true; } } return seams.has(u.at) && !'着了过的地得们吗呢吧啊'.includes(u.t); };
  // 拆成差不多齐的几行
  B.split = (units, n) => {
    const out = [], total = B.emOf(units); let cur = [], acc = 0;
    const at = [0]; for (const u of units) at.push(at[at.length - 1] + B.em(u.t));
    const cuts = []; for (let k = 1; k < n; k++){ let best = -1, cost = 1e9; for (let i = (cuts[cuts.length - 1] || 0) + 1; i < units.length; i++){ const c = Math.abs(at[i] - total * k / n) + (isSeam(units[i]) && !units[i].punct ? 0 : 1.7); if (c < cost){ cost = c; best = i; } } if (best > 0) cuts.push(best); }
    units.forEach((u, i) => { if (cuts.includes(i)){ out.push(cur); cur = []; } cur.push(u); });
    out.push(cur);
    return out;
  };

  // 正文块：在框里找一个最大的、放得下全文的字号。放不下返回 null。
  // 折行走拾句自己的 buildItems（避头尾、段落都在里头）。
  B.body = (x, y, w, h, { vertical = false, max = 34, min = 22, va = 'top', ha, align = 'left', c = pal.i, layer } = {}) => {
    if (B.solo) return { x, y, w, h: 0, s: max };                   // 就这么一句，主角就是全文，不必再抄一遍
    // 短的、有好几小句的，按诗排：一句一行，长句在词缝里折，行首错落
    if (B.verse === undefined) B.verse = B.cjk && B.N <= 100 && B.clauses.length >= 2 && B.clauses.length <= 10 && maybe(.8) ? P(['flush', 'stair', 'loose', 'loose', 'hang']) : '';
    if (B.verse && w >= 90 && h >= 50){ const got = B.verseBody(x, y, w, h, { vertical, max: Math.round(max * 1.12), min, va, ha, align, c, layer }); if (got) return got; }
    const text = B.text, flowOf = items => items.reduce((a, it) => a + it.h, 0);
    const tryAt = (s, side) => {
      ctx.font = `${s}px ${B.fonts.body}`;
      const { items } = buildItems(ctx, text, side, s, vertical, null), flow = flowOf(items);
      return flow <= (vertical ? w : h) + s * .7 ? { s, items, flow } : null;
    };
    if (w < 90 || h < 50) return null;
    if (B.warm) max = Math.round(max * 1.14);
    if (B.N > 130) min = Math.max(min, 22);
    if (B.minBody && B.N < 150){ min = Math.max(min, Math.min(B.minBody, 34)); max = Math.max(max, min + 8); }      // 整张要过油画、旋焦的，小字撑不住
    const side0 = vertical ? h : w;
    let lo = min, hi = max, got = null;
    while (lo <= hi){ const mid = (lo + hi) >> 1, r = tryAt(mid, side0); if (r){ got = r; lo = mid + 1; } else hi = mid - 1; }
    if (!got) return null;
    // 末行只剩一两个字：先把版口收窄一点，不行就字号小一点
    const tailOk = items => { const rows = items.filter(it => !it.gap); return rows.length < 2 || bUnits(rows[rows.length - 1].text).filter(q => !q.punct).length > 2; };
    if (text.length < 420 && !tailOk(got.items))
      search: for (let s = got.s; s >= Math.max(min, got.s - 5); s--) for (let k = 0; k < 8; k++){
        const r = tryAt(s, side0 * (1 - .03 * k)); if (r && tailOk(r.items)){ got = r; break search; }
      }
    const { s, items, flow } = got, l = layer || B.layer('body', { read: true });
    l.read = true;
    let cross = 0;
    for (const it of items) if (!it.gap){
      ctx.font = `${s}px ${B.fonts.body}`;
      it.len = vertical ? vAdvance(ctx, it.text, s) : ctx.measureText(it.text).width;
      cross = Math.max(cross, it.len);
    }
    if (vertical){
      let px = (ha === 'left' ? x + flow : ha === 'center' ? x + (w + flow) / 2 : x + w);
      const y0 = va === 'bottom' ? y + h - cross : va === 'mid' ? y + (h - cross) / 2 : y, right = px;
      for (const it of items){ px -= it.h; if (!it.gap) l.ops.push({ k: 'v', t: it.text, at: it.at, src: 'text', x: px, y: y0, s, len: it.len, c }); }
      return { x: px, y: y0, w: right - px, h: cross, s, layer: l };
    }
    const used = flow - s * .72, x0 = ha === 'right' ? x + w - cross : ha === 'center' ? x + (w - cross) / 2 : x;
    let py = va === 'bottom' ? y + h - used : va === 'mid' ? y + (h - used) / 2 : y;
    const y0 = py;
    for (const it of items){
      if (!it.gap) l.ops.push({ k: 'l', t: it.text, at: it.at, src: 'text', x: x0 + alignOffset(align, cross, it.len), y: py, s, len: it.len, c });
      py += it.h;
    }
    return { x: x0, y: y0, w: cross, h: used, s, layer: l };
  };

  B.verseBody = (x, y, w, h, { vertical, max, min, va, ha, align, c, layer }) => {
    if (B.minBody){ min = Math.max(min, Math.min(B.minBody, 34)); max = Math.max(max, min + 10); }
    const side = vertical ? h : w, cross = vertical ? w : h, parts = [];
    for (const m of B.text.matchAll(/[^，。；、：！？!?…\n]+[，。；、：！？!?…]*[”」』）’]*/g)){ const raw = m[0], t = raw.trim().replace(/[，。；、：]+$/, ''); if (t) parts.push({ t, at: m.index + raw.length - raw.trimStart().length }); }
    const wid = t => bUnits(t).reduce((a, u) => a + (u.latin ? B.em(u.t, 'body') : 1), 0);
    const cut = (p, most) => {
      if (wid(p.t) <= most) return [p];
      const us = bUnits(p.t), n = Math.ceil(wid(p.t) / most), rows = B.split(us.map(u => ({ ...u, at: u.at + p.at })), n);
      return rows.map((r, i) => { const a = r[0].at - p.at, b = i + 1 < rows.length ? rows[i + 1][0].at - p.at : p.t.length; return { t: p.t.slice(a, b).trimEnd(), at: p.at + a }; });
    };
    const lead = P([1.75, 1.95, 2.2]), sd = rnd();
    for (const most of [13, 10, 8, 7]){
      const lines = parts.flatMap(p => cut(p, most)), n = lines.length; if (n < 2) return null;
      const ind = lines.map((_, i) => B.verse === 'stair' ? i * 1.5 : B.verse === 'hang' ? (i ? 2 : 0) : B.verse === 'loose' ? Math.floor((Math.sin(i * 12.9898 + sd * 78.233) * 43758.5453 % 1 + 1) % 1 * 5) : 0), long = Math.max(...lines.map((l, i) => wid(l.t) + ind[i]));
      const s = Math.floor(Math.min(max, side / long, cross / (n * lead - (lead - 1)))); if (s < min) continue;
      const l = layer || B.layer('body', { read: true }); l.read = true;
      const pitch = s * lead, flow = pitch * n - s * (lead - 1), sz = long * s; ctx.font = `${s}px ${B.fonts.body}`;
      if (vertical){
        let px = ha === 'left' ? x + flow : ha === 'center' ? x + (w + flow) / 2 : x + w; const right = px, y0 = va === 'bottom' ? y + h - sz : va === 'mid' ? y + (h - sz) / 2 : y;
        lines.forEach((q, i) => { l.ops.push({ k: 'v', t: q.t, at: q.at, src: 'text', x: px - s, y: y0 + ind[i] * s, s, len: vAdvance(ctx, q.t, s), c }); px -= pitch; });
        return { x: right - flow, y: y0, w: flow, h: sz, s, layer: l };
      }
      const x0 = ha === 'right' ? x + w - sz : ha === 'center' ? x + (w - sz) / 2 : x, y0 = va === 'bottom' ? y + h - flow : va === 'mid' ? y + (h - flow) / 2 : y;
      lines.forEach((q, i) => { const len = ctx.measureText(q.t).width; l.ops.push({ k: 'l', t: q.t, at: q.at, src: 'text', x: x0 + (B.verse === 'flush' ? alignOffset(align, sz, len) : ind[i] * s), y: y0 + pitch * i, s, len, c }); });
      return { x: x0, y: y0, w: sz, h: flow, s, layer: l };
    }
    return null;
  };

  // 小字：题头、出处、日期（还有没当上主角的标题）。它们是版面的一部分 —— 钉在格子上的几枚钉子。
  B.metaItems = () => {
    const out = [];
    if (st.showHeader && (st.headText || '').trim()) out.push({ t: st.headText.trim(), id: 'head' });
    if (st.showDate && (st.date || '').trim()) out.push({ t: st.date.trim(), id: 'date' });
    if (st.showSource && (st.source || '').trim()) out.push({ t: ((st.sourcePrefix || '') + st.source).trim(), id: 'src' });
    if ((st.title || '').trim() && !B.titleUsed) out.push({ t: st.title.trim(), id: 'title' });
    return out;
  };
  const MS = 18 * B.u;
  // mode：corners 四角 ／ top 顶上一行 ／ foot 底下一行 ／ side 侧边竖着
  B.metaRoom = mode => {
    const n = B.metaItems(); if (!n.length) return { t: M, b: M };
    const line = M + MS * 1.9;
    if (mode === 'top') return { t: line + MS * .6, b: M };
    if (mode === 'foot') return { t: M, b: line + MS * .6 };
    if (mode === 'side') return { t: M, b: M };
    if (['left', 'right', 'center'].includes(mode)) return { t: n.some(i => i.id === 'head') ? line : M, b: M + MS * (1.5 * n.filter(i => i.id !== 'head').length + .5) };
    return { t: n.some(i => i.id === 'head' || i.id === 'date') ? line : M, b: n.some(i => i.id === 'src' || i.id === 'title') ? line : M };
  };
  B.placeMeta = mode => {
    const items = B.metaItems(); if (!items.length) return;
    const l = B.layer('meta'), on = B.metaOn || {}, soft = bMix(pal.g, pal.i, .82), MX = B.metaBox ? B.metaBox.x : M, MW = B.metaBox ? B.metaBox.w : W - M * 2;
    const put = (it, x, y, align, maxW, c) => {
      let s = MS; ctx.font = bFont(B, 'meta', s); let len = ctx.measureText(it.t).width;
      if (len > maxW){ s = Math.max(12.5, s * maxW / len); ctx.font = bFont(B, 'meta', s); len = ctx.measureText(it.t).width; }
      l.ops.push({ k: 'l', t: it.t, f: 'meta', x: align === 'right' ? x - len : x, y, s, len, c: c || (it.id === 'title' ? pal.i : soft) });
    };
    const top = M * .86, bot = H - M * .86 - MS * 1.05;
    if (mode === 'side'){
      const t = items.map(i => i.t.replace(/^—— ?/, '')).join('　　'); let s = MS * .95;
      ctx.font = bFont(B, 'meta', s); let len = ctx.measureText(t).width; if (len > H - M * 2){ s *= (H - M * 2) / len; len = H - M * 2; }
      B.glyph(l, t, W - M * .46, M + len / 2, s, { f: 'meta', r: Math.PI / 2, c: on.side || soft, len });
      return;
    }
    if (['left', 'right', 'center'].includes(mode)){
      // 题头在上；标题、出处、日期叠在下头，一行一件
      const x = mode === 'left' ? MX : mode === 'right' ? MX + MW : 0, al = mode === 'right' ? 'right' : 'left', low = ['title', 'src', 'date'].map(id => items.find(i => i.id === id)).filter(Boolean), head = items.find(i => i.id === 'head');
      if (head) put(head, mode === 'center' ? MX : x, top, al, MW * .5, on.top);
      low.forEach((it, i) => { const y = bot - MS * 1.5 * (low.length - 1 - i); if (mode === 'center'){ ctx.font = bFont(B, 'meta', MS); const len = Math.min(MW, ctx.measureText(it.t).width); put(it, MX + (MW - len) / 2, y, 'left', MW, on.bot); } else put(it, x, y, al, MW * .7, on.bot); });
      return;
    }
    if (mode === 'top' || mode === 'foot'){
      // 一行里按格子排开：第一件靠左，最后一件靠右，中间的落在列线上
      const y = mode === 'top' ? top : bot, n = items.length;
      items.forEach((it, i) => put(it, n === 1 ? MX : MX + MW * [0, n === 2 ? 1 : n === 3 ? .5 : .34, n === 3 ? 1 : .67, 1][i], y, i && i === n - 1 ? 'right' : 'left', MW / n - 14, on[mode]));
      return;
    }
    for (const it of items){
      if (it.id === 'head') put(it, MX, top, 'left', MW * .45, on.top);
      if (it.id === 'date') put(it, MX + MW, top, 'right', MW * .45, on.top);
      if (it.id === 'src') put(it, MX, bot, 'left', MW * .6, on.bot);
      if (it.id === 'title') put(it, MX + MW, bot, 'right', MW * .36, on.bot);
    }
  };
  B.ctx = ctx;
  return B;
}
const bFont = (B, f, s) => `${(B.fonts[f + 'W'] || '')}${s}px ${B.fonts[f] || B.fonts.body}`;

// 不等宽的一叠行：把单位按顺序灌进去。灌不完返回 null。
function bFlow(B, units, s, lines, f = 'body', gap = 0){
  const out = []; let i = 0;
  for (const ln of lines){
    let x = ln.x0, n = 0;
    while (i < units.length){
      const u = units[i], w = (B.em(u.t, f) + gap + (n && u.sp ? .28 : 0)) * s;
      const hang = u.punct && NO_START.includes(u.t[0]);
      if (n && x + w > ln.x1 + (hang ? s * .7 : .5)){
        // 句读不站行首：挂不住的，就把前一个字一起带下去
        while (n > 1 && units[i].punct && NO_START.includes(units[i].t[0])){ const back = out.pop(); i--; n--; x = back.x - B.em(back.u.t, f) * s / 2; }
        break;
      }
      if (!n && w > ln.x1 - ln.x0 + s * .4) break;                     // 这行窄得一个也放不下，空过去
      if (n && u.punct && NO_END.includes(u.t) && x + w * 2 > ln.x1) break;
      if (n && u.sp) x += .28 * s;
      const ew = B.em(u.t, f) * s;
      out.push({ u, x: x + ew / 2, y: ln.y, line: ln, i });
      x += ew + gap * s; i++; n++;
    }
    ln.n = n; ln.end = x;
    if (i >= units.length) return out;
  }
  return null;
}

// ════════════════════════════════════════════════════════════════════
//  9. 版式盲盒 ④ 方案：每一种都是一张排好的实验字体海报
// ════════════════════════════════════════════════════════════════════
// 🔑 一种方案只管字怎么站：用哪类字、多大的反差、落在哪儿。底、光、质地、修图归 blind-looks。
//    图形和线条一律不进盲盒，人想要自己添。
// face ＝ 主角用哪一类字（blind-text 的 B_TYPE）；fx ＝ 允许再叠一道的效果（可没有）；
// dup  ＝ 主角是从正文里另抄出来的，正文仍有全文。
const BLIND_COMPS = [
  // ── 全文就是画面 ────────────────────────────────────────────────
  { id: 'block', w: 6, face: ['heavySans', 'heavySans', 'heavySerif'], fx: ['cuts', 'melt'],
    ok: B => B.clauses.length >= 2 && B.clauses.length <= 9 && B.N <= 78 && B.cjk, run(B){
    // 满版：一句一行，每行撑满两边，高矮悬殊
    const { R, P, maybe, pal, A } = B, rows = B.clauses.flatMap(c => c.n > 11 ? B.split(c.full, 2) : [c.full]), n = rows.length, gap = R(8, 16) * B.u;
    const q = R(1.28, 1.75), mode = P(['ramp', 'fall', 'one', 'fib', 'fib']), big = B.I(0, n - 1);
    let hs = rows.map((_, i) => mode === 'ramp' ? Math.pow(q, i) : mode === 'fall' ? Math.pow(q, n - 1 - i) : mode === 'one' ? (i === big ? n * 1.1 : 1) : P([1, 1, 1.6, 2.6, 4.2]));
    const cw = rows.map(r => A.w / B.emOf(r)), H = A.h - gap * (n - 1);
    for (let k = 0; k < 6; k++){ const s = hs.reduce((a, b) => a + b, 0); hs = hs.map((h, i) => Math.max(cw[i] * .42, Math.min(cw[i] * 4.6, h / s * H))); }
    const sum = hs.reduce((a, b) => a + b, 0); if (Math.abs(sum - H) > H * .03 || Math.min(...hs) < 26) return false;
    const l = B.layer('hero', { read: true, gentle: true }), bars = maybe(.2), hit = maybe(.55) ? rows.findIndex((r, i) => B.keyClause && r.includes(B.keyClause.units[0])) : -1;
    let y = A.y;
    rows.forEach((r, i) => {
      const on = bars && i % 2 === 1;
      if (on) l.ops.push({ k: 'r', x: 0, y: y - gap / 2, w: B.W, h: hs[i] + gap, c: i === hit ? pal.a : pal.i });
      B.fill(l, r, A.x, y, A.w, hs[i], { pad: cw[i] * .03, c: on ? pal.g : i === hit ? pal.a : pal.i });
      y += hs[i] + gap;
    });
    if (bars) l.bleed = l.onAccent = true;
    return true;
  } },

  { id: 'vblock', w: 4, face: ['heavySerif', 'heavySans'], fx: ['cuts', 'melt'],
    ok: B => B.cjk && B.clauses.length >= 2 && B.clauses.length <= 8 && B.N <= 64, run(B){
    // 竖满版：一句一列，从右往左，列列撑到底，宽窄悬殊
    const { R, P, pal, A } = B, cols = B.clauses.flatMap(c => c.n > 12 ? B.split(c.full, 2) : [c.full]), n = cols.length, gap = R(10, 20) * B.u;
    const ch = cols.map(c => A.h / B.colLen(c)), W = A.w - gap * (n - 1), q = R(1.3, 1.8), mode = P(['ramp', 'fall', 'fib', 'fib']);
    let ws = cols.map((_, i) => mode === 'ramp' ? Math.pow(q, i) : mode === 'fall' ? Math.pow(q, n - 1 - i) : P([1, 1, 1.6, 2.8, 4]));
    for (let k = 0; k < 6; k++){ const s = ws.reduce((a, b) => a + b, 0); ws = ws.map((w, i) => Math.max(ch[i] * .4, Math.min(ch[i] * 3.4, w / s * W))); }
    const sum = ws.reduce((a, b) => a + b, 0); if (Math.abs(sum - W) > W * .04 || Math.min(...ws) < 26) return false;
    const l = B.layer('hero', { read: true, gentle: true }), hit = B.maybe(.55) ? cols.findIndex(c => B.keyClause && c.includes(B.keyClause.units[0])) : -1;
    let x = A.x + A.w;
    cols.forEach((c, i) => { x -= ws[i]; B.fillCol(l, c, x, A.y, ws[i], A.h, { pad: ch[i] * .03, c: i === hit ? pal.a : pal.i }); x -= gap; });
    return true;
  } },

  { id: 'pack', w: 5, face: ['heavySans', 'heavySerif'], fx: ['cuts', 'misreg'],
    ok: B => B.cjk && B.clauses.length >= 3 && B.clauses.length <= 9 && B.clauses.every(c => c.n <= 13), run(B){
    // 回旋：一横一竖，贴着往里卷，把纸卷满
    const { R, maybe, pal, A } = B, gap = R(12, 24) * B.u, l = B.layer('hero', { read: true, gentle: true }), cs = B.clauses, n = cs.length;
    let r = { x: A.x, y: A.y, w: A.w, h: A.h }, horiz = maybe(.6);
    for (let i = 0; i < n; i++){
      const c = cs[i], last = i === n - 1, col = c === B.keyClause ? pal.a : pal.i, left = n - i;
      if (horiz){
        const natural = r.w / B.emOf(c.full), h = last ? Math.min(r.h, natural * 2.4) : Math.min(natural * R(.9, 1.5), r.h / left * R(1.1, 1.9), r.h * .62);
        if (h < 30 || natural < 20) return false;
        B.fill(l, c.full, r.x, r.y, r.w, h, { pad: natural * .03, c: col }); r = { x: r.x, y: r.y + h + gap, w: r.w, h: r.h - h - gap };
      } else {
        const natural = r.h / B.colLen(c.full), w = last ? Math.min(r.w, natural * 2.2) : Math.min(natural * R(.9, 1.4), r.w / left * R(1.1, 1.9), r.w * .6);
        if (w < 30 || natural < 20) return false;
        B.fillCol(l, c.full, r.x + r.w - w, r.y, w, r.h, { pad: natural * .03, c: col }); r = { x: r.x, y: r.y, w: r.w - w - gap, h: r.h };
      }
      if (!last && (r.w < 60 || r.h < 60)) return false;
      horiz = !horiz;
    }
    return true;
  } },

  { id: 'steps', w: 4, face: ['lightSerif', 'heavySans', 'serif', 'heavySerif'], fx: ['melt', 'drift'],
    ok: B => B.clauses.length >= 2 && B.clauses.length <= 9 && B.N <= 96, run(B){
    // 骰子：落点都在六栏的格线上，字只有三个号，大的那几个字贴着纸边
    const { P, I, maybe, pal, A } = B, rows = B.clauses.flatMap(c => c.n > 6 ? B.split(c.full, Math.ceil(c.n / 6)) : [c.full]), n = rows.length, col = A.w / 6, hit = maybe(.6) && B.keyClause ? Math.max(0, rows.findIndex(r => r.includes(B.keyClause.units[0]))) : I(0, n - 1), l = B.layer('hero', { read: true, gentle: true, body: B.N > 60 }); if (n > 10) return false;
    const small = Math.max(26, Math.min(44, A.h / n * .36)) * B.u, mid = Math.min(small * 1.9, A.h / n * .6), keyS = Math.min(A.w * P([.72, .9, 1]) / B.emOf(rows[hit]), A.h * .24);
    const ss = rows.map((r, i) => Math.min(i === hit ? keyS : P([small, small, mid]), A.w * .9 / B.emOf(r))), total = ss.reduce((a, b) => a + b, 0) * 1.1, air = A.h - total; if (air < n * 10) return false;
    const ws = rows.map(() => P([.3, .6, 1.4, 2.6])), sum = ws.slice(1).reduce((a, b) => a + b, 0) || 1; let y = A.y, at = I(0, 3), last = -1;
    rows.forEach((r, i) => {
      if (i) y += air * ws[i] / sum; const w = B.emOf(r) * ss[i], room = Math.max(0, Math.floor((A.w - w) / col + .02));
      if (i === hit) at = P([0, room]); else { at = Math.min(room, (at + P([1, 2, 3, 4])) % (room + 1)); if (at === last && room) at = (at + 1) % (room + 1); } last = at;
      B.row(l, r, at === room && room ? A.x + A.w - w : A.x + at * col, y + ss[i] * .55, ss[i], { align: 'left', c: i === hit && maybe(.6) ? pal.a : pal.i }); y += ss[i] * 1.1;
    });
    return true;
  } },

  { id: 'rain', w: 5, face: ['lightSerif', 'serif', 'heavySerif'], fx: ['melt', 'ink', 'drift'],
    ok: B => B.cjk && B.clauses.length >= 2 && B.clauses.length <= 11 && B.clauses.every(c => c.n <= 18), run(B){
    // 雨：一句一缕，越往下落得越急；身后还有许多听不清的雨
    const { W, H, I, R, P, pal, A, maybe } = B, cs = B.clauses, n = cs.length, key = B.keyClause, acc = R(.02, .09), off = (i, len) => i + acc * i * i * 8 / Math.max(6, len), L = c => c.full.reduce((a, u) => a + (u.latin ? B.em(u.t) : 1), 0);
    const lenOf = c => off(L(c) - 1, L(c)) + 1, cw = A.w / n, keyS = Math.min(A.w * (n < 4 ? .2 : .17), A.h * .9 / lenOf(key)), rest = (A.w - keyS * 1.2) / Math.max(1, n - 1), s = Math.min(rest * .62, 62 * B.u, A.h * .84 / Math.max(...cs.map(lenOf))); if (s < 24 || keyS < s * 1.15) return false;
    const drop = (l, us, x, y, z, o) => { let k = 0; us.forEach(u => { const w = u.latin ? B.em(u.t) : 1, i = k + (w - 1) / 2; B.glyph(l, u, x, y + z * (off(i, us.length) + .5), z, { r: u.latin ? Math.PI / 2 : 0, vp: true, ...o }); k += w; }); };
    const back = I(7, 12);
    for (let i = 0; i < back; i++){ const t = R(0, 1), g = bGhost(P(cs).full.filter(u => !u.punct)), z = s * R(.5, 1 + t * 2.6), d = B.layer('deco', { bleed: true, ...(t > .45 ? { soft: t * 14 * B.u } : {}) }); drop(d, g, W * (i + R(.1, .9)) / back, H * R(-.25, .62), z, { c: maybe(.3) ? B.kin : pal.i, a: R(.05, .17) }); }
    const l = B.layer('hero', { read: true, gentle: true, body: s < 44, quiet: true }); let x = A.x + A.w, at = R(0, 1);
    cs.forEach(c => { const big = c === key, w = big ? keyS * 1.2 : rest, z = big ? keyS : s, len = lenOf(c) * z; at = (at + R(.28, .62)) % 1; x -= w; drop(l, c.full, x + w / 2 + (big ? 0 : R(-.12, .12) * w), A.y + (A.h - len) * (big ? R(.1, .8) : at), z, { c: big && maybe(.6) ? pal.a : pal.i }); });
    return true;
  } },

  { id: 'field', w: 5, face: ['heavySans', 'heavySerif', 'sans'], fx: ['melt'],
    ok: B => B.N >= 12 && B.N <= 150 && B.cjk && !B.core.some(u => u.latin && u.t.length > 5), run(B){
    // 字场：一格一字，大小跟着一个看不见的场起伏
    const { R, P, pal, A, maybe } = B, us = B.core, n = us.length, v = maybe(.5);
    const cols = Math.max(3, Math.round(Math.sqrt(n * A.w / A.h))), rows = Math.ceil(n / cols), cw = A.w / cols, ch = A.h / rows, m = Math.min(cw, ch); if (m < 34) return false;
    const cx = P([.18, .5, .82, R(.2, .8)]), cy = P([.18, .5, .82, R(.2, .8)]), kind = P(['in', 'out', 'diag', 'band']), ang = R(0, 6.28), l = B.layer('hero', { read: true, gentle: true }), tint = maybe(.5);
    us.forEach((u, i) => {
      const c = v ? cols - 1 - Math.floor(i / rows) : i % cols, r = v ? i % rows : Math.floor(i / cols), x = (c + .5) / cols, y = (r + .5) / rows, d = Math.hypot(x - cx, (y - cy) * A.h / A.w) / 1.05;
      const t = kind === 'in' ? 1 - Math.min(1, d) : kind === 'out' ? Math.min(1, d) : kind === 'diag' ? (x * Math.cos(ang) + y * Math.sin(ang) + 1) / 2 : .5 + .5 * Math.sin((x * Math.cos(ang) + y * Math.sin(ang)) * 9);
      const s = m * (.22 + .92 * Math.pow(Math.max(0, Math.min(1, t)), 1.5)) / Math.max(1, B.em(u.t));
      B.glyph(l, u, A.x + (c + .5) * cw, A.y + (r + .5) * ch, Math.max(19, s), { c: tint && t > .8 ? pal.a : pal.i });
    });
    return true;
  } },

  { id: 'path', w: 1, face: ['sans', 'lightSerif', 'heavySans'], ok: B => B.N >= 8 && B.N <= 72, run(B){
    // 一笔：整段字走成一条干净的曲线
    const { W, H, R, P, pal, A, maybe } = B, us = B.units, kind = P(['s', 'arc', 's']), X = t => A.x + A.w * t, Y = t => A.y + A.h * t;
    const ctrl = kind === 's' ? [[X(.06), Y(.1)], [X(.86), Y(.12)], [X(.95), Y(.36)], [X(.4), Y(.48)], [X(.06), Y(.64)], [X(.2), Y(.86)], [X(.94), Y(.9)]]
      : kind === 'arc' ? [[X(.04), Y(.94)], [X(.1), Y(.5)], [X(.36), Y(.16)], [X(.72), Y(.1)], [X(.96), Y(.22)]]
      : [[X(.02), Y(.62)], [X(.34), Y(.72)], [X(.72), Y(.6)], [X(.8), Y(.3)], [X(.52), Y(.16)], [X(.28), Y(.34)], [X(.42), Y(.66)], [X(.74), Y(.84)], [X(.98), Y(.82)]];
    if (maybe(.4)) ctrl.forEach(p => { p[1] = A.y * 2 + A.h - p[1]; });
    const pts = bKnead(bEven(bSpline(ctrl, 4), 3), 24), len = (pts.length - 1) * 3, em = us.map(u => B.em(u.t) + (u.sp ? .28 : 0)), sum = em.reduce((a, b) => a + b, 0), s = Math.min(len / (sum * 1.06), 150 * B.u); if (s < 24) return false;
    const gap = Math.min(.5, len / (sum * s) - 1), l = B.layer('hero', { read: true, gentle: true, body: s < 44 }); let d = Math.max(0, (len - sum * s * (1 + gap)) / 2);
    us.forEach((u, i) => {
      const w = em[i] * s * (1 + gap), m = Math.min(pts.length - 2, Math.round((d + w / 2) / 3)), a = pts[Math.max(0, m - 6)], b = pts[Math.min(pts.length - 1, m + 6)];
      B.glyph(l, u, pts[m][0], pts[m][1], s, { r: Math.atan2(b[1] - a[1], b[0] - a[0]), c: B.isKey(u) ? pal.a : pal.i }); d += w;
    });
    return true;
  } },

  { id: 'inline', w: 8, face: ['oldSerif', 'oldSerif', 'serif', 'heavySerif', 'heavySans'], ok: B => B.N >= 14 && B.N <= 300 && B.keyClause, run(B){
    // 句中：版面规规矩矩，就那几个字忽然大声
    const { R, P, pal, A, maybe } = B, v = B.cjk && maybe(.62), key = B.keyClause, src = B.text;
    let a = key.units[0].at; const last = key.units[key.units.length - 1]; let b = last.at + last.t.length;
    while (a > 0 && Q_OPEN.includes(src[a - 1])) a--;
    while (b < src.length && NO_START.includes(src[b])) b++;
    const parts = [[0, a], [a, b], [b, src.length]], side = v ? A.h : A.w, flow0 = v ? A.w : A.h, bigUnits = bUnits(src.slice(a, b)).map(u => ({ ...u, at: u.at + a }));
    const bigS = Math.min(side / B.emOf(bigUnits), flow0 * R(.16, .3)); if (bigS < 60) return false;
    for (let s = 40; s >= 22; s--){
      B.ctx.font = `${s}px ${B.fonts.body}`;
      const sets = [parts[0], parts[2]].map(([x, y]) => { const t = src.slice(x, y); return t.trim() ? buildItems(B.ctx, t, side * (v ? 1 : .8), s, v, null).items.map(it => ({ ...it, at: it.at === undefined ? undefined : it.at + x })) : []; });
      const flows = sets.map(q => q.reduce((m, it) => m + it.h, 0)), gap = s * 1.5, total = flows[0] + flows[1] + bigS * 1.05 + gap * 2;
      if (total > flow0) continue;
      const l = B.layer('hero', { read: true, gentle: true, body: true }), h = B.layer('hero', { read: true, gentle: true });
      let p = (flow0 - total) * P([0, .5, 1]);
      const run = items => { for (const it of items){ if (!it.gap){ B.ctx.font = `${s}px ${B.fonts.body}`; const len = v ? vAdvance(B.ctx, it.text, s) : B.ctx.measureText(it.text).width; l.ops.push(v ? { k: 'v', t: it.text, at: it.at, src: 'text', x: A.x + A.w - p - it.h, y: A.y, s, len, c: pal.i } : { k: 'l', t: it.text, at: it.at, src: 'text', x: A.x, y: A.y + p, s, len, c: pal.i }); } p += it.h; } };
      run(sets[0]); if (sets[0].length) p += gap * .6;
      const col = maybe(.5) ? pal.a : pal.i, show = bigUnits.filter(u => !u.punct || /[？！?!…]/.test(u.t));
      if (v) B.col(h, show, A.x + A.w - p - bigS / 2, A.y, bigS, { c: col }); else B.row(h, show, A.x, A.y + p + bigS * .52, bigS, { align: 'left', c: col });
      p += bigS * 1.05 + gap; run(sets[1]);
      return true;
    }
    return false;
  } },

  // ── 主角放大，正文守在格子里 ────────────────────────────────────
  { id: 'swiss', dup: true, w: 6, face: ['heavySans', 'heavySans', 'heavySerif', 'lightSans'], fx: ['melt', 'ink', 'drift', 'cuts', 'misreg', 'dither'],
    ok: B => B.hero && B.hero.units.length <= 10 && B.D > 10 && B.N < 420, run(B){
    // 网格：大标题顶着左边，底下正文落在栏里
    const { P, maybe, pal, A } = B, hu = B.hero.units, n = hu.length <= 2 ? 1 : hu.length <= 5 ? P([1, 2]) : P([2, 2, 3]), rows = B.split(hu, n), col = A.w / 6, gut = 22 * B.u;
    const s = Math.min(...rows.map(r => A.w / B.emOf(r)), A.h * (B.solo ? .5 : .44) / rows.length), zone = rows.length * s * .98, top = maybe(.62), l = B.layer('hero');
    if (s < 90) return false;
    const y0 = top ? A.y : A.y + A.h - zone;
    rows.forEach((r, i) => B.row(l, r, A.x - s * .02, y0 + s * .98 * (i + .5), s, { align: 'left', c: pal.i }));
    if (B.solo) return true;
    const gap = 44 * B.u, by = top ? A.y + zone + gap : A.y, bh = A.h - zone - gap;
    if (maybe(.5)) B.layer('deco').ops.push({ k: 'r', x: A.x, y: top ? by - gap * .5 : by + bh + gap * .5 - 1.4, w: A.w, h: 1.4, c: pal.i });
    const at = P([0, 0, 2, 3]), w = col * (6 - at) - gut;
    return !!B.body(A.x + col * at, by, Math.min(w, col * 4 - gut), bh, { max: 32, va: top ? P(['top', 'bottom']) : 'top' }) || !!B.body(A.x, by, A.w, bh, { max: 30 });
  } },

  { id: 'pillar', dup: true, w: 5, face: ['heavySerif', 'heavySans', 'lightSerif'], fx: ['melt', 'ink', 'drift', 'cuts', 'misreg', 'dither'],
    ok: B => B.cjk && B.hero && B.D > 12 && B.N < 380 && B.hero.units.length <= 9, run(B){
    // 立柱：主角一列顶天立地，正文贴着另一边
    const { R, P, maybe, pal, A } = B, hu = B.hero.units, n = B.colLen(hu), ch = A.h / n, w = Math.min(A.w * R(.28, .46), ch * 1.5), right = maybe(.65), x = right ? A.x + A.w - w : A.x;
    if (ch < w * .34) return false;
    const l = B.layer('hero'); B.fillCol(l, hu, x, A.y, w, A.h, { pad: ch * .03, c: P([pal.i, pal.i, pal.a]) });
    if (B.solo) return true;
    const gap = R(60, 100) * B.u, bw = A.w - w - gap, bx = right ? A.x : A.x + w + gap, h = A.h * P([.46, .6, .8]);
    return !!B.body(bx, A.y, bw, h, { vertical: true, max: 34, ha: right ? P(['right', 'left']) : 'right' }) || !!B.body(bx, A.y, bw, A.h, { vertical: true, max: 32, ha: 'right' });
  } },

  { id: 'skyline', dup: true, w: 5, face: ['heavySans', 'heavySerif'], fx: ['cuts', 'misreg'],
    ok: B => B.cjk && B.hero && B.hero.units.length >= 2 && B.hero.units.length <= 8 && B.D > 10 && B.N < 300, run(B){
    // 天际线：一排字等宽，高矮不齐地长上去（或挂下来）
    const { R, P, I, pal, A, maybe } = B, hu = B.hero.units, n = hu.length, zone = A.h * (B.solo ? .96 : R(.56, .66)), up = maybe(.6), gap = R(6, 14) * B.u, cw = (A.w - gap * (n - 1)) / n, kind = P(['ramp', 'fall', 'sin', 'rand', 'v']), l = B.layer('hero');
    let prev = -1;
    hu.forEach((u, i) => {
      const t = n > 1 ? i / (n - 1) : 1; let k = kind === 'ramp' ? t : kind === 'fall' ? 1 - t : kind === 'sin' ? .5 + .5 * Math.sin(t * 5.2 + 1) : kind === 'v' ? Math.abs(t * 2 - 1) : P([.1, .3, .55, .8, 1].filter(q => q !== prev));
      prev = k; const h = Math.min(zone, Math.max(cw * .62, zone * (.2 + .8 * k)));
      B.glyph(l, u, A.x + cw / 2 + i * (cw + gap), up ? A.y + zone - h / 2 : A.y + A.h - zone + h / 2, 100, { cell: [cw, h], c: pal.i });
    });
    if (B.solo) return true;
    const g = 48 * B.u, bh = A.h - zone - g;
    return !!B.body(A.x + A.w * P([0, 1 / 3]), up ? A.y + zone + g : A.y, A.w * .64, bh, { max: 32, va: up ? 'top' : 'bottom' }) || !!B.body(A.x, up ? A.y + zone + g : A.y, A.w, bh, { max: 30, va: up ? 'top' : 'bottom' });
  } },

  { id: 'ramp', dup: true, w: 5, face: ['heavySans', 'heavySerif'],
    ok: B => B.cjk && B.hero && B.hero.units.length >= 2 && B.hero.units.length <= 9 && B.D > 10 && B.N < 260, run(B){
    // 变奏：同一句，从一条缝一直拉到半张纸
    const { R, I, P, pal, A, maybe } = B, hu = B.hero.units, n = I(6, 9), zone = A.h * (B.solo ? 1 : R(.62, .7)), q = R(1.42, 1.72), gap = 8 * B.u, down = maybe(.6), l = B.layer('hero');
    const raw = Array.from({ length: n }, (_, i) => Math.pow(q, down ? i : n - 1 - i)), sum = raw.reduce((a, b) => a + b, 0), hs = raw.map(h => h / sum * (zone - gap * (n - 1))), top = B.solo || maybe(.6), cw = A.w / B.emOf(hu);
    if (Math.max(...hs) > cw * 4.4) return false;
    let y = top ? A.y : A.y + A.h - zone; const mark = maybe(.4) ? (down ? n - 1 : 0) : -1;
    hs.forEach((h, i) => { B.fill(l, hu, A.x, y, A.w, h, { pad: cw * .02, c: i === mark ? pal.a : pal.i }); y += h + gap; });
    if (B.solo) return true;
    const g = 46 * B.u, bh = A.h - zone - g, by = top ? A.y + zone + g : A.y;
    return !!B.body(A.x + A.w * P([0, 1 / 3, .5]), by, A.w * .5, bh, { max: 30, va: top ? 'top' : 'bottom' }) || !!B.body(A.x, by, A.w * .8, bh, { max: 30 }) || !!B.body(A.x, by, A.w, bh, { max: 26, min: 20 });
  } },

  { id: 'contour', dup: true, w: 2, face: ['heavySans', 'heavySerif'],
    ok: B => B.cjk && (B.word || B.hero) && B.D > 8 && B.N < 300, run(B){
    // 等高线：一两个字往外一圈一圈地扩
    const { W, H, R, I, P, pal, A, maybe, M } = B, us = (B.solo ? B.hero.units : B.word ? [...B.word.t] : B.hero.units.slice(0, 2)).slice(0, 4), n = us.length, stack = n > 1 && (n > 2 || maybe(.5));
    const zone = A.h * (B.solo ? 1 : R(.6, .68)), top = B.solo || maybe(.65), y0 = top ? A.y : A.y + A.h - zone, d = R(9, 16) * B.u, s = stack ? Math.min(zone * .62 / n, W * .5) : Math.min(W * .62 / n, zone * .56), rings = Math.max(6, Math.floor(((stack ? zone - s * n : zone - s) / 2 - 6) / d));
    const l = B.layer('hero', { bleed: true, clip: { x: 0, y: y0, w: W, h: zone }, nofx: true }), rr = { n: rings, d, c1: pal.i, c2: pal.g };
    const at = i => stack ? [W / 2, y0 + zone / 2 + (i - (n - 1) / 2) * s * .96] : [W / 2 + (i - (n - 1) / 2) * s * .96, y0 + zone / 2];
    for (let k = rings; k >= 1; k--) us.forEach((u, i) => { const [x, y] = at(i); B.glyph(l, u, x, y, s, { o: k * d * 2, c: k % 2 ? pal.g : pal.i, deco: true, hole: k % 2 === 1 }); });
    us.forEach((u, i) => { const [x, y] = at(i); B.glyph(l, u, x, y, s, { c: maybe(.5) ? pal.a : pal.i }); });
    if (B.solo) return true;
    const g = 40 * B.u, by = top ? A.y + zone + g : A.y, bh = A.h - zone - g;
    return !!B.body(A.x + A.w * P([0, 1 / 3]), by, A.w * .66, bh, { max: 30, va: top ? 'bottom' : 'top' }) || !!B.body(A.x, by, A.w, bh, { max: 28, min: 20 });
  } },

  { id: 'overprint', dup: true, w: 5, face: ['heavySans', 'heavySerif'],
    ok: B => B.cjk && B.hero && B.hero.units.length >= 2 && B.hero.units.length <= 6 && B.D > 8 && B.N < 300, run(B){
    // 叠印：几个大字压着印，两色一叠出第三色
    const { W, H, R, P, pal, A, maybe } = B, hu = B.hero.units, n = hu.length, zone = A.h * (B.solo ? 1 : R(.62, .7)), top = B.solo || maybe(.65), y0 = top ? A.y : A.y + A.h - zone, kind = P(['diag', 'stack', 'row']);
    const s = kind === 'row' ? Math.min(zone * .98, A.w / (1 + (n - 1) * .56)) : kind === 'stack' ? Math.min(A.w * .9, zone / (1 + (n - 1) * .5)) : Math.min(A.w / (1 + (n - 1) * .44), zone / (1 + (n - 1) * .44));
    if (s < 190 * B.u) return false;
    const cols = bHueGap(bLch(pal.a)[2], bLch(pal.b)[2]) > 125 ? [pal.a, pal.i] : [pal.a, pal.b];      // 隔太远的两色叠出来是泥
    hu.forEach((u, i) => {
      const t = n > 1 ? i / (n - 1) : 0, x = kind === 'stack' ? A.x + A.w / 2 + (i % 2 ? 1 : -1) * A.w * .04 : A.x + s / 2 + (A.w - s) * t, y = kind === 'row' ? y0 + zone / 2 + (i % 2 ? 1 : -1) * zone * .03 : y0 + s / 2 + (zone - s) * t;
      const l = B.layer('hero', { blend: B.dark ? 'screen' : 'multiply', nofx: false, quiet: true }); B.glyph(l, u, x, y, s, { c: cols[i % 2] });
    });
    if (B.solo) return true;
    const g = 46 * B.u, bh = A.h - zone - g, by = top ? A.y + zone + g : A.y;
    return !!B.body(A.x + A.w * P([0, 1 / 3]), by, A.w * .66, bh, { max: 30, va: top ? 'bottom' : 'top' }) || !!B.body(A.x, by, A.w, bh, { max: 28, min: 20 });
  } },

  { id: 'cut', dup: true, w: 5, face: ['heavySans', 'heavySerif'],
    ok: B => B.cjk && B.hero && B.hero.units.length >= 2 && B.hero.units.length <= 9 && B.D > 10 && B.N < 320, run(B){
    // 错切：大字横着切成等宽的条，错开半拍
    const { R, P, pal, A, maybe } = B, hu = B.hero.units, rows = B.split(hu, hu.length <= 3 ? 1 : hu.length <= 6 ? 2 : 3), zone = A.h * (B.solo ? .94 : R(.54, .64)), rh = zone / rows.length, top = B.solo || maybe(.65), y0 = top ? A.y : A.y + A.h - zone;
    if (rows.some(r => { const c = A.w / B.emOf(r); return rh > c * 2.6 || rh < c * .5; })) return false;
    const l = B.layer('hero', { fx: ['cuts'], own: true }); rows.forEach((r, i) => B.fill(l, r, A.x + A.w * .04, y0 + rh * i, A.w * .92, rh * .95, { pad: A.w / B.emOf(r) * .04, c: pal.i }));
    if (B.solo) return true;
    const g = 50 * B.u, bh = A.h - zone - g, by = top ? A.y + zone + g : A.y;
    return !!B.body(A.x + A.w * P([0, .5, 1 / 3]), by, A.w * .5, bh, { max: 30, va: top ? 'top' : 'bottom' }) || !!B.body(A.x, by, A.w * .8, bh, { max: 30 }) || !!B.body(A.x, by, A.w, bh, { max: 28, min: 20 });
  } },

  { id: 'shutter', dup: true, w: 1, face: ['heavySans', 'heavySerif'],
    ok: B => B.cjk && B.hero && B.hero.units.length >= 2 && B.hero.units.length <= 6 && B.D > 10 && B.N < 300 && B.clauses.some(c => c.t !== B.hero.t && c.n >= 2 && c.n <= 7), run(B){
    // 交错：两句话隔着一道道百叶，各露一半
    const { R, P, pal, A, maybe } = B, other = P(B.clauses.filter(c => c.t !== B.hero.t && c.n >= 2 && c.n <= 7)), zone = A.h * R(.52, .62), top = maybe(.65), y0 = top ? A.y : A.y + A.h - zone, rowsA = B.split(B.hero.units, B.hero.units.length > 3 ? 2 : 1), rowsB = B.split(other.units, other.n > 3 ? 2 : 1);
    const p = R(26, 64) * B.u, st = { p, duty: .5, vert: maybe(.75) }, put = (l, rows, c) => rows.forEach((r, i) => B.fill(l, r, A.x, y0 + zone / rows.length * i, A.w, zone / rows.length * .97, { c }));
    put(B.layer('hero', { nofx: true, stripes: { ...st, inv: false } }), rowsA, pal.i); put(B.layer('hero', { nofx: true, stripes: { ...st, inv: true } }), rowsB, pal.a);
    const g = 50 * B.u, bh = A.h - zone - g, by = top ? A.y + zone + g : A.y;
    return !!B.body(A.x + A.w * P([0, 1 / 3]), by, A.w * .62, bh, { max: 30, va: top ? 'top' : 'bottom' }) || !!B.body(A.x, by, A.w, bh, { max: 28, min: 20 });
  } },

  { id: 'melt', dup: true, w: 5, face: ['heavySans', 'heavySerif', 'lightSerif'],
    ok: B => B.hero && B.hero.units.length <= 8 && B.D > 10 && B.N < 320, run(B){
    // 渐糊：同一句叠几遍，一遍比一遍失焦
    const { R, I, P, pal, A, maybe } = B, hu = B.hero.units, zone = A.h * (B.solo ? .96 : R(.56, .66)), n = I(3, 5), em = B.emOf(hu), s = Math.min(A.w / em, zone / n * 1.12), pitch = Math.min(s * 1.02, (zone - s) / (n - 1)), top = B.solo || maybe(.6), y0 = (top ? A.y : A.y + A.h - zone) + s / 2, rev = maybe(.5), left = maybe(.5);
    if (s < 84) return false;
    for (let i = 0; i < n; i++){
      const k = rev ? i : n - 1 - i, l = B.layer('hero', { nofx: k > 0, soft: k ? Math.pow(k / (n - 1), 1.4) * R(.2, .3) * s : 0 });
      B.row(l, hu, left ? A.x : A.x + A.w / 2, y0 + pitch * i, s, { align: left ? 'left' : 'center', c: pal.i });
      if (k) l.ops.forEach(o => { delete o.at; });
    }
    if (B.solo) return true;
    const g = 48 * B.u, bh = A.h - zone - g, by = top ? A.y + zone + g : A.y;
    return !!B.body(A.x + A.w * P([0, 1 / 3]), by, A.w * .6, bh, { max: 30, va: top ? 'bottom' : 'top' }) || !!B.body(A.x, by, A.w, bh, { max: 28, min: 20 });
  } },

  { id: 'slit', dup: true, w: 4, modes: ['top'], face: ['heavySans', 'heavySerif'],
    ok: B => B.cjk && B.hero && B.hero.units.length >= 2 && B.hero.units.length <= 7 && B.D > 10 && B.N < 240, run(B){
    // 狭缝：字扫到一半，机器停住了，剩下的一直拉到纸边
    const { W, H, R, P, pal, A, maybe, M } = B, hu = B.hero.units, rows = B.split(hu, hu.length > 4 ? 2 : 1), zone = A.h * R(.4, .5), rh = zone / rows.length;
    if (rows.some(r => { const c = A.w / B.emOf(r); return rh > c * 2.4 || rh < c * .55; })) return false;
    const l = B.layer('hero', { fx: ['slit'], own: true, bleed: true, cutAt: R(.62, .8) }); rows.forEach((r, i) => B.fill(l, r, A.x, A.y + rh * i, A.w, rh * .97, { c: pal.i }));
    if (B.solo) return true;
    // 正文压在一块干净的底上
    const card = B.layer('body', { read: true }), pad = 30 * B.u, w = A.w * P([.5, .62]), x = P([A.x, A.x + A.w - w]), max = A.h * .4;
    const got = B.body(x + pad, A.y + A.h - max + pad, w - pad * 2, max - pad * 2, { max: 28, min: 20, va: 'bottom', layer: card }); if (!got) return false;
    card.ops.unshift({ k: 'r', x, y: got.y - pad, w, h: got.h + pad * 2, c: pal.g, hole: true }); return true;
  } },

  { id: 'micro', dup: true, w: 5, face: ['heavySans', 'heavySerif'],
    ok: B => B.cjk && B.word && B.N > 12 && B.N < 260, run(B){
    // 字中字：远看是一个字，近看是一整篇
    const { W, H, R, P, pal, A, maybe } = B, ch = [...B.word.t], zone = A.h * R(.68, .74), top = maybe(.7), y0 = top ? A.y : A.y + A.h - zone, s = Math.min(A.w * 1.02 / ch.length, zone * (ch.length > 1 ? 1 : 1.02)), hole = maybe(.35);
    const z = R(15, 20) * B.u, lh = z * 1.28, l = B.layer('hero', { nofx: true, bleed: true, tex: true, mask: { mode: hole ? 'out' : 'in', ops: [] }, clip: { x: A.x, y: y0, w: A.w, h: zone } });
    ch.forEach((t, i) => l.mask.ops.push({ k: 'g', t, x: A.x + A.w / 2 + (i - (ch.length - 1) / 2) * s * .97, y: y0 + zone / 2, s, f: 'hero', c: '#000' }));
    const rep = B.core.map(u => u.t).join(B.cjk ? '' : ' '), per = Math.ceil(A.w / z) + 4; let k = 0;
    for (let y = y0; y < y0 + zone; y += lh){ let t = ''; while ([...t].length < per) { t += rep[k % rep.length]; k++; } l.ops.push({ k: 'l', t, x: A.x - z * R(0, 1), y, s: z, len: A.w, c: pal.i, heavy: 2 }); }
    const g = 40 * B.u, bh = A.h - zone - g, by = top ? A.y + zone + g : A.y;
    return !!B.body(A.x + A.w * P([0, 1 / 3]), by, A.w * .66, bh, { max: 28, min: 20, va: top ? 'bottom' : 'top' }) || !!B.body(A.x, by, A.w, bh, { max: 26, min: 20 });
  } },

  { id: 'giant', dup: true, w: 5, face: ['heavySerif', 'heavySans'], fx: ['dither', 'ink', 'drift'],
    ok: B => B.cjk && (B.word || B.hero) && B.D > 8 && B.N < 340, run(B){
    // 出血：一个字大到纸装不下，小字从它身上穿过去就反色
    const { W, H, R, P, pal, A, maybe } = B, t = B.solo ? B.core[0] : B.word ? (bDense(B.word.t) || [...B.word.t][0]) : B.hero.units[0], s = W * R(1.18, 1.55), c = P([pal.a, pal.i, pal.i]);
    const [gx, gy] = P([[.72, .62], [.3, .64], [.66, .34], [.5, .5]]), op = { k: 'g', t: t.t || t, x: W * gx, y: H * gy, s, f: 'hero', c };
    const l = B.layer('hero', { bleed: true }); l.ops.push({ ...op, ...(t.at !== undefined ? { at: t.at, src: 'text' } : {}) }); B.maskOps = [op]; B.maskC = bOn(c, pal);
    if (B.solo){ const us = B.core.slice(1), z = Math.min(64 * B.u, A.h / B.colLen(us, 'body', .3)), q = B.layer('body', { read: true }); if (z < 30) return false; B.col(q, us, A.x + z / 2, A.y, z, { f: 'body', gap: .3, c: pal.i }); const k = B.layer('body', { mask: { mode: 'in', ops: [op] }, twin: true }); k.ops = q.ops.map(o => ({ ...o, c: bOn(c, pal) })); l.read = true; return true; }
    const v = maybe(.45), w = A.w * R(.4, .56), h = A.h * R(.36, .6), q = B.layer('body', { read: true });
    const got = B.body(gx > .5 ? A.x : A.x + A.w - w, gy > .5 ? A.y : A.y + A.h - h, w, h, { vertical: v, max: 30, min: 21, va: gy > .5 ? 'top' : 'bottom', ha: gx > .5 ? 'left' : 'right', layer: q }) ||
                B.body(A.x, A.y, A.w, A.h * .7, { max: 28, min: 20, layer: q });
    if (!got) return false;
    const k = B.layer('body', { mask: { mode: 'in', ops: [op] }, twin: true }); k.ops = q.ops.map(o => ({ ...o, c: bOn(c, pal) }));
    return true;
  } },

  { id: 'grainy', dup: true, w: 4, face: ['heavySans', 'heavySerif'],
    ok: B => B.cjk && (B.word || B.hero) && B.D > 8 && B.N < 320, run(B){
    // 点阵：一两个大字，一头是实的，一头散成方格子
    const { R, P, pal, A, maybe } = B, us = (B.solo ? B.hero.units : B.word ? [...B.word.t] : B.hero.units.slice(0, 2)), n = us.length; if (n > 5) return false;
    const zone = A.h * (B.solo ? 1 : R(.62, .7)), top = B.solo || maybe(.65), y0 = top ? A.y : A.y + A.h - zone, rows = n > 2 ? B.split(us.map(u => u.t ? u : { t: u }), 2) : [us.map(u => u.t ? u : { t: u })], rh = zone / rows.length;
    const l = B.layer('hero', { fx: ['dither'], own: true }); rows.forEach((r, i) => B.fill(l, r, A.x, y0 + rh * i, A.w, rh * .97, { pad: 4, c: P([pal.i, pal.a]) }));
    if (rows.some(r => { const c = A.w / B.emOf(r); return rh > c * 2.2 || rh < c * .45; })) return false;
    if (B.solo) return true;
    const g = 44 * B.u, bh = A.h - zone - g, by = top ? A.y + zone + g : A.y;
    return !!B.body(A.x + A.w * P([0, 1 / 3, .5]), by, A.w * .5, bh, { max: 30, va: top ? 'bottom' : 'top' }) || !!B.body(A.x, by, A.w, bh, { max: 28, min: 20 });
  } },

  { id: 'shift', dup: true, w: 4, face: ['heavySans', 'heavySerif', 'sans'],
    ok: B => B.hero && B.hero.units.length >= 2 && B.hero.units.length <= 9 && B.D > 10 && B.N < 280, run(B){
    // 错行：一句话铺满一面墙，一行挪一格，只有一行是说给你听的
    const { W, R, I, P, pal, A, maybe } = B, hu = B.hero.units, zone = A.h * (B.solo ? 1 : R(.62, .7)), top = B.solo || maybe(.6), y0 = top ? A.y : A.y + A.h - zone, n = I(7, 12), lh = zone / n, s = lh * .94, em = B.emOf(hu) + .6, step = R(.35, 1.1) * s * P([1, -1]), main = I(1, n - 2), ghost = bMix(pal.g, pal.i, B.dark ? .2 : .13);
    const g0 = B.layer('deco', { bleed: true, clip: { x: 0, y: y0, w: W, h: zone } }), l = B.layer('hero', { bleed: true, read: B.solo, nofx: true });
    for (let i = 0; i < n; i++){
      let x = A.x + step * (i - main); while (x > A.x) x -= em * s; const y = y0 + lh * (i + .5);
      for (; x < W + em * s; x += em * s){ const me = i === main && Math.abs(x - A.x) < 1; B.row(me ? l : g0, me ? hu : hu.map(u => ({ ...u, at: undefined })), x, y, s, { align: 'left', c: me ? pal.a : ghost }); }
    }
    if (!l.ops.length) return false;
    if (B.emOf(hu) * s > A.w) return false;
    if (B.solo) return true;
    const g = 46 * B.u, bh = A.h - zone - g, by = top ? A.y + zone + g : A.y;
    return !!B.body(A.x + A.w * P([0, 1 / 3]), by, A.w * .6, bh, { max: 30, va: top ? 'top' : 'bottom' }) || !!B.body(A.x, by, A.w, bh, { max: 28, min: 20 });
  } },

  { id: 'half', dup: true, w: 4, face: ['heavySerif', 'heavySans'], modes: ['left', 'side'], fx: ['cuts'],
    ok: B => B.cjk && B.hero && B.hero.units.length <= 8 && B.D > 12 && B.N < 340, run(B){
    // 对开：纸分两色，大字骑在缝上，过缝就反色
    const { W, H, R, P, pal, A, maybe, M } = B, hu = B.hero.units, t = P([1 / 3, .5, .5, .618]), vert = maybe(.5), on = bOn(pal.a, pal), d = B.layer('back', { bleed: true, nofx: true });
    const panel = vert ? { k: 'r', x: 0, y: 0, w: W * t, h: H, c: pal.a } : { k: 'r', x: 0, y: 0, w: W, h: H * t, c: pal.a }; d.ops.push(panel); B.maskOps = [panel]; B.maskC = on;
    const l = B.layer('hero', { quiet: true }), tw = B.layer('hero', { mask: { mode: 'in', ops: [panel] }, twin: true, nofx: true });
    if (vert){ const s = Math.min(A.w / B.emOf(hu), A.h * .3); if (s < 90) return false; B.row(l, hu, A.x + A.w / 2, A.y + s * .55 + (A.h * .34 - s) * .5, s, { c: pal.i }); tw.ops = l.ops.map(o => ({ ...o, c: on }));
      const y = A.y + A.h * .42, bx = W * t + M * .7, bw = W - M - bx; B.metaBox = { x: bx, w: bw }; if (B.solo) return true; return !!B.body(bx, y, bw, A.y + A.h - y, { max: 30, min: 20, va: 'bottom' }); }
    const n = B.colLen(hu), w = Math.min(A.w * .4, A.h / n * 1.3); B.fillCol(l, hu, A.x + A.w - w, A.y, w, A.h, { pad: A.h / n * .03, c: pal.i }); tw.ops = l.ops.map(o => ({ ...o, c: on }));
    if (B.solo) return true;
    const y = H * t + 46 * B.u; return !!B.body(A.x, y, A.w - w - 56 * B.u, A.y + A.h - y, { max: 30, min: 20, va: P(['top', 'bottom']) });
  } },

  { id: 'mosaic', w: 8, face: ['oldSerif', 'oldSerif', 'oldSerif', 'heavySerif', 'heavySans'], fx: ['cuts'],
    ok: B => B.cjk && ((B.hero && B.hero.units.length >= 3 && B.hero.units.length <= 8 && B.N < 280 && B.N > 9) || (B.N >= 3 && B.N <= 18)), run(B){
    // 拼板：每个字撑满自己那一格，胖的胖瘦的瘦
    const { R, pal, A, maybe, rnd } = B, whole = B.N <= 18 && (B.N <= 9 || !B.hero || maybe(.6)), us = whole ? B.core : B.hero.units; if (us.some(u => u.latin)) return false;
    const zoneH = whole ? A.h : A.h * R(.56, .66), top = whole || maybe(.6), gap = R(10, 18) * B.u, l = B.layer('hero', whole ? { read: true, gentle: true } : {}), hit = maybe(.6) ? Math.floor(rnd() * us.length) : -1, twoTone = maybe(.25), cutAt = Math.ceil(us.length * R(.4, .7)); let bad = false;
    const cut = (x, y, w, h, list) => {
      if (list.length === 1){ if (Math.min(w, h) < 70 || w / h > 2.2 || h / w > 2.1) bad = true; B.glyph(l, list[0], x + w / 2, y + h / 2, 100, { cell: [w - gap, h - gap], c: us.indexOf(list[0]) === hit || twoTone && us.indexOf(list[0]) < cutAt ? pal.a : pal.i }); return; }
      const k = list.length === 2 ? 1 : Math.max(1, Math.min(list.length - 1, Math.round(list.length * R(.32, .68)))), t = Math.max(.27, Math.min(.73, k / list.length + R(-.13, .13)));
      if (w > h * R(.8, 1.15)){ cut(x, y, w * t, h, list.slice(0, k)); cut(x + w * t, y, w * (1 - t), h, list.slice(k)); } else { cut(x, y, w, h * t, list.slice(0, k)); cut(x, y + h * t, w, h * (1 - t), list.slice(k)); }
    };
    if (whole && B.clauses.length > 1 && maybe(.5)){ const hs = B.clauses.map(c => Math.sqrt(c.n) * R(.8, 1.3)), sum = hs.reduce((a, b) => a + b, 0); let y = A.y; B.clauses.forEach((c, i) => { const h = A.h * hs[i] / sum; cut(A.x - gap / 2, y, A.w + gap, h, c.units); y += h; }); }
    else cut(A.x - gap / 2, top ? A.y : A.y + A.h - zoneH, A.w + gap, zoneH, us);
    if (bad) return false;
    if (whole) return true;
    const g = 44 * B.u, rest = A.h - zoneH - g;
    return !!B.body(A.x + (maybe(.4) ? A.w / 3 : 0), top ? A.y + zoneH + g : A.y, A.w * .64, rest, { max: 30, va: top ? 'top' : 'bottom' }) || !!B.body(A.x, top ? A.y + zoneH + g : A.y, A.w, rest, { max: 28, min: 20 });
  } },
];
const P3 = (rnd, arr) => arr[Math.floor(rnd() * arr.length)];

// ════════════════════════════════════════════════════════════════════
//  9. 版式盲盒 ⑤ 低声的那些
// ════════════════════════════════════════════════════════════════════
// 尺子是这一句：不要杂乱、不要吵，要像有个人重章叠句地在你耳边念白。
// 这一组是盲盒的底色：同一句话念几遍、有的实有的虚；淡字垫在底下，浓字从上面走过；
// 同一段字浓淡不一。手段只有三样 —— 位置、大小、透明度；空气归 blind-looks 给。
// 淡字（没有 at 的）是回声，不算正文；正文每个字最淡也读得出来（≥ .34）。
const bGhost = us => us.map(u => ({ ...u, at: undefined }));
// 找两句话共有的一个字（不在同一句里）
function bCross(cs, rnd){
  const hits = [];
  for (let p = 0; p < cs.length; p++) for (let q = 0; q < cs.length; q++) if (p !== q && cs[p].n >= 3 && cs[p].n <= 11 && cs[q].n >= 3 && cs[q].n <= 13)
    cs[p].units.forEach((u, i) => cs[q].units.forEach((w, j) => { if (u.t === w.t && !B_STOP.has(u.t)) hits.push({ a: cs[p], b: cs[q], i, j }); }));
  return hits.length ? hits[rnd ? Math.floor(rnd() * hits.length) : 0] : null;
}
const BLIND_QUIET = [
  { id: 'refrain', q: true, dup: true, w: 7, fx: ['ink', 'drift'], face: ['lightSerif', 'serif', 'heavySerif', 'lightSans'],
    ok: B => B.hero && B.hero.units.length >= 2 && B.hero.units.length <= 10 && B.D > 9 && B.N < 260, run(B){
    // 重章：一句话叠着念几遍，大的虚，小的实
    const { W, R, P, pal, A, maybe } = B, hu = B.hero.units, em = B.emOf(hu), zone = A.h * (B.solo ? 1 : R(.64, .74)), top = B.solo || maybe(.6), y0 = top ? A.y : A.y + A.h - zone;
    const s0 = Math.min(A.w * R(.62, .8) / em, zone * .16); if (s0 < 44 * B.u) return false;
    const set = P([[[2.7, .07], [1.7, .13], [1, 1], [.62, .42]], [[.62, .4], [1, 1], [1.7, .14], [2.6, .07]], [[1.9, .1], [1, 1], [1.9, .1], [.6, .38], [.6, .2]], [[3.2, .06], [1, 1], [1, .34], [1, .14]]]);
    const hs = set.map(([k]) => s0 * k), total = hs.reduce((a, b) => a + b, 0), ov = Math.max(0, (total - zone) / (hs.length - 1)), gap = total < zone ? (zone - total) / (hs.length - 1) : -ov; let y = y0; const lean = P([0, .5, 1]);
    set.forEach(([k, a], i) => {
      const s = s0 * k, w = em * s, main = a === 1, l = B.layer(main ? 'hero' : 'deco', main ? { quiet: true } : { bleed: true }), room = A.w - w, t = main ? P([0, .5, 1]) : (lean + i * .37) % 1;
      const x = room > 0 ? A.x + room * t : A.x + room * t; B.row(l, main ? hu : bGhost(hu), x, y + s / 2, s, { align: 'left', c: pal.i, a: main ? undefined : a });
      y += s + gap;
    });
    if (B.solo) return true;
    const g = 44 * B.u, bh = A.h - zone - g, by = top ? A.y + zone + g : A.y;
    return !!B.body(A.x + A.w * P([0, 1 / 3, .5]), by, A.w * .5, bh, { max: 28, min: 20, va: top ? 'bottom' : 'top' }) || !!B.body(A.x, by, A.w * .86, bh, { max: 28, min: 20, va: top ? 'bottom' : 'top' });
  } },

  { id: 'underlay', q: true, w: 7, face: ['lightSerif', 'serif', 'heavySerif'],
    ok: B => B.clauses.length >= 2 && B.clauses.length <= 11 && B.N >= 8 && B.N <= 130, run(B){
    // 底里的话：极淡的大字铺在底下，小字一句一落从上面走过
    const { W, R, P, I, pal, A, maybe } = B, key = B.keyClause, v = B.cjk && maybe(.45), heavy = /Black|Heavy|900/.test(B.fonts.hero + B.fonts.heroW), al = heavy ? R(.05, .085) : R(.1, .16), d = B.layer('deco', { bleed: true });
    const us = bGhost(key.units), rows = v ? [us] : B.split(us, key.n > 3 ? P([2, 3]) : 1);
    if (v){ const s = Math.min(A.h * 1.12 / B.colLen(us), A.w * .72); B.col(d, us, A.x + A.w * P([.3, .62]), A.y - s * .05, s, { c: pal.i, a: al }); }
    else { const s = Math.min(A.w * 1.16 / Math.max(...rows.map(r => B.emOf(r))), A.h * .36), y = A.y + (A.h - s * rows.length) * R(.15, .85); rows.forEach((r, i) => B.row(d, r, A.x - s * R(0, .2) + (i % 2) * s * .3, y + s * (i + .5), s, { align: 'left', c: pal.i, a: al })); }
    const cs = B.clauses, n = cs.length, col = A.w / 12, l = B.layer('hero', { read: true, body: true, quiet: true });
    const z = Math.min(44 * B.u, A.h * .86 / n * .55, A.w * .8 / Math.max(...cs.map(c => B.emOf(c.full, 'body')))); if (z < 23) return false;
    if (v && cs.every(c => B.colLen(c.full, 'body', .08) * z < A.h * .7)){ const w = Math.min(z * 2.1, A.w * .9 / n); let x = A.x + A.w - (A.w - w * n) * P([.2, .5, .8]); cs.forEach((c, i) => { x -= w; const len = B.colLen(c.full, 'body', .08) * z; B.col(l, c.full, x + w / 2, A.y + (A.h - len) * Math.min(1, (i + R(0, .7)) / Math.max(1, n)), z, { f: 'body', gap: .08, c: pal.i }); }); return true; }
    const pitch = Math.min(A.h * .9 / n, z * R(2, 3.1)); let y = A.y + (A.h - pitch * n) * P([0, .5, 1]), at = I(0, 3);
    cs.forEach((c, i) => { const room = Math.floor((A.w - B.emOf(c.full, 'body') * z) / col); at = Math.max(0, Math.min(room, at + I(-2, 3))); B.row(l, c.full, A.x + at * col, y + pitch / 2, z, { f: 'body', align: 'left', c: pal.i }); y += pitch; });
    return true;
  } },

  { id: 'stagger', q: true, w: 7, face: ['serif', 'lightSerif', 'sans', 'lightSans'],
    ok: B => B.clauses.length >= 2 && B.clauses.length <= 12 && B.N <= 120, run(B){
    // 错落：一句一落，有的重有的轻，像说话时的气口
    const { R, P, I, pal, A, maybe } = B, cs = B.clauses, n = cs.length, v = B.cjk && maybe(.5), key = B.keyClause, l = B.layer('hero', { read: true, gentle: true, body: B.N > 46, quiet: true });
    const base = Math.min(52 * B.u, (v ? A.w : A.h) / n * .46), sz = c => c === key ? base * R(1.9, 3) : base * P([.62, .74, 1, 1]), al = c => c === key ? 1 : P([.9, .66, .5, .38]), side = v ? A.h : A.w, len = (c, s) => (v ? B.colLen(c.full, 'hero', .06) : B.emOf(c.full, 'hero', .03)) * s;
    const ss = cs.map(c => Math.min(sz(c), side * .94 / len(c, 1))); if (Math.min(...ss) < 21) return false;
    const step = side / 12, total = ss.reduce((a, b) => a + b * 1.25, 0), room0 = (v ? A.w : A.h) - total; if (room0 < 0) return false;
    const gaps = cs.map(() => P([.3, .6, 1, 1.9])), gs = gaps.slice(1).reduce((a, b) => a + b, 0) || 1, use = room0 * R(.55, .95); let p = (room0 - use) * P([0, .5]), at = I(0, 4);
    cs.forEach((c, i) => {
      if (i) p += use * gaps[i] / gs; const s = ss[i], room = Math.max(0, Math.floor((side - len(c, s)) / step)); at = Math.max(0, Math.min(room, at + P([-3, -1, 1, 2, 3, 4]))); if (room && i && at === room) at = Math.max(0, at - 1);
      const o = { gap: v ? .06 : .03, c: pal.i, a: al(c) < 1 ? al(c) : undefined };
      if (v) B.col(l, c.full, A.x + A.w - p - s * .62, A.y + at * step, s, o); else B.row(l, c.full, A.x + at * step, A.y + p + s * .62, s, { align: 'left', ...o });
      p += s * 1.25;
    });
    return true;
  } },

  { id: 'canon', q: true, w: 5, face: ['serif', 'lightSerif'],
    ok: B => B.N >= 10 && B.N <= 64, run(B){
    // 轮唱：同一段错开几拍再念，一遍比一遍淡
    const { R, P, pal, A, maybe } = B, v = B.cjk && maybe(.6), k = P([2, 2, 3]), w = A.w * (v ? .62 : .72), h = A.h * (v ? .62 : .5), dx = (A.w - w) / k, dy = (A.h - h) / k, sx = v ? -1 : 1, flip = maybe(.35) ? -1 : 1;
    const x0 = sx > 0 ? A.x : A.x + A.w - w, y0 = flip > 0 ? A.y : A.y + A.h - h, main = B.layer('body', { read: true }), got = B.body(x0, y0, w, h, { vertical: v, max: 44, min: 26, ha: v ? 'right' : 'left', va: 'top', layer: main }); if (!got) return false;
    for (let i = 1; i <= k; i++){ const l = B.layer('deco', { bleed: true, alpha: [.24, .12, .06][i - 1] }); l.ops = main.ops.map(o => ({ ...o, at: undefined, x: o.x + sx * dx * i * R(.85, 1), y: o.y + flip * dy * i * R(.85, 1) })); }
    return true;
  } },

  { id: 'breath', q: true, w: 6, face: ['serif', 'lightSerif', 'heavySerif', 'sans'],
    ok: B => B.N >= 10 && B.N <= 180, run(B){
    // 呼吸：同一段字，浓一阵，淡一阵
    const { R, P, I, pal, A, maybe } = B, v = B.cjk && maybe(.45), lead = 1.7, us = B.units;
    for (let s = Math.round(Math.min(96, Math.sqrt(A.w * A.h / B.N) * .6)); s >= 25; s--){
      const pitch = s * lead, lines = [], cross = v ? A.h * .92 : A.w * R(.9, .901), n = Math.floor((v ? A.w : A.h) * .94 / pitch); for (let i = 0; i < n; i++) lines.push({ x0: 0, x1: cross, y: i * pitch });
      const got = bFlow(B, us, s, lines, 'hero', .02); if (!got) continue;
      const used = got[got.length - 1].y + s, start = ((v ? A.w : A.h) - used) * P([0, .5, 1]), l = B.layer('hero', { read: true, gentle: true, body: s < 50, quiet: true }), f = R(1.1, 2.6), ph = R(0, 6.28), kind = P(['wave', 'wave', 'focus', 'clause']), cx = R(.2, .8), cy = R(.2, .8), N = got.length, of = new Map(); B.clauses.forEach((c, q) => c.units.forEach(u => of.set(u.at, q)));
      got.forEach((g, i) => {
        const t = i / (N - 1 || 1), gx = g.x / cross, gy = g.y / (used || 1); let a = kind === 'wave' ? .5 + .5 * Math.sin(t * f * 6.2832 + ph) : kind === 'focus' ? 1 - Math.min(1, Math.hypot(gx - cx, (gy - cy) * .8) * 1.25) : (of.get(g.u.at) || 0) % 2 ? .12 : 1;
        a = .34 + .66 * Math.max(0, Math.min(1, a)); if (B.isKey(g.u)) a = 1;
        if (v) B.glyph(l, g.u, A.x + A.w - start - g.y - s / 2, A.y + g.x, s, { r: g.u.latin ? Math.PI / 2 : 0, c: pal.i, a, vp: true }); else B.glyph(l, g.u, A.x + g.x, A.y + start + g.y + s / 2, s, { c: pal.i, a });
      });
      return true;
    }
    return false;
  } },

  { id: 'fade', q: true, dup: true, w: 5, face: ['lightSerif', 'serif', 'heavySerif', 'lightSans'],
    ok: B => B.hero && B.hero.units.length >= 2 && B.hero.units.length <= 11 && B.D > 9 && B.N < 280, run(B){
    // 渐隐：越念越轻，走到纸的另一头
    const { R, P, I, pal, A, maybe } = B, hu = B.hero.units, v = B.cjk && maybe(.5), n = I(5, 8), em = v ? B.colLen(hu) : B.emOf(hu), back = maybe(.4);
    const len0 = (v ? A.h : A.w) * R(.62, .86), zone = (v ? A.w : A.h) * (B.solo ? .96 : R(.52, .66)), s = Math.min(len0 / em, zone / n * R(.74, .92)), pitch = (zone - s) / (n - 1), drift = ((v ? A.h : A.w) - em * s) / (n - 1) * P([0, .5, 1]) * 1; if (s < 34 * B.u) return false;
    for (let i = 0; i < n; i++){
      const k = back ? n - 1 - i : i, main = k === 0, a = main ? undefined : Math.max(.05, .62 * Math.pow(.62, k - 1)), l = B.layer(main ? 'hero' : 'deco', main ? { quiet: true } : {});
      if (v) B.col(l, main ? hu : bGhost(hu), A.x + A.w - s / 2 - pitch * i, A.y + drift * i, s, { c: pal.i, a }); else B.row(l, main ? hu : bGhost(hu), A.x + drift * i, A.y + s / 2 + pitch * i, s, { align: 'left', c: pal.i, a });
    }
    if (B.solo) return true;
    const g = 56 * B.u; if (v) return !!B.body(A.x, A.y + A.h * P([0, .3]), A.w - zone - g, A.h * .7, { vertical: true, max: 28, min: 20, ha: 'left' });
    return !!B.body(A.x + A.w * P([0, .5]), A.y + zone + g, A.w * .5, A.h - zone - g, { max: 28, min: 20, va: 'bottom' }) || !!B.body(A.x, A.y + zone + g, A.w * .86, A.h - zone - g, { max: 28, min: 20, va: 'bottom' });
  } },

  { id: 'ear', q: true, w: 5, face: ['lightSerif', 'heavySerif', 'lightSans'],
    ok: B => B.cjk && B.word && B.N >= 8 && B.N <= 130, run(B){
    // 耳边：一个很大很淡的字，几行很小很实的话贴着它说
    const { W, H, R, P, pal, A, maybe } = B, ch = (bDense(B.word.t) || [...B.word.t][0]), s = W * R(.86, 1.18), heavy = /Black|Heavy|900/.test(B.fonts.hero + B.fonts.heroW), gx = P([.36, .5, .66]), gy = P([.4, .55, .64]);
    B.glyph(B.layer('deco', { bleed: true }), ch, W * gx, H * gy, s, { c: pal.i, a: heavy ? R(.05, .08) : R(.12, .2) });
    const v = maybe(.65), w = A.w * R(.34, .5), h = A.h * R(.36, .52);
    return !!B.body(P([A.x + A.w * .12, A.x + A.w - w - A.w * .08, A.x + (A.w - w) / 2]), A.y + (A.h - h) * P([.18, .5, .82]), w, h, { vertical: v, max: 32, min: 22, ha: 'center', va: 'mid' });
  } },

  { id: 'drift', q: true, w: 5, face: ['serif', 'lightSerif'],
    ok: B => B.N >= 10 && B.N <= 120, run(B){
    // 双声：同一段话，大而淡的一遍，小而实的一遍，叠在一起念
    const { R, P, pal, A, maybe } = B, v = B.cjk && maybe(.4), big = B.layer('deco', { alpha: R(.12, .2) }), got = B.body(A.x, A.y, A.w, A.h, { vertical: v, max: 130, min: 44, layer: big, va: 'mid', ha: v ? 'center' : 'left' }); if (!got) return false;
    big.read = false; big.ops.forEach(o => { delete o.at; });
    const w = A.w * R(.46, .6), h = A.h * R(.34, .5);
    return !!B.body(A.x + (A.w - w) * P([.12, .5, .9]), A.y + (A.h - h) * P([.25, .5, .8]), w, h, { vertical: v, max: 30, min: 22, va: 'mid', ha: v ? 'center' : 'left' });
  } },

  { id: 'blank', q: true, w: 6, face: ['serif', 'lightSerif', 'sans', 'lightSans'],
    ok: B => B.N >= 3 && B.N <= 150, run(B){
    // 留白：空的那一大片才是主角，字只是让它显出来
    const { R, P, pal, A, maybe } = B, v = B.cjk && maybe(.55), cs = B.clauses, one = cs.length >= 2 && cs.length <= 8 && maybe(.6);
    if (one){
      const l = B.layer('hero', { read: true, body: true, quiet: true }), s = R(23, 34) * B.u, gap = R(.08, .3), pitch = s * R(2, 3.2), n = cs.length, cut = maybe(.45) && n > 2 ? n - 1 : n, lens = cs.map(c => (v ? B.colLen(c.full, 'body', gap) : B.emOf(c.full, 'body', gap)) * s); if (Math.max(...lens) > (v ? A.h : A.w) * .9) return false;
      const block = pitch * cut, X = P([0, 1]), Y = P([0, .28, .72, 1]);
      cs.forEach((c, i) => { const lone = i >= cut; if (v){ const x = lone ? A.x + s * .6 : A.x + A.w - s * .6 - (A.w - block - s * 3) * (X ? 0 : .3) - pitch * i, y = lone ? A.y + A.h - lens[i] : A.y + (A.h - Math.max(...lens.slice(0, cut))) * Math.min(.6, Y); B.col(l, c.full, x, y, s, { f: 'body', gap, c: pal.i }); } else { const x = lone ? A.x + A.w - lens[i] : A.x + (A.w - Math.max(...lens.slice(0, cut))) * X * .9, y = lone ? A.y + A.h - s * .6 : A.y + s * .6 + (A.h - block - s * 4) * Math.min(.85, Y) + pitch * i; B.row(l, c.full, x, y, s, { f: 'body', align: 'left', gap, c: pal.i }); } });
      return true;
    }
    const w = A.w * R(.3, .46), h = A.h * R(.24, .4); return !!B.body(A.x + (A.w - w) * P([0, 1, .62, .38]), A.y + (A.h - h) * P([0, 1, .62, .38]), w, h, { vertical: v, max: 27, min: 20, ha: P(['left', 'right']), va: P(['top', 'bottom']) }) || !!B.body(A.x + A.w * .5, A.y + A.h * .5, A.w * .5, A.h * .5, { max: 26, min: 20, va: 'bottom' });
  } },

  { id: 'void', q: true, dup: true, w: 5, face: ['lightSans', 'sans', 'lightSerif', 'heavySans'],
    ok: B => B.cjk && B.hero && B.hero.units.length >= 1 && B.hero.units.length <= 6 && B.N > 12 && B.N < 130, run(B){
    // 空格：一个词铺成一面墙，当中抽掉一块，正文站在那块空里
    const { R, P, pal, A, maybe } = B, hu = bGhost(B.hero.units), em = B.emOf(hu) + .9, s = R(26, 40) * B.u, cols = Math.max(2, Math.round(A.w / (em * s))), cw = A.w / cols, lh = s * R(1.9, 2.5), rows = Math.floor(A.h / lh), l = B.layer('deco'), w = Math.max(cw * Math.max(1, Math.round(cols * .5)), A.w * .4), x = A.x + (A.w - w) * P([0, .5, 1]), h = A.h * R(.36, .5), y = A.y + (A.h - h) * P([.2, .5, .8]);
    const got = B.body(x + 10 * B.u, y, w - 20 * B.u, h, { max: 34, min: 21, va: 'mid', ha: 'center' }); if (!got) return false;
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++){ const px = A.x + cw * i, py = A.y + lh * (j + .5); if (px + (em - .9) * s > got.x - s && px < got.x + got.w + s && py > got.y - s * 1.3 && py < got.y + got.h + s * 1.3) continue; B.row(l, hu, px, py, s, { align: 'left', c: pal.i, a: .34 }); }
    return true;
  } },

  { id: 'grow', q: true, w: 6, face: ['serif', 'lightSerif', 'sans', 'heavySerif'],
    ok: B => B.cjk && B.clauses.length >= 1 && B.N >= 4 && B.N <= 60 && B.clauses.some(c => c.n >= 3 && c.n <= 11), run(B){
    // 渐成：一个字一个字地长成一句，长成了的那一句才是实的
    const { R, P, pal, A, maybe } = B, c = B.keyClause && B.keyClause.n >= 3 && B.keyClause.n <= 11 ? B.keyClause : P(B.clauses.filter(q => q.n >= 3 && q.n <= 11)), n = c.n, rest = B.N - n, zone = rest ? A.h * R(.62, .7) : A.h * .9, v = maybe(.4), s = Math.min((v ? zone : A.w * R(.6, .96)) / (n * 1.04), (v ? A.w * .8 : zone) / (n * 1.12), 96 * B.u); if (s < 24) return false;
    const right = maybe(.35), l = B.layer('hero', { read: true, quiet: true, body: s < 44 }), d = B.layer('deco'), pitch = Math.min((v ? A.w : zone) / n, s * R(1.12, 1.7)), back = maybe(.3);
    for (let i = 0; i < n; i++){ const k = back ? n - i : i + 1, us = c.units.slice(0, k), main = k === n, a = main ? undefined : .1 + .42 * Math.pow(k / n, 1.6), q = main ? l : d, uu = main ? us : bGhost(us); if (v) B.col(q, uu, A.x + A.w - pitch * (i + .5), A.y, s, { gap: .04, c: pal.i, a }); else B.row(q, uu, right ? A.x + A.w : A.x, A.y + pitch * (i + .5), s, { align: right ? 'right' : 'left', gap: .04, c: pal.i, a }); }
    if (!rest) return true;
    const g = 50 * B.u, Y = v ? A.y + zone + g : A.y + pitch * n + g; return !!B.body(A.x + A.w * P([0, 1 / 3]), Y, A.w * .6, A.y + A.h - Y, { max: 30, min: 20, va: 'bottom' }) || !!B.body(A.x, Y, A.w, A.y + A.h - Y, { max: 28, min: 20, va: 'bottom' });
  } },

  { id: 'cross', q: true, w: 7, face: ['serif', 'lightSerif', 'heavySans', 'heavySerif'],
    ok: B => B.cjk && B.clauses.length >= 2 && B.N <= 110 && !!bCross(B.clauses), run(B){
    // 十字：两句话在同一个字上相交
    const { R, P, pal, A, maybe } = B, { a, b, i, j } = bCross(B.clauses, B.rnd), rest = B.N - a.n - b.n, zone = rest > 0 ? A.h * .72 : A.h, s = Math.min(A.w / a.n, zone / b.n, 170 * B.u); if (s < 34) return false;
    const x0 = A.x + (A.w - a.n * s) * P([0, .5, 1]), y0 = A.y + (zone - b.n * s) * P([0, .5]), l = B.layer('hero', { read: true, quiet: true }), px = x0 + (i + .5) * s, py = y0 + (j + .5) * s;
    a.units.forEach((u, k) => B.glyph(l, u, x0 + (k + .5) * s, py, s * .92, { c: k === i ? pal.a : pal.i }));
    b.units.forEach((u, k) => { if (k === j){ const o = B.glyph(l, u, px, py, s * .92, { c: pal.a }); o.a = .001; } else B.glyph(l, u, px, y0 + (k + .5) * s, s * .92, { c: pal.i }); });
    if (rest <= 0) return true;
    const g = 40 * B.u; return !!B.body(A.x + A.w * P([0, .4]), A.y + zone + g, A.w * .6, A.h - zone - g, { max: 28, min: 20, va: 'bottom' }) || !!B.body(A.x, A.y + zone + g, A.w, A.h - zone - g, { max: 26, min: 20, va: 'bottom' });
  } },

  // ── 日本 ────────────────────────────────────────────────────────
  { id: 'ma', q: true, dup: true, w: 5, fx: ['ink', 'drift', 'melt'], face: ['lightSerif', 'heavySerif', 'lightSans'],
    ok: B => B.cjk && B.hero && B.hero.units.length >= 2 && B.hero.units.length <= 6 && B.D > 9 && B.N < 200, run(B){
    // 间：几个字隔得很开，正文竖着站在它们中间
    const { R, P, pal, A } = B, hu = B.hero.units, n = hu.length, s = Math.min(A.w * R(.25, .34), A.h / Math.ceil(n / 2) * .7), X = [A.x + A.w - s / 2, A.x + s / 2], per = Math.ceil(n / 2), l = B.layer('hero', { quiet: true });
    hu.forEach((u, i) => { const c = Math.floor(i / per), r = i % per, rows = c ? n - per : per, y = per === 1 ? (c ? A.y + A.h - s / 2 : A.y + s / 2) : A.y + s / 2 + (A.h - s) * (rows === 1 ? (c ? 1 : 0) : r / (per - 1)); B.glyph(l, u, X[c], y, s, { c: pal.i }); });
    if (B.solo) return true;
    const w = A.w - s * 2 - 90 * B.u, h = A.h * R(.42, .58);
    return !!B.body(A.x + s + 45 * B.u, A.y + (A.h - h) * P([.3, .5, .7]), w, h, { vertical: true, max: 28, min: 20, ha: 'center', va: 'mid' });
  } },

  { id: 'tate', q: true, w: 6, fx: ['ink', 'melt'], face: ['serif', 'lightSerif', 'heavySerif'],
    ok: B => B.cjk && B.clauses.length >= 2 && B.clauses.length <= 10 && B.N <= 110 && B.clauses.every(c => c.n <= 17), run(B){
    // 立：竖排，一句比一句低，走成一道缓坡
    const { R, P, pal, A, maybe } = B, cs = B.clauses, n = cs.length, lens = cs.map(c => B.colLen(c.full, 'hero', .1)), s = Math.min(56 * B.u, A.w / n * .5, A.h * .72 / Math.max(...lens)); if (s < 23) return false;
    const w = Math.min(s * R(1.9, 2.6), A.w / n), x0 = A.x + A.w - (A.w - w * n) * P([0, 0, .5, 1]), l = B.layer('hero', { read: true, gentle: true, body: s < 44, quiet: true }), up = maybe(.25), fall = Math.min(...lens.map((e, i) => n > 1 ? (A.h - e * s) / Math.max(1, up ? n - 1 - i : i) : A.h)), step = Math.min(fall, A.h * R(.06, .13));
    cs.forEach((c, i) => B.col(l, c.full, x0 - w * (i + .5), A.y + step * (up ? n - 1 - i : i), s, { gap: .1, c: c === B.keyClause && maybe(.5) ? pal.a : pal.i }));
    return true;
  } },

  // ── 瑞士 ────────────────────────────────────────────────────────
  { id: 'axis', q: true, w: 5, face: ['heavySans', 'sans', 'serif', 'heavySerif'], fx: ['melt'],
    ok: B => B.clauses.length >= 2 && B.clauses.length <= 10 && B.N <= 150, run(B){
    // 轴线：一根看不见的轴，句子一左一右地靠着它，从纸顶走到纸底
    const { R, P, pal, A, maybe } = B, cs = B.clauses.flatMap(c => c !== B.keyClause && c.n > 9 ? B.split(c.full, 2).map(full => ({ full, of: c })) : [{ full: c.full, of: c }]), n = cs.length, ax = A.x + A.w * P([.382, .382, .5, .618]), room = i => i % 2 ? ax - A.x : A.x + A.w - ax, flip = maybe(.4) ? 1 : 0, side = i => (i + flip) % 2;
    const key = cs.findIndex(c => c.of === B.keyClause), gut = 16 * B.u, kRows = B.split(cs[key].full, cs[key].full.length > 4 ? 2 : 1), kS = Math.min(A.w * .96 / Math.max(...kRows.map(r => B.emOf(r))), A.h * .17), s = Math.min(46 * B.u, kS * .5, ...cs.map((c, i) => i === key ? 1e4 : (room(side(i)) - gut) / B.emOf(c.full, 'body'))); if (s < 24 || kS < 64) return false;
    const hs = cs.map((c, i) => i === key ? kS * 1.12 * kRows.length : s * 1.5), sum = hs.reduce((a, b) => a + b, 0), air = A.h - sum; if (air < 0) return false;
    const g = cs.slice(1).map(() => P([.4, 1, 1, 2.6])), gs = g.reduce((a, b) => a + b, 0) || 1, l = B.layer('hero', { read: true, gentle: true, quiet: true }), b = B.layer('hero', { read: true, body: true, quiet: true }); let y = A.y;
    cs.forEach((c, i) => {
      if (i) y += air * g[i - 1] / gs;
      if (i === key) kRows.forEach((r, j) => { const w = B.emOf(r) * kS, x = side(i) ? Math.max(A.x, ax - w) : Math.min(ax, A.x + A.w - w); B.row(l, r, x - kS * .03, y + kS * 1.12 * (j + .5), kS, { align: 'left', c: maybe(.4) ? pal.a : pal.i }); });
      else B.row(b, c.full, side(i) ? ax - gut : ax + gut, y + hs[i] / 2, s, { f: 'body', align: side(i) ? 'right' : 'left', c: pal.i });
      y += hs[i];
    });
    return true;
  } },

  { id: 'turn', dup: true, w: 4, face: ['heavySans', 'lightSans', 'heavySerif'], fx: ['melt', 'cuts'],
    ok: B => B.hero && B.hero.units.length >= 2 && B.hero.units.length <= 10 && B.D > 12 && B.N < 380, run(B){
    // 转题：标题转九十度贴着纸边，正文落在旁边的栏里
    const { R, P, pal, A, maybe } = B, hu = B.hero.units, em = B.emOf(hu), s = Math.min(A.h / em, A.w * R(.26, .4)), left = maybe(.6), x = left ? A.x + s / 2 : A.x + A.w - s / 2, r = left ? -Math.PI / 2 : Math.PI / 2, l = B.layer('hero'); if (s < 80) return false;
    let d = maybe(.5) ? 0 : A.h - em * s; hu.forEach(u => { const w = B.em(u.t) * s; B.glyph(l, u, x, left ? A.y + A.h - d - w / 2 : A.y + d + w / 2, s, { r, c: pal.i }); d += w; });
    if (B.solo) return true;
    const g = 56 * B.u, w = A.w - s - g; return !!B.body(left ? A.x + s + g : A.x, A.y, Math.min(w, A.w * .5), A.h, { max: 30, min: 20, va: P(['top', 'bottom']) });
  } },
];
BLIND_COMPS.unshift(...BLIND_QUIET);

// ════════════════════════════════════════════════════════════════════
//  9. 版式盲盒 ⑥ 意象字：文字即图形
// ════════════════════════════════════════════════════════════════════
// 不画山，拿「山」字去叠成山；不画雨，让「雨」字自己落下来。
// 来路：《何曾梦觉》主题曲歌词播放器里的意象字（江流、山没进雾里、一串灯拱成桥、水里倒着的月）。
// 字典里有的字，正文里恰好也有，才会抽到。图是回声（没有 at），正文另在旁边完完整整地站着。
// 手段仍然只有：同一个字的 位置／大小／拉伸／透明度。不画一笔图形。
const B_IMAGE = {
  mount : '山岭峰岳崖丘峦', rain: '雨泪滴露淋', snow: '雪霜絮尘', river: '江河水流溪川泉', sea: '海湖潮浪波洋', moon: '月影镜', star: '星萤',
  lamp  : '灯火烛焰炉暖', ray: '光日阳晨曦', door: '门窗屋家房院', road: '路街巷途', bridge: '桥虹', wood: '树木林森竹草', wind: '风吹',
  mist  : '云雾烟梦烬', bloom: '花朵莲梅桃', fall: '叶落坠飘', bird: '鸟雁鹤燕蝶', boat: '舟船帆', far: '远去走离别', coil: '回绕圈转旋年',
  ripple: '声念说唱听语歌喊叫话琴钟', night: '夜黑暗', heart: '心爱吻', deep: '深井渊海底底沉', tall: '高长塔楼', echo: '想忆记忘等',
};
const B_IMAGE_OF = (() => { const m = new Map(); for (const [k, s] of Object.entries(B_IMAGE)) for (const c of s) if (!m.has(c)) m.set(c, k); return m; })();

// 每一种：往 Z（{x,y,w,h}）里摆同一个字。heavy ＝ 这款字重，淡到多少要跟着字重走
const B_PICTO = {
  mount(B, c, Z, al){
    // 远的淡、近的浓，只有山脚没进雾里。细宋立不住山，一律换粗的
    const { R, I, pal, maybe } = B, n = I(3, 4), base = Z.y + Z.h * .98, side = maybe(.5) ? 0 : 1, dens = [.1, .2, .4, .82].slice(4 - n), stack = bClean(c);
    for (let i = 0; i < n; i++){ const t = i / (n - 1), w = Z.w * (.86 - .34 * t) * R(.92, 1.06), h = w * R(.82, .96), x = Z.x + Z.w * ((i + side) % 2 ? R(.28, .38) : R(.6, .7)), y1 = base - Z.h * .06 * (n - 1 - i); B.glyph(B.layer('deco', { bleed: true, alpha: dens[i], fade: { y0: y1 - h * .34, y1: y1 + h * .06 } }), c, x, y1 - h / 2, 100, { cell: [w, h], c: pal.i, stack }); }
  },
  rain(B, c, Z, al){ const { R, I, pal, rnd } = B, l = B.layer('deco', { bleed: true }); for (let i = 0, n = I(46, 90); i < n; i++){ const s = R(13, 30) * B.u, k = R(1.4, 4.2); B.glyph(l, c, Z.x + Z.w * rnd(), Z.y + Z.h * rnd(), 100, { cell: [s * .62, s * k], c: pal.i, a: R(.16, .78) }); } },
  snow(B, c, Z, al){ const { R, I, pal, rnd } = B, l = B.layer('deco', { bleed: true }); for (let i = 0, n = I(60, 120); i < n; i++){ const d = Math.pow(rnd(), .62); B.glyph(l, c, Z.x + Z.w * rnd(), Z.y + Z.h * d, R(12, 34) * B.u * (.55 + .65 * d), { c: pal.i, a: R(.18, .9), r: R(-.5, .5) }); } },
  river(B, c, Z, al){
    const { R, I, pal } = B, l = B.layer('deco', { bleed: true }), n = I(5, 8), ph = R(0, 6.28);
    for (let j = 0; j < n; j++){ const t = j / (n - 1), y = Z.y + Z.h * (.16 + .8 * Math.pow(t, 1.35)), s = (13 + 34 * Math.pow(t, 1.3)) * B.u; for (let x = Z.x - 40 - s * R(0, 1); x < Z.x + Z.w + 60; x += s * (1.02 + t * .5)){ const q = (x - Z.x) / Z.w * 6.28; B.glyph(l, c, x, y + Math.sin(q * .9 + ph + t * 1.6) * Z.h * .05 * (.4 + t), s, { c: pal.i, a: Math.min(.8, al * (1 + 2.2 * (.5 + .5 * Math.sin(q * 1.3 + j * 1.9)))), r: Math.cos(q * .9 + ph + t * 1.6) * .2 }); } }
  },
  sea(B, c, Z, al){ const { R, I, pal } = B, l = B.layer('deco', { bleed: true }), n = I(11, 16), hz = Z.y + Z.h * R(.1, .2); let y = hz; for (let j = 0; j < n; j++){ const t = j / (n - 1), h = (5 + 52 * t * t) * B.u, w = (26 + 74 * t) * B.u; if (y + h > Z.y + Z.h) break; for (let x = Z.x - w * R(0, 1) - 40; x < Z.x + Z.w + w; x += w * 1.02) B.glyph(l, c, x, y + h / 2, 100, { cell: [w * .94, h], c: pal.i, a: Math.min(.8, (.16 + .5 * t) * R(.6, 1.25)) }); y += h * 1.5 + 3; } return { hz }; },
  moon(B, c, Z, al){ const { R, pal } = B, s = Math.min(Z.w * .56, Z.h * .5), x = Z.x + Z.w * R(.35, .65), hz = Z.y + Z.h * .54; B.glyph(B.layer('deco', {}), c, x, hz - s * .56, s, { c: pal.a, a: .95 }); const l = B.layer('deco', { bleed: true, alpha: Math.min(.5, al * 3.2), fade: { y0: hz, y1: hz + s * 1.1 }, fx: ['ripple'], avg: s, gentle: true }); B.glyph(l, c, x, hz + s * .56, s, { c: pal.i, flip: true }); B.layer('deco', { bleed: true }).ops.push({ k: 'r', x: 0, y: hz - .6, w: B.W, h: 1.2, c: bAlpha(pal.i, .35) }); },
  star(B, c, Z, al){ const { R, I, pal, rnd } = B, l = B.layer('deco', { bleed: true }); for (let i = 0, n = I(44, 90); i < n; i++){ const z = Math.pow(rnd(), 3), q = i % 9; B.glyph(l, c, Z.x + Z.w * (q % 3 + rnd()) / 3, Z.y + Z.h * (Math.floor(q / 3) + rnd()) / 3, (9 + 46 * z) * B.u, { c: z > .6 ? pal.a : pal.i, a: Math.min(1, .3 + z) }); } },
  lamp(B, c, Z, al){ const { R, pal } = B, x = Z.x + Z.w * R(.34, .66), y = Z.y + Z.h * R(.4, .6), s = Math.min(Z.w, Z.h) * R(.2, .3), l = B.layer('deco', { bleed: true }); for (let k = 1; k <= 5; k++){ const r = s * (.62 + k * .42), n = Math.round(r * 6.28 / (s * .46)); for (let i = 0; i < n; i++){ const a = i / n * 6.2832 + k * .4; B.glyph(l, c, x + Math.cos(a) * r, y + Math.sin(a) * r, s * .25, { c: pal.a, a: .62 * Math.pow(.56, k - 1) }); } } B.glyph(B.layer('deco'), c, x, y, s, { c: pal.a }); },
  ray(B, c, Z, al){ const { R, I, pal } = B, x = Z.x + Z.w * R(.2, .8), y = Z.y + Z.h * R(.2, .8), n = I(20, 30), l = B.layer('deco', { bleed: true }), far = Math.hypot(Z.w, Z.h); for (let i = 0; i < n; i++){ const a = i / n * 6.2832; for (let d = 70 * B.u, k = 0; d < far; k++){ const s = (13 + d * .045); B.glyph(l, c, x + Math.cos(a) * d, y + Math.sin(a) * d, s, { c: pal.i, a: Math.max(.03, Math.min(.85, al * 6 * Math.exp(-d / (far * .26)))), r: a + Math.PI / 2 }); d += s * 1.5; } } B.glyph(B.layer('deco'), c, x, y, 96 * B.u, { c: pal.a }); },
  door(B, c, Z, al){ const { R, I, pal } = B, n = I(7, 10), x = Z.x + Z.w * R(.42, .58), y = Z.y + Z.h * R(.48, .56), q = R(.72, .8); let s = Math.min(Z.w * 1.1, Z.h * 1.08); for (let i = 0; i < n; i++){ const l = B.layer('deco', { bleed: true }); B.glyph(l, c, x, y + (i * 4) * B.u, s, { c: i === n - 1 ? pal.a : pal.i, a: i === n - 1 ? 1 : Math.min(.9, al * (1 + i * .9)) }); s *= q; } },
  road(B, c, Z, al){ const { R, pal } = B, q = R(.76, .82), s0 = Math.min(Z.w * .62, Z.h * (1 - q) / .64), vx = Z.x + Z.w * R(.36, .7), x0 = Z.x + Math.max(s0 / 2, Z.w * R(.3, .6)), l = B.layer('deco', { bleed: true }); let y = Z.y + Z.h, s = s0; for (let i = 0; i < 16 && s > 11; i++){ const t = 1 - s / s0, h = s * .58; B.glyph(l, c, x0 + (vx - x0) * t + Math.sin(t * 4.6) * Z.w * .07, y - h / 2, 100, { cell: [s, h], c: i ? pal.i : pal.a, a: i ? Math.max(.16, 1 - t * .86) : 1 }); y -= h * 1.1; s *= q; } },
  bridge(B, c, Z, al){ const { R, pal } = B, l = B.layer('deco', { bleed: true }), n = 17, y0 = Z.y + Z.h * .72, rise = Z.h * R(.3, .46); for (let i = 0; i < n; i++){ const t = i / (n - 1), x = Z.x + Z.w * (t * 1.04 - .02), y = y0 - Math.sin(Math.PI * t) * rise, s = Z.w / n * (.7 + .34 * Math.sin(Math.PI * t)); B.glyph(l, c, x, y, s, { c: pal.a, a: .4 + .6 * Math.sin(Math.PI * t) }); B.glyph(l, c, x, y0 + (y0 - y) * .5 + s, s * .9, { c: pal.i, a: al * 1.6, flip: true }); } },
  wood(B, c, Z, al){ const { R, I, pal } = B, n = I(13, 22); for (let j = 0; j < 2; j++){ const l = B.layer('deco', { bleed: true }); for (let i = 0; i < n; i++){ const w = Z.w / n * R(.7, 1.8), h = Z.h * R(.4, 1.02) * (j ? 1 : .8); B.glyph(l, c, Z.x + Z.w * (i + R(.1, .9)) / n, Z.y + Z.h - h / 2, 100, { cell: [w, h], c: pal.i, a: Math.min(.75, al * (j ? R(1.2, 3.4) : R(.6, 1.2))) }); } } },
  wind(B, c, Z, al){ const { R, I, pal } = B, l = B.layer('deco', { bleed: true }), rows = I(6, 9); for (let j = 0; j < rows; j++){ const y = Z.y + Z.h * (j + .5) / rows, s = R(26, 88) * B.u, x0 = Z.x + Z.w * R(-.1, .5), n = I(8, 16), ph = R(0, 6); for (let i = 0; i < n; i++){ const x = x0 + i * s * R(.66, .8); if (x > Z.x + Z.w + s) break; B.glyph(l, c, x, y + Math.sin(i * .42 + ph) * s * .28, s, { c: pal.i, a: Math.min(.9, Math.max(.03, al * 5.4 * Math.pow(.79, i))), r: .12 }); } } },
  mist(B, c, Z, al){ const { R, I, pal } = B, n = I(4, 6); for (let i = 0; i < n; i++){ const s = Z.w * R(.36, .8), l = B.layer('deco', { bleed: true, alpha: Math.min(.5, al * R(1, 2)), soft: R(8, 40) * B.u }); B.glyph(l, c, Z.x + Z.w * R(.15, .85), Z.y + Z.h * R(.2, .8), 100, { cell: [s, s * R(.4, .8)], c: pal.i }); } B.glyph(B.layer('deco'), c, Z.x + Z.w * R(.3, .7), Z.y + Z.h * R(.4, .6), Z.w * .2, { c: pal.i, a: .9 }); },
  bloom(B, c, Z, al){ const { R, I, pal } = B, put = (x, y, r, a, col) => { const l = B.layer('deco', { bleed: true }), n = I(5, 7), off = R(0, 1); for (let i = 0; i < n; i++){ const t = (i + off) / n * 6.2832; B.glyph(l, c, x + Math.sin(t) * r * .6, y - Math.cos(t) * r * .6, r * .86, { c: col, a, r: t }); } }; put(Z.x + Z.w * R(.36, .64), Z.y + Z.h * R(.42, .58), Math.min(Z.w, Z.h) * R(.28, .36), .34, pal.a); for (let i = 0, n = I(0, 2); i < n; i++) put(Z.x + Z.w * R(.06, .94), Z.y + Z.h * R(.06, .94), Math.min(Z.w, Z.h) * R(.06, .13), al * 1.8, pal.i); },
  fall(B, c, Z, al){ const { R, I, pal } = B, l = B.layer('deco', { bleed: true }), tracks = I(3, 5); for (let j = 0; j < tracks; j++){ const x0 = Z.x + Z.w * (j + .5) / tracks, n = I(9, 14), s = R(30, 74) * B.u, ph = R(0, 6.28), end = R(.6, 1); for (let i = 0; i < n; i++){ const t = i / (n - 1); B.glyph(l, c, x0 + Math.sin(t * 5 + ph) * s * 1.1, Z.y + Z.h * t * end, s, { c: i === n - 1 ? pal.a : pal.i, a: i === n - 1 ? 1 : Math.max(.03, al * 3.6 * Math.pow(t, 2.2)), r: Math.sin(t * 5 + ph + 1) * .9 }); } } },
  bird(B, c, Z, al){ const { R, I, pal } = B, l = B.layer('deco', { bleed: true }), n = I(5, 7), x = Z.x + Z.w * R(.3, .5), y = Z.y + Z.h * R(.25, .4), d = Z.w * .085; for (let i = -n; i <= n; i++){ const k = Math.abs(i), s = (54 - k * 4.4) * B.u; B.glyph(l, c, x + k * d * .86, y + i * d * .5 + (i > 0 ? k * 3 : 0), s, { c: k ? pal.i : pal.a, a: 1 - k * .09, r: -.12 }); } },
  boat(B, c, Z, al){ const { R, pal } = B, q = B.seaChar && B_PICTO.sea(B, B.seaChar, { ...Z, y: Z.y + Z.h * .3, h: Z.h * .7 }, al); const x = Z.x + Z.w * R(.25, .75), y = (q ? q.hz : Z.y + Z.h * .6); B.glyph(B.layer('deco'), c, x, y - 34 * B.u, 64 * B.u, { c: pal.a }); if (!q) B.layer('deco', { bleed: true }).ops.push({ k: 'r', x: 0, y, w: B.W, h: 1.2, c: bAlpha(pal.i, .4) }); },
  far(B, c, Z, al){ const { R, I, pal, maybe } = B, l = B.layer('deco', { bleed: true }), n = I(9, 13), rt = maybe(.5), x0 = rt ? Z.x + Z.w * .1 : Z.x + Z.w * .9, y0 = Z.y + Z.h * .78, x1 = rt ? Z.x + Z.w * .96 : Z.x + Z.w * .04, y1 = Z.y + Z.h * .06; for (let i = 0; i < n; i++){ const t = 1 - Math.pow(.72, i), s = Math.max(11, Z.w * .4 * Math.pow(.72, i)); B.glyph(l, c, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, s, { c: i ? pal.i : pal.a, a: Math.max(.08, 1 - t * .95) }); } },
  coil(B, c, Z, al){ const { R, pal } = B, l = B.layer('deco', { bleed: true }), cx = Z.x + Z.w / 2, cy = Z.y + Z.h / 2, rm = Math.min(Z.w, Z.h) * .5; let a = R(0, 6.28), r = rm; for (let i = 0; i < 220 && r > 10; i++){ const s = 10 + r * .15; B.glyph(l, c, cx + Math.cos(a) * r, cy + Math.sin(a) * r, s, { c: pal.i, a: Math.min(1, al * 1.2 + (1 - r / rm) * .8), r: a + Math.PI / 2 }); a += s * 1.12 / r; r *= 1 - .026 * s * 1.12 / r * 3.2; } },
  ripple(B, c, Z, al){ const { R, pal, maybe } = B, l = B.layer('deco', { bleed: true }), cx = maybe(.5) ? Z.x : Z.x + Z.w, cy = Z.y + Z.h * R(.3, .7), far = Z.w * 1.12; B.glyph(l, c, cx + (cx > Z.x ? -44 : 44) * B.u, cy, 88 * B.u, { c: pal.a }); for (let r = 150 * B.u, k = 0; r < far; k++){ const s = (19 + k * 4.2) * B.u, n = Math.floor(r * 6.2832 / (s * 1.25)), a = Math.max(.045, al * 5.2 * Math.pow(.73, k)); for (let i = 0; i < n; i++){ const t = i / n * 6.2832, x = cx + Math.cos(t) * r, y = cy + Math.sin(t) * r; if (x < -s || x > B.W + s || y < Z.y - s || y > Z.y + Z.h + s) continue; B.glyph(l, c, x, y, s, { c: pal.i, a: Math.min(.9, a), r: t + Math.PI / 2 }); } r += s * 2.5; } },
  night(B, c, Z, al){ const { R, pal } = B, l = B.layer('deco', { bleed: true, clip: { x: 0, y: Z.y, w: B.W, h: Z.h } }), s = R(40, 64) * B.u, rows = Math.ceil(Z.h / (s * .86)), cols = Math.ceil(B.W / (s * .86)) + 1; for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) B.glyph(l, c, i * s * .86 + (j % 2) * s * .43, Z.y + j * s * .86 + s / 2, s, { c: pal.i, a: Math.max(.02, Math.min(.96, Math.pow(1 - j / rows, 1.7) * .95)) }); },
  // 心跳：一条平线，跳一下，再跳一下
  heart(B, c, Z, al){ const { R, pal } = B, beat = [1, 1, 1, 1.35, 1, .8, 4.6, 1.7, 1, 1, 1, 1.3, 1, .8, 3.1, 1.4, 1, 1, 1], s0 = Z.w / beat.reduce((q, v) => q + v * .94, 0), l = B.layer('deco', { bleed: true }), y = Z.y + Z.h * R(.44, .58), top = Math.max(...beat); let x = Z.x; beat.forEach((v, i) => { const s = s0 * v; B.glyph(l, c, x + s * .47, y - (v > 1.6 ? s * .16 : 0), s, { c: v === top ? pal.a : pal.i, a: v > 1.6 ? 1 : Math.max(.22, Math.min(.6, al * 2.6)) }); x += s * .94; }); },
  deep(B, c, Z, al){ const { R, I, pal } = B, n = I(8, 11), l = B.layer('deco', { bleed: true }); let y = Z.y, s = Math.min(Z.w * .5, Z.h * .34); const x = Z.x + Z.w * R(.3, .7); for (let i = 0; i < n && y < Z.y + Z.h; i++){ B.glyph(l, c, x, y + s / 2, s, { c: pal.i, a: Math.max(.05, Math.pow(.74, i)) }); y += s * .94; s *= .84; } },
  tall(B, c, Z, al){ const { R, I, pal } = B, n = I(1, 3); for (let i = 0; i < n; i++){ const w = Z.w * R(.12, .2); B.glyph(B.layer('deco', { bleed: true }), c, Z.x + Z.w * (n === 1 ? R(.3, .7) : (i + .5) / n), Z.y + Z.h * .5 + (i % 2) * Z.h * .08, 100, { cell: [w, Z.h * (i % 2 ? .72 : 1)], c: i ? pal.i : pal.a, a: i ? Math.min(.6, al * 2.4) : 1 }); } },
  echo(B, c, Z, al){ const { R, I, pal, maybe } = B, n = I(5, 8), dx = Z.w * R(.06, .11) * (maybe(.5) ? 1 : -1), dy = Z.h * R(.05, .09), s = Math.min(Z.w, Z.h) * R(.4, .52), x = dx > 0 ? Z.x + s / 2 : Z.x + Z.w - s / 2; for (let i = n - 1; i >= 0; i--) B.glyph(B.layer('deco', { bleed: true }), c, x + dx * i, Z.y + s / 2 + dy * i, s, { c: i ? pal.i : pal.a, a: i ? Math.max(.04, .5 * Math.pow(.62, i)) : 1 }); },
};

BLIND_COMPS.unshift(
  { id: 'image', q: true, w: 6, face: ['lightSerif', 'serif', 'heavySerif'],
    ok: B => B.cjk && B.N >= 5 && B.N <= 200 && B.core.some(u => B_IMAGE_OF.has(u.t)), run(B){
    const { R, P, pal, A, maybe } = B, cands = [...new Set(B.core.map(u => u.t).filter(t => B_IMAGE_OF.has(t)))], c = P(cands), kind = B_IMAGE_OF.get(c); if (kind === 'heart' && maybe(.75)) return false;
    const heavy = /Black|Heavy|900/.test(B.fonts.hero + B.fonts.heroW);
    B.seaChar = B.core.map(u => u.t).find(t => ['sea', 'river'].includes(B_IMAGE_OF.get(t)));
    const al = heavy ? R(.07, .11) : R(.14, .2), full = maybe(.4) && ['mount', 'rain', 'snow', 'star', 'wood', 'mist', 'wind', 'sea', 'river', 'night', 'ripple', 'ray'].includes(kind), cs = B.clauses;
    const zone = A.h * R(.58, .68), top = ['wood', 'night', 'deep', 'rain', 'snow', 'star', 'bird', 'mount', 'moon', 'far'].includes(kind) ? maybe(.86) : maybe(.6), Z = full ? { ...A } : { x: A.x, y: top ? A.y : A.y + A.h - zone, w: A.w, h: zone };
    B_PICTO[kind](B, c, Z, full ? al * .8 : al);
    B.picto = kind;
    // 正文：短的一句一落，长的排成一小块；铺满整张的时候，字从图上面走过
    const g = 40 * B.u, Y = full ? A.y : top ? A.y + zone + g : A.y, H = full ? A.h : A.h - zone - g;
    if (cs.length >= 2 && cs.length <= 7 && B.N <= 60 && maybe(.62)){
      const l = B.layer('hero', { read: true, body: true, quiet: true }), n = cs.length, z = Math.min(38 * B.u, H / n * .52, A.w * .8 / Math.max(...cs.map(q => B.emOf(q.full, 'body'))));
      if (z >= 22){ const pitch = Math.min(H / n, z * R(1.9, 2.7)), col = A.w / 12; let y = Y + (H - pitch * n) * (full ? P([.1, .5, .9]) : top ? 1 : 0), at = B.I(0, 4); cs.forEach(q => { const room = Math.max(0, Math.floor((A.w - B.emOf(q.full, 'body') * z) / col)); at = Math.max(0, Math.min(room, at + P([-2, 1, 2, 3]))); B.row(l, q.full, A.x + at * col, y + pitch / 2, z, { f: 'body', align: 'left', c: pal.i }); y += pitch; }); return true; }
      B.layers.pop();
    }
    const v = full ? maybe(.5) : false, w = A.w * (v ? .5 : R(.5, .66)), x = P([A.x, A.x + (A.w - w) * .5, A.x + A.w - w]);
    return !!B.body(x, Y, w, full ? A.h * .8 : H, { vertical: v, max: 32, min: 20, va: top ? 'bottom' : 'top', ha: v ? P(['left', 'right']) : 'left' }) || !!B.body(A.x, Y, A.w, H, { max: 28, min: 20, va: top ? 'bottom' : 'top' });
  } },
  { id: 'youme', q: true, w: 4, face: ['lightSerif', 'heavySerif', 'lightSans', 'heavySans'],
    ok: B => B.cjk && B.N >= 6 && B.N <= 200 && B.core.some(u => u.t === '你') && B.core.some(u => u.t === '我'), run(B){
    // 你我：两个很大很淡的字交叠在一起，叠住的地方最深
    const { R, P, pal, A, maybe } = B, zone = A.h * R(.6, .7), top = maybe(.6), y0 = top ? A.y : A.y + A.h - zone, v = maybe(.4), heavy = /Black|Heavy|900/.test(B.fonts.hero + B.fonts.heroW), s = Math.min(A.w * .74, zone * (v ? .64 : .98)), k = R(.3, .62), cy = y0 + zone / 2, cx = A.x + A.w / 2, d = s * k / 2;
    ['我', '你'].forEach((t, i) => { const q = i ? 1 : -1; B.glyph(B.layer('deco', { bleed: true, alpha: heavy ? .34 : .6, blend: B.dark ? 'screen' : 'multiply' }), t, cx + (v ? 0 : q * d * 1.3), cy + (v ? q * d : 0), s, { c: i ? pal.a : pal.i }); });
    const g = 44 * B.u, H = A.h - zone - g; return !!B.body(A.x + A.w * P([0, 1 / 3, .5]), top ? A.y + zone + g : A.y, A.w * .5, H, { max: 30, min: 20, va: top ? 'bottom' : 'top' }) || !!B.body(A.x, top ? A.y + zone + g : A.y, A.w, H, { max: 28, min: 20, va: top ? 'bottom' : 'top' });
  } },
);

// ════════════════════════════════════════════════════════════════════
//  9. 版式盲盒 ④′ 有体温的那些
// ════════════════════════════════════════════════════════════════════
// 第一版里舍不得丢的（横幅、直幅、色块、起伏、坠落、倒影……）和新写的几种。
// 它们自己不讲究，全靠气氛（looks）托着：老宋体、化得开的底、字上有光有质地。
const bTurn = (l, r, cx, cy) => { const c = Math.cos(r), s = Math.sin(r); for (const o of l.ops){ const dx = o.x - cx, dy = o.y - cy; o.x = cx + dx * c - dy * s; o.y = cy + dx * s + dy * c; o.r = (o.r || 0) + r; } };
const BLIND_MORE = [
  { id: 'banner', dup: true, w: 6, face: ['oldSerif', 'oldSerif', 'heavySerif', 'serif', 'heavySans', 'lightSerif'],
    ok: B => B.hero && B.hero.units.length >= 2 && B.hero.units.length <= 12 && B.D > 10 && B.N < 420, run(B){
    // 横幅：主角顶满一整行或两行，正文退得远远的
    const { W, R, P, pal, A, maybe } = B, hu = B.hero.units, two = hu.length >= 4 && (hu.length > 7 || maybe(.6)), rows = two ? B.split(hu, hu.length > 9 ? 3 : 2) : [hu];
    const s = Math.min(...rows.map(r => A.w / B.emOf(r)), A.h * (two ? .24 : .34)), zone = rows.length * s * 1.04; if (s < 70) return false;
    const pos = B.solo ? 'mid' : P(['top', 'top', 'bottom', 'mid']), l = B.layer('hero'), c = P([pal.i, pal.i, pal.a]), al = P(['left', 'cross', 'cross', 'center']);
    const put = y => rows.forEach((r, i) => B.row(l, r, al === 'left' ? A.x : al === 'center' ? W / 2 : i % 2 ? A.x + A.w : A.x, y + s * 1.04 * (i + .5), s, { align: al === 'left' ? 'left' : al === 'center' ? 'center' : i % 2 ? 'right' : 'left', c }));
    const gap = R(50, 90) * B.u, rest = A.h - zone - gap;
    if (B.solo){ put(A.y + (A.h - zone) * R(.2, .7)); return true; }
    if (pos === 'mid'){ const up = rest * R(.14, .32); put(A.y + up); return !!B.body(A.x + A.w * P([0, .3, .42]), A.y + up + zone + gap, A.w * .58, rest - up, { max: 36, va: P(['top', 'bottom']) }) || !!B.body(A.x, A.y + up + zone + gap, A.w, rest - up, { max: 32 }); }
    put(pos === 'top' ? A.y : A.y + A.h - zone); const y = pos === 'top' ? A.y + zone + gap : A.y, v = B.cjk && maybe(.45);
    return !!B.body(A.x + (v ? 0 : A.w * P([0, .2, .42])), y, A.w * (v ? 1 : .58), rest, { vertical: v, max: 36, ha: P(['right', 'left']), va: pos === 'top' ? P(['bottom', 'bottom', 'top']) : 'top' }) || !!B.body(A.x, y, A.w, rest, { max: 32, va: 'top' });
  } },

  { id: 'full', w: 8, face: ['oldSerif', 'oldSerif', 'oldSerif', 'heavySerif', 'serif'], ok: B => B.clauses.length >= 2 && B.clauses.length <= 10 && B.N >= 4 && B.N <= 90, run(B){
    // 满排：每一行都撑到两边，字少的大，字多的小；字不拉不扁
    const { W, R, P, pal, A, maybe } = B, cs = B.clauses.flatMap(c => c.n > 11 ? B.split(c.full, 2).map(full => ({ full, of: c })) : [{ full: c.full, of: c }]), n = cs.length; if (n > 11) return false;
    let best = [];
    for (let m = 0; m < 1 << (n - 1); m++){
      const rows = [[]]; cs.forEach((c, i) => { rows[rows.length - 1].push(c); if (i < n - 1 && m >> i & 1) rows.push([]); });
      let h = 0, ok = true; const rs = rows.map(r => { const em = r.reduce((a, c, i) => a + B.emOf(c.full) + (i ? .5 : 0), 0), s = Math.min(A.w / em, A.h * .42); if (s < 30) ok = false; h += s * 1.08; return { r, em, s }; });
      // 光是塞满不够，行与行要有大有小
      if (ok && h <= A.h && h >= A.h * .42) best.push({ rs, h, v: h / A.h + .5 * Math.min(2.4, Math.max(...rs.map(q => q.s)) / Math.min(...rs.map(q => q.s))) / 2.4 });
    }
    if (!best.length) return false;
    best.sort((a, b) => b.v - a.v); const { rs, h } = P(best.slice(0, 5)), l = B.layer('hero', { read: true, gentle: true }), gap = rs.length > 1 ? Math.min((A.h - h) / (rs.length - 1), 40 * B.u) : 0, hit = maybe(.75);
    let y = A.y + (A.h - h - gap * (rs.length - 1)) * P([0, .5, .5, 1]);
    for (const { r, em, s } of rs){ let x = A.x + (A.w - em * s) / 2; r.forEach((c, i) => { if (i) x += .5 * s; x += B.row(l, c.full, x, y + s * .54, s, { align: 'left', c: hit && c.of === B.keyClause && n > 1 ? pal.a : pal.i }); }); y += s * 1.08 + gap; }
    return true;
  } },

  { id: 'stars', w: 6, face: ['oldSerif', 'oldSerif', 'serif', 'lightSerif'], ok: B => B.N >= 4 && B.N <= 44, run(B){
    // 散星：字一颗一颗散开，顺着一条看不见的线往下读
    const { R, P, maybe, pal, A } = B, us = B.core, n = us.length, turns = R(.6, 1.5), ph = R(0, 6.28), amp = A.w * R(.26, .4);
    const pts = us.map((u, i) => { const t = n > 1 ? i / (n - 1) : .5, big = B.isKey(u), s = Math.min(170, Math.sqrt(A.w * A.h / n) * (big ? R(.56, .72) : P([.26, .36, .46, .56]))) / Math.max(1, B.em(u.t) * .62); return { u, s: Math.max(34, s), big, x: A.x + A.w / 2 + Math.sin(t * turns * 6.28 + ph) * amp + R(-30, 30), y: A.y + 60 + t * (A.h - 120) + R(-16, 16) }; }), rad = p => p.s * Math.max(1, B.em(p.u.t)) * .62;
    for (let k = 0; k < 90; k++) for (let i = 0; i < n; i++){
      for (let j = i + 1; j < n; j++){ const a = pts[i], b = pts[j], dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1, need = (rad(a) + rad(b)) * 1.06; if (d < need){ const m = (need - d) / 2 / d; a.x -= dx * m; a.y -= dy * m * .6; b.x += dx * m; b.y += dy * m * .6; } }
      const p = pts[i], r = rad(p); p.x = Math.max(A.x + r, Math.min(A.x + A.w - r, p.x)); p.y = Math.max(A.y + p.s * .55, Math.min(A.y + A.h - p.s * .55, p.y));
    }
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y) < (rad(pts[i]) + rad(pts[j])) * .8) return false;
    const l = B.layer('hero', { read: true, gentle: true, quiet: true }), twist = maybe(.3) ? .16 : 0; for (const p of pts) B.glyph(l, p.u, p.x, p.y, p.s, { c: p.big ? pal.a : pal.i, r: R(-twist, twist) });
    return true;
  } },

  { id: 'column', dup: true, w: 8, face: ['oldSerif', 'oldSerif', 'heavySerif', 'serif', 'heavySerif', 'lightSerif'],
    ok: B => B.cjk && B.hero && B.hero.units.length >= 2 && B.hero.units.length <= 9 && B.D > 10 && B.N < 420, run(B){
    // 直幅：主角竖着从天落到地，字不拉不扁；正文竖排，靠在它的影子里
    const { R, maybe, P, pal, A } = B, hu = B.hero.units, n = B.colLen(hu), s = Math.min(A.h * R(.7, .98) / n, A.w * R(.2, .36)), right = maybe(.66), slack = A.h - s * n, x = right ? A.x + A.w - s / 2 : A.x + s / 2;
    const l = B.layer('hero'); B.col(l, hu, x, A.y + slack * P([0, 0, 1, .4]), s, { c: P([pal.i, pal.i, pal.a]) }); if (B.solo) return true;
    const gap = R(54, 110) * B.u, w = A.w - s - gap, h = A.h * R(.42, .7), bx = right ? A.x : A.x + s + gap;
    return !!B.body(bx, maybe(.3) ? A.y + A.h - h : A.y, w, h, { vertical: true, max: 36, ha: right ? P(['right', 'left', 'left']) : 'right' }) || !!B.body(bx, A.y, w, A.h, { vertical: true, max: 32, min: 20, ha: 'right' });
  } },

  { id: 'panel', dup: true, w: 5, face: ['oldSerif', 'oldSerif', 'heavySerif', 'serif', 'heavySans'], modes: ['left', 'right'],
    ok: B => B.cjk && B.hero && B.hero.units.length <= 8 && B.D > 10 && B.N < 380, run(B){
    // 色块：纸分两色，一边喊，一边说
    const { W, H, R, P, pal, A, maybe, M } = B, hu = B.hero.units, on = bOn(pal.a, pal), d = B.layer('back', { bleed: true, nofx: true }), l = B.layer('hero', { onAccent: on }), t = P([R(.3, .4), R(.3, .4), .618]), right = maybe(.6), w = W * t, x = right ? W - w : 0;
    const p = { k: 'r', x, y: 0, w, h: H, c: pal.a }; d.ops.push(p); if (maybe(.4)) d.soft = R(14, 60) * B.u;
    const n = B.colLen(hu, 'hero', .05), s = Math.min((H - M * 2.4) * .96 / n, w * .66); if (s < 60) return false;
    B.col(l, hu, x + w * P([.5, right ? .42 : .58]), P([M * 1.2, H - M * 1.2 - n * s, (H - n * s) / 2]), s, { gap: .05, c: on });
    const bx = right ? M : w + M * .8, bw = W - w - M * 1.8; B.metaBox = { x: bx, w: bw }; if (B.solo) return true;
    return !!B.body(bx, A.y, bw, A.h, { vertical: maybe(.6), max: 36, ha: right ? P(['right', 'left']) : 'right', va: P(['top', 'bottom']) });
  } },

  { id: 'chorus', dup: true, w: 5, face: ['oldSerif', 'oldSerif', 'heavySerif', 'serif', 'heavySans'],
    ok: B => B.hero && B.hero.units.length >= 2 && B.hero.units.length <= 8 && B.D > 10 && B.N < 280, run(B){
    // 回声：一句话喊了好几遍，只有一遍是实的
    const { W, R, I, P, pal, A, maybe } = B, hu = B.hero.units, em = B.emOf(hu), s = Math.min(A.w * R(.8, 1) / em, A.h * .19, 250), rows = I(4, 6), pitch = s * R(.62, 1), zone = pitch * (rows - 1) + s; if (zone > A.h * .68 || s < 56) return false;
    const top = maybe(.6), y0 = (top ? A.y : A.y + A.h - zone) + s / 2, main = P([0, rows - 1, I(0, rows - 1)]), style = P(['line', 'fade', 'color', 'blur']), shift = maybe(.6) ? R(-34, 34) * B.u : 0, l = B.layer('hero');
    for (let i = 0; i < rows; i++){
      const d = Math.abs(i - main), y = y0 + i * pitch, x = W / 2 + shift * (i - main); if (!d){ B.row(l, hu, x, y, s, { c: pal.i }); continue; }
      const g = B.layer('deco', { bleed: true, ...(style === 'blur' ? { soft: 3 * d * B.u } : {}) });
      if (style === 'line') B.row(g, bGhost(hu), x, y, s, { c: B.kin, o: 1.8, a: Math.max(.22, .9 - d * .16) }); else B.row(g, bGhost(hu), x, y, s, { c: style === 'color' && d % 2 ? B.kin : pal.i, a: Math.max(.06, .46 - d * .11) });
    }
    if (B.solo) return true;
    const gap = 50 * B.u, bh = A.h - zone - gap, by = top ? A.y + zone + gap : A.y;
    return !!B.body(A.x + A.w * P([0, .2, .42]), by, A.w * .56, bh, { max: 34, va: top ? 'bottom' : 'top' }) || !!B.body(A.x, by, A.w, bh, { max: 32, va: 'top' });
  } },

  { id: 'depth', dup: true, w: 7, face: ['oldSerif', 'oldSerif', 'heavySerif', 'serif', 'lightSerif', 'heavySans'],
    ok: B => B.hero && B.hero.units.length >= 2 && B.hero.units.length <= 8 && B.D > 9 && B.N < 280, run(B){
    // 景深：同一句站在三个远近上，只有一处对得上焦
    const { W, H, R, P, pal, A, maybe } = B, hu = B.hero.units, v = B.cjk && maybe(.5), em = v ? B.colLen(hu) : B.emOf(hu), side = v ? A.h : A.w, s = Math.min(side * (v ? .52 : .7) / em, (v ? A.w : A.h) * .2); if (s < 44) return false;
    const put = (l, us, cx, cy, z, o) => v ? B.col(l, us, cx, cy - em * z / 2, z, o) : B.row(l, us, cx, cy, z, o), fx = R(.3, .7), fy = R(.22, .4);
    const far = [[R(2, 2.7), R(22, 40), R(.2, .34)], [R(1.3, 1.7), R(7, 13), R(.3, .5)]], sx = P([1, -1]);
    far.forEach(([k, b, a], i) => put(B.layer('deco', { bleed: true, soft: b * B.u, alpha: a }), bGhost(hu), W * (.5 + sx * [.2, -.22][i] + R(-.06, .06)), H * (v ? [.5, .46][i] : [.2, .48][i] + R(-.05, .05)), s * k, { c: i ? pal.i : P([B.kin, pal.i]) }));
    const l = B.layer('hero', { quiet: true }), w = v ? s : em * s, h = v ? em * s : s, cx = A.x + w / 2 + (A.w - w) * fx, cy = A.y + h / 2 + (A.h * .62 - h) * Math.min(1, Math.max(0, fy)); if (h > A.h * .62) return false;
    put(l, hu, cx, cy, s, { c: pal.i }); if (B.solo) return true;
    const by = cy + h / 2 + 56 * B.u; return !!B.body(A.x + A.w * P([0, .3, .5]), by, A.w * .5, A.y + A.h - by, { max: 30, va: 'bottom' }) || !!B.body(A.x, by, A.w, A.y + A.h - by, { max: 30, va: 'bottom' });
  } },

  { id: 'wave', w: 5, face: ['oldSerif', 'oldSerif', 'serif', 'lightSerif', 'heavySerif'], ok: B => B.N >= 14 && B.N <= 190, run(B){
    // 起伏：整段字浮在水上
    const { R, pal, A, maybe } = B, us = B.units, gap = R(0, .1), cap = Math.round(Math.min(92, Math.sqrt(A.w * A.h / B.N) * .52));
    for (let s = cap; s >= 27; s--){
      const lh = s * 1.9, rows = Math.floor(A.h * .84 / lh), lines = []; for (let i = 0; i < rows; i++) lines.push({ x0: A.x + s * .3, x1: A.x + A.w - s * .3, y: i * lh });
      const got = bFlow(B, us, s, lines, 'hero', gap); if (!got) continue;
      const used = got[got.length - 1].y + s, y0 = A.y + (A.h - used) * R(.3, .7) + s / 2, amp = Math.min(s * R(.34, .6), lh * .42), lam = R(300, 720), drift = R(-.9, .9), l = B.layer('hero', { read: true, gentle: true, body: s < 52 }), key = maybe(.7);
      for (const g of got){ const ph = g.x / lam * 6.28 + g.y / lh * drift; B.glyph(l, g.u, g.x, y0 + g.y + Math.sin(ph) * amp, s, { r: Math.cos(ph) * amp * 6.28 / lam * .8, c: key && B.isKey(g.u) ? pal.a : pal.i }); }
      return true;
    }
    return false;
  } },

  { id: 'fall', w: 4, face: ['oldSerif', 'oldSerif', 'serif', 'lightSerif'], ok: B => B.N >= 20 && B.N <= 200 && B.cjk, run(B){
    // 坠落：一开始好好排着，越到后头越散
    const { R, pal, A } = B, us = B.units, zone = A.h * .6, cap = Math.round(Math.min(86, Math.sqrt(A.w * A.h / B.N) * .5));
    for (let s = cap; s >= 27; s--){
      const lh = s * 1.75, rows = Math.floor(zone / lh), lines = []; for (let i = 0; i < rows; i++) lines.push({ x0: A.x, x1: A.x + A.w * .96, y: A.y + s / 2 + i * lh });
      const got = bFlow(B, us, s, lines, 'hero'); if (!got) continue;
      const t0 = R(.34, .55), l = B.layer('hero', { read: true, gentle: true, body: s < 52, quiet: true }), n = got.length, yEnd = got[n - 1].y, drop = A.y + A.h - s * .6 - yEnd, ps = [];
      got.forEach((g, i) => { const t = Math.max(0, (i / (n - 1) - t0) / (1 - t0)), k = t * t; ps.push({ g, k, x: Math.max(A.x + s / 2, Math.min(A.x + A.w - s / 2, g.x + R(-1, 1) * k * s * 1.1)), y: Math.min(A.y + A.h - s * .55, g.y + k * drop * R(.86, 1)) }); });
      // 散是散，别两个字摞在一起
      for (let q = 0; q < 60; q++) for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++){ const a = ps[i], b = ps[j], dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1, need = s * 1.02; if (d < need && b.k > .02){ const m = (need - d) / d; b.x += dx * m * .6; b.y += dy * m * .6; b.x = Math.max(A.x + s / 2, Math.min(A.x + A.w - s / 2, b.x)); b.y = Math.min(A.y + A.h - s * .55, Math.max(A.y + s * .5, b.y)); } }
      for (const { g, k, x, y } of ps) B.glyph(l, g.u, x, y, s * (1 - k * R(0, .2)), { r: R(-1, 1) * k * .6, c: B.isKey(g.u) ? pal.a : pal.i, a: k > .3 ? 1 - k * .35 : undefined });
      return true;
    }
    return false;
  } },

  { id: 'water', dup: true, w: 5, face: ['oldSerif', 'oldSerif', 'heavySerif', 'serif', 'heavySans', 'lightSerif'],
    ok: B => B.hero && B.hero.units.length >= 2 && B.hero.units.length <= 8 && B.D > 10 && B.N < 260, run(B){
    // 水面：上面是字，下面是它的倒影
    const { W, R, P, pal, A, maybe } = B, hu = B.hero.units, em = B.emOf(hu), s = Math.min(A.w * R(.8, .98) / em, A.h * .26); if (s < 64) return false;
    const hz = A.y + Math.max(s * 1.12, A.h * R(.28, .42)), l = B.layer('hero', { quiet: true }), m = B.layer('back', { mirror: hz, alpha: .8, bleed: true, fx: ['ripple', 'fade'], own: true }); B.row(l, hu, W / 2, hz - s * .56, s, { c: pal.i }); B.row(m, bGhost(hu), W / 2, hz + s * .56, s, { c: maybe(.6) ? B.kin : pal.i, flip: true });
    if (maybe(.5)) B.layer('deco').ops.push({ k: 'r', x: 0, y: hz - .7, w: W, h: 1.4, c: bAlpha(pal.i, .3) });
    if (B.solo) return true; const y = hz + s * 1.25 + 40;
    return !!B.body(A.x + A.w * P([0, .2, .42]), y, A.w * .58, A.y + A.h - y, { max: 34, va: P(['bottom', 'bottom', 'top']) }) || !!B.body(A.x, y, A.w, A.y + A.h - y, { max: 32, va: 'top' });
  } },

  { id: 'shape', w: 4, face: ['oldSerif', 'oldSerif', 'serif', 'lightSerif', 'heavySerif'], ok: B => B.N >= 24 && B.N <= 420 && B.cjk, run(B){
    // 形：字灌进一个形状里 —— 月、沙漏、叶
    const { W, P, pal, A } = B, kind = P(['moon', 'drop', 'glass', 'leaf', 'drop']), shapes = { drop: t => t < .62 ? Math.pow(t / .62, 1.1) : Math.sqrt(Math.max(0, 1 - ((t - .62) / .38) ** 2)), moon: t => Math.sqrt(Math.max(0, 1 - (2 * t - 1) ** 2)), glass: t => .16 + .84 * Math.pow(Math.abs(2 * t - 1), 1.1), leaf: t => Math.pow(Math.sin(Math.PI * t), .85) };
    const ratio = { moon: 1, drop: 1.22, glass: 1.35, leaf: 1.4 }[kind], size = P([.72, .86, 1]), hgt = Math.min(A.h, A.w * ratio) * size, wid = Math.min(A.w, hgt / ratio * (ratio > 1 ? 1.12 : 1)), y0 = A.y + (A.h - hgt) * P([.2, .5, .5, .8]), cx = W / 2 + (A.w - wid) * P([0, 0, .4, -.4]);
    for (let s = 110; s >= 24; s--){
      const lh = s * 1.5, rows = Math.floor(hgt / lh), lines = []; for (let i = 0; i < rows; i++){ const t = (i + .5) / rows, half = shapes[kind](t) * wid / 2; lines.push({ x0: cx - half, x1: cx + half, y: y0 + (i + .5) * hgt / rows }); }
      const got = bFlow(B, B.units, s, lines, 'hero'); if (!got) continue;
      const used = new Set(got.map(g => g.line)); if (used.size < Math.max(4, rows * .86) || rows < 5) return false;
      const l = B.layer('hero', { read: true, gentle: true, body: s < 52, quiet: true });
      for (const g of got){ const ln = g.line, slack = ln.x1 - ln.end, last = got[got.length - 1].line === ln, idx = got.filter(q => q.line === ln).indexOf(g), dx = last || slack < 0 ? slack / 2 : 0, just = !last && slack > 0 && ln.n > 1 ? slack / (ln.n - 1) * idx : 0; B.glyph(l, g.u, g.x + dx + just, g.y, s, { c: B.isKey(g.u) ? pal.a : pal.i }); }
      return true;
    }
    return false;
  } },

  { id: 'board', w: 4, face: ['oldSerif', 'oldSerif', 'serif', 'heavySerif', 'lightSerif', 'heavySans'], ok: B => B.N >= 8 && B.N <= 110 && !B.core.some(u => u.latin), run(B){
    // 棋局：一格一字，几枚点睛；浓淡跟着一片看不见的云走
    const { R, P, pal, A, maybe } = B, us = B.core, n = us.length, v = maybe(.6), cols = Math.max(3, Math.round(Math.sqrt(n * A.w / A.h) + R(-.6, .9))), rows = Math.ceil(n / cols), cw = A.w / cols, ch = Math.min(A.h / rows, cw * 1.35), s = Math.min(cw, ch) * R(.46, .74); if (s < 27) return false;
    const y0 = A.y + (A.h - ch * rows) * P([0, .5, 1]), l = B.layer('hero', { read: true, gentle: true, quiet: true }), cloud = maybe(.55), f1 = R(.5, 1.1), f2 = R(.5, 1.1), p1 = R(0, 6), p2 = R(0, 6);
    us.forEach((u, i) => { const c = v ? cols - 1 - Math.floor(i / rows) : i % cols, r = v ? i % rows : Math.floor(i / cols), key = B.isKey(u), k = .5 + .5 * Math.sin(c * f1 + p1) * Math.cos(r * f2 + p2); B.glyph(l, u, A.x + (c + .5) * cw, y0 + (r + .5) * ch, s * (key ? 1.22 : 1), { c: key ? pal.a : pal.i, a: cloud && !key ? .34 + .66 * k : undefined }); });
    return true;
  } },

  { id: 'quote', w: 3, face: ['oldSerif', 'oldSerif', 'serif', 'lightSerif', 'heavySerif'], ok: B => B.N >= 10 && B.N <= 280, run(B){
    // 引号：一对巨大的引号把话捧住
    const { R, P, pal, A, maybe } = B, s = R(260, 460) * B.u, d = B.layer('deco', { bleed: true }), pad = s * .4, [o, c] = B.cjk && maybe(.5) ? ['「', '」'] : ['“', '”'], w = A.w * R(.6, .88), side = P([0, .5, 1]);
    const got = B.body(A.x + (A.w - w) * side, A.y + pad, w, A.h - pad * 2, { vertical: B.cjk && o === '「' && maybe(.6), max: 76, min: 28, va: 'mid', ha: 'center', layer: B.layer('hero', { read: true, gentle: true, body: true }) }); if (!got || B.solo) return false;
    const a = P([.18, .9, .9]), col = P([pal.a, pal.b]); B.glyph(d, o, Math.max(A.x + s * .2, got.x - s * .1), Math.max(A.y + s * .16, got.y - s * .2), s, { c: col, a }); B.glyph(d, c, Math.min(A.x + A.w - s * .2, got.x + got.w + s * .1), Math.min(A.y + A.h - s * .16, got.y + got.h + s * .22), s, { c: col, a });
    return true;
  } },

  { id: 'tilt', dup: true, w: 4, face: ['oldSerif', 'oldSerif', 'heavySans', 'heavySerif', 'serif'],
    ok: B => B.hero && B.hero.units.length >= 2 && B.hero.units.length <= 10 && B.D > 10 && B.N < 280, run(B){
    // 倾斜：大字整个歪过去，小字站得笔直
    const { W, R, pal, P, A, maybe } = B, hu = B.hero.units, r = R(.1, .34) * P([1, -1]), rows = hu.length > 4 ? B.split(hu, 2) : [hu], zone = A.h * (B.solo ? .9 : .6), top = maybe(.65), w = A.w * 1.16, c = Math.abs(Math.cos(r)), k = Math.abs(Math.sin(r)), big = Math.max(...rows.map(q => B.emOf(q)));
    const s = Math.min(w / big, zone / (big * k + rows.length * c)); if (s < 70) return false;
    const cx = W / 2, cy = (top ? A.y : A.y + A.h - zone) + zone / 2, l = B.layer('hero', { bleed: true }); rows.forEach((q, i) => B.row(l, q, A.x + (A.w - big * s) / 2, cy + s * 1.02 * (i - (rows.length - 1) / 2), s, { align: 'left', c: i % 2 && maybe(.4) ? pal.a : pal.i })); bTurn(l, r, cx, cy);
    if (B.solo) return true; const g = 40 * B.u, by = top ? A.y + zone + g : A.y, bh = A.h - zone - g;
    return !!B.body(A.x + A.w * P([0, .42]), by, A.w * .56, bh, { max: 32, va: top ? 'bottom' : 'top' }) || !!B.body(A.x, by, A.w, bh, { max: 30, va: top ? 'bottom' : 'top' });
  } },

  { id: 'frame', w: 1, face: ['oldSerif', 'oldSerif', 'serif', 'lightSerif', 'sans'], ok: B => B.N >= 20 && B.N <= 260 && B.cjk && B.hero && B.hero.units.length <= 8, run(B){
    // 回廊：字贴着纸边走，一圈一圈往里绕，当中留一句
    const { W, R, pal, A, maybe } = B, us = B.units, em = us.map(u => B.em(u.t, 'body') + (u.sp ? .28 : 0));
    for (let s = 92; s >= 23; s--){
      const pitch = s * 1.8; let inset = s * .5, i = 0, loops = 0; const out = [];
      for (let loop = 0; loop < 4 && i < us.length; loop++){
        const x0 = A.x + inset, y0 = A.y + inset, x1 = A.x + A.w - inset, y1 = A.y + A.h - inset; if (x1 - x0 < A.w * .4) break;
        for (const [sx, sy, dx, dy, len, r] of [[x0, y0, 1, 0, x1 - x0, 0], [x1, y0, 0, 1, y1 - y0, Math.PI / 2], [x1, y1, -1, 0, x1 - x0, Math.PI], [x0, y1, 0, -1, y1 - y0 - pitch * (loop < 3 ? .2 : 0), -Math.PI / 2]]){ let p = s; while (i < us.length && p + em[i] * s * 1.08 <= len - s * .35){ const w = em[i] * s * 1.08; out.push([us[i], sx + dx * (p + w / 2), sy + dy * (p + w / 2), r]); p += w; i++; } }
        inset += pitch; loops++;
      }
      if (i < us.length) continue;
      const iw = A.w - inset * 2 - 40, ih = A.h - inset * 2 - 40; if (iw < A.w * .36) continue;
      const l = B.layer('hero', { read: true, gentle: true, body: true, quiet: true }); for (const [u, x, y, r] of out) B.glyph(l, u, x, y, s, { f: 'body', r, c: pal.i });
      const hu = bGhost(B.hero.units), c = B.layer('hero', { quiet: true }), cy = A.y + A.h / 2;
      if (hu.length > 2 || maybe(.5)){ const len = B.colLen(hu, 'hero', .06), q = Math.min(ih * R(.6, 1) / len, iw * .6, 220 * B.u); B.col(c, hu, W / 2, cy - len * q / 2, q, { gap: .06, c: pal.a }); } else { const q = Math.min(iw / B.emOf(hu), ih * .6, 280 * B.u); B.row(c, hu, W / 2, cy, q, { c: pal.a }); }
      return true;
    }
    return false;
  } },

  { id: 'stretch', w: 5, face: ['oldSerif', 'oldSerif', 'serif', 'lightSerif', 'sans', 'heavySerif'],
    ok: B => B.cjk && B.clauses.length >= 2 && B.clauses.length <= 9 && B.N <= 90 && B.clauses.every(c => c.n <= 16), run(B){
    // 拉长：每一句都拉到同样宽，字少的隔得远，像把一个词念得很慢
    const { R, P, pal, A, maybe } = B, rows = B.clauses.flatMap(c => c.n > 8 ? B.split(c.full, 2) : [c.full]), n = rows.length, v = maybe(.4), side = v ? A.h : A.w, cross = v ? A.w : A.h, most = Math.max(...rows.map(r => v ? B.colLen(r) : B.emOf(r))), s = Math.min(side * .92 / most, cross / n * R(.42, .7), 140 * B.u); if (s < 30 || n > 11) return false;
    const pitch = Math.min(cross / n, s * R(1.5, 2.8)), total = pitch * n, start = (cross - total) * P([0, .5, 1]), l = B.layer('hero', { read: true, gentle: true, body: s < 46, quiet: true });
    rows.forEach((r, i) => { const key = B.keyClause && r.includes(B.keyClause.units[0]), k = r.length; r.forEach((u, j) => { const t = k === 1 ? .5 : j / (k - 1), p = s / 2 + (side - s) * t, q = start + pitch * (i + .5); B.glyph(l, u, v ? A.x + A.w - q : A.x + p, v ? A.y + p : A.y + q, s, { c: key ? pal.a : pal.i, a: key || maybe(.7) ? undefined : .55, vp: v }); }); });
    return true;
  } },

  { id: 'recede', w: 4, face: ['oldSerif', 'oldSerif', 'heavySans', 'heavySerif', 'serif'],
    ok: B => B.cjk && B.clauses.length >= 2 && B.clauses.length <= 8 && B.N <= 80, run(B){
    // 渐远：一行比一行窄，像一条路走进纸里
    const { W, R, P, pal, A, maybe } = B, rows = B.clauses.flatMap(c => c.n > 7 ? B.split(c.full, 2) : [c.full]), n = rows.length, up = maybe(.4), cx = P([W / 2, W / 2, A.x + A.w * .32, A.x + A.w * .68]), end = R(.16, .34); if (n < 3) return false;
    const ws = rows.map((_, i) => A.w * (1 + (end - 1) * Math.pow((up ? n - 1 - i : i) / (n - 1), .8))), hs = rows.map((r, i) => Math.min(ws[i] / B.emOf(r), 230 * B.u)), gap = R(.1, .3), total = hs.reduce((a, h) => a + h * (1 + gap), 0), k = Math.min(1, A.h / total); if (Math.min(...hs) * k < 20) return false;
    const l = B.layer('hero', { read: true, gentle: true, quiet: true }); let y = A.y + (A.h - total * k) * (up ? 1 : P([0, .5, 1]));
    rows.forEach((r, i) => { const s = hs[i] * k, w = B.emOf(r) * s, t = (up ? n - 1 - i : i) / (n - 1), c = cx - w / 2 < A.x ? A.x + w / 2 : cx + w / 2 > A.x + A.w ? A.x + A.w - w / 2 : cx; B.row(l, r, c, y + s * (1 + gap) / 2, s, { c: pal.i, a: t > .1 ? 1 - t * .5 : undefined }); y += s * (1 + gap); });
    return true;
  } },
];
BLIND_COMPS.push(...BLIND_MORE);
for (const c of BLIND_COMPS) if (BLIND_MORE.includes(c) || ['inline', 'mosaic', 'blank'].includes(c.id)) c.warm = true;
// ════════════════════════════════════════════════════════════════════
//  9. 版式盲盒 ④″ 长文：读出结构，再排
// ════════════════════════════════════════════════════════════════════
// 早先长文只有一种排法：一个大字标题，底下一整块正文，看着像电商详情页。
// 几条规矩（查过资料才写的）：
//   · 形式从文本的性质里长出来（奇肖尔德）—— 先认出段落、引语、问句、独句，再给它们位置；
//   · 一句主句大字穿过全文，别的按轻重分级，空白是音程（马拉美《骰子一掷》）；
//   · 行越长，行距越大；版心 ＝ 字号 × 每行字数 × 行距（日文排版规范）；
//   · 一次只动一两种对比（Carl Dair）—— 大小、粗细、方向、颜色、质地，别一起上。
function bParas(text, cjk){
  let out = [];
  for (const m of text.matchAll(/[^\n]+/g)){ const t = m[0].trim(); if (t) out.push({ t, at: m.index + m[0].length - m[0].trimStart().length }); }
  // 一大段不换行的：按句子拆成意群，两三句一组
  if (out.length <= 2) out = out.flatMap(p => {
    if (p.t.length < (cjk ? 90 : 260)) return [p];
    const re = cjk ? /[^。！？!?…]+[。！？!?…]*[”」』）]*/g : /[^.!?]+[.!?]*["')\]]*\s*/g, parts = []; let cur = null;
    for (const m of p.t.matchAll(re)){ const lead = m[0].length - m[0].trimStart().length, t = m[0].trim(); if (!t) continue; if (cur && cur.t.length + t.length < (cjk ? 46 : 150)) cur.t = p.t.slice(cur.at, m.index + lead + t.length); else { cur = { t, at: m.index + lead }; parts.push(cur); } }
    return parts.map(q => ({ t: q.t, at: p.at + q.at }));
  });
  out.forEach((p, i) => { p.i = i; p.n = bUnits(p.t).filter(u => !u.punct).length; p.quote = /^[「『“"]/.test(p.t); p.ask = /[？?][”」』"]*$/.test(p.t); p.short = p.n <= (cjk ? 14 : 8); });
  return out.filter(p => p.n);
}
// 一段 → 若干行（横的或竖的）。末行只剩一两个字的，把版口收窄一点
function bLines(B, p, w, s, v, f = 'body'){
  const ctx = B.ctx, wr = q => { ctx.font = bFont(B, f, s); return buildItems(ctx, p.t, q, s, v, null).items.filter(it => !it.gap); };
  let ls = wr(w);
  if (ls.length > 1) for (let k = 1; k < 6 && bUnits(ls[ls.length - 1].text).filter(u => !u.punct).length <= 2; k++){ const t = wr(w * (1 - .035 * k)); if (t.length > ls.length) break; ls = t; }
  return ls.map(q => ({ t: q.text, at: p.at + q.at, len: v ? vAdvance(ctx, q.text, s) : ctx.measureText(q.text).width, s, f }));
}
// 几段摞成一条流。style(p) 给这一段的：k 字号倍数、f 字体、c 颜色、a 浓淡、ind 缩进、before 段前、lead 行距
function bStack(B, ps, w, s, { v = false, lead = 1.85, gap = .6, style = () => ({}) } = {}){
  const lines = []; let off = 0;
  ps.forEach((p, i) => {
    const st = style(p, i) || {}, z = s * (st.k || 1), ind = (st.ind || 0) * s, ld = st.lead || lead; if (i) off += (st.before || 0) * s;
    const ls = bLines(B, p, w - ind, z, v, st.f || 'body'); ls.forEach((l, j) => { lines.push({ ...l, p, off, ind, c: st.c, a: st.a, first: !j, last: j === ls.length - 1 }); off += z * ld; });
    off += gap * s - z * (ld - lead) * .5;
  });
  const end = lines[lines.length - 1]; return { lines, flow: end ? end.off + end.s : 0, cross: Math.max(0, ...lines.map(l => l.ind + l.len)) };
}
function bPlace(B, l, lines, box, v, { align = 'left', shift = 0 } = {}){
  for (const q of lines) l.ops.push({ k: v ? 'v' : 'l', t: q.t, at: q.at, src: 'text', s: q.s, len: q.len, c: q.c || B.pal.i, ...(q.f !== 'body' ? { f: q.f } : {}), ...(q.a !== undefined && q.a < 1 ? { a: q.a } : {}),
    x: v ? box.x + box.w - (q.off - shift) - q.s : box.x + (align === 'right' ? box.w - q.len - q.ind : align === 'center' ? (box.w - q.len) / 2 : q.ind), y: v ? box.y + q.ind : box.y + q.off - shift });
}
// 一条流灌进几个框
function bPour(lines, frames, v){
  const out = []; let f = 0, base = lines.length ? lines[0].off : 0, cur = [];
  for (let i = 0; i < lines.length; i++){
    const q = lines[i], fr = frames[f]; if (!fr) return null; const cap = v ? fr.w : fr.h, end = q.off - base + q.s;
    const orphan = q.first && !q.last && lines[i + 1] && lines[i + 1].off - base + q.s > cap;
    if (cur.length && (end > cap || orphan)){ out.push({ fr, lines: cur, base }); f++; base = q.off; cur = []; i--; continue; }
    if (end > cap + 1) return null; cur.push(q);
  }
  if (cur.length) out.push({ fr: frames[f], lines: cur, base });
  return out.length <= frames.length ? out : null;
}
// 放得下的最大字号。小的放得下、大的放不下 —— 对半找，一个字号一个字号试太慢
const bFit = (hi, lo, fn) => { let best = fn(lo); if (!best) return null; while (lo < hi){ const m = (lo + hi + 1) >> 1, r = fn(m); if (r){ best = r; lo = m; } else hi = m - 1; } return best; };
// 这一张里，引语（没有就那一段主句）跟叙述怎么区分 —— 只用一种办法，全张一致
function bRole(B, strong){
  const has = B.paras.some(p => p.quote), mark = p => has ? p.quote : p === B.keyPara, way = B.P(['indent', 'tone', 'kin', 'indent']);
  return p => way === 'indent' ? (mark(p) ? { ind: 2 } : {}) : way === 'tone' ? (mark(p) ? {} : { a: .64 }) : (mark(p) ? { c: B.inkAccent, ind: strong ? 1 : 0 } : {});
}
const bPoints = (B, us) => us.map(u => ({ ...u, at: undefined }));
// 主句：含着主角的那一段里，取一整句（不超过 26 个字）
function bKeyLine(B, most = 26){
  const p = B.keyPara, cs = B.clauses.filter(c => c.at >= p.at && c.at < p.at + p.t.length), i0 = Math.max(0, B.hero && !B.hero.title ? cs.findIndex(c => c.units.some(u => u.at === B.hero.units[0].at)) : 0); if (!cs.length) return null;
  const out = []; for (let i = i0; i < cs.length && out.reduce((a, c) => a + c.n, 0) + cs[i].n <= most; i++) out.push(cs[i]); if (!out.length) out.push(cs[i0]);
  return { clauses: out, n: out.reduce((a, c) => a + c.n, 0), units: out.flatMap(c => c.full) };
}

const BLIND_LONG = [
  { id: 'folio', w: 6, face: ['serif', 'oldSerif', 'lightSerif'], ok: B => B.N >= 90, run(B){
    // 一页书：古典的版心，天头大于地脚；标题不喊，站在空白里
    const { R, P, maybe, pal, A } = B, v = B.cjk && maybe(.55), dense = B.N / B.paras.length < 34, w = A.w * R(.62, .78), big = B.N > 220 ? .14 : 0, h = A.h * ((v ? R(.56, .7) : R(.6, .74)) + big), role = bRole(B);
    const lead = B.N > 220 ? 1.76 : 1.92, got = bFit(36, 22, s => { const t = bStack(B, B.paras, v ? h : w, s, { v, lead, gap: dense ? .42 : .85, style: role }); return t.flow <= (v ? w : h) ? { s, ...t } : null; }); if (!got) return false;
    const bw = v ? got.flow : got.cross, bh = v ? got.cross : got.flow, left = maybe(.4), x = left ? A.x : A.x + A.w - bw, y = A.y + A.h - bh;
    bPlace(B, B.layer('body', { read: true }), got.lines, { x, y, w: bw, h: bh }, v);
    const hu = B.hero && B.hero.units.length >= 2 ? B.hero.units : null; if (!hu) return true;
    const l = B.layer('hero', { quiet: true }), z = Math.min(got.s * R(1.9, 3.1), (A.h - bh - 70 * B.u) * .7, A.w * .8 / B.emOf(hu, 'hero', .12));
    if (z < got.s * 1.35){ B.layers.pop(); return true; }
    if (B.cjk && maybe(.4) && B.colLen(hu, 'hero', .1) * z < A.h - bh - 50 * B.u) B.col(l, hu, left ? A.x + A.w - z / 2 : A.x + z / 2, A.y, z, { gap: .1, c: pal.i }); else B.row(l, hu, left ? A.x : A.x + A.w - B.emOf(hu, 'hero', .12) * z, A.y + z / 2, z, { align: 'left', gap: .12, c: pal.i });
    return true;
  } },

  { id: 'hung', w: 6, face: ['lightSerif', 'serif', 'sans', 'heavySerif', 'heavySans'], ok: B => B.N >= 110, run(B){
    // 悬栏：两三栏从同一条线上挂下来，底下参差；线上面只有一句话和一片空
    const { R, P, maybe, pal, A, u } = B, n = A.w > A.h ? P([3, 4]) : P([2, 2, 3]), gut = 44 * u, cw = (A.w - gut * (n - 1)) / n, hang = A.h * R(.3, .46), stag = maybe(.45) ? R(.05, .12) * A.h : 0, role = bRole(B), hu = B.hero ? B.hero.units : B.core.slice(0, 6);
    const frames = Array.from({ length: n }, (_, i) => ({ x: A.x + (cw + gut) * i, y: A.y + hang + stag * i, w: cw, h: A.h - hang - stag * i }));
    const got = bFit(30, 22, s => { if (cw / s < 8) return null; const t = bStack(B, B.paras, cw, s, { lead: 1.75, gap: .7, style: role }), p = bPour(t.lines, frames); return p ? { s, p } : null; }); if (!got) return false;
    const l = B.layer('body', { read: true }); for (const { fr, lines, base } of got.p) bPlace(B, l, lines, fr, false, { shift: base });
    const rows = B.split(hu, hu.length > 6 ? 2 : 1), z = Math.min(A.w * R(.5, .8) / Math.max(...rows.map(r => B.emOf(r))), hang * .62 / rows.length, 132 * u), h = B.layer('hero'), low = maybe(.4); if (z < got.s * 1.6) return false;
    rows.forEach((r, i) => B.row(h, r, A.x, (low ? A.y + hang - 46 * u - z * 1.1 * rows.length : A.y) + z * 1.1 * (i + .5), z, { align: 'left', c: pal.i }));
    if (maybe(.5)) B.layer('deco').ops.push({ k: 'r', x: A.x, y: A.y + hang - 24 * u, w: A.w, h: 1.2, c: bAlpha(pal.i, .6) });
    return true;
  } },

  { id: 'tiers', w: 7, face: ['lightSerif', 'oldSerif', 'serif', 'heavySerif'], ok: B => B.cjk && B.N >= 120, run(B){
    // 段组：竖排，一层一层往下读，像旧报纸的副刊；主角一列从天到地
    const { R, P, I, maybe, pal, A, u } = B, n = B.N > 300 ? P([2, 3]) : 2, gut = 52 * u, hu = B.hero && B.hero.units.length >= 2 ? B.hero.units : B.core.slice(0, 5), right = maybe(.75), z = Math.min(A.h * R(.6, .98) / B.colLen(hu, 'hero', .08), A.w * R(.1, .17)), gap = z * R(.5, .9), w = A.w - z - gap, th = (A.h - gut * (n - 1)) / n, x = right ? A.x : A.x + z + gap, role = bRole(B);
    const frames = Array.from({ length: n }, (_, i) => ({ x, y: A.y + (th + gut) * i, w, h: th }));
    const got = bFit(34, 22, s => { const t = bStack(B, B.paras, th, s, { v: true, lead: 1.85, gap: .55, style: role }), p = bPour(t.lines, frames, true); return p ? { s, p } : null; }); if (!got || got.p.length < 2) return false;
    const l = B.layer('body', { read: true }); for (const { fr, lines, base } of got.p) bPlace(B, l, lines, fr, true, { shift: base });
    if (z < got.s * 1.5) return false; B.col(B.layer('hero', { quiet: true }), hu, right ? A.x + A.w - z / 2 : A.x + z / 2, A.y + (A.h - B.colLen(hu, 'hero', .08) * z) * P([0, 0, 1]), z, { gap: .08, c: pal.i });
    if (maybe(.6)) for (let i = 1; i < n; i++) B.layer('deco').ops.push({ k: 'r', x, y: A.y + (th + gut) * i - gut / 2, w, h: 1.1, c: bAlpha(pal.i, .5) });
    return true;
  } },

  { id: 'theme', w: 8, face: ['serif', 'lightSerif', 'oldSerif', 'heavySerif'], ok: B => B.N >= 90 && B.N <= 460 && !!bKeyLine(B) && bKeyLine(B).n >= 5, run(B){
    // 主句：一句话拆成几截，大字一路穿下去；小字跟着它走
    const { R, P, I, maybe, pal, A, u } = B, key = bKeyLine(B), k = key.n <= 8 ? 2 : key.n <= 14 ? P([3, 3, 4]) : P([4, 5]), frag = B.split(key.units.filter(q => !q.punct || /[？?！!]/.test(q.t)), k), ps = B.paras, total = ps.reduce((a, p) => a + p.n + 6, 0);
    const groups = frag.map(() => []); let acc = 0; ps.forEach(p => { groups[Math.min(frag.length - 1, Math.floor((acc + p.n / 2) / total * frag.length))].push(p); acc += p.n + 6; }); if (groups.some(g => !g.length)) return false;
    const most = Math.max(...frag.map(f => B.emOf(f))), dir = maybe(.75) ? 1 : -1;
    // 字多的时候，大字和小字并排走，不上下摞
    if (B.N > 190){
      const gw = A.w * R(.52, .58), v = B.cjk && maybe(.4), fw = A.w - gw - 48 * u, z = Math.min(v ? fw * .62 : fw / most, 118 * u), right = maybe(.3);
      const got = bFit(30, 22, s => { const st = groups.map(g => bStack(B, g, gw, s, { lead: 1.72, gap: .5 })), hs = st.map((t, i) => Math.max(t.flow, v ? B.colLen(frag[i], 'hero', .06) * z : z * 1.1)), sum = hs.reduce((a, t) => a + t, 0) + (frag.length - 1) * s * 1.1; return sum <= A.h ? { s, st, hs, sum } : null; }); if (!got || z < got.s * 1.5) return false;
      const h = B.layer('hero', { quiet: true }), l = B.layer('body', { read: true }), gap = got.s * 1.1 + Math.min((A.h - got.sum) / Math.max(1, frag.length - 1), got.s * 2.4); let y = A.y;
      frag.forEach((f, i) => { const us = f.map(q => ({ ...q, at: undefined })); if (v) B.col(h, us, right ? A.x + A.w - z / 2 : A.x + z / 2, y, z, { gap: .06, c: pal.i }); else B.row(h, us, right ? A.x + A.w - B.emOf(f) * z : A.x, y + z * .5, z, { align: 'left', c: pal.i }); bPlace(B, l, got.st[i].lines, { x: right ? A.x : A.x + A.w - gw, y, w: gw, h: 0 }, false); y += got.hs[i] + gap; });
      return true;
    }
    const z = Math.min(A.w * R(.46, .64) / most, A.h * R(.07, .1)), gw = A.w * R(.5, .58);
    const got = bFit(32, 22, s => { const st = groups.map(g => bStack(B, g, gw, s, { lead: 1.75, gap: .55 })), sum = st.reduce((a, t) => a + t.flow, 0) + frag.length * z * 1.5; return sum <= A.h * .97 ? { s, st, sum } : null; }); if (!got || z < got.s * 1.7) return false;
    const h = B.layer('hero', { quiet: true }), l = B.layer('body', { read: true }), air = (A.h - got.sum) / Math.max(1, frag.length * 2 - 1); let y = A.y;
    frag.forEach((f, i) => {
      const t = frag.length > 1 ? i / (frag.length - 1) : 0, tt = dir > 0 ? t : 1 - t, fw = B.emOf(f) * z; B.row(h, f.map(q => ({ ...q, at: undefined })), A.x + (A.w - fw) * tt, y + z * .55, z, { align: 'left', c: pal.i }); y += z * 1.28 + air * .7;
      bPlace(B, l, got.st[i].lines, { x: tt < .5 ? A.x + A.w - gw : A.x, y, w: gw, h: 0 }, false); y += got.st[i].flow + z * .22 + air * 1.3;
    });
    return true;
  } },

  { id: 'voices', w: 8, face: ['lightSerif', 'serif', 'oldSerif'], ok: B => B.cjk && B.N >= 60 && B.paras.length >= 4 && B.paras.filter(p => p.quote).length >= 1 && B.paras.filter(p => p.quote).length < B.paras.length, run(B){
    // 两个声音：叙述靠一边，引语在另一边，一前一后地说
    const { R, P, maybe, pal, A } = B, v = maybe(.5), side = v ? A.h : A.w, flow = v ? A.w : A.h, w0 = side * R(.44, .5), w1 = side * R(.42, .48), flip = maybe(.25);
    const got = bFit(38, 22, s => { let off = 0, last = null; const set = B.paras.map(p => { const q = p.quote, t = bStack(B, [p], q ? w1 : w0, s, { v, lead: 1.85, style: () => q ? { k: 1.16, c: B.inkAccent, f: B.softHero ? 'hero' : 'body' } : {} }); if (last) off += (last.quote === q ? .75 : .2) * s; const at = off; off += t.flow + s * .6; last = p; return { q, t, at }; }); return off <= flow ? { s, set, flow: off - s * .6 } : null; }); if (!got) return false;
    const l = B.layer('body', { read: true }), o0 = (flow - got.flow) * P([0, 0, .4, 1]);
    for (const { q, t, at } of got.set){ const far = q !== flip, off = o0 + at; if (v) bPlace(B, l, t.lines, { x: A.x, y: far ? A.y + A.h - w1 : A.y, w: A.w - off, h: 0 }, true); else bPlace(B, l, t.lines, { x: far ? A.x + A.w - w1 : A.x, y: A.y + off, w: w0, h: 0 }, false); }
    return true;
  } },

  { id: 'center', w: 6, face: ['lightSerif', 'oldSerif', 'serif', 'heavySerif'], ok: B => B.cjk && B.N >= 110 && B.hero && B.hero.units.length >= 3 && B.hero.units.length <= 11 && B.paras.length >= 3, run(B){
    // 中轴：一句站在当中，前文从右上来，后文往左下去
    const { R, P, maybe, pal, A, u } = B, hu = B.hero.units, z = Math.min(A.h * R(.6, .9) / B.colLen(hu, 'hero', .12), A.w * R(.11, .17)), gap = z * R(.55, .9), side = (A.w - z) / 2 - gap, at = B.hero.title ? B.N / 2 : B.hero.units[0].at; let a = B.paras.filter(p => p.at + p.t.length <= at), b = B.paras.filter(p => p.at + p.t.length > at); if (!a.length || !b.length || a.length < b.length / 3 || b.length < a.length / 3){ const k = Math.ceil(B.paras.length / 2); a = B.paras.slice(0, k); b = B.paras.slice(k); }
    const hh = A.h * (B.N > 220 ? R(.86, .95) : R(.62, .86)), role = bRole(B), gp = B.N > 220 ? .25 : .5, ld = B.N > 220 ? 1.62 : 1.8, got = bFit(34, 21, s => { const p = bStack(B, a, hh, s, { v: true, lead: ld, gap: gp, style: role }), q = bStack(B, b, hh, s, { v: true, lead: ld, gap: gp, style: role }); return p.flow <= side && q.flow <= side ? { s, p, q } : null; }); if (!got || z < got.s * 1.7) return false;
    const l = B.layer('body', { read: true }), dy = A.h - hh; bPlace(B, l, got.p.lines, { x: A.x + A.w - side, y: A.y, w: side, h: hh }, true); bPlace(B, l, got.q.lines, { x: A.x, y: A.y + dy, w: side, h: hh }, true);
    B.col(B.layer('hero', { quiet: true }), hu, A.x + A.w / 2, A.y + (A.h - B.colLen(hu, 'hero', .12) * z) * P([.5, .5, .3]), z, { gap: .12, c: pal.i });
    return true;
  } },

  { id: 'initial', w: 5, face: ['oldSerif', 'heavySerif', 'lightSerif', 'serif'], ok: B => B.cjk && B.N >= 100 && B.paras[0].n >= 10 && !B.core[0].latin && !B_PUNCT.test(B.paras[0].t[0]), run(B){
    // 首字：第一个字大到占五六行，整篇绕着它起头
    const { R, P, I, maybe, pal, A, u } = B, w = A.w * R(.7, 1), x = A.x + (A.w - w) * P([0, 1]), p0 = B.paras[0], cap = B.core[0], us = bUnits(p0.t).slice(1).map(q => ({ ...q, at: q.at + p0.at })), role = bRole(B), rest = B.paras.slice(1);
    for (let m = P([4, 5, 6]); m >= 3; m--) for (let s = 34; s >= 23; s--){
      const pitch = s * 1.85, capS = pitch * (m - 1) + s, lines = []; if (capS > w * .5) continue; let i = 0; for (; i < 60; i++) lines.push({ x0: i < m ? capS + s * .9 : 0, x1: w, y: i * pitch });
      const flow = bFlow(B, us, s, lines, 'body'); if (!flow) continue;
      // 第一段撑不满首字的高，后面几段接着绕
      let used = lines.filter(q => q.n).length, done = [...flow], next = 0; while (used < m && next < rest.length){ const q = rest[next++], ul = bUnits(q.t).map(k => ({ ...k, at: k.at + q.at })), ls = []; for (let j = used; j < 60; j++) ls.push({ x0: j < m ? capS + s * .9 : 0, x1: w, y: j * pitch }); const f = bFlow(B, ul, s, ls, 'body'); if (!f) break; done = done.concat(f); used += ls.filter(k => k.n).length; }
      const h1 = Math.max(m, used) * pitch, t = bStack(B, rest.slice(next), w, s, { lead: 1.85, gap: .6, style: role }), all = h1 + (rest.length > next ? s * .5 + t.flow : 0); if (all > A.h) continue;
      const y = A.y + (A.h - all) * P([0, .4, 1]), l = B.layer('body', { read: true }); for (const g of done) B.glyph(l, g.u, x + g.x, y + g.y + s / 2, s, { f: 'body', c: pal.i });
      bPlace(B, l, t.lines, { x, y: y + h1 + s * .5, w, h: 0 }, false); B.glyph(B.layer('hero', { read: true }), cap, x + capS / 2, y + capS / 2, capS, { c: P([pal.i, B.inkAccent]) });
      return true;
    }
    return false;
  } },

  { id: 'cascade', w: 6, face: ['serif', 'heavySerif', 'lightSerif', 'heavySans', 'sans'], ok: B => B.N >= 80 && B.paras.length >= 3, run(B){
    // 递降：第一句最大，一段比一段低下去（或者反过来，越说越响）
    const { R, P, maybe, pal, A } = B, up = maybe(.4), n = B.paras.length, q = R(.58, .72), w = A.w * R(.82, 1);
    for (const K of [3.6, 3, 2.5, 2, 1.7]){
      const k = i => Math.max(1, K * Math.pow(q, up ? n - 1 - i : i)), got = bFit(30, 22, s => { const t = bStack(B, B.paras, w, s, { lead: 1.75, gap: .55, style: (p, i) => k(i) > 1.02 ? { k: k(i), f: k(i) > 1.5 ? 'hero' : 'body', lead: k(i) > 1.5 ? 1.32 : 1.55 } : {} }); return t.flow <= A.h ? { s, ...t } : null; });
      if (!got || got.flow < A.h * .6) continue;
      const big = got.lines.filter(l => l.f === 'hero'); if (big.length > 7 || !big.length) continue;
      const y = A.y + (A.h - got.flow) * (up ? 1 : P([0, 0, .5])), h = B.layer('hero', { read: true, quiet: true, gentle: true }), l = B.layer('body', { read: true }); bPlace(B, h, big, { x: A.x, y, w, h: 0 }, false); bPlace(B, l, got.lines.filter(q => q.f !== 'hero'), { x: A.x, y, w, h: 0 }, false);
      return true;
    }
    return false;
  } },

  { id: 'develop', w: 7, face: ['serif', 'oldSerif', 'lightSerif', 'sans'], ok: B => B.N >= 90 && B.N <= 560, run(B){
    // 显影：全文铺满，都还淡着；只有那几句显了出来
    const { R, P, maybe, pal, A } = B, v = B.cjk && maybe(.45), keys = B.paras.filter(p => p === B.keyPara || (p.quote && maybe(.7)) || (p.i === B.paras.length - 1 && maybe(.5))), on = at => keys.some(p => at >= p.at && at < p.at + p.t.length), low = R(.4, .52), hit = maybe(.4) ? B.inkAccent : pal.i; if (keys.reduce((a, p) => a + p.n, 0) > B.N * .55) return false;
    for (let s = Math.round(Math.min(64, Math.sqrt(A.w * A.h / B.N) * .74)); s >= 23; s--){
      const pitch = s * 1.72, side = v ? A.h : A.w, n = Math.floor(((v ? A.w : A.h) - s) / pitch) + 1, lines = []; for (let i = 0; i < n; i++) lines.push({ x0: 0, x1: side, y: i * pitch });
      const got = bFlow(B, B.units, s, lines, 'body', .015); if (!got) continue;
      const used = got[got.length - 1].y + s, start = ((v ? A.w : A.h) - used) * P([0, .5]), l = B.layer('hero', { read: true, gentle: true, body: true, quiet: true });
      for (const g of got){ const k = on(g.u.at), o = { f: 'body', c: k ? hit : pal.i, a: k ? undefined : low }; if (v) B.glyph(l, g.u, A.x + A.w - start - g.y - s / 2, A.y + g.x, s, { ...o, r: g.u.latin ? Math.PI / 2 : 0, vp: true }); else B.glyph(l, g.u, A.x + g.x, A.y + start + g.y + s / 2, s, o); }
      return true;
    }
    return false;
  } },

  { id: 'steps2', w: 7, face: ['lightSerif', 'serif', 'sans', 'oldSerif'], ok: B => B.N >= 80 && B.paras.length >= 4, run(B){
    // 错段：一段一个落点，长短、远近跟着说话的口气；独句前后留一大口气
    const { R, P, I, maybe, pal, A } = B, col = A.w / 8, pat = P([[0, 2, 1, 3], [0, 0, 3, 1], [1, 3, 0, 2], [0, 3, 0, 4]]), rnds = B.paras.map(() => B.rnd()), role = P(['plain', 'plain', 'tone']);
    const got = bFit(38, 22, s => {
      let off = 0; const out = B.paras.map((p, i) => {
        const c = p.quote ? P2(rnds[i], [2, 3, 3]) : p.short ? P2(rnds[i], [0, 2, 4]) : pat[i % 4] % 3, w = Math.min(A.w - col * c, p.short ? A.w : col * (p.n > 60 ? 6 : 5)), t = bStack(B, [p], w, s, { lead: 1.78, style: () => ({ a: role === 'tone' && !p.quote && !p.short && p !== B.keyPara ? .62 : 1, ...(p === B.keyPara ? { k: 1.42, f: 'hero', lead: 1.5 } : {}) }) });
        if (t.cross > A.w - col * c + 1) return null; if (i) off += (p.short || p === B.keyPara || B.paras[i - 1].short ? 1.7 : 1.25) * s; const at = off; off += t.flow; return { x: A.x + col * c, at, t }; });
      return out.every(Boolean) && off <= A.h ? { s, out, flow: off } : null;
    }); if (!got) return false;
    const l = B.layer('body', { read: true }), room = A.h - got.flow, gap = Math.min(room / Math.max(1, got.out.length - 1), got.s * .8); let y = A.y + (room - gap * (got.out.length - 1)) * P([0, .4, 1]);
    got.out.forEach((q, i) => bPlace(B, l, q.t.lines, { x: q.x, y: y + q.at + gap * i, w: 0, h: 0 }, false));
    return true;
  } },

  { id: 'aside', w: 6, face: ['lightSerif', 'oldSerif', 'serif'], ok: B => B.cjk && B.N >= 130 && B.clauses.filter(c => c.n >= 3 && c.n <= 10).length >= 3, run(B){
    // 边注：正文一栏，旁边空着的那一栏里，有人用大一号的轻声把几句又念了一遍
    const { R, P, maybe, pal, A, u } = B, right = maybe(.6), w = A.w * R(.5, .56), mx = right ? A.x : A.x + w + 64 * u, mw = A.w - w - 64 * u, x = right ? A.x + A.w - w : A.x;
    const got = bFit(32, 22, s => { const t = bStack(B, B.paras, w, s, { lead: 1.82, gap: .7 }); return t.flow <= A.h ? { s, ...t } : null; }); if (!got || got.flow < A.h * .5) return false;
    const y = A.y + (A.h - got.flow) * P([0, 1]), l = B.layer('body', { read: true }); bPlace(B, l, got.lines, { x, y, w, h: 0 }, false);
    const z = Math.min(got.s * R(1.5, 2.1), 64 * u), h = B.layer('hero', { quiet: true }), v = maybe(.55), pick = B.clauses.filter(c => c.n >= 3 && c.n <= 10 && (v || B.emOf(c.units) * z <= mw * 1.02) && bJudge(B.text, c) >= .9), step = got.flow / 3.4; let next = A.y, put = 0, vx = 0;
    for (const c of pick){
      const ln = got.lines.find(q => q.at <= c.at && c.at < q.at + q.t.length); if (!ln) continue; const cy = y + ln.off; if (cy < next) continue; if (put && B.rnd() < .25) continue;
      if (v){ const len = B.colLen(c.units, 'hero', .1) * z; if (cy + len > A.y + A.h + 4) continue; B.col(h, bPoints(B, c.units), right ? mx + mw - z * .6 - vx : mx + z * .6 + vx, cy, z, { gap: .1, c: pal.i, a: put % 2 ? .5 : undefined }); vx = vx ? 0 : Math.min(mw - z * 1.4, z * 1.8); next = cy + Math.min(step, len * .75); }
      else { B.row(h, bPoints(B, c.units), right ? mx + mw - B.emOf(c.units) * z : mx, cy + z * .5, z, { align: 'left', c: pal.i, a: put % 2 ? .5 : undefined }); next = cy + Math.max(step * .8, z * 2); }
      if (++put >= 4) break;
    }
    return put >= 2;
  } },

  { id: 'silence', w: 6, face: ['lightSerif', 'serif', 'lightSans', 'oldSerif'], ok: B => B.N >= 80 && B.N <= 420, run(B){
    // 静：字都退到一角，小而匀；余下的一大片，是它没说的
    const { R, P, maybe, pal, A, u } = B, v = B.cjk && maybe(.5), w = A.w * R(.46, .6), h = A.h * R(.44, .6), many = B.N > 220, got = bFit(28, 21, s => { const t = bStack(B, B.paras, v ? h * (many ? 1.1 : 1) : w * (many ? 1.15 : 1), s, { v, lead: many ? 1.66 : 1.9, gap: many ? .3 : .5 }); return t.flow <= (v ? w * (many ? 1.55 : 1.25) : h * (many ? 1.42 : 1.15)) ? { s, ...t } : null; }); if (!got) return false;
    const bw = v ? got.flow : got.cross, bh = v ? got.cross : got.flow, cx = P([0, 1]), cy = P([0, 1, 1]), x = A.x + (A.w - bw) * cx, y = A.y + (A.h - bh) * cy; if (bw > A.w || bh > A.h * .8) return false;
    bPlace(B, B.layer('body', { read: true }), got.lines, { x, y, w: bw, h: bh }, v);
    const hu = B.hero ? B.hero.units : null; if (!hu || hu.length < 2 || maybe(.15)) return true;
    const z = Math.min(got.s * R(1.6, 2.6), A.w * .8 / B.emOf(hu, 'hero', .3)), l = B.layer('hero', { quiet: true }), up = cy === 1; if (z < got.s * 1.3) return true;
    B.row(l, hu, cx ? A.x : A.x + A.w - B.emOf(hu, 'hero', .3) * z, up ? A.y + z / 2 : A.y + A.h - z / 2, z, { align: 'left', gap: .3, c: pal.i });
    return true;
  } },

  { id: 'ledger', w: 4, face: ['heavySans', 'sans', 'serif', 'lightSerif'], ok: B => B.paras.length >= 4 && B.paras.length <= 18 && B.N >= 70, run(B){
    // 条目：一段一格，细线隔开，左边一列是序；瑞士人的账本
    const { R, P, maybe, pal, A, u } = B, nc = A.w * R(.12, .2), w = A.w - nc, cn = [...'一二三四五六七八九十'], num = i => B.cjk ? (i < 10 ? cn[i] : '十' + cn[i - 10]) : String(i + 1), hu = B.hero && maybe(.7) ? B.hero.units : null, z = hu ? Math.min(A.w / B.emOf(hu), A.h * .13, 120 * u) : 0, top = hu ? z * 1.5 : 0;
    const got = bFit(32, 22, s => { let off = 0; const pad = s * (B.paras.length > 9 ? .42 : .62), rows = B.paras.map(p => { const t = bStack(B, [p], w, s, { lead: 1.7 }), y = off + pad; off += t.flow + pad * 2; return { t, y }; }); return off <= A.h - top ? { s, rows, h: off } : null; }); if (!got) return false;
    const l = B.layer('body', { read: true }), d = B.layer('deco'), extra = Math.min((A.h - top - got.h) / got.rows.length, got.s * 1.1), y0 = A.y + top + (A.h - top - got.h - extra * got.rows.length) * (hu ? 1 : P([0, 1]));
    got.rows.forEach((r, i) => { const y = y0 + r.y + extra * i; d.ops.push({ k: 'r', x: A.x, y: y - got.s * (B.paras.length > 9 ? .42 : .62) - extra / 2, w: A.w, h: 1.1, c: bAlpha(pal.i, .5) }); bPlace(B, l, r.t.lines, { x: A.x + nc, y, w, h: 0 }, false); B.row(d, [...num(i)].map(t => ({ t })), A.x, y + got.s * .5, got.s * .66, { f: 'meta', align: 'left', c: pal.i, a: .7 }); });
    if (hu) B.row(B.layer('hero'), hu, A.x - z * .03, A.y + z / 2, z, { align: 'left', c: pal.i });
    return true;
  } },

  { id: 'swell', w: 5, face: ['serif', 'sans', 'heavySerif'], ok: B => B.cjk && B.N >= 90 && B.N <= 480, run(B){
    // 起潮：一行行都撑到两边，字从小涨到大，又落回去
    const { R, P, maybe, pal, A } = B, us = B.units, kind = P(['up', 'down', 'tide', 'ebb']), curve = t => kind === 'up' ? t : kind === 'down' ? 1 - t : kind === 'tide' ? Math.sin(t * Math.PI) : 1 - Math.sin(t * Math.PI), ratio = R(1.9, 3);
    const build = base => {
      const rows = []; let i = 0, h = 0; const NP = Math.max(1, us.length);
      while (i < us.length){
        const t = i / NP, s0 = base * (1 + (ratio - 1) * curve(t)), cap = A.w / s0, row = []; let w = 0;
        while (i < us.length && (w + B.em(us[i].t, 'body') <= cap || !row.length)){ w += B.em(us[i].t, 'body'); row.push(us[i]); i++; }
        while (i < us.length && us[i].punct && NO_START.includes(us[i].t[0])){ w += B.em(us[i].t, 'body'); row.push(us[i]); i++; }
        const tail = row[row.length - 1]; if (i < us.length && tail.punct && NO_END.includes(tail.t) && row.length > 2){ row.pop(); i--; w -= B.em(tail.t, 'body'); }
        const s = i >= us.length && w < cap * .72 ? s0 : A.w / w; rows.push({ row, s }); h += s * (1.3 + .25 * Math.min(1, 30 / s));
      }
      return { rows, h };
    };
    let lo = 14, hi = 80, best = null; for (let k = 0; k < 18; k++){ const m = (lo + hi) / 2, r = build(m); if (r.h <= A.h){ best = r; lo = m; } else hi = m; }
    if (!best || best.h < A.h * .82 || Math.min(...best.rows.map(r => r.s)) < 21) return false;
    const l = B.layer('hero', { read: true, gentle: true, body: true, quiet: true }), key = maybe(.5), on = q => key && q.at >= B.keyPara.at && q.at < B.keyPara.at + B.keyPara.t.length; let y = A.y;
    best.rows.forEach(({ row, s }) => { const p = s * (1.3 + .25 * Math.min(1, 30 / s)); B.row(l, row, A.x, y + s * .55, s, { f: 'body', align: 'left', c: pal.i }); if (key) l.ops.slice(-row.length).forEach(o => { if (on(o)) o.c = B.inkAccent; }); y += p; });
    return true;
  } },

  { id: 'strophe', w: 6, face: ['lightSerif', 'serif', 'oldSerif'], ok: B => B.cjk && B.N >= 70 && B.N <= 380 && B.clauses.length >= 8 && B.clauses.length <= 36, run(B){
    // 分行：一小句一行，一段一节；主句那一行忽然站了出来
    const { R, P, maybe, pal, A } = B, v = maybe(.5), side = v ? A.h : A.w, flow = v ? A.w : A.h, key = B.keyPara, parts = B.paras.map((p, i) => ({ p, ls: B.clauses.filter(c => c.at >= p.at && c.at < p.at + p.t.length).flatMap(c => c.n > 16 ? B.split(c.full, 2) : [c.full]), ind: [0, 1.5, 0, 3, 1][i % 5] * (maybe(.8) ? 1 : 0) })).filter(q => q.ls.length), len = (us, f) => v ? B.colLen(us, f) : B.emOf(us, f), rows = parts.reduce((a, q) => a + q.ls.length, 0);
    for (let s = 40; s >= 21; s--){
      const pitch = s * 1.56, k = Math.min(2.1, side * .9 / (s * Math.max(...parts.filter(q => q.p === key).flatMap(q => q.ls).map(l => len(l, 'hero'))))), total = parts.reduce((a, q) => a + q.ls.length * (q.p === key ? s * k * 1.4 : pitch) + s * .95, 0); if (k < 1.25 || total > flow || parts.some(q => q.p !== key && q.ls.some(l => (len(l, 'body') + q.ind) * s > side))) continue;
      const b = B.layer('body', { read: true }), h = B.layer('hero', { read: true, quiet: true, gentle: true }); let o = (flow - total) * P([0, .4]);
      for (const q of parts){ const big = q.p === key, z = big ? s * k : s, st = big ? z * 1.4 : pitch; for (const us of q.ls){ const l = big ? h : b, f = big ? 'hero' : 'body', i = big ? 0 : q.ind * s; if (v) B.col(l, us, A.x + A.w - o - st / 2, A.y + i, z, { f, c: pal.i, vp: true }); else B.row(l, us, A.x + i, A.y + o + st / 2, z, { f, align: 'left', c: pal.i }); o += st; } o += s * .95; }
      return true;
    }
    return false;
  } },
];
const P2 = (r, a) => a[Math.floor(r * a.length)];
BLIND_COMPS.push(...BLIND_LONG);
for (const c of BLIND_LONG){ c.long = true; c.warm = true; c.dup = true; c.modes = ['left', 'right', 'left', 'corners', 'center']; }
// ════════════════════════════════════════════════════════════════════
//  9. 版式盲盒 ⑤ 气氛：底、光、字的质地、修图，一套一套地配
// ════════════════════════════════════════════════════════════════════
// 方案（recipes/quiet/image/more）只管字怎么站；这里管它站在什么样的空气里。
// 🔒 2026-11-24 定的：收走的只是代码画的花、雪花、水滴、眼睛和线条（归「自己添」）。
//    弥散、模糊、光、遮盖、质感、修图，一样都不许收。上一版把底全改成平涂，一下子就刻板了。
// 一套气氛：
//   tone ＝ 只配亮底 / 暗底（不写＝都行）；chroma ＝ 底要有点颜色；
//   grounds ＝ 底的画法，掷一种；hero ＝ 大字能上的几套效果，掷一套（可以是空的）；
//   post ＝ 修图的几套；pane ＝ 可能垫一片玻璃（局部模糊）；q ＝ 低声的方案在这里吃香几倍；
//   min ＝ 正文最小字号（整张要过油画、旋焦之类的，字小了就糊成一团）；
//   grain ＝ 颗粒；ghost ＝ 垫底的淡字糊多少。
const BLIND_LOOKS = [
  // 最初：第一版的样子。看得见纤维的纸，边上淡淡一两团颜色，字上一两道老手艺，不修图
  { id: 'first', w: 46, grounds: ['orbs', 'orbs', 'orbs', 'beam', 'flat'], fiber: 1, warm: 4, q: .7, hero: [['split', 'focus'], ['scan'], ['scan', 'focus'], ['misreg'], ['misreg'], ['dots'], ['dots'], ['sand'], ['sand'], ['ripple'], ['trail'], ['wear'], ['wear'], ['focus'], ['wash'], ['slice'], ['echo', 'focus'], ['burst'], ['scan', 'trail'], ['stitch'], ['haze'], [], [], []], post: [[], [], [], [], [], ['oil'], ['soft'], ['multiply'], ['swirl'], ['defocus']], ghost: 0, under: .22 },
  { id: 'mist', w: 8, tone: 'light', grounds: ['aura', 'aura', 'centre', 'horizon'], hero: [['melt'], ['haze'], ['focus'], ['wash'], []], post: [[], ['soft'], ['soft'], ['matte']], q: 1.6, ghost: 10 },
  { id: 'afterglow', w: 8, tone: 'light', grounds: ['beam', 'beam', 'corner', 'duo'], hero: [['echo', 'focus'], ['melt'], ['wash', 'melt'], ['trail'], ['wash']], post: [['multiply'], ['multiply'], ['soft'], ['halation'], []], ghost: 6 },
  { id: 'watercolor', w: 7, tone: 'light', grounds: ['wash', 'wash', 'aura', 'rice'], hero: [['wash'], ['ink'], [], []], post: [['oil'], ['oil'], ['oil', 'soft']], min: 30, q: 1.2 },
  { id: 'swirl', w: 7, grounds: ['aura', 'duo', 'horizon'], hero: [[], ['haze'], ['wash'], ['melt']], post: [['swirl'], ['swirl'], ['swirl', 'soft']], min: 28 },
  { id: 'over', w: 8, tone: 'light', grounds: ['centre', 'beam', 'aura', 'flat'], hero: [['burst'], ['burst'], ['haze'], ['trail']], post: [['defocus'], ['soft'], ['halation'], ['bokeh'], []], min: 26, tint: 1 },
  { id: 'night', w: 8, tone: 'dark', grounds: ['aura', 'horizon', 'corner'], hero: [['focus'], ['haze'], ['glow'], ['melt'], ['wash']], post: [['gauss'], ['bokeh'], ['soft'], ['spark'], []], min: 24, ghost: 8 },
  { id: 'lamp', w: 6, tone: 'dark', grounds: ['centre', 'corner', 'beam'], hero: [['focus'], ['glow'], ['wash'], ['echo', 'focus']], post: [['halation'], ['soft'], ['film'], []], q: 1.3, ghost: 8 },
  { id: 'darkroom', w: 5, tone: 'dark', grounds: ['corner', 'centre'], hero: [['melt'], ['glow'], ['focus'], ['drift']], post: [['halation'], ['gauss'], ['halation', 'film'], []], q: 1.3 },
  { id: 'neon', w: 5, tone: 'dark', grounds: ['aura', 'duo', 'corner'], hero: [['glow'], ['misreg', 'glow'], ['trail', 'glow'], ['burst', 'glow'], ['melt']], post: [['halation'], ['soft'], ['reeded'], []], loud: 1.4, grain: 1.6 },
  { id: 'dive', w: 5, chroma: .02, grounds: ['sunk', 'sunk', 'horizon'], hero: [['ripple'], ['melt'], ['wash', 'ripple'], ['focus']], post: [['soft'], ['gauss'], ['swirl'], []], min: 24, ghost: 12 },
  { id: 'paper', w: 7, tone: 'light', grounds: ['rice'], hero: [['ink'], ['wear'], ['wear'], ['drift'], []], post: [[], [], ['film'], ['soft']], q: 1.8, ghost: 0 },
  { id: 'press', w: 5, tone: 'light', grounds: ['rice', 'rice', 'flat'], hero: [['misreg'], ['dots'], ['misreg', 'wear'], ['scan'], ['wear'], ['misreg', 'dots']], post: [[], [], [], ['film'], ['retro'], ['lowq']], loud: 1.4 },
  { id: 'film', w: 5, grounds: ['aura', 'beam', 'corner'], hero: [['trail'], ['focus'], ['echo'], []], post: [['film'], ['film'], ['film', 'halation'], ['film', 'gauss']], min: 24 },
  { id: 'long', w: 6, grounds: ['horizon', 'duo', 'aura'], hero: [['trail'], ['smear'], ['burst'], ['trail', 'focus'], ['slit']], post: [['soft'], ['defocus'], ['halation'], []], loud: 1.3, min: 24 },
  { id: 'vanish', w: 8, grounds: ['aura', 'rice', 'horizon', 'centre'], hero: [['drift'], ['drift'], ['sand'], ['scatter'], ['motes'], ['dither'], ['dots']], post: [[], [], ['soft'], ['matte']] },
  { id: 'glass', w: 7, grounds: ['aura', 'aura', 'duo'], hero: [[], ['wash'], ['melt']], post: [['reeded'], [], [], []], pane: ['frost', 'reed', 'blurp', 'blurp', 'mosaic'], paneP: 1, min: 26 },
  { id: 'sandblast', w: 5, grounds: ['aura', 'duo', 'beam', 'corner'], hero: [['wash'], ['melt'], ['haze'], []], post: [['matte'], ['matte'], ['matte', 'halation']], min: 28, grain: 1.8 },
  { id: 'gradient', w: 7, grounds: ['duo', 'duo', 'aura', 'sunk'], hero: [['wash'], ['veil'], ['cuts'], ['melt'], []], post: [[], [], ['soft'], ['multiply']], grain: 1.9, loud: 1.2 },
  { id: 'pearl', w: 4, tone: 'light', grounds: ['aura', 'duo', 'centre'], hero: [['wash'], ['smear'], ['haze'], ['melt'], []], post: [['pearl'], ['pearl'], ['pearl', 'soft']] },
  { id: 'cover', w: 6, grounds: ['beam', 'rice', 'aura', 'flat', 'duo'], hero: [['veil'], ['blinds'], ['bars'], ['disc'], ['torn'], ['brush'], ['slice'], ['split'], ['stitch'], ['cuts']], post: [[], [], ['soft'], ['film']], loud: 1.6 },
  { id: 'signal', w: 3, grounds: ['flat', 'duo', 'corner'], hero: [['slice'], ['scan'], ['misreg'], ['smear'], []], post: [['vhs'], ['vhs'], ['lowq'], ['pixel']], loud: 1.5, min: 30 },
  { id: 'negative', w: 3, grounds: ['aura', 'beam', 'duo'], hero: [['melt'], ['haze'], ['burst'], []], post: [['negate'], ['negate', 'halation'], ['negate', 'soft']] },
  { id: 'subtitle', w: 2, grounds: ['aura', 'horizon', 'beam', 'corner'], hero: [['focus'], ['trail'], []], post: [['subtitle'], ['film', 'subtitle'], ['soft', 'subtitle']] },
  { id: 'flat', w: 6, grounds: ['flat'], hero: 'own', post: [[]], q: .5, loud: 1.8, fiber: .3 },
];

// 🔑 字体、颜色、效果、布局是一起设计的，不许各掷各的。单独拎一款字配一个效果，看着就像电商海报。
//    每种气氛只配得上这几类字；方案要的字这里没有，这个方案在这种空气里就少来。
const B_ART = {
  first: ['oldSerif', 'serif', 'heavySerif'], mist: ['lightSerif', 'serif', 'lightSans'], afterglow: ['serif', 'lightSerif', 'heavySerif'], watercolor: ['oldSerif', 'serif', 'lightSerif'],
  swirl: ['serif', 'heavySerif', 'lightSerif'], over: ['heavySerif', 'serif', 'oldSerif'], night: ['lightSerif', 'serif', 'lightSans'], lamp: ['serif', 'lightSerif', 'oldSerif'], darkroom: ['lightSerif', 'serif', 'oldSerif'],
  neon: ['lightSans', 'lightSerif', 'sans'], dive: ['lightSerif', 'serif'], paper: ['oldSerif', 'serif', 'lightSerif'], press: ['oldSerif', 'heavySerif', 'heavySans'], film: ['serif', 'lightSerif', 'sans', 'oldSerif'],
  long: ['heavySerif', 'heavySans', 'serif'], vanish: ['heavySerif', 'serif', 'oldSerif', 'lightSerif'], glass: ['serif', 'sans', 'lightSerif', 'heavySans'], sandblast: ['serif', 'heavySans', 'oldSerif'], gradient: ['heavySans', 'lightSans', 'sans', 'heavySerif'],
  pearl: ['lightSerif', 'lightSans', 'serif'], cover: ['heavySans', 'heavySerif', 'oldSerif'], signal: ['sans', 'heavySans'], negative: ['lightSerif', 'serif', 'heavySerif'], subtitle: ['serif', 'lightSerif'], flat: ['heavySans', 'sans', 'oldSerif', 'heavySerif'],
};
const bFaces = (c, look) => { const art = B_ART[look.id] || [], f = (c.face || ['heavySans']).filter(k => art.includes(k)); return f.length ? f : null; };
// 长文只过得起这几道修图：别的要么糊字，要么抢话
const B_LONG_POST = ['soft', 'matte', 'film', 'multiply', 'pearl', 'retro', 'negate'];
const B_LONG_FX = ['melt', 'focus', 'wash', 'ink', 'wear', 'drift', 'misreg', 'dots', 'haze', 'sand'];

// hex → OKLCH
function bLch(hex){
  const [r, g, b] = hex2rgb(hex).map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; });
  const l = Math.cbrt(.4122214708 * r + .5363325363 * g + .0514459929 * b), m = Math.cbrt(.2119034982 * r + .6806995451 * g + .1073969566 * b), s = Math.cbrt(.0883024619 * r + .2817188376 * g + .6299787005 * b);
  const L = .2104542553 * l + .793617785 * m - .0040720468 * s, A = 1.9779984951 * l - 2.428592205 * m + .4505937099 * s, B = .0259040371 * l + .7827717662 * m - .808675766 * s;
  return [L, Math.hypot(A, B), (Math.atan2(B, A) * 180 / Math.PI + 360) % 360];
}
const bLookOk = (k, pal) => { const dark = pal.m === 'night', [, c, h] = bLch(pal.g); return !(k.id === 'negative' && c > .012 && bHueIn(h, 18, 165)) && !(k.tone === 'light' && dark) && !(k.tone === 'dark' && !dark) && !(k.chroma && c < k.chroma); };
// 给每套气氛发一个号，取合得上这套颜色的头一个 —— 换颜色的时候，气氛尽量不跟着跳
function bLook(pal, rnd, id){
  const roll = BLIND_LOOKS.map(k => ({ k, v: Math.pow(rnd(), 1 / k.w) })).sort((a, b) => b.v - a.v);
  return (id && BLIND_LOOKS.find(k => k.id === id)) || (roll.find(r => bLookOk(r.k, pal)) || roll[0]).k;
}

// ── 底 ──────────────────────────────────────────────────────────────
// 底上任何一处，墨都得读得出来：一块颜色先往底色退，退到墨和点睛都还立得住为止
function bSafe(c, pal, min = 4.6){
  const i = hex2rgb(pal.i), a = hex2rgb(pal.a); let q = c;
  for (let t = 0; t < 1 && (contrast(i, hex2rgb(q)) < min || contrast(a, hex2rgb(q)) < 2); t += .06) q = bMix(c, pal.g, t);
  return q;
}
// ── 调色的规矩（有一张褐底泛橄榄的，脏得不能看，才立的）──
// 1. 黄、绿、橙压暗了就是泥：暗底只许蓝、紫、玫红、酒红、青；碰上就挪到最近的干净色相。
// 2. 隔得远的颜色硬化在一起，当中那一段必是灰泥：一张底只用一个家族。
// 3. 黄绿一类只准往亮里走，不准往暗里走。
const bHueGap = (a, b) => Math.abs(((a - b) % 360 + 540) % 360 - 180);
const bHueIn = (h, lo, hi) => { h = (h % 360 + 360) % 360; return h >= lo && h <= hi; };
const bDarkHue = h => !bHueIn(h, 15, 165) ? h : bHueIn(h, 15, 52) ? 9 : bHueIn(h, 52, 122) ? 264 : 176;
// 暗底上从一家挪开一点：挪进褐区了，就往另一边挪
const bDarkNear = (h, d) => bDarkHue(bHueIn(h + d, 15, 165) ? h - d : h + d);
const bIsMud = (L, C, h) => L < .68 && C > .02 && C < .125 && bHueIn(h, 28, 152);
// 这张底是哪一家的：底色有颜色就随它，没颜色就随点睛；暗的先洗干净
function bAnchor(pal){
  const [L, C, h] = bLch(pal.g), [, ca, ha] = bLch(pal.a), [, cb, hb] = bLch(pal.b), q = C >= .012 ? h : ca >= .05 ? ha : cb >= .05 ? hb : 262;
  return L < .34 ? bDarkHue(q) : q;
}
// 淡字用的颜色：点睛跟底隔得远的话（靛底上的琥珀），一淡就成了泥，换成底自己那一家的
const bKin = pal => { const [L] = bLch(pal.g), [, , ha] = bLch(pal.a), h = bAnchor(pal); return bHueGap(ha, h) < 50 ? pal.a : L < .5 ? bOklch(.74, .1, bDarkHue(h)) : bOklch(.5, .11, h); };
// 点睛、副色也不许是泥：橄榄、土褐的，换成同一张底上立得住的朱或靛
function bClean2(pal){
  const h = bAnchor(pal), dark = pal.m === 'night', gap = bHueGap(h, 24), swap = () => bToward(dark ? bOklch(.74, .13, gap > 40 ? 30 : 262) : gap > 40 ? bOklch(.54, .18, 28) : bOklch(.42, .13, 262), pal.g, 2.8);
  const bad = c => { const [L, C, q] = bLch(c); return L < .66 && C > .02 && C < .15 && bHueIn(q, 58, 138); }, q = { ...pal };
  if (bad(q.a)) q.a = bad(q.b) ? swap() : q.b; if (bad(q.b)) q.b = q.a === pal.b ? swap() : bMix(q.a, q.i, .45);
  return q;
}
// 几块能化在一起的颜色，都是一家人
function bGlowColors(E){
  const { R, pal } = E, [L, C] = bLch(pal.g), h = bAnchor(pal), side = E.maybe(.5) ? 1 : -1, yellow = bHueIn(h, 40, 152);
  const at = [h, h + side * R(14, 30), h + side * R(26, L > .8 ? 62 : 44)];
  return at.map(q => {
    if (L < .34) return bSafe(bOklch(R(.25, .36), R(.045, C < .012 ? .08 : .11), bDarkNear(h, q - h)), pal);
    if (L < .8) return bSafe(bOklch(Math.max(.16, Math.min(.96, L + (yellow ? R(.02, .12) : R(-.08, .12)))), Math.min(.2, C * R(.95, 1.2) + .015), L < .72 && !yellow && bHueIn(h + (q - h) * .55, 40, 152) ? h - (q - h) * .55 : h + (q - h) * .55), pal);
    return bSafe(bOklch(R(.84, .93), R(.04, .09), q), pal);
  });
}
function bRadial(x, cx, cy, r, stops){ const g = x.createRadialGradient(cx, cy, 0, cx, cy, r); for (const [t, c] of stops) g.addColorStop(t, c); return g; }
// 一团化得很开的颜色：高斯那样的坡，看不见边
const B_SOFT = [[0, 1], [.18, .93], [.36, .74], [.54, .46], [.72, .2], [.88, .05], [1, 0]];
const bBlob = (x, c, cx, cy, r, k, sq = 1, rot = 0) => { x.save(); x.translate(cx, cy); x.rotate(rot); x.scale(1, sq); x.fillStyle = bRadial(x, 0, 0, r, B_SOFT.map(([t, a]) => [t, bAlpha(c, a * k)])); x.fillRect(-r, -r, r * 2, r * 2); x.restore(); };
// 一两团颜色停在纸边上，淡得像刚洇开
function bOrbs(x, E, k = 1){
  const { R, I, W, H, pal } = E, cs = bGlowColors(E), n = I(1, 3), m = Math.max(W, H);
  for (let i = 0; i < n; i++){ const edge = E.maybe(.7), side = E.maybe(.5), cx = edge ? (side ? R(-.08, .16) : R(.84, 1.08)) * W : W * R(.2, .8), cy = H * R(.05, .98); bBlob(x, cs[i], cx, cy, m * R(.2, .44), R(.6, .95) * k, R(.75, 1.2), R(0, 3)); }
}
// 纸的纤维；暗的底只压一点四角（试过云斑，像黑板）
function bFiber(x, E){
  const { W, H, dark, idx } = E, L = relLum(hex2rgb(E.pal.g)); x.save();
  if (L > .3){ x.globalCompositeOperation = 'multiply'; x.globalAlpha = .88; x.drawImage(makePaper('rice', W, H, idx || 0), 0, 0); }
  else {
    x.globalAlpha = 1; x.globalCompositeOperation = 'source-over'; const g = x.createRadialGradient(W / 2, H * .45, Math.min(W, H) * .3, W / 2, H / 2, Math.max(W, H) * .8); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${dark ? .26 : .16})`); x.fillStyle = g; x.fillRect(0, 0, W, H);
  }
  x.restore();
}
const BLIND_GROUND = {
  orbs(x, E){ bOrbs(x, E); },
  flat(){},
  // 弥散：三五团颜色化在一起
  aura(x, E){
    const { R, I, W, H } = E, cs = bGlowColors(E), n = I(3, 5), m = Math.max(W, H), a0 = R(0, 6.28);
    for (let i = 0; i < n; i++){ const a = a0 + i / n * 6.28 + R(-.5, .5), d = R(.24, .56); bBlob(x, cs[i % cs.length], W / 2 + Math.cos(a) * W * d, H / 2 + Math.sin(a) * H * d, m * R(.42, .72), R(.75, 1), R(.6, 1.3), R(0, 3.14)); }
  },
  // 地平：天和水之间一道光
  horizon(x, E){
    const { R, W, H } = E, cs = bGlowColors(E), y = H * R(.3, .74), g = x.createLinearGradient(0, 0, 0, H), p = y / H;
    g.addColorStop(0, cs[0]); g.addColorStop(Math.max(.02, p - .3), bMix(cs[0], E.pal.g, .55)); g.addColorStop(p, E.pal.g); g.addColorStop(Math.min(.98, p + .22), bMix(cs[1], E.pal.g, .5)); g.addColorStop(1, cs[1]);
    x.fillStyle = g; x.fillRect(0, 0, W, H); bBlob(x, cs[2], W * R(.1, .9), y, W * R(.5, .85), .8, R(.16, .34));
  },
  // 余光：一道斜斜的亮，从一头照进来
  beam(x, E){
    const { R, W, H, pal, dark } = E, cs = bGlowColors(E), a = R(.35, 1.2) * (E.maybe(.5) ? 1 : -1), L = Math.hypot(W, H) / 2, p = R(.34, .66), lo = bSafe(bMix(pal.g, cs[0], .9), pal), hi = dark ? bSafe(bMix(cs[1], pal.i, .1), pal) : bSafe(bMix(pal.g, '#ffffff', .7), pal);
    const g = x.createLinearGradient(W / 2 - Math.sin(a) * L, H / 2 - Math.cos(a) * L, W / 2 + Math.sin(a) * L, H / 2 + Math.cos(a) * L);
    g.addColorStop(0, bSafe(bMix(pal.g, cs[1], .8), pal)); g.addColorStop(p - .2, pal.g); g.addColorStop(p - .012, hi); g.addColorStop(p + .02, bMix(hi, pal.g, .55)); g.addColorStop(Math.min(.95, p + .26), bMix(pal.g, lo, .5)); g.addColorStop(1, lo);
    x.fillStyle = g; x.fillRect(0, 0, W, H); bBlob(x, cs[0], W * R(0, 1), H * R(.8, 1.05), W * R(.6, 1), .7);
  },
  // 一角有光
  corner(x, E){
    const { R, P, W, H, pal, dark } = E, cs = bGlowColors(E), [cx, cy] = P([[0, 0], [1, 0], [0, 1], [1, 1]]), m = Math.hypot(W, H);
    bBlob(x, cs[0], W * cx, H * cy, m * R(.62, .95), 1); bBlob(x, cs[1], W * (1 - cx) + W * R(-.1, .1), H * (1 - cy), m * R(.4, .6), dark ? .55 : .7);
    if (dark) bBlob(x, bMix(pal.g, '#000000', .6), W * (1 - cx), H * R(.3, .7), m * .5, .6);
  },
  // 当中一团柔光，四周沉下去
  centre(x, E){
    const { R, W, H, pal, dark } = E, cs = bGlowColors(E), cx = W * R(.3, .7), cy = H * R(.3, .68), m = Math.max(W, H);
    const edge = dark ? bMix(pal.g, '#000000', .45) : bSafe(cs[0], pal); x.fillStyle = edge; x.fillRect(0, 0, W, H);
    bBlob(x, pal.g, cx, cy, m * R(.75, .95), 1); bBlob(x, dark ? cs[0] : bSafe(bMix(pal.g, '#ffffff', .75), pal), cx, cy, m * R(.36, .56), .95, R(.8, 1.2)); bBlob(x, cs[2], cx + W * R(-.3, .3), cy + H * R(-.3, .3), m * .4, .5);
  },
  // 往下沉：一头浅，一头深
  sunk(x, E){
    const { R, W, H, pal, dark } = E, [L, C, h] = bLch(pal.g), up = E.maybe(.25), a = bSafe(bOklch(Math.min(.97, L + (dark ? .16 : .06)), Math.min(.17, C * 1.1 + .03), h + R(-30, 30)), pal), b = bSafe(bOklch(Math.max(.1, L - (bHueIn(h, 40, 152) && !dark ? .03 : dark ? .06 : .13)), Math.min(.18, C * 1.15 + .02), h + R(-24, 24)), pal), g = x.createLinearGradient(0, up ? H : 0, W * R(-.2, .2), up ? 0 : H);
    g.addColorStop(0, a); g.addColorStop(R(.4, .6), pal.g); g.addColorStop(1, b); x.fillStyle = g; x.fillRect(0, 0, W, H);
    bBlob(x, bGlowColors(E)[0], W * R(0, 1), H * R(.1, .5), W * R(.5, .8), .55, .6, R(0, 3));
  },
  // 双色：两块颜色顺顺地走过去
  duo(x, E){
    const { R, W, H, pal } = E, cs = bGlowColors(E), a = R(0, 6.28), L = Math.hypot(W, H) / 2, g = x.createLinearGradient(W / 2 - Math.cos(a) * L, H / 2 - Math.sin(a) * L, W / 2 + Math.cos(a) * L, H / 2 + Math.sin(a) * L);
    g.addColorStop(0, cs[0]); g.addColorStop(R(.36, .64), E.maybe(.5) ? pal.g : bMix(cs[0], cs[1], .5)); g.addColorStop(1, cs[1]); x.fillStyle = g; x.fillRect(0, 0, W, H);
    if (E.maybe(.6)) bBlob(x, cs[2], W * R(.1, .9), H * R(.1, .9), W * R(.45, .8), .8, R(.6, 1.2), R(0, 3));
  },
  // 宣纸
  rice(x, E){
    const { W, H, dark, R } = E, cs = bGlowColors(E);
    if (E.maybe(.6)) bBlob(x, cs[2], W * R(0, 1), H * R(0, 1), W * R(.6, 1), .45, R(.6, 1.2));
    x.globalCompositeOperation = dark ? 'soft-light' : 'multiply'; x.globalAlpha = dark ? .5 : .85; x.drawImage(makePaper('rice', W, H, E.idx || 0), 0, 0); x.globalAlpha = 1; x.globalCompositeOperation = 'source-over';
  },
  // 水彩：颜色在湿纸上自己走开，边上积一圈
  wash(x, E){
    const { R, I, W, H, rnd } = E, cs = bGlowColors(E);
    for (let i = 0, n = I(4, 6); i < n; i++){
      const cx = W * R(-.05, 1.05), cy = H * R(-.05, 1.05), r = W * R(.26, .6), c = cs[i % cs.length], q = Array.from({ length: 26 }, () => r * (1 + (rnd() - .5) * .5));
      const at = (j, k) => [cx + Math.cos(j / 26 * 6.2832) * q[j % 26] * k, cy + Math.sin(j / 26 * 6.2832) * q[j % 26] * k];
      for (const [k, al] of [[1, .22], [.93, .2], [.84, .2]]){
        x.beginPath();
        for (let j = 0; j < 26; j++){ const a = at(j, k), b = at(j + 1, k), d = at(j + 2, k); if (!j) x.moveTo((a[0] + b[0]) / 2, (a[1] + b[1]) / 2); x.quadraticCurveTo(b[0], b[1], (b[0] + d[0]) / 2, (b[1] + d[1]) / 2); }
        x.closePath(); x.fillStyle = bAlpha(c, al); x.fill();
      }
      x.strokeStyle = bAlpha(c, .25); x.lineWidth = 2; x.stroke();
    }
    x.globalCompositeOperation = 'soft-light'; for (const [cell, a] of [[90, .22], [26, .16], [8, .1]]){ x.globalAlpha = a; x.imageSmoothingEnabled = true; x.drawImage(blobLayer(W, H, cell, rnd), 0, 0, W, H); } x.globalAlpha = 1;
    x.globalCompositeOperation = 'multiply'; x.globalAlpha = .7; x.drawImage(makePaper('rice', W, H, E.idx || 0), 0, 0); x.globalAlpha = 1; x.globalCompositeOperation = 'source-over';
  },
};
// 墨跟着底走：粉底上是深红，蓝底上是夜蓝 —— 不总是黑
function bTintInk(pal, rnd, force){
  if (rnd() > .5 && !force) return pal;
  const [mid, C, h] = bLch(pal.g), dark = pal.m === 'night', hue = C > .02 ? h : bLch(pal.a)[2];
  if (!dark && mid < .55) return pal;
  const i = dark ? bOklch(.93, .03, hue + 8) : bOklch(mid > .8 ? .3 : .24, bHueIn(hue, 60, 160) ? .04 : .09, hue - 4);
  return contrast(hex2rgb(i), hex2rgb(pal.g)) >= 6.2 ? { ...pal, i } : pal;
}
// ════════════════════════════════════════════════════════════════════
//  9. 版式盲盒 ⑥ 掷签、验收、落墨
// ════════════════════════════════════════════════════════════════════
// st.blind = { seed, seeds?, comp?, look?, hero?, word?, own?, pal?, fx?, post?, items?, move? }
//   seed 总种子；seeds ＝ 单独重掷过的那几样；comp/look/hero/word ＝ 拆出来就钉住的方案、气氛和主角 ——
//   🔑 钉住是因为人会接着改：早先主角每次重算都重挑，选中几个字加个粗，整张就换了一张脸。
//   own ＝ 这一个盒子里，纸 / 字 / 墨哪几样用自己的；pal/fx/post/items/move ＝ 人自己定过的。
// planBlind 只算「谁在哪」，不画一笔（量具用桩就能跑，测试靠它）；画都在 renderBlind。
const B_FX_ORDER = ['misreg', 'wash', 'echo', 'ink', 'drift', 'dots', 'dither', 'scan', 'wear', 'sand', 'motes', 'scatter', 'smear', 'slit', 'cuts', 'slice', 'split', 'stitch', 'ripple', 'veil', 'blinds', 'trail', 'burst', 'haze', 'glow', 'melt', 'focus', 'bars', 'disc', 'torn', 'brush', 'petals', 'snow'];
// 面板上：常用的几样露在外头，其余收在「更多」里。掷的时候一样都不用后者
const B_FX_MAIN = ['melt', 'ink', 'drift', 'focus', 'cuts', 'split', 'misreg', 'dither', 'dots', 'slit', 'smear', 'veil', 'blinds', 'disc', 'bars', 'trail', 'sand', 'scatter'];
const B_FX_BODY = ['melt', 'ink', 'drift', 'focus', 'misreg', 'wash', 'wear', 'haze', 'glow', 'bars', 'disc', 'torn', 'brush', 'petals', 'snow'];
const B_POST_MAIN = ['reeded', 'matte', 'gauss', 'soft', 'halation', 'film', 'multiply', 'negate', 'defocus', 'swirl', 'subtitle'];
const blindSeed = () => (Math.random() * 0xffffffff) >>> 0;

function blindContent(text, hero){
  const units = bUnits(text), core = units.filter(u => !u.punct), clauses = bClauses(text);
  const cjk = core.filter(u => !u.latin).length >= core.length * .7;
  return { text, units, core, N: core.length, clauses, cjk, hero };
}

// 每一样东西各有各的种子，都从总种子派生：单换一样的时候，别的一动不动。
const B_PARTS = ['pal', 'hero', 'font', 'comp', 'fx', 'line', 'post', 'look'];      // 只能往后加：序号就是它派生种子的盐（line 已经不掷了，位置留着）
const blindSeeds = bl => Object.fromEntries(B_PARTS.map((k, i) => [k, bl.seeds && bl.seeds[k] !== undefined ? bl.seeds[k] >>> 0 : bSub(bl.seed >>> 0, i)]));

// 钉住的主角还在不在（人可能改了正文）。在，就认它在原文里的位置。
function blindPinned(pin, text, title){
  if (!pin) return null;
  const src = pin.title ? title : text, at = src.indexOf(pin.t);
  if (at < 0) return null;
  const units = bUnits(pin.t).filter(u => !u.punct).map(u => ({ ...u, at: u.at + at, ...(pin.title ? { src: 'title' } : {}) }));
  return units.length ? { t: pin.t, title: !!pin.title, units } : null;
}

// 收下的版式拿去排另一段字：方案、气氛、颜色、字体照旧，跟原来那段字绑在一起的几样放开
function blindFor(bl, text, title){
  if (!bl || !bl.hero || blindPinned(bl.hero, text, (title || '').trim())) return bl;
  const { hero, word, move, ...rest } = bl; return rest;
}

function planBlind(st, mk){
  const bl = st.blind, own = bl.own || {}, S = SIZES[st.orient] || SIZES.portrait, sd = blindSeeds(bl), r = k => bRng(sd[k]).rnd;
  const text = (st.text || '').trim() ? st.text : (st.title || ''), title = (st.title || '').trim();
  if (!bUnits(text).some(u => !u.punct)) return null;

  let pal = bPalette(st, r('pal'), own);
  if (bl.pal) pal = { ...bl.pal, m: relLum(hex2rgb(bl.pal.g)) < .3 ? 'night' : 'clear' };
  else if (bl.look && !own.paper && !own.ink){                       // 钉住了气氛：颜色换到合得上的为止
    const k = bLook(pal, () => .5, bl.look), rp = bRng(bSub(sd.pal, 1)).rnd; for (let q = 0; q < 24 && !bLookOk(k, pal); q++) pal = bPalette(st, rp, own);
  }
  const look = bLook(pal, r('look'), bl.look);
  if (!pal.paper && !own.ink && !bl.pal) pal = bTintInk(pal, bRng(bSub(sd.look, 3)).rnd, look.tint);
  const rr = r('hero'), words = bWords(text), word0 = words.length ? (q => bDense(q.t) ? { ...q, t: q.t } : words.find(w => bDense(w.t)) || q)(bWeighted(rr, words)) : null;
  const hero = blindPinned(bl.hero, text, title) || bHero({ ...st, text }, bClauses(text), rr);
  const word = bl.word && text.includes(bl.word) ? { t: bl.word } : word0;
  const fonts = bFonts(st, r('font'), text, (hero ? hero.t : '') + (word ? word.t : '') + text, own.font);

  const go = (t, h, w, whole) => blindCompose(st, S, pal, fonts, mk, t, h, w, bl, whole, sd, look);
  let got = go(text, hero, word, true), inner = null, innerSt = null;
  if (!got){
    // 太长了：第一张只放主角当封面，全文按平常的排法跟在后面，同一张底同一套色
    got = go(hero ? hero.t : text.slice(0, 8), hero, word, false)
       || go(bUnits(text).filter(u => !u.punct).slice(0, 4).map(u => u.t).join(''), null, null, false);
    if (!got) return null;
    innerSt = { ...st, blind: null, title: '', pages: 'auto', showHeader: false, ink: pal.i, inkLight: 0, weight: 0, metaInk: bMix(pal.g, pal.i, .72),
                quoteInk: 'same', fontSize: 38, offsetX: 0, offsetY: 0, stack: got.B.fonts.body, vertical: got.B.cjk && r('font')() < .3, titleSpans: [] };
    inner = planPages(innerSt, mk);
    inner.ground = (ctx, i) => blindGround(ctx, inner.W, inner.H, pal, st, i + 1, look, sd);
  }
  const B = got.B;
  return { S, W: S.w, H: S.h, COL: S.w - S.pad * 2, stack: B.fonts.body, box: S.h, pages: [[]].concat(inner ? inner.pages : []),
           title: titleBlock({ ...st, title: '', titleSpans: [] }, 100, 100, mk), ch: { head: 0, title: 0, src: 0, foot: 0 },
           blind: { ...got, seed: bl.seed >>> 0, sd, pal, look, fonts: B.fonts, inner, innerSt,
                    pin: { comp: got.comp, look: look.id, hero: hero ? { t: hero.t, title: !!hero.title } : undefined, word: word ? word.t : undefined },
                    name: { comp: got.comp, look: look.id, fx: got.fxNames, post: B.post, scene: [...new Set(B.items.map(i => i.id))] } } };
}

function blindCompose(st, S, pal, fonts, mk, text, hero, word, bl, whole, sd, look){
  const info = blindContent(text, hero), draw = bRng(sd.comp).rnd, soft = bIsQuiet(pal);
  // 空气安静，方案也安静：底和说话的嗓门要是一回事
  const NL = info.N, long = NL >= 130, fit = c => (bFaces(c, look) ? 1 : .12) * (c.long ? (NL >= 150 ? 9 : NL >= 100 ? 2.4 : .7) : NL >= 150 ? (c.dup ? .12 : .45) : NL >= 100 && c.dup ? .6 : 1);
  const pool = BLIND_COMPS.map((c, i) => ({ c, i, w: fit(c) * c.w * (c.q ? (soft ? 1.3 : .8) * (look.q || 1) : c.warm ? look.warm || 1 : B_LOUD[c.id] ? (soft ? .5 : 1) * (look.loud || .8) : 1) }));
  let want = bl.comp ? pool.find(q => q.c.id === bl.comp) : null;                    // 钉住的先试，排不进去再掷
  while (pool.length){
    const it = want || bWeighted(draw, pool), tries = want ? 10 : 3; want = null; pool.splice(pool.indexOf(it), 1);
    const c = it.c;
    for (let k = 0; k < tries; k++){
      // 每种方案自己一条随机流：钉住它以后，前面掷过谁都不影响它长什么样
      const rnd = bRng(bSub(sd.comp, 100 + it.i * 11 + k)).rnd;
      let face = fonts;
      if (!fonts.own){ const cls = bFaces(c, look) || c.face || ['heavySans']; face = fonts.pair(cls[Math.floor(bRng(bSub(sd.font, 60 + it.i)).rnd() * cls.length)]); }
      const B = blindStage(st, S, rnd, pal, face, mk, c.long ? .08 : c.warm ? .074 : .056);
      Object.assign(B, info, { word, B0: null, look, kin: bKin(pal), inkAccent: bInkAccent(pal), softHero: !/^heavy/.test(face.cls || '') && !/Black|Heavy|900|DuanHei/.test(face.hero + face.heroW), paras: bParas(text, info.cjk), warm: !!c.warm, minBody: bl.post ? 0 : look.min || 0 });
      B.titleUsed = !!(hero && hero.title);
      B.solo = B.N <= 12 && (!whole || B.N <= 8 || rnd() < .6);
      B.D = B.solo ? 40 : B.N;
      if (B.solo) B.hero = { t: B.core.map((u, i) => (i && u.sp ? ' ' : '') + u.t).join(''), units: B.core };
      B.keyClause = B.clauses.find(q => hero && q.t === hero.t) || (B.clauses.length ? bWeighted(rnd, B.clauses.map(q => ({ q, w: q.n >= 2 && q.n <= 8 ? 3 : 1 }))).q : null);
      const home = hero && !hero.title ? B.paras.find(p => hero.units[0].at >= p.at && hero.units[0].at < p.at + p.t.length) : null;
      B.keyPara = home || (B.paras.length ? bWeighted(rnd, B.paras.map(p => ({ p, w: (p.quote ? 4 : 1) * (p.ask ? 2 : 1) * (p.i === B.paras.length - 1 ? 2 : 1) * (p.n > 60 ? .2 : 1) }))).p : null);
      const keys = new Set(B.keyClause ? B.keyClause.units.map(u => u.at) : []);
      if (B.keyClause && B.keyClause.n > B.N * .6) keys.clear();
      B.isKey = u => keys.has(u.at);
      const mode = B.P(c.modes || (c.warm ? ['left', 'right', 'center', 'left', 'side', 'corners', 'corners'] : ['corners', 'corners', 'corners', 'top', 'foot', 'side'])), room = B.metaRoom(mode);
      B.A = { x: B.M, y: room.t, w: B.W - B.M * 2, h: B.H - room.t - room.b };
      // 字幕：上下要裁掉两条黑边，字先让开
      if (bl.post ? bl.post.includes('subtitle') : look.id === 'subtitle'){ const cut = B.H * .115; B.A.y = Math.max(B.A.y, cut); B.A.h = B.H - B.A.y - Math.max(cut, room.b); }
      if (!c.ok(B)) break;
      if (!c.run(B)) continue;
      bRestrain(B);
      B.placeMeta(mode);
      // 老宋的笔画粗细不一：同一款字，有时候把它印重一点
      if (c.warm){ const fw = B.P([0, 0, 1, 1, 2]); if (fw && /Huiwen|KingHwa|Chill|Nanxi/.test(B.fonts.canon || B.fonts.hero)) for (const l of B.layers) if (l.role === 'hero' && !l.body) for (const o of l.ops) if (o.k === 'g' && !o.cell && o.f === 'hero') o.fw = fw; }
      // 大字压到小字的地方，小字反色再印一遍（只印在大字里头）
      B.layers.forEach((l, i) => { if (l.twin){ l.of = i - 1; l.tc = (l.ops[0] || {}).c; } });
      if (B.maskOps){ const i = B.layers.findIndex(l => l.role === 'meta'); if (i >= 0) B.layers.push({ role: 'meta', ops: [], fx: [], twin: true, of: i, tc: B.maskC, mask: { mode: 'in', ops: B.maskOps } }); }
      for (const l of B.layers){ l.rect = blindRect(B, l); l.avg = blindAvg(l); }
      if (!blindFits(B)) continue;
      if (whole && !blindKeepsAll(B)) continue;
      blindUnder(B, bRng(bSub(sd.comp, 77 + it.i)), c, bl);
      blindMoves(B, bl.move);
      blindStyle(B, st);
      for (const l of B.layers) if (l.twin) { l.ops = B.layers[l.of].ops.map(o => ({ ...o, c: o.styled ? o.c : l.tc, rich: undefined })); l.rect = B.layers[l.of].rect; l.avg = B.layers[l.of].avg; }
      const main = B.layers.filter(l => l.role === 'hero' && !l.body && !l.twin)[0] || B.layers.find(l => l.role === 'hero') || B.layers.find(l => l.role === 'body');
      B.heroRect = main ? main.rect : null;
      const boxes = B.layers.filter(l => ['body', 'meta'].includes(l.role) || l.body).flatMap(l => l.ops.map(op => blindOpRect(B, op))).filter(Boolean);
      B.hit = (px, py, rr) => boxes.some(q => px > q.x - rr && px < q.x + q.w + rr && py > q.y - rr && py < q.y + q.h + rr);
      const fxNames = blindPickFx(B, bRng(sd.fx), bl, c, look);
      // 🔒 图形和线条一件都不掷，人想要自己添。例外只有玻璃那几片 —— 它们是「局部模糊」，不是图形
      const rp = bRng(sd.post);
      B.items = bl.items || [];
      if (!bl.items && look.pane && rp.rnd() < look.paneP * (long || c.long ? .3 : 1)){
        const id = rp.P(look.pane), it = blindNewItem(id, bSub(sd.post, 9), pal, S.w, S.h), h = B.heroRect || { x: B.A.x, y: B.A.y, w: B.A.w, h: B.A.h };
        // 玻璃盖在主角的某一两个字上；正文最多被它挡掉一小半
        const gs = main ? main.ops.filter(o => o.k === 'g') : [], at = () => { const o = gs.length ? rp.P(gs) : { x: h.x + h.w * rp.R(.2, .8), y: h.y + h.h * rp.R(.2, .8), s: 120 }, z = o.cell ? Math.min(...o.cell) : o.s; return { x: o.x + z * rp.R(-.4, .4), y: o.y + z * rp.R(-.4, .4), z }; };
        let best = null;
        for (let q = 0; q < 12; q++){
          const a = at(), r = Math.max(S.w * .11, Math.min(S.w * .3, a.z * rp.R(.8, 1.5))), k = id === 'blurp' ? 1 : rp.P([.6, .9, 1.3, 1.8]), hide = boxes.filter(b => main && !main.body).reduce((s, b) => s + Math.max(0, Math.min(a.x + r, b.x + b.w) - Math.max(a.x - r, b.x)) * Math.max(0, Math.min(a.y + r * k, b.y + b.h) - Math.max(a.y - r * k, b.y)), 0) / Math.max(1, boxes.reduce((s, b) => s + b.w * b.h, 0));
          if (!best || hide < best.hide) best = { a, r, k, hide }; if (hide < .12) break;
        }
        if (best.hide < .4){ Object.assign(it, { x: Math.round(best.a.x), y: Math.round(best.a.y), r: Math.round(best.r), rot: 0, front: true }); if (id !== 'blurp') it.q = best.k; B.items = [it]; }
      }
      let ps = bl.post || rp.P(look.post); const still = long || c.long;
      // 长文滤掉那些糊字的修图之后，别落得光秃秃的：补一层轻的空气
      if (!bl.post && still && look.id !== 'flat' && !ps.some(q => B_LONG_POST.includes(q)) && rp.rnd() < .55) ps = [rp.P(['soft', 'soft', 'film', 'matte', 'multiply'])];
      B.post = B_POST_ORDER.filter(q => ps.includes(q) && (bl.post || !(long || c.long) || B_LONG_POST.includes(q)));
      return { B, comp: c.id, fxNames };
    }
  }
  return null;
}
const bP = (rnd, arr) => arr[Math.floor(rnd() * arr.length)];

// 满得已经放不下一层淡字的那些
const B_FULL = Object.fromEntries(['block', 'vblock', 'pack', 'field', 'micro', 'mosaic', 'contour', 'shift', 'image', 'youme', 'void', 'drift', 'ear', 'underlay', 'canon', 'ramp', 'rain', 'giant', 'overprint', 'panel', 'half', 'slit', 'depth', 'frame'].map(k => [k, 1]));
const B_LOUD = Object.fromEntries(['block', 'vblock', 'pack', 'skyline', 'ramp', 'contour', 'overprint', 'cut', 'shutter', 'slit', 'micro', 'giant', 'grainy', 'shift', 'half', 'mosaic', 'tilt'].map(k => [k, 1]));
// 垫底的淡字和边注：都是从正文里来的回声（没有 at，不算正文）
function blindUnder(B, rng, c, bl){
  const { R, P, maybe } = rng, { W, H, A, M, pal, u, look } = B, heavy = /Black|Heavy|900/.test(B.fonts.hero + B.fonts.heroW), busy = B.layers.some(l => l.role === 'deco' && l.ops.some(o => o.k === 'g') || l.role === 'back');
  const key = B.hero ? B.hero.units : B.keyClause ? B.keyClause.units : B.core.slice(0, 4), ghost = key.map(q => ({ ...q, at: undefined }));
  if (!B_FULL[c.id] && !busy && B.cjk && maybe((look.id === 'flat' ? .2 : look.under === undefined ? .5 : look.under) * (c.long ? .4 : 1))){
    const blur = maybe(.6) ? (look.ghost === undefined ? 5 : look.ghost) * R(.6, 1.6) * u : 0, col = P([pal.i, pal.i, B.kin]), al = (heavy ? R(.045, .08) : R(.07, .13)) * (blur > 4 ? 1.5 : 1) * (B.dark ? 1.15 : 1), l = B.layer('deco', { bleed: true, under: true, ...(blur ? { soft: blur } : {}) }), kind = P(['char', 'char', 'col', 'row', 'verse']);
    const body = B.layers.filter(q => q.role === 'body' || q.body).flatMap(q => q.ops.map(o => blindOpRect(B, o))).filter(Boolean), left = body.length ? body.reduce((s, r) => s + r.x + r.w / 2, 0) / body.length < W / 2 : maybe(.5);
    if (kind === 'char'){ const ch = bDense(B.word ? B.word.t : '') || bDense(ghost.map(g => g.latin ? '' : g.t).join('')) || ghost[0].t, s = W * R(.8, 1.35); B.glyph(l, ch, W * (left ? R(.58, .82) : R(.18, .42)), H * R(.3, .72), s, { c: col, a: al, ...(B.fonts.big ? { stack: B.fonts.big } : {}) }); }
    else if (kind === 'col'){ const n = B.colLen(ghost), s = Math.min(H * R(1, 1.25) / n, W * .7); B.col(l, ghost, W * (left ? R(.66, .86) : R(.14, .34)), H * .5 - s * n / 2 + H * R(-.08, .08), s, { c: col, a: al }); }
    else if (kind === 'row'){ const s = Math.min(W * R(1.15, 1.5) / B.emOf(ghost), H * .4); B.row(l, ghost, W * R(.4, .6), H * R(.2, .8), s, { c: col, a: al }); }
    else { const s = Math.min(W * .9 / B.emOf(ghost), H * .1), n = Math.ceil(H / (s * 1.16)), dx = R(-.5, .5) * s; for (let i = -1; i <= n; i++) B.row(l, ghost, W / 2 + dx * (i - n / 2), s * 1.16 * (i + .5), s, { c: col, a: al * (.45 + .55 * Math.abs(Math.sin(i * .7 + 1))) }); }
  }
  // 没写题头出处日期的，边上也别空得像没做完：拿正文里的词当边注，很小
  if (!B.metaItems().length && B.cjk && B.N > 8 && maybe(.55)){
    const z = R(14, 18) * u, l = B.layer('deco', { note: true }), soft = { c: pal.i, a: .72, f: 'meta' }, first = B.clauses[0], last = B.clauses[B.clauses.length - 1], cut = (us, n, end) => (end ? us.slice(-n) : us.slice(0, n)).map(q => ({ ...q, at: undefined })), y0 = M * .52, y1 = H - M * .52, gap = R(.1, .6), kind = P(['corner', 'corner', 'side', 'one', 'four']);
    const put = (us, x, y, align) => B.row(l, us, x, y, z, { align, gap, ...soft });
    if (kind === 'corner'){ put(cut(first.units, 4), M, y0, 'left'); put(cut(last.units, 4, true), W - M, y1, 'right'); }
    else if (kind === 'one') put(cut(key, 6), P([M, M, W - M]) === M ? M : M, P([y0, y1]), 'left');
    else if (kind === 'side'){ const us = cut(key, 8), n = B.colLen(us, 'meta', gap) * z, right = maybe(.5); B.col(l, us, right ? W - M * .46 : M * .46, P([M, H - M - n, (H - n) / 2]), z, { gap, ...soft }); }
    else { const ws = [...key.slice(0, 4)], at = [[M, y0, 'left'], [W - M, y0, 'right'], [M, y1, 'left'], [W - M, y1, 'right']]; if (ws.length === 4) ws.forEach((w, i) => put([{ ...w, at: undefined }], ...at[i])); else put(cut(key, 4), M, y0, 'left'); }
  }
}

// 淡的、软的香槟色，替掉暗底上的金 —— 金字是喜报，不是诗
function bInkAccent(pal){
  const [L, C, h] = bLch(pal.a), dark = pal.m === 'night'; if (contrast(hex2rgb(pal.a), hex2rgb(pal.g)) < 3.6) return pal.i;
  return dark && bHueIn(h, 48, 108) && C > .07 ? bOklch(Math.max(.84, L), .055, h) : pal.a;
}
// 大字的颜色收一收：暗底上不许大金字；又大又艳又粗的，一张里头只留一样
function bRestrain(B){
  // 仿宋细而尖，是小字的字：拉长、加粗、放到巨大就露怯，换成干净的宋体
  if (/Zhuque|Fangsong|仿宋/.test(B.fonts.canon || B.fonts.hero)) for (const l of B.layers) if (l.role === 'hero') for (const o of l.ops) if (o.k === 'g' && o.f === 'hero' && !o.stack && (o.cell || o.s > 210 * B.u)){ o.stack = bClean(o.t, true); delete o.fw; }
  const { pal } = B, gold = B.dark && bHueIn(bLch(pal.a)[2], 46, 108) && bLch(pal.a)[1] > .07;
  for (const l of B.layers) if (l.role === 'hero' && !l.twin && !l.mask && !l.onAccent){ const z = blindAvg(l); if (gold && z > 64 * B.u) for (const o of l.ops) if (o.c === pal.a) o.c = z > 150 * B.u ? pal.i : B.inkAccent; }
}
const B_FX_QUIET = ['melt', 'ink', 'drift', 'focus', 'haze', 'wash', 'glow', 'dither', 'echo', 'trail', 'sand', 'motes', 'dots', 'wear', 'ripple', 'misreg', 'burst'];
const B_FX_DYE = ['misreg', 'echo', 'wash', 'glow'];                // 会把字染成点睛色的：压在色块上的字不上
function blindPickFx(B, rng, bl, c, look){
  const names = [], { P, maybe } = rng, own = look.hero === 'own', set = own ? (c.fx && maybe(.4) ? [P(c.fx)] : []) : P(look.hero), swap = P(['melt', 'haze', 'focus']);
  B.layers.forEach(l => {
    if (l.role !== 'hero' || l.twin) return;
    if (bl.fx){
      // 人自己点过效果：点了什么就是什么，只是小字那层收着力
      if (l.mask || l.tex) return;
      l.gentle = l.gentle || l.body;
      l.fx = B_FX_ORDER.filter(f => bl.fx.includes(f) && (!l.body || B_FX_BODY.includes(f)));
    } else if (!l.fx.length && !l.nofx && !l.mask && !l.tex && !l.own){
      if (c.long){ if (maybe(.45)) return; l.gentle = true; }      // 长文里大字只轻轻动一下，别把它弄没了
      const small = l.body || l.avg < 50 * B.u; let fx = set.slice();
      if (small){ l.gentle = true; fx = fx.filter(f => B_FX_BODY.includes(f) && !['bars', 'torn', 'brush'].includes(f) && !(look.id === 'sandblast' && f !== 'wash')); if (!l.body && !fx.length) fx = []; if (l.avg < 34 * B.u) fx = fx.filter(f => ['wash', 'haze', 'glow', 'focus'].includes(f)); }
      else if (l.quiet || l.gentle || ['melt', 'chorus', 'contour', 'shutter'].includes(c.id)) fx = fx.map(f => B_FX_QUIET.includes(f) || (!l.quiet && l.gentle && ['cuts', 'slice', 'split', 'stitch', 'veil', 'blinds', 'bars', 'disc', 'torn', 'brush', 'scatter', 'scan', 'smear'].includes(f)) ? f : swap);
      if (l.avg < 110 * B.u) fx = fx.filter(f => !['veil', 'split', 'stitch', 'smear', 'slit', 'scatter'].includes(f));
      // 一次只动一两种对比。粗、艳、发光、甩影子一起上，就是促销
      const col = (l.ops.find(o => o.k === 'g') || {}).c, ink = col === B.pal.i, heavy = !B.softHero || B.fonts.cls === 'oldSerif' || l.ops.some(o => o.fw) || /KingHwa|Nanxi|Zhaohua/.test(B.fonts.canon || B.fonts.hero), big = l.avg > 78 * B.u; l.heavy = heavy; l.ghost = B.kin;
      fx = fx.map(f => {
        if (c.long && !B_LONG_FX.includes(f)) return 'melt';
        if (f === 'wash' && (c.long || B.dark) && bHueGap(bLch(B.pal.a)[2], bAnchor(B.pal)) > 75) return 'focus';      // 一行字从白染到另一头的艳色，花
        if (['burst', 'trail', 'echo', 'smear'].includes(f) && !ink && big) return 'melt';
        if (f === 'echo' && big && (B.dark || heavy)) return 'focus';
        if (f === 'wear' && B.dark && l.avg > 110 * B.u) return 'melt';      // 大白字撒麻点，像掉了漆
        if (['glow', 'haze'].includes(f) && B.dark && heavy && big) return 'melt';
        if (f === 'burst' && B.dark && heavy && l.avg > 130 * B.u) return 'drift';
        if (['veil', 'bars'].includes(f) && !heavy) return 'focus';
        return f;
      });
      if (l.read && B_LOUD[c.id]) fx = fx.map(f => f === 'echo' ? 'wash' : f);
      if (l.onAccent || l.bleed) fx = fx.filter(f => !(l.onAccent && B_FX_DYE.includes(f)));
      l.fx = B_FX_ORDER.filter(f => fx.includes(f));
    }
    if (B.solo) l.gentle = true;
    for (const f of l.fx) if (!names.includes(f)) names.push(f);
  });
  return names;
}

// ── 人选中改过的字：排完之后盖上去，版面一动不动 ──────────────────
// 字号按比例走（普通版式里 46 → 92，就是大一倍），字体、颜色、粗细、浓淡照用。
function blindStyle(B, st){
  const marks = { text: spansToMarks(st.spans, (st.text || '').length), title: spansToMarks(st.titleSpans, (st.title || '').length) };
  const base = { text: st.fontSize || 46, title: titleFontSize(st) };
  if (!marks.text.some(Boolean) && !marks.title.some(Boolean)) return;
  for (const l of B.layers){
    if (l.tex || l.twin) continue;
    for (const op of l.ops){
      const m = op.src && op.at !== undefined && marks[op.src]; if (!m) continue;
      const k = q => q && q.size ? q.size / base[op.src] : 1;
      if (op.k === 'g'){
        const q = m[op.at]; if (!q) continue;
        op.styled = true; const z = k(q); op.s *= z; if (op.cell) op.cell = op.cell.map(v => v * z);
        if (q.ink) op.c = bToHex(inkOf(q.ink)); if (q.font) op.stack = pickStack(q.font, st, B.fonts[op.f] || B.fonts.body);
        if (q.weight !== undefined) op.fw = q.weight; if (q.alpha !== undefined) op.a = q.alpha;
        continue;
      }
      const slice = m.slice(op.at, op.at + op.t.length); if (!slice.some(Boolean)) continue;
      const plain = { size: op.s, stack: B.fonts[op.f || 'body'] || B.fonts.body, ink: null, stroke: 0, plain: true }, seen = new Map();
      op.styled = true;
      op.rich = slice.map(q => { if (!q) return plain; const id = JSON.stringify(q); if (!seen.has(id)){ const size = op.s * k(q); seen.set(id, { size, stack: q.font ? pickStack(q.font, st, B.fonts.body) : B.fonts[op.f || 'body'] || B.fonts.body, ink: q.ink ? inkOf(q.ink) : null, stroke: strokeFor(q.weight || 0, size), alpha: q.alpha }); } return seen.get(id); });
    }
  }
}
const bToHex = c => /^#[0-9a-f]{6}$/i.test(c) ? c : '#808080';

const blindAvg = l => { const s = l.ops.filter(o => o.s).map(o => o.cell ? Math.min(...o.cell) : o.s).sort((a, b) => a - b); return s.length ? s[s.length >> 1] : 60; };

// 人拖过的字块：整块平移、放缩、换色（move 以层的序号记；换方案时面板会把它清掉）
function blindMoves(B, move){
  if (!move) return;
  for (const [i, m] of Object.entries(move)){
    const l = B.layers[i]; if (!l || l.twin) continue;
    const k = Math.max(.2, Math.min(4, m.k || 1)), dx = m.dx || 0, dy = m.dy || 0, cx = l.rect.x + l.rect.w / 2, cy = l.rect.y + l.rect.h / 2;
    const X = v => cx + (v - cx) * k + dx, Y = v => cy + (v - cy) * k + dy;
    const move1 = op => {
      op.x = X(op.x); op.y = Y(op.y);
      for (const q of ['s', 'len', 'w', 'h', 'rad', 'o']) if (typeof op[q] === 'number') op[q] *= k;
      if (op.cell) op.cell = op.cell.map(v => v * k);
      if (m.c && op.k !== 'r') op.c = bCol(B.pal, m.c);
      if (m.a !== undefined) op.a = (op.a === undefined ? 1 : op.a) * m.a;
    };
    l.ops.forEach(move1);
    if (l.mask && l.mask.ops !== B.maskOps) l.mask.ops.forEach(move1);
    if (l.clip) l.clip = { x: X(l.clip.x), y: Y(l.clip.y), w: l.clip.w * k, h: l.clip.h * k };
    l.rect = blindRect(B, l); l.avg = blindAvg(l); l.moved = true;
  }
}

// ── 验收：没出界、没压住正文、一个字没丢 ──────────────────────────
function blindOpRect(B, op){
  if (op.k === 'g'){
    let w = op.cell ? op.cell[0] : (op.len || B.em(op.t, op.f) * op.s), h = op.cell ? op.cell[1] : op.s;
    const c = Math.abs(Math.cos(op.r || 0)), s = Math.abs(Math.sin(op.r || 0)), bw = w * c + h * s, bh = w * s + h * c;
    return { x: op.x - bw / 2, y: op.y - bh / 2, w: bw, h: bh };
  }
  if (op.k === 'l') return { x: op.x, y: op.y, w: op.len, h: op.s * 1.1 };
  if (op.k === 'v') return { x: op.x, y: op.y, w: op.s, h: op.len };
  if (op.k === 'r') return { x: op.x, y: op.y, w: op.w, h: op.h };
  return null;
}
const blindTurn = r => r;
function blindRect(B, l){
  const rs = l.ops.filter(o => !(o.k === 'r' && l.role !== 'back')).map(op => blindOpRect(B, op)).filter(Boolean);
  if (!rs.length) return { x: 0, y: 0, w: B.W, h: B.H };
  const x = Math.max(0, Math.min(...rs.map(r => r.x))), y = Math.max(0, Math.min(...rs.map(r => r.y)));
  return { x, y, w: Math.min(B.W, Math.max(...rs.map(r => r.x + r.w))) - x, h: Math.min(B.H, Math.max(...rs.map(r => r.y + r.h))) - y };
}
function blindFits(B){
  const pad = B.M * .5, boxes = [];
  for (const l of B.layers){
    if (l.role === 'deco' || l.role === 'back' || l.twin) continue;
    for (const op of l.ops){
      if (op.k === 'r') continue;
      if (!op.cell && !(op.s >= (l.role === 'meta' ? 11.5 : l.tex ? 10 : 18))) return false;
      const r = blindOpRect(B, op);
      if (!l.bleed && l.role !== 'meta' && (r.x < pad || r.y < pad || r.x + r.w > B.W - pad || r.y + r.h > B.H - pad)) return false;
      if (!l.bleed) boxes.push({ r, g: l.role === 'meta' ? 2 : (l.role === 'body' || l.body) ? 1 : 0, l });
    }
  }
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++){
    const a = boxes[i], b = boxes[j]; if (a.l === b.l || a.g === b.g) continue;
    const w = Math.min(a.r.x + a.r.w, b.r.x + b.r.w) - Math.max(a.r.x, b.r.x), h = Math.min(a.r.y + a.r.h, b.r.y + b.r.h) - Math.max(a.r.y, b.r.y);
    if (w > 3 && h > 3 && w * h > .05 * Math.min(a.r.w * a.r.h, b.r.w * b.r.h)) return false;
  }
  return true;
}
// 🔒 一个字都不丢：凡是标了 read 的层，合起来必须装得下原文的每一个字
function blindKeepsAll(B){
  const have = new Map();
  const add = (t, d) => { for (const ch of t) if (!B_PUNCT.test(ch)) have.set(ch, (have.get(ch) || 0) + d); };
  for (const l of B.layers) if (!l.twin && !l.tex && (l.read || (B.solo && l.role === 'hero'))) for (const op of l.ops) if (op.t && !op.deco && op.at !== undefined) add(op.t, 1);
  for (const u of B.core) add(u.t, -1);
  for (const v of have.values()) if (v < 0) return false;
  return true;
}

// ── 落墨 ───────────────────────────────────────────────────────────
function blindGround(ctx, W, H, pal, st, idx, look, sd){
  if (pal.paper){
    const photo = groundPhoto({ paper: pal.paper, orient: st.orient });
    if (photo && !(photo.complete && photo.naturalWidth)){ ctx.fillStyle = pal.g; ctx.fillRect(0, 0, W, H); }
    else {
      drawGround(ctx, { paper: pal.paper, paperLight: pal.light, orient: st.orient }, W, H, idx);
      if (look && look.id === 'first'){ const E = { ...bRng(bSub(sd.look, 21)), W, H, pal, dark: pal.m === 'night' }; if (E.maybe(.6)) bOrbs(ctx, E, .55); }
    }
    return;
  }
  ctx.fillStyle = pal.g; ctx.fillRect(0, 0, W, H);
  if (!look) return;
  const E = { ...bRng(bSub(sd.look, 21)), W, H, pal, idx, u: Math.min(W, H) / 1080, dark: pal.m === 'night' };
  let kind = E.P(look.grounds); if (kind === 'beam' && E.dark) kind = E.P(['corner', 'aura', 'centre']);      // 暗底上一道斜光，是影楼
  ctx.save(); BLIND_GROUND[kind](ctx, E); ctx.restore();
  if (!['rice', 'wash'].includes(kind) && E.maybe(look.fiber === undefined ? .4 : look.fiber)) bFiber(ctx, E);
}
// 一款字的「墨迹框」：以「国」字为准。字身在字框里偏上偏下，各款不一样，居中要按墨迹居
function bInk(x, font, latin, cache){
  const key = font + (latin ? 'L' : 'C'); if (cache.has(key)) return cache.get(key);
  x.font = font; const m = x.measureText(latin ? 'Hx' : '国'), v = { dy: (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2, w: m.actualBoundingBoxLeft + m.actualBoundingBoxRight, h: m.actualBoundingBoxAscent + m.actualBoundingBoxDescent };
  cache.set(key, v); return v;
}
function blindDrawOp(x, op, B, cache){
  const keep = x.globalAlpha;
  if (op.a !== undefined) x.globalAlpha = keep * op.a;
  if (op.k === 'l' || op.k === 'v'){
    x.textBaseline = 'top'; x.textAlign = 'start'; x.font = bFont(B, op.f || 'body', op.s);
    if (op.k === 'l') drawRich(x, op.x, op.y, op.t, op.c, op.c, strokeFor(op.heavy || 0, op.s), 0, op.rich || null);
    else drawColumn(x, op.x, op.y, op.t, op.s, op.c, op.c, 0, 0, op.rich || null);
  } else if (op.k === 'r'){
    if (op.hole && B.bare) x.clearRect(op.x, op.y, op.w, op.h); else { x.fillStyle = op.c; x.fillRect(op.x, op.y, op.w, op.h); }
  }
  else {
    x.save(); x.textAlign = 'center'; x.textBaseline = 'middle';
    const latin = /^[ -~]/.test(op.t), font = op.stack ? `${op.s}px ${op.stack}` : bFont(B, op.f, op.s), ref = bInk(x, font, latin, cache);
    x.font = font; x.translate(op.x, op.y); if (op.r) x.rotate(op.r);
    // 竖排的标点：句读坐右上角，引号括号转九十度（跟普通竖排一个规矩）
    if (op.vp && V_CORNER.includes(op.t)) x.translate(op.s * .5, -op.s * .5); else if (op.vp && V_ROTATE.includes(op.t)) x.rotate(Math.PI / 2);
    if (op.cell){ const w = latin ? x.measureText(op.t).width : ref.w; x.scale(op.cell[0] / Math.max(1, w), op.cell[1] / Math.max(1, ref.h)); }
    const dy = latin && !op.cell ? 0 : ref.dy;
    if (op.flip) x.scale(1, -1);
    if (op.hole && B.bare) x.globalCompositeOperation = 'destination-out';
    if (op.o){ x.strokeStyle = op.c; x.lineWidth = op.o; x.lineJoin = 'round'; x.strokeText(op.t, 0, dy); }
    else { const sw = op.fw ? strokeFor(op.fw, op.s) : 0; x.fillStyle = op.c; if (sw){ x.strokeStyle = op.c; x.lineWidth = sw; x.lineJoin = 'round'; x.miterLimit = 2; x.strokeText(op.t, 0, dy); } x.fillText(op.t, 0, dy); }
    x.restore();
  }
  x.globalAlpha = keep;
}
function blindDrawLayer(x, l, B, cache){
  x.save();
  if (l.clip){ x.beginPath(); x.rect(l.clip.x, l.clip.y, l.clip.w, l.clip.h); x.clip(); }
  for (const op of l.ops) blindDrawOp(x, op, B, cache);
  x.restore();
}
let bGrainTile = null;
function blindGrain(){
  if (bGrainTile) return bGrainTile;
  const c = PLATFORM.canvas(256, 256), x = c.getContext('2d'), im = x.createImageData(256, 256), rnd = mulberry32(99);
  for (let i = 0; i < 65536; i++){ const v = 128 + (rnd() - .5) * 200; im.data[i * 4] = im.data[i * 4 + 1] = im.data[i * 4 + 2] = v; im.data[i * 4 + 3] = 255; }
  x.putImageData(im, 0, 0);
  return (bGrainTile = c);
}

function renderBlind(canvas, st, plan, idx){
  const { blind, W, H } = plan;
  if (idx > 0) return renderPage(canvas, blind.innerSt, blind.inner, idx - 1);
  const { B, pal, sd } = blind, ctx = canvas.getContext('2d'), cache = new Map();
  if (canvas.width !== W * DPR || canvas.height !== H * DPR){ canvas.width = W * DPR; canvas.height = H * DPR; }      // 尺寸没变就别重新要一块
  else { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.clearRect(0, 0, canvas.width, canvas.height); }
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  if (!st.noGround) blindGround(ctx, W, H, pal, st, 0, blind.look, sd);
  B.bare = !!st.noGround;
  const env = salt => ({ ...bRng(bSub(sd.fx, salt)), u: B.u, W, H, pal, dark: B.dark, heroRect: B.heroRect, bodyRect: (B.layers.find(l => l.role === 'body' && !l.twin) || {}).rect, hit: B.hit });
  for (const it of B.items) blindDrawItem(ctx, it, B, 'back');

  const rank = { back: 0, deco: 1, hero: 2, body: 3, meta: 4 };
  B.layers.map((l, i) => ({ l, i })).sort((a, b) => rank[a.l.role] - rank[b.l.role] || a.i - b.i).forEach(({ l, i }) => {
    ctx.save();
    if (l.alpha !== undefined) ctx.globalAlpha = l.alpha;
    if (l.blend) ctx.globalCompositeOperation = l.blend;
    if (l.soft && !l.fx.length && !l.mask && !l.stripes && !l.fade && !l.ops.some(o => o.hole)){
      const q = l.soft > 4 ? .25 : .5, c = PLATFORM.canvas(Math.round(W * DPR * q), Math.round(H * DPR * q)), x = c.getContext('2d'); x.setTransform(DPR * q, 0, 0, DPR * q, 0, 0); blindDrawLayer(x, l, B, cache); x.setTransform(1, 0, 0, 1, 0, 0);
      const s = bBlur(c, l.soft * DPR * q); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(s, 0, 0, W, H); ctx.restore(); return;
    }
    if (!l.fx.length && !l.soft && !l.mask && !l.stripes && !l.fade && !(B.bare && l.ops.some(o => o.hole))){ blindDrawLayer(ctx, l, B, cache); ctx.restore(); return; }
    let cv = bCanvas(W * DPR, H * DPR);
    const x = cv.getContext('2d'); x.setTransform(DPR, 0, 0, DPR, 0, 0); blindDrawLayer(x, l, B, cache); x.setTransform(1, 0, 0, 1, 0, 0);
    if (l.soft){ const s = bBlur(cv, l.soft * DPR); bFree(cv); cv = s; }
    if (l.fade){ const z = cv.getContext('2d'), g = z.createLinearGradient(0, l.fade.y0 * DPR, 0, l.fade.y1 * DPR); g.addColorStop(0, '#000'); g.addColorStop(1, 'rgba(0,0,0,0)'); bMask(cv, g); }      // 没进雾里
    if (l.mask){
      const m = bCanvas(W * DPR, H * DPR), y = m.getContext('2d'); y.setTransform(DPR, 0, 0, DPR, 0, 0); for (const op of l.mask.ops) blindDrawOp(y, op, B, cache); y.setTransform(1, 0, 0, 1, 0, 0);
      const z = cv.getContext('2d'); z.globalCompositeOperation = l.mask.mode === 'in' ? 'destination-in' : 'destination-out'; z.drawImage(m, 0, 0); z.globalCompositeOperation = 'source-over'; bFree(m);
    }
    if (l.stripes){
      const { p, duty, vert, inv } = l.stripes, z = cv.getContext('2d'); z.globalCompositeOperation = 'destination-out';
      for (let k = -1; k * p < (vert ? W : H) + p; k++){ const a = (k + (inv ? 0 : duty)) * p * DPR, n = p * (inv ? duty : 1 - duty) * DPR; vert ? z.fillRect(a, 0, n, H * DPR) : z.fillRect(0, a, W * DPR, n); }
      z.globalCompositeOperation = 'source-over';
    }
    l.fx.forEach((f, k) => { const out = BLIND_FX[f](cv, env(i * 16 + k), l); if (out !== cv){ bFree(cv); cv = out; } });
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(cv, 0, 0); bFree(cv);
    ctx.restore();
  });
  for (const it of B.items) blindDrawItem(ctx, it, B, 'front');

  if (!B.bare){ ctx.save(); ctx.setTransform(DPR / 2, 0, 0, DPR / 2, 0, 0);
  ctx.globalCompositeOperation = 'soft-light'; ctx.globalAlpha = (B.dark ? .12 : .09) * (blind.look.grain || 1);
  ctx.fillStyle = ctx.createPattern(blindGrain(), 'repeat'); ctx.fillRect(0, 0, W * 2, H * 2); ctx.restore(); }
  // 修图：整张排好了再过一遍
  // （透明底时，会整张铺颜色的那几种就不过了）
  B.post.filter(p => !B.bare || ['gauss', 'defocus', 'swirl', 'matte', 'reeded'].includes(p)).forEach(p => BLIND_POST[p](canvas, { ...env(700 + B_POST_ORDER.indexOf(p)), full: B.layers.some(l => l.role === 'hero' && l.read), fonts: B.fonts, subtitle: B.hero ? B.hero.t : '' }));
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.textAlign = 'start'; ctx.textBaseline = 'top';
  if (DPR > 1) bDrain();                // 草样用的小画布留着下一张接着用
}

// ════════════════════════════════════════════════════════════════════
//  Studio 界面语言（zh-CN / en）
// ════════════════════════════════════════════════════════════════════
// 只管 Studio Shell 的界面文字（面板、药丸、提示、确认框）。
// 内容与内容默认值不在此列：题头默认「摘 录」、出处前缀「—— 」、提示句
// TAGLINES 是**作品上的字**，不是界面文字，保持原样（已声明的取舍）。
// 适配器注入：嵌入方开面板时传 init.locale（'zh-CN' | 'en' | 'auto'），
// 用户脚本自己走 cfg('uiLang')：在面板上换过语言就听那个，没换过（auto）= 浏览器语言
// （zh-* → zh-CN，其余 → en）。嵌入方指定了 zh-CN / en 的，听嵌入方的，面板上也不出切换按钮。
//
// 铁律（与阅读器 Phase 1 相同）：
//   1. zh-CN 词典的值必须与清扫前的界面原文**逐字相同** —— 中文界面一个字都不变；
//   2. 新增任何可见字符串必须 zh + en 双词条，键名平衡、{参数} 平衡
//      （tests/studio-i18n.test.mjs 站岗）；
//   3. 参数用 {name} 花括号占位，t() 做整串替换，不做任何格式化。

const STUDIO_I18N = {
  'zh-CN': {
    // ── 药丸 / 面板骨架 ──────────────────────────────────────────
    'pill.clip': '摘',
    'app.title': '拾 句',
    'lang.toggle': '界面换成英文',
    'full.on': '全屏', 'full.off': '退出全屏', 'full.show': '面板', 'full.hide': '收起面板', 'full.title': '铺满整块屏，整张看得见',
    'theme.auto': '跟随', 'theme.day': '白天', 'theme.night': '黑夜',
    'tab.text': '文', 'tab.paper': '纸', 'tab.font': '字', 'tab.ink': '色', 'tab.layout': '版',
    'act.save': '存 图', 'act.copy': '复制这张', 'act.close': '关闭',
    'act.store': '存',

    // ── 通用小件（开关 / 字重 / 对齐 / 排向）──────────────────────
    'sw.show': '显示', 'sw.hide': '隐藏',
    'weight.regular': '常', 'weight.medium': '中', 'weight.bold': '粗',
    'align.left': '左', 'align.center': '中', 'align.right': '右',
    'dir.horizontal': '横排', 'dir.vertical': '竖排',
    'tip.renameDelete': '双击改名 · 右键删掉',
    'tip.rightDelete': '右键删掉',

    // ── 文 ───────────────────────────────────────────────────────
    'text.title': '标题',
    'text.sizeWeight': '字号 · 字重',
    'text.titlePh': '留空就没有标题',
    'text.body': '内容',
    // ── 版式盲盒 ─────────────────────────────────────────────────
    'blind.open': '拆一个盲盒', 'blind.again': '再拆一个',
    'blind.openTitle': '随机一套字体海报式的排版。内容一个字不动，不喜欢就再拆。',
    'blind.prev': '上一个', 'blind.next': '下一个',
    'blind.keep': '存为常用', 'blind.keepTitle': '存成常用版式：以后换一段字，一点就照这样排',
    'blind.off': '合上盲盒',
    'blind.lock': '用我的', 'blind.paper': '纸', 'blind.font': '字', 'blind.ink': '墨',
   
    'blind.edit': '改一改', 'tab.box': '盒',
    'blind.editHint': '在纸上点中什么就能拖着走；右下角的圆点放大、转动，右上角的叉删掉。字块也能拖。',
    'blind.undo': '撤一步', 'blind.redo': '重做',
    'blind.reroll': '别的不动，只重掷这一样',
    'blind.re_comp': '方案', 'blind.re_pal': '配色', 'blind.re_font': '字体', 'blind.re_hero': '主角', 'blind.re_fx': '效果',
    'blind.noItems': '现在什么都没有，可以自己添。',
    'blind.size': '大小', 'blind.turn': '转', 'blind.thick': '粗细', 'blind.alpha': '浓淡',
    'blind.toFront': '盖到字上', 'blind.toBack': '垫到字下', 'blind.reseed': '换个长相', 'blind.dup': '再来一个', 'blind.del': '删掉', 'blind.home': '归位',
    'blind.l_hero': '主角的字', 'blind.l_body': '正文', 'blind.l_meta': '题头出处日期',
    'blind.compNo': '这段字排不进「{name}」，先给你换了一种。',
    'blind.cg': '底', 'blind.ci': '墨', 'blind.ca': '点睛', 'blind.cb': '副色',
    'blind.none': '都不要',
    'blind.pal_first': '最初', 'bl.first': '最初', 'bc.full': '满排', 'bc.stars': '散星', 'blind.pal_cn': '中国传统色', 'blind.pal_jp': '和田三造与日本传统色', 'blind.pal_intl': '国际与现代', 'blind.tune': '按配色理论现调一套', 'blind.tuned': '现调',
    'blind.s_comp': '方案', 'blind.s_pal': '颜色', 'blind.s_fx': '字上的效果', 'blind.s_post': '修图', 'blind.s_add': '自己加图形和线',
    'blind.q_quiet': '低声', 'blind.q_image': '字即图形', 'blind.q_loud': '响亮', 'blind.more': '更多',
    'blind.g_line': '线', 'blind.g_shape': '形状', 'blind.g_light': '光', 'blind.g_cover': '遮盖', 'blind.g_pane': '玻璃与马赛克',
    'blind.f_line': '单线', 'blind.f_yarn': '毛线', 'blind.m_sweep': '一笔', 'blind.m_coil': '打圈', 'blind.m_tie': '系住两个字', 'blind.m_orbit': '环绕',
    'blind.l_deco': '淡字',
    'act.bare': '透明底（存成 PNG）', 'sw.on': '要', 'sw.off': '不要',
    'blind.kept': '存好了：「{name}」。换一段字，点上面的「常用版式」就照它排；双击改名。',
    'blind.empty': '先写点字，才好拆。',
    'blind.coverNote': '字多，第一张是封面，全文在后面 {n} 张',
    'bc.banner': '横幅',
    'bc.column': '直幅',
    'bc.panel': '色块',
    'bc.chorus': '回声',
    'bc.depth': '景深',
    'bc.wave': '起伏',
    'bc.fall': '坠落',
    'bc.water': '水面',
    'bc.shape': '形',
    'bc.board': '棋局',
    'bc.quote': '引号',
    'bc.tilt': '倾斜',
    'bc.frame': '回廊',
    'bc.stretch': '拉长',
    'bc.recede': '渐远',
    'bl.mist': '晨雾',
    'bl.afterglow': '余光',
    'bl.watercolor': '水彩',
    'bl.swirl': '旋焦',
    'bl.over': '过曝',
    'bl.night': '夜航',
    'bl.lamp': '灯下',
    'bl.darkroom': '暗房',
    'bl.neon': '霓虹',
    'bl.dive': '潜水',
    'bl.paper': '宣纸',
    'bl.press': '铅印',
    'bl.film': '胶片',
    'bl.long': '长曝',
    'bl.vanish': '消散',
    'bl.glass': '隔窗',
    'bl.sandblast': '磨砂',
    'bl.gradient': '渐变',
    'bl.pearl': '珠光',
    'bl.cover': '遮蔽',
    'bl.signal': '信号',
    'bl.negative': '负片',
    'bl.subtitle': '字幕',
    'bl.flat': '平涂',
    'blind.s_look': '气氛', 'blind.re_look': '气氛', 'blind.re_post': '修图', 'blind.q_warm': '有体温', 'blind.q_long': '长文',
    'bc.folio': '一页书', 'bc.hung': '悬栏', 'bc.tiers': '段组', 'bc.theme': '主句', 'bc.voices': '两个声音', 'bc.center': '中轴', 'bc.initial': '首字', 'bc.cascade': '递降', 'bc.develop': '显影', 'bc.steps2': '错段', 'bc.aside': '边注', 'bc.silence': '静', 'bc.ledger': '条目', 'bc.swell': '起潮', 'bc.strophe': '分行',
    'blind.mine': '常用版式 {n}', 'blind.mineUse': '照这个版式排现在这段字。双击改名。',
    'bc.block': '满版', 'bc.vblock': '竖满版', 'bc.pack': '回旋', 'bc.steps': '骰子', 'bc.rain': '雨', 'bc.field': '字场',
    'bc.path': '一笔', 'bc.inline': '句中', 'bc.swiss': '网格', 'bc.pillar': '立柱', 'bc.skyline': '天际线', 'bc.ramp': '变奏',
    'bc.contour': '等高线', 'bc.overprint': '叠印', 'bc.cut': '错切', 'bc.shutter': '交错', 'bc.melt': '渐糊', 'bc.slit': '狭缝', 'bc.micro': '字中字',
    'bc.giant': '出血', 'bc.grainy': '点阵', 'bc.shift': '错行', 'bc.half': '对开', 'bc.mosaic': '拼板', 'bc.turn': '转题', 'bc.refrain': '重章',
    'bc.underlay': '底里的话', 'bc.stagger': '错落', 'bc.canon': '轮唱', 'bc.breath': '呼吸', 'bc.fade': '渐隐', 'bc.ear': '耳边', 'bc.drift': '双声',
    'bc.blank': '留白', 'bc.void': '空格', 'bc.grow': '渐成', 'bc.cross': '十字', 'bc.ma': '間', 'bc.tate': '立', 'bc.axis': '轴线',
    'bc.image': '意象', 'bc.youme': '你我',
    'bf.focus': '焦外', 'bf.haze': '洇开', 'bf.glow': '发光', 'bf.misreg': '错版', 'bf.slice': '切片',
    'bf.split': '裂缝', 'bf.stitch': '缝线', 'bf.ripple': '水纹', 'bf.burst': '放射', 'bf.trail': '拖影',
    'bf.echo': '叠影', 'bf.smear': '拉丝', 'bf.sand': '散沙', 'bf.dots': '网点', 'bf.wear': '残墨',
    'bf.scan': '扫描线', 'bf.wash': '渐染', 'bf.fade': '倒影',
    'bf.bars': '墨条', 'bf.veil': '半掩', 'bf.blinds': '百叶', 'bf.disc': '反色圆', 'bf.torn': '撕纸',
    'bf.brush': '干刷', 'bf.petals': '落花', 'bf.snow': '积雪',
    'bf.melt': '渐糊', 'bf.cuts': '错切', 'bf.dither': '点阵', 'bf.slit': '狭缝', 'bf.ink': '晕染', 'bf.drift': '消散',
    'bf.scatter': '散落', 'bf.motes': '粒子',
    'bp.negate': '反色', 'bp.multiply': '正片叠底', 'bp.gauss': '高斯模糊', 'bp.defocus': '失焦', 'bp.swirl': '旋焦', 'bp.soft': '柔光',
    'bp.halation': '光晕', 'bp.bokeh': '光斑', 'bp.spark': '暗闪', 'bp.pearl': '珠光', 'bp.film': '胶片', 'bp.retro': '复古',
    'bp.matte': '磨砂', 'bp.oil': '油画', 'bp.pixel': '像素', 'bp.lowq': '低画质', 'bp.vhs': '录像带', 'bp.reeded': '玻璃', 'bp.subtitle': '字幕',
    'bs.ring': '圆环', 'bs.ellipse': '椭圆', 'bs.disc': '实心圆', 'bs.moon': '月牙', 'bs.star': '星', 'bs.flake': '雪花', 'bs.flower': '雪绒花', 'bs.bloom': '水彩花',
    'bs.feather': '羽毛', 'bs.eye': '泪眼', 'bs.heart': '心', 'bs.drop': '水滴', 'bs.leaf': '叶', 'bs.bubble': '气泡', 'bs.scar': '缝痕',
    'bs.thread': '毛线', 'bs.strand': '软线', 'bs.orb': '弥散光', 'bs.beam': '斜光', 'bs.dust': '星尘', 'bs.marks': '套准线',
    'bs.torn': '撕纸', 'bs.brush': '干刷', 'bs.snow': '积雪', 'bs.invert': '反色圆', 'bs.band': '反色条',
    'bs.frost': '毛玻璃', 'bs.reed': '长虹玻璃', 'bs.mosaic': '马赛克', 'bs.blurp': '模糊', 'bs.lens': '水珠',
    // ── 选中即改 ─────────────────────────────────────────────────
    'pick.hint': '选中几个字，可以单独改它的字号、颜色、字体。',
    'pick.hintSome': '有 {n} 处单独改过。再选中它就能接着改。',
    'pick.reset': '全部恢复',
    'pick.alpha': '浓淡',
    'pick.what': '只改「{text}」',
    'pick.clear': '恢复原样',
    'pick.restBody': '下面这一排管整篇正文',
    'pick.restTitle': '下面这一排管整条标题',
    'pick.inkSame': '原色',
    'pick.inkCustom': '自己调一个颜色',
    'pick.fontSame': '字体不变',
    'pick.fontMixed': '不止一款字体',
    'pick.fontPick': '换字体',
    'pick.mixed': '不一',
    'text.source': '出处',
    'text.sourcePrefixPh': '前缀',
    'text.date': '日期',
    'text.header': '题头',
    'text.headerPh': '摘 录 / 日记 / 随笔 …',
    'text.rules': '三道线要不要',
    'text.ruleHead': '题头下', 'text.ruleTitle': '标题下', 'text.ruleFoot': '页脚',

    // ── 纸 ───────────────────────────────────────────────────────
    'paper.builtin': '内置（代码画的）',
    'paper.pack': '素材包',
    'paper.packEmpty': '素材包（还没导，按下面的「＋包」）',
    'paper.mine': '我加的',
    'paper.bright': '纸张明暗',
    'paper.groupBold': '浓色', 'paper.groupSoft': '柔色',
    'paper.packTileTitle': '{name}（{group}）',
    'paper.addTile': '＋',
    'paper.addTileTitle': '把你自己的信纸图丢进来',
    'paper.addPack': '＋包',
    'paper.addPackTitle': '导入信纸素材包（.json），导一次就常驻，所有网站通用',
    'paper.importing': '正在收纸…',
    'paper.defaultName': '我的纸{n}',
    'paper.oneFail': '这张收不进来：{name}',
    'paper.importedAll': '收了 {n} 张（已占 {mb}MB）。双击一张纸可以改名，右键删掉。',
    'paper.importedSome': '{total} 张里收进来 {n} 张（已占 {mb}MB）。双击改名，右键删掉。',
    'paper.storageFull': ' 存的东西有点多了，建议删掉些不用的。',
    'paper.packReading': '正在读素材包…',
    'paper.packInstalled': '装好了：{n} 套（横竖各一张）。以后不用再导。',
    'paper.packVolatile': '这次能用：{n} 套。但存不下来（浏览器给脚本的空间不够装这么大的包），换一页要重导。',
    'paper.packBad': '这个素材包读不了：{msg}',
    'paper.renamePrompt': '这张纸叫什么？',
    'paper.deleteConfirm': '删掉「{name}」这张纸？',
    'paper.autoInkSwapped': '这张纸太浓，黑字看不清，墨色替你换成了「{name}」——不喜欢就自己再挑。',

    // ── 字 ───────────────────────────────────────────────────────
    'font.body': '正文字体',
    'font.latin': '西文字体（只管字母和数字）',
    'font.title': '标题字体',
    'font.sameAsBody': '同正文',
    'font.noneLatin': '不指定（跟着中文字体走）',
    'font.hintMissing': '没装',
    'font.hintCustom': '自装',
    'font.hintCjk': '中文',
    'font.hintLatin': '西文',
    'font.missingTitle': '系统里没装这款字',
    'font.add': '＋ 从文件装一款字',
    'font.addTitle': '存在油猴里，所有网站通用',
    'font.tooBig': '{name} 有 {mb}MB，太大存不进油猴。请用裁过子集的版本，或直接双击装进系统。',
    'font.installFail': '装不上：{name}',
    'font.urlLoading': '正在装载 {name}…',
    'font.urlFailed': '{name} 装载失败。',
    'font.notInstalledTip': '这款字系统里没装。双击字体文件装进 Windows（装完要**完全重开浏览器**），或按下面的「＋ 从文件装」。',

    // ── 色 ───────────────────────────────────────────────────────
    'ink.body': '正文墨色',
    'ink.meta': '题头/出处/日期的颜色',
    'ink.quote': '引号里那段话的颜色',
    'ink.custom': '自己调',
    'ink.customHint': '双击改名 · 右键删',
    'ink.namePh': '起个名，比如「黄昏」',
    'ink.bright': '墨色明暗',
    'ink.followPaper': '跟着纸',
    'ink.followBody': '跟正文',
    'ink.defaultName': '自配{n}',
    'ink.saved': '存好了：「{name}」{c}。双击它可以改名，右键删掉。',
    'ink.renamePrompt': '这支墨叫什么？',
    'ink.deleteConfirm': '删掉「{name}」这支墨？',

    // ── 版 ───────────────────────────────────────────────────────
    'preset.label': '版式预设',
    'preset.namePh': '给当前这套版式起个名',
    'preset.builtinTitle': '内置排版',
    'preset.defaultName': '我的版式{n}',
    'preset.applied': '换成「{name}」了。内容没动。',
    'preset.saved': '存好了：「{name}」。双击改名，右键删掉。',
    'preset.renamePrompt': '这套版式叫什么？',
    'preset.deleteConfirm': '删掉「{name}」这套版式？',
    'layout.bodyDir': '正文排向',
    'layout.titleDir': '标题排向',
    'layout.bodyAlign': '正文对齐',
    'layout.titleAlign': '标题对齐',
    'layout.orient': '版式',
    'layout.pages': '拆成几张',
    'layout.pagesAuto': '自动',
    'layout.offset': '整块位移',
    'layout.offsetHint': '在右边预览图上直接拖',
    'layout.offsetVal': '左右 {x} · 上下 {y}',
    'layout.offsetNone': '没挪过',
    'layout.offsetReset': '归位',

    // ── 预览 / 计数 ──────────────────────────────────────────────
    'count.pages': '{n} 张　{w}×{h}　导出 {ew}×{eh}',
    'count.notesGlue': '　—— ',
    'count.notesJoin': '；',
    'count.grewNote': '这么多字放不进这么少张，整叠一起加高了',
    'count.fewerNote': '要 {want} 张，但内容只够 {got} 张',
    'count.renderFail': '画不出来：{msg}',

    // ── 存 / 复制 ────────────────────────────────────────────────
    'save.working': '正在存 {n} 张…',
    'save.fileOne': '摘录_{stamp}.jpg',
    'save.fileMulti': '摘录_{stamp}_{i}of{n}.jpg',
    'save.doneFallback': '存了 {n} 张，其中 {fb} 张进不了子目录，直接落在下载目录。',
    'save.done': '已存 {n} 张到：下载目录/{dir}',
    'copy.donePage': '已复制第 {n} 张',
    'copy.done': '已复制到剪贴板',
    'copy.denied': '这个网站不给复制权限，请用「存图」',

    // ── 登记表显示名（核心数据不动，显示时查这里；用户自造的走兜底）──
    'orient.portrait': '竖版', 'orient.landscape': '横版',
    'paper.rice': '宣纸', 'paper.cream': '米黄', 'paper.kraft': '牛皮',
    'paper.linen': '布纹', 'paper.black': '纯黑',
    'preset.p_zhai': '摘录', 'preset.p_riji': '日记', 'preset.p_xin': '信件', 'preset.p_shu': '竖排',
    'ink.black': '墨黑', 'ink.sepia': '深褐', 'ink.indigo': '靛青', 'ink.crimson': '绛红',
    'ink.pine': '松绿', 'ink.ash': '烟灰', 'ink.paper': '纸白', 'ink.moon': '月白',
    'ink.gold': '浅金', 'ink.rose': '藕荷', 'ink.jade': '霜青',
    'font.sys': '系统宋体', 'font.zhuque': '朱雀仿宋', 'font.jinghua': '京華老宋',
    'font.huiwen': '汇文明朝', 'font.jinshu': '寒蝉锦书', 'font.chillhuo': '寒蝉活宋',
    'font.duanhei': '寒蝉端黑', 'font.nanxi': '南西油墨', 'font.nano': '纳米老宋',
    'font.chaohua': '朝華標題', 'font.chaohuaB': '朝華標題B', 'font.dinglie': '鼎猎宋刻',
    'font.pixel': '像素',
    'hint.fellEng': '十七世纪活字', 'hint.fellPica': '十七世纪活字',
    'hint.elite': '打字机', 'hint.limelight': '装饰体', 'hint.uncial': '安色尔',
    'hint.smokum': '西部厚板', 'hint.beau': '花体', 'hint.jim': '哥特手写',
    'hint.tages': '手写', 'hint.coral': '像素',
  },
  'en': {
    // ── 药丸 / 面板骨架 ──────────────────────────────────────────
    'pill.clip': 'Clip',
    'app.title': 'Shiju',
    'lang.toggle': 'Switch the interface to Chinese',
    'full.on': 'Full screen', 'full.off': 'Exit full screen', 'full.show': 'Panel', 'full.hide': 'Hide panel', 'full.title': 'Fill the screen and see the whole sheet',
    'theme.auto': 'System', 'theme.day': 'Day', 'theme.night': 'Night',
    'tab.text': 'Text', 'tab.paper': 'Paper', 'tab.font': 'Type', 'tab.ink': 'Ink', 'tab.layout': 'Layout',
    'act.save': 'Save', 'act.copy': 'Copy this one', 'act.close': 'Close',
    'act.store': 'Save',

    // ── 通用小件（开关 / 字重 / 对齐 / 排向）──────────────────────
    'sw.show': 'Show', 'sw.hide': 'Hide',
    'weight.regular': 'Regular', 'weight.medium': 'Medium', 'weight.bold': 'Bold',
    'align.left': 'Left', 'align.center': 'Center', 'align.right': 'Right',
    'dir.horizontal': 'Horizontal', 'dir.vertical': 'Vertical',
    'tip.renameDelete': 'Double-click to rename · right-click to delete',
    'tip.rightDelete': 'Right-click to delete',

    // ── 文 ───────────────────────────────────────────────────────
    'text.title': 'Title',
    'text.sizeWeight': 'Size · weight',
    'text.titlePh': 'Leave empty for no title',
    'text.body': 'Body',
    // ── blind box ────────────────────────────────────────────────
    'blind.open': 'Open a blind box', 'blind.again': 'Open another',
    'blind.openTitle': 'A random poster-style layout. Your words stay as they are; do not like it, open another.',
    'blind.prev': 'Previous', 'blind.next': 'Next',
    'blind.keep': 'Save layout', 'blind.keepTitle': 'Save it as one of your layouts and reuse it on any text',
    'blind.off': 'Close the box',
    'blind.lock': 'Use my', 'blind.paper': 'paper', 'blind.font': 'font', 'blind.ink': 'ink',
   
    'blind.edit': 'Edit', 'tab.box': 'Box',
    'blind.editHint': 'Click anything on the sheet and drag it; the corner dot scales and turns it, the cross removes it. Text blocks move too.',
    'blind.undo': 'Undo', 'blind.redo': 'Redo',
    'blind.reroll': 'Re-roll only this, keep the rest',
    'blind.re_comp': 'layout', 'blind.re_pal': 'colours', 'blind.re_font': 'fonts', 'blind.re_hero': 'key phrase', 'blind.re_fx': 'effects',
    'blind.noItems': 'Nothing here yet; add your own.',
    'blind.size': 'Size', 'blind.turn': 'Turn', 'blind.thick': 'Width', 'blind.alpha': 'Alpha',
    'blind.toFront': 'Over text', 'blind.toBack': 'Under text', 'blind.reseed': 'New look', 'blind.dup': 'Duplicate', 'blind.del': 'Remove', 'blind.home': 'Reset',
    'blind.l_hero': 'Key phrase', 'blind.l_body': 'Body text', 'blind.l_meta': 'Header, source, date',
    'blind.compNo': 'This text does not fit “{name}”, so another layout was used.',
    'blind.cg': 'ground', 'blind.ci': 'ink', 'blind.ca': 'accent', 'blind.cb': 'second',
    'blind.none': 'None',
    'blind.pal_first': 'The first ones', 'bl.first': 'The first', 'bc.full': 'Justified', 'bc.stars': 'Stars', 'blind.pal_cn': 'Traditional Chinese', 'blind.pal_jp': 'Sanzo Wada and traditional Japanese', 'blind.pal_intl': 'International and modern', 'blind.tune': 'Mix one by colour theory', 'blind.tuned': 'mixed',
    'blind.s_comp': 'Layout', 'blind.s_pal': 'Colours', 'blind.s_fx': 'Effects on the text', 'blind.s_post': 'Retouch', 'blind.s_add': 'Add shapes yourself',
    'blind.q_quiet': 'Quiet', 'blind.q_image': 'Words as images', 'blind.q_loud': 'Loud', 'blind.more': 'More',
    'blind.g_line': 'Lines', 'blind.g_shape': 'Shapes', 'blind.g_light': 'Light', 'blind.g_cover': 'Covers', 'blind.g_pane': 'Glass and mosaic',
    'blind.f_line': 'plain', 'blind.f_yarn': 'yarn', 'blind.m_sweep': 'one sweep', 'blind.m_coil': 'coil', 'blind.m_tie': 'tie two words', 'blind.m_orbit': 'orbit',
    'blind.l_deco': 'Faint text',
    'act.bare': 'Transparent (PNG)', 'sw.on': 'On', 'sw.off': 'Off',
    'blind.kept': 'Saved “{name}”. Open “My layouts” above to use it on any text; double-click renames.',
    'blind.empty': 'Write something first.',
    'blind.coverNote': 'long text: page 1 is a cover, the full text follows on {n} page(s)',
    'bc.banner': 'Banner',
    'bc.column': 'Column',
    'bc.panel': 'Panel',
    'bc.chorus': 'Chorus',
    'bc.depth': 'Depth of field',
    'bc.wave': 'Wave',
    'bc.fall': 'Falling',
    'bc.water': 'Water',
    'bc.shape': 'Shape',
    'bc.board': 'Board',
    'bc.quote': 'Quote marks',
    'bc.tilt': 'Tilt',
    'bc.frame': 'Corridor',
    'bc.stretch': 'Stretch',
    'bc.recede': 'Receding',
    'bl.mist': 'Morning mist',
    'bl.afterglow': 'Afterglow',
    'bl.watercolor': 'Watercolour',
    'bl.swirl': 'Swirl',
    'bl.over': 'Overexposed',
    'bl.night': 'Night flight',
    'bl.lamp': 'Lamplight',
    'bl.darkroom': 'Darkroom',
    'bl.neon': 'Neon',
    'bl.dive': 'Dive',
    'bl.paper': 'Rice paper',
    'bl.press': 'Letterpress',
    'bl.film': 'Film',
    'bl.long': 'Long exposure',
    'bl.vanish': 'Vanishing',
    'bl.glass': 'Through glass',
    'bl.sandblast': 'Frosted',
    'bl.gradient': 'Gradient',
    'bl.pearl': 'Pearl',
    'bl.cover': 'Covered',
    'bl.signal': 'Signal',
    'bl.negative': 'Negative',
    'bl.subtitle': 'Subtitles',
    'bl.flat': 'Flat',
    'blind.s_look': 'Atmosphere', 'blind.re_look': 'atmosphere', 'blind.re_post': 'finish', 'blind.q_warm': 'Warm', 'blind.q_long': 'Long text',
    'bc.folio': 'Folio', 'bc.hung': 'Hung columns', 'bc.tiers': 'Tiers', 'bc.theme': 'Theme line', 'bc.voices': 'Two voices', 'bc.center': 'Centre line', 'bc.initial': 'Initial', 'bc.cascade': 'Cascade', 'bc.develop': 'Developing', 'bc.steps2': 'Stepped', 'bc.aside': 'Marginalia', 'bc.silence': 'Silence', 'bc.ledger': 'Ledger', 'bc.swell': 'Swell', 'bc.strophe': 'Strophes',
    'blind.mine': 'My layouts {n}', 'blind.mineUse': 'Lay out the current text this way. Double-click to rename.',
    'bc.block': 'Full block', 'bc.vblock': 'Vertical block', 'bc.pack': 'Packed', 'bc.steps': 'Dice', 'bc.rain': 'Rain', 'bc.field': 'Field',
    'bc.path': 'One stroke', 'bc.inline': 'Mid-sentence', 'bc.swiss': 'Grid', 'bc.pillar': 'Pillar', 'bc.skyline': 'Skyline', 'bc.ramp': 'Variation',
    'bc.contour': 'Contours', 'bc.overprint': 'Overprint', 'bc.cut': 'Offset cut', 'bc.shutter': 'Shutter', 'bc.melt': 'Melt', 'bc.slit': 'Slit scan', 'bc.micro': 'Words in a word',
    'bc.giant': 'Bleed', 'bc.grainy': 'Bitmap', 'bc.shift': 'Shifted rows', 'bc.half': 'Two halves', 'bc.mosaic': 'Mosaic', 'bc.turn': 'Turned title', 'bc.refrain': 'Refrain',
    'bc.underlay': 'Undertone', 'bc.stagger': 'Staggered', 'bc.canon': 'Canon', 'bc.breath': 'Breath', 'bc.fade': 'Fading', 'bc.ear': 'At the ear', 'bc.drift': 'Two voices',
    'bc.blank': 'White space', 'bc.void': 'Void', 'bc.grow': 'Growing', 'bc.cross': 'Crossing', 'bc.ma': 'Ma', 'bc.tate': 'Standing', 'bc.axis': 'Axis',
    'bc.image': 'Word as image', 'bc.youme': 'You and I',
    'bf.focus': 'soft focus', 'bf.haze': 'bleed', 'bf.glow': 'glow', 'bf.misreg': 'misregister', 'bf.slice': 'slices',
    'bf.split': 'crack', 'bf.stitch': 'stitches', 'bf.ripple': 'ripple', 'bf.burst': 'burst', 'bf.trail': 'trail',
    'bf.echo': 'ghosting', 'bf.smear': 'scan smear', 'bf.sand': 'sand', 'bf.dots': 'halftone', 'bf.wear': 'worn ink',
    'bf.scan': 'scan lines', 'bf.wash': 'gradient', 'bf.fade': 'reflection',
    'bf.bars': 'redaction', 'bf.veil': 'half hidden', 'bf.blinds': 'blinds', 'bf.disc': 'inverse disc', 'bf.torn': 'torn paper',
    'bf.brush': 'dry brush', 'bf.petals': 'fallen petals', 'bf.snow': 'settled snow',
    'bf.melt': 'melt', 'bf.cuts': 'offset cut', 'bf.dither': 'bitmap', 'bf.slit': 'slit scan', 'bf.ink': 'ink bleed', 'bf.drift': 'drift away',
    'bf.scatter': 'scattered', 'bf.motes': 'particles',
    'bp.negate': 'negative', 'bp.multiply': 'multiply', 'bp.gauss': 'gaussian blur', 'bp.defocus': 'out of focus', 'bp.swirl': 'swirl focus', 'bp.soft': 'soft light',
    'bp.halation': 'halation', 'bp.bokeh': 'bokeh', 'bp.spark': 'dark glitter', 'bp.pearl': 'pearl', 'bp.film': 'film', 'bp.retro': 'vintage',
    'bp.matte': 'sanded', 'bp.oil': 'oil paint', 'bp.pixel': 'pixels', 'bp.lowq': 'low quality', 'bp.vhs': 'videotape', 'bp.reeded': 'glass', 'bp.subtitle': 'subtitle',
    'bs.ring': 'ring', 'bs.ellipse': 'ellipse', 'bs.disc': 'disc', 'bs.moon': 'moon', 'bs.star': 'star', 'bs.flake': 'snowflake', 'bs.flower': 'edelweiss', 'bs.bloom': 'watercolour bloom',
    'bs.feather': 'feather', 'bs.eye': 'tearful eye', 'bs.heart': 'heart', 'bs.drop': 'drop', 'bs.leaf': 'leaf', 'bs.bubble': 'bubble', 'bs.scar': 'stitched scar',
    'bs.thread': 'yarn', 'bs.strand': 'soft lines', 'bs.orb': 'diffuse light', 'bs.beam': 'light beam', 'bs.dust': 'star dust', 'bs.marks': 'register marks',
    'bs.torn': 'torn paper', 'bs.brush': 'dry brush', 'bs.snow': 'settled snow', 'bs.invert': 'inverse disc', 'bs.band': 'inverse band',
    'bs.frost': 'frosted glass', 'bs.reed': 'reeded glass', 'bs.mosaic': 'mosaic', 'bs.blurp': 'blur', 'bs.lens': 'water bead',
    // ── pick: style just the selected characters ─────────────────
    'pick.hint': 'Select some characters to change just their size, colour or font.',
    'pick.hintSome': '{n} passage(s) styled separately. Select one to keep editing it.',
    'pick.reset': 'Reset all',
    'pick.alpha': 'Alpha',
    'pick.what': 'Only “{text}”',
    'pick.clear': 'Reset',
    'pick.restBody': 'The row below is for the whole body',
    'pick.restTitle': 'The row below is for the whole title',
    'pick.inkSame': 'Default',
    'pick.inkCustom': 'Pick a custom colour',
    'pick.fontSame': 'Font unchanged',
    'pick.fontMixed': 'More than one font',
    'pick.fontPick': 'Change',
    'pick.mixed': 'mixed',
    'text.source': 'Source',
    'text.sourcePrefixPh': 'Prefix',
    'text.date': 'Date',
    'text.header': 'Header',
    'text.headerPh': 'Excerpt / Diary / Notes …',
    'text.rules': 'Divider lines',
    'text.ruleHead': 'Below header', 'text.ruleTitle': 'Below title', 'text.ruleFoot': 'Footer',

    // ── 纸 ───────────────────────────────────────────────────────
    'paper.builtin': 'Built-in (drawn by code)',
    'paper.pack': 'Paper packs',
    'paper.packEmpty': 'Paper packs (none yet — use “＋Pack” below)',
    'paper.mine': 'My papers',
    'paper.bright': 'Paper brightness',
    'paper.groupBold': 'bold', 'paper.groupSoft': 'soft',
    'paper.packTileTitle': '{name} ({group})',
    'paper.addTile': '＋',
    'paper.addTileTitle': 'Drop in your own paper images',
    'paper.addPack': '＋Pack',
    'paper.addPackTitle': 'Import a paper pack (.json) — import once, it stays for every site',
    'paper.importing': 'Importing paper…',
    'paper.defaultName': 'My paper {n}',
    'paper.oneFail': 'Could not import: {name}',
    'paper.importedAll': 'Imported {n} ({mb}MB used). Double-click a paper to rename, right-click to delete.',
    'paper.importedSome': 'Imported {n} of {total} ({mb}MB used). Double-click to rename, right-click to delete.',
    'paper.storageFull': ' Storage is getting full — consider deleting some unused items.',
    'paper.packReading': 'Reading the pack…',
    'paper.packInstalled': 'Installed: {n} sets (portrait and landscape each). No need to import again.',
    'paper.packVolatile': 'Usable this time: {n} sets, but they could not be stored (the browser gives scripts too little space for a pack this big) — re-import on the next page.',
    'paper.packBad': 'Could not read this pack: {msg}',
    'paper.renamePrompt': 'Name this paper?',
    'paper.deleteConfirm': 'Delete the paper “{name}”?',
    'paper.autoInkSwapped': 'This paper is too dark for black text, so the ink was switched to “{name}” — pick another if you prefer.',

    // ── 字 ───────────────────────────────────────────────────────
    'font.body': 'Body font',
    'font.latin': 'Latin font (letters and digits only)',
    'font.title': 'Title font',
    'font.sameAsBody': 'Same as body',
    'font.noneLatin': 'None (follow the Chinese font)',
    'font.hintMissing': 'missing',
    'font.hintCustom': 'custom',
    'font.hintCjk': 'Chinese',
    'font.hintLatin': 'Latin',
    'font.missingTitle': 'This font is not installed on your system',
    'font.add': '＋ Install a font from file',
    'font.addTitle': 'Stored in the userscript manager, works on every site',
    'font.tooBig': '{name} is {mb}MB — too big to store in the userscript manager. Use a subsetted version, or double-click the file to install it system-wide.',
    'font.installFail': 'Could not install: {name}',
    'font.urlLoading': 'Loading {name}…',
    'font.urlFailed': 'Could not load {name}.',
    'font.notInstalledTip': 'This font is not installed. Double-click the font file to install it into Windows (then fully restart the browser), or use “＋ Install a font from file” below.',

    // ── 色 ───────────────────────────────────────────────────────
    'ink.body': 'Body ink',
    'ink.meta': 'Header / source / date color',
    'ink.quote': 'Quoted text color',
    'ink.custom': 'Mix your own',
    'ink.customHint': 'double-click to rename · right-click to delete',
    'ink.namePh': 'Name it, like “Dusk”',
    'ink.bright': 'Ink brightness',
    'ink.followPaper': 'Follow paper',
    'ink.followBody': 'Same as body',
    'ink.defaultName': 'Custom {n}',
    'ink.saved': 'Saved: “{name}” {c}. Double-click it to rename, right-click to delete.',
    'ink.renamePrompt': 'Name this ink?',
    'ink.deleteConfirm': 'Delete the ink “{name}”?',

    // ── 版 ───────────────────────────────────────────────────────
    'preset.label': 'Presets',
    'preset.namePh': 'Name the current setup',
    'preset.builtinTitle': 'Built-in preset',
    'preset.defaultName': 'My preset {n}',
    'preset.applied': 'Switched to “{name}”. Your content is untouched.',
    'preset.saved': 'Saved: “{name}”. Double-click to rename, right-click to delete.',
    'preset.renamePrompt': 'Name this preset?',
    'preset.deleteConfirm': 'Delete the preset “{name}”?',
    'layout.bodyDir': 'Body direction',
    'layout.titleDir': 'Title direction',
    'layout.bodyAlign': 'Body alignment',
    'layout.titleAlign': 'Title alignment',
    'layout.orient': 'Page size',
    'layout.pages': 'Split into',
    'layout.pagesAuto': 'Auto',
    'layout.offset': 'Block offset',
    'layout.offsetHint': 'drag directly on the preview',
    'layout.offsetVal': 'X {x} · Y {y}',
    'layout.offsetNone': 'Not moved',
    'layout.offsetReset': 'Reset',

    // ── 预览 / 计数 ──────────────────────────────────────────────
    'count.pages': 'Pages: {n} · {w}×{h} · exports {ew}×{eh}',
    'count.notesGlue': ' — ',
    'count.notesJoin': '; ',
    'count.grewNote': 'too much text for that few pages, the whole stack grew taller',
    'count.fewerNote': 'asked for {want} pages, but the content only fills {got}',
    'count.renderFail': 'Could not render: {msg}',

    // ── 存 / 复制 ────────────────────────────────────────────────
    'save.working': 'Saving {n} images…',
    'save.fileOne': 'excerpt_{stamp}.jpg',
    'save.fileMulti': 'excerpt_{stamp}_{i}of{n}.jpg',
    'save.doneFallback': 'Saved {n} images; {fb} could not go into the subfolder and landed straight in Downloads.',
    'save.done': 'Saved {n} images to: Downloads/{dir}',
    'copy.donePage': 'Copied page {n}',
    'copy.done': 'Copied to clipboard',
    'copy.denied': 'This site blocks clipboard access — use “Save” instead',

    // ── 登记表显示名（核心数据不动，显示时查这里；用户自造的走兜底）──
    'orient.portrait': 'Portrait', 'orient.landscape': 'Landscape',
    'paper.rice': 'Rice paper', 'paper.cream': 'Cream', 'paper.kraft': 'Kraft',
    'paper.linen': 'Linen', 'paper.black': 'Pure black',
    'preset.p_zhai': 'Excerpt', 'preset.p_riji': 'Diary', 'preset.p_xin': 'Letter', 'preset.p_shu': 'Vertical',
    'ink.black': 'Ink black', 'ink.sepia': 'Sepia', 'ink.indigo': 'Indigo', 'ink.crimson': 'Crimson',
    'ink.pine': 'Pine green', 'ink.ash': 'Ash gray', 'ink.paper': 'Paper white', 'ink.moon': 'Moon white',
    'ink.gold': 'Pale gold', 'ink.rose': 'Lotus pink', 'ink.jade': 'Frost jade',
    'font.sys': 'System Songti', 'font.zhuque': 'Zhuque Fangsong', 'font.jinghua': 'KingHwa OldSong',
    'font.huiwen': 'Huiwen Mincho', 'font.jinshu': 'ChillJinshuSong', 'font.chillhuo': 'ChillHuoSong',
    'font.duanhei': 'ChillDuanHeiSong', 'font.nanxi': 'Nanxi Youmosong', 'font.nano': 'Nano OldSong',
    'font.chaohua': 'Zhaohua Min A', 'font.chaohuaB': 'Zhaohua Min B', 'font.dinglie': 'Dinglie Songke',
    'font.pixel': 'Fusion Pixel',
    'hint.fellEng': '17th-century type', 'hint.fellPica': '17th-century type',
    'hint.elite': 'typewriter', 'hint.limelight': 'display', 'hint.uncial': 'uncial',
    'hint.smokum': 'western slab', 'hint.beau': 'script', 'hint.jim': 'blackletter',
    'hint.tages': 'handwritten', 'hint.coral': 'pixel',
  },
};

function resolveStudioLocale(v) {
  if (v === 'zh-CN' || v === 'en') return v;
  let lang = 'zh';
  try {
    lang = String((navigator.languages && navigator.languages[0]) || navigator.language || 'zh');
  } catch {}
  return lang.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
}
let studioLocale = resolveStudioLocale('auto');
function setStudioLocale(v) { studioLocale = resolveStudioLocale(v); }
// 嵌入方指定的 > 自己在面板上换过的 > 浏览器的
const hostLocale = v => v === 'zh-CN' || v === 'en';
const panelLocale = v => (hostLocale(v) ? v : cfg('uiLang'));

// 查词：当前语言 → zh-CN 兜底 → 键名本身（宁可露出键名也不静默空白）
function t(key, params) {
  let s = STUDIO_I18N[studioLocale][key];
  if (s == null) s = STUDIO_I18N['zh-CN'][key];
  if (s == null) return key;
  if (params) for (const p in params) s = s.split('{' + p + '}').join(String(params[p]));
  return s;
}

// 登记表显示名：有词条用词条，没有（用户自造的）用它存的名字
function tName(prefix, id, fallback) {
  const k = prefix + '.' + id;
  return (STUDIO_I18N[studioLocale][k] != null || STUDIO_I18N['zh-CN'][k] != null) ? t(k) : fallback;
}
// ════════════════════════════════════════════════════════════════════
//  6b. 选中即改：在内容框 / 标题框里选中几个字，只改这几个字
// ════════════════════════════════════════════════════════════════════
// 内容框仍是朴素的 textarea，没有换成 contenteditable：
// 输入法、粘贴、撤销、iOS 上 shadow DOM 里取选区，contenteditable 样样是坑。
// 样式由右边那张纸实时给你看；框里只在改过的字底下垫一道色线、给选中的字铺一层底。
const PICK_CSS = `
.ta{position:relative;background:var(--field);border-radius:4px}
.ta textarea{position:relative;display:block;background:transparent}
.ta textarea,.ta .bk{font-size:13px;line-height:1.7;letter-spacing:0;text-spacing-trim:space-all;
     text-autospace:no-autospace;white-space:pre-wrap;overflow-wrap:break-word}
.ta .bk{position:absolute;left:0;top:0;bottom:0;overflow:hidden;border:1px solid transparent;pointer-events:none}
.ta .bk div{padding:8px;color:transparent}
.ta .bk .x{background:rgba(214,158,72,.34)}
.pick[hidden],.pick [hidden],.pkhint[hidden],.pkhint [hidden]{display:none}
.pick{margin-top:6px}
.pkbox{border:1px solid var(--on-bg);border-radius:5px;padding:9px;background:var(--field)}
.pkh{display:flex;align-items:center;gap:8px;margin-bottom:7px;font-size:11px;color:var(--dim)}
.pkh b{flex:1;min-width:0;font-weight:400;color:var(--fg);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pkh button,.pkf{border:1px solid var(--line);background:var(--btn);color:var(--fg);border-radius:3px;
     font-size:11px;padding:3px 8px;cursor:pointer;flex:0 0 auto}
.pkh button:disabled{opacity:.4;cursor:default}
.pkinks{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:9px}
.pkinks button{width:20px;height:20px;border-radius:50%;border:1px solid rgba(128,128,128,.4);padding:0;cursor:pointer}
.pkinks button.same{width:auto;height:22px;border-radius:3px;border-color:var(--line);background:var(--btn);
     color:var(--fg);font-size:11px;padding:0 7px}
.pkinks button[aria-pressed=true]{outline:2px solid var(--on-bg);outline-offset:1px}
.pkinks input{width:26px;height:22px;padding:0;border:1px solid var(--line);border-radius:3px;background:var(--btn);cursor:pointer}
.pkf{display:flex;width:100%;margin-top:9px;padding:6px 9px;font-size:14px;text-align:left;align-items:baseline}
.pkf span{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pkf i{font-style:normal;font-size:10px;color:var(--dim)}
.pick .flist{margin-top:4px;max-height:216px;overflow:auto;overscroll-behavior:contain}
.pkhint{font-size:10px;color:var(--dim);margin:5px 0 0;line-height:1.5}
.pkhint button{border:0;background:transparent;color:var(--fg);font-size:10px;text-decoration:underline;cursor:pointer;padding:0 0 0 4px}
@media (max-width: 760px){
  .pkinks button{width:28px;height:28px}
  .pkinks button.same{height:30px;padding:0 10px}
  .pkinks input{width:36px;height:30px}
  .pkh button{padding:8px 11px}
  .pkf{padding:11px 9px}
}
`;

// 面板 HTML 里的那一块（摆在内容框下面；选中的是标题时会挪到标题框下面）
const pickHtml = () => `
  <div class="pick" id="pick" hidden>
    <div class="pkbox">
      <div class="pkh"><b id="pkWhat"></b><button id="pkClear">${t('pick.clear')}</button></div>
      <div class="fs">
        <input type="range" id="pkS" min="20" max="140" step="1">
        <input type="number" id="pkSn" min="12" max="300" step="1">
        <span class="sw" id="pkW">
          <button data-v="0">${t('weight.regular')}</button><button data-v="1">${t('weight.medium')}</button><button data-v="2">${t('weight.bold')}</button></span>
      </div>
      <div class="fs" style="margin-top:7px"><span class="val" style="width:auto;text-align:left">${t('pick.alpha')}</span><input type="range" id="pkA" min="5" max="100" step="1"><span class="val" id="pkAv"></span></div>
      <div class="pkinks" id="pkInk"></div>
      <button class="pkf" id="pkF"><span></span><i></i></button>
      <div class="flist" id="pkFl" hidden></div>
    </div>
    <div class="sub" id="pkRest"></div>
  </div>`;

// deps: { mask, st, draw, alive, fillFonts }
//   fillFonts(box, firstLabel, withSys) —— 列出能用的字，跟「标题字体」那一列是同一份
// 返回 { edited(which), refresh(), drop(), dispose() }
function mountPick({ mask, st, draw, alive, fillFonts }){
  const q = s => mask.querySelector(s);
  const bar = q('#pick'), fl = q('#pkFl'), ta = q('#t'), bk = q('.ta .bk'), bkIn = q('.ta .bk div');
  const FIELDS = {
    body : { el: ta,       spans: 'spans',      size: () => st.fontSize,  weight: () => st.weight,
             after: () => q('.ta'), rest: 'pick.restBody' },
    title: { el: q('#ti'), spans: 'titleSpans', size: () => titleFontSize(st), weight: () => st.titleWeight,
             after: () => q('#ti'), rest: 'pick.restTitle' },
  };
  for (const f of Object.values(FIELDS)) f.last = f.el.value;

  let cur = null;                   // { f, a, b } —— 正在改哪个框的哪一截
  const activeEl = () => mask.getRootNode().activeElement;

  // ── 垫在内容框背后的那层 ───────────────────────────────────────
  const paintBack = () => {
    const text = ta.value, n = text.length;
    const marks = spansToMarks(st.spans, n);
    const on = cur && cur.f === FIELDS.body ? cur : null;
    const picked = i => !!on && i >= on.a && i < on.b;
    bkIn.textContent = '';
    for (let i = 0; i < n;){
      let j = i + 1;
      while (j < n && sameMark(marks[i], marks[j]) && picked(i) === picked(j)) j++;
      const seg = document.createElement('span');
      seg.textContent = text.slice(i, j);
      if (marks[i]) seg.style.boxShadow = `inset 0 -2px 0 ${marks[i].ink ? inkOf(marks[i].ink) : 'rgba(199,113,12,.86)'}`;
      if (picked(i)) seg.className = 'x';
      bkIn.append(seg);
      i = j;
    }
    // 收尾垫一个字：末尾那个换行在 div 里不占行，在 textarea 里占，不垫滚到底会差一行
    bkIn.append(document.createTextNode('​'));
    fitBack();
  };
  const fitBack = () => {
    bk.style.width = (ta.clientWidth + 2) + 'px';       // 滚动条出来时 textarea 的字会变窄，跟着它
    bkIn.style.transform = `translateY(${-ta.scrollTop}px)`;
  };

  // ── 选区 ───────────────────────────────────────────────────────
  const read = f => {
    if (!alive() || activeEl() !== f.el) return;        // 焦点在别处（比如正调字号）时，选区原样留着
    const a = f.el.selectionStart, b = f.el.selectionEnd;
    if (a === b){ if (cur) { cur = null; refresh(); } return; }
    if (cur && cur.f === f && cur.a === a && cur.b === b) return;
    cur = { f, a, b }; fl.hidden = true;
    refresh();
  };
  const later = f => () => setTimeout(() => read(f), 0);
  for (const f of Object.values(FIELDS))
    for (const ev of ['select', 'keyup', 'mouseup', 'touchend', 'focus']) f.el.addEventListener(ev, later(f));
  // 拖选拖出框外才松手的，上面那些一个都收不到；手机上拖选区手柄也只有它
  const onSel = () => { for (const f of Object.values(FIELDS)) read(f); };
  document.addEventListener('selectionchange', onSel);
  const drop = () => {
    if (!cur) return false;
    const { f, b } = cur;
    cur = null;
    try { f.el.setSelectionRange(b, b); } catch {}
    refresh();
    return true;
  };
  // 按小条上的按钮别抢走焦点 —— 框里的选区才会一直亮着
  bar.addEventListener('mousedown', e => { if (!e.target.closest('input')) e.preventDefault(); });

  ta.addEventListener('scroll', fitBack);
  let ro = null;
  try { ro = new ResizeObserver(fitBack); ro.observe(ta); } catch {}

  // ── 改 ─────────────────────────────────────────────────────────
  const put = patch => {
    if (!cur) return;
    st[cur.f.spans] = paintSpans(st[cur.f.spans], cur.f.el.value.length, cur.a, cur.b, patch);
    remember(cur.f);
    refresh(); draw();
  };

  // 撤销/重做回到某一版文字时，把那一版的样式也请回来（textarea 的撤销只管字）
  for (const f of Object.values(FIELDS)) f.past = new Map();
  const remember = f => {
    f.past.delete(f.el.value);
    f.past.set(f.el.value, st[f.spans]);
    if (f.past.size > 300) f.past.delete(f.past.keys().next().value);
  };
  const edited = (which, e) => {
    const f = FIELDS[which], now = f.el.value;
    if (now === f.last) return;
    const back = e && /^history/.test(e.inputType || '') ? f.past.get(now) : null;
    st[f.spans] = back || shiftSpans(st[f.spans], f.last, now, f.el.selectionEnd);
    f.last = now;
    remember(f);
    cur = null;
    refresh();
    read(f);                                            // 撤销之后浏览器可能留着选区
  };
  for (const f of Object.values(FIELDS)) remember(f);

  // ── 小条 ───────────────────────────────────────────────────────
  const setSize = v => {
    const n = Math.max(12, Math.min(300, Math.round(+v)));
    if (n) put({ size: n });
  };
  q('#pkS').oninput  = e => setSize(e.target.value);
  // 数字框边打边生效，但别把人正在敲的半截数字改写掉（想敲 80，先敲到 8）
  q('#pkSn').oninput = e => { if (+e.target.value >= 12) setSize(e.target.value); };
  q('#pkSn').onchange = e => { if (e.target.value !== '') setSize(e.target.value); refresh(); };
  q('#pkA').oninput = e => put({ alpha: +e.target.value >= 100 ? null : +e.target.value / 100 });
  q('#pkW').onclick = e => { const b = e.target.closest('button'); if (b) put({ weight: +b.dataset.v }); };
  q('#pkClear').onclick = () => put({ size: null, font: null, ink: null, weight: null, alpha: null });
  q('#pkInk').onclick = e => {
    const b = e.target.closest('button'); if (b) put({ ink: b.dataset.v || null });
  };
  q('#pkF').onclick = () => {
    if (fl.hidden){ fillFonts(fl, t('pick.fontSame'), true); markFont(); }
    fl.hidden = !fl.hidden;
  };
  fl.onclick = e => {
    const b = e.target.closest('button'); if (!b || !b.dataset.v) return;
    put({ font: b.dataset.v === 'same' ? null : b.dataset.v });
  };
  const fontLabel = id => {
    const f = FONTS.find(x => x.id === id); if (f) return tName('font', f.id, f.name);
    const m = myFontList().find(x => x.id === id); if (m) return m.name;
    const l = LATIN.find(x => x.id === id); return l ? l.name : id;
  };
  let now = { mixed: {} };
  const markFont = () => fl.querySelectorAll('button').forEach(b =>
    b.setAttribute('aria-pressed', !now.mixed.font && b.dataset.v === (now.font || 'same')));

  function buildInks(){
    const box = q('#pkInk'); box.textContent = '';
    const same = document.createElement('button');
    same.className = 'same'; same.dataset.v = ''; same.textContent = t('pick.inkSame');
    box.append(same);
    for (const i of allInks()){
      const b = document.createElement('button');
      b.dataset.v = i.id; b.style.background = i.c;
      b.title = tName('ink', i.id, i.name); b.setAttribute('aria-label', b.title);
      box.append(b);
    }
    const c = document.createElement('input');
    c.type = 'color'; c.title = t('pick.inkCustom');
    c.oninput = e => put({ ink: e.target.value });
    box.append(c);
  }

  let inkStamp = '';
  function refresh(){
    if (!alive()) return;
    paintBack();
    const n = [...spansOf('body'), ...spansOf('title')].length;
    q('#pkHint').firstChild.textContent = n ? t('pick.hintSome', { n }) : t('pick.hint');
    q('#pkReset').hidden = !n;
    bar.hidden = !cur; q('#pkHint').hidden = !!cur;
    if (!cur){ fl.hidden = true; return; }

    const { f, a, b } = cur, text = f.el.value;
    if (bar.previousElementSibling !== f.after()) f.after().after(bar);
    now = spanCommon(st[f.spans], text.length, a, b);
    const what = text.slice(a, b).replace(/\s+/g, ' ');
    q('#pkWhat').textContent = t('pick.what', { text: what });
    q('#pkWhat').title = what;
    q('#pkRest').textContent = t(f.rest);
    q('#pkClear').disabled = !now.any;

    const size = now.mixed.size ? null : (now.size || f.size());
    q('#pkS').value = Math.max(20, Math.min(140, size || f.size()));
    if (activeEl() !== q('#pkSn')) q('#pkSn').value = size == null ? '' : size;
    q('#pkSn').placeholder = t('pick.mixed');
    const w = now.mixed.weight ? null : (now.weight === undefined ? (f.weight() || 0) : now.weight);
    q('#pkW').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x.dataset.v === String(w)));

    const al = now.mixed.alpha ? null : Math.round((now.alpha === undefined ? 1 : now.alpha) * 100);
    q('#pkA').value = al == null ? 100 : al; q('#pkAv').textContent = al == null ? t('pick.mixed') : al + '%';

    const stamp = allInks().map(i => i.id + i.c + i.name).join();
    if (stamp !== inkStamp){ inkStamp = stamp; buildInks(); }
    const ink = now.mixed.ink ? null : (now.ink || '');
    q('#pkInk').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x.dataset.v === ink));
    const ck = q('#pkInk input');
    if (ink && activeEl() !== ck) ck.value = /^#[0-9a-f]{6}$/i.test(ink) ? ink : inkOf(ink);

    const fs = q('#pkF').firstChild;
    fs.textContent = now.mixed.font ? t('pick.fontMixed') : now.font ? fontLabel(now.font) : t('pick.fontSame');
    fs.style.fontFamily = now.font && !now.mixed.font ? pickStack(now.font, st, 'inherit') : '';
    q('#pkF').lastChild.textContent = t('pick.fontPick');
    markFont();
  }
  const spansOf = which => {
    const f = FIELDS[which];
    return marksToSpans(spansToMarks(st[f.spans], f.el.value.length));
  };
  q('#pkReset').onclick = () => {
    for (const f of Object.values(FIELDS)){ st[f.spans] = []; remember(f); }
    refresh(); draw();
  };

  return { edited, refresh, drop,
           dispose(){ document.removeEventListener('selectionchange', onSel); if (ro) ro.disconnect(); } };
}

// ════════════════════════════════════════════════════════════════════
//  6c. 版式盲盒的界面：按钮条（常驻在预览上方）＋「盒」那一屏（接着改）＋ 纸上直接拖
// ════════════════════════════════════════════════════════════════════
const BLIND_CSS = `
.bbar{display:flex;flex-wrap:wrap;gap:6px;align-items:center;flex:0 0 auto}
.bbar [hidden],.tabs [hidden],.bx [hidden]{display:none!important}
.bbar button{border:1px solid var(--line);background:var(--btn);color:var(--fg);border-radius:999px;
     font-size:12px;padding:6px 13px;cursor:pointer;letter-spacing:.06em}
.bbar button.go{background:var(--on-bg);color:var(--on-fg);border-color:var(--on-bg);padding:7px 18px;letter-spacing:.14em}
.bbar button.ic{padding:6px 11px}
.bbar button:disabled,.bx button:disabled{opacity:.35;cursor:default}
.bbar .kept{flex:1 1 100%;display:flex;flex-wrap:wrap;gap:5px;max-height:92px;overflow:auto}
.bbar .kept span{display:inline-flex;align-items:stretch;border:1px solid var(--line);border-radius:999px;overflow:hidden;background:var(--btn)}
.bbar .kept button{border:0;border-radius:0;padding:4px 4px 4px 11px;font-size:11px}
.bbar .kept button+button{padding:4px 9px 4px 5px;color:var(--dim)}
.bbar .nm{;color:var(--fg);letter-spacing:.06em;margin:0 4px;min-width:0}
.bx .acc{border-top:1px solid var(--line);margin-top:0}
.bx .acc:first-of-type{margin-top:12px}
.bx .acc:last-of-type{border-bottom:1px solid var(--line)}
.bx summary{cursor:pointer;list-style:none;padding:10px 2px;font-size:12px;color:var(--fg);letter-spacing:.06em;display:flex;gap:8px;align-items:baseline}
.bx summary::-webkit-details-marker{display:none}
.bx summary::after{content:'+';margin-left:auto;color:var(--dim)}
.bx .acc[open] summary::after{content:'–'}
.bx summary em{font-style:normal;font-size:11px;color:var(--dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.bx .accin{padding:0 0 12px}
.bx .chips{display:flex;flex-wrap:wrap;gap:4px}
.bx .chips button{border:1px solid var(--line);background:var(--btn);color:var(--fg);border-radius:999px;font-size:11px;padding:3px 9px;cursor:pointer}
.bx .chips button[aria-pressed=true]{background:var(--on-bg);color:var(--on-fg);border-color:var(--on-bg)}
.bx .chips button.re::before{content:"↻ ";color:var(--dim)}
.bx .pals{display:grid;grid-template-columns:repeat(8,1fr);gap:4px}
.bx .pals button{height:24px;padding:0;border:1px solid var(--line);border-radius:4px;cursor:pointer;overflow:hidden;display:flex}
.bx .pals button[aria-pressed=true]{outline:2px solid var(--on-bg);outline-offset:1px}
.bx .pals i{flex:1;height:100%}
.bx .four{display:flex;gap:10px;margin-top:7px;font-size:11px;color:var(--dim)}
.bx .four span{display:flex;gap:4px;align-items:center}
.bx input[type=color]{width:26px;height:22px;padding:0;border:1px solid var(--line);border-radius:3px;background:var(--btn);cursor:pointer}
.bx .one{border:1px solid var(--on-bg);border-radius:5px;padding:9px;background:var(--field);margin-top:7px}
.bx .one .fs{margin-top:5px;font-size:11px;color:var(--dim)}
.bx .one .fs span{flex:0 0 34px}
.bx .dots{display:flex;gap:6px;align-items:center;margin-top:7px}
.bx .dots button{width:20px;height:20px;border-radius:50%;border:1px solid rgba(128,128,128,.4);padding:0;cursor:pointer}
.bx .dots button[aria-pressed=true]{outline:2px solid var(--on-bg);outline-offset:1px}
.bx .two{display:flex;gap:5px}
.bx .two button{flex:1;border:1px solid var(--line);background:var(--btn);color:var(--fg);border-radius:4px;font-size:12px;padding:6px 4px;cursor:pointer}
.bov{position:absolute;inset:0;outline:none}
.bsel{position:absolute;border:1.5px dashed #fff;box-shadow:0 0 0 1.5px rgba(185,32,11,.8);pointer-events:none;border-radius:3px}
.bsel i,.bsel u{position:absolute;pointer-events:auto;width:18px;height:18px;border-radius:50%;background:#fff;border:1px solid rgba(185,32,11,.85);
     box-shadow:0 1px 4px rgba(0,0,0,.25);touch-action:none;font:12px/16px sans-serif;text-align:center;text-decoration:none;color:#b9200b}
.bsel i{right:-9px;bottom:-9px;cursor:nwse-resize}
.bsel u{right:-9px;top:-9px;cursor:pointer}
@media (pointer: coarse){ .bov{pointer-events:none} .mask.bedit .bov{pointer-events:auto;touch-action:none} .bsel i,.bsel u{width:26px;height:26px;line-height:24px} }
@media (max-width: 760px){
  .bbar{gap:4px}
  .bbar button{padding:9px 9px;letter-spacing:0}
  .bbar button.go{padding:10px 14px;letter-spacing:.06em}
  .bbar .nm{flex:1 1 100%;order:5}
  .mask.blind .view{max-height:62%}
  .bx .chips button{padding:8px 12px;font-size:12px}
  .bx .pals button{height:32px}
}
`;
const blindHtml = () => `
  <div class="bbar" id="bbar">
    <button class="go" id="bGo" title="${t('blind.openTitle')}">${t('blind.open')}</button>
    <button class="ic" id="bPrev" title="${t('blind.prev')}" aria-label="${t('blind.prev')}" hidden>‹</button>
    <button class="ic" id="bNext" title="${t('blind.next')}" aria-label="${t('blind.next')}" hidden>›</button>
    <button id="bEdit" hidden>${t('blind.edit')}</button>
    <button id="bKeep" title="${t('blind.keepTitle')}" hidden>${t('blind.keep')}</button>
    <button id="bOff" hidden>${t('blind.off')}</button>
    <button id="bMine" aria-expanded="false" hidden></button>
    <span class="nm" id="bName" hidden></span>
    <div class="kept" id="bKept" hidden></div>
  </div>`;
// 方案分三堆：低声的、意象、响亮的
const B_COMP_GROUPS = () => [['quiet', BLIND_COMPS.filter(c => c.q && c.id !== 'image' && c.id !== 'youme')], ['warm', BLIND_MORE], ['long', BLIND_LONG], ['image', BLIND_COMPS.filter(c => c.id === 'image' || c.id === 'youme')], ['loud', BLIND_COMPS.filter(c => !c.q && !c.long && !BLIND_MORE.includes(c))]];
const bAcc = (k, inner) => `<details class="acc" data-k="${k}"><summary>${t('blind.s_' + k)}<em id="bNow_${k}"></em></summary><div class="accin">${inner}</div></details>`;
const blindPaneHtml = () => `
  <div class="pane bx" data-p="box">
    <div class="two"><button id="bUndo">${t('blind.undo')}</button><button id="bRedo">${t('blind.redo')}</button></div>
    <div class="sub">${t('blind.reroll')}</div><div class="chips" id="bRe"></div>
    <div class="one" id="bOne" hidden>
      <div class="pkh"><b id="bOneName"></b><button id="bOneDel">${t('blind.del')}</button></div>
      <div id="bSwapBox"><div class="chips" id="bSwap"></div></div>
      <div id="bLineBox"><div class="chips" id="bFeel"></div><div class="chips" id="bMode" style="margin-top:4px"></div></div>
      <div class="dots" id="bDots"></div>
      <div class="fs" data-k="r"><span>${t('blind.size')}</span><input type="range" min="2" max="100" step="1"></div>
      <div class="fs" data-k="a"><span>${t('blind.alpha')}</span><input type="range" min="5" max="100" step="1"></div>
      <div class="fs" data-k="rot"><span>${t('blind.turn')}</span><input type="range" min="-180" max="180" step="1"></div>
      <div class="fs" data-k="t"><span>${t('blind.thick')}</span><input type="range" min="1" max="100" step="1"></div>
      <div class="two" style="margin-top:8px"><button id="bFront"></button><button id="bReseed">${t('blind.reseed')}</button><button id="bDup">${t('blind.dup')}</button></div>
    </div>
    <p class="pkhint" id="bTip">${t('blind.editHint')}</p>
    ${bAcc('comp', '<div id="bComp"></div>')}
    ${bAcc('look', '<div class="chips" id="bLook"></div>')}
    ${bAcc('pal', `<div class="two"><button id="bTune">${t('blind.tune')}</button></div>
      <div class="four" id="bFour">${['g', 'i', 'a', 'b'].map(k => `<span><input type="color" data-k="${k}">${t('blind.c' + k)}</span>`).join('')}</div>
      <div id="bPals"></div>
      <div class="sub">${t('blind.lock')}</div><div class="chips" id="bLock"><button data-k="paper">${t('blind.paper')}</button><button data-k="font">${t('blind.font')}</button><button data-k="ink">${t('blind.ink')}</button></div>`)}
    ${bAcc('fx', `<div class="chips" id="bFx"></div><div class="sub">${t('blind.more')}</div><div class="chips" id="bFx2"></div>`)}
    ${bAcc('post', '<div class="chips" id="bPost"></div>')}
    ${bAcc('add', `<div class="chips" id="bItems"></div><div id="bAdd"></div>`)}
  </div>`;

function mountBlind({ resume, mask, st, draw, repaint, sync, alive, tip, keep, kept, openTab }){
  const q = s => mask.querySelector(s);
  // 一个盒子 ＝ 它自己的一串改动；盒子之间前后翻，盒子里头一步一步撤
  const boxes = resume ? resume.boxes : []; let at = resume ? resume.at : -1, plan = null, sel = null, name = '', short = '', label = '', lookNow = '';
  const box = () => boxes[at];
  const texts = () => ({ text: q('#t').value, title: q('#ti').value });
  const apply = () => { sync(); draw(); };
  let lastTag = '', lastAt = 0;
  // 记一步。tag 相同、又挨得很近的（拖滑块）只算一步
  const set = (patch, tag) => {
    st.blind = { ...st.blind, ...patch };
    if (!box()){ boxes.push({ hist: [st.blind], i: 0 }); at = boxes.length - 1; }
    else {
      const b = box(), now = Date.now();
      if (tag && tag === lastTag && now - lastAt < 900 && b.i > 0){ b.hist.length = b.i + 1; b.hist[b.i] = st.blind; }
      else { b.hist.length = b.i + 1; b.hist.push(st.blind); b.i++; }
      lastTag = tag || ''; lastAt = now;
    }
  };
  const go = (patch, tag) => { set(patch, tag); apply(); };

  q('#bGo').onclick = () => {
    if (!(q('#t').value.trim() || q('#ti').value.trim())){ tip(t('blind.empty')); return; }
    // 连着两次同一种方案就没意思了，多掷几颗挑一颗不一样的
    // 每拆一个都是全新的：上一个盒子里换的纸、挑的字，留在上一个盒子里
    const base = {};
    let seed = blindSeed();
    for (let i = 0; i < 6 && label; i++){
      const p = planPages({ ...st, ...texts(), blind: { ...base, seed } });
      if (!p.blind || (p.blind.comp !== label && p.blind.look.id !== lookNow)) break;
      seed = blindSeed();
    }
    st.blind = { ...base, seed }; sel = null;
    boxes.push({ hist: [st.blind], i: 0 }); at = boxes.length - 1; lastTag = '';
    apply();
  };
  const jump = n => { at = n; st.blind = box().hist[box().i]; sel = null; apply(); };
  q('#bPrev').onclick = () => { if (at > 0) jump(at - 1); };
  q('#bNext').onclick = () => { if (at < boxes.length - 1) jump(at + 1); };
  q('#bUndo').onclick = () => { const b = box(); if (b && b.i > 0){ b.i--; st.blind = b.hist[b.i]; lastTag = ''; apply(); } };
  q('#bRedo').onclick = () => { const b = box(); if (b && b.i < b.hist.length - 1){ b.i++; st.blind = b.hist[b.i]; lastTag = ''; apply(); } };
  q('#bOff').onclick = () => { st.blind = null; sel = null; apply(); };
  q('#bEdit').onclick = () => openTab('box');
  // 常用版式：收下的时候把颜色也定死，以后换一段字、换一个版本，都还是它
  let open = !!(resume && resume.open);
  q('#bKeep').onclick = () => { if (!plan || !plan.blind) return; const n = short.slice(0, 24); keep(n, { ...st.blind, pal: { ...plan.blind.pal } }); open = true; fillKept(); tip(t('blind.kept', { name: n })); };
  function fillKept(){
    const list = kept.list(), box = q('#bKept'); box.textContent = ''; q('#bMine').hidden = !list.length; box.hidden = !list.length || !open;
    q('#bMine').textContent = t('blind.mine', { n: list.length }); q('#bMine').setAttribute('aria-expanded', open && !!list.length);
    for (const p of list){
      const s = document.createElement('span'), b = document.createElement('button'), x = document.createElement('button');
      b.textContent = p.name; b.title = t('blind.mineUse'); x.textContent = '×'; x.title = t('blind.del'); x.setAttribute('aria-label', t('blind.del')); s.append(b, x); box.append(s);
      b.onclick = () => { const { text, title } = texts(); if (!(text.trim() || title.trim())){ tip(t('blind.empty')); return; } st.blind = blindFor({ ...p.style.blind }, text, title); sel = null; boxes.push({ hist: [st.blind], i: 0 }); at = boxes.length - 1; lastTag = ''; apply(); if (plan && plan.blind && p.style.blind.comp && plan.blind.comp !== p.style.blind.comp) tip(t('blind.compNo', { name: t('bc.' + p.style.blind.comp) })); };
      b.ondblclick = () => { const v = prompt(t('preset.renamePrompt'), p.name); if (v === null) return; kept.rename(p.id, v.trim().slice(0, 24) || p.name); fillKept(); };
      x.onclick = () => { if (!confirm(t('preset.deleteConfirm', { name: p.name }))) return; kept.remove(p.id); fillKept(); };
    }
  }
  q('#bMine').onclick = () => { open = !open; fillKept(); };

  // ── 单换一样 ────────────────────────────────────────────────────
  for (const k of ['comp', 'look', 'pal', 'font', 'hero', 'fx', 'post']){
    const b = document.createElement('button'); b.className = 're'; b.dataset.k = k; b.textContent = t('blind.re_' + k); q('#bRe').append(b);
  }
  q('#bRe').onclick = e => {
    const b = e.target.closest('button'); if (!b || !st.blind) return;
    const k = b.dataset.k, patch = { seeds: { ...(st.blind.seeds || {}), [k]: blindSeed() } };
    // 重掷某一样，就把人在这一样上定死的放开
    if (k === 'comp') Object.assign(patch, { comp: undefined, move: undefined });
    if (k === 'hero') Object.assign(patch, { move: undefined, hero: undefined, word: undefined });
    if (k === 'pal') Object.assign(patch, { pal: undefined, own: { ...(st.blind.own || {}), paper: false, ink: false } });
    if (k === 'font') patch.own = { ...(st.blind.own || {}), font: false };
    if (k === 'look') Object.assign(patch, { look: undefined, fx: undefined, post: undefined });
    if (k === 'fx') patch.fx = undefined;
    if (k === 'post') patch.post = undefined;
    go(patch);
  };

  // ── 画面上的东西 ────────────────────────────────────────────────
  const items = () => plan.blind.B.items;
  const setItem = (i, patch, tag) => go({ items: items().map((it, k) => (k === i ? { ...it, ...patch } : it)) }, tag);
  const addItem = it => { sel = { kind: 'item', i: items().length }; go({ items: items().concat(it) }); };
  const chip = (box, v, text, on) => { const b = document.createElement('button'); b.dataset.v = v; b.textContent = text; if (on !== undefined) b.setAttribute('aria-pressed', on); box.append(b); return b; };
  const allShapes = Object.values(B_SHAPES).flat();
  for (const [g, ids] of [['line', B_SHAPES.line], ['shape', B_SHAPES.shape], ['light', B_SHAPES.light], ['cover', B_SHAPES.cover], ['pane', B_SHAPES.pane]]){ const h = document.createElement('div'); h.className = 'sub'; h.textContent = t('blind.g_' + g); const r = document.createElement('div'); r.className = 'chips'; for (const id of ids) chip(r, id, t('bs.' + id)); q('#bAdd').append(h, r); }
  q('#bAdd').onclick = e => { const b = e.target.closest('button'); if (b && plan && plan.blind) addItem(blindNewItem(b.dataset.v, blindSeed(), plan.blind.pal, plan.W, plan.H)); };
  q('#bItems').onclick = e => { const b = e.target.closest('button'); if (!b) return; sel = { kind: 'item', i: +b.dataset.v }; refreshOne(); overlay(); };
  q('#bSwap').onclick = e => {
    const b = e.target.closest('button'); if (!b || !sel) return;
    // 换形状：位置、大小、角度、颜色都留着，只换它是什么
    const it = items()[sel.i], id = b.dataset.v, fresh = blindNewItem(id, it.seed, plan.blind.pal, plan.W, plan.H);
    const big = B_FIELD.includes(id) || id === 'thread' || B_FIELD.includes(it.id) || it.id === 'thread';
    setItem(sel.i, { ...fresh, ...(big ? {} : { x: it.x, y: it.y, r: it.r, rot: it.rot }), c: id === 'thread' || it.id === 'thread' ? fresh.c : it.c, front: fresh.front || it.front, id });
  };
  q('#bOneDel').onclick = () => {
    if (!sel) return;
    if (sel.kind === 'layer'){ const move = { ...(st.blind.move || {}) }; delete move[sel.i]; go({ move }); return; }
    const i = sel.i; sel = null; go({ items: items().filter((_, k) => k !== i) });
  };
  q('#bFront').onclick = () => { if (sel && sel.kind === 'item') setItem(sel.i, { front: !items()[sel.i].front }); };
  q('#bReseed').onclick = () => { if (sel && sel.kind === 'item') setItem(sel.i, { seed: blindSeed() }); };
  q('#bDup').onclick = () => { if (sel && sel.kind === 'item'){ const it = items()[sel.i]; addItem({ ...it, seed: blindSeed(), x: it.x + plan.W * .06, y: it.y + plan.H * .05 }); } };
  q('#bDots').onclick = e => { const b = e.target.closest('button'); if (!b || !sel) return; if (sel.kind === 'item') setItem(sel.i, { c: b.dataset.v }); else moveLayer(sel.i, { c: b.dataset.v }); };
  q('#bFeel').onclick = e => { const b = e.target.closest('button'); if (b && sel) setItem(sel.i, { feel: b.dataset.v, ...(b.dataset.v === 'yarn' ? { t: Math.max(6, items()[sel.i].t || 6) } : {}) }); };
  q('#bMode').onclick = e => { const b = e.target.closest('button'); if (b && sel) setItem(sel.i, { mode: b.dataset.v }); };
  // 滑块的刻度：大小走平方（小的地方调得细）
  const maxR = () => plan.W, toR = v => Math.max(5, Math.pow(v / 100, 2) * maxR()), fromR = r => Math.sqrt(r / maxR()) * 100;
  const maxT = it => it.id === 'thread' ? 26 : 700;
  mask.querySelectorAll('#bOne .fs input').forEach(inp => inp.oninput = () => {
    if (!sel) return;
    const k = inp.parentElement.dataset.k, v = +inp.value;
    if (sel.kind === 'layer'){ if (k === 'r') moveLayer(sel.i, { k: Math.pow(2, (v - 50) / 25) }, 'lk' + sel.i); if (k === 'a') moveLayer(sel.i, { a: v / 100 }, 'la' + sel.i); return; }
    const it = items()[sel.i];
    setItem(sel.i, k === 'r' ? { r: toR(v) } : k === 'rot' ? { rot: v * Math.PI / 180 } : k === 'a' ? { a: v / 100 } : { t: Math.max(1, v / 100 * maxT(it)) }, k + sel.i);
  });
  const moveLayer = (i, patch, tag) => go({ move: { ...(st.blind.move || {}), [i]: { ...((st.blind.move || {})[i] || {}), ...patch } } }, tag);

  // ── 构图 / 配色 / 用我的 / 效果 / 修图 ──────────────────────────
  for (const [g, cs] of B_COMP_GROUPS()){ const h = document.createElement('div'); h.className = 'sub'; h.textContent = t('blind.q_' + g); const r = document.createElement('div'); r.className = 'chips'; for (const c of cs) chip(r, c.id, t('bc.' + c.id)); q('#bComp').append(h, r); }
  // 一次只摊开一栏
  mask.querySelectorAll('.acc').forEach(d => d.addEventListener('toggle', () => { if (d.open) mask.querySelectorAll('.acc').forEach(o => { if (o !== d) o.open = false; }); }));
  q('#bComp').onclick = e => {
    const b = e.target.closest('button'); if (!b || !st.blind) return;
    const was = st.blind; set({ comp: b.dataset.v, move: undefined, seeds: { ...(was.seeds || {}), comp: blindSeed() } });
    apply();
    if (plan && plan.blind && plan.blind.comp !== b.dataset.v) tip(t('blind.compNo', { name: t('bc.' + b.dataset.v) }));
  };
  for (const k of BLIND_LOOKS) chip(q('#bLook'), k.id, t('bl.' + k.id));
  q('#bLook').onclick = e => { const b = e.target.closest('button'); if (b && st.blind){ const s = { ...(st.blind.seeds || {}) }; for (const k of ['look', 'fx', 'post']) s[k] = blindSeed(); go({ look: b.dataset.v, fx: undefined, post: undefined, seeds: s }); } };      // 点第二下：同一种气氛，换一张底
  for (const src of ['first', 'cn', 'jp', 'intl']){
    const h = document.createElement('div'); h.className = 'sub'; h.textContent = t('blind.pal_' + src); const r = document.createElement('div'); r.className = 'pals'; q('#bPals').append(h, r);
    for (const p of B_PALETTES.filter(p => p.src === src)){ const b = chip(r, p.id, ''); b.title = p.name; for (const k of ['g', 'i', 'a', 'b']){ const i = document.createElement('i'); i.style.background = p[k]; if (k === 'g') i.style.flex = '2'; b.append(i); } }
  }
  q('#bPals').onclick = e => { const b = e.target.closest('button'); if (b && st.blind) go({ pal: { ...B_PALETTES.find(p => p.id === b.dataset.v) } }); };
  q('#bTune').onclick = () => { if (st.blind) go({ pal: bTune(bRng(blindSeed()).rnd) }); };
  mask.querySelectorAll('#bFour input').forEach(inp => inp.oninput = () => {
    if (!plan || !plan.blind) return;
    const { g, i, a, b, paper, light } = plan.blind.pal, pal = { id: 'mine', g, i, a, b, paper, light, [inp.dataset.k]: inp.value };
    if (inp.dataset.k === 'g'){ pal.paper = undefined; pal.light = undefined; }      // 换了底色，就不再铺那张纸
    go({ pal }, 'pal' + inp.dataset.k);
  });
  q('#bLock').onclick = e => {
    const b = e.target.closest('button'); if (!b || !st.blind) return;
    const own = { ...(st.blind.own || {}) }; own[b.dataset.k] = !own[b.dataset.k];
    go({ own, ...(b.dataset.k !== 'font' ? { pal: undefined } : {}) });
  };
  chip(q('#bFx'), '', t('blind.none')); for (const f of B_FX_MAIN) chip(q('#bFx'), f, t('bf.' + f));
  for (const f of B_FX_ORDER) if (!B_FX_MAIN.includes(f)) chip(q('#bFx2'), f, t('bf.' + f));
  chip(q('#bPost'), '', t('blind.none')); for (const p of B_POST_MAIN.concat(B_POST_ORDER.filter(p => !B_POST_MAIN.includes(p)))) chip(q('#bPost'), p, t('bp.' + p));
  const toggles = (sel, key, cur) => q(sel).onclick = e => {
    const b = e.target.closest('button'); if (!b || !plan || !plan.blind) return;
    const v = b.dataset.v, now = cur(); go({ [key]: !v ? [] : now.includes(v) ? now.filter(x => x !== v) : now.concat(v).slice(-4) });
  };
  toggles('#bFx', 'fx', () => plan.blind.name.fx); toggles('#bFx2', 'fx', () => plan.blind.name.fx); toggles('#bPost', 'post', () => plan.blind.B.post);

  // ── 纸上直接动手 ────────────────────────────────────────────────
  const near = (it, px, py) => {
    if (it.id === 'thread'){ const pts = bThreadPath(it, plan.blind.B), d = (it.t || 6) + 14; return pts.some(([x, y], i) => i % 3 === 0 && Math.abs(x - px) < d && Math.abs(y - py) < d); }
    if (B_FIELD.includes(it.id)) return false;
    const c = Math.cos(-(it.rot || 0)), s = Math.sin(-(it.rot || 0)), dx = px - it.x, dy = py - it.y, lx = dx * c - dy * s, ly = dx * s + dy * c;
    const b = blindItemBox({ ...it, rot: 0 }), hx = Math.max(16, b.w / 2), hy = Math.max(16, b.h / 2), k = it.id === 'orb' ? .55 : 1;
    if (it.id === 'ring' || it.id === 'ellipse'){ const d = Math.hypot(lx / hx, ly / hy); return d > .78 && d < 1.16 || (hx < 60 && d < 1); }      // 环只认那一圈，圈里的字还点得着
    return Math.abs(lx) < hx * k && Math.abs(ly) < hy * k;
  };
  const hit = (px, py) => {
    const B = plan.blind.B, its = B.items.map((it, i) => ({ it, i })).reverse();
    const front = its.find(o => (o.it.front || o.it.id === 'thread') && near(o.it, px, py)); if (front) return { kind: 'item', i: front.i };
    const small = its.find(o => !o.it.front && o.it.id !== 'orb' && near(o.it, px, py)); 
    const ls = B.layers.map((l, i) => ({ l, i })).filter(o => ['hero', 'body', 'meta', 'deco'].includes(o.l.role) && !o.l.twin).sort((a, b) => (a.l.role === 'deco') - (b.l.role === 'deco') || b.i - a.i);
    const lay = ls.find(({ l }) => l.ops.some(op => { const r = 'glv'.includes(op.k) && blindTurn(blindOpRect(B, op), l.rot); return r && px > r.x - 4 && px < r.x + r.w + 4 && py > r.y - 4 && py < r.y + r.h + 4; }));
    if (small && (!lay || blindItemBox(small.it).w < 260)) return { kind: 'item', i: small.i };
    if (lay) return { kind: 'layer', i: lay.i };
    const orb = its.find(o => near(o.it, px, py)); return orb ? { kind: 'item', i: orb.i } : null;
  };
  let ov = null, selEl = null;
  const selRect = () => {
    if (!sel || !plan || !plan.blind) return null;
    if (sel.kind === 'layer'){ const l = plan.blind.B.layers[sel.i]; return l && l.rect; }
    const it = items()[sel.i]; if (!it || it.id === 'thread' || B_FIELD.includes(it.id)) return null;
    return blindItemBox(it);
  };
  function overlay(){
    const pg = q('.pg[data-i="0"]'); if (!pg || !plan || !plan.blind){ ov = null; return; }
    if (!ov || ov.parentElement !== pg){ ov = document.createElement('div'); ov.className = 'bov'; ov.tabIndex = -1; pg.append(ov); wire(); }
    ov.textContent = ''; selEl = null;
    const r = selRect(); if (!r) return;
    selEl = document.createElement('div'); selEl.className = 'bsel'; place(r);
    const h = document.createElement('i'); h.dataset.h = 'size'; selEl.append(h);
    if (sel.kind === 'item'){ const x = document.createElement('u'); x.textContent = '×'; x.onclick = e => { e.stopPropagation(); q('#bOneDel').click(); }; selEl.append(x); }
    ov.append(selEl);
  }
  const place = r => { const s = selEl.style; s.left = r.x / plan.W * 100 + '%'; s.top = r.y / plan.H * 100 + '%'; s.width = r.w / plan.W * 100 + '%'; s.height = r.h / plan.H * 100 + '%'; };
  function wire(){
    const pos = e => { const b = ov.getBoundingClientRect(); return [(e.clientX - b.left) / b.width * plan.W, (e.clientY - b.top) / b.height * plan.H]; };
    ov.onpointermove = e => { if (!drag) { const [x, y] = pos(e); ov.style.cursor = e.target.dataset && e.target.dataset.h ? '' : hit(x, y) ? 'move' : 'default'; } };
    let drag = null;
    ov.onpointerdown = e => {
      if (e.target.tagName === 'U') return;
      const [x, y] = pos(e), size = e.target.dataset.h === 'size';
      if (!size){ sel = hit(x, y); refreshOne(); overlay(); if (!sel) return; openTab('box'); }
      e.preventDefault(); ov.setPointerCapture(e.pointerId); ov.focus({ preventScroll: true });
      const layer = sel.kind === 'layer', from = layer ? { dx: 0, dy: 0, k: 1, ...((st.blind.move || {})[sel.i] || {}) } : { ...items()[sel.i] };
      const r = selRect(), c = r ? [r.x + r.w / 2, r.y + r.h / 2] : [plan.W / 2, plan.H / 2];
      const tag = 'drag' + Date.now(); let busy = false, next = null, moved = false, slow = 0; drag = true;
      const step = () => {
        if (!next || busy || !alive()) return; busy = true; const [nx, ny] = next; next = null;
        let patch;
        if (size){
          const k = Math.hypot(nx - c[0], ny - c[1]) / (Math.hypot(x - c[0], y - c[1]) || 1), a = Math.atan2(ny - c[1], nx - c[0]) - Math.atan2(y - c[1], x - c[0]);
          patch = layer ? { k: Math.max(.2, Math.min(4, from.k * k)) } : { r: Math.max(5, from.r * k), rot: (from.rot || 0) + a, ...(from.t && from.id !== 'thread' ? { t: Math.max(4, from.t * k) } : {}) };
        } else patch = layer ? { dx: from.dx + nx - x, dy: from.dy + ny - y } : { x: from.x + nx - x, y: from.y + ny - y };
        if (layer) set({ move: { ...(st.blind.move || {}), [sel.i]: { ...from, ...patch } } }, tag);
        else set({ items: items().map((it, i) => (i === sel.i ? { ...it, ...patch } : it)) }, tag);
        lastAt = Date.now();
        const t0 = performance.now(); plan = repaint(slow > 110) || plan; slow = performance.now() - t0;      // 修图太慢的话，拖的时候先不修
        const rr = selRect(); if (rr && selEl) place(rr);
        requestAnimationFrame(() => { busy = false; step(); });
      };
      ov.onpointermove = ev => { const p = pos(ev); if (!moved && Math.hypot(p[0] - x, p[1] - y) < 4) return; moved = true; next = p; step(); };
      const up = () => { drag = null; ov.onpointerup = ov.onpointercancel = null; ov.onpointermove = null; const o = ov; ov = null; o.remove(); if (moved) apply(); else overlay(); };
      ov.onpointerup = ov.onpointercancel = up;
    };
    ov.onkeydown = e => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel && sel.kind === 'item'){ e.preventDefault(); e.stopPropagation(); q('#bOneDel').click(); }
    };
  }

  // ── 面板跟着走 ──────────────────────────────────────────────────
  function refreshOne(){
    const one = q('#bOne'), B = plan && plan.blind && plan.blind.B;
    if (sel && B && (sel.kind === 'item' ? !B.items[sel.i] : !B.layers[sel.i])) sel = null;
    one.hidden = !sel; if (!sel || !B) { markItems(); return; }
    const layer = sel.kind === 'layer', it = layer ? null : B.items[sel.i], row = k => one.querySelector(`.fs[data-k="${k}"]`);
    q('#bOneName').textContent = layer ? t('blind.l_' + B.layers[sel.i].role) : t('bs.' + it.id);
    q('#bOneDel').textContent = layer ? t('blind.home') : t('blind.del');
    q('#bSwapBox').hidden = layer || it.id === 'thread'; q('#bLineBox').hidden = layer || it.id !== 'thread';
    q('#bFront').parentElement.hidden = layer;
    row('rot').hidden = layer;
    row('t').hidden = layer || !['thread', 'torn', 'brush', 'band', 'frost', 'reed', 'mosaic'].includes(it.id);
    const mv = layer ? ((st.blind.move || {})[sel.i] || {}) : null, dots = cur => { const d = q('#bDots'); d.textContent = ''; for (const k of ['i', 'a', 'b', 'g', 'w', '#b41f2b']){ const b = chip(d, k, '', cur === k); b.style.background = bCol(plan.blind.pal, k); } const ck = document.createElement('input'); ck.type = 'color'; ck.value = bToHex(bCol(plan.blind.pal, cur || 'i')); ck.oninput = () => (layer ? moveLayer(sel.i, { c: ck.value }, 'lc' + sel.i) : setItem(sel.i, { c: ck.value }, 'col' + sel.i)); d.append(ck); };
    if (layer){ row('r').querySelector('input').value = 50 + Math.log2(mv.k || 1) * 25; row('a').querySelector('input').value = (mv.a === undefined ? 1 : mv.a) * 100; dots(mv.c); markItems(); return; }
    if (it.id === 'thread'){ const f = q('#bFeel'), m = q('#bMode'); f.textContent = m.textContent = ''; for (const k of ['line', 'yarn']) chip(f, k, t('blind.f_' + k), (it.feel || 'line') === k); for (const k of B_LINE_MODES) chip(m, k, t('blind.m_' + k), it.mode === k); }
    row('r').querySelector('input').value = fromR(it.r); row('rot').querySelector('input').value = Math.round(((it.rot || 0) * 180 / Math.PI + 540) % 360 - 180);
    row('a').querySelector('input').value = (it.a === undefined ? 1 : it.a) * 100; row('t').querySelector('input').value = (it.t || 6) / maxT(it) * 100;
    q('#bFront').textContent = it.front ? t('blind.toBack') : t('blind.toFront');
    const sw = q('#bSwap'); sw.textContent = ''; const fam = Object.values(B_SHAPES).find(g => g.includes(it.id)) || [];
    for (const id of fam.concat(B_SHAPES.shape.filter(x => !fam.includes(x)))) chip(sw, id, t('bs.' + id), id === it.id);
    dots(it.c);
    markItems();
  }
  const markItems = () => {
    const bx = q('#bItems'); bx.textContent = '';
    if (!(plan && plan.blind)) return;
    items().forEach((it, i) => chip(bx, i, t('bs.' + it.id), !!(sel && sel.kind === 'item' && sel.i === i)));
    if (!items().length){ const s = document.createElement('span'); s.className = 'pkhint'; s.textContent = t('blind.noItems'); bx.append(s); }
  };
  const press = (s, on) => q(s).querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', on(b.dataset.v === undefined ? b.dataset.k : b.dataset.v)));
  // 正拖着这一屏里的滑块/取色器时别整屏重排，手底下的东西会被换掉
  function refresh(p){
    if (!alive()) return;
    plan = p;
    const on = !!(st.blind && plan && plan.blind);
    mask.classList.toggle('blind', on); fillKept();
    // 🔒 拆出来就钉住方案和主角：之后改样式、改颜色，这张脸不会换
    if (on && plan.blind.pin && (!st.blind.comp || !st.blind.look || (!st.blind.hero && plan.blind.pin.hero))){ const was = st.blind; st.blind = { ...was, comp: was.comp || plan.blind.pin.comp, look: was.look || plan.blind.pin.look, hero: was.hero || plan.blind.pin.hero, word: was.word || plan.blind.pin.word }; if (box()){ const k = box().hist.indexOf(was); if (k >= 0) box().hist[k] = st.blind; } }
    q('#bGo').textContent = on ? t('blind.again') : t('blind.open');
    for (const id of ['#bPrev', '#bNext', '#bEdit', '#bKeep', '#bOff', '#bName']) q(id).hidden = !on;
    const tab = q('#tabs button[data-v="box"]'); tab.hidden = !on;
    if (!on){ label = ''; sel = null; ov = null; if (tab.getAttribute('aria-pressed') === 'true') openTab('text'); return; }
    if (!box() || !box().hist.includes(st.blind)){ boxes.push({ hist: [st.blind], i: 0 }); at = boxes.length - 1; }       // 从收藏里点回来的
    const b = box();
    q('#bPrev').disabled = at <= 0; q('#bNext').disabled = at >= boxes.length - 1;
    q('#bUndo').disabled = b.i <= 0; q('#bRedo').disabled = b.i >= b.hist.length - 1;
    const n = plan.blind.name; label = n.comp; lookNow = n.look;
    q('#bNow_comp').textContent = t('bc.' + n.comp); q('#bNow_look').textContent = t('bl.' + n.look); q('#bNow_fx').textContent = n.fx.map(f => t('bf.' + f)).join(' '); q('#bNow_post').textContent = n.post.map(f => t('bp.' + f)).join(' '); q('#bNow_add').textContent = n.scene.map(f => t('bs.' + f)).join(' ');
    short = t('bc.' + n.comp) + ' · ' + t('bl.' + n.look);
    name = [short].concat(n.fx.map(f => t('bf.' + f)), n.post.map(f => t('bp.' + f)), n.scene.map(s => t('bs.' + s))).join(' · ');
    q('#bName').textContent = name;
    const own = st.blind.own || {}, B = plan.blind.B, pal = plan.blind.pal;
    q('#bNow_pal').textContent = pal.src === 'tune' ? t('blind.tuned') : (pal.name || '');
    press('#bComp', v => v === n.comp); press('#bLook', v => v === n.look); press('#bFx', v => v ? n.fx.includes(v) : !n.fx.length); press('#bFx2', v => n.fx.includes(v)); press('#bPost', v => v ? B.post.includes(v) : !B.post.length);
    press('#bPals', v => v === pal.id); press('#bLock', v => !!own[v]);
    const act = mask.getRootNode().activeElement;
    mask.querySelectorAll('#bFour input').forEach(i => { if (i !== act) i.value = bToHex(pal[i.dataset.k]); });
    if (!(act && act.type === 'color' && act.closest('#bDots'))) refreshOne();
    overlay();
  }
  const editing = on => mask.classList.toggle('bedit', on);
  const drop = () => { if (!sel) return false; sel = null; refreshOne(); overlay(); return true; };
  refreshOne();
  return { refresh, editing, drop, state: () => ({ boxes, at, open }), own: k => { if (st.blind) set({ own: { ...(st.blind.own || {}), [k]: true }, ...(k === 'font' ? {} : { pal: undefined }) }); } };
}

// ════════════════════════════════════════════════════════════════════
//  6d. 全屏：面板铺满整块屏，纸整张看得见；手机上再收起浏览器自己的地址栏
// ════════════════════════════════════════════════════════════════════
// 两层，各走各的：
//   ① 排布（.full）—— 纯 CSS，哪儿都有。iPhone 的 Safari 不让网页进真全屏，它只有这一层。
//   ② 浏览器的全屏接口 —— 有就顺手要一下，要不到也不吭声，① 照样成立。
// .sheet ＝ 控制面板露不露。手机上进来先收着，只看纸；宽屏两栏摆得下，默认露着。
const FULL_CSS = `
.cbar{display:flex;gap:6px;align-items:center;flex:0 0 auto}
.cbar .count{flex:1;min-width:0}
.cbar [hidden],.ftip[hidden]{display:none!important}
.cbar button{border:1px solid var(--line);background:var(--btn);color:var(--fg);border-radius:999px;
     font-size:11px;padding:4px 11px;cursor:pointer;letter-spacing:.06em;white-space:nowrap;flex:0 0 auto}
.ftip{font-size:11px;color:var(--dim);line-height:1.5;flex:0 0 auto}
.mask.full{padding:0}
.mask.full .box{max-width:none;height:100%;border-radius:0;
     padding:calc(12px + env(safe-area-inset-top,0px)) calc(12px + env(safe-area-inset-right,0px)) calc(12px + env(safe-area-inset-bottom,0px)) calc(12px + env(safe-area-inset-left,0px))}
.mask.full .pages{container-type:size;align-content:safe center;--pgmax:4000px}
.mask.full:not(.sheet) .side{display:none}
@media (max-width: 760px){
  .cbar button{padding:8px 12px}
  /* 一整张都要看得见：预览区给定高，纸按这块地方的宽和高两头收。
     --need ＝ 按屏宽铺开要多高，横版卡片用不着那么高，就别占着。 */
  .view{height:55%;height:min(55%, calc(var(--need, 100vw) + 112px))}
  .mask.blind .view{height:62%;height:min(62%, calc(var(--need, 100vw) + 160px))}
  .pages{container-type:size;padding:5px}      /* 选中的那圈边要有地方待，不然左右被裁掉 */
  .bbar .nm{font-size:12px}
  .mask.full .box .view{flex:1 1 auto;height:auto;max-height:none}
  .mask.full.sheet .box .view{flex:0 0 56%}
  .mask.full.sheet .side{min-height:0}
  .mask.full .count{display:none}
  .mask.full .cbar{justify-content:flex-end}
}
`;
const fullHtml = () => `
  <div class="cbar"><div class="count" id="count"></div>
    <button id="fSave" hidden>${t('act.save')}</button>
    <button id="fSheet" aria-expanded="false" hidden></button>
    <button id="fGo" aria-pressed="false" title="${t('full.title')}"></button>
  </div>
  <div class="ftip" id="fTip" hidden></div>`;

// 全屏是整页的事，不跟着哪一代面板走：换语言重拼面板时它还开着
let fullOwn = false;      // 这个真全屏是不是拾句要来的；别人（网页自己）开的不去动它
const fullNow = () => document.fullscreenElement || document.webkitFullscreenElement || null;
function fullLeave(){
  if (!fullOwn) return;
  fullOwn = false;
  if (!fullNow()) return;
  try { const r = (document.exitFullscreen || document.webkitExitFullscreen).call(document); if (r && r.catch) r.catch(() => {}); } catch {}
}
function fullAsk(still){
  const el = document.documentElement, ask = el.requestFullscreen || el.webkitRequestFullscreen;
  if (!ask || fullNow()) return;
  fullOwn = true;
  const no = () => { fullOwn = false; };
  // 等答复的当口又退出来了（或者面板已经关了），到手的全屏要还回去
  try { const r = ask.call(el, { navigationUI: 'hide' }); if (r && r.then) r.then(() => { if (!still()){ fullOwn = true; fullLeave(); } }, no); } catch { no(); }
}

function mountFull({ resume, mask, alive, tipEl }){
  const q = s => mask.querySelector(s), small = () => { try { return matchMedia('(max-width: 760px)').matches; } catch { return false; } };
  let on = false, sheet = true, leftAt = 0, tipTimer = 0;
  const paint = () => {
    mask.classList.toggle('full', on); mask.classList.toggle('sheet', on && sheet);
    q('#fGo').textContent = on ? t('full.off') : t('full.on'); q('#fGo').setAttribute('aria-pressed', String(on));
    q('#fSheet').hidden = !on; q('#fSheet').textContent = sheet ? t('full.hide') : t('full.show'); q('#fSheet').setAttribute('aria-expanded', String(sheet));
    q('#fSave').hidden = !on || sheet;
    if (!on || sheet) q('#fTip').hidden = true;
  };
  const go = v => { if (on === v) return; on = v; if (on){ sheet = !small(); fullAsk(() => on && alive()); } else fullLeave(); paint(); };
  q('#fGo').onclick = () => go(!on);
  q('#fSheet').onclick = () => { sheet = !sheet; paint(); };
  q('#fSave').onclick = () => q('#save').click();
  // 「改一改」要用面板：收着的话替你拉开。只认这颗按钮 —— 在纸上点中一块字也会翻到「盒」那一屏，
  // 那时候拉开面板，纸会从手指底下缩走
  q('#bEdit').addEventListener('click', () => { if (on && !sheet){ sheet = true; paint(); } });
  // 面板收着，底下那行话（「已存 1 张」）就看不见了，借到纸旁边说
  const mo = new MutationObserver(() => {
    const s = tipEl.textContent; if (!on || sheet || !s) return;
    q('#fTip').textContent = s; q('#fTip').hidden = false;
    clearTimeout(tipTimer); tipTimer = setTimeout(() => { q('#fTip').hidden = true; }, 5000);
  });
  mo.observe(tipEl, { childList: true, characterData: true, subtree: true });
  // 用户从浏览器那头退的（Esc、安卓的返回、下拉）：排布跟着收
  const changed = () => {
    if (!alive()) return dispose();
    if (fullNow() || !fullOwn) return;
    fullOwn = false; leftAt = Date.now(); go(false);
  };
  for (const ev of ['fullscreenchange', 'webkitfullscreenchange']) document.addEventListener(ev, changed);
  function dispose(){
    for (const ev of ['fullscreenchange', 'webkitfullscreenchange']) document.removeEventListener(ev, changed);
    mo.disconnect(); clearTimeout(tipTimer);
  }
  if (resume && resume.on){ on = true; sheet = resume.sheet; }
  paint();
  return {
    dispose, state: () => ({ on, sheet }),
    // Esc：先退全屏，再按一次才关面板。有的浏览器退全屏那一下 Esc 也会送到网页里，别算两次
    drop: () => { if (on){ go(false); return true; } return Date.now() - leftAt < 400; },
  };
}
// ════════════════════════════════════════════════════════════════════
//  7. 界面（关在 shadow DOM 里，免得被网站的 CSS 冲了）
// ════════════════════════════════════════════════════════════════════
const CSS = `
:host{all:initial}
*{box-sizing:border-box;font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif}
.mask{
  --bg:#faf8f4; --fg:#12100e; --dim:#8a8580; --line:#d7d1c7; --field:#fff;
  --btn:#fff; --on-bg:#12100e; --on-fg:#faf8f4; --soft:#e6e1d8; --veil:rgba(28,26,22,.55);
  --shadow:0 24px 70px rgba(0,0,0,.4);
}
.mask.night{
  --bg:#1b1a18; --fg:#eae6de; --dim:#8f8a82; --line:#3a3733; --field:#232120;
  --btn:#232120; --on-bg:#eae6de; --on-fg:#1b1a18; --soft:#332f2c; --veil:rgba(8,7,6,.72);
  --shadow:0 24px 70px rgba(0,0,0,.65);
}
.pill{position:fixed;z-index:2147483646;background:#12100e;color:#f7f5f0;border:0;border-radius:999px;
      padding:7px 15px;font-size:13px;letter-spacing:.14em;cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,.3)}
/* 🔴 手机上的「整体上移」就出在这儿。软键盘一弹、地址栏一收放，浏览器缩的是
   **visual viewport**，并且把 layout viewport 往上推；position:fixed 钉的是后者 ——
   面板于是有一截顶到屏幕外，底下露出网页，看着就像整页往上跑了。
   带 data-vv 的那条把遮罩直接钉在 visual viewport 上（尺寸由 JS 实时喂）。
   上面四条 top/right/bottom/left 是兜底：写 inset 简写的话，老一点的
   安卓内核（X浏览器/Via 那批）整条声明会被丢掉，遮罩缩成内容大小，veil 盖不满屏。 */
.mask{position:fixed;top:0;right:0;bottom:0;left:0;z-index:2147483647;background:var(--veil);
      display:flex;align-items:center;justify-content:center;padding:18px;
      overflow:hidden;overscroll-behavior:contain}
.mask[data-vv]{right:auto;bottom:auto;
      left:var(--vvl,0px);top:var(--vvt,0px);width:var(--vvw,100%);height:var(--vvh,100%)}
/* max-height 跟着遮罩的实高走，不跟 vh —— vh 量的是「地址栏收起时」的大视口，
   手机上永远比眼前这块屏高一截。 */
.box{background:var(--bg);border-radius:8px;max-width:1240px;width:100%;max-height:100%;
     display:flex;gap:18px;padding:18px;box-shadow:var(--shadow)}
.side{width:308px;flex:0 0 308px;overflow:auto;overscroll-behavior:contain;padding-right:6px}
.side h2{margin:0 0 2px;font-size:14px;letter-spacing:.16em;color:var(--fg)}
.side p.h{margin:0 0 12px;font-size:11px;color:var(--dim)}
label{display:flex;justify-content:space-between;align-items:center;font-size:11px;letter-spacing:.1em;
      color:var(--dim);margin:13px 0 5px}
/* 🔴 这三条原本写的是「label .sw …」（这段 CSS 住在模板字符串里，注释别用反引号）
   —— 可 .sw 有一半根本不在 label 里
   （常/中/粗 那两排在 .fs 行里，跟随/白天/黑夜 在 h2 里）。结果那些按钮拿的是浏览器
   默认样式：灰底黑字，而且**选中的那颗跟没选中的长得一模一样**，按了不知道按没按上。
   去掉 label 前缀，一视同仁。 */
.sw{display:flex;gap:4px}
.sw button{border:1px solid var(--line);background:var(--btn);border-radius:3px;font-size:10px;
      padding:2px 7px;cursor:pointer;color:var(--dim);letter-spacing:0}
.sw button[aria-pressed=true]{background:var(--on-bg);color:var(--on-fg);border-color:var(--on-bg)}
textarea,input[type=text]{width:100%;border:1px solid var(--line);border-radius:4px;padding:8px;
     font:13px/1.7 inherit;background:var(--field);resize:vertical;color:var(--fg)}
textarea{height:110px}
input[type=text]:disabled{opacity:.5}
.row{display:flex;gap:5px;flex-wrap:wrap}
.row button{flex:1 1 auto;min-width:52px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:7px 4px;border:1px solid var(--line);background:var(--btn);
     border-radius:4px;cursor:pointer;font-size:12px;color:var(--fg)}
.row button[aria-pressed=true]{background:var(--on-bg);color:var(--on-fg);border-color:var(--on-bg)}
.row button[data-off=1]{opacity:.4}
.row button.add{flex:0 0 auto;min-width:32px;color:var(--dim)}
.inks button,.row button.sw2{position:relative;padding-left:22px}
.inks i,.row button.sw2 i{position:absolute;left:6px;top:50%;transform:translateY(-50%);
     width:10px;height:10px;border-radius:50%;border:1px solid rgba(128,128,128,.35)}
/* 分页标签：东西一多，平铺的按钮墙就没法看了，拆成几屏 */
.tabs{display:flex;gap:2px;margin:12px 0 0;border-bottom:1px solid var(--line)}
.tabs button{flex:1;padding:7px 2px;border:0;background:transparent;color:var(--dim);
     font-size:12px;letter-spacing:.1em;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px}
.tabs button[aria-pressed=true]{color:var(--fg);border-bottom-color:var(--on-bg)}
.pane{display:none;padding-top:2px}
.pane.on{display:block}
/* 纸：直接看缩略图，比看名字快得多 */
.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}
.sw3{position:relative;aspect-ratio:4/5;border-radius:3px;overflow:hidden;padding:0;
     border:1px solid var(--line);background:var(--btn);cursor:pointer}
.sw3 img,.sw3 canvas{width:100%;height:100%;object-fit:cover;display:block}
.sw3 b{position:absolute;left:0;right:0;bottom:0;font-size:9px;font-weight:400;
     background:rgba(18,16,14,.5);color:#fbfaf7;padding:1px 2px;line-height:1.3;
     white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sw3[aria-pressed=true]{outline:2px solid var(--on-bg);outline-offset:1px}
.sw3.plus{display:flex;align-items:center;justify-content:center;font-size:16px;color:var(--dim);aspect-ratio:4/5}
/* 字：每一行用它自己的样子写出来，这才叫挑字体 */
.flist{display:flex;flex-direction:column;gap:3px}
.flist button{display:flex;align-items:baseline;gap:8px;width:100%;text-align:left;
     padding:6px 9px;border:1px solid var(--line);background:var(--btn);color:var(--fg);
     border-radius:4px;cursor:pointer;font-size:16px;line-height:1.35}
.flist button[aria-pressed=true]{background:var(--on-bg);color:var(--on-fg);border-color:var(--on-bg)}
.flist button[data-off=1]{opacity:.38}
.flist button i{font-style:normal;font-size:10px;opacity:.6;font-family:-apple-system,sans-serif;margin-left:auto}
.sub{font-size:10px;color:var(--dim);margin:10px 0 4px;letter-spacing:.08em}
.fs{display:flex;gap:8px;align-items:center}
/* min-width:0 —— 少了它，range 撑在自己 129px 的固有宽度上不肯缩，
   「滑块＋数字框＋常中粗」这一行就顶破 308px 的侧栏，底下冒出一条横向滚动条。 */
.fs input[type=range]{flex:1;min-width:0}
.fs input[type=number]{width:62px;border:1px solid var(--line);border-radius:4px;padding:5px 6px;
     font:13px inherit;text-align:center;color:var(--fg);background:var(--field)}
.fs .val{width:44px;text-align:right;font-size:11px;color:var(--dim)}
.acts{display:flex;gap:8px;margin-top:14px}
.acts button{flex:1;padding:10px;border:0;border-radius:4px;font-size:13px;letter-spacing:.14em;cursor:pointer}
.save{background:var(--on-bg);color:var(--on-fg)}
.copy{background:var(--soft);color:var(--fg)}
.close{background:transparent;color:var(--dim);border:1px solid var(--line)!important}
.tip{font-size:11px;color:var(--dim);min-height:30px;line-height:1.55;margin-top:8px}
.view{flex:1;min-width:0;display:flex;flex-direction:column;gap:8px}
.count{font-size:11px;color:var(--dim);letter-spacing:.08em;flex:0 0 auto}
.pages{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;display:flex;flex-wrap:wrap;gap:14px;align-content:flex-start;
       justify-content:center;padding:4px}
.pg{position:relative;cursor:pointer}
/* touch-action:pinch-zoom —— 整块位移是在画布上按住拖出来的。触屏上不写这一句，
   单指拖会被浏览器当成滚动手势收走（pointerdown 里 preventDefault 挡不住滚动，
   挡它的就是 touch-action），于是手机上「拖不动」。留着 pinch-zoom 是为了还能双指放大看细节。 */
.pg canvas{display:block;max-width:100%;box-shadow:0 6px 20px rgba(0,0,0,.18);border-radius:2px;
       outline:2px solid transparent;outline-offset:3px;touch-action:pinch-zoom}
.pg[aria-selected=true] canvas{outline-color:rgba(185,32,11,.7)}
.mask.bare .pg canvas{background:repeating-conic-gradient(#d9d9d9 0 25%,#f4f4f4 0 50%) 0 0/18px 18px}
.pg span{position:absolute;left:6px;top:6px;background:rgba(18,16,14,.72);color:#faf8f4;
       font-size:10px;padding:1px 6px;border-radius:3px}

/* 手机：左右分栏在窄屏上必死 —— 侧栏钉死 308px，预览区被挤成 0 宽，
   实测 375px 视口下画布量出来就是 0×0（能操作，但一眼都看不见成品）。
   改成上下叠：预览在上，控制在下。 */
@media (max-width: 760px){
  .mask{padding:0}
  .box{flex-direction:column;gap:10px;padding:12px;border-radius:0;
       width:100%;height:100%;max-height:100%}
  /* 55%：竖版卡片按屏宽铺开正好这么高，整张能一眼看全，不用滚。
     原来写的是 55vh —— vh 认的是地址栏收起时的大视口，键盘一弹它比整个面板还高，
     底下的控制区被挤成零；而 dvh 老内核不认，整条 height 被丢掉。都换成百分比，
     一路跟着 .box → .mask → visual viewport。 */
  .view{order:-1;flex:0 0 auto;max-height:55%;min-height:0}
  .pages{padding:0;gap:8px}
  .side{width:auto;flex:1 1 auto;padding-right:0}
  .side h2{font-size:13px}
  textarea{height:88px}
  .acts button{padding:12px}
  /* 手指按不准 24px 高的按钮。桌面上 29×24 够用，手机上把这几排撑开。 */
  .tabs button{padding:11px 2px;font-size:13px}
  .sw button{padding:10px 11px;font-size:11px}
  .row button{padding:10px 6px}
}
/* 「摘」那颗药丸也一样：手指点得中才算数 */
@media (pointer: coarse){
  .pill{padding:11px 20px;font-size:14px}
}
`;

let host, root, pill, mask, tipEl, hideTimer, vvStop = null;
let pageCanvases = [], selected = 0;

function ui(){
  if (host && host.isConnected) return;
  host = document.createElement('div');
  host.style.cssText = 'all:initial;position:static';
  root = host.attachShadow({ mode: 'open' });
  const st = document.createElement('style'); st.textContent = CSS + PICK_CSS + BLIND_CSS + FULL_CSS; root.append(st);
  document.documentElement.append(host);
  pill = null;
}

function showPill(x, y, text){
  ui();
  if (!pill){
    pill = document.createElement('button');
    pill.className = 'pill'; pill.textContent = t('pill.clip');
    pill.onmousedown = e => e.preventDefault();     // 别让点击清掉选区
    root.append(pill);
  }
  setStudioLocale(panelLocale()); pill.textContent = t('pill.clip');      // 在面板上换过语言，这颗也跟着
  pill.style.left = Math.min(x, innerWidth - 70) + 'px';
  pill.style.top  = Math.max(8, y - 44) + 'px';
  pill.hidden = false;
  pill.onclick = () => { pill.hidden = true; openPanel(text); };
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => { if (pill) pill.hidden = true; }, 7000);
}

// 把遮罩钉在 visual viewport 上：offsetLeft/Top 抵掉浏览器推 layout viewport 的那一下，
// width/height 是键盘/地址栏之后**眼前真正剩下**的那块屏。返回撤销函数。
// 没有 visualViewport 的老浏览器直接走 CSS 里 top/right/bottom/left 那套兜底。
function trackViewport(el){
  const vv = window.visualViewport;
  if (!vv) return () => {};
  const apply = () => {
    el.style.setProperty('--vvl', vv.offsetLeft + 'px');
    el.style.setProperty('--vvt', vv.offsetTop  + 'px');
    el.style.setProperty('--vvw', vv.width      + 'px');
    el.style.setProperty('--vvh', vv.height     + 'px');
  };
  apply();                       // 先喂尺寸再挂 data-vv，免得有一帧钉在错地方
  el.setAttribute('data-vv', '');
  vv.addEventListener('resize', apply);
  vv.addEventListener('scroll', apply);
  return () => { vv.removeEventListener('resize', apply); vv.removeEventListener('scroll', apply); };
}

const p2 = n => String(n).padStart(2, '0');
const today = () => { const d = new Date(); return `${d.getFullYear()}.${p2(d.getMonth()+1)}.${p2(d.getDate())}`; };
const stampName = () => { const d = new Date(); return `${d.getFullYear()}${p2(d.getMonth()+1)}${p2(d.getDate())}_${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`; };
const readFile = (file, as) => new Promise((res, rej) => {
  const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej;
  as === 'url' ? r.readAsDataURL(file) : r.readAsArrayBuffer(file);
});
const pickFiles = accept => new Promise(res => {
  const i = document.createElement('input');
  i.type = 'file'; i.accept = accept; i.multiple = true;
  i.onchange = () => res([...i.files]); i.click();
});

// init 是给嵌入方（比如阅读器）的缝：{ title, source, date } 预填内容，
// onClose 在面板真正关掉后回调一次（嵌入方拿它恢复自己的阅读位置/焦点）。
// 不传 init 时行为与从前完全相同 —— 网页选中路径一个字都没变。
function openPanel(text, init = {}){
  // 语言先落定再建面板：面板 HTML 是开面板时现拼的，t() 在拼的那一刻取词
  setStudioLocale(panelLocale(init.locale));
  // 嵌入方可为可再分发西文字体提供文件 URL（{latinId: url}）——选中才装载
  const embedFontUrls = (init.fontUrls && typeof init.fontUrls === 'object') ? init.fontUrls : {};
  ui();
  if (vvStop) { vvStop(); vvStop = null; }
  if (!init.resume) fullLeave();
  if (mask) mask.remove();
  const blank = !String(text || '').trim();     // 空手起稿（写日记随笔），不是从网页上摘的
  const st = {
    text: text || '',
    // 空手写的时候，出处默认给空 —— 那是自己写的话，不是从这个网页摘的
    source: init.source != null ? String(init.source).slice(0, 200)
          : blank ? '' : (document.title || location.hostname).slice(0, 200),
    headText: cfg('headText'),
    date  : init.date != null ? String(init.date) : today(),
    title: init.title != null ? String(init.title) : '',
    blind: null,                    // 版式盲盒：null = 普通版式
    noGround: false,                // 透明底：不铺纸，存成 PNG
    spans: [], titleSpans: [],      // 选中的字单独改过的样式（spans.js）
    paper: cfg('paper'), font: cfg('font'), fontSize: cfg('fontSize'), ink: cfg('ink'),
    orient: cfg('orient'), pages: cfg('pages'),
    weight: cfg('weight'), latinFont: cfg('latinFont'),
    align: cfg('align'), titleAlign: cfg('titleAlign'), vertical: cfg('vertical'),
    offsetX: cfg('offsetX'), offsetY: cfg('offsetY'), metaInk: cfg('metaInk'),
    quoteInk: cfg('quoteInk'),
    headRule: cfg('headRule'), titleRule: cfg('titleRule'), footRule: cfg('footRule'),
    titleVertical: cfg('titleVertical'),
    sourcePrefix: cfg('sourcePrefix'),
    titleFont: cfg('titleFont'), titleSize: cfg('titleSize'), titleWeight: cfg('titleWeight'),
    inkLight: cfg('inkLight'), paperLight: cfg('paperLight'),
    theme: cfg('theme'),
    showHeader: cfg('showHeader'), showSource: cfg('showSource'), showDate: cfg('showDate'),
  };
  // 换语言：面板整个重拼一遍，手上的东西原样接过来
  const back = init.resume; if (back) Object.assign(st, back.st);
  const prefersDark = () => { try { return matchMedia('(prefers-color-scheme: dark)').matches; } catch { return false; } };
  const applyTheme = () => {
    if (!alive()) return;      // 系统主题翻转可能发生在面板关掉之后
    const night = st.theme === 'night' || (st.theme === 'auto' && prefersDark());
    mask.classList.toggle('night', night);
  };

  mask = document.createElement('div'); mask.className = 'mask';
  // 本代面板的身份证：关掉或被新面板顶替后，这一代遗留的异步回调
  // （字体装载、纸解码、聚焦定时器、主题监听）一律安静退场，不再摸已空的 mask。
  const thisMask = mask;
  const alive = () => mask === thisMask;
  mask.innerHTML = `
    <div class="box">
      <div class="side">
        <h2>${t('app.title')}<span class="sw" id="lang" style="float:right;margin-left:6px${hostLocale(init.locale) ? ';display:none' : ''}"><button title="${t('lang.toggle')}" aria-label="${t('lang.toggle')}">${studioLocale === 'en' ? '中' : 'EN'}</button></span><span class="sw" id="theme" style="float:right">
          <button data-v="auto">${t('theme.auto')}</button><button data-v="day">${t('theme.day')}</button><button data-v="night">${t('theme.night')}</button>
        </span></h2><p class="h" id="tag"></p>

        <div class="tabs" id="tabs">
          <button data-v="text">${t('tab.text')}</button><button data-v="paper">${t('tab.paper')}</button>
          <button data-v="font">${t('tab.font')}</button><button data-v="ink">${t('tab.ink')}</button>
          <button data-v="layout">${t('tab.layout')}</button>
          <button data-v="box" hidden>${t('tab.box')}</button>
        </div>

        <div class="pane" data-p="text">
          <label>${t('text.title')}<span class="sw"><span style="font-size:10px">${t('text.sizeWeight')}</span></span></label>
          <input type="text" id="ti" placeholder="${t('text.titlePh')}">
          <div class="fs" style="margin-top:6px">
            <input type="range" id="ts" min="20" max="140" step="1">
            <input type="number" id="tsn" min="12" max="300" step="1">
            <span class="sw" id="tw">
              <button data-v="0">${t('weight.regular')}</button><button data-v="1">${t('weight.medium')}</button><button data-v="2">${t('weight.bold')}</button></span>
          </div>
          <label>${t('text.body')}<span class="sw"><span style="font-size:10px">${t('text.sizeWeight')}</span></span></label>
          <div class="ta"><div class="bk" aria-hidden="true"><div></div></div><textarea id="t"></textarea></div>
          ${pickHtml()}
          <p class="pkhint" id="pkHint">&nbsp;<button id="pkReset" hidden>${t('pick.reset')}</button></p>
          <div class="fs" style="margin-top:6px">
            <input type="range" id="fs" min="20" max="96" step="1">
            <input type="number" id="fsn" min="12" max="200" step="1">
            <span class="sw" id="weight">
              <button data-v="0">${t('weight.regular')}</button><button data-v="1">${t('weight.medium')}</button><button data-v="2">${t('weight.bold')}</button></span>
          </div>
          <label>${t('text.source')}<span class="sw" id="swSrc">
            <button data-v="1">${t('sw.show')}</button><button data-v="0">${t('sw.hide')}</button></span></label>
          <div class="fs">
            <input type="text" id="sp" placeholder="${t('text.sourcePrefixPh')}" style="width:64px;padding:5px 6px;font-size:12px">
            <input type="text" id="s" style="flex:1">
          </div>
          <label>${t('text.date')}<span class="sw" id="swDate">
            <button data-v="1">${t('sw.show')}</button><button data-v="0">${t('sw.hide')}</button></span></label>
          <input type="text" id="d">
          <label>${t('text.header')}<span class="sw" id="swHead">
            <button data-v="1">${t('sw.show')}</button><button data-v="0">${t('sw.hide')}</button></span></label>
          <input type="text" id="hd" placeholder="${t('text.headerPh')}">
          <label>${t('text.rules')}</label>
          <div class="row">
            <button id="rHead" style="flex:1">${t('text.ruleHead')}</button>
            <button id="rTitle" style="flex:1">${t('text.ruleTitle')}</button>
            <button id="rFoot" style="flex:1">${t('text.ruleFoot')}</button>
          </div>
        </div>

        <div class="pane" data-p="paper">
          <div class="sub">${t('paper.builtin')}</div><div class="grid" id="paperBuiltin"></div>
          <div class="sub" id="packHd">${t('paper.pack')}</div><div class="grid" id="paperPack"></div>
          <div class="sub">${t('paper.mine')}</div><div class="grid" id="paperMine"></div>
          <label>${t('paper.bright')}</label>
          <div class="fs"><input type="range" id="pl" min="-50" max="50" step="1">
            <span class="val" id="plv"></span></div>
        </div>

        <div class="pane" data-p="font">
          <div class="sub">${t('font.body')}</div><div class="flist" id="font"></div>
          <div class="sub">${t('font.latin')}</div><div class="flist" id="latin"></div>
          <div class="sub">${t('font.title')}</div><div class="flist" id="swTitleFont"></div>
        </div>

        <div class="pane" data-p="ink">
          <label>${t('ink.body')}</label><div class="row inks" id="ink"></div>
          <label>${t('ink.meta')}</label><div class="row inks" id="metaInk"></div>
          <label>${t('ink.quote')}</label><div class="row inks" id="quoteInk"></div>
          <label>${t('ink.custom')}<span class="sw"><span style="font-size:10px">${t('ink.customHint')}</span></span></label>
          <div class="fs">
            <input type="color" id="ck">
            <input type="text" id="ckn" placeholder="${t('ink.namePh')}" maxlength="24"
                   style="flex:1;padding:5px 7px;font-size:12px">
            <button id="ckSave" style="padding:6px 9px;border:1px solid var(--line);
                    background:var(--btn);color:var(--fg);border-radius:4px;cursor:pointer;font-size:12px">${t('act.store')}</button>
          </div>
          <label>${t('ink.bright')}</label>
          <div class="fs"><input type="range" id="il" min="-50" max="50" step="1">
            <span class="val" id="ilv"></span></div>
        </div>

        <div class="pane" data-p="layout">
          <label>${t('preset.label')}</label><div class="row" id="presets"></div>
          <div class="fs" style="margin-top:6px">
            <input type="text" id="psn" placeholder="${t('preset.namePh')}" maxlength="24"
                   style="flex:1;padding:5px 7px;font-size:12px">
            <button id="psSave" style="padding:6px 9px;border:1px solid var(--line);
                    background:var(--btn);color:var(--fg);border-radius:4px;cursor:pointer;font-size:12px">${t('act.store')}</button>
          </div>

          <label>${t('layout.bodyDir')}<span class="sw" id="vert">
            <button data-v="0">${t('dir.horizontal')}</button><button data-v="1">${t('dir.vertical')}</button></span></label>
          <label>${t('layout.titleDir')}<span class="sw" id="tvert">
            <button data-v="0">${t('dir.horizontal')}</button><button data-v="1">${t('dir.vertical')}</button></span></label>
          <label>${t('layout.bodyAlign')}</label><div class="row" id="align"></div>
          <label>${t('layout.titleAlign')}</label><div class="row" id="talign"></div>
          <label>${t('layout.orient')}</label><div class="row" id="orient"></div>
          <label>${t('layout.pages')}</label><div class="row" id="pagesRow"></div>
          <label>${t('layout.offset')}<span class="sw"><span style="font-size:10px">${t('layout.offsetHint')}</span></span></label>
          <div class="fs">
            <span class="val" id="offv" style="width:auto"></span>
            <button id="offReset" style="padding:5px 9px;border:1px solid var(--line);
                    background:var(--btn);color:var(--fg);border-radius:4px;cursor:pointer;font-size:12px">${t('layout.offsetReset')}</button>
          </div>
        </div>

        ${blindPaneHtml()}
        <label style="margin:14px 0 -6px">${t('act.bare')}<span class="sw" id="bare"><button data-v="0">${t('sw.off')}</button><button data-v="1">${t('sw.on')}</button></span></label>
        <div class="acts">
          <button class="save" id="save">${t('act.save')}</button>
          <button class="copy" id="copy">${t('act.copy')}</button>
        </div>
        <div class="acts"><button class="close" id="close">${t('act.close')}</button></div>
        <div class="tip" id="tip"></div>
      </div>
      <div class="view">
        ${blindHtml()}
        ${fullHtml()}
        <div class="pages" id="pgs"></div>
      </div>
    </div>`;
  vvStop = trackViewport(mask);
  root.append(mask);

  const q = s => mask.querySelector(s);
  tipEl = q('#tip');
  q('#tag').textContent = TAGLINES[Math.floor(Math.random() * TAGLINES.length)];
  q('#ck').value = /^#[0-9a-f]{6}$/i.test(st.ink) ? st.ink : inkOf(st.ink);
  q('#t').value = st.text; q('#s').value = st.source; q('#d').value = st.date;
  q('#hd').value = st.headText; q('#ti').value = st.title; q('#sp').value = st.sourcePrefix;
  q('#fs').value = st.fontSize; q('#fsn').value = st.fontSize;
  q('#ts').value = st.titleSize; q('#tsn').value = st.titleSize;

  // ── 画 ──────────────────────────────────────────────────────────
  let plan = null, dragging = false, blindBar = null, full = null;
  // 盲盒里自己挑了纸 / 字 / 墨，那一样就归自己，别的照旧听种子的
  const ownIt = k => { if (blindBar) blindBar.own(k); };
  // 拖的时候只重画已有的画布，绝不重建 DOM ——
  // 🔴 早先 draw() 每次都把预览区整个清空重建，正在拖的那个 canvas 当场被销毁，
  //    指针捕获立刻断掉，于是「只能拖动一下下」。不是范围小，是只生效了一帧。
  const redrawOnly = () => {
    if (!alive() || !plan) return;
    pageCanvases.forEach((cv, i) => { if (plan.pages[i]) renderPage(cv, st, plan, i); });
  };
  // 盲盒一张要好几道效果，满尺寸画一遍不便宜：预览先出草样，手停下来再补成导出的尺寸
  let fineTimer = 0, rough = false;
  const finish = () => { clearTimeout(fineTimer); if (!rough || !plan || !alive()) return; rough = false; pageCanvases.forEach((cv, i) => { if (plan.pages[i]) renderPage(cv, st, plan, i); }); };
  const settle = () => (typeof requestIdleCallback === 'function' ? requestIdleCallback(() => finish(), { timeout: 2500 }) : finish());      // 等浏览器真闲下来再补
  const draw = () => {
    if (!alive()) return;
    st.text = q('#t').value; st.source = q('#s').value; st.date = q('#d').value;
    st.headText = q('#hd').value; st.title = q('#ti').value;
    st.sourcePrefix = q('#sp').value;
    if (dragging){ redrawOnly(); return; }
    try {
      plan = planPages(st);
      const box = q('#pgs'), same = !!plan.blind && pageCanvases.length === plan.pages.length && box.children.length === plan.pages.length;
      if (!same){ box.textContent = ''; pageCanvases = []; }
      clearTimeout(fineTimer); rough = !!plan.blind;
      const paint = (cv, i) => (plan.blind ? withDPR(1, () => renderPage(cv, st, plan, i)) : renderPage(cv, st, plan, i));
      plan.pages.forEach((_, i) => {
        const cols = Math.min(plan.pages.length, 3), wide = `min(calc((100% - ${(cols - 1) * 14}px) / ${cols}), var(--pgmax, ${plan.W > plan.H ? 620 : 420}px)`;
        // 再按高收一道，整张看得全（cqh ＝ 预览区的高）。老内核不认 cqh，后一句赋不进去，就停在前一句
        const size = el => { el.style.width = wide + ')'; el.style.width = `${wide}, calc(100cqh * ${(plan.W / plan.H).toFixed(4)}))`; };
        if (same){ const cv = pageCanvases[i]; paint(cv, i); cv.style.cursor = 'default'; size(cv.parentElement); return; }
        const wrapEl = document.createElement('div');
        wrapEl.className = 'pg'; wrapEl.dataset.i = i;
        const cv = document.createElement('canvas');
        paint(cv, i);
        // 缩到能并排看下：一张时给大，多张时按张数分
        // 🔴 宽度得给外壳：早先给的是画布，百分比算的是外壳的宽，而外壳自己撑满整行 ——
        //    说是并排，其实一直一张一行往下堆
        size(wrapEl);
        cv.style.width = '100%';
        cv.style.cursor = st.blind ? 'default' : 'move';
        // 在预览图上直接拖 = 整块位移。按显示比例换算回真实像素，拖多少就挪多少。
        cv.onpointerdown = e => {
          if (st.blind) return;          // 盲盒里没有「整块位移」这回事
          e.preventDefault();
          const scale = plan.W / cv.getBoundingClientRect().width;
          const sx = e.clientX, sy = e.clientY, bx = st.offsetX || 0, by = st.offsetY || 0;
          cv.setPointerCapture(e.pointerId);
          dragging = true;
          const move = ev => {
            st.offsetX = Math.round(bx + (ev.clientX - sx) * scale);
            st.offsetY = Math.round(by + (ev.clientY - sy) * scale);
            q('#offv').textContent = t('layout.offsetVal', { x: st.offsetX, y: st.offsetY });
            redrawOnly();
          };
          const up = () => {
            dragging = false;
            cv.removeEventListener('pointermove', move);
            cv.removeEventListener('pointerup', up);
            cv.removeEventListener('pointercancel', up);
            setCfg('offsetX', st.offsetX); setCfg('offsetY', st.offsetY);
            sync();
          };
          cv.addEventListener('pointermove', move);
          cv.addEventListener('pointerup', up);
          cv.addEventListener('pointercancel', up);
        };
        wrapEl.append(cv);
        if (plan.pages.length > 1){
          const tag = document.createElement('span'); tag.textContent = `${i+1}`; wrapEl.append(tag);
        }
        wrapEl.onclick = () => { selected = i; markSel(); };
        box.append(wrapEl); pageCanvases.push(cv);
      });
      { const cols = Math.min(plan.pages.length, 3), rows = Math.ceil(plan.pages.length / cols); mask.style.setProperty('--need', `calc((100vw - 24px) * ${(plan.H / plan.W / cols * rows).toFixed(4)})`); }
      if (selected >= plan.pages.length) selected = plan.pages.length - 1;
      markSel();
      // 张数、尺寸、以及「没照你说的办」的时候必须说出来，不能默默给个别的结果
      const S0 = SIZES[st.orient] || SIZES.portrait;
      const grew = plan.H > S0.h || plan.W > S0.w;
      const want = st.pages === 'auto' ? 0 : parseInt(st.pages, 10);
      const notes = [];
      if (plan.blind && plan.pages.length > 1) notes.push(t('blind.coverNote', { n: plan.pages.length - 1 }));
      if (grew) notes.push(t('count.grewNote'));
      if (want && plan.pages.length < want) notes.push(t('count.fewerNote', { want, got: plan.pages.length }));
      q('#count').textContent =
        t('count.pages', { n: plan.pages.length, w: plan.W, h: plan.H, ew: plan.W*DPR, eh: plan.H*DPR })
        + (notes.length ? t('count.notesGlue') + notes.join(t('count.notesJoin')) : '');
      // 盲盒可能抽中一张还没解码完的信纸：先垫纯色，解完再画一次
      if (plan.blind && plan.blind.pal.paper){
        const im = groundPhoto({ paper: plan.blind.pal.paper, orient: st.orient });
        if (im && !im.complete) im.addEventListener('load', draw, { once: true });
      }
      if (blindBar) blindBar.refresh(plan);
      if (rough) fineTimer = setTimeout(settle, 1600);
    } catch (e){ tipEl.textContent = t('count.renderFail', { msg: e.message }); }
  };
  // 打字的时候盲盒别一字一画（一张要一两百毫秒），停手再画
  let typingTimer;
  const drawTyping = () => { clearTimeout(typingTimer); if (st.blind) typingTimer = setTimeout(draw, 240); else draw(); };
  const markSel = () => mask.querySelectorAll('.pg').forEach(el =>
    el.setAttribute('aria-selected', +el.dataset.i === selected));

  // ── 各种选择器 ──────────────────────────────────────────────────
  const mkRow = (sel, list, key, cast) => {
    const box = q(sel); box.textContent = '';
    for (const o of list){
      const b = document.createElement('button');
      b.dataset.v = o.v; b.textContent = o.n;
      if (o.dot){ const i = document.createElement('i'); i.style.background = o.dot; b.prepend(i); }
      box.append(b);
    }
    box.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      st[key] = cast ? cast(b.dataset.v) : b.dataset.v;
      setCfg(key, st[key]); sync(); draw();
    });
  };
  mkRow('#orient', Object.entries(SIZES).map(([v, s]) => ({ v, n: tName('orient', v, s.name) })), 'orient');
  mkRow('#pagesRow', [{v:'auto',n:t('layout.pagesAuto')},{v:'1',n:'1'},{v:'2',n:'2'},{v:'3',n:'3'},
                      {v:'4',n:'4'},{v:'5',n:'5'},{v:'6',n:'6'}], 'pages');
  function buildInks(){
    // 题头/出处那一行、引号那一行：都是「几个特殊挡 + 全部墨色」，所以走同一个工厂。
    // 🔑 别为第二行再抄一遍 —— 这个项目栽过三次「同一件事写两套」。
    const mkInkRow = (sel, key, extra) => {
      const box = q(sel); if (!box) return;
      box.textContent = '';
      for (const [v, n] of extra){
        const b = document.createElement('button');
        b.dataset.v = v; b.textContent = n; box.append(b);
      }
      for (const i of allInks()){
        const b = document.createElement('button');
        b.dataset.v = i.id; b.textContent = tName('ink', i.id, i.name);
        const dot = document.createElement('i'); dot.style.background = i.c; b.prepend(dot);
        box.append(b);
      }
      box.addEventListener('click', e => {
        const b = e.target.closest('button'); if (!b) return;
        st[key] = b.dataset.v; setCfg(key, st[key]); sync(); draw();
      });
    };
    mkInkRow('#metaInk',  'metaInk',  [['auto', t('ink.followPaper')]]);
    // 引号多一挡「跟正文」＝不要那抹橙
    mkInkRow('#quoteInk', 'quoteInk', [['auto', t('ink.followPaper')], ['same', t('ink.followBody')]]);

    const box = q('#ink'); box.textContent = '';
    for (const i of allInks()){
      const b = document.createElement('button');
      b.dataset.v = i.id; b.textContent = tName('ink', i.id, i.name);
      const dot = document.createElement('i'); dot.style.background = i.c; b.prepend(dot);
      const mine = (cfg('myInks') || []).some(x => x.id === i.id);
      if (mine){
        b.title = t('tip.renameDelete');
        b.ondblclick = e => {
          e.preventDefault(); e.stopPropagation();
          const v = prompt(t('ink.renamePrompt'), i.name);
          if (v === null) return;
          const name = v.trim().slice(0, 24) || i.name;
          setCfg('myInks', cfg('myInks').map(x => x.id === i.id ? { ...x, name } : x));
          buildInks(); sync();
        };
        b.oncontextmenu = e => {
          e.preventDefault();
          if (!confirm(t('ink.deleteConfirm', { name: i.name }))) return;
          setCfg('myInks', cfg('myInks').filter(x => x.id !== i.id));
          if (st.ink === i.id){ st.ink = 'black'; setCfg('ink', st.ink); }
          buildInks(); sync(); draw();
        };
      }
      box.append(b);
    }
    box.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      st.ink = b.dataset.v; setCfg('ink', st.ink); ownIt('ink'); sync(); draw();
    });
  }
  mkRow('#align',  [{v:'left',n:t('align.left')},{v:'center',n:t('align.center')},{v:'right',n:t('align.right')}], 'align');
  mkRow('#talign', [{v:'left',n:t('align.left')},{v:'center',n:t('align.center')},{v:'right',n:t('align.right')}], 'titleAlign');
  q('#vert').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    st.vertical = b.dataset.v === '1'; setCfg('vertical', st.vertical); sync(); draw();
  });
  q('#tvert').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    st.titleVertical = b.dataset.v === '1'; setCfg('titleVertical', st.titleVertical); sync(); draw();
  });
  q('#offReset').onclick = () => {
    st.offsetX = 0; st.offsetY = 0; setCfg('offsetX', 0); setCfg('offsetY', 0); sync(); draw();
  };

  // ── 版式预设（不只是文字排版，纸/字/色都在里面，所以叫版式）────────────────────────────────────────────────────
  const allPresets = () => BUILTIN_PRESETS.concat(cfg('presets') || []);
  function applyPreset(p){
    for (const k of STYLE_KEYS) if (k in p.style && k !== 'blind'){ st[k] = p.style[k]; setCfg(k, st[k]); }
    st.blind = blindFor(p.style.blind || null, q('#t').value, q('#ti').value);
    q('#hd').value = st.headText; q('#sp').value = st.sourcePrefix;
    q('#fs').value = Math.max(20, Math.min(96, st.fontSize)); q('#fsn').value = st.fontSize;
    q('#ts').value = Math.max(20, Math.min(140, st.titleSize)); q('#tsn').value = st.titleSize;
    q('#ck').value = /^#[0-9a-f]{6}$/i.test(st.ink) ? st.ink : inkOf(st.ink);
    buildPapers(); buildFonts(); buildInks(); buildPresets(); sync(); draw();
    tipEl.textContent = t('preset.applied', { name: tName('preset', p.id, p.name) });
  }
  function buildPresets(){
    const box = q('#presets'); box.textContent = '';
    for (const p of allPresets()){
      const b = document.createElement('button');
      b.dataset.v = p.id; b.textContent = tName('preset', p.id, p.name);
      const mine = (cfg('presets') || []).some(x => x.id === p.id);
      b.title = mine ? t('tip.renameDelete') : t('preset.builtinTitle');
      if (mine){
        b.ondblclick = e => {
          e.preventDefault(); e.stopPropagation();
          const v = prompt(t('preset.renamePrompt'), p.name);
          if (v === null) return;
          const name = v.trim().slice(0, 24) || p.name;
          setCfg('presets', cfg('presets').map(x => x.id === p.id ? { ...x, name } : x));
          buildPresets();
        };
        b.oncontextmenu = e => {
          e.preventDefault();
          if (!confirm(t('preset.deleteConfirm', { name: p.name }))) return;
          setCfg('presets', cfg('presets').filter(x => x.id !== p.id));
          buildPresets();
        };
      }
      b.onclick = () => applyPreset(p);
      box.append(b);
    }
  }
  q('#psSave').onclick = () => {
    const name = (q('#psn').value || '').trim().slice(0, 24) || t('preset.defaultName', { n: (cfg('presets') || []).length + 1 });
    const style = {}; for (const k of STYLE_KEYS) style[k] = st[k];
    setCfg('presets', (cfg('presets') || []).concat([{ id: 'ps' + Date.now(), name, style }]));
    q('#psn').value = '';
    buildPresets();
    tipEl.textContent = t('preset.saved', { name });
  };

  // 标签页
  q('#tabs').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    mask.querySelectorAll('#tabs button').forEach(x => x.setAttribute('aria-pressed', x === b));
    mask.querySelectorAll('.pane').forEach(p => p.classList.toggle('on', p.dataset.p === b.dataset.v));
    if (blindBar) blindBar.editing(b.dataset.v === 'box');
  });
  q('#tw').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    st.titleWeight = +b.dataset.v; setCfg('titleWeight', st.titleWeight); sync(); draw();
  });
  // 正文字重。跟标题那排长一个样，就摆在内容框底下 —— 标题怎么调，正文就怎么调。
  q('#weight').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    st.weight = +b.dataset.v; setCfg('weight', st.weight); sync(); draw();
  });
  q('#theme').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    st.theme = b.dataset.v; setCfg('theme', st.theme); applyTheme(); sync();
  });

  q('#lang').onclick = e => {
    if (!e.target.closest('button')) return;
    const { resume, ...rest } = init, tab = mask.querySelector('#tabs button[aria-pressed=true]');
    Object.assign(st, { text: q('#t').value, title: q('#ti').value, source: q('#s').value, date: q('#d').value, headText: q('#hd').value, sourcePrefix: q('#sp').value });
    setCfg('uiLang', studioLocale === 'en' ? 'zh-CN' : 'en');
    document.removeEventListener('keydown', esc); pick.dispose(); full.dispose(); clearTimeout(fineTimer); clearTimeout(typingTimer);
    openPanel(st.text, { ...rest, resume: { st, tab: tab ? tab.dataset.v : 'text', blind: blindBar.state(), full: full.state() } });
  };

  const mkSwitch = (sel, key) => q(sel).addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    st[key] = b.dataset.v === '1'; setCfg(key, st[key]); sync(); draw();
  });
  mkSwitch('#swSrc', 'showSource'); mkSwitch('#swDate', 'showDate'); mkSwitch('#swHead', 'showHeader');
  // 三道线：按钮本身就是开关，亮着＝要
  for (const [sel, key] of [['#rHead','headRule'], ['#rTitle','titleRule'], ['#rFoot','footRule']]){
    q(sel).onclick = () => { st[key] = !st[key]; setCfg(key, st[key]); sync(); draw(); };
  }

  // 换纸时，只有当前这支墨在新纸上「读不出来」才自动换掉 ——
  // 用户挑的颜色要留住，但不能让人拿到一张黑字压克莱因蓝的图
  const MIN_CONTRAST = 3.2;
  function autoInk(){
    // 用「调完亮度之后」的纸色和墨色来判断，不然滑块一动这套判断就作废了
    const mean = paperMean(st.paper, st.paperLight);
    const cur  = shade(hex2rgb(inkOf(st.ink)), (st.inkLight || 0) / 100);
    if (contrast(cur, mean) >= MIN_CONTRAST) return null;
    const pick = bestInk(mean);
    st.ink = pick.id; setCfg('ink', pick.id);
    return tName('ink', pick.id, pick.name);
  }

  // 一枚纸的缩略图按钮。看图选纸比看名字快得多，这是这轮改版的核心。
  function paperTile(value, label, thumb, title){
    const b = document.createElement('button');
    b.className = 'sw3'; b.dataset.v = value; b.title = title || label;
    b.append(thumb);
    const cap = document.createElement('b'); cap.textContent = label; b.append(cap);
    b.onclick = () => {
      st.paper = value; setCfg('paper', st.paper); ownIt('paper');
      const swapped = autoInk();
      sync(); draw();
      if (swapped) tipEl.textContent = t('paper.autoInkSwapped', { name: swapped });
    };
    return b;
  }

  function buildPapers(){
    const bi = q('#paperBuiltin'), pk = q('#paperPack'), mine = q('#paperMine');
    bi.textContent = ''; pk.textContent = ''; mine.textContent = '';

    for (const [k, v] of Object.entries(PAPERS)){
      const c = document.createElement('canvas'); c.width = 72; c.height = 90;
      c.getContext('2d').drawImage(makePaper(k, 72, 90), 0, 0);
      bi.append(paperTile(k, tName('paper', k, v.name), c));
    }

    const ps = packs();
    q('#packHd').textContent = ps.length ? t('paper.pack') : t('paper.packEmpty');
    for (const s of ps){
      const im = document.createElement('img');
      im.src = s.portrait || s.landscape; im.loading = 'lazy';
      pk.append(paperTile('pk:' + s.key, s.cn || s.en, im,
                          t('paper.packTileTitle', { name: s.cn || s.en,
                            group: s.group === 'bold' ? t('paper.groupBold') : t('paper.groupSoft') })));
    }

    for (const p of cfg('myPapers')){
      const im = document.createElement('img'); im.src = p.data;
      const b = paperTile('my:' + p.id, p.name, im, t('tip.renameDelete'));
      b.ondblclick = e => {
        e.preventDefault(); e.stopPropagation();
        const v = prompt(t('paper.renamePrompt'), p.name);
        if (v === null) return;
        const name = v.trim().slice(0, 24) || p.name;
        setCfg('myPapers', cfg('myPapers').map(x => x.id === p.id ? { ...x, name } : x));
        buildPapers(); sync(); draw();
      };
      b.oncontextmenu = e => {
        e.preventDefault();
        if (!confirm(t('paper.deleteConfirm', { name: p.name }))) return;
        setCfg('myPapers', cfg('myPapers').filter(x => x.id !== p.id));
        myPaperImgs.delete(p.id); meanCache.delete('my:' + p.id);
        if (st.paper === 'my:' + p.id){ st.paper = 'rice'; setCfg('paper', st.paper); }
        buildPapers(); sync(); draw();
      };
      mine.append(b);
    }

    const box = mine;
    const add = document.createElement('button');
    add.className = 'sw3 plus'; add.textContent = t('paper.addTile'); add.title = t('paper.addTileTitle');
    add.onclick = async () => {
      const files = await pickFiles('image/*'); if (!files.length) return;
      tipEl.textContent = t('paper.importing');
      const list = cfg('myPapers').slice(); let ok = 0;
      for (const f of files){
        try {
          const data = await shrink(await readFile(f, 'url'));
          // 文件名要是「1.jpg」这种没信息量的，别拿来当名字，给个「我的纸N」
          const raw = f.name.replace(/\.[^.]+$/, '').trim();
          const name = (raw && !/^[\d\s_-]+$/.test(raw)) ? raw.slice(0, 24) : t('paper.defaultName', { n: list.length + 1 });
          list.push({ id:'p'+Date.now()+Math.floor(Math.random()*1e4), name, data });
          ok++;
        } catch { tipEl.textContent = t('paper.oneFail', { name: f.name }); }
      }
      setCfg('myPapers', list);
      const mb = (storedBytes()/1e6).toFixed(1);
      // 收尾话由真发生的事推出来，不写死「收了 N 张」
      tipEl.textContent = ok === files.length
        ? t('paper.importedAll', { n: ok, mb })
        : t('paper.importedSome', { total: files.length, n: ok, mb });
      if (storedBytes() > 9e6) tipEl.textContent += t('paper.storageFull');
      buildPapers(); sync(); draw();
    };
    box.append(add);

    const pkBtn = document.createElement('button');
    pkBtn.className = 'sw3 plus'; pkBtn.textContent = t('paper.addPack');
    pkBtn.title = t('paper.addPackTitle');
    pkBtn.onclick = async () => {
      const files = await pickFiles('.json,application/json'); if (!files.length) return;
      tipEl.textContent = t('paper.packReading');
      try {
        const text = await new Promise((res, rej) => {
          const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsText(files[0]);
        });
        const n = await installPack(text);
        // 收尾这句必须照事实说 —— 存不下的时候「以后不用再导」就是句谎话
        tipEl.textContent = installPack.persisted
          ? t('paper.packInstalled', { n })
          : t('paper.packVolatile', { n });
        buildPapers(); sync(); draw();
      } catch (e){ tipEl.textContent = t('paper.packBad', { msg: e.message }); }
    };
    box.append(pkBtn);
  }

  // 一行字体：**用它自己的样子写出它的名字**。挑字体本来就该这么挑。
  function fontRow(value, label, previewStack, hint, off){
    const b = document.createElement('button');
    b.dataset.v = value;
    if (off) b.dataset.off = '1';
    const s = document.createElement('span');
    s.textContent = label;
    if (previewStack) s.style.fontFamily = previewStack;
    b.append(s);
    if (hint){ const i = document.createElement('i'); i.textContent = hint; b.append(i); }
    return b;
  }

  // 「指名要某一款」的字单：中文、自装、西文排在一列。标题字体和选中的字共用这一份。
  function fillFonts(tb, firstLabel, withSys){
    tb.textContent = '';
    tb.append(fontRow('same', firstLabel, null, ''));
    for (const f of FONTS){
      if ((!f.probes.length && !withSys) || !fontAvailable(f)) continue;
      tb.append(fontRow(f.id, tName('font', f.id, f.name), cjkStack(f.id), t('font.hintCjk')));
    }
    for (const f of cfg('myFonts')) tb.append(fontRow(f.id, f.name, `"${f.id}"`, t('font.hintCustom')));
    for (const l of LATIN){
      if (!l.probes.length) continue;
      const hit = resolveFont(l); if (!hit) continue;
      tb.append(fontRow(l.id, `${l.name} — Aa`, `"${hit}"`, l.hint ? tName('hint', l.id, l.hint) : t('font.hintLatin')));
    }
  }

  function buildFonts(){
    // 正文字体
    const box = q('#font'); box.textContent = '';
    for (const f of FONTS){
      const ok = fontAvailable(f);
      const b = fontRow(f.id, tName('font', f.id, f.name), ok ? cjkStack(f.id) : null, ok ? '' : t('font.hintMissing'), !ok);
      if (!ok) b.title = t('font.missingTitle');
      box.append(b);
    }
    for (const f of cfg('myFonts')){
      const b = fontRow(f.id, f.name, `"${f.id}"`, t('font.hintCustom'));
      b.title = t('tip.rightDelete');
      b.oncontextmenu = e => {
        e.preventDefault();
        setCfg('myFonts', cfg('myFonts').filter(x => x.id !== f.id));
        if (st.font === f.id){ st.font = 'sys'; setCfg('font', 'sys'); }
        buildFonts(); sync(); draw();
      };
      box.append(b);
    }

    // 西文字体：列真装了的；嵌入方给了文件 URL 的也列（选中那一刻才装载，§9.3）
    const lb = q('#latin'); lb.textContent = '';
    for (const l of LATIN){
      const hit = l.probes.length ? resolveFont(l) : null;
      const url = !hit && l.probes.length ? embedFontUrls[l.id] : null;
      if (l.probes.length && !hit && !url) continue;
      const row = fontRow(l.id, l.id === 'none' ? t('font.noneLatin') : `${l.name} — Aa Bb 0123`,
                        hit ? `"${hit}"` : null, l.hint ? tName('hint', l.id, l.hint) : '');
      if (url) row.addEventListener('click', async e => {
        e.stopPropagation();               // 拦下通用委托，先装字再落选
        tipEl.textContent = t('font.urlLoading', { name: l.name });
        try {
          await ensureUrlFont(l.probes[0], url);
          if (!alive()) return;
          st.latinFont = l.id; setCfg('latinFont', st.latinFont);
          buildFonts(); sync(); draw();
          tipEl.textContent = '';
        } catch (err) {
          if (alive()) tipEl.textContent = t('font.urlFailed', { name: l.name });
        }
      });
      lb.append(row);
    }

    // 标题字体：中文和英文都能挑（挑了英文字，汉字会自动落回正文的中文字体）
    fillFonts(q('#swTitleFont'), t('font.sameAsBody'), false);

    const add = document.createElement('button');
    add.textContent = t('font.add'); add.style.fontSize = '12px';
    add.title = t('font.addTitle');
    add.onclick = async () => {
      const files = await pickFiles('.ttf,.otf,.woff,.woff2,font/*'); if (!files.length) return;
      const list = cfg('myFonts').slice();
      for (const f of files){
        if (f.size > 12*1024*1024){
          tipEl.textContent = t('font.tooBig', { name: f.name, mb: (f.size/1e6).toFixed(0) });
          continue;
        }
        try { list.push({ id:'f'+Date.now()+Math.floor(Math.random()*1e4),
                          name: f.name.replace(/\.[^.]+$/, '').slice(0, 24),
                          data: await readFile(f, 'url') }); }
        catch { tipEl.textContent = t('font.installFail', { name: f.name }); }
      }
      setCfg('myFonts', list); await ensureCustomFonts(); buildFonts(); sync(); draw();
    };
    box.append(add);

    const pickFont = (el, key) => el.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b || !b.dataset.v) return;
      if (b.dataset.off === '1'){
        tipEl.textContent = t('font.notInstalledTip');
        return;
      }
      st[key] = b.dataset.v; setCfg(key, st[key]); ownIt('font'); sync(); draw();
    });
    pickFont(box, 'font'); pickFont(q('#latin'), 'latinFont'); pickFont(q('#swTitleFont'), 'titleFont');
  }

  q('#bare').addEventListener('click', e => { const b = e.target.closest('button'); if (b){ st.noGround = b.dataset.v === '1'; sync(); draw(); } });
  const sync = () => {
    q('#bare').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', (b.dataset.v === '1') === st.noGround));
    mask.classList.toggle('bare', st.noGround);
    pick.refresh();
    const marks = [['#orient', st.orient], ['#pagesRow', st.pages],
                   ['#paperBuiltin', st.paper], ['#paperPack', st.paper], ['#paperMine', st.paper],
                   ['#font', st.font], ['#ink', st.ink], ['#weight', st.weight], ['#theme', st.theme],
                   ['#align', st.align], ['#talign', st.titleAlign], ['#vert', st.vertical?'1':'0'], ['#tvert', st.titleVertical?'1':'0'],
                   ['#metaInk', st.metaInk],
                   ['#quoteInk', st.quoteInk],
                   ['#latin', st.latinFont], ['#swTitleFont', st.titleFont], ['#tw', st.titleWeight],
                   ['#swSrc', st.showSource?'1':'0'], ['#swDate', st.showDate?'1':'0'],
                   ['#swHead', st.showHeader?'1':'0']];
    for (const [sel, val] of marks)
      mask.querySelectorAll(sel + ' button').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === String(val)));
    q('#s').disabled = !st.showSource; q('#sp').disabled = !st.showSource;
    q('#d').disabled = !st.showDate;
    q('#hd').disabled = !st.showHeader;
    q('#rHead').setAttribute('aria-pressed', st.headRule !== false);
    q('#rTitle').setAttribute('aria-pressed', st.titleRule !== false);
    q('#rFoot').setAttribute('aria-pressed', st.footRule !== false);
    const fmt = v => (v > 0 ? '+' : '') + v;
    q('#il').value = st.inkLight;   q('#ilv').textContent = fmt(st.inkLight);
    q('#pl').value = st.paperLight; q('#plv').textContent = fmt(st.paperLight);
    q('#offv').textContent = (st.offsetX || st.offsetY)
      ? t('layout.offsetVal', { x: Math.round(st.offsetX), y: Math.round(st.offsetY) }) : t('layout.offsetNone');
  };

  // 字号：滑块和数字框互相跟随，数字框可以超出滑块范围。
  // 正文一套、标题一套，但推进规则只写这一份 —— 同一件事写两处，迟早对不上。
  const mkSize = (key, rng, num, lo, hi, sLo, sHi) => {
    const set = v => {
      const n = Math.max(lo, Math.min(hi, Math.round(+v || DEF[key])));
      st[key] = n; setCfg(key, n);
      q(rng).value = Math.max(sLo, Math.min(sHi, n)); q(num).value = n;
      draw();
    };
    q(rng).oninput = e => set(e.target.value);
    q(num).oninput = e => { if (e.target.value !== '') set(e.target.value); };
  };
  mkSize('fontSize',  '#fs',  '#fsn', 12, 200, 20,  96);
  mkSize('titleSize', '#ts',  '#tsn', 12, 300, 20, 140);
  // 取色器：拖的时候就直接用上（st.ink 可以直接是个 #rrggbb，不必先存），存不存随意
  q('#ck').oninput = e => { st.ink = e.target.value; setCfg('ink', st.ink); ownIt('ink'); sync(); draw(); };
  q('#ckSave').onclick = () => {
    const c = q('#ck').value;
    const name = (q('#ckn').value || '').trim().slice(0, 24) || t('ink.defaultName', { n: (cfg('myInks') || []).length + 1 });
    const id = 'ink' + Date.now() + Math.floor(Math.random() * 1e4);
    setCfg('myInks', (cfg('myInks') || []).concat([{ id, name, c }]));
    st.ink = id; setCfg('ink', id);
    q('#ckn').value = '';
    buildInks(); sync(); draw();
    tipEl.textContent = t('ink.saved', { name, c });
  };
  q('#il').oninput = e => { st.inkLight   = +e.target.value; setCfg('inkLight',   st.inkLight);   sync(); draw(); };
  q('#pl').oninput = e => { st.paperLight = +e.target.value; setCfg('paperLight', st.paperLight); sync(); draw(); };
  const pick = mountPick({ mask, st, draw, alive, fillFonts });
  q('#t').oninput  = e => { pick.edited('body', e); drawTyping(); };
  q('#ti').oninput = e => { pick.edited('title', e); drawTyping(); };
  q('#s').oninput = drawTyping; q('#d').oninput = drawTyping;
  blindBar = mountBlind({ resume: back && back.blind, mask, st, draw, sync, alive, tip: m => { tipEl.textContent = m; },
    openTab: v => { const b = q('#tabs button[data-v="' + v + '"]'); if (b.getAttribute('aria-pressed') !== 'true') b.click(); },
    // 拖着的时候只重画第一张，不重建预览（重建的话手底下那层会被销毁，拖动当场断掉）
    repaint: draft => {
      plan = planPages(st); if (!plan.blind || !pageCanvases[0]) return null;
      const post = plan.blind.B.post; if (draft) plan.blind.B.post = [];
      clearTimeout(fineTimer); withDPR(1, () => renderPage(pageCanvases[0], st, plan, 0)); rough = true; fineTimer = setTimeout(settle, 1600); plan.blind.B.post = post;
      return plan;
    },
    kept: { list: () => (cfg('presets') || []).filter(p => p.style && p.style.blind),
            rename: (id, name) => { setCfg('presets', cfg('presets').map(x => (x.id === id ? { ...x, name } : x))); buildPresets(); },
            remove: id => { setCfg('presets', cfg('presets').filter(x => x.id !== id)); buildPresets(); } },
    keep: (name, blind) => {
      const style = {}; for (const k of STYLE_KEYS) style[k] = st[k];
      style.blind = blind;
      setCfg('presets', (cfg('presets') || []).concat([{ id: 'ps' + Date.now(), name, style }]));
      buildPresets();
    } });
  full = mountFull({ resume: back && back.full, mask, alive, tipEl });
  q('#hd').oninput = () => { setCfg('headText', q('#hd').value); drawTyping(); };

  const close = () => {
    // 自己的 Esc 监听无条件先摘：被新面板顶替后残留的那份也借这条路自清
    document.removeEventListener('keydown', esc);
    pick.dispose(); full.dispose();
    if (!alive()) return;
    fullLeave();
    if (vvStop) { vvStop(); vvStop = null; }
    mask.remove(); mask = null;
    // onClose 只在真关掉的那一次响 —— close 本身保持幂等
    if (typeof init.onClose === 'function') try { init.onClose(); } catch {}
  };
  q('#close').onclick = close;
  // 🔴 按下也得在遮罩上才算「点了外面」。在内容框里拖选、手滑到面板外才松开，
  //    浏览器会把这一下 click 算给遮罩 —— 面板当场关掉，写的字全没了。
  let downOnMask = false;
  mask.addEventListener('pointerdown', e => { downOnMask = e.target === mask; }, true);
  mask.onclick = e => { if (e.target === mask && downOnMask) close(); };
  // 正选着字的时候，Esc 先放开选中的字，再退全屏，再按一次才关面板
  const esc = e => { if (e.key === 'Escape' && !(alive() && (pick.drop() || blindBar.drop() || full.drop()))) close(); };
  document.addEventListener('keydown', esc);

  // ── 存 / 复制 ───────────────────────────────────────────────────
  q('#save').onclick = async () => {
    finish();
    const n = pageCanvases.length;
    const stamp = stampName();
    const sub = (cfg('subdir') || '').replace(/[\\/]+$/, '');
    let ok = 0, viaFallback = 0;
    tipEl.textContent = t('save.working', { n });
    for (let i = 0; i < n; i++){
      const blob = await new Promise(r => st.noGround ? pageCanvases[i].toBlob(r, 'image/png') : pageCanvases[i].toBlob(r, 'image/jpeg', 0.94));
      if (!blob) continue;
      const url = URL.createObjectURL(blob);
      const base = (n > 1 ? t('save.fileMulti', { stamp, i: i+1, n }) : t('save.fileOne', { stamp })).replace(/\.jpe?g$/, st.noGround ? '.png' : '.jpg');
      const name = (sub ? sub + '/' : '') + base;
      const done = await new Promise(res => {
        try {
          GM_download({ url, name, saveAs:false,
            onload : () => res('gm'),
            onerror: () => {
              const a = document.createElement('a'); a.href = url; a.download = base; a.click();
              res('fallback');
            } });
        } catch {
          const a = document.createElement('a'); a.href = url; a.download = base; a.click();
          res('fallback');
        }
      });
      if (done === 'gm') ok++; else viaFallback++;
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      await new Promise(r => setTimeout(r, 160));      // 连着触发下载浏览器会掐
    }
    // 说出真发生的事，不说固定句
    tipEl.textContent = viaFallback
      ? t('save.doneFallback', { n: ok + viaFallback, fb: viaFallback })
      : t('save.done', { n: ok, dir: sub ? sub + '/' : '' });
  };

  q('#copy').onclick = () => {
    finish();
    const cv = pageCanvases[selected]; if (!cv) return;
    cv.toBlob(async b => {
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': b })]);
        tipEl.textContent = pageCanvases.length > 1 ? t('copy.donePage', { n: selected+1 }) : t('copy.done');
      } catch { tipEl.textContent = t('copy.denied'); }
    }, 'image/png');
  };

  applyTheme();
  try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme); } catch {}
  q('#tabs').querySelector('button').click();      // 默认落在「文」这一屏
  if (back && back.tab !== 'box') q(`#tabs button[data-v="${back.tab}"]`).click();
  buildPapers(); buildFonts(); buildInks(); buildPresets(); sync(); draw();
  if (back && back.tab === 'box' && st.blind) q('#tabs button[data-v="box"]').click();      // 「盒」那一屏要等盲盒画出来才有
  if (blank && !back) setTimeout(() => { if (alive()) q('#t').focus(); }, 60);   // 空手起稿，光标直接落在内容框
  ensureCustomFonts().then(() => { if (!alive()) return; buildFonts(); sync(); draw(); });
  // 嵌入方捆的字（一款一二十兆）可能这会儿才下完：单子刷新；正拆着盲盒就不动那张脸
  try { document.fonts.addEventListener('loadingdone', function again(){ if (!alive()){ document.fonts.removeEventListener('loadingdone', again); return; } const n = FONTS.filter(fontAvailable).length; dropFontProbes(); if (FONTS.filter(fontAvailable).length === n) return; buildFonts(); sync(); if (!st.blind) draw(); }); } catch {}
  Promise.all(cfg('myPapers').map(p => new Promise(r => {
    const i = myPaper(p.id); i && !i.complete ? (i.onload = r, i.onerror = r) : r();
  }))).then(draw);
}

// 存纸的上限必须 ≥ 导出分辨率，否则纸会被放大 2 倍、纸纹糊掉，
// 那就是「给再高清的素材也白给」的那种坑。
const PAPER_MAX_W = Math.max(SIZES.portrait.w, SIZES.landscape.w) * DPR;   // 2880
const PAPER_MAX_H = 2900;
function shrink(dataUrl){
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, PAPER_MAX_W / img.width, PAPER_MAX_H / img.height);
      if (s >= 1 && dataUrl.length < 900e3) return res(dataUrl);
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      const cx = c.getContext('2d'); cx.imageSmoothingQuality = 'high';
      cx.drawImage(img, 0, 0, c.width, c.height);
      res(c.toDataURL('image/webp', 0.82));
    };
    img.onerror = rej; img.src = dataUrl;
  });
}
const storedBytes = () => cfg('myPapers').reduce((a,p) => a + p.data.length, 0)
                        + cfg('myFonts').reduce((a,f) => a + f.data.length, 0);

// ── 嵌入导出面（窄）────────────────────────────────────────────
// openPanel(text, init) 是全部入口；其余是素材接线和版本核对用。
window.__shijuEmbed = { SHIJU_VERSION, openPanel, setStudioLocale,
                        installPack, registerUrlPack, packs, paperMean, bestInk, planPages, renderPage };
})();
