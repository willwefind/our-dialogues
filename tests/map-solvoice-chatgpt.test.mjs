import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  mapSolVoiceRecords,
  runMappingTool,
  textSimilarity
} from "../tools/map-solvoice-chatgpt.mjs";

function iso(seconds) {
  return new Date(seconds * 1000).toISOString();
}

function voice(id, seconds, text = "") {
  return {
    historyItemId: id,
    speaker: "sol",
    createdAt: iso(seconds),
    dateUnix: seconds,
    text,
    audioPath: `sol/audio/${id}.mp3`
  };
}

function assistant(id, seconds, text = "", {
  apiTool = false,
  voiceSummary = false,
  reasoningSources = []
} = {}) {
  return {
    id,
    role: "assistant",
    createdAt: iso(seconds),
    content: [{ type: "text", text }],
    thinking: voiceSummary ? [{ type: "text", text: "Generated speech with voice synthesis" }] : [],
    metadata: {
      originalMetadata: { tool_icons: apiTool ? ["api_tool"] : [] },
      reasoningToolIcons: [],
      reasoningSources,
      reasoningRecap: []
    }
  };
}

function conversation(id, messages) {
  return { id, title: `Synthetic ${id}`, createdAt: messages[0]?.createdAt || null, messages };
}

function selectedCandidate(mapping) {
  return mapping.topCandidates.find(candidate => candidate.selected);
}

test("single exact time and text match is accepted as exact", () => {
  const result = mapSolVoiceRecords({
    voiceRecords: [voice("voice-exact", 1_000, "Hello 世界")],
    conversations: [conversation("conv-exact", [
      assistant("message-exact", 990, "Hello, 世界!", { apiTool: true, voiceSummary: true })
    ])]
  });
  assert.equal(result.mappings[0].confidence, "exact");
  assert.equal(result.mappings[0].messageId, "message-exact");
  assert.equal(result.mappings[0].evidence.text.score, 1);
  assert.equal(result.mappings[0].effectiveAnchorSource, "assistant_message");
});

test("effective anchor prefers a timestamped reasoning api_tool source", () => {
  const result = mapSolVoiceRecords({
    voiceRecords: [voice("voice-effective", 1_105, "spoken elsewhere")],
    conversations: [conversation("conv-effective", [
      assistant("message-effective", 1_000, "different visible text", {
        voiceSummary: true,
        reasoningSources: [{
          messageId: "tool-source-effective",
          createTime: 1_100,
          contentType: "thoughts",
          toolIcons: ["api_tool"]
        }]
      })
    ])]
  });
  const mapping = result.mappings[0];
  assert.equal(mapping.confidence, "strong");
  assert.equal(mapping.effectiveAnchorSource, "reasoning_api_tool");
  assert.equal(mapping.effectiveAnchorMessageId, "tool-source-effective");
  assert.equal(mapping.effectiveAnchorAt, iso(1_100));
  assert.equal(mapping.timeDeltaSec, 5);
  assert.equal(mapping.evidence.time.visibleMessageDeltaSec, 105);
  assert.equal(mapping.reasoningSources[0].createTime, 1_100);
  assert.equal(mapping.reasoningSources[0].createdAt, iso(1_100));
});

test("near time without text or tool evidence stays ambiguous", () => {
  const result = mapSolVoiceRecords({
    voiceRecords: [voice("voice-time-only", 1_000, "unrelated clip")],
    conversations: [conversation("conv-time-only", [assistant("message-time-only", 995, "different")])]
  });
  assert.equal(result.mappings[0].confidence, "ambiguous");
  assert.equal(result.mappings[0].messageId, null);
});

test("text similarity in a far-away conversation is not auto-attached", () => {
  const result = mapSolVoiceRecords({
    voiceRecords: [voice("voice-cross", 1_000, "distinct spoken sentence")],
    conversations: [
      conversation("conv-near", [assistant("message-near", 990, "unrelated")]),
      conversation("conv-far", [assistant("message-far", 100_000, "distinct spoken sentence")])
    ]
  });
  assert.equal(result.mappings[0].confidence, "ambiguous");
  assert.equal(result.mappings[0].conversationId, null);
  assert.ok(result.mappings[0].topCandidates.some(candidate => candidate.conversationId === "conv-far"));
});

test("one assistant turn may own multiple voice clips", () => {
  const result = mapSolVoiceRecords({
    voiceRecords: [
      voice("voice-multi-a", 1_001, "Shared spoken line"),
      voice("voice-multi-b", 1_002, "Shared spoken line")
    ],
    conversations: [conversation("conv-multi", [
      assistant("message-shared", 1_000, "Shared spoken line", { apiTool: true, voiceSummary: true })
    ])]
  });
  assert.deepEqual(result.mappings.map(mapping => mapping.messageId), ["message-shared", "message-shared"]);
  assert.ok(result.mappings.every(mapping => mapping.evidence.order.aligned));
});

test("equal candidates across conversations remain ambiguous", () => {
  const result = mapSolVoiceRecords({
    voiceRecords: [voice("voice-ambiguous", 1_000, "same line")],
    conversations: [
      conversation("conv-a", [assistant("message-a", 990, "same line", { apiTool: true })]),
      conversation("conv-b", [assistant("message-b", 990, "same line", { apiTool: true })])
    ]
  });
  assert.equal(result.mappings[0].confidence, "ambiguous");
  assert.equal(result.mappings[0].conversationId, null);
});

