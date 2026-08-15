import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtureRoot = path.join(
  repositoryRoot,
  "fixtures",
  "chatgpt-official-folder-2026-synthetic"
);

async function loadReaderRuntime() {
  const runtime = {
    Blob,
    File,
    TextDecoder,
    TextEncoder,
    URL,
    console
  };
  runtime.window = runtime;
  runtime.globalThis = runtime;
  vm.createContext(runtime);

  for (const relativePath of [
    "src/core/schema.js",
    "src/core/zip.js",
    "src/core/chatgpt-export-folder.js",
    "src/adapters/contract.js",
    "src/adapters/mufy.js",
    "src/adapters/chatgpt-official.js",
    "src/adapters/registry.js",
    "src/core/source-folder.js"
  ]) {
    const source = await readFile(path.join(repositoryRoot, relativePath), "utf8");
    vm.runInContext(source, runtime, { filename: relativePath });
  }

  return runtime.OD;
}

async function fixtureFiles({ includeUnlistedShard = false } = {}) {
  const names = await readdir(fixtureRoot);
  const reads = new Map();
  const files = [];

  for (const name of names) {
    if (name === "README.md") continue;
    const bytes = await readFile(path.join(fixtureRoot, name));
    const file = new File([bytes], name, {
      type: name.endsWith(".json") ? "application/json" : "application/octet-stream"
    });
    Object.defineProperty(file, "webkitRelativePath", {
      configurable: true,
      value: `synthetic-export/${name}`
    });

    const counters = { arrayBuffer: 0, text: 0 };
    const originalArrayBuffer = file.arrayBuffer.bind(file);
    const originalText = file.text.bind(file);
    Object.defineProperties(file, {
      arrayBuffer: {
        configurable: true,
        value: async () => {
          counters.arrayBuffer += 1;
          return originalArrayBuffer();
        }
      },
      text: {
        configurable: true,
        value: async () => {
          counters.text += 1;
          return originalText();
        }
      }
    });
    reads.set(name, counters);
    files.push(file);
  }

  if (includeUnlistedShard) {
    const file = new File(["[]"], "conversations-999.json", { type: "application/json" });
    Object.defineProperty(file, "webkitRelativePath", {
      configurable: true,
      value: "synthetic-export/conversations-999.json"
    });
    files.push(file);
  }

  return { files, reads };
}

test("folder import follows the manifest and leaves binary assets unread", async () => {
  const OD = await loadReaderRuntime();
  const { files, reads } = await fixtureFiles({ includeUnlistedShard: true });
  const created = [];
  const revoked = [];
  const urlAPI = {
    createObjectURL(blob) {
      created.push(blob);
      return `blob:synthetic/${created.length}`;
    },
    revokeObjectURL(url) {
      revoked.push(url);
    }
  };

  const folder = await OD.chatgptExportFolder.parse(files, { urlAPI });

  assert.deepEqual(
    [...folder.shardPaths],
    [
      "synthetic-export/conversations-000.json",
      "synthetic-export/conversations-001.json"
    ]
  );
  assert.equal(folder.conversations.length, 2);
  assert.equal(folder.stats.assetCount, 4);
  assert.equal(folder.stats.availableAssetCount, 4);
  assert.equal(created.length, 0, "parsing must not create any object URL");

  for (const [name, counters] of reads) {
    if (!name.endsWith(".dat")) continue;
    assert.deepEqual(counters, { arrayBuffer: 0, text: 0 }, `${name} was read eagerly`);
  }

  const image = folder.assetIndex.resolve({ src: "sediment://file_synthetic_image" });
  assert.equal(image.fileId, "file_synthetic_image");
  assert.equal(image.originalName, "synthetic-moon.svg");
  assert.equal(image.mimeType, "image/svg+xml");
  assert.equal(image.libraryFileId, "libfile_synthetic_image");
  assert.equal(image.originationMessageId, "user-image-message");
  assert.equal(image.originationThreadId, "synthetic-folder-conversation-001");
  assert.equal(folder.assetIndex.resolve({ file_id: "file_synthetic_image" }), image);
  assert.equal(folder.assetIndex.resolve({ libraryFileId: "libfile_synthetic_image" }), image);

  const firstURL = folder.objectURLs.get({ id: "file_synthetic_image" });
  assert.equal(firstURL, "blob:synthetic/1");
  assert.equal(created.length, 1);
  assert.equal(created[0].type, "image/svg+xml", "the .dat blob must receive its real MIME type");
  assert.equal(
    folder.objectURLs.get({ libraryFileId: "libfile_synthetic_image" }),
    firstURL,
    "the same File should reuse its cached object URL"
  );
  assert.equal(created.length, 1);

  assert.equal(folder.objectURLs.revoke({ name: "synthetic-moon.svg" }), true);
  assert.deepEqual(revoked, [firstURL]);
  assert.equal(folder.objectURLs.size, 0);

  for (const [name, counters] of reads) {
    if (!name.endsWith(".dat")) continue;
    assert.deepEqual(counters, { arrayBuffer: 0, text: 0 }, `${name} was read while making a URL`);
  }
});

