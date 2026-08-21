import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadRuntime() {
  const runtime = { console, Blob, File, TextEncoder, TextDecoder, Response, URL, Date };
  runtime.window = runtime;
  runtime.globalThis = runtime;
  vm.createContext(runtime);
  for (const relativePath of ["src/core/schema.js", "src/core/zip.js", "src/core/zip-writer.js", "src/core/epub.js"]) {
    const source = await readFile(path.join(repositoryRoot, relativePath), "utf8");
    vm.runInContext(source, runtime, { filename: relativePath });
  }
  return runtime;
}

function syntheticConversations() {
  return [
    {
      id: "epub-a",
      title: "第一章 <标题>",
      createdAt: "2026-08-01T10:00:00.000Z",
      messages: [
        { id: "m1", role: "user", speaker: "You", content: [{ type: "text", text: "问题 & 引用" }] },
        { id: "m2", role: "assistant", speaker: "Ciel", content: [{ type: "text", text: "第一段\n\n第二段" }],
          thinking: [{ type: "text", text: "内部" }], metadata: { sourceTrace: [{ type: "tool_use", text: "→" }] },
          attachments: [{ type: "file", name: "图.png" }] }
      ]
    },
    {
      id: "epub-b",
      title: "第二章",
      createdAt: "2026-08-02T10:00:00.000Z",
      messages: [{ id: "m3", role: "assistant", speaker: "Ciel", content: [{ type: "text", text: "另一章" }] }]
    }
  ];
}

test("the EPUB round-trips through this project's own zip reader with a valid skeleton", async () => {
  const runtime = await loadRuntime();
  const bytes = runtime.OD.epub.buildEpub({
    title: "测试书",
    conversations: syntheticConversations(),
    sourceLabelOf: () => "Synthetic",
    identifier: "urn:test:1",
    modified: "2026-08-22T00:00:00Z"
  });

  const file = new runtime.File([bytes], "test.epub");
  const zip = await runtime.OD.zip.readZip(file);

  assert.equal(zip.names[0], "mimetype", "mimetype must be the first entry");
  assert.equal(await zip.readText("mimetype"), "application/epub+zip");
  assert.ok(zip.has("META-INF/container.xml"));
  const opf = await zip.readText("OEBPS/content.opf");
  assert.match(opf, /<dc:title>测试书<\/dc:title>/);
  assert.match(opf, /<dc:identifier id="book-id">urn:test:1<\/dc:identifier>/);
  assert.match(opf, /properties="nav"/);
  assert.equal((opf.match(/<itemref/g) || []).length, 2, "one spine item per conversation");

  const nav = await zip.readText("OEBPS/nav.xhtml");
  assert.match(nav, /第一章 &lt;标题&gt;/, "chapter titles are XML-escaped in the TOC");

  const chapter = await zip.readText("OEBPS/chapter-1.xhtml");
  assert.match(chapter, /问题 &amp; 引用/);
  assert.match(chapter, /第一段<br\/><\/p>|<p>第一段<\/p>/, "paragraph splitting keeps text readable");
  assert.match(chapter, /\[附件：图\.png\]/);
  assert.match(chapter, /未包含在本书中：思考 1 条 · 工具轨迹 1 条/);
  assert.doesNotMatch(chapter, /内部/, "thinking text never leaks into the book");
});

test("the zip writer produces byte-accurate STORE entries the reader can trust", async () => {
  const runtime = await loadRuntime();
  const bytes = runtime.OD.zipWriter.createZip([
    { name: "a.txt", data: "hello" },
    { name: "dir/中文名.txt", data: "内容" }
  ], { date: new Date(2026, 7, 22, 12, 0, 0) });

  const zip = await runtime.OD.zip.readZip(new runtime.File([bytes], "roundtrip.zip"));
  assert.deepEqual([...zip.names], ["a.txt", "dir/中文名.txt"]);
  assert.equal(await zip.readText("a.txt"), "hello");
  assert.equal(await zip.readText("dir/中文名.txt"), "内容", "UTF-8 names and bodies survive the round trip");
});
