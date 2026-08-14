import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_VOICES,
  exportVoiceArchive,
  normalizeHistoryItem,
  parseDotEnv
} from "../tools/elevenlabs-voice-archive.mjs";

function historyItem(id, voiceId, dateUnix, text) {
  return {
    history_item_id: id,
    voice_id: voiceId,
    date_unix: dateUnix,
    text,
    request_id: `request-${id}`,
    model_id: "eleven_multilingual_v2",
    source: "TTS",
    content_type: "audio/mpeg",
    voice_name: id.startsWith("sol") ? "Sol" : "Ciel"
  };
}

function dialogueHistoryItem(id, dialogue, dateUnix = 1_700_000_000) {
  return {
    history_item_id: id,
    voice_id: null,
    voice_name: null,
    text: null,
    dialogue,
    date_unix: dateUnix,
    request_id: `request-${id}`,
    model_id: "eleven_v3",
    source: "TTS",
    content_type: "audio/mpeg",
    output_format: "mp3_44100_128"
  };
}

function quietLogger(messages = []) {
  return {
    info(message) { messages.push(String(message)); },
    warn(message) { messages.push(String(message)); },
    error(message) { messages.push(String(message)); }
  };
}

test("dotenv parsing and normalization keep secrets separate from archive metadata", () => {
  assert.deepEqual(parseDotEnv(`
# local only
ELEVENLABS_API_KEY="secret-value"
export VOICE_ARCHIVE_OUTPUT_DIR='D:\\Our Dialogues\\VoiceArchive'
PLAIN=value # trailing comment
`), {
    ELEVENLABS_API_KEY: "secret-value",
    VOICE_ARCHIVE_OUTPUT_DIR: "D:\\Our Dialogues\\VoiceArchive",
    PLAIN: "value"
  });

  const record = normalizeHistoryItem(
    historyItem("sol:item", DEFAULT_VOICES.sol, 1_700_000_000, "hello")
  );
  assert.equal(record.speaker, "sol");
  assert.match(record.audioPath, /^sol\/audio\/.*__sol_item\.mp3$/);
  assert.equal(record.createdAt, "2023-11-14T22:13:20.000Z");
});

test("normalization classifies a real-shaped single-voice dialogue", () => {
  const raw = dialogueHistoryItem("synthetic-dialogue-sol-001", [{
    voice_id: DEFAULT_VOICES.sol,
    voice_name: "Sol-2",
    text: "first line",
    character_start_times_seconds: [0]
  }, {
    voice_id: DEFAULT_VOICES.sol,
    voice_name: "Sol-2",
    text: "second line",
    character_start_times_seconds: [1]
  }], 1_721_520_386);

  const record = normalizeHistoryItem(raw);
  assert.equal(record.voiceId, DEFAULT_VOICES.sol);
  assert.equal(record.voiceIdSource, "dialogue-single");
  assert.deepEqual(record.dialogueVoiceIds, [DEFAULT_VOICES.sol]);
  assert.equal(record.speaker, "sol");
  assert.equal(record.voiceName, "Sol-2");
  assert.equal(record.text, "first line\nsecond line");
  assert.equal(record.textSource, "dialogue");
  assert.equal(record.audioPath.startsWith("sol/audio/"), true);
  assert.deepEqual(record.dialogue, raw.dialogue, "all dialogue metadata should be retained");
});

test("normalization refuses to classify a multi-voice dialogue", () => {
  const raw = dialogueHistoryItem("mixed-001", [{
    voice_id: DEFAULT_VOICES.sol,
    voice_name: "Sol-2",
    text: "Sol line"
  }, {
    voice_id: DEFAULT_VOICES.ciel,
    voice_name: "Ciel",
    text: "Ciel line"
  }]);

  const record = normalizeHistoryItem(raw);
  assert.equal(record.voiceId, null);
  assert.equal(record.voiceIdSource, "dialogue-mixed");
  assert.deepEqual(record.dialogueVoiceIds, [DEFAULT_VOICES.sol, DEFAULT_VOICES.ciel]);
  assert.equal(record.speaker, "mixed");
  assert.equal(record.voiceName, null);
  assert.equal(record.audioPath, null);
  assert.equal(record.text, "Sol line\nCiel line");
  assert.deepEqual(record.dialogue, raw.dialogue);
});

