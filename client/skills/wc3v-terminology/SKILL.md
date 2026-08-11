---
name: wc3v-terminology
description: Translate Warcraft III jargon (T2, creeping, teching, expo, harass) into plain language, using WC3V's glossary.
---

# Warcraft III terminology

Use this when Warcraft III shorthand appears and the person you are helping may
not know it, or when you are writing for players who are new to the game.

## Where the data is

`https://wc3v.com/data/glossary.json`

```json
{ "terms": [ { "term": "Tier 2", "match": ["t2", "tier two", "teching"], "def": "..." } ] }
```

Each entry has:

- `term` — the canonical name to show
- `match` — aliases to recognise in text. **Match against this array, not
  against `term`.** Players write "t2", "T2", "tier two" and "teching" far more
  often than "Tier 2", and matching only the canonical form finds almost
  nothing.
- `def` — a plain-language definition

## How to use it

Match case-insensitively and on word boundaries. `t2` should match "went t2
fast" but not the middle of an unrelated word.

Explain a term the first time it appears, then use the shorthand. Re-explaining
every occurrence reads as condescending to anyone who already plays.

Prefer the glossary's own wording. It was written for players who are new to
the game, and rephrasing it usually makes it longer and less clear.

If a term is not in the glossary, say you are not certain rather than inferring
a definition from context. Warcraft III shorthand is dense and frequently
race-specific, and a confident wrong definition is worse than a gap.

## Related

- `wc3v-build-lookup` for build orders
- `wc3v-replay-analysis` for reading a parsed game
