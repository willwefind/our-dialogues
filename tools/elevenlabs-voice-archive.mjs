#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import {
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

export const DEFAULT_VOICES = Object.freeze({
  sol: "vQyoa2SYcKP0n2lCM3XS",
  ciel: "ruROucOxsuDRzADgMIvL"
});

const API_BASE_URL = "https://api.elevenlabs.io";
const FORMAT = "our-dialogues-elevenlabs-voice-archive";
const VERSION = 2;
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPOSITORY_ROOT = path.resolve(path.dirname(SCRIPT_PATH), "..");

function cleanValue(value) {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const quote = trimmed[0];
    if ((quote === '"' || quote === "'") && trimmed.at(-1) === quote) {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed.replace(/\s+#.*$/, "");
}

export function parseDotEnv(source) {
  const values = {};
  for (const rawLine of source.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    values[match[1]] = cleanValue(match[2]);
  }
  return values;
}

export async function readLocalEnvironment(envPath = path.join(REPOSITORY_ROOT, ".env.local")) {
  try {
    return parseDotEnv(await readFile(envPath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
}

function integerOption(value, name, { min, max }) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max}.`);
  }
  return number;
}

export function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      options.help = true;
      continue;
    }
    const [name, inlineValue] = argument.split("=", 2);
    const needsValue = [
      "--output",
      "--page-size",
      "--max-retries",
      "--retry-base-ms",
      "--sol-voice-id",
      "--ciel-voice-id"
    ].includes(name);
    if (!needsValue) throw new Error(`Unknown option: ${argument}`);
    const value = inlineValue ?? argv[++index];
    if (!value || value.startsWith("--")) throw new Error(`${name} requires a value.`);
    if (name === "--output") options.outputDir = value;
    if (name === "--page-size") options.pageSize = integerOption(value, name, { min: 1, max: 1000 });
    if (name === "--max-retries") options.maxRetries = integerOption(value, name, { min: 0, max: 20 });
    if (name === "--retry-base-ms") options.retryBaseMs = integerOption(value, name, { min: 0, max: 60000 });
    if (name === "--sol-voice-id") options.solVoiceId = value;
    if (name === "--ciel-voice-id") options.cielVoiceId = value;
  }
  return options;
}

function defaultOutputDirectory() {
  return process.platform === "win32"
    ? "D:\\Our Dialogues\\VoiceArchive"
    : path.resolve(REPOSITORY_ROOT, "VoiceArchive");
}

function usage() {
  return `ElevenLabs Voice Archive Exporter

Usage:
  node tools/elevenlabs-voice-archive.mjs [options]

Options:
  --output <path>          Archive root (default on Windows: D:\\Our Dialogues\\VoiceArchive)
  --page-size <1-1000>     History records per API page (default: 1000)
  --max-retries <0-20>     Retries for network, 429, and 5xx errors (default: 5)
  --retry-base-ms <0-60000> Initial retry delay in milliseconds (default: 1000)
  --sol-voice-id <id>      Override the configured Sol voice ID
  --ciel-voice-id <id>     Override the configured Ciel voice ID
  -h, --help               Show this help
`;
}

function retryDelay(response, retryNumber, baseMs) {
  const header = response?.headers?.get("retry-after");
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
    const date = Date.parse(header);
    if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  }
  return baseMs * (2 ** Math.max(0, retryNumber - 1));
}

function shouldRetryStatus(status) {
  return status === 408 || status === 429 || status >= 500;
}

export async function requestWithRetry(url, options, {
  fetchImpl = globalThis.fetch,
  logger = console,
  maxRetries = 5,
  retryBaseMs = 1000,
  sleep = delay => new Promise(resolve => setTimeout(resolve, delay))
} = {}) {
  if (typeof fetchImpl !== "function") throw new Error("This tool requires Node.js 18 or newer.");

  for (let attempt = 0; ; attempt += 1) {
    let response;
    try {
      response = await fetchImpl(url, options);
    } catch (error) {
      if (attempt >= maxRetries) {
        throw new Error(`Network request failed after ${attempt + 1} attempts: ${error.message}`);
      }
      const delay = retryDelay(null, attempt + 1, retryBaseMs);
      logger.warn(`Network request failed; retry ${attempt + 1}/${maxRetries} in ${delay} ms.`);
      await sleep(delay);
      continue;
    }

    if (response.ok) return response;
    if (!shouldRetryStatus(response.status) || attempt >= maxRetries) {
      throw new Error(`ElevenLabs API request failed with HTTP ${response.status}.`);
    }
    const delay = retryDelay(response, attempt + 1, retryBaseMs);
    logger.warn(`ElevenLabs returned HTTP ${response.status}; retry ${attempt + 1}/${maxRetries} in ${delay} ms.`);
    await sleep(delay);
  }
}

function apiHeaders(apiKey) {
  return {
    accept: "application/json",
    "xi-api-key": apiKey
  };
}

export async function fetchHistoryPage({
  apiKey,
  cursor,
  pageSize,
  apiBaseUrl = API_BASE_URL,
  ...retryOptions
}) {
  const url = new URL("/v1/history", apiBaseUrl);
  url.searchParams.set("page_size", String(pageSize));
  if (cursor) url.searchParams.set("start_after_history_item_id", cursor);
  const response = await requestWithRetry(url, {
    method: "GET",
    headers: apiHeaders(apiKey)
  }, retryOptions);
  const payload = await response.json();
  if (!payload || !Array.isArray(payload.history)) {
    throw new Error("ElevenLabs returned an invalid history response.");
  }
  return payload;
}

function speakerForVoice(voiceId, voices) {
  if (voiceId === voices.sol) return "sol";
  if (voiceId === voices.ciel) return "ciel";
  return "unknown";
}

function nonEmptyString(value) {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function dialogueMetadata(item) {
  return Array.isArray(item.dialogue) ? item.dialogue : null;
}

function dialogueVoiceIds(dialogue) {
  if (!dialogue) return [];
  return [...new Set(dialogue
    .map(entry => entry && typeof entry === "object" ? nonEmptyString(entry.voice_id) : null)
    .filter(Boolean))];
}

function dialogueText(dialogue) {
  if (!dialogue) return null;
  const parts = dialogue
    .map(entry => entry && typeof entry === "object" && typeof entry.text === "string"
      ? entry.text
      : null)
    .filter(text => text != null && text.length > 0);
  return parts.length ? parts.join("\n") : null;
}

function dialogueVoiceName(dialogue, voiceId) {
  if (!dialogue || !voiceId) return null;
  for (const entry of dialogue) {
    if (!entry || typeof entry !== "object") continue;
    if (nonEmptyString(entry.voice_id) !== voiceId) continue;
    const voiceName = nonEmptyString(entry.voice_name);
    if (voiceName) return voiceName;
  }
  return null;
}

function isoDate(dateUnix) {
  if (!Number.isFinite(Number(dateUnix))) return null;
  const date = new Date(Number(dateUnix) * 1000);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

function extensionFor(item) {
  const contentType = String(item.content_type ?? "").toLowerCase().split(";", 1)[0];
  const format = String(item.output_format ?? "").toLowerCase();
  if (contentType.includes("wav") || format.startsWith("wav")) return ".wav";
  if (contentType.includes("flac") || format.startsWith("flac")) return ".flac";
  if (contentType.includes("ogg") || format.startsWith("ogg") || format.startsWith("opus")) return ".ogg";
  if (contentType.includes("mp4") || contentType.includes("m4a") || format.startsWith("m4a")) return ".m4a";
  return ".mp3";
}

function safeSegment(value) {
  return String(value).replace(/[^A-Za-z0-9_-]/g, "_");
}

export function normalizeHistoryItem(item, voices = DEFAULT_VOICES) {
  const historyItemId = item.history_item_id == null ? null : String(item.history_item_id);
  const dialogue = dialogueMetadata(item);
  const uniqueDialogueVoiceIds = dialogueVoiceIds(dialogue);
  const topLevelVoiceId = nonEmptyString(item.voice_id);
  let voiceId = topLevelVoiceId;
  let voiceIdSource = "top-level";
  let speaker;

  if (!topLevelVoiceId && uniqueDialogueVoiceIds.length === 1) {
    [voiceId] = uniqueDialogueVoiceIds;
    voiceIdSource = "dialogue-single";
  } else if (!topLevelVoiceId && uniqueDialogueVoiceIds.length > 1) {
    voiceId = null;
    voiceIdSource = "dialogue-mixed";
  } else if (!topLevelVoiceId) {
    voiceId = null;
    voiceIdSource = "none";
  }

  if (voiceIdSource === "dialogue-mixed") {
    speaker = "mixed";
  } else {
    speaker = speakerForVoice(voiceId, voices);
  }

  const topLevelText = typeof item.text === "string" ? item.text : null;
  const extractedDialogueText = dialogueText(dialogue);
  const text = topLevelText ?? extractedDialogueText;
  const topLevelVoiceName = nonEmptyString(item.voice_name);
  const voiceName = topLevelVoiceName ?? dialogueVoiceName(dialogue, voiceId);
  const createdAt = isoDate(item.date_unix);
  const datePart = createdAt ? createdAt.replace(/:/g, "-") : "unknown-date";
  const filename = historyItemId
    ? `${datePart}__${safeSegment(historyItemId)}${extensionFor(item)}`
    : null;
  return {
    historyItemId,
    voiceId,
    voiceIdSource,
    dialogueVoiceIds: uniqueDialogueVoiceIds,
    speaker,
    createdAt,
    text,
    textSource: topLevelText != null ? "top-level" : extractedDialogueText != null ? "dialogue" : "none",
    dialogue,
    requestId: item.request_id == null ? null : String(item.request_id),
    modelId: item.model_id == null ? null : String(item.model_id),
    source: item.source == null ? null : String(item.source),
    audioPath: !["sol", "ciel"].includes(speaker) || !filename ? null : `${speaker}/audio/${filename}`,
    contentType: item.content_type == null ? null : String(item.content_type),
    outputFormat: item.output_format == null ? null : String(item.output_format),
    voiceName,
    dateUnix: Number.isFinite(Number(item.date_unix)) ? Number(item.date_unix) : null
  };
}

async function fileHasContent(filePath) {
  try {
    return (await stat(filePath)).size > 0;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function atomicJSON(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(temporaryPath, filePath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

async function readExistingItems(outputDir) {
  const manifestPath = path.join(outputDir, "manifest-all.json");
  try {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    if (!Array.isArray(manifest.items)) throw new Error("items must be an array");
    return manifest.items;
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw new Error(`Cannot read existing manifest-all.json: ${error.message}`);
  }
}

function compareItems(left, right) {
  return (left.dateUnix ?? Number.MAX_SAFE_INTEGER) - (right.dateUnix ?? Number.MAX_SAFE_INTEGER)
    || String(left.historyItemId).localeCompare(String(right.historyItemId));
}

function manifestFor(items, generatedAt, speaker, voiceId) {
  return {
    format: FORMAT,
    version: VERSION,
    generatedAt,
    speaker,
    voiceId,
    itemCount: items.length,
    items
  };
}

async function persistManifests(outputDir, records, voices) {
  const generatedAt = new Date().toISOString();
  const items = [...records.values()].sort(compareItems);
  const sol = items.filter(item => item.speaker === "sol");
  const ciel = items.filter(item => item.speaker === "ciel");
  const mixed = items.filter(item => item.speaker === "mixed");
  const unresolved = items.filter(item => !["sol", "ciel"].includes(item.speaker));
  await Promise.all([
    atomicJSON(path.join(outputDir, "sol", "manifest.json"), manifestFor(sol, generatedAt, "sol", voices.sol)),
    atomicJSON(path.join(outputDir, "ciel", "manifest.json"), manifestFor(ciel, generatedAt, "ciel", voices.ciel)),
    atomicJSON(path.join(outputDir, "unknown", "manifest.json"), manifestFor(unresolved, generatedAt, "unknown", null)),
    atomicJSON(path.join(outputDir, "manifest-all.json"), {
      format: FORMAT,
      version: VERSION,
      generatedAt,
      voices,
      counts: {
        all: items.length,
        sol: sol.length,
        ciel: ciel.length,
        unknown: unresolved.length,
        mixed: mixed.length
      },
      items
    })
  ]);
}

async function downloadHistoryAudio(record, {
  apiKey,
  outputDir,
  apiBaseUrl,
  ...retryOptions
}) {
  const destination = path.join(outputDir, ...record.audioPath.split("/"));
  if (await fileHasContent(destination)) return { destination, skipped: true };

  await mkdir(path.dirname(destination), { recursive: true });
  const temporaryPath = `${destination}.${process.pid}.${randomUUID()}.part`;
  const url = new URL(`/v1/history/${encodeURIComponent(record.historyItemId)}/audio`, apiBaseUrl);
  try {
    const response = await requestWithRetry(url, {
      method: "GET",
      headers: { accept: "audio/*", "xi-api-key": apiKey }
    }, retryOptions);
    if (response.body) {
      await pipeline(response.body, createWriteStream(temporaryPath));
    } else {
      await writeFile(temporaryPath, Buffer.from(await response.arrayBuffer()));
    }
    if (!(await fileHasContent(temporaryPath))) throw new Error("ElevenLabs returned an empty audio file.");
    await rename(temporaryPath, destination);
    return { destination, skipped: false };
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

export async function exportVoiceArchive({
  apiKey,
  outputDir,
  voices = DEFAULT_VOICES,
  pageSize = 1000,
  maxRetries = 5,
  retryBaseMs = 1000,
  apiBaseUrl = API_BASE_URL,
  fetchImpl = globalThis.fetch,
  logger = console,
  sleep
}) {
  if (!apiKey || !String(apiKey).trim()) {
    throw new Error("ELEVENLABS_API_KEY is missing. Put it in .env.local or the current process environment.");
  }
  if (!outputDir) throw new Error("An output directory is required.");
  if (!voices.sol || !voices.ciel || voices.sol === voices.ciel) {
    throw new Error("Sol and Ciel must have two distinct voice IDs.");
  }

  const resolvedOutput = path.resolve(outputDir);
  await mkdir(resolvedOutput, { recursive: true });
  const records = new Map();
  for (const item of await readExistingItems(resolvedOutput)) {
    if (item?.historyItemId) records.set(String(item.historyItemId), item);
  }

  const retryOptions = { fetchImpl, logger, maxRetries, retryBaseMs, sleep };
  const seenCursors = new Set();
  let cursor = null;
  let pageNumber = 0;

  while (true) {
    pageNumber += 1;
    const page = await fetchHistoryPage({
      apiKey,
      cursor,
      pageSize,
      apiBaseUrl,
      ...retryOptions
    });
    logger.info(`History page ${pageNumber}: received ${page.history.length} item(s).`);
    for (const rawItem of page.history) {
      const normalized = normalizeHistoryItem(rawItem, voices);
      if (!normalized.historyItemId) {
        logger.warn("Skipped one history record without a history_item_id.");
        continue;
      }
      const existing = records.get(normalized.historyItemId) ?? {};
      records.set(normalized.historyItemId, { ...existing, ...normalized });
    }
    await persistManifests(resolvedOutput, records, voices);
    if (!page.has_more) break;

    const nextCursor = page.last_history_item_id
      ?? page.history.at(-1)?.history_item_id
      ?? null;
    if (!nextCursor || nextCursor === cursor || seenCursors.has(nextCursor)) {
      throw new Error("History pagination stopped because ElevenLabs did not provide a new cursor.");
    }
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }

  let downloaded = 0;
  let skipped = 0;
  let failed = 0;
  const knownItems = [...records.values()]
    .filter(item => ["sol", "ciel"].includes(item.speaker) && item.audioPath)
    .sort(compareItems);

  for (let index = 0; index < knownItems.length; index += 1) {
    const record = knownItems[index];
    try {
      const result = await downloadHistoryAudio(record, {
        apiKey,
        outputDir: resolvedOutput,
        apiBaseUrl,
        ...retryOptions
      });
      record.downloadStatus = "downloaded";
      record.downloadError = null;
      if (!record.downloadedAt || !result.skipped) record.downloadedAt = new Date().toISOString();
      if (result.skipped) {
        skipped += 1;
        logger.info(`[${index + 1}/${knownItems.length}] Already present: ${record.speaker}/${record.historyItemId}`);
      } else {
        downloaded += 1;
        logger.info(`[${index + 1}/${knownItems.length}] Downloaded: ${record.speaker}/${record.historyItemId}`);
      }
    } catch (error) {
      failed += 1;
      record.downloadStatus = "error";
      record.downloadError = error.message;
      logger.error(`[${index + 1}/${knownItems.length}] Failed: ${record.speaker}/${record.historyItemId} (${error.message})`);
    }
    await persistManifests(resolvedOutput, records, voices);
  }

  for (const item of records.values()) {
    if (!["sol", "ciel"].includes(item.speaker)) {
      item.downloadStatus = item.speaker === "mixed"
        ? "not-downloaded-mixed-voice"
        : "not-downloaded-unknown-voice";
      item.downloadError = null;
    }
  }
  await persistManifests(resolvedOutput, records, voices);

  const counts = {
    total: records.size,
    sol: [...records.values()].filter(item => item.speaker === "sol").length,
    ciel: [...records.values()].filter(item => item.speaker === "ciel").length,
    unknown: [...records.values()].filter(item => !["sol", "ciel"].includes(item.speaker)).length,
    mixed: [...records.values()].filter(item => item.speaker === "mixed").length,
    downloaded,
    skipped,
    failed
  };
  logger.info(`Complete: ${counts.total} metadata item(s), ${downloaded} downloaded, ${skipped} already present, ${failed} failed.`);
  return { outputDir: resolvedOutput, counts };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage());
    return;
  }

  const fileEnvironment = await readLocalEnvironment();
  const environment = { ...fileEnvironment, ...process.env };
  const apiKey = environment.ELEVENLABS_API_KEY || environment.XI_API_KEY;
  const voices = {
    sol: args.solVoiceId || environment.ELEVENLABS_SOL_VOICE_ID || DEFAULT_VOICES.sol,
    ciel: args.cielVoiceId || environment.ELEVENLABS_CIEL_VOICE_ID || DEFAULT_VOICES.ciel
  };
  const outputDir = args.outputDir || environment.VOICE_ARCHIVE_OUTPUT_DIR || defaultOutputDirectory();
  const result = await exportVoiceArchive({
    apiKey,
    outputDir,
    voices,
    pageSize: args.pageSize,
    maxRetries: args.maxRetries,
    retryBaseMs: args.retryBaseMs
  });
  if (result.counts.failed > 0) process.exitCode = 1;
}

if (path.resolve(process.argv[1] || "") === path.resolve(SCRIPT_PATH)) {
  main().catch(error => {
    console.error(`Voice archive export failed: ${error.message}`);
    process.exitCode = 1;
  });
}
