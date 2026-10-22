import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadRuntime() {
  const runtime = { Blob, File, TextDecoder, TextEncoder, URL, console, Date, Math, atob };
  runtime.window = runtime;
  runtime.globalThis = runtime;
  vm.createContext(runtime);
  for (const relativePath of [
    "src/core/schema.js",
    "src/core/mufy-title-resolver.js",
    "src/core/chatgpt-export-folder.js",
    "src/adapters/contract.js",
    "src/adapters/normalized.js",
    "src/adapters/mufy.js",
    "src/adapters/sillytavern.js",
    "src/adapters/registry.js",
    "src/core/source-folder.js"
  ]) {
    vm.runInContext(await readFile(path.join(repositoryRoot, relativePath), "utf8"), runtime, { filename: relativePath });
  }
  return runtime.OD;
}

const plain = value => JSON.parse(JSON.stringify(value));
const jsonl = lines => lines.map(line => JSON.stringify(line)).join("\n") + "\n";

/* Wholly synthetic chats, shaped like SillyTavern 1.19 writes them. */
const header = (extra = {}) => ({ user_name: "Wren", character_name: "unused", chat_metadata: { integrity: "synthetic" }, ...extra });
const soloChat = () => [
  header(),
  { name: "Lantern", is_user: false, is_system: false, send_date: "2026-08-06T04:24:53.737Z", mes: "The lamp is lit. <正文>Come in.</正文>", extra: {},
    swipes: ["Alternate greeting one.", "The lamp is lit. <正文>Come in.</正文>"], swipe_id: 1,
    swipe_info: [{ send_date: "2026-08-06T04:24:50.000Z", extra: {} }, { send_date: "2026-08-06T04:24:53.737Z", extra: { reasoning: "pick the warm one" } }] },
  { name: "Wren", is_user: true, is_system: false, send_date: "2026-08-06T04:25:10.000Z", mes: "Thank you <3", extra: {} },
  { name: "Lantern", is_user: false, is_system: false, send_date: "2026-08-06T04:25:40.000Z",
    mes: "<div class=\"status\"><b>Mood</b>: calm</div>\nShe smiles.", extra: { reasoning: "Keep it short.", model: "synthetic-model", api: "openai" } },
  { name: "Lantern", is_user: false, is_system: true, send_date: "not a date", mes: "A hidden aside.", extra: {} },
  { name: "Narrator", is_user: false, is_system: true, send_date: 1786000000000, mes: "Night falls.", extra: { type: "narrator" } }
];

test("dates: every format SillyTavern has written is read, anything else stays null", async () => {
  const OD = await loadRuntime();
  const read = OD.sillyTavern.readDate;
  assert.equal(read("2026-08-06T04:24:53.737Z").toISOString(), "2026-08-06T04:24:53.737Z");
  assert.equal(read(1786000000000).getTime(), 1786000000000);
  assert.equal(read(1786000000).getTime(), 1786000000000, "seconds are read as seconds");
  const humanized = read("2023-5-12 @21h 32m 29s 224ms");
  assert.deepEqual([humanized.getFullYear(), humanized.getMonth(), humanized.getDate(), humanized.getHours(), humanized.getMinutes()], [2023, 4, 12, 21, 32]);
  const compact = read("2026-08-18@06h20m32s187ms");
  assert.deepEqual([compact.getHours(), compact.getMinutes(), compact.getMilliseconds()], [6, 20, 187]);
  const old = read("May 12, 2023 9:32pm");
  assert.deepEqual([old.getFullYear(), old.getMonth(), old.getDate(), old.getHours(), old.getMinutes()], [2023, 4, 12, 21, 32]);
  assert.equal(read("December 1, 2023 12:05am").getHours(), 0);
  for (const bad of ["not a date", "", null, undefined, "2023-2-30 @10h 00m 00s", "Smarch 3, 2023 1:00pm", 12])
    assert.equal(read(bad), null, `${bad} stays null`);
});

