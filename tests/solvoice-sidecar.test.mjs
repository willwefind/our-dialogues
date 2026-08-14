import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadRuntime() {
  const runtime = { Blob, File, URL, console };
  runtime.window = runtime;
  runtime.globalThis = runtime;
  vm.createContext(runtime);
  for (const relativePath of ["src/core/schema.js", "src/core/solvoice-sidecar.js"]) {
    const source = await readFile(path.join(repositoryRoot, relativePath), "utf8");
    vm.runInContext(source, runtime, { filename: relativePath });
  }
  return runtime.OD;
}

function mappingDocument(mappings) {
  return {
    format: "our-dialogues.solvoice-chatgpt-mapping",
    version: 2,
    mappings
  };
}

function mapping(confidence, messageId, audioPath, extra = {}) {
  return {
    historyItemId: extra.historyItemId || `${confidence}-${messageId || "none"}`,
    audioPath,
    voiceCreatedAt: extra.voiceCreatedAt || "2026-07-20T00:00:00.000Z",
    messageId,
    confidence,
    score: extra.score ?? 60,
    evidence: { time: { deltaSec: 1 } },
    ...extra
  };
}

function localFile(relativePath) {
  const name = relativePath.split("/").pop();
  const file = new File([`synthetic:${name}`], name, { type: "audio/mpeg" });
  Object.defineProperty(file, "webkitRelativePath", { value: relativePath });
  return file;
}

function archive(OD, messages = []) {
  return OD.schema.archive({
    platform: "chatgpt",
    exporter: "official",
    conversations: [{ id: "conversation-1", messages }]
  });
}

test("only exact strong mappings attach to ChatGPT assistant message IDs", async () => {
  const OD = await loadRuntime();
  const readerArchive = archive(OD, [
    { id: "assistant-1", role: "assistant", content: "synthetic" },
    { id: "user-1", role: "user", content: "synthetic" }
  ]);
  const audioFiles = [
    localFile("VoiceArchive/sol/audio/strong.mp3"),
    localFile("VoiceArchive/sol/audio/missing-message.mp3"),
    localFile("VoiceArchive/sol/audio/probable.mp3")
  ];
  const session = OD.solVoiceSidecar.buildSession({
    archive: readerArchive,
    audioFiles,
    mappingDocument: mappingDocument([
      mapping("strong", "assistant-1", "sol/audio/strong.mp3"),
      mapping("probable", "assistant-1", "sol/audio/probable.mp3"),
      mapping("ambiguous", null, "sol/audio/ambiguous.mp3"),
      mapping("unmatched", null, "sol/audio/unmatched.mp3"),
      mapping("strong", "assistant-does-not-exist", "sol/audio/missing-message.mp3"),
      mapping("strong", "user-1", "sol/audio/strong.mp3")
    ])
  });

  assert.equal(session.stats.strongMappingsTotal, 3);
  assert.equal(session.stats.strongMappingsWhoseMessageIdExists, 1);
  assert.equal(session.stats.audioFileResolvedCount, 3);
  assert.equal(session.stats.attachedPlayerCount, 1);
  assert.equal(session.stats.missingMessageCount, 2);
  assert.equal(session.stats.missingAudioCount, 0);
  assert.equal(session.clipsForMessage("assistant-1").length, 1);
  assert.equal(session.clipsForMessage("assistant-does-not-exist").length, 0);
  assert.equal(session.clipsForMessage("user-1").length, 0);
  assert.deepEqual([...session.policy.autoAttachConfidences], ["strong"]);
});

test("multiple strong clips retain metadata and sort by voiceCreatedAt", async () => {
  const OD = await loadRuntime();
  const session = OD.solVoiceSidecar.buildSession({
    archive: archive(OD, [{ id: "assistant-1", role: "assistant" }]),
    audioFiles: [
      localFile("audio/later.mp3"),
      localFile("audio/earlier.mp3")
    ],
    mappingDocument: mappingDocument([
      mapping("strong", "assistant-1", "sol/audio/later.mp3", {
        historyItemId: "later",
        voiceCreatedAt: "2026-07-20T00:00:02.000Z"
      }),
      mapping("strong", "assistant-1", "sol/audio/earlier.mp3", {
        historyItemId: "earlier",
        voiceCreatedAt: "2026-07-20T00:00:01.000Z",
        effectiveAnchorAt: "2026-07-20T00:00:03.000Z"
      })
    ])
  });

  const clips = session.clipsForMessage("assistant-1");
  assert.deepEqual([...clips.map(clip => clip.historyItemId)], ["earlier", "later"]);
  assert.equal(clips[0].effectiveAnchorAt, "2026-07-20T00:00:03.000Z");
  assert.equal(session.stats.attachedPlayerCount, 2);
  assert.equal(session.stats.attachedMessageCount, 1);
});

