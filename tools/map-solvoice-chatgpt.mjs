import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPOSITORY_ROOT = path.resolve(path.dirname(SCRIPT_PATH), "..");
const FORMAT = "our-dialogues.solvoice-chatgpt-mapping";
const VERSION = 2;
const VOICE_PATTERN = /\b(?:voice|speech|synthesi[sz](?:e|ed|ing|er|ation)?|audio|speak(?:ing|s|er)?|spoken|tts|text[ -]?to[ -]?speech)\b|语音|合成|朗读|声音|说话|音声|発話|読み上げ|スピーチ/giu;
const NORMALIZED_TEXT_CACHE = new Map();

function defaultPaths() {
  const archive = process.platform === "win32"
    ? "D:\\Our Dialogues\\VoiceArchive"
    : path.join(REPOSITORY_ROOT, "VoiceArchive");
  return {
    exportDir: process.platform === "win32"
      ? "D:\\Our Dialogues\\SolMyLove"
      : path.join(REPOSITORY_ROOT, "private", "chatgpt-export"),
    manifestPath: path.join(archive, "manifest-all.json"),
    outputPath: path.join(archive, "mappings", "chatgpt-solvoice.json"),
    reportPath: path.join(archive, "mappings", "chatgpt-solvoice-summary.json")
  };
}

export function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      options.help = true;
      continue;
    }
    const [name, inlineValue] = argument.split("=", 2);
    if (!["--export", "--manifest", "--output", "--report", "--top-n", "--anchor-history-id", "--anchor-conversation-id"].includes(name)) {
      throw new Error(`Unknown option: ${argument}`);
    }
    const value = inlineValue ?? argv[++index];
    if (!value || value.startsWith("--")) throw new Error(`${name} requires a value.`);
    if (name === "--export") options.exportDir = value;
    if (name === "--manifest") options.manifestPath = value;
    if (name === "--output") options.outputPath = value;
    if (name === "--report") options.reportPath = value;
    if (name === "--anchor-history-id") options.anchorHistoryItemId = value;
    if (name === "--anchor-conversation-id") options.anchorConversationId = value;
    if (name === "--top-n") {
      const number = Number(value);
      if (!Number.isInteger(number) || number < 1 || number > 20) {
        throw new Error("--top-n must be an integer from 1 to 20.");
      }
      options.topN = number;
    }
  }
  return options;
}

function usage() {
  return `SolVoice to ChatGPT Mapping

Usage:
  node tools\\map-solvoice-chatgpt.mjs [options]

Options:
  --export <folder>    ChatGPT official export folder
  --manifest <file>    VoiceArchive manifest-all.json
  --output <file>      Local mapping JSON
  --report <file>      Content-free local summary JSON
  --top-n <1-20>       Candidate count retained per clip (default: 5)
  --anchor-history-id <id>      Optional local validation anchor
  --anchor-conversation-id <id> Expected conversation for the validation anchor
  -h, --help           Show this help
`;
}

function shardNumber(name) {
  return Number((name.match(/conversations-(\d+)\.json$/i) || [])[1] || 0);
}

async function loadOfficialAdapter() {
  const runtime = { console };
  runtime.window = runtime;
  runtime.globalThis = runtime;
  vm.createContext(runtime);
  for (const relativePath of ["src/core/schema.js", "src/adapters/chatgpt-official.js"]) {
    const source = await readFile(path.join(REPOSITORY_ROOT, relativePath), "utf8");
    vm.runInContext(source, runtime, { filename: relativePath });
  }
  const adapter = runtime.OD.adapters.find(item => item.id === "chatgpt-official-2026");
  if (!adapter?.parseJSON) throw new Error("The ChatGPT official adapter could not be loaded.");
  return adapter;
}

