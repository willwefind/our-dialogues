# Contributing to Our Dialogues

Thanks for caring about conversation archives. Two rules keep this project safe; everything else is style.

## Rule 1 — Never post real conversations

**Do not attach, paste, or commit real chat exports** — yours or anyone else's. Not in issues, not in pull requests, not "just one message as an example". Real archives contain real relationships.

When reporting a format we don't support yet, send a **synthetic sample**: a hand-written file with the same *structure* (keys, nesting, field types) and made-up content ("Synthetic question one", fake IDs, fake timestamps). Look at [`fixtures/`](fixtures/) for the shape we expect — every public fixture in this repository is wholly synthetic.

If the structure itself is hard to describe safely, open an issue that lists only **key names and types** (no values), like:

```text
top level: array of conversations
conversation: uuid (string), name (string), chat_messages (array)
message: sender ("human" | "assistant"), content (array of typed parts)
```

That is exactly how the Claude official-export adapter started.

## Rule 2 — Strict detection, honest rendering

- An adapter must **fingerprint its format strictly**. Generic keys like `conversations` or `messages` are not enough; when unsure, return "unknown" — the Reader shows metadata-only diagnostics instead of guessing. Misreading someone's archive is worse than rejecting it.
- Never invent thinking/reasoning the source didn't store. Heuristic splits are labeled heuristic; official fields are labeled official.
- Never execute source HTML. Parse it into safe normalized blocks; unknown markup falls back to readable text; keep the raw record in metadata.
- Do not silently drop or truncate content — record counts for anything you exclude.

## Adding a new source adapter

1. Copy the smallest existing adapter as a template ([`src/adapters/ciel-house.js`](src/adapters/ciel-house.js) is compact; [`src/adapters/claude-official.js`](src/adapters/claude-official.js) shows branching, thinking, and tool traces).
2. Convert the source into the normalized schema (see [`docs/normalized-conversation-v1.md`](docs/normalized-conversation-v1.md)).
3. Declare capabilities (`our-dialogues.adapter-capabilities.v1`) truthfully.
4. Register the script in `index.html` **before** `registry.js`, and add the adapter to the test runtime lists.
5. Add a synthetic fixture in `fixtures/` and tests in `tests/` (detection must be mutually exclusive with every existing adapter — there's a test that enforces this).
6. `node --test --test-isolation=none tests/*.test.mjs` must stay green.

No build step, no dependencies, classic scripts only — that's deliberate, so the Reader keeps working from a plain folder for years.

## Development

```bash
node --test --test-isolation=none tests/*.test.mjs
```

Windows: double-click `Start Reader.bat`. macOS/Linux: `./start-reader.sh`. Both serve `http://127.0.0.1:4173/` — the port is fixed on purpose (IndexedDB is scoped to host+port).

## License

Contributions are accepted under AGPL-3.0, the project license.
