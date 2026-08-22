# Bring your own archive — with your own AI's help

**English** | [简体中文](bring-your-own-archive.zh-CN.md)

Our Dialogues imports ChatGPT official exports, Claude official exports, Mufy
batches, and a few other formats directly. Everything else in the world —
your self-hosted system, another platform's export, a folder of hand-kept
logs — can still come in, because **the universal entry point is a documented
open format, and your own AI is the best converter there is.**

The heart of this guide is a **ready-made prompt**. Hand it to your AI
together with your data; they produce a `our-dialogues.normalized.v1` JSON;
you import it with one click. The docs are written for the AI to read — which
is exactly how a reader for human–AI conversations should work.

> 💡 The conversion happens inside your own chat with your own AI.
> Our Dialogues still uploads nothing, at any step.

## When you need this

Anything that is **not** a ChatGPT/Claude official export, a Mufy batch, or an
`ai-chat-exporter.net` JSON: custom systems, other platforms, loose text logs.

## Step 1 — give your AI the prompt

Copy the block below to your AI, then give them your data (in batches if it is
large):

````text
Please convert my chat logs into the Our Dialogues normalized format
(our-dialogues.normalized.v1).

OUTPUT: one UTF-8 .json file:

{
  "schema": "our-dialogues.normalized.v1",
  "source": { "platform": "<short stable lowercase name>", "exporter": "<tool or origin name>", "formatVersion": 1 },
  "exportedAt": "<ISO 8601 or null>",
  "conversations": [ {
    "id": "<unique, stable across re-runs>",
    "title": "<short; derive neutrally if the source has none>",
    "createdAt": "<ISO 8601 or null — never invent>",
    "context": {},
    "participants": [],
    "messages": [ {
      "id": "<unique within the conversation, stable>",
      "role": "<one of: user / assistant / system / tool / other>",
      "speaker": "<display name>",
      "createdAt": "<ISO 8601, omit if unknown>",
      "content": [ {"type": "text", "text": "<verbatim text>"} ]
    } ]
  } ]
}

RULES
1. Verbatim text: no rewording, no fixes, no translation.
2. Never invent: unknown times are null/omitted; titles derived neutrally.
3. Stable IDs: the same input must yield the same IDs (bookmarks, highlights,
   and progress anchor to them).
4. content is always an array of {"type":"text","text":...} items.
5. Map roles to the five allowed values; keep the original under
   metadata.originalRole when it differs.
6. Only use "thinking": [{"type":"text","text":...}] when the source explicitly
   contains reasoning content; never move visible text there.
7. Keep newlines as \n; never merge or split messages.
8. For large data, emit several complete valid files (I will import each;
   sources coexist) with no duplicate conversation IDs across batches.

SELF-CHECK before delivery: valid JSON (no comments/trailing commas); schema
string exact; all roles allowed; IDs unique; spot-check three messages against
the source. Then report: conversations/messages converted, and anything you
handled conservatively.
````

## Step 2 — import

Reader ([online](https://willwefind.github.io/our-dialogues/) or local) →
sidebar 来源 **＋** → **选择 JSON / ZIP** → pick the file. Everything —
bookmarks, highlights, search, exports, themes — now works on your data.

## Advanced: your own voice clips

Have audio for specific messages? Ask your AI for a mapping file in the
`our-dialogues.solvoice-chatgpt-mapping` v2 format (see the Chinese guide for
the ready-made prompt): entries of `{messageId, audioPath, confidence:
"strong"}` plus a `voiceLabel`, saved as `chatgpt-solvoice.json`. That format
binds to sources with `platform: "chatgpt"` (the
`our-dialogues.cielvoice-claude-mapping` v1 binds to `claude`), so set your
archive's `source.platform` accordingly. Then: ＋ menu → 语音档案 → pick the
folder holding the mapping + audio files. Strong mappings only, by design.

## FAQ

- **"Unrecognized" on import** — usually a misspelled `schema` string,
  comments/trailing commas, or non-UTF-8 encoding. Show the error to your AI.
- **Common format?** Open an issue with a **synthetic sample** (same structure,
  invented content) — popular formats can become built-in adapters. Never post
  real conversations.