export async function loadChatGPTExportFolder(exportDir) {
  const names = (await readdir(exportDir))
    .filter(name => /^conversations-\d+\.json$/i.test(name))
    .sort((left, right) => shardNumber(left) - shardNumber(right));
  if (!names.length) {
    const allInOne = (await readdir(exportDir)).find(name => /^conversations\.json$/i.test(name));
    if (allInOne) names.push(allInOne);
  }
  if (!names.length) throw new Error("No ChatGPT conversations JSON shards were found.");

  const rawConversations = [];
  for (const name of names) {
    const payload = JSON.parse(await readFile(path.join(exportDir, name), "utf8"));
    if (Array.isArray(payload)) rawConversations.push(...payload);
    else if (Array.isArray(payload?.conversations)) rawConversations.push(...payload.conversations);
    else throw new Error(`${name} does not contain a conversation array.`);
  }
  const adapter = await loadOfficialAdapter();
  return { archive: adapter.parseJSON(rawConversations), shardCount: names.length };
}

export async function loadSolVoiceRecords(manifestPath) {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (!Array.isArray(manifest?.items)) throw new Error("VoiceArchive manifest has no items array.");
  return manifest.items
    .filter(item => item?.speaker === "sol" && item?.historyItemId)
    .sort((left, right) => Number(left.dateUnix || 0) - Number(right.dateUnix || 0));
}

function textOf(items) {
  return (Array.isArray(items) ? items : [])
    .map(item => typeof item === "string" ? item : item?.text || "")
    .filter(Boolean)
    .join("\n");
}

function rawTextVariants(value) {
  const original = String(value ?? "").normalize("NFKC");
  const values = new Set([original, original.replace(/<[^>]*>|\[[^\]\n]{1,80}\]/g, " ")]);
  if (/[ÃÂð]|â(?:€|™|€œ|€�)|ï¿½/.test(original)) {
    const bytes = [];
    let reversible = true;
    for (const character of original) {
      const point = character.codePointAt(0);
      if (point > 255) {
        reversible = false;
        break;
      }
      bytes.push(point);
    }
    if (reversible) {
      const repaired = Buffer.from(bytes).toString("utf8");
      if (!repaired.includes("�")) values.add(repaired);
    }
  }
  return [...values];
}

export function normalizeMatchText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("und")
    .replace(/\uE200(?:cite|filecite|entity|image_group|navlist|finance|schedule|standing|forecast)\uE202[\s\S]*?\uE201/g, "")
    .replace(/[\uE200\uE201\uE202\uFFFD\p{Cc}\p{Cf}]/gu, "")
    .match(/[\p{L}\p{N}]/gu)?.join("") || "";
}

function ngramSet(text, size) {
  if (!text) return new Set();
  if (text.length <= size) return new Set([text]);
  const result = new Set();
  for (let index = 0; index <= text.length - size; index += 1) {
    result.add(text.slice(index, index + size));
  }
  return result;
}

function dice(left, right, size) {
  const a = ngramSet(left, size);
  const b = ngramSet(right, size);
  if (!a.size || !b.size) return 0;
  let overlap = 0;
  for (const value of a) if (b.has(value)) overlap += 1;
  return (2 * overlap) / (a.size + b.size);
}

function lcsRatio(left, right) {
  if (!left || !right || left.length > 700 || right.length > 700) return 0;
  const previous = new Uint16Array(right.length + 1);
  const current = new Uint16Array(right.length + 1);
  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      current[j] = left[i - 1] === right[j - 1]
        ? previous[j - 1] + 1
        : Math.max(previous[j], current[j - 1]);
    }
    previous.set(current);
    current.fill(0);
  }
  return (2 * previous[right.length]) / (left.length + right.length);
}

function compareNormalizedText(left, right) {
  if (!left || !right) return { score: 0, method: "none" };
  if (left === right) return { score: 1, method: "exact" };
  if (left.includes(right) || right.includes(left)) {
    const coverage = Math.min(left.length, right.length) / Math.max(left.length, right.length);
    return { score: Math.max(0.72, coverage), method: "substring" };
  }
  const measures = [
    { score: dice(left, right, 2) * 0.94, method: "character-bigram" },
    { score: dice(left, right, 3), method: "character-trigram" }
  ];
  const quickBest = measures.sort((a, b) => b.score - a.score)[0];
  if (quickBest.score >= 0.15 && left.length <= 400 && right.length <= 400) {
    measures.push({ score: lcsRatio(left, right), method: "lcs" });
  }
  return measures.sort((a, b) => b.score - a.score)[0];
}

