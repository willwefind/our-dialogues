/*
  Build a CielVoice → Claude official export mapping, locally and privately.

  Usage:
    node tools/build-cielvoice-mapping.mjs "D:\path\to\conversations.json" "D:\path\to\VoiceArchive"

  Reads the Claude official export and the ElevenLabs VoiceArchive manifest,
  binds `CielVoice:speak` tool calls to archived clips by EXACT spoken-text
  equality (whitespace-normalized), and writes
  `<VoiceArchive>/mappings/claude-cielvoice.json`.

  Only exact, unambiguous text matches become confidence "strong"; a text that
  matches several different messages is written as "ambiguous-text" and never
  auto-attached. The console prints aggregate counts only — no spoken text,
  titles, or IDs.
*/
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const [conversationsPath, voiceArchivePath, voiceLabelArg] = process.argv.slice(2);
if (!conversationsPath || !voiceArchivePath) {
  console.error('Usage: node tools/build-cielvoice-mapping.mjs <conversations.json> <VoiceArchive folder> [voiceLabel]');
  process.exit(1);
}
// The display label stays inside the private mapping file, never in the repo.
const voiceLabel = (voiceLabelArg || "CielVoice").trim();

const normalizeText = value => String(value ?? "").replace(/\s+/g, " ").trim();

const conversations = JSON.parse(await readFile(conversationsPath, "utf8"));
const manifest = JSON.parse(await readFile(path.join(voiceArchivePath, "manifest-all.json"), "utf8"));

const clipsByText = new Map();
for (const item of manifest.items || []) {
  if (!item?.audioPath || item.downloadStatus === "failed") continue;
  const key = normalizeText(item.text);
  if (!key) continue;
  if (!clipsByText.has(key)) clipsByText.set(key, []);
  clipsByText.get(key).push(item);
}

const speakCallsByText = new Map();
for (const conversation of conversations) {
  for (const message of conversation.chat_messages || []) {
    for (const part of message.content || []) {
      if (part?.type !== "tool_use" || part.name !== "CielVoice:speak") continue;
      const key = normalizeText(part.input?.text);
      if (!key) continue;
      if (!speakCallsByText.has(key)) speakCallsByText.set(key, []);
      speakCallsByText.get(key).push({ conversationId: conversation.uuid, messageId: message.uuid });
    }
  }
}

const mappings = [];
const counts = { speakTexts: speakCallsByText.size, strong: 0, ambiguousText: 0, unmatchedTexts: 0, clipsUsed: 0 };
for (const [text, calls] of speakCallsByText) {
  const clips = clipsByText.get(text) || [];
  if (!clips.length) {
    counts.unmatchedTexts += 1;
    continue;
  }
  const confidence = calls.length === 1 ? "strong" : "ambiguous-text";
  if (confidence === "strong") counts.strong += clips.length;
  else counts.ambiguousText += clips.length * calls.length;
  for (const call of calls) {
    for (const clip of clips) {
      counts.clipsUsed += 1;
      mappings.push({
        historyItemId: clip.historyItemId ?? null,
        audioPath: clip.audioPath,
        voiceCreatedAt: clip.createdAt ?? null,
        conversationId: call.conversationId,
        messageId: call.messageId,
        confidence,
        matchedBy: "exact-text",
        textLength: text.length
      });
    }
  }
}

const document = {
  format: "our-dialogues.cielvoice-claude-mapping",
  version: 1,
  voiceLabel,
  generatedAt: new Date().toISOString(),
  source: "build-cielvoice-mapping",
  matching: "exact-whitespace-normalized-text",
  mappings
};

const outDir = path.join(voiceArchivePath, "mappings");
await mkdir(outDir, { recursive: true });
const outPath = path.join(outDir, "claude-cielvoice.json");
await writeFile(outPath, JSON.stringify(document, null, 2), "utf8");

console.log("wrote mappings/claude-cielvoice.json");
for (const [key, value] of Object.entries(counts)) console.log(`${key}: ${value}`);
