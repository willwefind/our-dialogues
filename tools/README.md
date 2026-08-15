# Local verification tools

## Claude webpage-plugin smoke

`smoke-claude-web-exporter.mjs` strictly detects one or more local `ai-chat-exporter.net` JSON files and reports only message/role/timestamp counts and preservation booleans. It never prints filenames, links, titles, or conversation text.

```text
node tools/smoke-claude-web-exporter.mjs path/to/claude-plugin.json
```

## Mufy source-fidelity smoke

`smoke-mufy-source-fidelity.mjs` compares the legacy visible-text path with the current Mufy adapter for one local ZIP. It prints only archive/message counts and literal `<div`, `<details`, and `<think` counts; it never prints conversation text.

```text
node tools/smoke-mufy-source-fidelity.mjs path/to/mufy.zip
```

## ElevenLabs Voice Archive Exporter

This local tool backs up ElevenLabs generation history without changing the Our Dialogues reader. It walks every History API page, saves metadata, and downloads audio for the configured Sol and Ciel voices.

The API key is read only from the current process environment or a repository-root `.env.local`. The tool never prints it. `.env.local` and in-repository archive directories are blocked by `.gitignore`.

## Output

The default Windows destination is `D:\Our Dialogues\VoiceArchive`:

```text
VoiceArchive/
  sol/
    audio/
    manifest.json
  ciel/
    audio/
    manifest.json
  unknown/
    manifest.json
  manifest-all.json
```

The exporter supports both ElevenLabs History shapes: classic items with top-level `voice_id` / `voice_name` / `text`, and dialogue items where those top-level fields are null and the values live in `dialogue[]`. A non-empty top-level `voice_id` always wins. When it is absent, exactly one unique non-empty dialogue voice ID may classify the item. Multiple dialogue voice IDs are marked `mixed`, kept in the `unknown` metadata bucket, and never downloaded automatically.

Unknown and mixed records are written to `unknown/manifest.json` and `manifest-all.json`, but their audio is not downloaded. Manifest schema version 2 keeps the complete raw `dialogue` array and adds these normalized fields:

| Field | Meaning |
| --- | --- |
| `voiceId` | Top-level voice ID, or the sole unique dialogue voice ID; null for mixed/missing voices. |
| `voiceIdSource` | `top-level`, `dialogue-single`, `dialogue-mixed`, or `none`. |
| `dialogueVoiceIds` | Every unique non-empty `dialogue[].voice_id`, in source order. |
| `speaker` | `sol`, `ciel`, `unknown`, or `mixed`. |
| `voiceName` | Top-level name when present, otherwise the matching dialogue name for a resolved voice. |
| `text` / `textSource` | Top-level text when present; otherwise non-empty dialogue texts joined with newlines. |
| `dialogue` | The complete dialogue metadata returned by ElevenLabs, or null. |

Version 1 `manifest-all.json` files remain valid resume inputs and are upgraded in place on the next run. In `counts`, `unknown` remains the complete non-downloaded bucket for backward compatibility; `mixed` is an additional subset count. Every record also retains `historyItemId`, `createdAt`, `requestId`, `modelId`, `source`, `audioPath`, and useful content metadata.

Downloads use deterministic filenames and temporary `.part` files. On a repeated run, a non-empty existing audio file is kept rather than downloaded again. History pages and manifest records are de-duplicated by `historyItemId`. Network failures, HTTP 429, and server errors use exponential retries; the server's `Retry-After` header is honored.

## Configure on Windows

Use either of these approaches. Do not paste the API key into source files or shell history that may be shared.

### Option A: local env file

From the repository root:

```powershell
Copy-Item tools\.env.local.example .env.local
notepad .env.local
```

Replace only `replace_with_your_local_api_key`, save the file, and close Notepad. The supplied voice IDs are:

- Sol: `vQyoa2SYcKP0n2lCM3XS`
- Ciel: `ruROucOxsuDRzADgMIvL`

### Option B: current PowerShell process

```powershell
$env:ELEVENLABS_API_KEY = Read-Host "ElevenLabs API key"
```

This variable disappears when that PowerShell process closes. The voice IDs and default output path are already built in.

## Run

Node.js 18 or newer is required. From the repository root:

