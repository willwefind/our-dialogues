import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { loadChatGPTExportFolder } from "./map-solvoice-chatgpt.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPOSITORY_ROOT = path.resolve(path.dirname(SCRIPT_PATH), "..");
function defaults() {
  const voiceArchive = process.platform === "win32"
    ? "D:\\Our Dialogues\\VoiceArchive"
    : path.join(REPOSITORY_ROOT, "private", "VoiceArchive");
  return {
    exportDir: process.platform === "win32"
      ? "D:\\Our Dialogues\\SolMyLove"
      : path.join(REPOSITORY_ROOT, "private", "chatgpt-export"),
    mappingPath: path.join(voiceArchive, "mappings", "chatgpt-solvoice.json"),
    audioDir: path.join(voiceArchive, "sol", "audio"),
    anchorHistoryItemId: null,
    anchorMessageId: null
  };
}

function parseArgs(argv) {
  const options = defaults();
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    const value = argv[++index];
    if (!value || value.startsWith("--")) throw new Error(`${name} requires a value.`);
    if (name === "--export") options.exportDir = value;
    else if (name === "--mapping") options.mappingPath = value;
    else if (name === "--audio") options.audioDir = value;
    else if (name === "--anchor-history-id") options.anchorHistoryItemId = value;
    else if (name === "--anchor-message-id") options.anchorMessageId = value;
    else throw new Error(`Unknown option: ${name}`);
  }
  return options;
}

async function loadSidecarRuntime() {
  const runtime = { URL, console };
  runtime.window = runtime;
  runtime.globalThis = runtime;
  vm.createContext(runtime);
  const source = await readFile(path.join(REPOSITORY_ROOT, "src", "core", "solvoice-sidecar.js"), "utf8");
  vm.runInContext(source, runtime, { filename: "src/core/solvoice-sidecar.js" });
  return runtime.OD.solVoiceSidecar;
}

async function walkAudioFiles(root, current = root) {
  const output = [];
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const absolutePath = path.join(current, entry.name);
    if (entry.isDirectory()) output.push(...await walkAudioFiles(root, absolutePath));
    else if (/\.(?:mp3|m4a|aac|wav|ogg|oga|flac|opus)$/i.test(entry.name)) {
      let relativePath = path.relative(root, absolutePath).replace(/\\/g, "/");
      if (!relativePath.toLowerCase().startsWith("sol/audio/")) {
        relativePath = `sol/audio/${relativePath}`;
      }
      output.push({ name: entry.name, relativePath, absolutePath });
    }
  }
  return output;
}

function byConversation(session) {
  const counts = new Map();
  for (const clips of session.entries().map(([, values]) => values)) {
    for (const clip of clips) {
      counts.set(clip.conversationId, (counts.get(clip.conversationId) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([conversationId, playerCount]) => ({ conversationId, playerCount }))
    .sort((left, right) => left.conversationId.localeCompare(right.conversationId));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const [{ archive }, mappingText, audioFiles, sidecar] = await Promise.all([
    loadChatGPTExportFolder(options.exportDir),
    readFile(options.mappingPath, "utf8"),
    walkAudioFiles(options.audioDir),
    loadSidecarRuntime()
  ]);
  const mappingDocument = sidecar.parseMapping(mappingText);
  const session = sidecar.buildSession({
    archive,
    mappingDocument,
    audioFiles,
    urlAPI: { createObjectURL: () => "blob:not-materialized", revokeObjectURL() {} }
  });
  const targetMapping = options.anchorHistoryItemId
    ? mappingDocument.mappings.find(mapping => mapping.historyItemId === options.anchorHistoryItemId)
    : null;
  const targetClip = options.anchorMessageId && options.anchorHistoryItemId
    ? session.clipsForMessage(options.anchorMessageId).find(
      clip => clip.historyItemId === options.anchorHistoryItemId
    )
    : null;

  let targetBlobURLCreated = false;
  if (targetClip?.file?.absolutePath) {
    const bytes = await readFile(targetClip.file.absolutePath);
    const objectURL = URL.createObjectURL(new Blob([bytes], { type: "audio/mpeg" }));
    targetBlobURLCreated = objectURL.startsWith("blob:");
    URL.revokeObjectURL(objectURL);
  }

  const output = {
    strongMappingsTotal: session.stats.strongMappingsTotal,
    strongMappingsWhoseMessageIdExists: session.stats.strongMappingsWhoseMessageIdExists,
    audioFileResolvedCount: session.stats.audioFileResolvedCount,
    attachedPlayerCount: session.stats.attachedPlayerCount,
    missingMessageCount: session.stats.missingMessageCount,
    missingAudioCount: session.stats.missingAudioCount,
    targetAnchor: options.anchorHistoryItemId || options.anchorMessageId ? {
      historyItemId: options.anchorHistoryItemId,
      confidence: targetMapping?.confidence || null,
      mappingMessageId: targetMapping?.messageId || null,
      expectedMessageId: options.anchorMessageId,
      exactMessageResolved: targetMapping?.messageId === options.anchorMessageId && !!targetClip,
      audioResolved: !!targetClip?.file,
      blobURLCreatedAndRevoked: targetBlobURLCreated
    } : null,
    byConversation: byConversation(session)
  };
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  session.dispose();
}

main().catch(error => {
  console.error(`Reader SolVoice verification failed: ${error.message}`);
  process.exitCode = 1;
});