test("merged folder conversations pass through the official adapter", async () => {
  const OD = await loadReaderRuntime();
  const { files } = await fixtureFiles();
  const folder = await OD.chatgptExportFolder.parse(files, {
    urlAPI: { createObjectURL: () => "blob:unused", revokeObjectURL() {} }
  });
  const parsed = await OD.registry.parseJSON(folder.conversations);

  assert.equal(parsed.adapter.id, "chatgpt-official-2026");
  assert.equal(parsed.archive.conversations.length, 2);
  assert.equal(parsed.archive.conversations[0].messages[0].attachments[0].type, "image");

  const mediaConversation = parsed.archive.conversations[1];
  assert.deepEqual(
    [...mediaConversation.messages[0].attachments.map(attachment => attachment.type)],
    ["audio", "video", "file"]
  );
  assert.equal(mediaConversation.context.sourceMetadata.alternate_message_count, 1);
  assert.equal(parsed.archive.conversations[0].messages[1].thinking.length, 1);
  assert.equal(parsed.archive.conversations[0].messages[1].metadata.reasoningRecap.length, 1);
  assert.ok(Array.isArray(parsed.archive.conversations[0].messages[1].metadata.reasoningToolIcons));
  assert.ok(Array.isArray(parsed.archive.conversations[0].messages[1].metadata.reasoningSources));
});

test("source folder registry routes the existing ChatGPT fixture without Mufy interception", async () => {
  const OD = await loadReaderRuntime();
  const { files } = await fixtureFiles();
  const inspection = await OD.sourceFolder.inspect(files);
  assert.equal(inspection.recognized, true);
  assert.equal(inspection.handler.id, "chatgpt-official-folder");

  const result = await OD.sourceFolder.parse(files);
  assert.equal(result.folderSourceId, "chatgpt-official-folder");
  assert.equal(result.adapter.id, "chatgpt-official-2026");
  assert.equal(result.archive.conversations.length, 2);
});

test("library metadata wrappers are traversed instead of mistaken for file records", async () => {
  const OD = await loadReaderRuntime();
  const records = OD.chatgptExportFolder._internals.extractLibraryRecords({
    name: "library_files",
    files: [
      {
        id: "file_wrapped_example",
        file_name: "wrapped-example.png",
        mime: "image/png"
      }
    ]
  });

  assert.equal(records.length, 1);
  assert.equal(records[0].fileId, "file_wrapped_example");
  assert.equal(records[0].fileName, "wrapped-example.png");
  assert.equal(records[0].mimeType, "image/png");
});

test("real 2026 nested library IDs retain attachment metadata", async () => {
  const OD = await loadReaderRuntime();
  const fixture = JSON.parse(
    await readFile(path.join(fixtureRoot, "library_files.json"), "utf8")
  );
  const records = OD.chatgptExportFolder._internals.extractLibraryRecords(fixture);
  const image = records.find(record => record.fileId === "file_synthetic_image");

  assert.ok(image);
  assert.equal(image.fileId, "file_synthetic_image");
  assert.equal(image.libraryFileId, "libfile_synthetic_image");
  assert.equal(image.mimeType, "image/svg+xml");
  assert.equal(image.fileName, "synthetic-moon.svg");
  assert.equal(image.originationMessageId, "user-image-message");
  assert.equal(image.originationThreadId, "synthetic-folder-conversation-001");
});

test("simple library ID fields remain compatible", async () => {
  const OD = await loadReaderRuntime();
  const records = OD.chatgptExportFolder._internals.extractLibraryRecords([
    {
      file_id: "file_legacy_snake",
      library_file_id: "libfile_legacy_snake",
      file_name: "legacy-snake.png",
      mime_type: "image/png"
    },
    {
      fileId: "file_legacy_camel",
      libraryFileId: "libfile_legacy_camel",
      fileName: "legacy-camel.png",
      mimeType: "image/png"
    }
  ]);

  assert.deepEqual(
    [...records.map(record => [record.fileId, record.libraryFileId])],
    [
      ["file_legacy_snake", "libfile_legacy_snake"],
      ["file_legacy_camel", "libfile_legacy_camel"]
    ]
  );
});