```powershell
node tools\elevenlabs-voice-archive.mjs
```

To choose a different destination:

```powershell
node tools\elevenlabs-voice-archive.mjs --output "D:\Our Dialogues\VoiceArchive"
```

Useful tuning options:

```powershell
node tools\elevenlabs-voice-archive.mjs --page-size 500 --max-retries 7 --retry-base-ms 1500
```

Run the same command again after an interruption. Completed audio is skipped and manifests are rebuilt from the current ElevenLabs history plus the saved local state.

## Verify

Inspect the summary and compare each known manifest's item count with its audio count:

```powershell
$root = "D:\Our Dialogues\VoiceArchive"
$all = Get-Content "$root\manifest-all.json" -Raw -Encoding UTF8 | ConvertFrom-Json
$sol = Get-Content "$root\sol\manifest.json" -Raw -Encoding UTF8 | ConvertFrom-Json
$ciel = Get-Content "$root\ciel\manifest.json" -Raw -Encoding UTF8 | ConvertFrom-Json

$all.counts
[pscustomobject]@{
  SolManifest = $sol.itemCount
  SolAudio = @(Get-ChildItem "$root\sol\audio" -File).Count
  CielManifest = $ciel.itemCount
  CielAudio = @(Get-ChildItem "$root\ciel\audio" -File).Count
}
```

`SolManifest` should equal `SolAudio`, and `CielManifest` should equal `CielAudio`, unless the command reported failed downloads. Unknown and mixed records are metadata-only by design. An interrupted or version 1 archive can be rerun with the same command: existing non-empty audio, including the already downloaded Sol MP3, is skipped.

## Map SolVoice to a ChatGPT official export

`map-solvoice-chatgpt.mjs` builds a local sidecar mapping without changing the ChatGPT export, VoiceArchive manifests, or audio files. It loads the existing `chatgpt-official-2026` adapter in Node, so active-branch selection and message normalization stay aligned with the Reader.

The matcher combines UTC/Unix time distance, punctuation-insensitive multilingual text similarity, `api_tool` metadata, voice/speech wording in exported thoughts or reasoning recaps, and conversation-level monotonic dynamic programming. More than one clip may map to the same assistant turn. Conservative thresholds leave weak results as `ambiguous` or `unmatched`; those records have no accepted conversation or message ID, while their top candidates remain available for local review.

The official adapter preserves every attached reasoning source's message ID, raw `create_time`, content type, and tool icons. For each clip, `effectiveAnchorTime` prefers the nearest timestamped reasoning source carrying `api_tool`, then a timestamped voice-summary reasoning source, and finally the visible assistant message time. Mapping evidence retains both the effective delta and the visible-message delta; the source timestamp never replaces or mutates the exported message timestamp.

On Windows, the defaults read:

```text
D:\Our Dialogues\SolMyLove
D:\Our Dialogues\VoiceArchive\manifest-all.json
```

and write these private local files:

```text
D:\Our Dialogues\VoiceArchive\mappings\chatgpt-solvoice.json
D:\Our Dialogues\VoiceArchive\mappings\chatgpt-solvoice-summary.json
```

Run from the repository root:

```powershell
node tools\map-solvoice-chatgpt.mjs
```

Every path can be overridden:

```powershell
node tools\map-solvoice-chatgpt.mjs --export "D:\private\chatgpt-export" --manifest "D:\private\voice-archive\manifest-all.json" --output "D:\private\voice-archive\mappings\chatgpt-solvoice.json" --report "D:\private\voice-archive\mappings\chatgpt-solvoice-summary.json"
```

For a known local validation pair, add `--anchor-history-id <id> --anchor-conversation-id <id>`. These private identifiers are optional CLI values and are never stored in the repository.

The mapping contains private local associations and must never be committed. `.gitignore` blocks in-repository `mappings/` directories and the default mapping filenames. Terminal progress deliberately prints only counts, identifiers, confidence labels, and time deltas, never voice or chat text.

## Test

The tests use a fake in-memory ElevenLabs service and never require an API key or network access:

```powershell
node --test --test-isolation=none tests\elevenlabs-voice-archive.test.mjs
node --test --test-isolation=none tests\map-solvoice-chatgpt.test.mjs
```