function normalizedVariants(value) {
  const key = String(value ?? "");
  if (NORMALIZED_TEXT_CACHE.has(key)) return NORMALIZED_TEXT_CACHE.get(key);
  const variants = [...new Set(rawTextVariants(key).map(normalizeMatchText).filter(Boolean))];
  NORMALIZED_TEXT_CACHE.set(key, variants);
  return variants;
}

function farTextSimilarity(left, right) {
  let best = { score: 0, method: "none", leftLength: 0, rightLength: 0 };
  for (const normalizedLeft of normalizedVariants(left)) {
    for (const normalizedRight of normalizedVariants(right)) {
      if (normalizedLeft === normalizedRight) {
        return { score: 1, method: "exact", leftLength: normalizedLeft.length, rightLength: normalizedRight.length };
      }
      if (normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft)) {
        const coverage = Math.min(normalizedLeft.length, normalizedRight.length)
          / Math.max(normalizedLeft.length, normalizedRight.length);
        const score = Math.max(0.72, coverage);
        if (score > best.score) {
          best = { score, method: "substring", leftLength: normalizedLeft.length, rightLength: normalizedRight.length };
        }
      }
    }
  }
  return { ...best, score: Number(best.score.toFixed(4)) };
}

export function textSimilarity(left, right) {
  let best = { score: 0, method: "none", leftLength: 0, rightLength: 0 };
  for (const normalizedLeft of normalizedVariants(left)) {
    for (const normalizedRight of normalizedVariants(right)) {
      const result = compareNormalizedText(normalizedLeft, normalizedRight);
      if (result.score > best.score) {
        best = {
          score: Number(result.score.toFixed(4)),
          method: result.method,
          leftLength: normalizedLeft.length,
          rightLength: normalizedRight.length
        };
      }
    }
  }
  return best;
}

function asStringArray(value) {
  if (Array.isArray(value)) return value.flatMap(asStringArray);
  if (value == null) return [];
  return [String(value)];
}

function voiceKeywords(value) {
  return [...new Set(asStringArray(value)
    .flatMap(text => [...text.matchAll(VOICE_PATTERN)].map(match => match[0].toLocaleLowerCase("und"))))];
}

function unixSeconds(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value > 1e12 ? value / 1000 : value;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed / 1000 : null;
}

function isoFromUnix(seconds) {
  if (!Number.isFinite(seconds)) return null;
  return new Date(seconds * 1000).toISOString();
}

function normalizeReasoningSource(source) {
  if (!source || typeof source !== "object") return null;
  const createdUnix = unixSeconds(source.createTime ?? source.createdAt);
  const toolIcons = asStringArray(source.toolIcons);
  return {
    messageId: source.messageId == null ? null : String(source.messageId),
    createTime: source.createTime ?? null,
    createdAt: isoFromUnix(createdUnix),
    createdUnix,
    contentType: source.contentType == null ? null : String(source.contentType),
    toolIcons,
    apiTool: toolIcons.includes("api_tool")
  };
}

export function buildAssistantAnchors(conversations) {
  const anchors = [];
  for (const conversation of conversations || []) {
    let assistantIndex = 0;
    for (const message of conversation.messages || []) {
      if (message.role !== "assistant") continue;
      const metadata = message.metadata || {};
      const visibleText = textOf(message.content);
      const reasoningText = [
        textOf(message.thinking),
        ...asStringArray(metadata.reasoningRecap),
        ...(message.thinking || []).map(item => item?.summary || "")
      ].filter(Boolean).join("\n");
      const reasoningSources = (Array.isArray(metadata.reasoningSources) ? metadata.reasoningSources : [])
        .map(normalizeReasoningSource)
        .filter(Boolean);
      const icons = new Set([
        ...asStringArray(metadata.originalMetadata?.tool_icons),
        ...asStringArray(metadata.reasoningToolIcons),
        ...reasoningSources.flatMap(source => source.toolIcons)
      ]);
      const createdUnix = unixSeconds(message.createdAt);
      if (createdUnix != null && (visibleText || reasoningText || icons.size)) {
        anchors.push({
          conversationId: conversation.id,
          conversationTitle: conversation.title,
          conversationCreatedAt: conversation.createdAt,
          messageId: message.id,
          messageCreatedAt: message.createdAt,
          messageCreatedUnix: createdUnix,
          messageIndex: assistantIndex,
          visibleText,
          apiTool: icons.has("api_tool"),
          voiceKeywords: voiceKeywords(reasoningText),
          reasoningOnly: metadata.reasoningOnly === true,
          reasoningSourceMessageIds: asStringArray(metadata.reasoningSourceMessageIds),
          reasoningSources
        });
      }
      assistantIndex += 1;
    }
  }
  return anchors;
}

