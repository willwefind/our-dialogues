# Bring your personal archive — diaries, dreams, microblogs, letters

**English** | [简体中文](bring-your-personal-archive.zh-CN.md)

You may have a pile of words like this: a paper diary from school, typed up
page by page into a txt file; years of dream logs; a microblog backup; essays
sleeping in a drafts folder; letters never sent; fragments that fit no
category. They are not "conversations" — you wrote them alone. They deserve a
reading room you can walk back into all the same.

The Reader has a dedicated source format for exactly this: the **Personal
Archive** (`our-dialogues.personal-archive.v1`, full contract in
[personal-archive-v1.md](personal-archive-v1.md)). Once imported, your old
writing sits in the library like books — page through it, search it,
highlight it, bookmark it, shelved by collection and ordered by date,
presented as full pages with no chat bubbles.

**How this differs from the sister guide, in one sentence:**
[Bring your own archive](bring-your-own-archive.md) migrates *conversations
between you and an AI (or anyone)* — back and forth; this guide migrates
*writing by you alone* — no dialogue, one author.

The method is the same as the sister guide's: **hand the ready-made prompt
below, together with your old writing, to an AI you trust**; they produce a
conforming JSON; you import it in two clicks.

> 💡 Conversion happens inside an AI you choose; import happens inside your
> own browser. Our Dialogues uploads nothing at any step — and never asks
> you to.

---

## Contents

