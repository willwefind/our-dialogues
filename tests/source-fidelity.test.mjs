import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadRuntime() {
  const runtime = { Blob, File, TextDecoder, TextEncoder, URL, console };
  runtime.window = runtime;
  runtime.globalThis = runtime;
  vm.createContext(runtime);
  for (const relativePath of [
    "src/core/schema.js",
    "src/adapters/contract.js",
    "src/adapters/normalized.js",
    "src/adapters/ciel-house.js",
    "src/adapters/mufy.js",
    "src/adapters/chatgpt-official.js",
    "src/adapters/registry.js"
  ]) {
    const source = await readFile(path.join(repositoryRoot, relativePath), "utf8");
    vm.runInContext(source, runtime, { filename: relativePath });
  }
  return runtime.OD;
}

function syntheticMufy() {
  return {
    name: "Synthetic Character",
    characterId: "character-synthetic",
    archiveCount: 2,
    exportedAt: "2026-08-16T00:00:00Z",
    greeting: "<div>Hello &amp; welcome<br><span>friend</span><!-- comment --><script>secret greeting</script><think>greeting thought &amp; calm</think></div>",
    sessions: [{
      sessionId: "session-synthetic",
      isCurrent: true,
      createdTime: 1_700_000_000,
      updatedAt: "2026-08-16T01:00:00Z",
      archives: [
        { archiveId: "older", createdAt: "2026-08-14T00:00:00Z", remark: "Older remark" },
        { archiveId: "newer", createdAt: "2026-08-15T00:00:00Z", remark: "<span>Newest &amp; readable</span>" }
      ],
      dialogs: [
        {
          dialogsId: "assistant-created-time",
          role: "assistant",
          createdTime: 1_700_000_001,
          content: [{
            type: "text",
            text: "<details><summary>Status &amp; plan</summary><div>Visible <span>line</span></div></details><think>private <b>reasoning</b></think><style>hidden style</style>"
          }]
        },
        {
          dialogsId: "user-created-at",
          role: "user",
          createdAt: "2026-08-16T02:00:00Z",
          content: "<div>User line&nbsp;one</div><div>line two</div>"
        },
        {
          dialogsId: "assistant-timestamp",
          role: "assistant",
          timestamp: 1_700_000_003_000,
          content: [
            { type: "thinking", text: "<div>typed thought</div>" },
            { type: "text", text: "Final &#x41;&#66;" }
          ]
        }
      ]
    }]
  };
}

test("Mufy HTML becomes readable text and explicit think content stays separate", async () => {
  const OD = await loadRuntime();
  const source = syntheticMufy();
  const parsed = await OD.registry.parseJSON(source);

  assert.equal(parsed.recognized, true);
  assert.equal(parsed.adapter.id, "mufy-raw");
  const conversation = parsed.archive.conversations[0];
  assert.equal(conversation.title, "Newest & readable");

  const [greeting, assistant, user, timestamped] = conversation.messages;
  assert.equal(OD.schema.textOf(greeting.content), "Hello & welcome\nfriend");
  assert.equal(OD.schema.textOf(greeting.thinking), "greeting thought & calm");
  assert.equal(greeting.metadata.original, source.greeting);

  assert.equal(OD.schema.textOf(assistant.content), "Status & plan\nVisible line");
  assert.equal(OD.schema.textOf(assistant.thinking), "private reasoning");
  assert.equal(assistant.metadata.original, source.sessions[0].dialogs[0]);
  assert.equal(assistant.createdAt, "2023-11-14T22:13:21.000Z");

  assert.equal(OD.schema.textOf(user.content), "User line one\nline two");
  assert.equal(user.createdAt, "2026-08-16T02:00:00.000Z");
  assert.equal(OD.schema.textOf(timestamped.content), "Final AB");
  assert.equal(OD.schema.textOf(timestamped.thinking), "typed thought");
  assert.equal(timestamped.createdAt, "2023-11-14T22:13:23.000Z");

  const visible = conversation.messages.map(message => OD.schema.textOf(message.content)).join("\n");
  assert.doesNotMatch(visible, /<\/?(?:div|details|summary|span|think)\b/i);
  assert.doesNotMatch(visible, /secret greeting|hidden style|comment/);
});

test("Mufy title falls back to the first assistant line instead of a session hash", async () => {
  const OD = await loadRuntime();
  const source = syntheticMufy();
  source.sessions[0].archives = [];
  source.sessions[0].dialogs[0].content = "<div>A readable first assistant line</div>";
  const parsed = await OD.registry.parseJSON(source);

  assert.equal(parsed.archive.conversations[0].title, "A readable first assistant line");
  assert.notEqual(parsed.archive.conversations[0].title, "session-synthetic · 1");
});

test("known JSON adapters detect mutually exclusively", async () => {
  const OD = await loadRuntime();
  const fixtures = [
    [syntheticMufy(), "mufy-raw"],
    [JSON.parse(await readFile(path.join(repositoryRoot, "fixtures/ciel-house-v1.json"), "utf8")), "ciel-house-v1"],
    [JSON.parse(await readFile(path.join(repositoryRoot, "fixtures/normalized-v1.json"), "utf8")), "normalized-v1"],
    [JSON.parse(await readFile(path.join(repositoryRoot, "fixtures/chatgpt-official-2026.json"), "utf8")), "chatgpt-official-2026"]
  ];

  for (const [fixture, expected] of fixtures) {
    const matches = [];
    for (const adapter of OD.adapters) {
      if (adapter.capabilities.json && await adapter.detectJSON(fixture)) matches.push(adapter.id);
    }
    assert.deepEqual(matches, [expected]);
  }

  assert.deepEqual(
    [...OD.registry.capabilities().map(capability => capability.id)],
    ["normalized-v1", "ciel-house-v1", "mufy-raw", "chatgpt-official-2026"]
  );
});

