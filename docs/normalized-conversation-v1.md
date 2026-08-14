# Normalized Conversation Schema v1

Internal contract used by the reader after a source-specific adapter has parsed an export.

The normalized object exists **in memory**. Importing a source archive does not require rewriting the user's original files.

## Root

```json
{
  "schema": "our-dialogues.normalized.v1",
  "source": {
    "platform": "chatgpt",
    "exporter": "official",
    "formatVersion": null
  },
  "exportedAt": "2026-08-14T09:00:00+08:00",
  "conversations": []
}
```

### Root fields

- `schema`: always `our-dialogues.normalized.v1`
- `source.platform`: source platform, e.g. `chatgpt`, `claude`, `mufy`, `ciel-house`
- `source.exporter`: exporter name, e.g. `official`, `mufy-batch-export`, plugin name
- `source.formatVersion`: source format version if known
- `exportedAt`: ISO 8601 timestamp or `null`
- `conversations`: normalized conversation array

## Conversation

```json
{
  "id": "conversation-id",
  "title": "A conversation",
  "createdAt": "2026-08-14T01:00:00Z",
  "updatedAt": "2026-08-14T02:00:00Z",
  "context": {
    "room": null
  },
  "participants": [
    {"id": "user", "name": "Dawn", "role": "user"},
    {"id": "assistant", "name": "Assistant", "role": "assistant"}
  ],
  "messages": []
}
```

Unknown source-specific conversation properties should be preserved under `context.sourceMetadata` instead of being discarded.

## Message

```json
{
  "id": "message-id",
  "role": "assistant",
  "speaker": "Assistant",
  "createdAt": "2026-08-14T01:01:00Z",
  "content": [
    {"type": "text", "text": "Hello."}
  ],
  "thinking": [
    {"type": "text", "text": "Optional exported reasoning/thinking content."}
  ],
  "attachments": [],
  "metadata": {}
}
```

### Role

Normalized roles:

- `user`
- `assistant`
- `system`
- `tool`
- `other`

Platform-specific role values should be mapped to one of these while preserving the original value in `metadata.originalRole` when useful.

### Content

`content` is always an array so richer exports can grow without changing the contract.

Initial supported item types:

- `text`
- `image`
- `audio`
- `file`
- `code`
- `unknown`

Unknown structures must be retained in `metadata` when practical.

### Thinking / reasoning

`thinking` is optional and only populated when the source export actually contains that information.

The reader must never fabricate hidden reasoning.

### Attachments

Attachment records may contain:

```json
{
  "type": "image",
  "name": "image.png",
  "src": "assets/images/image.png",
  "mimeType": "image/png",
  "metadata": {}
}
```

For ZIP archives, `src` should normally be a relative archive path.

## Design rules

1. Preserve source data whenever practical.
2. Do not invent fields that the source did not contain.
3. Do not expose private fixtures in the public repository.
4. Adapters understand sources; the reader understands only this normalized model.
5. Schema changes that break compatibility require a new normalized schema version.
