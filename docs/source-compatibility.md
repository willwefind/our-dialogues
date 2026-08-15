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
| Claude webpage-plugin JSON | No | No | Unknown | Unknown | Unknown | Blocked on the user's real plugin sample; schema-only diagnostics implemented |

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

## Adding Claude support

Claude plugin exporters do not share one reliable public schema. A Claude adapter must be calibrated against the actual exporter sample, then receive a fully synthetic fixture with the same structure. Until that sample is available, diagnostics are the supported workflow; a detector must not infer Claude solely from generic `chat`, `messages`, or `content` keys.
