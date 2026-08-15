import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadRuntime(urlAPI) {
  const runtime = {
    Blob,
    TextDecoder,
    TextEncoder,
    URL: urlAPI,
    console
  };
  runtime.window = runtime;
  runtime.globalThis = runtime;
  vm.createContext(runtime);

  for (const relativePath of [
    "src/core/schema.js",
    "src/core/zip.js",
    "src/adapters/contract.js",
    "src/adapters/ciel-house.js",
    "src/adapters/registry.js"
  ]) {
    const source = await readFile(path.join(repositoryRoot, relativePath), "utf8");
    vm.runInContext(source, runtime, { filename: relativePath });
  }

  return runtime.OD;
}

test("Ciel ZIP assets resolve and materialize lazily without File objects", async () => {
  const audioPath = "assets/audio/message-001.mp3";
  const missingPath = "assets/audio/missing.mp3";
  const byteReads = [];
  const created = [];
  const revoked = [];
  const OD = await loadRuntime({
    createObjectURL(blob) {
      created.push(blob);
      return `blob:ciel/${created.length}`;
    },
    revokeObjectURL(url) {
      revoked.push(url);
    }
  });
  const conversations = {
    conversations: [{
      id: "ciel-zip-conversation",
      title: "Synthetic Ciel ZIP",
      messages: [{
        id: "message-001",
        role: "assistant",
        speaker: "Ciel",
        content: "Synthetic audio attachment",
        attachments: [
          {
            id: "audio-message-001",
            type: "audio",
            name: "message-001.mp3",
            mimeType: "audio/mpeg",
            path: audioPath,
            size: 4,
            source: "ciel-house"
          },
          {
            id: "audio-missing",
            type: "audio",
            name: "missing.mp3",
            mimeType: "audio/mpeg",
            path: missingPath,
            size: 99,
            source: "ciel-house"
          }
        ]
      }]
    }]
  };
  const entries = new Set(["manifest.json", "conversations.json", audioPath]);
  const zip = {
    names: [...entries],
    has(name) { return entries.has(name); },
    async readJSON(name) {
      if (name === "manifest.json") {
        return {
          format: "ciel-house-export",
          version: 1,
          dataFile: "conversations.json",
          assetsRoot: "assets"
        };
      }
      if (name === "conversations.json") return conversations;
      throw new Error(`Unexpected JSON read: ${name}`);
    },
    async readBytes(name) {
      byteReads.push(name);
      if (name !== audioPath) throw new Error(`Unexpected asset read: ${name}`);
      return new Uint8Array([0x49, 0x44, 0x33, 0x00]);
    }
  };
  OD.zip.readZip = async () => zip;

  const result = await OD.registry.parseZIP({ name: "synthetic-ciel.zip" });
  assert.equal(result.adapter.id, "ciel-house-v1");
  assert.equal(result.archive.conversations.length, 1);
  assert.deepEqual(byteReads, [], "initial parsing must not read audio bytes");

  const [audio, missing] = result.archive.conversations[0].messages[0].attachments;
  const resolved = result.assetSession.assetIndex.resolve(audio);
  assert.equal(resolved.available, true);
  assert.equal(resolved.path, audioPath);
  assert.equal(resolved.mimeType, "audio/mpeg");
  assert.equal(resolved.size, 4);
  assert.equal(resolved.file, undefined, "ZIP assets must not use fake File objects");

  const firstURL = await result.assetSession.objectURLs.get(audio);
  assert.equal(firstURL, "blob:ciel/1");
  assert.deepEqual(byteReads, [audioPath]);
  assert.equal(created.length, 1);
  assert.equal(created[0].type, "audio/mpeg");
  assert.equal(created[0].size, 4);

  assert.equal(await result.assetSession.objectURLs.get({ path: audioPath }), firstURL);
  assert.deepEqual(byteReads, [audioPath], "cached access must not read the MP3 twice");

  assert.equal(result.assetSession.objectURLs.revoke(audio), true);
  assert.deepEqual(revoked, [firstURL]);
  assert.equal(result.assetSession.objectURLs.size, 0);

  const secondURL = await result.assetSession.objectURLs.get(audio);
  assert.equal(secondURL, "blob:ciel/2");
  assert.deepEqual(byteReads, [audioPath, audioPath]);

  const unresolved = result.assetSession.assetIndex.resolve(missing);
  assert.equal(unresolved.available, false);
  assert.equal(await result.assetSession.objectURLs.get(missing), null);
  assert.deepEqual(byteReads, [audioPath, audioPath], "missing assets must not trigger a ZIP read");

  assert.equal(result.assetSession.dispose(), 1);
  assert.deepEqual(revoked, [firstURL, secondURL]);
  assert.equal(result.assetSession.objectURLs.size, 0);
});

test("standalone Ciel JSON import remains compatible", async () => {
  const OD = await loadRuntime(URL);
  const fixture = JSON.parse(
    await readFile(path.join(repositoryRoot, "fixtures", "ciel-house-v1.json"), "utf8")
  );
  const result = await OD.registry.parseJSON(fixture);

  assert.equal(result.adapter.id, "ciel-house-v1");
  assert.equal(result.archive.source.platform, "ciel-house");
  assert.equal(result.archive.conversations.length, 2);
  assert.equal(result.assetSession, undefined);
});
