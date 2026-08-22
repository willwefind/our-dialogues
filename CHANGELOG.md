# Changelog

## Unreleased

- Docs for everyone else's archives, and for absolute beginners: `docs/bring-your-own-archive.zh-CN.md` (+ English counterpart) turns the normalized v1 schema into a ready-made prompt — hand it to your own AI with your data from any system and import the resulting JSON in one click, with a second prompt for generating strong voice mappings (platform/messageId alignment explained); `docs/getting-started.zh-CN.md` is a hands-on zero-knowledge tutorial in the mufy-batch-export README's style — export walkthroughs per platform, online vs local paths, the three-separate-libraries origin trap as a big red box, phone guidance, and an honest FAQ. The Chinese README becomes the repository's default `README.md` (English moves to `README.en.md` via git mv, links swapped), and both READMEs plus the sources table now point at the new guides.
- Add a full Simplified Chinese README (`README.zh-CN.md`) — a native-voice counterpart of every section, from the screenshot galleries to the technical notes — with language links between both versions. Credit Sol's product name in the bylines: README and AUTHORS now read **Sol (ChatGPT · GPT-5.6 Sol)**, with the reading-room visual design (beautification package and layout specs) added to Sol's contributions and the installation credited to Ciel.
- README screenshots: eleven captures of the finished reading room (Paper hero, Night Ink / Reading Green pair, Library Home, Aa panel, highlighter strokes, local voice player, Mufy rich blocks, and three mobile views) land under `docs/screenshots/` — resized to ≤1600px and JPEG-compressed from ~12 MB of PNGs to ~1.9 MB total. Every shot uses wholly synthetic sample dialogues written for the purpose; no real conversation content appears. The README opens with the reading-room hero and gains themed galleries plus a redesign summary line in Status.
- Reader redesign phase I — polish and accessibility: `prefers-reduced-motion` collapses drawer/toolbar/sheet transitions to simple ≤80 ms visibility changes, stops decorative motion, and switches the top/bottom jumps to instant scrolling; closing any toolbar-owned popover or the drawer via Esc (or 完成) returns keyboard focus to its triggering control; the full §19.6 anchor matrix was machine-verified in the browser — parking mid-conversation and then changing theme, print preset, font size, and content width keeps the same anchored message every step, and switching scroll→page opens the page containing that anchor.
- Reader redesign phase H — production highlighter: highlights leave the flat rgba blocks for the approved hand-drawn strokes. Normal and long selections compose 96×90 left cap + 192×90 repeat-x middle + 96×90 right cap at `auto 1.48em` with `box-decoration-break: clone`, so every wrapped line fragment gets independent natural caps; 3–5 character marks are the single approved case that compresses one full 800×90 mother stroke to the selection width (a post-render DOM pass tags them, leaving annotations.js anchoring untouched); a saved note announces itself with a thin accent underline over the stroke. Stored color values stay untouched — the display maps salmon→pink, sage→green, lilac→purple — and the sidebar dots/editor swatches keep their existing color chips. A new regression test locks the five-color asset mapping, the clone/repeat contract, and the no-stretch prohibitions.
- Reader redesign phase G — Aa panel final form (D4): the Aa popover becomes the approved 376 px reading-settings panel (right 24 / top 68 / 20 px padding / 16 px radius on PC; the existing phone bottom-sheet treatment applies automatically) ordered 主题 → 印刷风格 → 排版 / 更多字体 / 显示 accordions → a low-priority 恢复默认. Themes are three equal preview cards (纸页 / 护眼 / 夜墨, each painted in its own approved palette with the 纸上重逢 sample; selection shows a 2 px accent ring plus ✓, never color alone); print presets are quiet 2×2 cards that recede behind their real type samples (一页旧文 / 第七卷 / RECORD 18 / 亲爱的你 rendered in their composite families; tapping the active card exits the preset). All pre-redesign controls keep their IDs inside the accordions; the theme and preset selects stay in the DOM as the hidden wiring layer; settings apply immediately and 完成 only closes; 恢复默认 resets preferences and display toggles while re-seating the reading anchor.
- Reader redesign phase F — mobile reading chrome (D3): the page-navigation bar becomes a fixed bottom control strip on phones (上一段 26% | progress 48% | 下一段 26%, 48 px + safe-area; page mode shows 第 x / y 页, scroll mode a live percent), both bars hide together after ≥24 px of downward scroll while ≥16 px upward restores only the top bar — the bottom strip returns on a deliberate blank-area tap (which toggles both) or near the top, and taps on links, media, marks, editors, or an active selection are never treated as blank taps. Aa, tags, export, more, and the annotation editor become bottom sheets on phones (76dvh cap — 641 px at 390×844, 617 px at 375×812 — 16 px top radius, safe-area padding, declared after the base panel styles so the sheet placement wins the cascade); the drawer closes on a mostly-horizontal ≥80 px swipe as well as ✕/backdrop/Esc; text stays at 18 px with a 22 px inset and the gutter marker at x≈9; verified no horizontal scroll and 44 px touch targets at both 390×844 and 375×812.
- Reader redesign phase E — PC reading paper and toolbar: conversations now read on one bounded paper sheet (target 936 px = body width + 68 px insets, seamless 512 px texture tile per the canonical continuous-paper rule, ink-grain overlay, 2 px radius, paper shadow) centered on the outer stage; chat bubbles are gone — user turns carry a 2 px gutter marker in the approved user-marker color, assistant turns have no container, speaker labels are 11 px UI-font small-caps, turns sit 40 px apart, and timestamps reveal on hover/focus without layout shift. The toolbar keeps only ☰ + title on the left and 书签 / Aa / ··· on the right; favorites, tags, export, 回到顶部/到最底部, and the local-voice status line move into the new ··· menu without losing their IDs or behavior (the floating jump buttons retire in its favor). The toolbar auto-hides after ≥32 px of downward scroll and returns on ≥12 px upward / near-top / toolbar focus / any open popover, and stays frozen while text is selected, a note is edited, or audio plays; Esc closes the topmost transient layer first and never silently discards an unsaved note. Thinking blocks read as 编者附记; reader meta becomes quiet · separated text; attachments and voice players cap at 680 px. Below 1360 px the sidebar overlays the stage as a drawer (the 936 px paper plus stage margins no longer fit beside it) — the phone tier keeps its compact chrome and gains the 22 px text inset with the gutter marker.
- Reader redesign phase D — Library Home: clicking 书库 on a loaded library opens a quiet home surface — 私人阅览室 heading, one continuation paper card (large texture + ink grain, whole card clickable, low-weight 继续阅读 → text action, 2 px progress line, soft 4 px lift instead of a hard shadow), 最近加入 as a pure-typography list of the three newest conversations, and a 书库摘要 with source/conversation/bookmark/annotation counts over the 全部文字保存在本机 note. The empty-state welcome keeps its own behavior; boot still restores the last reading position directly into the Reader; showing the home never drops the open conversation. No fake book covers, no dashboard chrome.
- Reader redesign phase C — sidebar information architecture: the sidebar becomes a 312 px quiet reading-room panel with a logo zone and three primary modes shown one at a time — 书库 (catalog filter box + 来源 row + source tree), 阅读痕迹 (最近/书签/划线 as an inner segmented control), and 搜索 (full-text search promoted to a primary pane, reusing the existing search state). Source management moves behind the 来源 row's ＋ menu (folder / JSON-ZIP import, optional voice archive, 管理已连接来源 with per-source reconnect/remove and the destructive clear actions at the bottom of that sublevel); each source row gets a quiet ··· menu with details/reconnect/remove replacing the always-visible red ×; favorites/tags/sort/source-filter move into a 筛选 secondary menu with their values and persistence untouched. Optional display-only year headings appear inside a character/source once it holds ≥12 conversations spanning ≥2 years with ≥70% valid dates — never changing sort, IDs, or reading order, with undated items under 日期不详 at the bottom. The persisted `toolTab` value keeps its historical five-value domain so pre-redesign records restore into the right mode. Sidebar tests updated to the new mode semantics plus new coverage for legacy-value restore and year-heading thresholds.
- Reader redesign phase B — editorial typography: three composite CJK/Latin families built from the bundled faces via unicode-ranged `@font-face` pairs (Latin `U+0000-024F`, CJK Han + full-width punctuation + Chinese quotes), so mixed paragraphs pair 汇文明朝×IM Fell / 朱雀仿宋×Special Elite / 朱雀仿宋×IM Fell without `<span lang>` wrapping; four print presets (文集 default-suggested / 旧刊 / 打字稿 opt-in only / 书信) as a new nullable `printPreset` presentation alias in reader-parity — old records without it normalize untouched, choosing a preset never rewrites the stored `fontFamily`, a manual 字体 choice clears the preset, and clearing falls straight back to the stored family; style-only preference changes (size, leading, width, family, preset) now re-seat the view on the anchored message instead of letting text drift under a fixed scrollTop; a temporary 印刷风格 row in the Aa popover proves the system until the phase-G card UI. Two new regression tests lock preset normalization, backward compatibility, menu lockstep, and composite fallbacks.
- Reader redesign phase A — install the approved design assets and semantic theme tokens: `assets/reader/` gains the production textures (three paper tiles + large sheets, ink-grain overlay, margin-note paper), all twenty highlighter strokes (five 800×90 mother strokes plus 96/192/96 production parts), four ornaments, and fifteen `currentColor` icons; `styles.css` gains the approved three-theme semantic palette (`--od-*` for Paper / Reading Green / Night Ink — persisted keys stay `paper`/`mist`/`night`, Reading Green is only the visible name for existing `mist` data), spacing/radius/shadow/motion tokens on the 8 px baseline, compatibility aliases so every pre-redesign selector keeps rendering, a global keyboard focus ring, and a conservative first texture installation on the welcome card (large sheet + ink grain at approved opacities). No application logic changed.
- Add bundled reading fonts, shiju-style (one folder per font with its license committed): 汇文明朝体 and 朱雀仿宋 plus OFL/Apache English faces (IM Fell English, Special Elite) with 打字机·明朝 and 古籍英文·明朝 pairing stacks; 京華老宋体 is declared but ships local-only (32 MB — folder, license note, and README instructions committed, binary gitignored). Faces load only when selected, every stack ends in system fallbacks so a missing file degrades gracefully, and the Aa font menu grows to grouped 内置/系统 choices including 仿宋 and 等线. A regression test keeps the font menu and FONT_FAMILIES in lockstep and every stack ending in a generic fallback.
- Add single-file HTML export for the current conversation and the filtered list: one self-contained readable page (inline styles, anchor TOC when there is more than one conversation, escaped text, same reading-surface boundary with excluded counts noted) that opens anywhere offline.
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