test("unknown JSON returns schema-only diagnostics without leaking values", async () => {
  const OD = await loadRuntime();
  const secret = "PRIVATE CONVERSATION BODY MUST NEVER APPEAR";
  const unknown = {
    exporter: "unknown-plugin",
    payload: {
      chat_messages: [{ author_name: "private person", body_value: secret }],
      "PRIVATE NESTED TITLE MUST NEVER APPEAR": { messages: [] }
    }
  };
  const result = await OD.registry.parseJSON(unknown);

  assert.equal(result.recognized, false);
  assert.equal(result.archive, null);
  assert.equal(result.diagnostics.rootType, "object");
  assert.deepEqual([...result.diagnostics.topLevelKeys], ["exporter", "payload"]);
  assert.ok(result.diagnostics.candidateKeyPatterns.some(item => item.keys.includes("chat_messages")));
  assert.doesNotMatch(JSON.stringify(result.diagnostics), new RegExp(secret));
  assert.doesNotMatch(JSON.stringify(result.diagnostics), /PRIVATE NESTED TITLE/);
  assert.doesNotMatch(OD.registry.formatDiagnostics(result.diagnostics), new RegExp(secret));

  const looseShape = await OD.registry.parseJSON({ conversations: [{ messages: [] }] });
  assert.equal(looseShape.recognized, false, "generic conversation keys must not trigger a source adapter");
});

test("unknown ZIP diagnostics list JSON filenames and never loose-guess content", async () => {
  const OD = await loadRuntime();
  const secret = "ZIP PRIVATE BODY MUST NEVER APPEAR";
  const zip = {
    names: ["private/claude-export.json", "metadata.json", "notes.txt"],
    has() { return false; },
    async readJSON(name) {
      if (name === "metadata.json") return { build: 1 };
      return { chat_messages: [{ body: secret }] };
    }
  };
  OD.zip = { readZip: async () => zip };

  const result = await OD.registry.parseZIP({ name: "unknown.zip" });
  assert.equal(result.recognized, false);
  assert.deepEqual(
    [...result.diagnostics.jsonFilenames],
    ["private/claude-export.json", "metadata.json"]
  );
  assert.equal(result.diagnostics.candidateJSON.length, 2);
  assert.doesNotMatch(JSON.stringify(result.diagnostics), new RegExp(secret));
  assert.doesNotMatch(OD.registry.formatDiagnostics(result.diagnostics), new RegExp(secret));
});

test("Mufy ZIP detection requires the exact raw-data filename", async () => {
  const OD = await loadRuntime();
  const adapter = OD.adapters.find(item => item.id === "mufy-raw");
  const source = syntheticMufy();
  assert.equal(await adapter.detectZIP({
    names: ["character/_原始数据.json"],
    async readJSON() { return source; }
  }), true);
  assert.equal(await adapter.detectZIP({
    names: ["character/_原始数据.json"],
    async readJSON() { return { sessions: [], name: "not enough identity" }; }
  }), false);
  assert.equal(await adapter.detectZIP({ names: ["character/original-data.json", "sessions.json"] }), false);
});

test("known ZIP filenames without the matching schema are rejected", async () => {
  const OD = await loadRuntime();
  const chatgpt = OD.adapters.find(item => item.id === "chatgpt-official-2026");
  const ciel = OD.adapters.find(item => item.id === "ciel-house-v1");

  assert.equal(await chatgpt.detectZIP({
    names: ["conversations.json"],
    has(name) { return name === "conversations.json"; },
    async readJSON() { return { conversations: [{ messages: [] }] }; }
  }), false);
  assert.equal(await ciel.detectZIP({
    names: ["manifest.json", "conversations.json"],
    has(name) { return ["manifest.json", "conversations.json"].includes(name); },
    async readJSON() { return { format: "another-export", version: 1 }; }
  }), false);
});

test("ambiguous strict detections return diagnostics instead of choosing first", async () => {
  const OD = await loadRuntime();
  const capabilities = {
    contract: "our-dialogues.adapter-capabilities.v1",
    json: true,
    zip: false,
    folder: false,
    thinking: "none",
    attachments: "none",
    sourceMarkup: "plain-text"
  };
  for (const id of ["collision-a", "collision-b"]) {
    OD.adapters.push({
      id,
      label: id,
      capabilities,
      detectJSON(data) { return data?.strictCollision === true; },
      parseJSON() { throw new Error("ambiguous adapters must never parse"); }
    });
  }

  const result = await OD.registry.parseJSON({ strictCollision: true });
  assert.equal(result.recognized, false);
  assert.equal(result.diagnostics.reason, "ambiguous-format");
  assert.deepEqual([...result.diagnostics.matchedAdapterIds], ["collision-a", "collision-b"]);
});
