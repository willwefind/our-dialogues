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
    "src/adapters/claude-web-exporter.js",
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

test("Mufy fog status cards normalize rows, notes, and bounded progress", async () => {
  const OD = await loadRuntime();
  const source = syntheticMufy();
  const raw = `<div class="fog-status-card" onclick="steal()">
    <div class="fog-status-row"><span class="fog-label">时间</span><span>下午 14:30</span></div>
    <div class="fog-status-row"><span class="fog-label">地点</span><span>D 大校园</span></div>
    <div class="fog-comment-box">只是一段合成备注</div>
    <div><span class="fog-label">好感度</span><div class="p-bar" style="width:108.5%;background:url(javascript:bad)"></div></div>
    <script>secretScript()</script><style>.private{display:block}</style><!-- hidden -->
  </div>`;
  source.sessions[0].dialogs[0].content = raw;
  const parsed = await OD.registry.parseJSON(source);
  const message = parsed.archive.conversations[0].messages[1];
  const block = message.content.find(item => item.type === "source-rich-block");

  assert.equal(block.kind, "status-card");
  assert.equal(block.variant, "fog");
  assert.deepEqual([...block.rows.map(row => [row.label, row.value])], [
    ["时间", "下午 14:30"],
    ["地点", "D 大校园"]
  ]);
  assert.deepEqual([...block.notes], ["只是一段合成备注"]);
  assert.deepEqual({ ...block.progress }, { label: "好感度", value: 100 });
  assert.doesNotMatch(block.text, /secretScript|private|onclick|javascript/i);
  assert.equal(message.metadata.original.content, raw, "raw source record remains available for fidelity audits");
});

test("Mufy details, wg-box, and progress become safe source rich blocks", async () => {
  const OD = await loadRuntime();
  const adapter = OD.adapters.find(item => item.id === "mufy-raw");
  const normalized = adapter._internals.normalizeMufyContent([
    { type: "text", text: `<details open><summary>角色状态</summary><div>保持冷静</div><div class="p-bar" style="width:8.5%"></div></details>` },
    { type: "text", text: `<div class="wg-box"><div class="wg-row"><span class="wg-label">天气</span><span>小雨</span></div><div class="wg-comment">记得带伞</div></div>` }
  ]);
  const blocks = normalized.content.filter(item => item.type === "source-rich-block");

  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].kind, "details");
  assert.equal(blocks[0].title, "角色状态");
  assert.equal(blocks[0].progress.value, 8.5);
  assert.equal(blocks[1].variant, "wg");
  assert.deepEqual([...blocks[1].rows.map(row => [row.label, row.value])], [["天气", "小雨"]]);
  assert.deepEqual([...blocks[1].notes], ["记得带伞"]);
});

test("unknown Mufy HTML falls back to safe readable text without inventing a rich block", async () => {
  const OD = await loadRuntime();
  const adapter = OD.adapters.find(item => item.id === "mufy-raw");
  const raw = `<custom-panel data-secret="not-rendered"><div>Readable <b>fallback</b></div><script>bad()</script></custom-panel>`;
  const normalized = adapter._internals.normalizeMufyContent(raw);

  assert.equal(normalized.text, "Readable fallback");
  assert.equal(normalized.content.length, 1);
  assert.equal(normalized.content[0].type, "text");
  assert.doesNotMatch(normalized.text, /bad|script|custom-panel/);
});

test("Mufy title falls back to the first assistant line instead of a session hash", async () => {
  const OD = await loadRuntime();
  const source = syntheticMufy();
  source.sessions[0].archives = [];
  source.sessions[0].isCurrent = false;
  source.sessions[0].dialogs[0].content = "<div>A readable first assistant line</div>";
  const parsed = await OD.registry.parseJSON(source);

  assert.equal(parsed.archive.conversations[0].title, "A readable first assistant line");
  assert.notEqual(parsed.archive.conversations[0].title, "session-synthetic · 1");
});

