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
}, null, 2) + '\n');

console.log(`vendor/shiju 同步完成：v${version} @ ${commit.slice(0, 7)}${dirty}`);