test("a lone chat file is recognized, and nothing else claims it", async () => {
  const OD = await loadRuntime();
  const lines = OD.sillyTavern.parseLines(jsonl(soloChat()) + "{broken\n\n").lines;
  assert.equal(lines.length, 6);
  assert.equal(OD.sillyTavern.parseLines("{broken\n").invalid, 1);
  const parsed = await OD.registry.parseJSON(lines);
  assert.equal(parsed.recognized, true);
  assert.equal(parsed.adapter.id, "sillytavern-chat");
  assert.equal(parsed.archive.source.platform, "sillytavern");
  assert.equal(parsed.archive.source.sourceLabel, "SillyTavern");
  const conversation = parsed.archive.conversations[0];
  assert.equal(conversation.context.sourceMetadata.characterName, "Lantern", "an 'unused' header falls back to the speaker");
  const first = new Date("2026-08-06T04:24:53.737Z");
  const local = `${first.getFullYear()}-${String(first.getMonth() + 1).padStart(2, "0")}-${String(first.getDate()).padStart(2, "0")} ${String(first.getHours()).padStart(2, "0")}:${String(first.getMinutes()).padStart(2, "0")}`;
  assert.equal(conversation.title, local, "no chat name: titled by its first date, in local time");

  assert.equal((await OD.registry.parseJSON([{ mes: "no header", is_user: true }])).recognized, false);
  assert.equal((await OD.registry.parseJSON([header(), { mes: 3, is_user: true }])).recognized, false, "a malformed message line is not a chat");
});

test("messages keep their text, reasoning, swipes, and hidden state", async () => {
  const OD = await loadRuntime();
  const archive = OD.sillyTavern.convertChats([{ path: "default-user/chats/Lantern/Lantern - 2026-08-06@12h24m50s000ms.jsonl", lines: soloChat() }]);
  const [greeting, user, reply, hidden, narrator] = archive.conversations[0].messages;

  // Read the way a browser — and so SillyTavern — shows it: "<正文>" cannot
  // open a tag and stays as text, while "</正文>" is a bogus comment and vanishes.
  assert.equal(OD.schema.textOf(greeting.content), "The lamp is lit. <正文>Come in.", "angle brackets read as SillyTavern shows them");
  assert.equal(greeting.metadata.sourceText, "The lamp is lit. <正文>Come in.</正文>", "the untouched string is kept");
  assert.equal(greeting.metadata.swipes.count, 2);
  assert.equal(greeting.metadata.swipes.index, 1);
  assert.equal(greeting.metadata.swipes.items[0].text, "Alternate greeting one.");
  assert.equal(greeting.metadata.swipes.items[1].reasoning, "pick the warm one");
  assert.equal(greeting.metadata.swipes.items[0].createdAt, "2026-08-06T04:24:50.000Z");

  assert.equal(user.role, "user");
  assert.equal(OD.schema.textOf(user.content), "Thank you <3");

  assert.equal(reply.role, "assistant");
  assert.deepEqual(plain(reply.thinking), [{ type: "text", text: "Keep it short." }]);
  assert.match(OD.schema.textOf(reply.content), /Mood/);
  assert.match(OD.schema.textOf(reply.content), /She smiles\./);
  assert.doesNotMatch(OD.schema.textOf(reply.content), /<div/);
  assert.equal(reply.metadata.sourceText, "<div class=\"status\"><b>Mood</b>: calm</div>\nShe smiles.", "the untouched string is kept");
  assert.equal(reply.metadata.model, "synthetic-model");

  assert.equal(hidden.metadata.hidden, true);
  assert.equal(hidden.createdAt, null, "an unreadable time is never invented");
  assert.equal(narrator.role, "system");
  assert.equal(narrator.metadata.originalRole, "narrator");
  assert.equal(narrator.createdAt, new Date(1786000000000).toISOString());
});

