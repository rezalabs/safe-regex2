# Changelog

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
