#!/usr/bin/env node
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadRuntime() {
  const runtime = {
    Blob,
    DecompressionStream,
    File,
    Response,
    TextDecoder,
    TextEncoder,
    URL,
    console
  };
  runtime.window = runtime;
  runtime.globalThis = runtime;
  vm.createContext(runtime);
  for (const relativePath of [
    "src/core/schema.js",
    "src/core/zip.js",
    "src/adapters/contract.js",
    "src/adapters/mufy.js",
    "src/adapters/registry.js"
  ]) {
    const source = await readFile(path.join(repositoryRoot, relativePath), "utf8");
    vm.runInContext(source, runtime, { filename: relativePath });
  }
  return runtime.OD;
}

async function inputFiles(inputs) {
  const files = [];
  for (const input of inputs) {
    const info = await stat(input);
    if (info.isDirectory()) {
      for (const entry of await readdir(input, { withFileTypes: true })) {
        if (entry.isFile() && entry.name.toLowerCase().endsWith(".zip")) files.push(path.join(input, entry.name));
      }
    } else if (info.isFile() && input.toLowerCase().endsWith(".zip")) {
      files.push(input);
    }
  }
  return files;
}

function increment(record, key) {
  record[key] = (record[key] || 0) + 1;
}

async function main() {
  const inputs = process.argv.slice(2);
  if (!inputs.length) throw new Error("Usage: node tools/smoke-mufy-rich-blocks.mjs <mufy.zip-or-directory> [...]");
  const OD = await loadRuntime();
  const paths = await inputFiles(inputs);
  const summary = {
    format: "our-dialogues.mufy-rich-block-smoke.v1",
    zipFileCount: paths.length,
    parsedZipCount: 0,
    rejectedZipCount: 0,
    conversationCount: 0,
    messageCount: 0,
    emptyVisibleMessageCount: 0,
    messageWithRichBlocksCount: 0,
    richBlockCount: 0,
    emptyRichBlockCount: 0,
    richBlockKinds: {},
    richBlockVariants: {},
    visibleRawTagCount: 0,
    privacy: "aggregate counts only; no paths, source IDs, titles, or conversation text printed"
  };

  for (const archivePath of paths) {
    try {
      const bytes = await readFile(archivePath);
      const file = new File([bytes], path.basename(archivePath), { type: "application/zip" });
      const result = await OD.registry.parseZIP(file);
      if (!result.recognized || result.adapter?.id !== "mufy-raw") {
        summary.rejectedZipCount += 1;
        continue;
      }
      summary.parsedZipCount += 1;
      summary.conversationCount += result.archive.conversations.length;
      for (const conversation of result.archive.conversations) {
        for (const message of conversation.messages || []) {
          summary.messageCount += 1;
          const visibleText = OD.schema.textOf(message.content);
          if (!visibleText.trim()) summary.emptyVisibleMessageCount += 1;
          const richBlocks = (message.content || []).filter(item => item?.type === "source-rich-block");
          if (richBlocks.length) summary.messageWithRichBlocksCount += 1;
          for (const block of richBlocks) {
            summary.richBlockCount += 1;
            if (!String(block.text || "").trim()) summary.emptyRichBlockCount += 1;
            increment(summary.richBlockKinds, block.kind || "unknown");
            increment(summary.richBlockVariants, block.variant || "unknown");
          }
          summary.visibleRawTagCount += (visibleText.match(/<\/?(?:div|details|summary|script|style)\b/gi) || []).length;
        }
      }
    } catch (_) {
      summary.rejectedZipCount += 1;
    }
  }

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

main().catch(error => {
  console.error(error?.message || String(error));
  process.exitCode = 1;
});