test("a folder becomes one source: characters by folder, group chats by name, backups left alone", async () => {
  const OD = await loadRuntime();
  const file = (relativePath, text) => {
    const f = new File([text], relativePath.split("/").pop());
    Object.defineProperty(f, "webkitRelativePath", { value: relativePath });
    return f;
  };
  const renamed = soloChat();
  const files = [
    file("default-user/chats/Lantern/Lantern - 2026-08-06@12h24m50s000ms.jsonl", jsonl(soloChat())),
    file("default-user/chats/Lantern/The night market.jsonl", jsonl(renamed)),
    file("default-user/chats/default_Moth/Moth - 2023-5-12 @21h 32m 29s 224ms.jsonl", jsonl([
      { user_name: "Wren", character_name: "Moth", create_date: "2023-5-12 @21h 32m 29s 224ms", chat_metadata: {} },
      { name: "Moth", is_user: false, send_date: "May 12, 2023 9:32pm", mes: "Hello from an older build.", extra: {} }
    ])),
    file("default-user/group chats/2026-08-18@05h56m12s991ms.jsonl", jsonl([
      header(),
      { name: "Lantern", is_user: false, send_date: "2026-08-18T05:56:20.000Z", mes: "First.", extra: {} },
      { name: "Moth", is_user: false, send_date: "2026-08-18T05:56:30.000Z", mes: "Second.", extra: {} },
      { name: "Wren", is_user: true, send_date: "2026-08-18T05:57:00.000Z", mes: "Both of you.", extra: {} }
    ])),
    file("default-user/groups/1787003772998.json", JSON.stringify({ id: "1787003772998", name: "The porch", members: ["Lantern.png", "Moth.png"], chats: ["2026-08-18@05h56m12s991ms"] })),
    file("default-user/backups/chat_Lantern_20260806-123000.jsonl", jsonl(soloChat())),
    file("default-user/extensions/third-party/log.jsonl", jsonl(soloChat())),
    file("default-user/chats/Lantern/notes.jsonl", "{\"not\":\"a chat\"}\n"),
    file("default-user/settings.json", "{}")
  ];

  const inspection = await OD.sourceFolder.inspect(files);
  assert.equal(inspection.handler?.id, "sillytavern-folder");
  const result = await OD.sourceFolder.parse(files);
  const conversations = result.archive.conversations;
  assert.equal(conversations.length, 4, "backups and extensions are skipped");
  assert.match(result.importDetails, /4 段聊天 · 2 个角色 · 1 段群聊 · 1 个文件无法识别已跳过/);

  const byName = Object.fromEntries(conversations.map(conversation => [conversation.title, conversation]));
  assert.ok(byName["2026-08-06 12:24"], "a default chat name becomes its date");
  assert.equal(byName["2026-08-06 12:24"].createdAt, new Date(2026, 7, 6, 12, 24, 50).toISOString());
  assert.ok(byName["The night market"], "a renamed chat keeps its name");
  assert.equal(byName["The night market"].context.sourceMetadata.characterId, "Lantern");

  const moth = conversations.find(conversation => conversation.context.sourceMetadata.characterId === "default_Moth");
  assert.equal(moth.context.sourceMetadata.characterName, "Moth", "an older header names the character itself");
  assert.equal(moth.messages[0].createdAt, new Date(2023, 4, 12, 21, 32).toISOString());

  const group = conversations.find(conversation => conversation.context.sourceMetadata.isGroupChat);
  assert.equal(group.context.sourceMetadata.characterId, "group:1787003772998");
  assert.equal(group.context.sourceMetadata.characterName, "The porch");
  assert.deepEqual(plain(group.participants.map(item => item.name)), ["Wren", "Lantern", "Moth"]);
  assert.equal(new Set(conversations.map(conversation => conversation.id)).size, 4);
});

