// 同步拾句嵌入包到 vendor/shiju/（单一事实源在 willwefind/shiju 的 src/）
//
//   node tools/sync-shiju-vendor.mjs <拾句 checkout 路径>
//
// 在那边的仓里跑它自己的 build-vendor 直出到本仓 vendor/shiju/shiju-embed.js，
// 并写下 provenance 清单（版本 + 源提交）。vendor 文件是生成物，禁止手改 ——
// 要改行为去改拾句仓的 src/，改完重新同步。

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OD = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const src = process.argv[2];
if (!src || !fs.existsSync(path.join(src, 'tools', 'build-vendor.mjs'))) {
  console.error('用法：node tools/sync-shiju-vendor.mjs <拾句 checkout 路径>');
  console.error('（那个目录里要有 tools/build-vendor.mjs）');
  process.exit(1);
}

const outDir = path.join(OD, 'vendor', 'shiju');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, 'shiju-embed.js');

execFileSync('node', [path.join(src, 'tools', 'build-vendor.mjs'), outFile], { stdio: 'inherit' });

// 可再分发西文字体：阅读器没捆的 8 款带过去（连许可原文一起，OFL/Apache 要求随发）。
// IM Fell English / Special Elite 阅读器已捆，不重复；中文大字体一个不带（§9.2 红线）。
const VENDOR_FONTS = {
  fellPica: 'IM_Fell_DW_Pica',
  beau: 'Beau_Rivage',
  coral: 'Coral_Pixels',
  jim: 'Jim_Nightshade',
  limelight: 'Limelight',
  smokum: 'Smokum',
  tages: 'Tagesschrift',
  uncial: 'Uncial_Antiqua',
};
const fontsOut = path.join(outDir, 'fonts');
fs.mkdirSync(fontsOut, { recursive: true });
const fontUrls = {};
for (const [id, dir] of Object.entries(VENDOR_FONTS)) {
  const from = path.join(src, 'fonts', dir);
  const files = fs.readdirSync(from);
  const face = files.find(n => /\.(ttf|otf)$/i.test(n));
  if (!face) { console.error(`⚠️ ${dir} 里没找到字体文件，跳过`); continue; }
  const destDir = path.join(fontsOut, dir);
  fs.mkdirSync(destDir, { recursive: true });
  for (const n of files) fs.copyFileSync(path.join(from, n), path.join(destDir, n));
  fontUrls[id] = `vendor/shiju/fonts/${dir}/${face}`;
}

// 20 套信纸静态 vendor（Dawn 拍板：方案 A1）：40 张 webp 原件带走，
// 元数据从素材包 json 提炼（名字/组/代表色），dataURL 一个字节不进 manifest。
// 嵌入 Studio 开面板时 registerUrlPack 登记：不占浏览器存储配额，选纸才取图。
const papersOut = path.join(outDir, 'papers');
fs.mkdirSync(papersOut, { recursive: true });
const packJson = JSON.parse(fs.readFileSync(path.join(src, 'papers', 'letterpaper-20sets.pack.json'), 'utf8'));
const paperSets = [];
for (const s of packJson.sets || []) {
  const urls = {};
  let missing = false;
  for (const orient of ['portrait', 'landscape']) {
    const file = `${s.key}_${orient}.webp`;
    if (!fs.existsSync(path.join(src, 'papers', file))) { missing = true; break; }
    fs.copyFileSync(path.join(src, 'papers', file), path.join(papersOut, file));
    urls[orient] = `vendor/shiju/papers/${file}`;
  }
  if (missing) { console.error(`⚠️ ${s.key} 缺原件 webp，整套跳过`); continue; }
  paperSets.push({ key: s.key, group: s.group, en: s.en, cn: s.cn, mean: s.mean,
                   portrait: urls.portrait, landscape: urls.landscape });
}

const version = JSON.parse(fs.readFileSync(path.join(src, 'manifest.json'), 'utf8')).version;
const commit = execFileSync('git', ['-C', src, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const dirty = execFileSync('git', ['-C', src, 'status', '--porcelain'], { encoding: 'utf8' }).trim() ? '-dirty' : '';

fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify({
  name: 'shiju-embed',
  version,
  source: 'https://github.com/willwefind/shiju',
  sourceCommit: commit + dirty,
  license: 'AGPL-3.0',
  generatedBy: 'tools/sync-shiju-vendor.mjs',
  // 选中才装载的西文字体（拾句「字」屏用，§9.3）
  fonts: fontUrls,
  // 静态信纸素材包（§10：元数据在此、图选中才取；来源与授权同拾句仓 papers/）
  papers: { name: packJson.name || '信纸', sets: paperSets },
  // 去重清单（§9.1）：谁复用阅读器、谁走懒加载、谁只认系统
  fontReuse: {
    'Huiwen Mincho': 'reuse Our Dialogues bundle',
    'Zhuque Fangsong': 'reuse Our Dialogues bundle',
    'IM Fell English': 'reuse Our Dialogues bundle',
    'Special Elite': 'reuse Our Dialogues bundle',
    'KingHwa OldSong': 'system/local only (32MB, never bundled)',
    'IM Fell DW Pica / Beau Rivage / Coral Pixels / Jim Nightshade / Limelight / Smokum / Tagesschrift / Uncial Antiqua':
      'vendored, FontFace-loaded on selection',
    'other CJK fonts': 'system-installed only (§9.2)',
  },
}, null, 2) + '\n');

console.log(`vendor/shiju 同步完成：v${version} @ ${commit.slice(0, 7)}${dirty} · 字体 ${Object.keys(fontUrls).length} 款 · 信纸 ${paperSets.length} 套`);
