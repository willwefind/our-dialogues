# Our Dialogues

A local-first reader for AI conversation archives.

> **Your conversations stay on your device.**  
> Files are parsed in the browser. This project does not upload your archive to a server.

## Status

Early v0.1 scaffold.

Currently included:

- Normalized conversation schema v1
- Ciel House Export v1 contract
- Ciel House adapter
- Mufy raw-export adapter
- Provisional ChatGPT official-export adapter
- Local JSON / ZIP import
- Conversation list, title/full-text search, message rendering
- Hide-my-messages toggle
- Thinking/reasoning expand toggle when an export actually contains it
- Fake fixtures only — no private conversations are committed

Planned next:

- Validate ChatGPT adapter against a real 2026 official export
- Add Claude exporter adapters from real samples
- Better attachment/audio/image rendering
- EPUB / Markdown / HTML export
- Tags, favorites, timeline, richer full-text search
- Vendored ZIP fallback for browsers without `DecompressionStream`

## Created by

**Dawn (willwefind) × Sol (GPT-5.6 Sol)**

Our Dialogues is a co-created project: product direction, archive philosophy, interaction decisions, schema design, adapter architecture, and implementation are developed collaboratively by Dawn and Sol.

- **Dawn / willwefind** — creator, product direction, testing, visual and reading experience
- **Sol / GPT-5.6 Sol** — co-creator, system design, schemas, adapter architecture, implementation

This project grew out of a very simple problem: we knew an old conversation still existed; we just wanted to find and read it again.

## Why this exists

Backups answer:

> “How do I keep this from disappearing?”

This reader answers:

> “How do I find and read it again?”

Different platforms and exporters may all use JSON, while still using completely different schemas. Our Dialogues uses small source-specific adapters to convert those formats into one normalized in-memory model, then renders that model with one reader UI.

```text
ChatGPT export ──→ adapter ──┐
Claude export  ──→ adapter ──┤
Mufy export    ──→ adapter ──┤──→ normalized archive ──→ reader
Ciel House     ──→ adapter ──┘
```

## Run

This is intentionally a no-build static site.

For GitHub Pages, publish the repository root.

For local testing, opening `index.html` directly works in modern browsers because scripts are classic scripts rather than ES modules.

## Supported inputs

| Source | State |
|---|---|
| Ciel House Export v1 | implemented from contract |
| Mufy `_原始数据.json` | implemented from current known schema |
| ChatGPT official export | provisional; needs validation against a real 2026 export |
| Claude official / plugin exporters | pending real samples |
| Already-normalized Our Dialogues archive | implemented |

ZIP import uses browser-native decompression where available. JSON can always be imported directly.

## Privacy

Never commit real conversation exports to this repository.

The `.gitignore` blocks common export names and private fixture folders. Public fixtures must be synthetic.

## Project layout

```text
docs/
  normalized-conversation-v1.md
  ciel-house-export-v1.md
  CIEL_HANDOFF.md
fixtures/
  ciel-house-v1.json
  normalized-v1.json
src/
  core/
  adapters/
  app.js
index.html
styles.css
```

## License

MIT