test("Mufy session title uses current marker before assistant text when no archive remark exists", async () => {
  const OD = await loadRuntime();
  const source = syntheticMufy();
  source.sessions[0].archives = [];
  source.sessions[0].isCurrent = true;
  const parsed = await OD.registry.parseJSON(source);

  assert.equal(parsed.archive.conversations[0].title, "Synthetic Character · current conversation");
  assert.equal(parsed.archive.conversations[0].context.sourceMetadata.characterName, "Synthetic Character");
});

test("known JSON adapters detect mutually exclusively", async () => {
  const OD = await loadRuntime();
  const fixtures = [
    [syntheticMufy(), "mufy-raw"],
    [JSON.parse(await readFile(path.join(repositoryRoot, "fixtures/ciel-house-v1.json"), "utf8")), "ciel-house-v1"],
    [JSON.parse(await readFile(path.join(repositoryRoot, "fixtures/normalized-v1.json"), "utf8")), "normalized-v1"],
    [JSON.parse(await readFile(path.join(repositoryRoot, "fixtures/claude-web-exporter-synthetic.json"), "utf8")), "claude-web-exporter"],
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
    ["normalized-v1", "ciel-house-v1", "mufy-raw", "claude-web-exporter", "chatgpt-official-2026"]
  );
});

test("Claude webpage-plugin JSON normalizes one conversation without inventing thinking", async () => {
  const OD = await loadRuntime();
  const source = JSON.parse(
    await readFile(path.join(repositoryRoot, "fixtures/claude-web-exporter-synthetic.json"), "utf8")
  );
  const result = await OD.registry.parseJSON(source);

  assert.equal(result.recognized, true);
  assert.equal(result.adapter.id, "claude-web-exporter");
  assert.equal(result.archive.source.platform, "claude");
  assert.equal(result.archive.source.exporter, "ai-chat-exporter.net");
  assert.equal(result.archive.conversations.length, 1);

  const conversation = result.archive.conversations[0];
  assert.equal(conversation.id, "00000000-0000-4000-8000-000000000001");
  assert.equal(conversation.title, "Synthetic Claude plugin conversation");
  assert.equal(conversation.createdAt, new Date(2026, 5, 27, 9, 1, 2).toISOString());
  assert.equal(conversation.updatedAt, new Date(2026, 5, 27, 10, 11, 12).toISOString());
  assert.deepEqual([...conversation.messages.map(message => message.role)], ["user", "assistant", "user"]);
  assert.equal(OD.schema.textOf(conversation.messages[1].content), "Synthetic response with **Markdown** retained as text.");
  assert.deepEqual([...conversation.messages[1].thinking], []);
  assert.equal(conversation.messages[0].metadata.original, source.messages[0]);
  assert.equal(conversation.messages[1].metadata.rawSay, source.messages[1].say);
  assert.deepEqual([...conversation.messages[1].metadata.sourceTrace], []);
  assert.equal(conversation.context.sourceMetadata.original, source.metadata);
});

