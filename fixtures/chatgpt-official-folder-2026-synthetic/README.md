# Synthetic ChatGPT export folder fixture

Every ID, message, filename, and asset in this directory is fictional. Nothing
here came from a ChatGPT account or private export.

The fixture represents the parts of the 2026 official folder structure used by
Our Dialogues:

- `export_manifest.json` declares logical `conversations.json` as two shards
- `conversation_asset_file_names.json` restores original names for exported
  `.dat` files
- `library_files.json` supplies MIME, library, message, and conversation links
- the two conversation shards exercise `text`, `multimodal_text`, `thoughts`,
  `reasoning_recap`, attachment metadata, and an image asset pointer
- four `.dat` files exercise image, audio, video, and generic-file routing

`file_synthetic_image.dat` is a valid tiny SVG and
`file_synthetic_document.dat` is a valid text document. The audio and video
files are deliberately inert text placeholders: they verify lazy asset lookup
and native media-control selection without adding opaque binary test media or
third-party material.
