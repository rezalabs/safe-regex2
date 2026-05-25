# Changelog

## 6.1.0 — 2026-05-25

### Security fix

- **SET-prefix alternation ReDoS detection** — Extended the alternation prefix-overlap
  detection to handle character classes (`[a-z]`), the dot metacharacter (`.`), and
  predefined shorthand sets (`\d`, `\w`, `\s`). Previously only literal `CHAR` nodes
  were compared, leaving patterns like `([a-z]|[a-z][a-z])+`, `(.|..)+`, and
  `(\d|\d\d)+` undetected. These are now correctly flagged as unsafe. Disjoint sets
  like `([a-z]|[0-9])+` remain safe.

### Features

- **`semanticChange` field on `fix()` result** — Added `semanticChange: boolean` to
  `FixResult`. True when a fix was produced (the fixed regex may match a different
  language than the original). False when no fix was applied. Helps consumers avoid
  blindly applying auto-fixes that change behavior.

### Build

- **Lockfile enabled** — Removed `package-lock=false` from `.npmrc` and
  `package-lock.json` from `.gitignore`. Generated `package-lock.json` for
  reproducible dependency resolution.

### Dependencies

- **`@rezalabs/ret` upgraded to 1.0.1** — Fixes false-positive ReDoS alerts from
  sequential quantifiers (`a++`, `a**`), which now throw `SyntaxError` instead of
  producing incorrect nested REPETITION trees. Also resolves the quantifier
  parser's own ReDoS vulnerability, enforces a 100k-character input limit, and
  improves `reconstruct()` robustness for edge-case token trees.

### Tests

- **CHAR vs SET prefix overlap** — Added tests for patterns where alternatives
  start with a literal character versus a character class (e.g., `(a|[a-z])+`).
- **Negated SET overlap** — Added tests for negated character class comparisons
  (e.g., `([^a-z]|[0-9])+`), covering both CHAR-entry and RANGE-entry code paths.
- **Mixed SET entries** — Added tests for SETs with mixed CHAR and RANGE entries
  (e.g., `([ab]|[a-z])+`), covering the CHAR-vs-RANGE comparison branch.
- **`findGroupWithOptions` recursion** — Added a fix test case where the
  options-containing group is nested behind non-option child nodes.

## 6.0.0 — 2026-05-18

Maintained fork of [fastify/safe-regex2](https://github.com/fastify/safe-regex2). First release under `@rezalabs/safe-regex2`.

### Breaking changes

- **Dependency changed** — Uses `@rezalabs/ret` instead of `ret`. The parser is a drop-in replacement but the package name differs.

- **New exports** — `analyze()` and `fix()` added alongside the existing default export. Code that iterates over `require('safe-regex2')` keys may see new properties.

### New features

- **Alternation-based ReDoS detection** — Alternatives inside a quantifier where one is a literal prefix of another (e.g., `(a|aa|aaa)+`) are now flagged as unsafe. Previously only nested repetition (star height > 1) was detected.

- **`analyze(re)` export** — Returns a detailed risk assessment with severity level (`none`, `low`, `high`, `critical`), specific reasons, diagnostic metrics (star height, repetition count, alternation overlap), anchoring and static suffix detection, and an auto-fix suggestion if available.

- **`fix(re)` export** — Attempts to produce a safe version of an unsafe regex by stripping redundant outer quantifiers or collapsing same-character alternatives. Every fix is verified safe before being returned.

- **Severity scoring** — `analyze()` assigns severity based on star height depth, alternation overlap, and repetition count. Patterns anchored with `^...$` or ending with a literal suffix have reduced severity.

### Bug fixes

- **`reconstruct()` max handling** — Fixed `reconstruct()` producing `{1,null}` instead of `+` by converting `null` max values to `Infinity` when building fixed AST nodes.

### Meta

- Package renamed to `@rezalabs/safe-regex2` (scoped) for npm publishing.
- Repository updated to `github.com/rezalabs/safe-regex2`.
- Original author and Fastify contributors credited in contributors section.
