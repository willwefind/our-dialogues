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
  for (const relativePath of ["src/core/schema.js", "src/adapters/claude-web-exporter.js"]) {
    const source = await readFile(path.join(repositoryRoot, relativePath), "utf8");
    vm.runInContext(source, runtime, { filename: relativePath });
  }
  return runtime.OD;
}

async function main() {
  const paths = process.argv.slice(2);
  if (!paths.length) {
    throw new Error("Usage: node tools/smoke-claude-web-exporter.mjs <claude-plugin.json> [...]");
  }
  const OD = await loadRuntime();
  const adapter = OD.adapters.find(item => item.id === "claude-web-exporter");
  const sources = [];

  for (const [index, sourcePath] of paths.entries()) {
    const bytes = await readFile(sourcePath);
    const data = JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, ""));
    const detected = adapter.detectJSON(data);
    if (!detected) throw new Error(`Input ${index + 1} is not a strict Claude webpage-plugin match.`);
    const archive = adapter.parseJSON(data);
    const messages = archive.conversations.flatMap(conversation => conversation.messages || []);
    const roleCounts = {};
    for (const message of messages) roleCounts[message.role] = (roleCounts[message.role] || 0) + 1;

    sources.push({
      sourceIndex: index + 1,
      bytes: bytes.length,
      detectedAdapterId: detected ? adapter.id : null,
      conversationCount: archive.conversations.length,
      messageCount: messages.length,
      titlePresent: typeof data.metadata?.title === "string" && data.metadata.title.trim().length > 0,
      datesPresent: !!(data.metadata?.dates && typeof data.metadata.dates === "object"),
      roleCounts,
      emptyVisibleTextCount: messages.filter(message => !OD.schema.textOf(message.content)).length,
      thinkingItemCount: messages.reduce((total, message) => total + (message.thinking?.length || 0), 0),
      nonIsoTimestampCount: messages.filter(message =>
        message.createdAt != null && !/^\d{4}-\d{2}-\d{2}T/.test(message.createdAt)
      ).length,
      rawMessageMetadataPreserved: messages.every((message, messageIndex) =>
        message.metadata?.original === data.messages[messageIndex]
      )
    });
  }

  process.stdout.write(`${JSON.stringify({
    format: "our-dialogues.claude-web-exporter-smoke.v1",
    sources,
    privacy: "counts and booleans only; no filenames, links, titles, or conversation text printed"
  }, null, 2)}\n`);
}

main().catch(error => {
  console.error(error?.message || String(error));
  process.exitCode = 1;
});