test("Claude exporter splitter keeps replies visible and marker-bounded workflow in sourceTrace", async () => {
  const OD = await loadRuntime();
  const adapter = OD.adapters.find(item => item.id === "claude-web-exporter");
  const rawSay = [
    "Need inspect the project before answering.",
    "Done",
    "First visible reply.",
    "Viewed file\nsrc/app.js",
    "Searching...",
    "Need update the state model and tests.",
    "Done",
    "Interstitial visible reply.",
    "Create reminder",
    "Preparing the requested reminder action.",
    "Done",
    "Final visible reply."
  ].join("\n\n");
  const source = {
    metadata: {
      powered_by: "Claude Exporter (https://www.ai-chat-exporter.net)",
      link: "https://claude.ai/chat/00000000-0000-4000-8000-000000000099",
      title: "Synthetic mixed exporter transcript",
      dates: { created: "8/16/2026 1:02:03" }
    },
    messages: [
      { role: "human", time: "8/16/2026 1:02:03", say: "Please inspect it." },
      { role: "assistant", time: "8/16/2026 1:02:04", say: rawSay }
    ]
  };

  const archive = adapter.parseJSON(source);
  const assistant = archive.conversations[0].messages[1];
  assert.equal(
    OD.schema.textOf(assistant.content),
    "First visible reply.\n\nInterstitial visible reply.\n\nFinal visible reply."
  );
  assert.deepEqual([...assistant.thinking], [], "heuristic trace must never masquerade as official thinking");
  assert.equal(assistant.metadata.rawSay, rawSay, "the complete exporter say must remain lossless");
  assert.equal(assistant.metadata.original.say, rawSay);
  assert.equal(assistant.metadata.sourceTraceHeuristic.applied, true);
  assert.ok(assistant.metadata.sourceTrace.some(item => item.marker === "done"));
  assert.ok(assistant.metadata.sourceTrace.some(item => item.marker === "tool-action"));
  assert.match(assistant.metadata.sourceTrace.map(item => item.text).join("\n"), /Need update the state model/);
  assert.doesNotMatch(OD.schema.textOf(assistant.content), /Viewed file|Searching|Create reminder|Need update/);
});

test("Claude exporter splitter falls back to raw say when markers leave no certain visible reply", async () => {
  const OD = await loadRuntime();
  const splitter = OD.adapters.find(item => item.id === "claude-web-exporter")._internals.splitAssistantSay;
  const rawSay = "Possible answer or workflow text\n\nDone";
  const split = splitter(rawSay);

  assert.equal(split.visibleText, rawSay);
  assert.equal(split.applied, false);
  assert.equal(split.conservativeFallback, true);
  assert.ok(split.sourceTrace.length > 0);
});

test("Claude webpage-plugin detection requires exporter and claude.ai fingerprints", async () => {
  const OD = await loadRuntime();
  const adapter = OD.adapters.find(item => item.id === "claude-web-exporter");
  const source = JSON.parse(
    await readFile(path.join(repositoryRoot, "fixtures/claude-web-exporter-synthetic.json"), "utf8")
  );

  assert.equal(adapter.detectJSON(source), true);
  assert.equal(adapter.detectJSON({ messages: source.messages, metadata: { dates: {}, title: "generic" } }), false);
  assert.equal(adapter.detectJSON({
    ...source,
    metadata: { ...source.metadata, link: "https://example.com/chat/not-claude" }
  }), false);
  assert.equal(adapter.detectJSON({
    ...source,
    messages: [{ role: "tool", say: "not this exporter", time: "6/27/2026 9:01:02" }]
  }), false);
});

test("Reader HTML loads Claude, diagnostics, and source-folder routing before the app", async () => {
  const html = await readFile(path.join(repositoryRoot, "index.html"), "utf8");
  const claude = html.indexOf('src/adapters/claude-web-exporter.js');
  const registry = html.indexOf('src/adapters/registry.js');
  const sourceFolder = html.indexOf('src/core/source-folder.js');
  const sourceLibrary = html.indexOf('src/core/source-library.js');
  const persistentLibrary = html.indexOf('src/core/persistent-library.js');
  const app = html.indexOf('src/app.js');

  assert.ok(claude >= 0 && claude < registry, "Claude adapter must register before diagnostics registry");
  assert.ok(registry < sourceFolder && sourceFolder < app, "folder routing must load after registry and before app");
  assert.ok(sourceLibrary >= 0 && sourceLibrary < persistentLibrary && persistentLibrary < app, "runtime and persistent libraries must load before the app");
  assert.match(html, /选择来源文件夹/);
  assert.match(html, /多个 Mufy ZIP/);
  assert.match(html, /id="sourceFilter"/);
  assert.match(html, /id="clearSources"/);
  assert.match(html, /id="localLibraryStatus"/);
  assert.match(html, /id="clearLocalLibrary"/);
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