function closestReasoningSource(sources, voiceUnix) {
  return [...sources].sort((left, right) => Math.abs(voiceUnix - left.createdUnix)
    - Math.abs(voiceUnix - right.createdUnix)
    || left.createdUnix - right.createdUnix
    || String(left.messageId).localeCompare(String(right.messageId)))[0] || null;
}

export function effectiveAnchorTime(anchor, voiceUnix) {
  const timedSources = (anchor.reasoningSources || []).filter(source => Number.isFinite(source.createdUnix));
  const toolSource = closestReasoningSource(timedSources.filter(source => source.apiTool), voiceUnix);
  if (toolSource) {
    return {
      unix: toolSource.createdUnix,
      at: toolSource.createdAt,
      source: "reasoning_api_tool",
      sourceMessageId: toolSource.messageId,
      sourceContentType: toolSource.contentType
    };
  }
  if (anchor.voiceKeywords?.length) {
    const reasoningSource = closestReasoningSource(timedSources, voiceUnix);
    if (reasoningSource) {
      return {
        unix: reasoningSource.createdUnix,
        at: reasoningSource.createdAt,
        source: "reasoning_voice_summary",
        sourceMessageId: reasoningSource.messageId,
        sourceContentType: reasoningSource.contentType
      };
    }
  }
  return {
    unix: anchor.messageCreatedUnix,
    at: anchor.messageCreatedAt,
    source: "assistant_message",
    sourceMessageId: anchor.messageId,
    sourceContentType: null
  };
}

function timePoints(absDeltaSec) {
  if (absDeltaSec <= 15) return 36;
  if (absDeltaSec <= 30) return 33;
  if (absDeltaSec <= 60) return 29;
  if (absDeltaSec <= 120) return 24;
  if (absDeltaSec <= 300) return 17;
  if (absDeltaSec <= 900) return 10;
  if (absDeltaSec <= 3600) return 4;
  return 0;
}

function textPoints(similarity) {
  if (similarity >= 0.98) return 46;
  if (similarity >= 0.85) return 40;
  if (similarity >= 0.65) return 32;
  if (similarity >= 0.45) return 24;
  if (similarity >= 0.30) return 15;
  if (similarity >= 0.20) return 8;
  return 0;
}