test("top-level voice, name, and text take precedence over dialogue fallbacks", () => {
  const raw = {
    ...dialogueHistoryItem("top-level-001", [{
      voice_id: DEFAULT_VOICES.sol,
      voice_name: "Sol-2",
      text: "dialogue text"
    }]),
    voice_id: DEFAULT_VOICES.ciel,
    voice_name: "Ciel top-level",
    text: "top-level text"
  };

  const record = normalizeHistoryItem(raw);
  assert.equal(record.voiceId, DEFAULT_VOICES.ciel);
  assert.equal(record.voiceIdSource, "top-level");
  assert.equal(record.speaker, "ciel");
  assert.equal(record.voiceName, "Ciel top-level");
  assert.equal(record.text, "top-level text");
  assert.equal(record.textSource, "top-level");
  assert.deepEqual(record.dialogue, raw.dialogue);
});

test("export paginates, retries, separates unknown voices, and resumes without downloading twice", async t => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "our-dialogues-voice-archive-"));
  t.after(async () => {
    const { rm } = await import("node:fs/promises");
    await rm(outputDir, { recursive: true, force: true });
  });

  const apiKey = "test-key-that-must-not-appear-in-logs";
  const messages = [];
  const calls = [];
  let solAudioAttempts = 0;
  const solDialogueItem = dialogueHistoryItem("sol-001", [{
    voice_id: DEFAULT_VOICES.sol,
    voice_name: "Sol-2",
    text: "Sol text"
  }]);
  const mixedDialogueItem = dialogueHistoryItem("mixed-001", [{
    voice_id: DEFAULT_VOICES.sol,
    voice_name: "Sol-2",
    text: "Sol line"
  }, {
    voice_id: DEFAULT_VOICES.ciel,
    voice_name: "Ciel",
    text: "Ciel line"
  }], 1_700_000_050);
  const pageOne = {
    history: [
      solDialogueItem,
      mixedDialogueItem,
      historyItem("other-001", "another-voice", 1_700_000_100, "Unknown text")
    ],
    has_more: true,
    last_history_item_id: "other-001"
  };
  const pageTwo = {
    history: [
      historyItem("ciel-001", DEFAULT_VOICES.ciel, 1_700_000_200, "Ciel text"),
      solDialogueItem
    ],
    has_more: false,
    last_history_item_id: "sol-001"
  };

  const fetchImpl = async (url, options) => {
    const parsed = new URL(url);
    calls.push({
      pathname: parsed.pathname,
      cursor: parsed.searchParams.get("start_after_history_item_id"),
      apiKey: options.headers["xi-api-key"]
    });
    if (parsed.pathname === "/v1/history") {
      return Response.json(parsed.searchParams.has("start_after_history_item_id") ? pageTwo : pageOne);
    }
    if (parsed.pathname.endsWith("/sol-001/audio")) {
      solAudioAttempts += 1;
      if (solAudioAttempts === 1) {
        return new Response("rate limited", { status: 429, headers: { "retry-after": "0" } });
      }
      return new Response(Buffer.from("sol-audio"), { headers: { "content-type": "audio/mpeg" } });
    }
    if (parsed.pathname.endsWith("/ciel-001/audio")) {
      return new Response(Buffer.from("ciel-audio"), { headers: { "content-type": "audio/mpeg" } });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  const first = await exportVoiceArchive({
    apiKey,
    outputDir,
    fetchImpl,
    logger: quietLogger(messages),
    retryBaseMs: 0,
    sleep: async () => {}
  });

  assert.deepEqual(first.counts, {
    total: 4,
    sol: 1,
    ciel: 1,
    unknown: 2,
    mixed: 1,
    downloaded: 2,
    skipped: 0,
    failed: 0
  });
  assert.equal(solAudioAttempts, 2, "a 429 response should be retried once");
  assert.deepEqual(calls.filter(call => call.pathname === "/v1/history").map(call => call.cursor), [null, "other-001"]);
  assert.ok(calls.every(call => call.apiKey === apiKey));
  assert.ok(messages.every(message => !message.includes(apiKey)), "progress logs must not expose the API key");

  const all = JSON.parse(await readFile(path.join(outputDir, "manifest-all.json"), "utf8"));
  const sol = JSON.parse(await readFile(path.join(outputDir, "sol", "manifest.json"), "utf8"));
  const ciel = JSON.parse(await readFile(path.join(outputDir, "ciel", "manifest.json"), "utf8"));
  const unknown = JSON.parse(await readFile(path.join(outputDir, "unknown", "manifest.json"), "utf8"));
  assert.equal(all.version, 2);
  assert.deepEqual(all.counts, { all: 4, sol: 1, ciel: 1, unknown: 2, mixed: 1 });
  assert.equal(sol.items[0].downloadStatus, "downloaded");
  assert.equal(sol.items[0].voiceIdSource, "dialogue-single");
  assert.equal(sol.items[0].voiceName, "Sol-2");
  assert.equal(sol.items[0].text, "Sol text");
  assert.equal(ciel.items[0].downloadStatus, "downloaded");
  assert.equal(unknown.itemCount, 2);
  assert.equal(unknown.items.every(item => item.audioPath === null), true);
  assert.equal(unknown.items.find(item => item.historyItemId === "other-001").downloadStatus,
    "not-downloaded-unknown-voice");
  assert.equal(unknown.items.find(item => item.historyItemId === "mixed-001").downloadStatus,
    "not-downloaded-mixed-voice");
  assert.equal((await readdir(path.join(outputDir, "sol", "audio"))).length, 1);
  assert.equal((await readdir(path.join(outputDir, "ciel", "audio"))).length, 1);
  await assert.rejects(readdir(path.join(outputDir, "unknown", "audio")), { code: "ENOENT" });

  let unexpectedAudioRequest = false;
  const resumeFetch = async (url, options) => {
    const parsed = new URL(url);
    if (parsed.pathname !== "/v1/history") {
      unexpectedAudioRequest = true;
      throw new Error("audio should already exist");
    }
    return fetchImpl(url, options);
  };
  const resumed = await exportVoiceArchive({
    apiKey,
    outputDir,
    fetchImpl: resumeFetch,
    logger: quietLogger(),
    retryBaseMs: 0,
    sleep: async () => {}
  });
  assert.equal(unexpectedAudioRequest, false);
  assert.equal(resumed.counts.downloaded, 0);
  assert.equal(resumed.counts.skipped, 2);
});