1. [Who this guide is for](#who-this-guide-is-for)
2. [Step 1 — give the prompt and your writing to an AI you trust](#step-1--give-the-prompt-and-your-writing-to-an-ai-you-trust)
3. [What the output looks like (a small example)](#what-the-output-looks-like-a-small-example)
4. [Small sample first, full batch later](#small-sample-first-full-batch-later)
5. [Step 2 — import into the reading room](#step-2--import-into-the-reading-room)
6. [Privacy notes](#privacy-notes)
7. [FAQ](#faq)

---

## Who this guide is for

| What you have | Where to go |
|---|---|
| Old diaries (typed-up pages, txt, Word, notes-app exports…) | ✅ this guide |
| Dream logs | ✅ this guide |
| Microblog / short-post backups | ✅ this guide |
| Essays, letters, loose fragments | ✅ this guide |
| Chat logs between you and an AI (custom systems, other platforms) | 👉 [Bring your own archive](bring-your-own-archive.md) |
| ChatGPT / Claude official exports, Mufy ZIPs | 👉 import directly, no conversion needed |

**The source format does not matter** — txt, Word, notes-app exports, saved
HTML, text typed up from paper notebooks… recognizing formats is what AI does
best. You only need to supply the context (what this writing is, and where
the date clues live).

---

## Step 1 — give the prompt and your writing to an AI you trust

Copy the whole block below to your AI, **then give them your writing** (paste
it, or attach the files). Three pieces of context make the result much
better:

- what this body of writing is (a diary? a microblog backup? a stack of letters?);
- the author name you want displayed in the Reader;
- where the date clues hide (a year on the notebook cover, dates in
  filenames, timestamps in the backup…).

````text
Please organize my personal writing archive (old diaries, dream logs,
microblog-style posts, essays, letters, fragments, etc.) into the
Our Dialogues "Personal Archive" format (our-dialogues.personal-archive.v1).
This is archival source text. Your job is to carry and arrange it — not to
process it.

OUTPUT
Produce one UTF-8 encoded .json file with exactly this structure:

{
  "schema": "our-dialogues.personal-archive.v1",
  "archive": {
    "id": "<stable ID for this archive, lowercase with hyphens, e.g. wren-archive; reuse it on every re-conversion>",
    "name": "<display name, e.g. Wren's Paper Box>",
    "author": {
      "id": "<stable author ID, e.g. wren>",
      "name": "<author display name, e.g. Wren>"
    }
  },
  "exportedAt": "<conversion time, ISO 8601; null if unknown>",
  "collections": [
    {
      "id": "<stable collection ID, e.g. old-diary>",
      "name": "<display name, e.g. Days on Paper>",
      "type": "<one of eight: diary / dream / essay / microblog / note / letter / fragment / other>",
      "entries": [
        {
          "id": "<stable entry ID — see rule 7 below>",
          "title": "<only a title the source genuinely has; otherwise null>",
          "createdAt": "<ISO 8601; if only the day is known write 2016-03-17; null if truly unknown>",
          "updatedAt": "<only if the source records a modification time; otherwise null>",
          "text": "<the text, verbatim; keep newlines as \n in the string>",
          "tags": [],
          "metadata": {}
        }
      ]
    }
  ]
}

One collection = one body of writing that already exists as a whole (one
diary, one microblog backup, one stack of letters).
One entry = one piece / one post / one letter in the source.
If there is too much to do in one pass, work in batches — but merge
everything into a single complete JSON file at the end (the Reader treats
one archive as one source).

THE TEN RULES
1. The text stays verbatim: no polishing, no fixing typos, no adding or
   removing punctuation, no tidying formatting. Obvious slips, repetitions,
   and rough sentences stay exactly as written — they are part of the archive.
2. Never rewrite: no shortening, no summarizing, no reorganizing paragraphs;
   never merge several pieces into one or split one into several.
3. Never translate: whatever language — or mix of languages — the original
   is in, it stays in.
4. Never invent dates: if the exact moment is known, write full ISO 8601
   (e.g. 2013-08-05T23:47:00+08:00); if only the day is known, write that
   day (e.g. 2016-03-17) and use the same style throughout the file; if
   truly unknown, write null. Never guess, never fabricate.
5. Never invent titles: fill in title only when the source genuinely has
   one; otherwise null. Never coin a literary title — the Reader derives a
   display title from the date or first line by itself.
6. Preserve the original collection boundaries: a diary is a diary, a
   microblog is a microblog, letters are letters. However many notebooks or
   sources there were, that is how many collections there are; do not merge
   them, and do not regroup by theme. If the type is unclear, use other.
7. IDs must be stable: re-converting the same material must yield exactly
   the same IDs. Prefer the original source ID (e.g. a microblog's own
   numeric ID → weibo-3498273412); otherwise date plus sequence
   (diary-2016-03-17; a second entry that day → diary-2016-03-17-02); with
   no date at all, a stable running number (fragment-0001). Never use
   random UUIDs, and never derive an ID from a title.
8. When parsing is uncertain, say so honestly: where one piece ends, which
   piece a date belongs to, whether a line counts as a title — wherever you
   are unsure, preserve more and process less, and list every such spot in
   your final report so I can decide.
9. The output must be valid UTF-8 JSON: parseable by JSON.parse, no
   comments, no trailing commas, the schema string exact to the character.
10. This archive does not need to be uploaded anywhere: the conversion
    happens in this conversation, and I import the file locally in my own
    browser — Our Dialogues never handles the data. Do not suggest
    uploading the originals or the result to any service.

SELF-CHECK before delivery
- Valid JSON (no comments, no trailing commas), UTF-8 encoded
- schema is exactly "our-dialogues.personal-archive.v1"
- Every type is one of the eight allowed values
- Entry IDs unique within the archive, reproducible on re-conversion
- Spot-check three entries' text against the source, character by character
  (typos and punctuation included)
- Every null date and null title verified as genuinely absent in the source
Then report: how many collections, how many entries, how many dated vs.
undated, and every spot you were unsure about and handled conservatively.
````

When the conversion is done, have them save the result as one `.json` file
(e.g. `wren-archive.json`).

---

## What the output looks like (a small example)

Everything below is **invented**, purely to show the shape (the author
"Wren" is fictional).

The source: a paper diary from 2017 — the year is on the cover — typed up
into a txt file:

```text
Apr 2, light rain
The cobbler's stand at the corner has moved on. The cardboard sign says:
gone walking, back in May. I hope the umbrellas can hold out that long.
```

The converted entry:

```json
{
  "id": "diary-2017-04-02",
  "title": null,
  "createdAt": "2017-04-02",
  "updatedAt": null,
  "text": "Apr 2, light rain\nThe cobbler's stand at the corner has moved on. The cardboard sign says:\ngone walking, back in May. I hope the umbrellas can hold out that long.",
  "tags": [],
  "metadata": {}
}
```

Four details worth noticing:

- **The year 2017 came from you** (it was on the cover) — the AI must never
  guess it; hand over context like this together with the text;
- **The line "Apr 2, light rain" did not vanish from the body** — recording
  the date in `createdAt` never means touching the original text;
- **`title` is `null`** — the source has no title, so none is invented; the
  Reader falls back to the date for display (fallback chain in the
  [contract](personal-archive-v1.md));
- A second entry that day would get the ID `diary-2017-04-02-02`.

---

## Small sample first, full batch later

Don't pour ten years of writing in at once. **Convert 10–30 representative
pieces first** — ideally covering: dated ones, undated ones, titled ones,
the longest one, the messiest one.

Import the sample (next section) and check three things against the
originals:

1. **Fidelity** — compare a few pieces character by character: typos still
   there? punctuation untouched? paragraphs intact?
2. **Dates** — dated entries in the right place? Undated ones honestly
   sitting under "Unknown date" rather than wearing an invented one?
3. **Titles** — is each display title the original title, a date, or a
   first line? Any literary title the AI coined gets sent back.

If anything is off, send the concrete example back to your AI, re-convert
the sample, and check again.

Only then convert the full batch. Two points:

- **Reuse the same `archive.id` and the same ID rules**, so the full
  conversion produces exactly the IDs the sample had;
- Before importing the full file, remove the sample source (the source
  row's "Remove this source"), then pick the full file. Because the IDs are
  stable, bookmarks and highlights you made on the sample land back in the
  same places.

---

## Step 2 — import into the reading room

1. Open the Reader ([online](https://willwefind.github.io/our-dialogues/) or local)
2. Sidebar **Sources** row → **＋** → **Choose JSON / ZIP** → pick your `.json`
3. Done. The status line reports how many collections and entries came in.
   Bookmarks, highlights, search, export, themes — everything works on this
   writing; entries read as full-page documents, with the collection and
   author in the header.

---

## Privacy notes

- **You choose the AI that does the conversion.** Your everyday assistant
  works; so does a local model running on your own machine — **for truly
  private archives, a local model is the safest choice**.
- **Don't hand a real archive to a service you don't trust.** Before
  sending, ask yourself: would you mind these words sitting on that
  company's servers? If yes, switch to a local model, or send only what you
  wouldn't mind.
- **The Reader's side is always local.** Online or installed, files are
  parsed inside your own browser — no upload, no account, no sync. The
  online version only means the *web page itself* is hosted on GitHub.
- When sharing samples in an issue or in public, always use **synthetic
  content** (same structure, invented words). This repository's own
  examples are all synthetic too.

---

## FAQ

**Q: Two entries on the same day?**
Add a sequence number to the ID: `diary-2016-03-17`, `diary-2016-03-17-02`.
If the order is unclear, follow the order they appear in the source.

**Q: Many entries with no date at all?**
Write `null`, honestly. The Reader groups them under "Unknown date" and will
never invent one for you. If you work a date out later, edit the JSON and
re-import — keeping the IDs unchanged.

**Q: Mixed languages in one entry?**
Keep them exactly as written. "Never translate" is one of the ten rules —
the mixture is part of the archive.

**Q: Images or stickers in the source?**
This format carries text only. Placeholders the export itself contains
(like `[photo]`) stay verbatim; do **not** let the AI describe images and
write the descriptions into the body. The image files can stay on your disk.

**Q: Import says "unrecognized"?**
The three usual causes: a misspelled `schema` string (it must match to the
character), comments or trailing commas in the JSON, or a non-UTF-8
encoding. Show the error message to your AI; they will fix it.

---

## See also

- [personal-archive-v1.md](personal-archive-v1.md) — the format contract (for adapters and the meticulous)
- [bring-your-own-archive.md](bring-your-own-archive.md) — the sister guide: migrating chat logs
- [getting-started.zh-CN.md](getting-started.zh-CN.md) — getting started from zero (Chinese)
