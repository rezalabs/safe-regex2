# AGENTS.md — @rezalabs/safe-regex2

Detects and fixes catastrophic backtracking (ReDoS) in regular expressions. Parses regex into an AST via `@rezalabs/ret`, walks the tree checking star height and alternation prefix overlap, and can auto-fix unsafe patterns using `reconstruct()`.

## Architecture

`index.js` is the entire runtime. There is no build step.

- `walk(node, opts, starHeight)` — core AST traversal. Returns `boolean`. Short-circuits on first problem.
- `fixNode(node, limit)` — top-down AST transformer for auto-fix. Strips redundant outer quantifiers, collapses same-char alternatives.
- `fixAlternationReDoS(repNode, limit)` — rewrites overlapping alternatives into a safe form (same-char only).
- `analyze(re, opts)` — runs `walkAnalyze` (non-short-circuiting traversal), `findOverlappingAlternatives`, `detectAnchored`, `detectStaticSuffix`, then maps to severity.
- `fixRegex(re, opts)` — parses, runs `fixNode`, `reconstruct`s, re-parses and re-validates the fix.

All exports hang off the default function: `module.exports.safeRegex`, `module.exports.fix`, `module.exports.analyze`.

## Key Dependencies

- `@rezalabs/ret` — regex tokenizer/parser. Provides `parse()`, `types`, `reconstruct()`. AST node types are numeric constants (`types.REPETITION === 5`, `types.CHAR === 7`, etc.).

## Conventions

- CommonJS (`require`/`module.exports`), no ESM.
- No TypeScript at runtime — `.d.ts` and `.tst.ts` are declaration-only.
- `ret` AST nodes use `max: null` for unbounded quantifiers, but `reconstruct()` needs `max: Infinity` to produce `+`/`*`. Always convert: `max === null ? Infinity : max`.
- Test assertions use `node:test` built-in (`t.plan` for counted assertions).
- Linting uses `neostandard` with `ts: true`.

## Files

| Path | Purpose |
|------|---------|
| `index.js` | All runtime code |
| `types/index.d.ts` | TypeScript declarations |
| `types/index.tst.ts` | Type assertions (run by `tstyche`) |
| `test/regex.test.js` | All unit tests |
| `bin/safe-regex2.js` | CLI entry point |
| `example/safe.js` | Usage example |

## Git Commits

Conventional commits with scoped prefixes, matching the ret.js convention:

```
feat: add unicode properties and lookbehinds
fix: fix parsing a backslash at end of pattern
docs: restructure README and add CHANGELOG
chore: update package metadata and CI workflows
```

## Post-Task Validation

Run all three after any change to `index.js`, `types/`, or `test/`:

```
npm run test:unit
npm run test:typescript
npm run lint
```

Tests run via `node --test`. Coverage enforced in CI via `node --experimental-test-coverage` with thresholds (lines 99%, functions 99%, branches 90%).
