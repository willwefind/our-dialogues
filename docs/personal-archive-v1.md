# Personal Archive v1 (`our-dialogues.personal-archive.v1`)

A small, explicit **source format** for bringing already-existing personal
writing — diaries, dreams, essays, microblog posts, notes, letters,
fragments — into the Our Dialogues reading room.

It is a source format only. At import time the Reader's adapter converts it
into the internal `our-dialogues.normalized.v1` contract, which stays
unchanged. Nothing about the Reader's storage, search, bookmarks,
highlights, progress, or export contracts is specific to this format.

The Reader remains a reader: this format describes text that already
exists. It is not an editor format, and importing never uploads anything —
files are parsed locally in the browser.

---

## Root document

```json
{
  "schema": "our-dialogues.personal-archive.v1",
  "archive": {
    "id": "sample-personal-archive",
    "name": "苔米的文字柜",
    "author": {
      "id": "taimi",
      "name": "苔米"
    }
  },
  "exportedAt": "2026-08-23T13:45:00+08:00",
  "collections": []
}
```

| Field | Required | Notes |
| --- | --- | --- |
| `schema` | ✅ | Must be exactly `"our-dialogues.personal-archive.v1"`. Detection is strict equality; nothing else is sniffed. |
| `archive.id` | ✅ | Stable identifier for this archive. Reused on re-export so re-imports are recognized. |
| `archive.name` | ✅ | Display name. Becomes part of the source label in the Reader. |
| `archive.author.id` | recommended | Stable author identifier. |
| `archive.author.name` | recommended | Display name used as the document author. |
| `exportedAt` | optional | ISO 8601. Informational only. |
| `collections` | ✅ | Array of collections (below). |

## Collection

One collection = one meaningful body of writing (十年日记, 梦境, 微博, 念, 随笔…).

```json
{
  "id": "ten-year-diary",
  "name": "十年日记",
  "type": "diary",
  "entries": []
}
```

| Field | Required | Notes |
| --- | --- | --- |
| `id` | ✅ | Stable within the archive. Used in conversation IDs — changing it breaks bookmarks/highlights/progress continuity. |
| `name` | ✅ | Display name shown in the sidebar. |
| `type` | optional | One of `diary`, `dream`, `essay`, `microblog`, `note`, `letter`, `fragment`, `other`. Unknown values normalize to `other`; the original value is preserved in metadata. |
| `entries` | ✅ | Array of entries (below). |

## Entry

```json
{
  "id": "diary-2016-03-17",
  "title": null,
  "createdAt": "2016-03-17T00:00:00+08:00",
  "updatedAt": null,
  "text": "原文，一字不改。",
  "tags": [],
  "metadata": {}
}
```

| Field | Required | Notes |
| --- | --- | --- |
| `id` | ✅ | Stable, deterministic (rules below). Entries without an `id` or without `text` are skipped and counted in diagnostics. |
| `text` | ✅ | The archival text, exactly as it exists. |
| `title` | optional | Only if the source genuinely has one. `null`/omitted otherwise. |
| `createdAt` | optional | ISO 8601, or `null` when genuinely unknown. |
| `updatedAt` | optional | ISO 8601, or `null`. |
| `tags` | optional | Array of strings. |
| `metadata` | optional | Free-form object; preserved under the normalized conversation's `context.sourceMetadata.entryMetadata`. |

---

## Text fidelity (absolute rule)

Personal Archive text is archival source text. Conversion tooling and the
adapter must not:

- polish, correct spelling, or normalize punctuation;
- translate;
- merge entries, or split an entry for aesthetic reasons;
- remove repeated, malformed, or embarrassing text;
- infer missing sentences.

Whitespace and newlines are preserved as faithfully as practical. When
parsing a source is uncertain, preserve more, not less. The adapter carries
`entry.text` into the normalized message byte-for-byte.

## Stable IDs

Reader features (bookmarks, highlights, reading progress) anchor to IDs, so
entry IDs must be identical across repeated conversions of the same source.

Preferred strategy, in order:

1. use the original source ID if one exists (e.g. `weibo-3498273412`);
2. otherwise a deterministic source key (e.g. `nian-000184`);
3. otherwise date + stable sequence (e.g. `diary-2016-03-17`,
   `diary-2016-03-17-02` for a second entry that day).

Never generate random UUIDs per conversion, and never derive the ID solely
from mutable title text.

## Dates

Never fabricate a date.

- Exact timestamp known → full ISO: `"2019-05-04T23:41:00+08:00"`.
- Only the day known → represent that day consistently
  (`"2016-03-17T00:00:00+08:00"`).
- Truly unknown → `null` (or omit). The Reader groups such entries under a
  localized "Unknown date / 日期未知" heading and never invents one.

## Titles

Entries are not forced to have invented literary titles. The adapter picks
a display title conservatively, recording where it came from:

| Priority | Source | `titleSource` |
| --- | --- | --- |
| 1 | explicit `title` field | `original` |
| 2 | first line of `text` when it is clearly a heading (a Markdown `# ` line) — the body text itself is never altered | `heading` |
| 3 | the date (`YYYY-MM-DD`) when `createdAt` exists | `date` |
| 4 | a conservative first-line excerpt | `first-line` |
| 5 | localized "Untitled / 无题" | `fallback` |

An AI-generated poetic title must never be persisted as though it came from
the source.

---

## Normalization mapping

Each entry becomes one normalized conversation; the entry text becomes one
body message with `role: "other"` (never a fake `user`/`assistant` pair).

```json
{
  "id": "personal:ten-year-diary:diary-2016-03-17",
  "title": "2016-03-17",
  "createdAt": "2016-03-17T00:00:00+08:00",
  "context": {
    "room": null,
    "sourceMetadata": {
      "contentKind": "personal-document",
      "collectionId": "ten-year-diary",
      "collectionName": "十年日记",
      "documentType": "diary",
      "authorId": "taimi",
      "authorName": "苔米",
      "titleSource": "date"
    }
  },
  "participants": [
    { "id": "taimi", "name": "苔米", "role": "other" }
  ],
  "messages": [
    {
      "id": "personal:ten-year-diary:diary-2016-03-17:body",
      "role": "other",
      "speaker": "苔米",
      "createdAt": "2016-03-17T00:00:00+08:00",
      "content": [{ "type": "text", "text": "原文，一字不改。" }],
      "metadata": { "personalDocument": true }
    }
  ]
}
```

Normalized root:

```json
{
  "schema": "our-dialogues.normalized.v1",
  "source": {
    "platform": "personal-archive",
    "exporter": "our-dialogues-personal-archive",
    "formatVersion": 1
  }
}
```

Notes:

- `contentKind: "personal-document"` is the **only** marker that switches
  the Reader into document presentation mode (no speaker chrome). It is
  never inferred from shape (one participant / one message / `role:
  "other"` alone never triggers it).
- Collection/entry specifics live under `context.sourceMetadata`; the
  normalized schema itself gains no new top-level fields.
- An unknown collection `type` normalizes to `documentType: "other"` with
  the original value preserved as `documentTypeOriginal`.
- Entry `tags` are preserved under `context.sourceMetadata.entryTags`
  (source provenance); they are not auto-imported into the Reader's own
  tag system, which stays user-owned.

## Diagnostics

Import diagnostics report counts only — collections, entries, dated/undated
entries, per-type counts, skipped invalid entries. Body text, private
titles, and source paths never appear in diagnostics or logs.

## Privacy

Real personal archives are extremely private. The repository only ever
contains synthetic fixtures (`fixtures/personal-archive-v1-synthetic.json`);
real writing stays on the owner's machine, and the Reader parses it locally
without uploading anything.

## See also

- `docs/bring-your-personal-archive.zh-CN.md` — ready-made conversion
  prompt for turning old diaries/microblogs/notes into this format
  (English: `docs/bring-your-personal-archive.md`).
- `docs/source-compatibility.md` — all supported source formats.