export function scoreCandidate(voice, anchor) {
  const voiceUnix = unixSeconds(voice.createdAt ?? voice.dateUnix);
  if (voiceUnix == null) return null;
  const effectiveAnchor = effectiveAnchorTime(anchor, voiceUnix);
  const deltaSec = voiceUnix - effectiveAnchor.unix;
  const absDeltaSec = Math.abs(deltaSec);
  const visibleMessageDeltaSec = voiceUnix - anchor.messageCreatedUnix;
  const text = absDeltaSec <= 24 * 3600
    ? textSimilarity(voice.text, anchor.visibleText)
    : farTextSimilarity(voice.text, anchor.visibleText);
  const timeScore = timePoints(absDeltaSec);
  const textScore = textPoints(text.score);
  const toolScore = anchor.apiTool ? 10 : 0;
  const voiceScore = anchor.voiceKeywords.length ? 10 : 0;
  const directionScore = deltaSec >= -180 && deltaSec <= 1800 ? 2 : 0;
  const reasoningPenalty = anchor.reasoningOnly ? -6 : 0;
  const score = timeScore + textScore + toolScore + voiceScore + directionScore + reasoningPenalty;
  const eligible = absDeltaSec <= 6 * 3600
    || text.score >= 0.20
    || (anchor.apiTool && anchor.voiceKeywords.length > 0 && absDeltaSec <= 24 * 3600);
  if (!eligible || score < 5) return null;
  return {
    ...anchor,
    deltaSec,
    absDeltaSec,
    score,
    baseScore: score,
    orderAligned: false,
    orderMethod: "independent",
    evidence: {
      time: {
        deltaSec,
        absDeltaSec,
        points: timeScore,
        effectiveAnchorAt: effectiveAnchor.at,
        effectiveAnchorSource: effectiveAnchor.source,
        effectiveAnchorMessageId: effectiveAnchor.sourceMessageId,
        effectiveAnchorContentType: effectiveAnchor.sourceContentType,
        visibleMessageAt: anchor.messageCreatedAt,
        visibleMessageDeltaSec
      },
      text: { ...text, points: textScore },
      tool: { apiTool: anchor.apiTool, points: toolScore },
      voiceSummary: { matched: anchor.voiceKeywords.length > 0, keywords: anchor.voiceKeywords, points: voiceScore },
      direction: { plausible: directionScore > 0, points: directionScore },
      order: { aligned: false, method: "independent", points: 0 }
    }
  };
}

function compareCandidates(left, right) {
  return right.score - left.score
    || left.absDeltaSec - right.absDeltaSec
    || String(left.messageId).localeCompare(String(right.messageId));
}

function bestConversation(candidates) {
  const byConversation = new Map();
  for (const candidate of candidates) {
    const current = byConversation.get(candidate.conversationId);
    if (!current || compareCandidates(candidate, current) < 0) {
      byConversation.set(candidate.conversationId, candidate);
    }
  }
  return [...byConversation.values()].sort(compareCandidates);
}

function monotonicSelections(entries) {
  let states = new Map([["-1", { score: 0, lastIndex: -1, path: [] }]]);
  for (const entry of entries) {
    const next = new Map();
    for (const state of states.values()) {
      const skipped = { score: state.score, lastIndex: state.lastIndex, path: [...state.path, null] };
      const skipKey = String(state.lastIndex);
      if (!next.has(skipKey) || next.get(skipKey).score < skipped.score) next.set(skipKey, skipped);
      for (const candidate of entry.options) {
        if (candidate.messageIndex < state.lastIndex) continue;
        const transitionBonus = candidate.messageIndex === state.lastIndex ? 1 : 3;
        const selected = {
          score: state.score + candidate.baseScore + transitionBonus,
          lastIndex: candidate.messageIndex,
          path: [...state.path, candidate]
        };
        const key = String(candidate.messageIndex);
        if (!next.has(key) || next.get(key).score < selected.score) next.set(key, selected);
      }
    }
    states = next;
  }
  return [...states.values()].sort((left, right) => right.score - left.score)[0]?.path || [];
}

function applyMonotonicOrder(scoredVoices) {
  const choices = new Map();
  for (const item of scoredVoices) {
    const conversations = bestConversation(item.candidates);
    if (!conversations.length || conversations[0].score < 38) continue;
    const margin = conversations[0].score - (conversations[1]?.score ?? 0);
    if (margin < 4 && conversations[0].evidence.text.score < 0.85) continue;
    choices.set(item.voice.historyItemId, conversations[0].conversationId);
  }

  const groups = new Map();
  for (const item of scoredVoices) {
    const conversationId = choices.get(item.voice.historyItemId);
    if (!conversationId) continue;
    const within = item.candidates.filter(candidate => candidate.conversationId === conversationId);
    const best = within[0]?.baseScore ?? 0;
    const options = within.filter(candidate => candidate.baseScore >= Math.max(20, best - 18));
    if (!groups.has(conversationId)) groups.set(conversationId, []);
    groups.get(conversationId).push({ item, options });
  }

  const selected = new Map();
  for (const entries of groups.values()) {
    entries.sort((left, right) => unixSeconds(left.item.voice.createdAt ?? left.item.voice.dateUnix)
      - unixSeconds(right.item.voice.createdAt ?? right.item.voice.dateUnix));
    const path = monotonicSelections(entries);
    for (let index = 0; index < entries.length; index += 1) {
      const candidate = path[index];
      if (!candidate) continue;
      candidate.orderAligned = true;
      candidate.orderMethod = "conversation-monotonic-dp";
      const bonus = entries.length > 1 ? 5 : 2;
      candidate.score = candidate.baseScore + bonus;
      candidate.evidence.order = { aligned: true, method: candidate.orderMethod, points: bonus };
      selected.set(entries[index].item.voice.historyItemId, candidate);
    }
  }
  return selected;
}