test("manifest logical files accept shards and unrelated array pairs", async () => {
  const OD = await loadReaderRuntime();
  const references = OD.chatgptExportFolder._internals.collectManifestConversationRefs({
    logical_files: {
      "conversations.json": {
        files: ["conversations-001.json", "conversations-000.json"]
      }
    },
    unrelated_pairs: [["file_asset.dat", "private-name.png"]]
  });

  assert.deepEqual(
    [...references],
    ["conversations-000.json", "conversations-001.json"]
  );
  assert.deepEqual(
    [...OD.chatgptExportFolder._internals.collectManifestConversationRefs({
      files: ["conversations.json"]
    })],
    ["conversations.json"]
  );
});

test("gitignore blocks private export files except exact synthetic fixtures", async () => {
  const lines = (await readFile(path.join(repositoryRoot, ".gitignore"), "utf8"))
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith("#"));
  const privatePatterns = [
    "VoiceArchive/",
    "voice-archive/",
    "sol/audio/",
    "**/sol/audio/",
    "mappings/",
    "**/mappings/",
    "chatgpt-solvoice.json",
    "chatgpt-solvoice-summary.json",
    "reader-solvoice-verification*.json",
    "conversations.json",
    "conversations-*.json",
    "*.dat",
    "export_manifest.json",
    "conversation_asset_file_names.json",
    "library_files.json",
    "user.json",
    "user_settings.json",
    "message_feedback.json",
    "shared_conversations.json",
    "ads.json"
  ];
  const fixtureExceptions = [
    "!fixtures/chatgpt-official-folder-2026-synthetic/conversations-000.json",
    "!fixtures/chatgpt-official-folder-2026-synthetic/conversations-001.json",
    "!fixtures/chatgpt-official-folder-2026-synthetic/export_manifest.json",
    "!fixtures/chatgpt-official-folder-2026-synthetic/conversation_asset_file_names.json",
    "!fixtures/chatgpt-official-folder-2026-synthetic/library_files.json",
    "!fixtures/chatgpt-official-folder-2026-synthetic/file_synthetic_image.dat",
    "!fixtures/chatgpt-official-folder-2026-synthetic/file_synthetic_audio.dat",
    "!fixtures/chatgpt-official-folder-2026-synthetic/file_synthetic_video.dat",
    "!fixtures/chatgpt-official-folder-2026-synthetic/file_synthetic_document.dat"
  ];

  for (const pattern of privatePatterns) {
    assert.ok(lines.includes(pattern), `${pattern} must be ignored globally`);
  }
  assert.deepEqual(lines.filter(line => line.startsWith("!")), fixtureExceptions);
  assert.ok(lines.indexOf("*.dat") < lines.indexOf(fixtureExceptions.at(-1)));
  assert.ok(lines.indexOf("conversations-*.json") < lines.indexOf(fixtureExceptions[0]));
});

test("asset filename maps accept object, nested-object, and pair-list shapes", async () => {
  const OD = await loadReaderRuntime();
  const mappings = OD.chatgptExportFolder._internals.extractAssetNameMappings({
    "file_direct.dat": "direct.png",
    "file_nested.dat": { file_name: "nested.mp3" },
    pairs: [["file_pair.dat", "pair.pdf"]]
  });

  assert.deepEqual(
    [...mappings.map(mapping => [mapping.exportedName, mapping.originalName])],
    [
      ["file_direct.dat", "direct.png"],
      ["file_nested.dat", "nested.mp3"],
      ["file_pair.dat", "pair.pdf"]
    ]
  );
});

test("existing JSON and ZIP registry paths remain compatible", async () => {
  const OD = await loadReaderRuntime();
  const standalone = JSON.parse(
    await readFile(path.join(repositoryRoot, "fixtures", "chatgpt-official-2026.json"), "utf8")
  );
  const jsonResult = await OD.registry.parseJSON(standalone);
  assert.equal(jsonResult.adapter.id, "chatgpt-official-2026");
  assert.equal(jsonResult.archive.conversations.length, 1);

  const shard0 = JSON.parse(
    await readFile(path.join(fixtureRoot, "conversations-000.json"), "utf8")
  );
  const shard1 = JSON.parse(
    await readFile(path.join(fixtureRoot, "conversations-001.json"), "utf8")
  );
  const fakeZip = {
    names: ["export/conversations-001.json", "export/conversations-000.json"],
    has() { return false; },
    async readJSON(name) {
      return name.endsWith("000.json") ? shard0 : shard1;
    }
  };
  OD.zip = { readZip: async () => fakeZip };

  const zipResult = await OD.registry.parseZIP(new File([], "synthetic.zip"));
  assert.equal(zipResult.adapter.id, "chatgpt-official-2026");
  assert.equal(zipResult.archive.conversations.length, 2);
  assert.equal(zipResult.archive.conversations[0].id, "synthetic-folder-conversation-001");
  assert.equal(zipResult.archive.conversations[1].id, "synthetic-folder-conversation-002");
});
