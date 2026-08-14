import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
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
  const pageOne = {
    history: [
      historyItem("sol-001", DEFAULT_VOICES.sol, 1_700_000_000, "Sol text"),
      historyItem("other-001", "another-voice", 1_700_000_100, "Unknown text")
    ],
    has_more: true,
    last_history_item_id: "other-001"
  };
  const pageTwo = {
    history: [
      historyItem("ciel-001", DEFAULT_VOICES.ciel, 1_700_000_200, "Ciel text"),
      historyItem("sol-001", DEFAULT_VOICES.sol, 1_700_000_000, "Sol text")
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
    total: 3,
    sol: 1,
    ciel: 1,
    unknown: 1,
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
  assert.deepEqual(all.counts, { all: 3, sol: 1, ciel: 1, unknown: 1 });
  assert.equal(sol.items[0].downloadStatus, "downloaded");
  assert.equal(ciel.items[0].downloadStatus, "downloaded");
  assert.equal(unknown.items[0].audioPath, null);
  assert.equal(unknown.items[0].downloadStatus, "not-downloaded-unknown-voice");
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

test("gitignore protects local credentials and archive output", async () => {
  const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const source = await readFile(path.join(repositoryRoot, ".gitignore"), "utf8");
  assert.match(source, /^\.env\.local$/m);
  assert.match(source, /^\*\*\/\.env\.local$/m);
  assert.match(source, /^VoiceArchive\/$/m);
  assert.match(source, /^voice-archive\/$/m);
});
