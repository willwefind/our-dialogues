# Ciel handoff — House Export v1

Your scope is intentionally narrow: add a conversation export feature to the existing Ciel House repository.

## Contract

Implement the exact format in:

`docs/ciel-house-export-v1.md`

The reader side will be implemented independently.

## Required first milestone

Add:

`Settings → Data & Backup → Export all conversations`

The result should be either:

- preferred: `ciel-house-export-YYYY-MM-DD.zip`
- acceptable first pass: standalone `ciel-house-export-v1.json`

## Export requirements

1. Export all real chat sessions and all messages.
2. Preserve stable IDs if the database already has them.
3. Preserve timestamps when available.
4. Preserve room identity/name.
5. Preserve speaker identity.
6. Preserve text exactly; do not summarize it.
7. Preserve supported attachment references.
8. Do not invent thinking/reasoning if the application does not store it.
9. Do not use Ombre as a substitute for full chat history.
10. Internal database design is not part of the public contract.

## Validation handoff

When implemented, produce one **private** real export for Dawn to test.

Expected acceptance path:

`Ciel House → export → no manual edits → Our Dialogues → opens successfully`

A synthetic fixture can be committed publicly; Dawn's real export must not be committed.