test("missing audio is graceful and never creates a player", async () => {
  const OD = await loadRuntime();
  const session = OD.solVoiceSidecar.buildSession({
    archive: archive(OD, [{ id: "assistant-1", role: "assistant" }]),
    audioFiles: [],
    mappingDocument: mappingDocument([
      mapping("strong", "assistant-1", "sol/audio/missing.mp3")
    ])
  });

  assert.equal(session.stats.strongMappingsWhoseMessageIdExists, 1);
  assert.equal(session.stats.audioFileResolvedCount, 0);
  assert.equal(session.stats.attachedPlayerCount, 0);
  assert.equal(session.stats.missingAudioCount, 1);
  assert.deepEqual([...session.clipsForMessage("assistant-1")], []);
});

test("object URLs are lazy, cached, and revoked for the whole sidecar session", async () => {
  const OD = await loadRuntime();
  const created = [];
  const revoked = [];
  const urlAPI = {
    createObjectURL(file) {
      created.push(file);
      return `blob:solvoice/${created.length}`;
    },
    revokeObjectURL(url) {
      revoked.push(url);
    }
  };
  const session = OD.solVoiceSidecar.buildSession({
    archive: archive(OD, [{ id: "assistant-1", role: "assistant" }]),
    audioFiles: [localFile("sol/audio/one.mp3"), localFile("sol/audio/two.mp3")],
    mappingDocument: mappingDocument([
      mapping("strong", "assistant-1", "sol/audio/one.mp3", { historyItemId: "one" }),
      mapping("strong", "assistant-1", "sol/audio/two.mp3", { historyItemId: "two" })
    ]),
    urlAPI
  });
  const [one, two] = session.clipsForMessage("assistant-1");

  assert.equal(created.length, 0, "session creation must not make blob URLs");
  assert.equal(session.objectURLs.get(one), "blob:solvoice/1");
  assert.equal(session.objectURLs.get(one), "blob:solvoice/1");
  assert.equal(created.length, 1, "the same File must reuse its URL");
  assert.equal(session.objectURLs.get(two), "blob:solvoice/2");
  session.objectURLs.revokeAll();
  assert.deepEqual(revoked, ["blob:solvoice/1", "blob:solvoice/2"]);
  assert.equal(session.objectURLs.size, 0);
  assert.equal(session.objectURLs.get(one), "blob:solvoice/3");
  session.dispose();
  assert.deepEqual(revoked, ["blob:solvoice/1", "blob:solvoice/2", "blob:solvoice/3"]);
});

test("VoiceArchive root discovery and sol/audio folder suffix resolution are deterministic", async () => {
  const OD = await loadRuntime();
  const mappingFile = new File(["{}"], "chatgpt-solvoice.json", { type: "application/json" });
  Object.defineProperty(mappingFile, "webkitRelativePath", {
    value: "VoiceArchive/mappings/chatgpt-solvoice.json"
  });
  const audio = localFile("audio/clip.mp3");

  assert.equal(OD.solVoiceSidecar.findMappingFile([audio, mappingFile]), mappingFile);
  assert.equal(OD.solVoiceSidecar.createAudioIndex([audio]).resolve("sol/audio/clip.mp3"), audio);
  const duplicate = localFile("other/clip.mp3");
  assert.equal(
    OD.solVoiceSidecar.createAudioIndex([audio, duplicate]).resolve("sol/audio/clip.mp3"),
    null,
    "a basename collision must not pick an arbitrary local file"
  );
});

test("mapping validation rejects unsupported schema versions", async () => {
  const OD = await loadRuntime();
  assert.throws(
    () => OD.solVoiceSidecar.parseMapping({ format: "our-dialogues.solvoice-chatgpt-mapping", version: 1, mappings: [] }),
    /expected .* v2/i
  );
});