/* ── Display rules (the cards' regex) and status folding ── */
const rule = (findRegex, replaceString, extra = {}) => ({
  id: extra.id || findRegex, scriptName: extra.scriptName || "rule", findRegex, replaceString,
  trimStrings: [], placement: [2], disabled: false, markdownOnly: true, promptOnly: false,
  runOnEdit: true, substituteRegex: 0, minDepth: null, maxDepth: null, ...extra
});

test("display rules run like SillyTavern's engine: flags, placement, depth, groups, macros", async () => {
  const OD = await loadRuntime();
  const { applyDisplayRegex: run, regexFromString } = OD.sillyTavern;
  assert.equal(regexFromString("/a(b)/gi").flags, "gi");
  assert.equal(regexFromString("plain").source, "plain");
  assert.equal(regexFromString("/x/gZ").source, "\\/x\\/gZ", "unknown flags fall back to the literal string, as SillyTavern does");
  assert.equal(regexFromString("/(/g"), null);

  const ctx = { user: "Wren", char: "Lantern", placement: 2, depth: 0 };
  assert.equal(run("Hi there", [rule("/Hi/g", "<b>{{match}}</b>")], ctx).text, "<b>Hi</b> there");
  assert.equal(run("a=1;b=2", [rule("/(?<k>\\w)=(\\d)/g", "$<k>:$2")], ctx).text, "a:1;b:2");
  assert.equal(run("say [[x]]", [rule("/\\[\\[(.*?)\\]\\]/", "<$1>", { trimStrings: ["x"] })], ctx).text, "say <>");
  assert.equal(run("x", [rule("/x/", "{{user}} & {{char}} {{getvar::mood}}")], ctx).text, "Wren & Lantern ", "unknown macros in an output are dropped");
  assert.equal(run("Lantern says", [rule("/{{char}}/", "L", { substituteRegex: 1 })], ctx).text, "L says");
  assert.equal(run("a.b", [rule("/{{char}}/", "!", { substituteRegex: 2 })], { ...ctx, char: "a.b" }).text, "!");

  const skipped = [
    rule("/x/", "!", { markdownOnly: false }),
    rule("/x/", "!", { markdownOnly: false, promptOnly: true }),
    rule("/x/", "!", { disabled: true }),
    rule("/x/", "!", { placement: [1] }),
    rule("/x/", "!", { minDepth: 1 }),
    rule("/x/", "<div id=app></div><script>render()</script>")
  ];
  for (const script of skipped) assert.equal(run("x", [script], ctx).text, "x", JSON.stringify(script).slice(0, 80));
  assert.equal(run("x", [rule("/x/", "!", { maxDepth: 0 })], ctx).text, "!");
  assert.equal(run("x", [rule("/x/", "!", { maxDepth: 0 })], { ...ctx, depth: 3 }).text, "x");
  assert.equal(run("x", [rule("/x/", "!", { minDepth: 2 })], { ...ctx, depth: undefined }).text, "!", "a hidden message has no depth, so the window does not apply");

  const tracked = run("A [s] B", [rule("/\\[s\\]/", "<div>panel</div>", { scriptName: "P" }), rule("/panel/", "PANEL")], ctx);
  assert.equal(tracked.text, "A <div>PANEL</div> B");
  assert.deepEqual(plain(tracked.regions.map(region => region.scriptName)), ["P"], "a rule touching up a panel keeps it the same panel");
  const taken = run("A [s] B", [rule("/\[s\]/", "<div>panel</div>", { scriptName: "P" }), rule("/<div>panel<\/div>/", "<i>gone</i>", { scriptName: "Q" })], ctx);
  assert.deepEqual(plain(taken.regions.map(region => region.scriptName)), ["Q"], "a rule replacing all of a panel takes it over");
  assert.deepEqual(plain(run("A [s] B", [rule("/\[s\]/", "", { scriptName: "hide" })], ctx).regions), [], "hiding leaves no region");
});

