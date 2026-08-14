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
- ChatGPT official Export Folder import validated against a real 2026 export structure
- Local JSON / ZIP / browser folder import
- Manifest-driven shard merging and lazy local or ZIP-backed attachment loading
- Inline images, native audio/video controls, and other-file attachment cards
- Conversation list, title/full-text search, message rendering
- Hide-my-messages toggle
- Thinking/reasoning expand toggle when an export actually contains it
- Fake fixtures only — no private conversations are committed

Planned next:

- Add Claude exporter adapters from real samples
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

The Ciel ZIP, manifest, lazy-asset, conversation-order, and JSON/ZIP regression checks use Node's built-in test runner and have no package dependencies:

```text
node --test --test-isolation=none tests/conversation-order.test.mjs tests/ciel-house-zip.test.mjs tests/chatgpt-export-folder.test.mjs
```

## Supported inputs

| Source | State |
|---|---|
| Ciel House Export v1 | JSON and lazy-asset ZIP import verified |
| Mufy `_原始数据.json` | implemented from current known schema |
| ChatGPT official export | JSON, ZIP, and manifest-driven Export Folder import implemented; folder structure validated against a real 2026 export |
| Claude official / plugin exporters | pending real samples |
| Already-normalized Our Dialogues archive | implemented |

ZIP import uses browser-native decompression where available. JSON can always be imported directly. Existing JSON and ZIP workflows remain available beside folder import.

### Import a ChatGPT Export Folder

Use **选择 ChatGPT Export 文件夹** and select the unzipped official export directory. The browser passes local `File` references to the reader; nothing is uploaded.

The folder importer:

1. finds and parses `export_manifest.json`
2. resolves every shard declared for logical `conversations.json`
3. merges those shards into one readable archive
4. combines the selected local files with `conversation_asset_file_names.json` and `library_files.json` to build an attachment index
5. keeps binary files unread until an attachment is actually rendered, then creates a temporary object URL for that local file

Images render inline, audio and video use native browser controls, and other files remain attachment cards. Selecting a folder does not copy its contents into the repository or browser storage.

## ChatGPT 2026 export notes

A real 2026 official export structure confirmed that logical `conversations.json` may be split into manifest-listed shards (12 in the export used for validation). Each conversation is a parent-linked node graph (`mapping`) with an active `current_node`, not a flat message array. The importer and adapter now:

- read the shard list from `export_manifest.json` and merge every listed shard
- follow the active branch while recording alternate-branch counts
- read `text` and `multimodal_text`
- preserve file/image/audio/video attachment metadata
- group exported `thoughts` and `reasoning_recap` with the related assistant turn
- preserve model and source metadata
- strip opaque private-use citation control tokens from the reading surface while retaining backing metadata
- restore original attachment names from `conversation_asset_file_names.json`
- enrich assets with `library_files.json` metadata, including MIME and origination links
- index selected local files without eagerly loading binary bytes into memory

Real private export files are never committed. The public folder fixture is wholly synthetic; its tiny image and text payloads are valid, while its audio/video payloads are documented inert placeholders for media-routing tests.

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
  chatgpt-official-2026.json
  chatgpt-official-folder-2026-synthetic/
    export_manifest.json
    conversation_asset_file_names.json
    library_files.json
    conversations-000.json
    conversations-001.json
    file_synthetic_*.dat
src/
  core/
  adapters/
  app.js
tests/
  chatgpt-export-folder.test.mjs
index.html
styles.css
```

## License

MIT