test("conversation-level dynamic programming prevents crossed message order", () => {
  const result = mapSolVoiceRecords({
    voiceRecords: [
      voice("voice-order-a", 1_001, "alpha beta gamma delta"),
      voice("voice-order-b", 1_011, "alpha beta gamma omega")
    ],
    conversations: [conversation("conv-order", [
      assistant("message-order-0", 1_000, "alpha beta gamma omega"),
      assistant("message-order-1", 1_010, "alpha beta gamma delta")
    ])]
  });
  const indices = result.mappings.map(mapping => selectedCandidate(mapping).messageId === "message-order-0" ? 0 : 1);
  assert.ok(indices[0] <= indices[1], `expected monotonic selections, received ${indices.join(",")}`);
  assert.ok(result.mappings.every(mapping => selectedCandidate(mapping).evidence.order.method === "conversation-monotonic-dp"));
});

test("unrelated distant data stays unmatched", () => {
  const result = mapSolVoiceRecords({
    voiceRecords: [voice("voice-none", 1_000, "nothing in common")],
    conversations: [conversation("conv-none", [assistant("message-none", 100_000, "entirely different")])]
  });
  assert.equal(result.mappings[0].confidence, "unmatched");
  assert.equal(result.mappings[0].messageId, null);
});

test("mixed-language punctuation and common UTF-8 mojibake normalize safely", () => {
  assert.equal(textSimilarity("你 好, world! こんにちは", "你好 world こんにちは").score, 1);
  assert.equal(textSimilarity("cafÃ© voice", "café voice").score, 1);
  assert.doesNotThrow(() => textSimilarity("bad � text", "bad text"));
});

test("folder integration reuses the official adapter and retains reasoning api_tool evidence", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "our-dialogues-solvoice-map-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const exportDir = path.join(root, "export");
  const archiveDir = path.join(root, "archive");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(exportDir, { recursive: true });
  await mkdir(archiveDir, { recursive: true });

  const rawConversation = {
    id: "conv-integration",
    title: "Synthetic integration",
    create_time: 1_000,
    current_node: "visible-node",
    mapping: {
      root: { id: "root", parent: null, children: ["thought-node"], message: null },
      "thought-node": {
        id: "thought-node",
        parent: "root",
        children: ["visible-node"],
        message: {
          id: "thought-message",
          author: { role: "assistant" },
          create_time: 1_009,
          content: { content_type: "thoughts", thoughts: [{ content: "", summary: "Generated voice synthesis" }] },
          metadata: { tool_icons: ["api_tool"] }
        }
      },
      "visible-node": {
        id: "visible-node",
        parent: "thought-node",
        children: [],
        message: {
          id: "visible-message",
          author: { role: "assistant" },
          create_time: 1_008,
          content: { content_type: "text", parts: ["Synthetic spoken text"] },
          metadata: {}
        }
      }
    }
  };
  const manifest = {
    format: "synthetic",
    version: 2,
    items: [voice("voice-integration", 1_010, "Synthetic spoken text")]
  };
  const manifestPath = path.join(archiveDir, "manifest-all.json");
  const outputPath = path.join(archiveDir, "mappings", "mapping.json");
  const reportPath = path.join(archiveDir, "mappings", "summary.json");
  await writeFile(path.join(exportDir, "conversations-000.json"), JSON.stringify([rawConversation]));
  await writeFile(manifestPath, JSON.stringify(manifest));

  const logs = [];
  const result = await runMappingTool({
    exportDir,
    manifestPath,
    outputPath,
    reportPath,
    logger: { info(message) { logs.push(message); } }
  });
  assert.equal(result.mappings[0].messageId, "visible-message");
  assert.equal(result.mappings[0].evidence.tool.apiTool, true);
  assert.equal(result.mappings[0].confidence, "exact");
  assert.equal(result.mappings[0].effectiveAnchorSource, "reasoning_api_tool");
  assert.equal(result.mappings[0].effectiveAnchorMessageId, "thought-message");
  assert.equal(result.mappings[0].effectiveAnchorAt, iso(1_009));
  assert.equal(result.mappings[0].timeDeltaSec, 1);
  assert.equal(result.mappings[0].evidence.time.visibleMessageDeltaSec, 2);
  assert.equal(result.mappings[0].reasoningSources[0].createTime, 1_009);
  assert.ok(logs.every(message => !message.includes("Synthetic spoken text")));
  const mappingFile = JSON.parse(await readFile(outputPath, "utf8"));
  assert.equal(mappingFile.version, 2);
  assert.equal(mappingFile.policy.visibleMessageTimestampPreserved, true);
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  assert.equal(report.summary.total, 1);
  assert.equal(report.summary.timeDeltaSec.basis, "effectiveAnchorTime");
  assert.equal(report.summary.timeDeltaSec.medianAbsolute, 1);
  assert.equal(report.summary.visibleMessageTimeDeltaSec.medianAbsolute, 2);
  assert.equal(report.summary.effectiveAnchorUsage.reasoningApiTool, 1);
});
