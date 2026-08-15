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
    "src/core/mufy-title-resolver.js",
    "src/core/chatgpt-export-folder.js",
    "src/adapters/contract.js",
    "src/adapters/mufy.js",
    "src/adapters/registry.js",
    "src/core/source-folder.js"
  ]) {
    const source = await readFile(path.join(repositoryRoot, relativePath), "utf8");
    vm.runInContext(source, runtime, { filename: relativePath });
  }
  return runtime.OD;
}

async function fixtureFiles() {
  const fixture = JSON.parse(await readFile(
    path.join(repositoryRoot, "fixtures/mufy-folder-batch-synthetic.json"),
    "utf8"
  ));
  return fixture.packages.map((item, index) => {
    const file = {
      name: item.filename,
      type: "application/zip",
      syntheticPack: item.data
    };
    Object.defineProperty(file, "webkitRelativePath", {
      value: `synthetic-mufy-folder/batch-${index + 1}/${item.filename}`
    });
    return file;
  });
}

test("Mufy folder imports multiple ZIP batches with stable conservative merging", async () => {
  const OD = await loadRuntime();
  const files = await fixtureFiles();
  files[1].syntheticPack.sessions[0].archives = [{ remark: "Preferred later-batch archive remark" }];
  OD.zip = {
    async readZip(file) {
      return {
        names: ["character/_原始数据.json"],
        async readJSON() { return file.syntheticPack; }
      };
    }
  };

  const inspection = await OD.sourceFolder.inspect(files);
  assert.equal(inspection.recognized, true);
  assert.equal(inspection.handler.id, "mufy-zip-folder");

  const result = await OD.sourceFolder.parse(files);
  assert.equal(result.folderSourceId, "mufy-zip-folder");
  assert.equal(result.stats.importedZipCount, 5);
  assert.equal(result.stats.sourceSessionCount, 9);
  assert.equal(result.stats.duplicateSessionCount, 2);
  assert.equal(result.stats.duplicateMessageCount, 2, "repeated greeting and dialog are deduplicated");
  assert.equal(result.stats.conflictingMessageIdCount, 1);
  assert.equal(result.stats.conversationCount, 7);

  const conversations = result.archive.conversations;
  const alphaGreeting = conversations.find(item =>
    item.id === "mufy:character-alpha:__od-greeting__"
  );
  assert.ok(alphaGreeting, "batch ZIPs of one character merge into a single greeting chapter");
  assert.equal(alphaGreeting.title, "开场白");
  assert.equal(alphaGreeting.context.sourceMetadata.isGreeting, true);
  assert.equal(alphaGreeting.messages.length, 1, "the repeated greeting deduplicates to one message");
  assert.equal(OD.schema.textOf(alphaGreeting.messages[0].content), "Synthetic greeting");
  const alphaShared = conversations.find(item =>
    item.id === "mufy:character-alpha:session-shared"
  );
  const betaShared = conversations.find(item =>
    item.id === "mufy:character-beta:session-shared"
  );
  assert.ok(alphaShared);
  assert.ok(betaShared, "same title and sessionId must stay separate for another characterId");
  assert.equal(alphaShared.context.sourceMetadata.characterName, "Synthetic Same Name");
  assert.equal(betaShared.context.sourceMetadata.characterName, "Synthetic Same Name");
  assert.notEqual(
    alphaShared.context.sourceMetadata.characterId,
    betaShared.context.sourceMetadata.characterId,
    "same-name characters remain separate by stable character ID"
  );
  assert.equal(alphaShared.title, "Preferred later-batch archive remark");
  assert.equal(alphaShared.context.sourceMetadata.titleSource, "remark");
  assert.equal(alphaShared.metadata.titleSource, "remark");
  const sharedStableIdMessages = alphaShared.messages.filter(
    message => message.metadata?.original?.dialogsId === "alpha-shared-1"
  );
  assert.equal(sharedStableIdMessages.length, 2, "exact duplicate drops while conflicting content stays");
  assert.equal(sharedStableIdMessages.filter(message => message.metadata?.folderMergeConflict).length, 1);
  assert.ok(alphaShared.messages.some(message => message.metadata?.original?.dialogsId === "alpha-shared-2"));
  assert.ok(alphaShared.messages.some(message => message.metadata?.folderMergeConflict === true));

  const withoutCharacter = conversations.filter(item =>
    item.context?.sourceMetadata?.sessionId === "session-without-character"
  );
  assert.equal(withoutCharacter.length, 2, "missing characterId must not be merged by title/session alone");
  assert.notEqual(withoutCharacter[0].id, withoutCharacter[1].id);

  const visible = conversations.flatMap(conversation => conversation.messages)
    .map(message => OD.schema.textOf(message.content)).join("\n");
  assert.doesNotMatch(visible, /<\/?(?:div|details|think|strong)\b/i);
});

test("a strict ChatGPT folder match prevents Mufy probing and keeps ZIP assets lazy", async () => {
  const OD = await loadRuntime();
  const files = await fixtureFiles();
  let zipReads = 0;
  OD.zip = {
    async readZip() { zipReads += 1; throw new Error("ZIP attachments must stay unread"); }
  };
  OD.chatgptExportFolder.detect = async () => true;

  const inspection = await OD.sourceFolder.inspect(files);
  assert.equal(inspection.recognized, true);
  assert.equal(inspection.handler.id, "chatgpt-official-folder");
  assert.equal(zipReads, 0);
});
