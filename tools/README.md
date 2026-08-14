# ElevenLabs Voice Archive Exporter

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

Unknown `voice_id` records are written to `unknown/manifest.json` and `manifest-all.json`, but their audio is not downloaded. Every known record retains `historyItemId`, `voiceId`, `speaker`, `createdAt`, `text`, `requestId`, `modelId`, `source`, `audioPath`, and useful content metadata.

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
$all = Get-Content "$root\manifest-all.json" -Raw | ConvertFrom-Json
$sol = Get-Content "$root\sol\manifest.json" -Raw | ConvertFrom-Json
$ciel = Get-Content "$root\ciel\manifest.json" -Raw | ConvertFrom-Json

$all.counts
[pscustomobject]@{
  SolManifest = $sol.itemCount
  SolAudio = @(Get-ChildItem "$root\sol\audio" -File).Count
  CielManifest = $ciel.itemCount
  CielAudio = @(Get-ChildItem "$root\ciel\audio" -File).Count
}
```

`SolManifest` should equal `SolAudio`, and `CielManifest` should equal `CielAudio`, unless the command reported failed downloads. Unknown records are metadata-only by design.

## Test

The tests use a fake in-memory ElevenLabs service and never require an API key or network access:

```powershell
node --test --test-isolation=none tests\elevenlabs-voice-archive.test.mjs
```
