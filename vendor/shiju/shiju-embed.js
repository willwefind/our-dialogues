// 拾句 · 嵌入包（生成物，别手改）
// 事实源：willwefind/shiju 的 src/ 碎片；重新生成：node tools/build-vendor.mjs
// 版本：0.17.0 · 许可：AGPL-3.0（见源仓 LICENSE）
(function () {
'use strict';
const SHIJU_VERSION = '0.17.0';

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
  myInks: [],           // [{id,name,c}] 自己调的墨
  align: 'left',        // 正文对齐（在版心里，不是贴纸边）
  titleAlign: 'center',
  vertical: false,      // 竖排：字从上往下，列从右往左
  offsetX: 0, offsetY: 0,   // 整块位移（在预览图上拖出来的）
  metaInk: 'auto',      // 题头/出处/日期/线的颜色。auto = 跟着纸深浅自动定
  // 引号里那段话的颜色。auto = 跟着纸深浅自动定（原来的橙）；same = 跟正文一个色
  // （＝不给引号变色）；也可以指定任何一支墨或直接一个 #rrggbb。
  quoteInk: 'auto',
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
const DPR = 2;

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
                    'headRule','titleRule','footRule','sourcePrefix','titleVertical'];

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
  { id:'zhuque',   name:'朱雀仿宋',  probes:['Zhuque Fangsong (technical preview)','Zhuque Fangsong (technical prev','朱雀仿宋（预览测试版）','朱雀仿宋'] },
  { id:'jinghua',  name:'京華老宋',  probes:['KingHwaOldSong','京華老宋體','京華老宋体'] },
  { id:'huiwen',   name:'汇文明朝',  probes:['Huiwen-mincho','汇文明朝体'] },
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
  const custom = cfg('myFonts').find(f => f.id === id);
  if (custom) return `"${custom.id}",${SYS}`;
  const f = FONTS.find(f => f.id === id);
  const hit = f && resolveFont(f);
  return hit ? `"${hit}",${SYS}` : SYS;
}
// 从任何一张表里把「系统里真正叫什么」解出来：自装的 → 中文表 → 西文表
function familyOf(id){
  const custom = cfg('myFonts').find(f => f.id === id);
  if (custom) return custom.id;
  const f = FONTS.find(x => x.id === id); if (f) return resolveFont(f);
  const l = LATIN.find(x => x.id === id); if (l) return resolveFont(l);
  return null;
}
// 标题可以挑中文字，也可以挑英文字。挑了英文字时它管拉丁，汉字自动落回正文的中文字体。
function titleStack(st){
  if (!st.titleFont || st.titleFont === 'same') return fontStack(st.font, st.latinFont);
  const hit = familyOf(st.titleFont);
  return hit ? `"${hit}",${cjkStack(st.font)}` : fontStack(st.font, st.latinFont);
}

