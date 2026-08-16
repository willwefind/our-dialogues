/*
  Counts-only smoke for a real, private Claude official export.

  Usage: node tools/smoke-claude-official.mjs "D:\path\to\conversations.json"

  Prints aggregate counts only — never conversation titles, text, IDs, or
  file paths — so the output is safe to share in issues or handoffs.
*/
import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = process.argv[2];
if (!target) {
  console.error("Usage: node tools/smoke-claude-official.mjs <conversations.json>");
  process.exit(1);
}

const runtime = { Blob, File, TextDecoder, TextEncoder, URL, console };
runtime.window = runtime;
vm.createContext(runtime);
for (const relativePath of ["src/core/schema.js", "src/adapters/claude-official.js"]) {
  vm.runInContext(await readFile(path.join(repositoryRoot, relativePath), "utf8"), runtime, { filename: relativePath });
}

const adapter = runtime.OD.adapters.find(item => item.id === "claude-official");
const data = JSON.parse(await readFile(target, "utf8"));

if (!adapter.detectJSON(data)) {
  console.log("detect: NOT a strict Claude official export");
  process.exit(2);
}

const archive = adapter.parseJSON(data);
const counts = {
  conversations: archive.conversations.length,
  messages: 0,
  withThinking: 0,
  withSourceTrace: 0,
  truncatedTracePayloads: 0,
  withAttachments: 0,
  branchPointsTotal: 0,
  alternateMessagesTotal: 0,
  emptyMessagesDropped: 0,
  emptyContentMessages: 0,
  titleFallbacks: 0
};
for (const conversation of archive.conversations) {
  counts.branchPointsTotal += conversation.context.sourceMetadata.branchPoints;
  counts.alternateMessagesTotal += conversation.context.sourceMetadata.alternateMessageCount;
  counts.emptyMessagesDropped += conversation.context.sourceMetadata.emptyMessagesDropped;
  if (/^Claude conversation \d+$/.test(conversation.title)) counts.titleFallbacks += 1;
  for (const message of conversation.messages) {
    counts.messages += 1;
    if (message.thinking.length) counts.withThinking += 1;
    if (message.metadata.sourceTrace?.length) counts.withSourceTrace += 1;
    counts.truncatedTracePayloads += (message.metadata.sourceTrace || []).filter(item => item.truncated).length;
    if (message.attachments.length) counts.withAttachments += 1;
    if (!message.content.length) counts.emptyContentMessages += 1;
  }
}
console.log("detect: ok (strict)");
for (const [key, value] of Object.entries(counts)) console.log(`${key}: ${value}`);
