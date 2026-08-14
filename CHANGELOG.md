# Changelog

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
