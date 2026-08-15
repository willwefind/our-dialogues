#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function legacyText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return content?.text ? String(content.text) : "";
  return content.map(part => {
    if (typeof part === "string") return part;
    if (part?.type === "text") return part.text || "";
    return part?.text || "";
  }).filter(Boolean).join("\n");
}

function counts(text) {
  return Object.fromEntries(["div", "details", "think", "strong"].map(tag => [
    `<${tag}`,
    (String(text).match(new RegExp(`<\\s*${tag}\\b`, "gi")) || []).length
  ]));
}

function completeTagCounts(text) {
  return Object.fromEntries(["div", "details", "think", "strong"].map(tag => [
    `<${tag}>`,
    (String(text).match(new RegExp(`<\\s*${tag}\\b[^>\\n]*>`, "gi")) || []).length
  ]));
}

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
    "src/adapters/registry.js",
    "src/core/source-folder.js"
  ]) {
    const source = await readFile(path.join(repositoryRoot, relativePath), "utf8");
    vm.runInContext(source, runtime, { filename: relativePath });
  }
  return runtime.OD;
}

async function main() {
  const archivePaths = process.argv.slice(2);
  if (!archivePaths.length) throw new Error("Usage: node tools/smoke-mufy-source-fidelity.mjs <mufy.zip> [...]");
  const OD = await loadRuntime();
  const files = [];
  const packs = [];
  let zipBytes = 0;
  const legacyVisible = [];
  for (const archivePath of archivePaths) {
    const bytes = await readFile(archivePath);
    zipBytes += bytes.length;
    const file = new File([bytes], path.basename(archivePath), { type: "application/zip" });
    files.push(file);
    const zip = await OD.zip.readZip(file);
    const adapter = OD.adapters.find(item => item.id === "mufy-raw");
    if (!adapter || !await adapter.detectZIP(zip)) throw new Error("An input ZIP is not a strictly detected Mufy raw export.");
    const rawName = zip.names.find(name => name === "_原始数据.json" || name.endsWith("/_原始数据.json"));
    const pack = await zip.readJSON(rawName);
    packs.push(pack);
    legacyVisible.push(pack.greeting || "");
    for (const session of pack.sessions || []) {
      for (const dialog of session.dialogs || []) legacyVisible.push(legacyText(dialog.content));
    }
  }

  const result = await OD.sourceFolder.parse(files);
  const normalized = result.archive;
  const currentVisible = [];
  let messageCount = 0;
  for (const conversation of normalized.conversations || []) {
    for (const message of conversation.messages || []) {
      messageCount += 1;
      currentVisible.push(OD.schema.textOf(message.content));
    }
  }

  process.stdout.write(`${JSON.stringify({
    format: "our-dialogues.mufy-source-fidelity-smoke.v1",
    zipFileCount: files.length,
    zipBytes,
    sourceIdentity: {
      characterIdPresentCount: packs.filter(pack => pack.characterId != null && String(pack.characterId).trim() !== "").length,
      distinctCharacterCount: new Set(packs.map(pack => pack.characterId).filter(value => value != null && String(value).trim() !== "").map(String)).size,
      batchFromPresentCount: packs.filter(pack => pack.batchFrom != null).length,
      totalSessionsPresentCount: packs.filter(pack => pack.totalSessions != null).length
    },
    conversationCount: normalized.conversations.length,
    messageCount,
    uniqueConversationIdCount: new Set(normalized.conversations.map(conversation => conversation.id)).size,
    emptyTitleCount: normalized.conversations.filter(conversation => !String(conversation.title || "").trim()).length,
    duplicateSessionCount: result.stats.duplicateSessionCount,
    literalMarkupInVisibleText: {
      before: counts(legacyVisible.join("\n")),
      after: counts(currentVisible.join("\n")),
      completeTagsAfter: completeTagCounts(currentVisible.join("\n"))
    },
    privacy: "counts and booleans only; no paths, source IDs, titles, or conversation text printed"
  }, null, 2)}\n`);
}

main().catch(error => {
  console.error(error?.message || String(error));
  process.exitCode = 1;
});
