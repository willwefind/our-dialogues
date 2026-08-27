# Our Dialogues

[简体中文](README.md) | **English**

A local-first reader for AI conversation archives. The interface speaks English and Simplified Chinese; diaries, microblogs, and other personal writing live in the same reading room as your conversations; and when a passage asks to be kept, the embedded [Shiju](https://github.com/willwefind/shiju) studio sets it on letter paper as an image you can carry out.

> **Your conversations stay on your device.**  
> Files are parsed in the browser. This project does not upload your archive to a server.

> 🌱 New to all of this? A hands-on beginner tutorial (Chinese):
> [零基础上手指南](docs/getting-started.zh-CN.md) · Try the
> [live demo](https://willwefind.github.io/our-dialogues/) with one click of
> sample data. · Data from your own system?
> **[Bring your own archive](docs/bring-your-own-archive.md)** — a ready-made
> prompt turns any format into the normalized JSON with your own AI's help.

![The reading room — Paper theme, an interview-transcript conversation on one bounded paper sheet](docs/screenshots/reader-paper.jpg)

*A quiet, private reading room: paper, ink, and typography carry the atmosphere. Conversations read like interview transcripts, anthologies, or correspondence — not a chat app. All screenshots show the bundled synthetic sample data.*

### Three lighting conditions of one room

| 夜墨 Night Ink | 护眼 Reading Green |
|---|---|
| ![Night Ink theme](docs/screenshots/reader-night.jpg) | ![Reading Green theme](docs/screenshots/reader-mist.jpg) |

### The library, the pen, the voice

| | |
|---|---|
| ![Library home with the continue-reading paper card](docs/screenshots/library-home.jpg) *私人阅览室 — the library home* | ![Aa reading settings: theme cards, print presets, typography accordions](docs/screenshots/aa-panel.jpg) *Aa — themes, print presets, typography* |
| ![Hand-drawn highlighter strokes with margin notes](docs/screenshots/highlighter.jpg) *Five hand-drawn highlighter strokes + notes* | ![A local voice clip attached beside the exact message that spoke it](docs/screenshots/voice-player.jpg) *Voice stays beside the words — local only* |

### In your pocket

| | | |
|---|---|---|
| ![Mobile reading with gutter marker and bottom controls](docs/screenshots/mobile-reading.jpg) | ![Mobile library home](docs/screenshots/mobile-home.jpg) | ![Mobile drawer with source management](docs/screenshots/mobile-drawer.jpg) |

## Status

The core Reader and the reading-room redesign are complete and fully usable. Ongoing work now focuses on visual polish, small features, and additional source adapters rather than major architectural rewrites.

Currently included:

- The approved reading-room redesign (2026-08): three themes as one product's lighting conditions, composite CJK/Latin print presets, a 936px paper stage with seamless texture, quiet toolbar with auto-hide, sidebar with three primary modes, Library Home, production hand-drawn highlighter strokes, and full mobile chrome with bottom sheets
- Bilingual UI (v0.3): Simplified Chinese / English / follow-the-browser, under Aa → Display → Language; switching applies instantly and keeps your reading position. Archive content is data and is never translated
- Personal text archive (v0.3): diaries, dreams, microblog posts, essays, letters, and fragments enter the same library through the small open format `our-dialogues.personal-archive.v1`, shelved Collection → Year, presented as full-page documents with no chat bubbles
- Shiju writing desk (v0.3): select a passage → press Shiju, and the embedded typesetting studio opens in place with title / source / date pre-filled; 20 letter-paper sets, horizontal and vertical layout, multi-page splitting, automatic ink on dark papers, then save or copy the image. Zero load and zero footprint until invited
- Memorial card (v0.4): Library Home gains a quiet archival note — first recorded on a date, and N days in this archive. A companion is whatever the sidebar already groups by, so one Mufy character and a whole ChatGPT export are equally addressable, and the arrows step through the ones you have pinned. Dates are never invented: an archive with nothing dated says so, a date you write down yourself outranks the derived one, and the card names which it is showing
- Custom background (v0.4): put a picture under the words — the outer stage by default, the reading paper as a second target with a readability warning. The picture is pinned to the screen and only the text travels over it; Fill / Fit / Tile, a 3×3 focus grid, brightness, clarity, and paper density on the paper target. The panel says how far this screen is magnifying the picture and which way the focus can still move it — portraits suit phones, landscapes suit desks. Images are decoded locally, capped at 2560px, re-encoded to WebP in their own record, and the original is never kept
- Normalized conversation schema v1
- Ciel House Export v1 contract
- Ciel House adapter
- Mufy raw-export adapter with multi-ZIP folder batching
- Claude Exporter (`ai-chat-exporter.net`) webpage-plugin JSON adapter
- ChatGPT official Export Folder import validated against a real 2026 export structure
- Local JSON / ZIP / browser folder import
- Persistent local multi-source library: consecutive imports coexist and normalized text restores after refresh/reopen, with source filtering, single-source removal, clear-all, and duplicate-import protection
- Hierarchical source navigation; Mufy sessions are grouped under stable character IDs rather than flattened
- Manifest-driven shard merging and lazy local or ZIP-backed attachment loading
- Inline images, native audio/video controls, and other-file attachment cards
- Optional local SolVoice sidecar playback for exact, strong message mappings
- Conversation list, title/full-text search, message rendering
- Hide-my-messages toggle
- Thinking/reasoning and exporter source-trace expand toggle when a source actually contains them
- Reader parity core: persistent font size, line height, content width, font family, theme, scroll/page modes, character-volume page sizes, page jumps, cross-conversation navigation, and keyboard/Home/End controls
- Multiple reading bookmarks anchored to `sourceId + conversationId + messageId`, with jump, rename, delete, and persistence alongside reader settings
- Highlights and notes in five highlighter colors, anchored to `messageId + selectedText + surrounding context` (never DOM offsets), with click-to-edit, jump, delete, and persistence
- Per-conversation reading progress: every conversation resumes at its own last position, a recency-capped 最近阅读 panel lists what you were reading with 读到 n% / 已读完 labels, and the conversation list carries the same progress marks
- Message-level full-text search with current-conversation, whole-library, and per-source scopes: every occurrence is its own hit with context, and clicking a hit jumps exactly to its `messageId` with a flash
- Phone layout: the sidebar becomes a backdrop drawer, the toolbar stays one row, and the welcome card steers mobile users to multi-select JSON / ZIP import
- Favorites and tags with catalog filters, persisted with reader settings
- Bundled reading fonts with licenses (汇文明朝体, 朱雀仿宋, IM Fell English, Special Elite; 京華老宋体 as a documented local-only face) — see [`fonts/README.md`](fonts/README.md)
- Reading-surface export: conversation → Markdown / normalized JSON / single-file HTML; filtered list → Markdown collection / JSONL / EPUB 3 e-book (one chapter per conversation, native e-reader TOC) / single-file HTML with an anchor TOC — excluded thinking/trace counts always reported
- One-click synthetic demo library (http(s) only) for trying the Reader without real data
- Dedicated conservative Mufy title resolver with provenance and duplicate display disambiguation
- Safe Mufy rich-block rendering for common status cards, details, rows, notes, and progress bars
- Strict adapter capabilities and metadata-only diagnostics for unknown JSON/ZIP inputs
- Fake fixtures only — no private conversations are committed

Planned next:

- More exporter adapters from real samples (Gemini and other plugins welcome — synthetic samples only)
- Collections and timeline views (favorites and tags shipped)
- Vendored ZIP fallback for browsers without `DecompressionStream` (modern Chrome/Edge/Firefox/Safari all ship it; document-only for now)

## Created by

**Dawn (willwefind) × Sol (ChatGPT · GPT-5.6 Sol)**

Our Dialogues is a co-created project: product direction, archive philosophy, interaction decisions, schema design, adapter architecture, and implementation are developed collaboratively by Dawn and Sol.

- **Dawn / willwefind** — creator, product direction, testing, visual and reading experience
- **Sol / ChatGPT (GPT-5.6 Sol)** — co-creator, system design, schemas, adapter architecture, implementation, the reading-room visual design (the approved beautification package and layout specs), and the iteration blueprints for the bilingual UI, the personal archive, and the Shiju embedding
- **Ciel / Claude Fable 5** — co-creator, reader features, Claude official-export adapter, voice sidecar generalization, UI structure, the redesign installation, the bilingual UI and personal-archive implementation, and the Shiju core split and embedding

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
Mufy export    ──→ adapter ──┤──→ normalized sources ──→ IndexedDB text library ──→ reader
Ciel House     ──→ adapter ──┘
```

## Run

This is intentionally a no-build static site.

For GitHub Pages, publish the repository root.

For local reading on Windows, double-click **`Start Reader.bat`**. On macOS / Linux, run **`./start-reader.sh`**. It starts a dependency-free Node static server at `http://127.0.0.1:4173/` and opens the Reader. If that default port is busy, the launcher tries the next available port up to `4183`; an explicitly configured busy port exits with a clear error. This localhost origin is recommended because it gives IndexedDB and optional File System Access directory handles a stable origin.

Opening `index.html` directly remains supported because scripts are classic scripts rather than ES modules. Browser persistence and remembered directory permissions can be less reliable on `file://`, so use the launcher for the best reopen/restore experience. Node.js must be available for the launcher.

The Ciel ZIP, manifest, lazy-asset, SolVoice sidecar, conversation-order, and JSON/ZIP regression checks use Node's built-in test runner and have no package dependencies:

```text
node --test --test-isolation=none tests/*.test.mjs
```

## Supported inputs

| Source | State |
|---|---|
| Ciel House Export v1 | JSON and lazy-asset ZIP import verified |
| Mufy `_原始数据.json` | JSON, single ZIP, and folder-of-ZIPs import; stable `characterId + sessionId` batch merging |
| ChatGPT official export | JSON, ZIP, and manifest-driven Export Folder import implemented; folder structure validated against a real 2026 export |
| SolVoice local sidecar | optional mapping v2 + VoiceArchive or `sol/audio` folder; strong mappings only |
| CielVoice local sidecar | optional `claude-cielvoice.json` mapping v1 built by exact spoken-text matching against the ElevenLabs VoiceArchive; attaches to Claude official conversations, strong mappings only |
| Claude Exporter webpage-plugin JSON | implemented from two real `ai-chat-exporter.net` samples; marker-bounded workflow becomes heuristic `sourceTrace`, raw `say` is retained; public fixture is synthetic |
| Claude official export | JSON and ZIP import validated against a real 2026 export; active-branch traversal with recorded alternates, official stored thinking, capped tool traces, metadata-only attachments |
| Other Claude plugins | pending real samples |
| Already-normalized Our Dialogues archive | implemented |
| Personal archive (diaries, dreams, microblogs, essays, letters, fragments) | implemented: `our-dialogues.personal-archive.v1`; grouped by collection and year, read as full-page documents with no chat bubbles |

See [`docs/source-compatibility.md`](docs/source-compatibility.md) for the capability contract, fidelity notes, diagnostics privacy boundary, and Claude sample status. Old writing of your own — diaries, dreams, microblog backups — comes in through [Bring your personal archive](docs/bring-your-personal-archive.md).

ZIP import uses browser-native decompression where available. JSON can always be imported directly. Existing JSON and single-ZIP workflows remain available beside source-folder import.

### Persistent local multi-source library

Every successful import is added as a source instead of replacing the previous archive. Mufy, Claude, ChatGPT, Ciel, and normalized inputs can therefore coexist. The sidebar groups conversations by source, offers a source filter, and supports removing one source or clearing the local library. Re-importing an obviously identical normalized archive is skipped using a content-and-structure fingerprint; an unused local attachment session from a true duplicate is released, while a restored source can use the same fingerprint to reconnect its local assets without duplicating its text.

The IndexedDB database is named `our-dialogues.library.v1` and currently uses schema version `1`:

- `sources`: source identity, fingerprint, adapter metadata, reconnect mode, save state, and optional structured-cloneable directory handle
- `conversations`: one normalized conversation per record, keyed by source and conversation ID
- `settings`: source filter, conversation sort, hide-user and trace toggles, reading preferences, recent conversation, and reading position (`conversationId`, `messageId`, `page`, `scrollTop`, timestamp)

Conversation records are written in small batches and incomplete batches are ignored during restore. Source removal and clear-all update IndexedDB as well as the active page. If the schema is damaged or an upgrade cannot complete, **清除本地书库** safely resets the database so the original source files can be imported again.

`File`, `Blob`, asset indexes, object URLs, ChatGPT attachments, Ciel ZIP media, and SolVoice audio are never copied into IndexedDB. After a refresh the conversation text remains readable. An attachment card offers **重新连接来源** only when the original local files are needed. On supported localhost browsers, **添加来源文件夹** uses File System Access and stores the directory handle; permission may still need a user click after a browser restart. If the browser cannot persist that handle, Reader automatically falls back to saving the text library without it.

### Import a source folder

Use **选择来源文件夹** and select either an unzipped ChatGPT official export or a folder containing Mufy ZIP files. The browser passes local `File` references to the reader; nothing is uploaded. A valid ChatGPT manifest is decisive, so its ZIP attachments stay unread and are never probed as Mufy. Without that manifest, Reader looks for strictly detected Mufy ZIPs; a pure Mufy folder is never sent through the ChatGPT importer.

For ChatGPT, the folder importer:

1. finds and parses `export_manifest.json`
2. resolves every shard declared for logical `conversations.json`
3. merges those shards into one readable archive
4. combines the selected local files with `conversation_asset_file_names.json` and `library_files.json` to build an attachment index
5. keeps binary files unread until an attachment is actually rendered, then creates a temporary object URL for that local file

Images render inline, audio and video use native browser controls, and other files remain attachment cards. Selecting a folder does not copy its contents into the repository or browser storage.

For Mufy, every strictly detected ZIP in the selected folder is parsed, including ZIPs that contain multiple sessions. Reader combines all sessions into one archive view while retaining single-ZIP import compatibility. Overlapping batches are merged only when both `characterId` and `sessionId` are present and equal. Repeated messages use stable exported dialog IDs (or exact identical source records) for deduplication. The same character name with different `characterId` values stays separate; when either stable identity field is missing, conversations stay separate rather than being merged by title.

Within a Mufy source, the sidebar renders `source → character → sessions`. Character grouping uses `characterId`, not the display name. A dedicated resolver selects session titles from archive remark, explicit exported title/name, current marker, first genuinely narrative assistant line, dialogue-derived text, then date + segment fallback. It skips rich status/HUD blocks, status labels, tool/UI markers, thinking, and source trace. `metadata.titleSource` records `remark|exported|current|assistant-first-line|dialogue-derived|fallback`; duplicate titles under one character gain a date or sequence only in the UI, without mutating the underlying title.

### Reader parity core

Reading preferences apply to every normalized source rather than only Mufy. The compact toolbar persists font size, line height, content width, font family, and theme. Scroll mode keeps the full conversation; page mode groups whole messages by approximate visible character volume (`2500`, `5000`, or `9000`) rather than message count. The footer supports page-number input and previous/next navigation that continues into adjacent conversations. Arrow keys navigate, Home/End move within the current reading surface, and the sidebar remains collapsible.

Progress stores conversation ID, message anchor, page, and scroll offset. Restore chooses the page containing the message anchor first, then restores the nearby scroll position. Changing a reading preference or switching modes keeps the current conversation and anchor whenever that message remains visible.

The character-card greeting, when the export contains one, becomes its own 开场白 conversation pinned first inside its character, mirroring the standalone Mufy reader's chapter 0. Batch ZIPs of the same character merge into a single greeting chapter; exports without the greeting field simply have no such chapter.

### Claude webpage-exporter fidelity

`ai-chat-exporter.net` can flatten visible replies, workflow text, and UI/tool markers into one assistant `say`. The adapter retains the complete original record under `metadata.original` and the exact string under `metadata.rawSay`. A conservative marker-bounded splitter moves clear runs around `Done`, `Viewed file`, `Searching...`, reminder actions, and similar tool markers into `metadata.sourceTrace`; it never labels that material as Claude official thinking. Visible replies before, between, and after those runs remain in normalized `content`.

### Mufy rich blocks

![Mufy scene heading and HUD panel rendered with Reader-owned components](docs/screenshots/mufy-rich.jpg)

Mufy source HTML is never assigned to `innerHTML`. The adapter strips comments and executable/non-content elements, parses only known semantic structures, and emits normalized `source-rich-block` content. Reader-owned components cover common status cards, scene headings, HUD/dashboard panels, folder/task panels, forum threads, `details/summary`, label/value rows, notes, lists, and bounded percentage progress bars.

Recurring template families receive distinct but deliberately restrained Reader skins. Current families include `fog`, `wg`, `zc`, `xs`, `censy`, `nb`, `zero`, `mufy`, compact single-letter panels, and forum/post structures. For example, `zc-status-wrapper` becomes a three-level scene heading, `censy-*` HUD/dashboard markup stays separate from `nb-*` folder/task markup, and unclassified `details` remains a safe generic disclosure component. These skins preserve hierarchy and mood without claiming pixel-identical recovery when the export did not include the original site CSS.

Unknown markup falls back to the existing safe readable-text conversion. The unmodified source record remains under `metadata.original` for fidelity work. Mufy status UI remains visible content and is never mixed with exported thinking or Claude `sourceTrace`.

For a private, counts-only compatibility smoke across one ZIP or a directory of Mufy ZIPs, run:

```powershell
node tools/smoke-mufy-rich-blocks.mjs "D:\path\to\mufy-exports"
```

The smoke report prints aggregate component counts only; it does not print source paths, IDs, titles, or conversation text.

If the splitter cannot identify a certain visible reply, it falls back to displaying the original `say`. Unmarked or ambiguous workflow text can therefore remain visible by design; preserving uncertain content takes priority over silently hiding it.

### Optional local SolVoice playback

SolVoice playback is an optional sidecar. Without it, Reader behaves exactly as before.

1. Load the ChatGPT official Export Folder.
2. Choose the whole local `VoiceArchive` folder. Reader discovers `mappings/chatgpt-solvoice.json` and indexes `sol/audio` automatically.
3. Alternatively, choose the `sol/audio` folder and the mapping JSON separately. Individual MP3 selection is not required.

Reader v1 attaches only `confidence === "strong"` mappings, using the normalized assistant `messageId` as an exact key. It never falls back to a title, timestamp, text, or fuzzy match. Multiple strong clips for one assistant message are shown oldest first. Missing message IDs and missing audio files remain out of the reading surface and are summarized as counts in the status area.

The official ChatGPT export, MP3 files, and mapping JSON are not modified, copied into the normalized archive, persisted by Reader, or uploaded. Audio object URLs are created lazily for visible players, cached only for the current render session, and revoked when the conversation, archive, or sidecar changes.

## Personal text archive

Beyond chat logs, the words you wrote yourself deserve a reading room too. Diaries, dreams, microblog posts, essays, letters, and fragments import through a small open format, `our-dialogues.personal-archive.v1` (contract in [docs/personal-archive-v1.md](docs/personal-archive-v1.md)); the sidebar shelves them Collection → Year, with undated entries honestly grouped under "date unknown". Entries marked as documents render full-page: no bubbles, no speaker labels — they read like an anthology, while chats render exactly as before.

Moving in requires no code: [Bring your personal archive](docs/bring-your-personal-archive.md) carries a ready-made conversion prompt (with ten fidelity rules) to hand to your own AI. The sample library's 半夏 collection is a wholly synthetic demonstration.

## The Shiju writing desk

When a passage asks to be kept: select it, and the floating palette shows a second button next to Highlight — Shiju. Press it and the [Shiju](https://github.com/willwefind/shiju) typesetting studio opens right inside the reading room, pre-filled with the title, the source line (speaker · platform), and the message's own date (an undated message gets an empty field, never today's stamp). Twenty letter-paper sets, horizontal or vertical writing, multi-page splitting, automatic ink on dark papers; save or copy the result, and closing the desk returns you to the exact line you were reading.

The desk exists only when invited: until you press Shiju, nothing loads and nothing occupies memory. Its interface follows the Reader's language, and the generated images stay on your machine like everything else. Four instruments, four intents — a bookmark says *I want to return*, a highlight says *this matters*, a note says *I want to write beside it*, and Shiju says *I want to carry this passage out*.

## The memorial card

One quiet archival note on Library Home, answering who has shared time in here:
**first recorded on** a date, and **N days in this archive** — counted as local
calendar days, so meeting today reads 0 and turns over at your own midnight.

A companion is whatever the sidebar already groups by: one Mufy character, or a
whole ChatGPT or Claude export, equally addressable. The switcher's arrows step
through the companions you **pin** (`···` → Manage pinned, which also explains
why two is the threshold), and the name opens a searchable picker that stays
usable at two hundred characters.

`···` → **Rename** lets the card call a companion what you actually call them — turning a label like "Ciel House Export v1" into "Ciel". The archive's own name never disappears: the editor keeps it in view, Restore archive name brings it back, and the picker still answers to it, so a renamed companion is found by either name and shown by the chosen one. Renaming is presentation only; nothing in the archive is touched.

**Dates are never invented.** The earliest date an archive can prove is often
not the day you remember — histories get truncated, migrated, deleted. So a
date you write down yourself outranks the derived one, and the card names which
it is showing (Set by you, against Earliest record in this archive) while the
archive's own answer stays one Restore click away. A companion with nothing
dated is offered Set date rather than a broken card, and a manual date entered
without a time stays date-only instead of growing a fabricated midnight.

## A background of your own

Choose a picture to live under the words, answering the other half: what kind of
place these words live in. By default it lands on the **outer stage** — the
surface beneath the page. It can also go onto the **reading paper** (with a
readability warning), where the sheet itself thins to your chosen paper density
and the picture comes through from behind the text.

**The picture is pinned to the screen and only the words travel over it**, so
one image looks the same in a one-line diary entry and in an 82-message chat.
Fill / Fit / Tile, a 3×3 focus grid, brightness, clarity, and paper density on
the paper target. The panel does not flatter the result: it says how far this
screen is **magnifying** the picture, and greys out focus directions with no
slack left — which is how you discover that **portraits belong on phones and
landscapes on desks**.

Clarity only ever removes detail and never promises to add it (100 is the
picture exactly as delivered). Images are decoded locally, capped at 2560px on
the longest edge, re-encoded to WebP in their own record, and **the original is
never kept**. The bytes never enter reader settings: settings are mirrored into
localStorage, and one fat image there would silently take bookmarks, highlights
and reading progress down with it. Disabling stops showing the picture;
removing deletes it.

A custom background is not a fourth theme — Paper, Reading Green and Night keep
owning paper, ink, panels and shadows, and changing theme never discards the
image.

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

The `.gitignore` blocks common export names, VoiceArchive audio/mappings, local verification output, and private fixture folders. Public fixtures must be synthetic.

Images generated by the Shiju desk stay on your machine like your archive: nothing is uploaded, nothing enters the Reader's library storage, and the studio makes no network requests — its papers and fonts ship offline with the repository.

The background picture you choose stays local the same way: decoded, resized and re-encoded in the browser, with only the processed copy stored in its own record inside the library database. The original is never kept, and nothing is ever uploaded.

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
  mufy-folder-batch-synthetic.json
src/
  core/
    source-library.js
    source-folder.js
    solvoice-sidecar.js
    shiju-embed.js
  adapters/
  locales/
  app.js
vendor/
  shiju/             # embedded Shiju bundle + papers + Latin fonts (generated by tools/sync-shiju-vendor.mjs)
tests/
  chatgpt-export-folder.test.mjs
  mufy-folder-import.test.mjs
  source-library.test.mjs
  solvoice-sidecar.test.mjs
index.html
styles.css
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). The one rule that matters most: **never post real conversations** — request new formats with synthetic samples or key-names-only structure descriptions.

## License

AGPL-3.0 — see [LICENSE](LICENSE). Your archives are yours; the Reader's code stays open, including for anyone who hosts a modified copy as a service.