test("a status panel a rule draws folds into a box; inline touches and the body stay in the prose", async () => {
  const OD = await loadRuntime();
  const body = "She opens the door and the hallway smells of rain and old paper. ".repeat(4).trim();
  const mes = `${body}\n<status>mood=calm|place=hall</status>\n"Come in," she says.`;
  const rules = {
    shared: [rule("/\"([^\"]+)\"/g", "<span class=quote>\"$1\"</span>", { scriptName: "引号上色" })],
    byCharacter: {
      Lantern: [
        rule("/<status>mood=(\\w+)\\|place=(\\w+)<\\/status>/", "```html\n<div class=card><b>心情</b> $1<br><b>地点</b> $2</div>\n```", { scriptName: "-{{char}}·状态栏-" }),
        rule("/<hidden>[\\s\\S]*?<\\/hidden>/g", "", { scriptName: "隐藏" })
      ]
    }
  };
  const lines = [header({ user_name: "unused" }),
    { name: "Wren", is_user: true, send_date: "2026-08-06T04:00:00.000Z", mes: "Knock knock.", extra: {} },
    { name: "Lantern", is_user: false, send_date: "2026-08-06T04:01:00.000Z", mes: `${mes}<hidden>plot notes</hidden>`, extra: {} }];
  const archive = OD.sillyTavern.convertChats([{ path: "u/chats/Lantern/Lantern - 2026-08-06@12h00m00s000ms.jsonl", lines }], { rules });
  const [, reply] = archive.conversations[0].messages;
  const box = reply.content.find(item => item.type === "source-rich-block");
  assert.equal(box.kind, "details");
  assert.equal(box.variant, "st-regex");
  assert.equal(box.title, "Lantern·状态栏", "named after the rule, macros filled, edge punctuation trimmed");
  assert.match(box.body, /心情\s*calm/);
  const prose = reply.content.filter(item => item.type === "text").map(item => item.text).join("\n");
  assert.match(prose, /hallway smells of rain/);
  assert.match(prose, /"Come in," she says\./, "inline colouring keeps the words in the prose");
  assert.doesNotMatch(prose, /plot notes/, "what a rule hides stays hidden, as in SillyTavern");
  assert.match(reply.metadata.sourceText, /plot notes/, "…and the stored message keeps it");
  assert.deepEqual(plain(reply.metadata.displayRules), ["引号上色", "-{{char}}·状态栏-", "隐藏"]);
  assert.equal(archive.conversations[0].participants[0].name, "Wren", "an 'unused' user name falls back to the user's speaker");

  // A rule that wraps the whole message is the body, not a panel.
  const wrapped = OD.sillyTavern.convertChats([{ path: "u/chats/Lantern/x.jsonl", lines: [header(), { name: "Lantern", is_user: false, mes: body, extra: {} }] }],
    { rules: { shared: [rule("/^([\\s\\S]+)$/", "<div class=page>$1</div>")], byCharacter: {} } });
  assert.equal(wrapped.conversations[0].messages[0].content.some(item => item.type === "source-rich-block"), false);
  assert.match(OD.schema.textOf(wrapped.conversations[0].messages[0].content), /hallway smells of rain/);

  // A panel that only a script could fill folds the data it was given.
  const shell = OD.sillyTavern.convertChats([{ path: "u/chats/Lantern/y.jsonl", lines: [header(), { name: "Lantern", is_user: false, mes: `${body}\n<data>hp 9</data>`, extra: {} }] }],
    { rules: { shared: [rule("/<data>[\\s\\S]*?<\\/data>/", "<div class=hud></div>", { scriptName: "HUD" })], byCharacter: {} } });
  const hud = shell.conversations[0].messages[0].content.find(item => item.type === "source-rich-block");
  assert.equal(hud.title, "HUD");
  assert.match(hud.body, /hp 9/);

  // Group chats run no card's rules.
  const grouped = OD.sillyTavern.convertChats([{ path: "u/group chats/2026-08-18@05h56m12s991ms.jsonl", lines }], { rules });
  assert.equal(grouped.conversations[0].messages[1].content.some(item => item.variant === "st-regex"), false);
});

