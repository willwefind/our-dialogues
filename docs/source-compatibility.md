# Source compatibility

Our Dialogues keeps source knowledge in adapters. An adapter converts one strictly detected source schema into `our-dialogues.normalized.v1`; the Reader renders only normalized conversations and never interprets Mufy markup or exporter-specific Claude fields.

The compatibility rule is conservative: an unknown or ambiguous input stays unknown. Generic keys such as `conversations` or `messages` are not enough to claim a format.

## Current matrix

| Source | JSON | ZIP / folder | Visible text | Thinking | Attachments | Status |
|---|---:|---:|---|---|---|---|
| ChatGPT official export (2026 observed) | Yes | ZIP and manifest-driven folder | Official text plus source-token cleanup | Exported `thoughts` and `reasoning_recap` | Metadata plus lazy local/ZIP assets | Implemented and regression-tested |
| Ciel House Export v1 | Yes | ZIP | Contract text fields | Preserved when exported | Lazy ZIP assets | Implemented and regression-tested |
| Mufy raw export | Yes | `_原始数据.json` ZIP | Source HTML becomes readable normalized text; comments and script/style content are excluded | Explicit, paired `<think>` and typed thinking parts only | Not present in the calibrated raw schema | Implemented from synthetic tests and real local schema metadata |
| Our Dialogues normalized v1 | Yes | No direct ZIP adapter | Already normalized | Preserved | Preserved | Implemented and regression-tested |
| SolVoice sidecar | Mapping JSON | `VoiceArchive` or `sol/audio` folder | Not a conversation source | Not applicable | Lazy local audio linked by strong exact message ID mapping | Implemented and regression-tested |
| Claude official export | No | No | Unknown | Unknown | Unknown | Pending a real export sample |
| Claude Exporter webpage-plugin JSON (`ai-chat-exporter.net`) | Yes | No | `say` text retained as exported | Not exported by the calibrated schema | Not exported by the calibrated schema | Implemented from two real local samples and a synthetic fixture |

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

The observed plugin stores local timestamps as `M/D/YYYY H:mm:ss`; the adapter converts them using the browser's local timezone and preserves every original record under `metadata.original`. The two calibrated samples contain visible text only, so the adapter does not fabricate thinking or attachments.

Claude official export and every other plugin remain separate pending formats. Each requires its own real sample and synthetic fixture before implementation; until then, metadata-only diagnostics are the supported workflow.