function evidenceCount(candidate) {
  return [
    candidate.evidence.time.absDeltaSec <= 900,
    candidate.evidence.text.score >= 0.20,
    candidate.evidence.tool.apiTool,
    candidate.evidence.voiceSummary.matched
  ].filter(Boolean).length;
}

export function confidenceFor(candidate, runnerUp) {
  if (!candidate || candidate.score < 38) return "unmatched";
  const margin = candidate.score - (runnerUp?.score ?? 0);
  const text = candidate.evidence.text.score;
  const absTime = candidate.evidence.time.absDeltaSec;
  const toolAndVoice = candidate.evidence.tool.apiTool && candidate.evidence.voiceSummary.matched;
  if (text >= 0.94 && absTime <= 120 && (toolAndVoice || candidate.evidence.tool.apiTool) && margin >= 10) {
    return "exact";
  }
  if ((candidate.score >= 72 && margin >= 10 && (text >= 0.55 || toolAndVoice) && absTime <= 900)
    || (absTime <= 45 && toolAndVoice && candidate.score >= 58 && margin >= 8)) {
    return "strong";
  }
  if (candidate.score >= 55 && margin >= 7 && evidenceCount(candidate) >= 2 && absTime <= 3600) {
    return "probable";
  }
  return "ambiguous";
}

function publicCandidate(candidate, selected = false) {
  return {
    conversationId: candidate.conversationId,
    conversationTitle: candidate.conversationTitle,
    messageId: candidate.messageId,
    messageIndex: candidate.messageIndex,
    messageCreatedAt: candidate.messageCreatedAt,
    effectiveAnchorAt: candidate.evidence.time.effectiveAnchorAt,
    effectiveAnchorSource: candidate.evidence.time.effectiveAnchorSource,
    effectiveAnchorMessageId: candidate.evidence.time.effectiveAnchorMessageId,
    timeDeltaSec: Number(candidate.deltaSec.toFixed(3)),
    reasoningSources: candidate.reasoningSources,
    score: candidate.score,
    selected,
    evidence: candidate.evidence
  };
}

