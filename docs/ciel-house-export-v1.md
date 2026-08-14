# Ciel House Export v1

Stable export contract between Ciel House and Our Dialogues.

Ciel House may change its internal database at any time. The reader should not care, as long as the exported archive continues to satisfy this contract.

## Goal

`Ciel House → export → untouched ZIP/JSON → Our Dialogues → readable`

That full path must work before the README marks Ciel House support as verified.

## Preferred ZIP layout

```text
ciel-house-export-YYYY-MM-DD.zip
├── manifest.json
├── conversations.json
└── assets/
    ├── images/
    ├── audio/
    └── files/
```

Assets are optional.

## manifest.json

```json
{
  "format": "ciel-house-export",
  "version": 1,
  "exportedAt": "2026-08-14T09:55:00+08:00",
  "dataFile": "conversations.json",
  "assetsRoot": "assets/",
  "houseVersion": null
}
```

Required:

- `format`: exactly `ciel-house-export`
- `version`: integer `1`
- `exportedAt`
- `dataFile`

Optional:

- `assetsRoot`
- `houseVersion`
- additional future metadata

## conversations.json

```json
{
  "conversations": [
    {
      "id": "session-001",
      "title": "Tonight in the living room",
      "room": {
        "id": "living-room",
        "name": "客厅"
      },
      "createdAt": "2026-08-14T01:00:00Z",
      "updatedAt": "2026-08-14T02:00:00Z",
      "participants": [
        {"id": "dawn", "name": "Dawn", "role": "user"},
        {"id": "ciel", "name": "Ciel", "role": "assistant"}
      ],
      "messages": []
    }
  ]
}
```

## Message

```json
{
  "id": "message-001",
  "role": "assistant",
  "speaker": "Ciel",
  "createdAt": "2026-08-14T01:01:00Z",
  "content": [
    {"type": "text", "text": "正文"}
  ],
  "thinking": [],
  "attachments": [],
  "metadata": {
    "model": null,
    "original": {}
  }
}
```

### Required message fields

- `id`
- `role`
- `speaker`
- `content`

### Recommended message fields

- `createdAt`
- `thinking` — only if Ciel House actually stores/exported this information
- `attachments`
- `metadata`

## Attachments

Do not embed large binary blobs as base64 inside `conversations.json` unless there is a strong reason.

Prefer:

```json
{
  "type": "audio",
  "name": "reply-001.mp3",
  "src": "assets/audio/reply-001.mp3",
  "mimeType": "audio/mpeg"
}
```

## Standalone JSON

Ciel House may also offer a lightweight JSON-only export.

For standalone JSON, use:

```json
{
  "format": "ciel-house-export",
  "version": 1,
  "exportedAt": "...",
  "conversations": []
}
```

The reader accepts both this standalone form and the preferred ZIP form.

## Important separation

Ciel House chat export and Ombre memory backup are different data products.

- Chat export: complete conversation history intended for reading/search/archive.
- Ombre backup: retained long-term memory intended for continuity/restoration.

Do not merge Ombre records into the conversation export as if they were original chat messages.