test("raw status lines no rule reached fold under their marker; a lone pipe line does not", async () => {
  const OD = await loadRuntime();
  const items = plain(OD.sillyTavern.foldStatusRuns("He waits.\n<-EVE_DATA->\n| 5月22日 | 星期五 | 深夜 |\n\n|黑色皮衣|马丁靴|\nThe rain goes on."));
  assert.deepEqual(items.map(item => item.type === "text" ? item.text : `[${item.title}]`), ["He waits.", "[EVE_DATA]", "The rain goes on."]);
  assert.match(items[1].body, /星期五[\s\S]*马丁靴/);
  assert.deepEqual(plain(OD.sillyTavern.foldStatusRuns("a | b | c | d\nprose")).map(item => item.type), ["text"], "one row is not a panel");
});

test("the folder import reads allowed cards' rules from the PNG, the active preset's, and the global ones", async () => {
  const OD = await loadRuntime();
  const file = (relativePath, content) => {
    const f = new File(Array.isArray(content) ? content : [content], relativePath.split("/").pop());
    Object.defineProperty(f, "webkitRelativePath", { value: relativePath });
    return f;
  };
  const chunk = (type, data) => {
    const bytes = new Uint8Array(12 + data.length);
    new DataView(bytes.buffer).setUint32(0, data.length);
    bytes.set([...type].map(c => c.charCodeAt(0)), 4);
    bytes.set(data, 8);
    return bytes;
  };
  const cardPNG = card => {
    const payload = Buffer.from(JSON.stringify(card), "utf8").toString("base64");
    const text = new Uint8Array([..."chara"].map(c => c.charCodeAt(0)).concat([0], [...payload].map(c => c.charCodeAt(0))));
    return [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", new Uint8Array(13)), chunk("IDAT", new Uint8Array(4096)), chunk("tEXt", text), chunk("IEND", new Uint8Array(0))];
  };
  const tag = name => rule(`/<${name}>([\\s\\S]*?)<\\/${name}>/`, "<div>$1</div>", { scriptName: name });
  const chat = name => jsonl([header(), { name, is_user: false, send_date: "2026-08-06T04:00:00.000Z", mes: `${"Long enough prose for the body. ".repeat(6)}<g>G</g><p1>P</p1><c>C</c>`, extra: {} }]);
  const files = [
    file("default-user/settings.json", JSON.stringify({
      main_api: "openai",
      oai_settings: { preset_settings_openai: "Mine" },
      extension_settings: { regex: [tag("g")], character_allowed_regex: ["Lantern.png"], preset_allowed_regex: { openai: ["Mine"] } }
    })),
    file("default-user/OpenAI Settings/Mine.json", JSON.stringify({ extensions: { regex_scripts: [tag("p1")] } })),
    file("default-user/characters/Lantern.png", cardPNG({ spec: "chara_card_v2", data: { name: "Lantern", extensions: { regex_scripts: [tag("c")] } } })),
    file("default-user/characters/Moth.png", cardPNG({ data: { name: "Moth", extensions: { regex_scripts: [tag("c")] } } })),
    file("default-user/secrets.json", "must never be read"),
    file("default-user/chats/Lantern/Lantern - 2026-08-06@12h00m00s000ms.jsonl", chat("Lantern")),
    file("default-user/chats/Moth/Moth - 2026-08-06@12h00m00s000ms.jsonl", chat("Moth"))
  ];
  let secretsRead = false;
  for (const method of ["text", "arrayBuffer", "slice", "stream"]) {
    Object.defineProperty(files[4], method, { value: () => { secretsRead = true; throw new Error("secrets.json was opened"); } });
  }

  const result = await OD.sourceFolder.parse(files);
  assert.equal(secretsRead, false);
  assert.equal(result.stats.globalRules, 1);
  assert.equal(result.stats.presetRules, 1);
  assert.equal(result.stats.cardsWithRules, 1, "only the allowed card's rules are read");
  const titlesOf = name => result.archive.conversations.find(c => c.context.sourceMetadata.characterId === name)
    .messages[0].content.filter(item => item.variant === "st-regex").map(item => item.title);
  assert.deepEqual(plain(titlesOf("Lantern")), ["g", "p1", "c"]);
  assert.deepEqual(plain(titlesOf("Moth")), ["g", "p1"], "a card not allowed to run rules runs none");
  assert.match(result.importDetails, /条按卡片美化规则显示/);

  const bare = await OD.sourceFolder.parse(files.filter(f => /\/chats\//.test(f.webkitRelativePath)).map(f => {
    const copy = new File([f], f.name);
    Object.defineProperty(copy, "webkitRelativePath", { value: f.webkitRelativePath.replace("default-user/", "") });
    return copy;
  }));
  assert.match(bare.importDetails, /没读到美化规则/, "picking only chats/ says the rules were out of reach");
});