test("a v1 manifest is accepted and its existing audio is not downloaded again", async t => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "our-dialogues-voice-archive-v1-"));
  t.after(async () => {
    const { rm } = await import("node:fs/promises");
    await rm(outputDir, { recursive: true, force: true });
  });

  const raw = dialogueHistoryItem("sol-existing", [{
    voice_id: DEFAULT_VOICES.sol,
    voice_name: "Sol-2",
    text: "preserved by ElevenLabs"
  }]);
  const current = normalizeHistoryItem(raw);
  const oldRecord = {
    historyItemId: current.historyItemId,
    voiceId: null,
    speaker: "unknown",
    createdAt: current.createdAt,
    text: null,
    audioPath: null,
    dateUnix: current.dateUnix,
    downloadStatus: "not-downloaded-unknown-voice"
  };
  await mkdir(path.join(outputDir, "sol", "audio"), { recursive: true });
  await writeFile(path.join(outputDir, ...current.audioPath.split("/")), "existing-audio");
  await writeFile(path.join(outputDir, "manifest-all.json"), JSON.stringify({
    format: "our-dialogues-elevenlabs-voice-archive",
    version: 1,
    items: [oldRecord]
  }));

  let audioRequested = false;
  const result = await exportVoiceArchive({
    apiKey: "synthetic-key",
    outputDir,
    fetchImpl: async url => {
      const parsed = new URL(url);
      if (parsed.pathname !== "/v1/history") {
        audioRequested = true;
        throw new Error("existing audio must be skipped");
      }
      return Response.json({ history: [raw], has_more: false });
    },
    logger: quietLogger()
  });

  assert.equal(audioRequested, false);
  assert.equal(result.counts.downloaded, 0);
  assert.equal(result.counts.skipped, 1);
  const upgraded = JSON.parse(await readFile(path.join(outputDir, "manifest-all.json"), "utf8"));
  assert.equal(upgraded.version, 2);
  assert.equal(upgraded.items[0].voiceIdSource, "dialogue-single");
  assert.equal(upgraded.items[0].downloadStatus, "downloaded");
});

test("gitignore protects local credentials and archive output", async () => {
  const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const source = await readFile(path.join(repositoryRoot, ".gitignore"), "utf8");
  assert.match(source, /^\.env\.local$/m);
  assert.match(source, /^\*\*\/\.env\.local$/m);
  assert.match(source, /^VoiceArchive\/$/m);
  assert.match(source, /^voice-archive\/$/m);
  assert.match(source, /^\*\*\/mappings\/$/m);
  assert.match(source, /^chatgpt-solvoice\.json$/m);
  assert.match(source, /^chatgpt-solvoice-summary\.json$/m);
});
