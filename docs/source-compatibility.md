# Source compatibility

Our Dialogues keeps source knowledge in adapters. An adapter converts one strictly detected source schema into `our-dialogues.normalized.v1`; the Reader renders only normalized conversations and never interprets raw Mufy markup or exporter-specific Claude fields.

The compatibility rule is conservative: an unknown or ambiguous input stays unknown. Generic keys such as `conversations` or `messages` are not enough to claim a format.

## Current matrix

| Source | JSON | ZIP / folder | Visible text | Thinking | Attachments | Status |
|---|---:|---:|---|---|---|---|
| ChatGPT official export (2026 observed) | Yes | ZIP and manifest-driven folder | Official text plus source-token cleanup | Exported `thoughts` and `reasoning_recap` | Metadata plus lazy local/ZIP assets | Implemented and regression-tested |
| Ciel House Export v1 | Yes | ZIP | Contract text fields | Preserved when exported | Lazy ZIP assets | Implemented and regression-tested |
| Mufy raw export | Yes | Single `_原始数据.json` ZIP and folder of multiple Mufy ZIPs | Known status/details markup becomes safe normalized rich blocks; unknown HTML becomes readable text; comments and script/style content are excluded | Explicit, paired `<think>` and typed thinking parts only | Not present in the calibrated raw schema | Implemented with synthetic rich-block/multi-ZIP coverage and real local schema metadata |
| Our Dialogues normalized v1 | Yes | No direct ZIP adapter | Already normalized | Preserved | Preserved | Implemented and regression-tested |
| SolVoice sidecar | Mapping JSON | `VoiceArchive` or `sol/audio` folder | Not a conversation source | Not applicable | Lazy local audio linked by strong exact message ID mapping; attaches to ChatGPT conversations only | Implemented and regression-tested |
| CielVoice sidecar | `claude-cielvoice.json` mapping v1 | Same `VoiceArchive` folder | Not a conversation source | Not applicable | Lazy local audio; mapping generated locally by exact whitespace-normalized spoken-text equality between `CielVoice:speak` tool calls and the ElevenLabs manifest; ambiguous texts are never auto-attached; binds to Claude official conversations only | Implemented and regression-tested |
| Claude official export (2026 observed) | Yes | ZIP containing `conversations.json` | Typed `text` parts; active branch followed via `parent_message_uuid`, alternates and fully empty turn pairs recorded as counts | Official stored `thinking` parts map to normalized thinking; tool_use/tool_result become capped, always-reported `sourceTrace` labeled as official tool activity | Metadata only (name, type, size, extracted-content length); bodies stay in the export file | Implemented and validated against a real 2026 export via a counts-only smoke |
| Claude Exporter webpage-plugin JSON (`ai-chat-exporter.net`) | Yes | No | Visible/interstitial replies from `say`; exact raw `say` retained | No official thinking field; marker-bounded workflow is labeled heuristic `sourceTrace` | Not exported by the calibrated schema | Implemented from two real local samples and a synthetic fixture |

No private archive is committed as a fixture. Public fixtures must be synthetic.

## Adapter capability contract

Every source adapter declares `our-dialogues.adapter-capabilities.v1`:

```js
capabilities: {
  contract: "our-dialogues.adapter-capabilities.v1",
  json: true,
  zip: false,
  folder: false,
  thinking: "preserve",
  attachments: "preserve",
  sourceMarkup: "normalized-text"
}
```

- `json` and `zip` are required booleans and must agree with the adapter's strict detect/parse methods.
- `folder` records a separately orchestrated browser-folder import.
- `thinking`, `attachments`, and `sourceMarkup` describe source-to-normalized semantics; they are capabilities, not Reader behavior switches.
- Registry detection evaluates every eligible adapter. Exactly one match is required. Multiple matches return an ambiguity diagnostic instead of choosing by registration order.

The live declarations are available through `OD.registry.capabilities()`.

## Folder source registry

The browser folder entry is source-aware. `chatgpt-official-folder` requires one valid `export_manifest.json` whose declared conversation shards are present. That strict manifest match is decisive and prevents ZIP attachments in the official export from being opened during source detection. When no ChatGPT manifest matches, `mufy-zip-folder` requires at least one ZIP that strictly matches the Mufy adapter; unrelated or corrupt ZIP files are skipped and reported as counts. A pure Mufy folder is therefore never handed to the ChatGPT importer.

