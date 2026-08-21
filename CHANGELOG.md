# Changelog

## Unreleased

- Add EPUB export: 当前列表 → a real EPUB 3 book (one chapter per conversation, native TOC via nav.xhtml, XML-escaped titles/text, the same reading-surface boundary with excluded thinking/trace counts noted per chapter), built by a new dependency-free STORE-only zip writer whose output round-trips through this project's own zip reader in tests and extracts cleanly with the system unzipper.
- Sync the AGPL-3.0 relicense from main into the working branch and align the README's license section; refresh the stale Planned-next list.
- Add library organization: per-conversation favorites (⭐ toolbar toggle, star in the catalog, 只看收藏 filter) and tags (🏷 editor popover with chips and suggestions from existing tags, tag chips in the catalog, a tag filter with usage counts); both persist with reader settings, compose with search/source filters, and a vanished tag resets its filter instead of stranding an empty catalog.
- Add reading-surface export: current conversation → Markdown or normalized JSON, current filtered list → Markdown collection or JSONL; Markdown reports excluded thinking/tool-trace counts instead of dropping them silently, list exports follow the live filters, and downloads are generated locally.
- Add a one-click synthetic demo library on http(s) so a stranger can try the Reader without real data; duplicate-import protection keeps a second click from doubling the sources.
- Add `start-reader.sh` for macOS/Linux (fixed port for a stable IndexedDB origin, best-effort browser open) with a `.gitattributes` rule keeping shell scripts LF.
- Add CONTRIBUTING.md: never post real conversations (synthetic samples or key-names-only structure reports), strict-detection and honest-rendering rules, and an adapter how-to.
- Never strand the narrow-screen drawer: narrowing the window mid-session auto-closes the sidebar (☰ would be buried under it) and re-syncs the backdrop, watching both matchMedia change and window resize since some environments deliver only one; the drawer also gains an explicit ✕ close button on narrow screens.
- Make the Reader phone-usable: on narrow screens the sidebar becomes a drawer over the text (starts closed, ☰ opens it, a backdrop tap or opening a conversation closes it), the toolbar stays one thumb-height row (显示开关 moved into the Aa popover for all screen sizes), the Aa popover fits and scrolls within the viewport, touch targets grow, and the welcome card warns that mobile folder pickers degrade — use 选择 JSON / ZIP multi-select instead, a lesson inherited from the standalone Mufy reader.
- Make voice audio folder selection additive: choosing another folder (e.g. Ciel House audio after the VoiceArchive) merges into the session's audio pool with path+size deduplication instead of replacing it.
- Make voice player fallback labels platform-neutral（ChatGPT 语音 / Claude 语音）so another person's archive never displays personal names; personal display names come only from a private mapping's `voiceLabel`, and the CielVoice mapping builder omits the field unless one is passed.
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
- Generalize the local voice sidecar beyond SolVoice: mapping formats now bind to one source platform each (`chatgpt-solvoice` v2 → ChatGPT, new `cielvoice-claude-mapping` v1 → Claude official), folder discovery finds every known mapping file, per-platform sessions combine into one Reader session, and a private local tool builds the CielVoice mapping by exact whitespace-normalized spoken-text matching between `CielVoice:speak` tool calls and the ElevenLabs VoiceArchive manifest — only unambiguous matches become strong, and the console reports counts only.
- Add a Claude official data-export adapter validated against a real 2026 export (462 conversations): strict array-of-conversations detection for JSON and ZIP, active-branch traversal via parent_message_uuid with branch points and alternate counts recorded, official `thinking` parts mapped to normalized thinking (distinct from the webpage-exporter's heuristic trace, with an adapter-aware trace label), tool_use/tool_result as capped sourceTrace entries whose truncation is always reported, attachment metadata without copying `extracted_content` bodies, fully empty turn pairs dropped with the count recorded, and a counts-only real-data smoke tool.
- Restructure the sidebar and toolbar for clarity without changing any behavior: the four stacked tool panels (最近阅读/书签/划线与小注/全文搜索) become one row of tabs that open a single shared pane at a time (the open tab persists), and the reader preferences (font size, line height, width, family, paging, theme) move from the toolbar into an Aa popover that closes on an outside click, leaving the toolbar with five controls on one line.
- Add Search 2.0: a sidebar 全文搜索 panel with 当前对话 and 全部书库 scopes; every occurrence in a long message is its own hit with surrounding context and the original casing highlighted, results are capped at 200 with the cap reported instead of silent truncation, clicking a hit jumps exactly to its messageId with an anchor flash, the chosen scope persists, and library scope honors the source filter while deliberately ignoring the catalog filter box.
- Make previous/next conversation navigation follow the sidebar's visible order (source → character → pinned greeting → sessions) instead of the flat date-sorted list, so 下一段 in scroll mode lands on the neighbour the eye sees rather than an unrelated date-adjacent conversation.
- Add per-conversation reading progress: every conversation keeps its own anchor-first position (message, page, scroll, percent) and a plain reopen resumes it — explicit targets like boot restore, page turns, and bookmark/annotation jumps still win; a 最近阅读 sidebar panel lists the last ten with 读到 n% / 已读完 labels and reopens in place, the conversation list carries the same labels for a first 已读/未读 signal, and the map is recency-capped at 1000 entries and persists with reader settings.
- Make the sidebar import section (添加来源 + SolVoice) collapsible: it stays open while the library is empty, folds away once sources exist, and a manual toggle wins and persists; the status line and local-library row stay visible for feedback.
- Give every long area a visible scrollbar: thin styled scrollbars replace Windows overlay ones, the bookmark and annotation panel lists scroll inside a viewport-capped height, panels no longer get squeezed by the sidebar flex layout, the conversation list keeps a guaranteed minimum, and the sidebar itself scrolls when its content is taller than the window.
- Add highlights and notes with a five-color highlighter palette (黄/绿/粉/蓝/紫, theme-tuned): select text in one message, pick a color, optionally write a note; anchors are `messageId + selectedText + context` so repeats disambiguate and re-renders cannot move them; marks position against raw text before escaping; click a mark to recolor, edit, or delete; the sidebar lists them with jump; the last-used pen color and all annotations persist with reader settings.

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