test("a message that is nothing but a panel shows it open instead of folded", async () => {
  const OD = await loadRuntime();
  const archive = OD.sillyTavern.convertChats([{ path: "u/chats/Lantern/z.jsonl", lines: [header(),
    { name: "Lantern", is_user: false, mes: `<notes>${"plot ".repeat(60)}</notes>\n<phone>hi from the phone</phone>`, extra: {} }] }],
    { rules: { shared: [
      rule("/<notes>[\\s\\S]*?<\\/notes>\\n?/", "", { scriptName: "hide notes" }),
      rule("/<phone>([\\s\\S]*?)<\\/phone>/", "<div class=phone>$1</div>", { scriptName: "手机消息" })
    ], byCharacter: {} } });
  const [block] = archive.conversations[0].messages[0].content;
  assert.equal(block.kind, "status-card");
  assert.equal(block.title, "手机消息");
  assert.match(block.body, /hi from the phone/);
});

test("a chat whose header line runs past the first read is still recognized", async () => {
  const OD = await loadRuntime();
  const big = jsonl([header({ chat_metadata: { database: "x".repeat(200000) } }), { name: "Lantern", is_user: false, mes: "hi", extra: {} }]);
  const f = new File([big], "Lantern - 2026-08-06@12h00m00s000ms.jsonl");
  Object.defineProperty(f, "webkitRelativePath", { value: "default-user/chats/Lantern/Lantern - 2026-08-06@12h00m00s000ms.jsonl" });
  assert.equal((await OD.sourceFolder.inspect([f])).handler?.id, "sillytavern-folder");
});

test("one rule firing again and again reads as one box with every message in it", async () => {
  const OD = await loadRuntime();
  const body = "Long enough prose so the bubbles are not the whole message. ".repeat(5);
  const bubbles = ["<msg>one</msg>", "<msg>two</msg>", "<msg>three</msg>"].join("\n");
  const archive = OD.sillyTavern.convertChats([{ path: "u/chats/Lantern/p.jsonl", lines: [header(),
    { name: "Lantern", is_user: false, mes: `${body}\n${bubbles}\nAfter.`, extra: {} }] }],
    { rules: { shared: [rule("/<msg>(.*?)<\\/msg>/g", "<div class=bubble>$1</div>", { scriptName: "手机消息" })], byCharacter: {} } });
  const boxes = archive.conversations[0].messages[0].content.filter(item => item.variant === "st-regex");
  assert.equal(boxes.length, 1);
  assert.equal(boxes[0].title, "手机消息 · 3");
  assert.deepEqual(boxes[0].body.split("\n"), ["one", "two", "three"]);
});
