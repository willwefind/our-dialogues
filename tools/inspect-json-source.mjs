#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadRuntime() {
  const runtime = { URL, console };
  runtime.window = runtime;
  runtime.globalThis = runtime;
  vm.createContext(runtime);
  for (const relativePath of [
    "src/core/schema.js",
    "src/adapters/contract.js",
    "src/adapters/normalized.js",
    "src/adapters/ciel-house.js",
    "src/adapters/mufy.js",
    "src/adapters/claude-web-exporter.js",
    "src/adapters/chatgpt-official.js",
    "src/adapters/registry.js"
  ]) {
    const source = await readFile(path.join(repositoryRoot, relativePath), "utf8");
    vm.runInContext(source, runtime, { filename: relativePath });
  }
  return runtime.OD;
}

async function main() {
  const paths = process.argv.slice(2);
  if (!paths.length) throw new Error("Usage: node tools/inspect-json-source.mjs <source.json> [...]");
  const OD = await loadRuntime();
  const sources = [];

  for (const [index, sourcePath] of paths.entries()) {
    const bytes = await readFile(sourcePath);
    let data;
    try {
      data = JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, ""));
    } catch (_) {
      sources.push({ sourceIndex: index + 1, bytes: bytes.length, validJSON: false });
      continue;
    }

    const result = await OD.registry.parseJSON(data);
    if (!result.recognized) {
      sources.push({
        sourceIndex: index + 1,
        bytes: bytes.length,
        validJSON: true,
        detectedAdapterId: null,
        diagnostics: result.diagnostics
      });
      continue;
    }

    const conversations = result.archive.conversations || [];
    const messages = conversations.flatMap(conversation => conversation.messages || []);
    sources.push({
      sourceIndex: index + 1,
      bytes: bytes.length,
      validJSON: true,
      detectedAdapterId: result.adapter.id,
      conversationCount: conversations.length,
      messageCount: messages.length,
      titlePresent: conversations.some(conversation =>
        typeof conversation.title === "string" && conversation.title.trim().length > 0
      ),
      datesPresent: conversations.some(conversation =>
        conversation.createdAt != null || conversation.updatedAt != null
      ) || messages.some(message => message.createdAt != null)
    });
  }

  process.stdout.write(`${JSON.stringify({
    format: "our-dialogues.json-source-inspection.v1",
    sources,
    privacy: "metadata and structural diagnostics only; no filenames, paths, titles, links, or conversation text printed"
  }, null, 2)}\n`);
}

main().catch(error => {
  console.error(error?.message || String(error));
  process.exitCode = 1;
});