// 西文字体拼在最前面。它没有的字形（汉字）浏览器会自动往后找，不用我们分流字符。
function fontStack(id, latinId){
  const base = cjkStack(id);
  const lid = latinId === undefined ? cfg('latinFont') : latinId;
  if (!lid || lid === 'none') return base;
  const custom = cfg('myFonts').find(f => f.id === lid);
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
const packs = () => (_packs || (_packs = cfg('packs') || []));
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
  _packs = sets; packImgs.clear(); meanCache.clear();
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
// track = 逐字字距。题头/出处是带字距画的，折行时不把它算进来，
// 行就会比版心宽（每字多几像素，三十来个字就多出上百）。
function wrap(ctx, str, width, track){
  const t = track || 0;
  const lines = []; let cur = '', w = 0;
  for (let tok of tokenize(str)){
    const tw = ctx.measureText(tok).width + t * tok.length;
    if (cur && w + tw > width){
      // 避尾：行尾不能是「（ 这类开引号，把它拉到下一行
      while (cur && NO_END.includes(cur.at(-1))){
        tok = cur.at(-1) + tok; w -= ctx.measureText(cur.at(-1)).width + t; cur = cur.slice(0, -1);
      }
      lines.push(cur); cur = ''; w = 0;
    }
    // 避头：句读不能站行首。先试着塞回上一行；塞不下就把上一行最后一个字一起拉下来（追出）。
    // 🔴 早先这里是无条件塞回去的 —— 行就悄悄超出版心，
    //    平时看不出来，一做对齐立刻露馅（右对齐会算出负偏移，字跑到版心左边去）。
    if (!cur && NO_START.includes(tok[0]) && lines.length){
      const prev = lines[lines.length - 1];
      if (ctx.measureText(prev + tok).width + t * (prev.length + tok.length) <= width){
        lines[lines.length - 1] = prev + tok; continue;
      }
      if (prev.length > 1){
        const moved = prev.at(-1);
        lines[lines.length - 1] = prev.slice(0, -1);
        cur = moved; w = ctx.measureText(moved).width + t;
      }
    }
    cur += tok; w += tw;
  }
  if (cur) lines.push(cur);
  return lines;
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
function drawRich(ctx, x, y, line, inkColor, quoteColor, stroke, depth0 = 0){
  let depth = depth0, run = '', runCol = depth0 > 0 ? quoteColor : inkColor;
  const flush = () => {
    if (!run) return;
    ctx.fillStyle = runCol;
    if (stroke > 0){
      ctx.strokeStyle = runCol; ctx.lineWidth = stroke;
      ctx.lineJoin = 'round'; ctx.miterLimit = 2;
      ctx.strokeText(run, x, y);
    }
    ctx.fillText(run, x, y);
    x += ctx.measureText(run).width;
    run = '';
  };
  for (const ch of line){
    if ('「『“'.includes(ch)) depth++;
    const col = depth > 0 ? quoteColor : inkColor;
    if (col !== runCol){ flush(); runCol = col; }
    run += ch;
    if ('」』”'.includes(ch)) depth = Math.max(0, depth - 1);
  }
  flush();
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

// 把一段话切成竖排的列。每列是一串字符，列高由版心高度决定。
// 🔴 英文串竖排时整体旋转，实际吃掉的高度＝它的渲染宽度，不是「字数×某个系数」。
//    早先按 0.5 估，估少了列就漏到纸外去。现在真去量。
// 一列排下来有多高。🔑 这套规则必须和 drawColumn 的推进**一模一样** ——
// 折列时估一套、画的时候走另一套，就一定会对不上（英文串按渲染宽度推进，
// 不是「字数×系数」；空格能不能并进英文串也有讲究）。所以两边都走这个函数的规则。
function vAdvance(ctx, col, size){
  let h = 0, i = 0;
  while (i < col.length){
    if (isLatin(col[i])){
      let run = '';
      while (i < col.length && (isLatin(col[i]) || (col[i] === ' ' && isLatin(col[i+1] || '')))) run += col[i++];
      h += ctx.measureText(run).width;
      continue;
    }
    h += size; i++;
  }
  return h;
}

// colH 是像素高度，不是格子数
function wrapVertical(str, size, colH, ctx, mk){
  if (!ctx){ const c = (mk || newMeasure)(); c.font = `${size}px serif`; ctx = c; }
  const cols = [];
  let cur = '';
  for (let tok of tokenize(str)){
    if (cur && vAdvance(ctx, cur + tok, size) > colH){
      while (cur && NO_END.includes(cur.at(-1))){ tok = cur.at(-1) + tok; cur = cur.slice(0, -1); }
      if (cur){ cols.push(cur); cur = ''; }
    }
    if (!cur && NO_START.includes(tok[0]) && cols.length){ cols[cols.length-1] += tok; continue; }
    cur += tok;
  }
  if (cur) cols.push(cur);
  return cols;
}

// 画一列竖排的字。返回这一列实际用掉的高度。
function drawColumn(ctx, x, y, col, size, inkColor, quoteColor, stroke, depth0 = 0){
  let depth = depth0, cy = y;
  let i = 0;
  while (i < col.length){
    const ch = col[i];
    if ('「『“'.includes(ch)) depth++;
    const c = depth > 0 ? quoteColor : inkColor;
    ctx.fillStyle = c;
    if (stroke > 0){ ctx.strokeStyle = c; ctx.lineWidth = stroke; ctx.lineJoin = 'round'; ctx.miterLimit = 2; }

    // 英文/数字连成一串，整串顺时针转 90° 写，读起来才是正的
    if (isLatin(ch)){
      let run = '';
      while (i < col.length && (isLatin(col[i]) || (col[i] === ' ' && isLatin(col[i+1] || '')))) run += col[i++];
      const w = ctx.measureText(run).width;
      ctx.save();
      ctx.translate(x + size * 0.5, cy);
      ctx.rotate(Math.PI / 2);
      if (stroke > 0) ctx.strokeText(run, 0, -size * 0.5);
      ctx.fillText(run, 0, -size * 0.5);
      ctx.restore();
      cy += w;
      continue;
    }

    const cw = ctx.measureText(ch).width;
    if (V_ROTATE.includes(ch)){
      ctx.save();
      ctx.translate(x + size * 0.5, cy);
      ctx.rotate(Math.PI / 2);
      if (stroke > 0) ctx.strokeText(ch, 0, -size * 0.5);
      ctx.fillText(ch, 0, -size * 0.5);
      ctx.restore();
    } else if (V_CORNER.includes(ch)){
      // 句读在竖排里坐格子的右上角
      const px = x + size * 0.42, py = cy - size * 0.42;
      if (stroke > 0) ctx.strokeText(ch, px, py);
      ctx.fillText(ch, px, py);
    } else {
      const px = x + (size - cw) / 2;
      if (stroke > 0) ctx.strokeText(ch, px, cy);
      ctx.fillText(ch, px, cy);
    }
    if ('」』”'.includes(ch)) depth = Math.max(0, depth - 1);
    cy += size;
    i++;
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
//  5. 分页
//     把正文压成一串「块」（行 / 段间空档），再按页容量流进若干张纸。
// ════════════════════════════════════════════════════════════════════
// cross = 与流动方向垂直的那条边：横排时是版心宽，竖排时是版心高。
// 两种排法都吐出同样形状的 items（一行 / 一列），所以下面的分页算法一字不用改。
function buildItems(ctx, text, cross, fontSize, vertical){
  const LH = Math.round(fontSize * 1.72), GAP = Math.round(fontSize * .62);
  // 空行＝分段（段间留空档）；单个换行＝硬换行（照断，不留空档）。
  // 🔴 早先段内的单换行被 replace 抹掉了 —— 用户敲的回车在纸上凭空消失。
  const paras = text.split(/\n{2,}/).map(s => s.replace(/[ \t]+\n/g, '\n').trim()).filter(Boolean);
  const items = [];
  paras.forEach((p, i) => {
    if (i) items.push({ gap: true, h: GAP });
    for (const hard of p.split('\n')){
      if (!hard.trim()){ items.push({ gap: true, h: LH }); continue; }   // 段内空行＝空一行
      if (vertical){
        for (const c of wrapVertical(hard, fontSize, cross, ctx)) items.push({ text: c, h: LH });
      } else {
        for (const ln of wrap(ctx, hard, cross)) items.push({ text: ln, h: LH });
      }
    }
  });
  return { items, LH, GAP };
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
  const t = (st.title || '').trim();
  if (!t) return { lines: [], h: 0, w: 0, size: 0, lh: 0, vertical: false };
  const size = titleFontSize(st);
  const lh = Math.round(size * 1.42);
  const ctx = (mk || newMeasure)();
  // 🔴 latinFont 必须显式从 st 传：不传的话 fontStack 会去读存储里的配置，
  //    当前状态被无声忽略 —— 会变成「选了西文字体却没反应」。
  ctx.font = `${size}px ${titleStack(st)}`;
  // 标题的排向跟正文分开定：竖排正文配横标题是常见排法，配竖标题也是，让用户自己挑
  if (st.titleVertical){
    const cols = t.split(/\n+/).flatMap(line => wrapVertical(line, size, availH || 600, ctx));
    const longest = cols.reduce((a, c) => Math.max(a, vAdvance(ctx, c, size)), 0);
    return { lines: cols, vertical: true, size, lh,
             w: cols.length * lh + Math.round(size * 0.6),
             h: longest + Math.round(size * 0.9) };
  }
  const lines = t.split(/\n+/).flatMap(line => wrap(ctx, line, COL));
  return { lines, vertical: false, size, lh, w: COL,
           h: lines.length * lh + Math.round(size * 0.9) };
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
  const stack = fontStack(st.font, st.latinFont);

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
  const S = SIZES[st.orient] || SIZES.portrait;
  const COL0 = S.w - S.pad * 2;
  const stack = fontStack(st.font, st.latinFont);
  const probe = (mk || newMeasure)();
  // 竖标题的列长受版心高度限制，而版心高度又要先知道标题占多少 —— 先按整页高度估一轮
  const ch = chrome(st, COL0, S.h - S.pad*2, mk);
  // 🔴 正文字号必须设在 chrome() **之后**：chrome 量题头/出处时会把 font 改成 22/26px，
  //    共用同一块量具的话，先设就被它改掉了 —— 正文会按 22px 折行，静默错到底。
  probe.font = `${st.fontSize}px ${stack}`;
  // 版心高度。按最坏情况留（题头、标题、出处都按每页都在算）：牺牲一点留白，换绝不溢出
  const box0 = S.h - S.pad*2 - ch.head - ch.title - ch.src - ch.foot;
  const { items } = buildItems(probe, st.text, st.vertical ? box0 : COL0, st.fontSize, st.vertical);
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

function renderPage(canvas, st, plan, idx){
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

  const photo = st.paper.startsWith('pk:') ? packImg(st.paper.slice(3), st.orient)
              : st.paper.startsWith('my:') ? myPaper(st.paper.slice(3)) : null;
  if (!(photo && drawCover(ctx, photo, W, H))) ctx.drawImage(makePaper(photo ? 'rice' : st.paper, W, H, idx), 0, 0);

  // 纸张明暗：盖一层白/黑。alpha 与 shade() 用的是同一个 t，两边算出来的颜色一致。
  const pl = (st.paperLight || 0) / 100;
  if (pl){
    ctx.fillStyle = pl > 0 ? `rgba(255,255,255,${pl})` : `rgba(0,0,0,${-pl})`;
    ctx.fillRect(0, 0, W, H);
  }

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

  // 标题：只印第一页。横排正文时它占顶上那条带（横竖两种排向都在这条带里画）
  if (ch.title){
    if (idx === 0){
      ctx.font = `${title.size}px ${titleStack(st)}`;
      const tsw = strokeFor(st.titleWeight, title.size);
      if (title.vertical){
        // 竖标题立在这条带里，列从右往左；titleAlign 管这一叠列往哪边靠
        const bw = title.lines.length * title.lh;
        let tx = S.pad + alignOffset(st.titleAlign, COL, bw) + bw, tqd = 0;
        for (const col of title.lines){
          tx -= title.lh;
          drawColumn(ctx, tx, y, col, title.size, ink, quote, tsw, tqd);
          tqd = quoteDepthAfter(col, tqd);
        }
        if (st.titleRule !== false){
          ctx.fillStyle = rule;
          ctx.fillRect(S.pad + alignOffset(st.titleAlign, COL, bw) - Math.round(title.size*0.34),
                       y, 1, ch.title - Math.round(title.size * 0.5));
        }
      } else {
        let ty = y, tqd = 0;
        for (const ln of title.lines){
          const w = ctx.measureText(ln).width;
          drawRich(ctx, S.pad + alignOffset(st.titleAlign, COL, w), ty, ln, ink, quote, tsw, tqd);
          tqd = quoteDepthAfter(ln, tqd);
          ty += title.lh;
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
  ctx.font = `${st.fontSize}px ${stack}`;
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
      ctx.font = `${title.size}px ${titleStack(st)}`;
      const tsw = strokeFor(st.titleWeight, title.size);
      let tx = S.pad + COL - ch.headW - Math.round(title.size * 0.3), tqd = 0;
      for (const col of title.lines){
        tx -= title.lh;
        drawColumn(ctx, tx, top + alignOffset(st.titleAlign, colH, vAdvance(ctx, col, title.size)),
                   col, title.size, ink, quote, tsw, tqd);
        tqd = quoteDepthAfter(col, tqd);
      }
      if (st.titleRule !== false){ ctx.fillStyle = rule; ctx.fillRect(bandR, top, 1, colH); }
    }

    ctx.font = `${st.fontSize}px ${stack}`;
    let x = bandR - Math.max(0, (band - used) / 2) + ox;
    let qd = quoteDepthAtPage(pages, idx);
    for (const it of pages[idx]){
      x -= it.h;
      if (it.gap){ qd = 0; continue; }
      const h = vAdvance(ctx, it.text, st.fontSize);
      const cy = top + alignOffset(st.align, colH, h) + oy;
      drawColumn(ctx, x, cy, it.text, st.fontSize, ink, quote, sw, qd);
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
        const w = ctx.measureText(it.text).width;
        drawRich(ctx, S.pad + alignOffset(st.align, COL, w) + ox, y, it.text, ink, quote, sw, qd);
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
//  Studio 界面语言（zh-CN / en）
// ════════════════════════════════════════════════════════════════════
// 只管 Studio Shell 的界面文字（面板、药丸、提示、确认框）。
// 内容与内容默认值不在此列：题头默认「摘 录」、出处前缀「—— 」、提示句
// TAGLINES 是**作品上的字**，不是界面文字，保持原样（已声明的取舍）。
// 适配器注入：嵌入方开面板时传 init.locale（'zh-CN' | 'en' | 'auto'），
// 用户脚本自己走 auto = 浏览器语言（zh-* → zh-CN，其余 → en）。
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
.mask{position:fixed;inset:0;z-index:2147483647;background:var(--veil);
      display:flex;align-items:center;justify-content:center;padding:18px}
.box{background:var(--bg);border-radius:8px;max-width:1240px;width:100%;max-height:95vh;
     display:flex;gap:18px;padding:18px;box-shadow:var(--shadow)}
.side{width:308px;flex:0 0 308px;overflow:auto;padding-right:6px}
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
.pages{flex:1;min-height:0;overflow:auto;display:flex;flex-wrap:wrap;gap:14px;align-content:flex-start;
       justify-content:center;padding:4px}
.pg{position:relative;cursor:pointer}
/* touch-action:pinch-zoom —— 整块位移是在画布上按住拖出来的。触屏上不写这一句，
   单指拖会被浏览器当成滚动手势收走（pointerdown 里 preventDefault 挡不住滚动，
   挡它的就是 touch-action），于是手机上「拖不动」。留着 pinch-zoom 是为了还能双指放大看细节。 */
.pg canvas{display:block;max-width:100%;box-shadow:0 6px 20px rgba(0,0,0,.18);border-radius:2px;
       outline:2px solid transparent;outline-offset:3px;touch-action:pinch-zoom}
.pg[aria-selected=true] canvas{outline-color:rgba(185,32,11,.7)}
.pg span{position:absolute;left:6px;top:6px;background:rgba(18,16,14,.72);color:#faf8f4;
       font-size:10px;padding:1px 6px;border-radius:3px}

/* 手机：左右分栏在窄屏上必死 —— 侧栏钉死 308px，预览区被挤成 0 宽，
   实测 375px 视口下画布量出来就是 0×0（能操作，但一眼都看不见成品）。
   改成上下叠：预览在上，控制在下。 */
@media (max-width: 760px){
  .mask{padding:0}
  .box{flex-direction:column;gap:10px;padding:12px;border-radius:0;
       width:100%;height:100dvh;max-height:100dvh}
  /* 55vh：竖版卡片按屏宽铺开正好这么高，整张能一眼看全，不用滚 */
  .view{order:-1;flex:0 0 auto;max-height:55vh;min-height:0}
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

let host, root, pill, mask, tipEl, hideTimer;
let pageCanvases = [], selected = 0;

function ui(){
  if (host && host.isConnected) return;
  host = document.createElement('div');
  host.style.cssText = 'all:initial;position:static';
  root = host.attachShadow({ mode: 'open' });
  const st = document.createElement('style'); st.textContent = CSS; root.append(st);
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
  pill.style.left = Math.min(x, innerWidth - 70) + 'px';
  pill.style.top  = Math.max(8, y - 44) + 'px';
  pill.hidden = false;
  pill.onclick = () => { pill.hidden = true; openPanel(text); };
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => { if (pill) pill.hidden = true; }, 7000);
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
  setStudioLocale(init.locale || 'auto');
  ui();
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
        <h2>${t('app.title')}<span class="sw" id="theme" style="float:right">
          <button data-v="auto">${t('theme.auto')}</button><button data-v="day">${t('theme.day')}</button><button data-v="night">${t('theme.night')}</button>
        </span></h2><p class="h" id="tag"></p>

        <div class="tabs" id="tabs">
          <button data-v="text">${t('tab.text')}</button><button data-v="paper">${t('tab.paper')}</button>
          <button data-v="font">${t('tab.font')}</button><button data-v="ink">${t('tab.ink')}</button>
          <button data-v="layout">${t('tab.layout')}</button>
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
          <textarea id="t"></textarea>
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

        <div class="acts">
          <button class="save" id="save">${t('act.save')}</button>
          <button class="copy" id="copy">${t('act.copy')}</button>
        </div>
        <div class="acts"><button class="close" id="close">${t('act.close')}</button></div>
        <div class="tip" id="tip"></div>
      </div>
      <div class="view">
        <div class="count" id="count"></div>
        <div class="pages" id="pgs"></div>
      </div>
    </div>`;
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
  let plan = null, dragging = false;
  // 拖的时候只重画已有的画布，绝不重建 DOM ——
  // 🔴 早先 draw() 每次都把预览区整个清空重建，正在拖的那个 canvas 当场被销毁，
  //    指针捕获立刻断掉，于是「只能拖动一下下」。不是范围小，是只生效了一帧。
  const redrawOnly = () => {
    if (!alive() || !plan) return;
    pageCanvases.forEach((cv, i) => { if (plan.pages[i]) renderPage(cv, st, plan, i); });
  };
  const draw = () => {
    if (!alive()) return;
    st.text = q('#t').value; st.source = q('#s').value; st.date = q('#d').value;
    st.headText = q('#hd').value; st.title = q('#ti').value;
    st.sourcePrefix = q('#sp').value;
    if (dragging){ redrawOnly(); return; }
    try {
      plan = planPages(st);
      const box = q('#pgs');
      box.textContent = ''; pageCanvases = [];
      plan.pages.forEach((_, i) => {
        const wrapEl = document.createElement('div');
        wrapEl.className = 'pg'; wrapEl.dataset.i = i;
        const cv = document.createElement('canvas');
        renderPage(cv, st, plan, i);
        // 缩到能并排看下：一张时给大，多张时按张数分
        const per = plan.pages.length === 1 ? 1 : (plan.pages.length === 2 ? .5 : .33);
        cv.style.width = `min(${Math.round(per*100)}% , ${plan.W > plan.H ? 620 : 420}px)`;
        cv.style.cursor = 'move';
        // 在预览图上直接拖 = 整块位移。按显示比例换算回真实像素，拖多少就挪多少。
        cv.onpointerdown = e => {
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
      if (selected >= plan.pages.length) selected = plan.pages.length - 1;
      markSel();
      // 张数、尺寸、以及「没照你说的办」的时候必须说出来，不能默默给个别的结果
      const S0 = SIZES[st.orient] || SIZES.portrait;
      const grew = plan.H > S0.h || plan.W > S0.w;
      const want = st.pages === 'auto' ? 0 : parseInt(st.pages, 10);
      const notes = [];
      if (grew) notes.push(t('count.grewNote'));
      if (want && plan.pages.length < want) notes.push(t('count.fewerNote', { want, got: plan.pages.length }));
      q('#count').textContent =
        t('count.pages', { n: plan.pages.length, w: plan.W, h: plan.H, ew: plan.W*DPR, eh: plan.H*DPR })
        + (notes.length ? t('count.notesGlue') + notes.join(t('count.notesJoin')) : '');
    } catch (e){ tipEl.textContent = t('count.renderFail', { msg: e.message }); }
  };
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
      st.ink = b.dataset.v; setCfg('ink', st.ink); sync(); draw();
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
    for (const k of STYLE_KEYS) if (k in p.style){ st[k] = p.style[k]; setCfg(k, st[k]); }
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
      st.paper = value; setCfg('paper', st.paper);
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

    // 西文字体：只列真装了的，每行用它自己写 "Aa Bb 0123"
    const lb = q('#latin'); lb.textContent = '';
    for (const l of LATIN){
      const hit = l.probes.length ? resolveFont(l) : null;
      if (l.probes.length && !hit) continue;
      lb.append(fontRow(l.id, l.id === 'none' ? t('font.noneLatin') : `${l.name} — Aa Bb 0123`,
                        hit ? `"${hit}"` : null, l.hint ? tName('hint', l.id, l.hint) : ''));
    }

    // 标题字体：中文和英文都能挑（挑了英文字，汉字会自动落回正文的中文字体）
    const tb = q('#swTitleFont'); tb.textContent = '';
    tb.append(fontRow('same', t('font.sameAsBody'), null, ''));
    for (const f of FONTS){
      if (!f.probes.length || !fontAvailable(f)) continue;
      tb.append(fontRow(f.id, tName('font', f.id, f.name), cjkStack(f.id), t('font.hintCjk')));
    }
    for (const f of cfg('myFonts')) tb.append(fontRow(f.id, f.name, `"${f.id}"`, t('font.hintCustom')));
    for (const l of LATIN){
      if (!l.probes.length) continue;
      const hit = resolveFont(l); if (!hit) continue;
      tb.append(fontRow(l.id, `${l.name} — Aa`, `"${hit}"`, l.hint ? tName('hint', l.id, l.hint) : t('font.hintLatin')));
    }

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
      st[key] = b.dataset.v; setCfg(key, st[key]); sync(); draw();
    });
    pickFont(box, 'font'); pickFont(q('#latin'), 'latinFont'); pickFont(q('#swTitleFont'), 'titleFont');
  }

  const sync = () => {
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
  q('#ck').oninput = e => { st.ink = e.target.value; setCfg('ink', st.ink); sync(); draw(); };
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
  q('#t').oninput = draw; q('#s').oninput = draw; q('#d').oninput = draw;
  q('#hd').oninput = () => { setCfg('headText', q('#hd').value); draw(); };
  q('#ti').oninput = draw;

  const close = () => {
    // 自己的 Esc 监听无条件先摘：被新面板顶替后残留的那份也借这条路自清
    document.removeEventListener('keydown', esc);
    if (!alive()) return;
    mask.remove(); mask = null;
    // onClose 只在真关掉的那一次响 —— close 本身保持幂等
    if (typeof init.onClose === 'function') try { init.onClose(); } catch {}
  };
  q('#close').onclick = close;
  mask.onclick = e => { if (e.target === mask) close(); };
  const esc = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', esc);

  // ── 存 / 复制 ───────────────────────────────────────────────────
  q('#save').onclick = async () => {
    const n = pageCanvases.length;
    const stamp = stampName();
    const sub = (cfg('subdir') || '').replace(/[\\/]+$/, '');
    let ok = 0, viaFallback = 0;
    tipEl.textContent = t('save.working', { n });
    for (let i = 0; i < n; i++){
      const blob = await new Promise(r => pageCanvases[i].toBlob(r, 'image/jpeg', 0.94));
      if (!blob) continue;
      const url = URL.createObjectURL(blob);
      const base = n > 1 ? t('save.fileMulti', { stamp, i: i+1, n }) : t('save.fileOne', { stamp });
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
  buildPapers(); buildFonts(); buildInks(); buildPresets(); sync(); draw();
  if (blank) setTimeout(() => { if (alive()) q('#t').focus(); }, 60);   // 空手起稿，光标直接落在内容框
  ensureCustomFonts().then(() => { if (!alive()) return; buildFonts(); sync(); draw(); });
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
                        installPack, packs, paperMean, bestInk, planPages, renderPage };
})();