Mufy folder import parses every matching ZIP and combines all contained sessions into one normalized archive. A session can merge across split/overlapping packages only when the raw data supplies both the same `characterId` and the same `sessionId`. Stable dialog IDs deduplicate repeated messages; an exact identical source record is the only fallback dedupe. Conflicting records with the same dialog ID are both preserved and marked. Character names and conversation titles never participate in identity. Missing stable identity keeps conversations separate, and the same display name with different `characterId` values always stays separate.

The Reader navigation then groups that archive as `source → characterId → sessions`. The display name is presentation only, so two characters with the same name remain separate. The standalone title resolver prioritizes archive remark, explicit exported title/name, current-session marker, first narrative assistant text, dialogue-derived text, then date + segment fallback. Rich status blocks, time/location/status labels, tools/UI markers, thinking, and source trace are excluded. The normalized conversation records one of six `titleSource` values; same-character duplicates are disambiguated only at display time.

## Persistent source library

Imports are registered as independent sources. The runtime library supplies source filtering, per-source removal, clear-all, unique runtime conversation addressing across sources, and a conservative normalized-content fingerprint that skips obvious repeat imports. Each source retains its own lazy attachment session while the page is open; removing or clearing it revokes that source's object URLs and disposes its local asset index.

IndexedDB `our-dialogues.library.v1` stores lightweight source records, one normalized conversation per record, and Reader settings/position. `File`, `Blob`, asset sessions, object URLs, ZIP media, attachments, and SolVoice audio are excluded. Browser `File` references still disappear on close, while normalized text restores automatically. Supported browsers may retain a `FileSystemDirectoryHandle`; failure to clone that handle falls back to text-only persistence.

Reader settings are source-neutral: font size, line height, content width, font family, theme, scroll/page mode, and page length persist beside the recent conversation. Page mode uses visible character volume, not message count. Progress records conversation, message anchor, page, and scroll; restore resolves the message anchor before the saved numeric page/offset.

## Mufy markup boundary

The Mufy adapter removes comments and `script`, `style`, `noscript`, and `template` content before parsing. A small non-executing parser recognizes only `fog-status-card`, `fog-status-row`, `fog-label`, `fog-comment-box`, `wg-box`, `details/summary`, common row/note classes, and bounded progress widths. It emits `source-rich-block` objects; Reader HTML is built only from escaped normalized fields. Unknown structures use the existing readable-text fallback, and the untouched source record remains in `metadata.original`.

Mufy rich blocks are visible message content. They never enter normalized `thinking` and never share Claude's heuristic `sourceTrace` channel.

## Metadata-only diagnostics

Unknown JSON and ZIP inputs return `our-dialogues.source-diagnostics.v1` rather than a loose guess. Diagnostics may contain only structural metadata:

- JSON root type
- sorted top-level key names
- root array length
- shallow candidate paths and matching key names
- ZIP entry count and JSON filenames
- adapter IDs when strict detection is ambiguous

Diagnostics never contain field values or conversation text. ZIP candidate JSON is inspected only for this bounded structural shape. The status UI formats the structure and explicitly says that no conversation text was displayed.

## Claude exporter boundary

The implemented webpage-plugin adapter is specifically for `Claude Exporter (https://www.ai-chat-exporter.net)`. Strict detection requires its exact `powered_by` fingerprint, a `claude.ai/chat/...` link, metadata dates/title, and messages shaped as `{role, say, time}` with `human` or `assistant` roles. It does not claim other Claude plugins merely because they contain generic `messages` or `content` keys.

The observed plugin stores local timestamps as `M/D/YYYY H:mm:ss`; the adapter converts them using the browser's local timezone and preserves every original record under `metadata.original`, plus the exact string under `metadata.rawSay`. It never writes heuristic content to normalized `thinking`.

Some exporter transcripts flatten workflow and replies into the same assistant `say`. The source-specific splitter treats exact `Done` lines and clear UI/tool markers such as `Viewed file`, `Searching...`, and reminder actions as boundaries. Only text inside a complete marker-bounded run is moved into `metadata.sourceTrace`; replies between runs remain visible. The trace is explicitly labeled heuristic and is shown separately from source-exported thinking. If splitting would leave no certain visible reply, the adapter displays the original `say` instead. Ambiguous unmarked text remains visible rather than being silently dropped.

Claude official export and every other plugin remain separate pending formats. Each requires its own real sample and synthetic fixture before implementation; until then, metadata-only diagnostics are the supported workflow.
