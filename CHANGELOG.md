# Changelog

## Unreleased

- Add IndexedDB-backed persistent normalized text sources, preferences, recent conversation, and reading-position restore.
- Keep binary attachments and SolVoice audio out of persistence, with source-specific reconnect prompts and optional persistent directory handles.
- Add safe Mufy `source-rich-block` parsing and Reader-owned status-card, details, row, note, and progress rendering.
- Expand Mufy rich rendering with scene-heading, HUD/dashboard, folder/task, forum/list, and recurring `zc`/`xs`/`censy`/`nb`/compact template families.
- Add a counts-only sequential Mufy rich-block smoke tool for real private ZIP collections.
- Add the dependency-free Windows `Start Reader.bat` localhost launcher and recommend stable-origin local use.
- Add a dedicated Mufy title resolver, six-value `titleSource` provenance, status/trace filtering, Unicode-safe truncation, and duplicate display disambiguation.
- Add normalized Reader font/spacing/width/font-family preferences, scroll and character-volume page modes, page jumps, cross-conversation navigation, keyboard controls, and anchor-first progress restore.
- Add counts-only persistent-store auditing for schema, record totals, binary exclusion, directory handles, title-source distribution, and hashed reading-position acceptance checks.
- Fix the launcher's auto-open: pass the `start` command to cmd.exe verbatim so the browser actually opens, and keep the console window open on launcher errors.
- Keep the launcher port fixed for a stable IndexedDB origin: a busy port now reuses the already-running Reader and opens the browser instead of hopping to a different-origin port.
- Promote the Mufy character-card greeting to its own pinned 开场白 conversation per character, merged across batch ZIPs by a synthetic greeting session ID, instead of prepending it to an arbitrary first session.
- Remember sidebar source-group and character-group collapse state across re-renders and restarts instead of re-expanding everything on each conversation switch; an active search still force-opens groups so hits stay visible.
- Add multiple reading bookmarks anchored to `sourceId + conversationId + messageId` (never a list index): save the visible position from the toolbar, jump back with an anchor flash, rename inline, delete, and keep them across restarts; a bookmark whose source is missing stays listed and explains itself instead of failing silently.

## v0.1.8-dev — 2026-08-16

- Added an in-memory multi-source library so Mufy, Claude, ChatGPT, Ciel, and normalized imports coexist instead of replacing one another
- Added source filtering, per-source removal, clear-all, lazy asset-session disposal, and obvious duplicate-import protection
- Changed sidebar navigation to source groups, with Mufy grouped again by stable character ID before sessions
- Prioritized Mufy session titles by archive remark, current marker, first readable assistant text, then fallback
- Added a conservative `ai-chat-exporter.net` splitter for marker-bounded workflow and tool trace while preserving exact raw `say`
- Kept heuristic Claude `sourceTrace` distinct from official/exported thinking and added a raw-text fallback when visibility is uncertain
- Added multi-source, removal, duplicate, hierarchy, and Claude splitter regression coverage
- Expanded private-data-safe smoke tools for multi-ZIP Mufy folders and Claude source-trace counts

## v0.1.7-dev — 2026-08-16

- Converted Mufy HTML into readable normalized text while preserving raw source metadata and explicit thinking
- Added strict adapter capability declarations and mutually exclusive JSON/ZIP detection
- Added metadata-only unknown-format diagnostics without field values or conversation text
- Added strict support for `ai-chat-exporter.net` Claude webpage-plugin JSON from two real local samples
- Kept Claude official export and other plugins separate and pending their own samples
- Added synthetic source-fidelity tests and a counts-only real Mufy smoke tool
- Added strict source-folder routing for ChatGPT official folders and Mufy ZIP collections
- Added multi-ZIP Mufy batch import with conservative `characterId + sessionId` merging and stable-ID deduplication

## v0.1.6-dev — 2026-08-15

- Added optional local SolVoice mapping v2 and VoiceArchive folder selection
- Attached only exact `strong` mappings to normalized ChatGPT assistant message IDs
- Added multiple-clip ordering, lazy native audio players, and session-scoped object URL cleanup
- Added non-invasive missing-message/audio statistics and a private-data-safe real verification tool
- Kept the ChatGPT export, audio, mapping, and normalized archive immutable and browser-local

## v0.1.5-dev — 2026-08-14

- Added persistent oldest-first / newest-first conversation sorting, including sorted search results and stable undated fallbacks

## v0.1.4-dev — 2026-08-14

- Added lazy playback and downloads for path-backed assets inside Ciel House Export ZIPs
- Generalized Reader attachment availability beyond browser `File` objects
- Cached and revoked ZIP-backed object URLs without eagerly decompressing media

## v0.1.3-dev — 2026-08-14

- Hardened ignore rules against accidental commits of private ChatGPT export metadata and `.dat` assets
- Matched the 2026 nested library-file ID shape while preserving legacy ID forms
- Removed a manifest array-path `ReferenceError` and added regression coverage for logical conversation shards

## v0.1.2-dev — 2026-08-14

- Implemented local-first ChatGPT official Export Folder selection
- Validated the manifest, shard, filename-map, and library metadata flow against a real 2026 export structure
- Resolved logical `conversations.json` from manifest-listed shards and merged them into one archive
- Built a lazy asset index from selected local files, `conversation_asset_file_names.json`, and `library_files.json`
- Deferred binary reads and object-URL creation until attachments are rendered
- Added inline images, native audio/video controls, and other-file attachment cards
- Kept existing JSON and ZIP imports working
- Added a wholly synthetic two-shard folder fixture with image, audio, video, and generic-file asset cases
- Preserved the Dawn × Sol co-creator credits

## v0.1.1-dev — 2026-08-14

- Validated ChatGPT official-export schema against a real 2026 JSON shard
- Added `thoughts` and `reasoning_recap` parsing
- Added multimodal image/file/audio attachment metadata parsing
- Added active-branch traversal and alternate-branch diagnostics
- Added private-use citation markup cleanup for reading
- Added attachment UI and reasoning-only visibility behavior
- Added synthetic ChatGPT 2026 fixture

## v0.1.0-dev — 2026-08-14

- Initial no-build reader shell
- Normalized Conversation Schema v1
- Ciel House Export v1 contract
- Ciel House adapter
- Mufy raw export adapter
- Provisional ChatGPT official export adapter
- Browser-local JSON / ZIP parsing
- Search, themes, hide-user, thinking toggle
- Synthetic fixtures