export function mapSolVoiceRecords({ voiceRecords, conversations, topN = 5 }) {
  const anchors = buildAssistantAnchors(conversations);
  const scoredVoices = voiceRecords.map(voice => ({
    voice,
    candidates: anchors
      .map(anchor => scoreCandidate(voice, anchor))
      .filter(Boolean)
      .sort(compareCandidates)
  }));
  const orderedSelections = applyMonotonicOrder(scoredVoices);

  const mappings = scoredVoices.map(item => {
    const selected = orderedSelections.get(item.voice.historyItemId) || item.candidates[0] || null;
    const ranked = [...item.candidates].sort(compareCandidates);
    if (selected && !ranked.includes(selected)) ranked.unshift(selected);
    const alternatives = ranked.filter(candidate => candidate !== selected);
    const runnerUp = alternatives[0] || null;
    const confidence = confidenceFor(selected, runnerUp);
    const accepted = !["ambiguous", "unmatched"].includes(confidence);
    const candidates = [selected, ...alternatives]
      .filter(Boolean)
      .filter((candidate, index, array) => array.indexOf(candidate) === index)
      .slice(0, topN)
      .map(candidate => publicCandidate(candidate, candidate === selected));
    return {
      historyItemId: item.voice.historyItemId,
      audioPath: item.voice.audioPath || null,
      voiceCreatedAt: item.voice.createdAt || (item.voice.dateUnix != null
        ? new Date(Number(item.voice.dateUnix) * 1000).toISOString()
        : null),
      conversationId: accepted ? selected?.conversationId || null : null,
      conversationTitle: accepted ? selected?.conversationTitle || null : null,
      messageId: accepted ? selected?.messageId || null : null,
      messageIndex: accepted ? selected?.messageIndex ?? null : null,
      messageCreatedAt: accepted ? selected?.messageCreatedAt || null : null,
      effectiveAnchorAt: accepted ? selected?.evidence.time.effectiveAnchorAt || null : null,
      effectiveAnchorSource: accepted ? selected?.evidence.time.effectiveAnchorSource || null : null,
      effectiveAnchorMessageId: accepted ? selected?.evidence.time.effectiveAnchorMessageId || null : null,
      timeDeltaSec: accepted && selected ? Number(selected.deltaSec.toFixed(3)) : null,
      reasoningSources: accepted ? selected?.reasoningSources || [] : [],
      confidence,
      score: selected?.score ?? 0,
      evidence: selected?.evidence || null,
      topCandidates: candidates
    };
  });
  return { anchors, mappings };
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function summarizeMappings(mappings, { anchorHistoryItemId, anchorConversationId } = {}) {
  const confidence = { exact: 0, strong: 0, probable: 0, ambiguous: 0, unmatched: 0 };
  for (const mapping of mappings) confidence[mapping.confidence] += 1;
  const accepted = mappings.filter(mapping => !["ambiguous", "unmatched"].includes(mapping.confidence));
  const deltas = accepted.map(mapping => Math.abs(mapping.timeDeltaSec)).filter(Number.isFinite);
  const visibleDeltas = accepted
    .map(mapping => Math.abs(mapping.evidence?.time?.visibleMessageDeltaSec))
    .filter(Number.isFinite);
  const grouped = new Map();
  for (const mapping of accepted) {
    const current = grouped.get(mapping.conversationId) || { conversationId: mapping.conversationId, count: 0 };
    current.count += 1;
    grouped.set(mapping.conversationId, current);
  }
  const target = anchorHistoryItemId
    ? mappings.find(mapping => mapping.historyItemId === anchorHistoryItemId)
    : null;
  const targetCandidate = anchorConversationId
    ? target?.topCandidates.find(candidate => candidate.conversationId === anchorConversationId)
    : null;
  const targetCandidateSummary = targetCandidate ? {
    conversationId: targetCandidate.conversationId,
    messageId: targetCandidate.messageId,
    messageIndex: targetCandidate.messageIndex,
    messageCreatedAt: targetCandidate.messageCreatedAt,
    effectiveAnchorAt: targetCandidate.effectiveAnchorAt,
    effectiveAnchorSource: targetCandidate.effectiveAnchorSource,
    effectiveAnchorMessageId: targetCandidate.effectiveAnchorMessageId,
    timeDeltaSec: targetCandidate.timeDeltaSec,
    reasoningSources: targetCandidate.reasoningSources,
    score: targetCandidate.score,
    selected: targetCandidate.selected,
    evidence: targetCandidate.evidence
  } : null;
  return {
    total: mappings.length,
    confidence,
    accepted: accepted.length,
    byConversation: [...grouped.values()].sort((left, right) => right.count - left.count
      || left.conversationId.localeCompare(right.conversationId)),
    timeDeltaSec: {
      basis: "effectiveAnchorTime",
      maximumAbsolute: deltas.length ? Number(Math.max(...deltas).toFixed(3)) : null,
      medianAbsolute: deltas.length ? Number(median(deltas).toFixed(3)) : null
    },
    visibleMessageTimeDeltaSec: {
      maximumAbsolute: visibleDeltas.length ? Number(Math.max(...visibleDeltas).toFixed(3)) : null,
      medianAbsolute: visibleDeltas.length ? Number(median(visibleDeltas).toFixed(3)) : null
    },
    effectiveAnchorUsage: {
      reasoningApiTool: accepted.filter(mapping => mapping.effectiveAnchorSource === "reasoning_api_tool").length,
      reasoningVoiceSummary: accepted.filter(mapping => mapping.effectiveAnchorSource === "reasoning_voice_summary").length,
      assistantMessage: accepted.filter(mapping => mapping.effectiveAnchorSource === "assistant_message").length
    },
    evidenceUsage: {
      text: accepted.filter(mapping => mapping.evidence?.text?.score >= 0.20).length,
      apiTool: accepted.filter(mapping => mapping.evidence?.tool?.apiTool).length,
      voiceSummary: accepted.filter(mapping => mapping.evidence?.voiceSummary?.matched).length,
      monotonicOrder: accepted.filter(mapping => mapping.evidence?.order?.aligned).length
    },
    targetAnchor: target ? {
      historyItemId: target.historyItemId,
      expectedConversationId: anchorConversationId || null,
      confidence: target.confidence,
      selectedConversationId: target.conversationId,
      selectedMessageId: target.messageId,
      effectiveAnchorAt: target.effectiveAnchorAt,
      effectiveAnchorSource: target.effectiveAnchorSource,
      effectiveAnchorMessageId: target.effectiveAnchorMessageId,
      timeDeltaSec: target.timeDeltaSec,
      score: target.score,
      expectedConversationCandidate: targetCandidateSummary,
      evidence: target.evidence
    } : null
  };
}

async function atomicJSON(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(temporaryPath, filePath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

export async function runMappingTool({
  exportDir,
  manifestPath,
  outputPath,
  reportPath,
  topN = 5,
  anchorHistoryItemId,
  anchorConversationId,
  logger = console
}) {
  const [{ archive, shardCount }, voiceRecords] = await Promise.all([
    loadChatGPTExportFolder(exportDir),
    loadSolVoiceRecords(manifestPath)
  ]);
  logger.info(`Loaded ${voiceRecords.length} SolVoice record(s), ${archive.conversations.length} conversation(s), and ${shardCount} shard(s).`);
  const { anchors, mappings } = mapSolVoiceRecords({
    voiceRecords,
    conversations: archive.conversations,
    topN
  });
  const summary = summarizeMappings(mappings, { anchorHistoryItemId, anchorConversationId });
  const generatedAt = new Date().toISOString();
  await Promise.all([
    atomicJSON(outputPath, {
      format: FORMAT,
      version: VERSION,
      generatedAt,
      source: { voiceManifest: path.resolve(manifestPath), chatgptExportFolder: path.resolve(exportDir) },
      policy: {
        acceptedConfidence: ["exact", "strong", "probable"],
        ambiguousAndUnmatchedHaveNoSelectedMapping: true,
        multipleVoiceClipsPerAssistantTurn: true,
        orderStrategy: "conversation-monotonic-dp",
        timeStrategy: "reasoning_api_tool_then_voice_summary_then_assistant_message",
        visibleMessageTimestampPreserved: true
      },
      summary,
      mappings
    }),
    atomicJSON(reportPath, {
      format: `${FORMAT}.summary`,
      version: VERSION,
      generatedAt,
      inputs: {
        solVoiceRecords: voiceRecords.length,
        conversations: archive.conversations.length,
        shards: shardCount,
        assistantAnchors: anchors.length
      },
      summary
    })
  ]);
  logger.info(`Confidence counts: ${Object.entries(summary.confidence).map(([name, count]) => `${name}=${count}`).join(", ")}.`);
  if (summary.targetAnchor) {
    const target = summary.targetAnchor;
    logger.info(`Target anchor ${target.historyItemId}: ${target.confidence}, message=${target.selectedMessageId || "none"}, delta=${target.timeDeltaSec ?? "none"}s.`);
  }
  return { mappings, summary, outputPath, reportPath };
}

async function main() {
  const defaults = defaultPaths();
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage());
    return;
  }
  await runMappingTool({ ...defaults, ...args });
}

if (path.resolve(process.argv[1] || "") === path.resolve(SCRIPT_PATH)) {
  main().catch(error => {
    console.error(`SolVoice mapping failed: ${error.message}`);
    process.exitCode = 1;
  });
}
