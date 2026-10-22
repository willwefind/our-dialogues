import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadRuntime() {
  const runtime = { Blob, File, TextDecoder, TextEncoder, URL, console, Date, Math };
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
