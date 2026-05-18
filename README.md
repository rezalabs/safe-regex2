# safe-regex2

[![CI](https://github.com/rezalabs/safe-regex2/actions/workflows/ci.yml/badge.svg)](https://github.com/rezalabs/safe-regex2/actions/workflows/ci.yml)
[![NPM version](https://img.shields.io/npm/v/@rezalabs/safe-regex2.svg?style=flat)](https://www.npmjs.com/package/@rezalabs/safe-regex2)

Detect, analyze, and automatically fix regular expressions vulnerable to
catastrophic backtracking (ReDoS).

This package is a fork of [fastify/safe-regex2](https://github.com/fastify/safe-regex2),
which was itself a fork of the original `safe-regex` by James Halliday (substack).
The original author's GitHub account is no longer available, but the code lives on.

## What it does

Three functions:

| Function | Returns | Purpose |
|----------|---------|---------|
| `safeRegex(re)` | `boolean` | Quick check: is this regex safe or not? |
| `analyze(re)` | `object` | Detailed risk assessment with severity scoring |
| `fix(re)` | `object` | Attempt to produce a safe version of an unsafe regex |

It detects two classes of ReDoS vulnerability:

1. **Nested repetition** (star height > 1). Patterns like `(a+)+` or `(x+x+)+y`
   where quantifiers are nested inside other quantifiers, creating exponential
   backtracking paths.

2. **Alternation prefix overlap**. Patterns like `(a|aa|aaa)+` where alternatives
   inside a quantifier share a literal prefix, allowing the engine to partition
   the same input in exponentially many ways.

## Install

```sh
npm install @rezalabs/safe-regex2
```

## Quick check

```js
const safe = require('@rezalabs/safe-regex2')

safe('(beep|boop)*')  // true
safe('(a+)+')         // false
safe('(a|aa|aaa)+')   // false
```

The input can be a `RegExp` object or a string. Invalid regex strings return `false`.

## Analyze

The `analyze()` function returns a detailed report instead of a boolean.

```js
const { analyze } = require('@rezalabs/safe-regex2')

const result = analyze('(a+)+y')
```

Returns:

```js
{
  safe: false,
  severity: 'low',             // 'none' | 'low' | 'high' | 'critical'
  reasons: [
    'Nested repetition detected (star height 2)'
  ],
  starHeight: 2,
  repCount: 2,
  hasAlternationReDoS: false,
  anchored: false,
  hasStaticSuffix: true,        // the 'y' at the end reduces practical risk
  fix: '(a+)y'                  // auto-generated safe version
}
```

### Severity levels

| Level | Meaning |
|-------|---------|
| `none` | No issues detected. The regex is safe. |
| `low` | Minor issues or structural issues mitigated by anchoring or a static suffix. |
| `high` | Nested repetition or alternation prefix overlap. Real ReDoS risk. |
| `critical` | Deeply nested repetition (star height 3+). Extreme risk. |

Mitigating factors lower severity by one level. If a pattern is anchored
(`^...$`) or ends with a literal character suffix, the practical risk of
catastrophic backtracking is reduced because the engine's backtracking is
constrained.

## Auto-fix

The `fix()` function attempts to produce a safe version of an unsafe regex.

```js
const { fix } = require('@rezalabs/safe-regex2')

fix('(a+)+y')
// { safe: false, fixed: '(a+)y', original: '(a+)+y' }

fix('(a|aa|aaa)+')
// { safe: false, fixed: 'a+', original: '(a|aa|aaa)+' }

fix('^[a-z]+$')
// { safe: true, fixed: null, original: '^[a-z]+$' }
```

Current fix strategies:

- **Strip redundant outer quantifiers.** `(a+)+y` becomes `(a+)y`. The inner
  quantifier already provides the repetition; the outer one only creates
  backtracking paths.

- **Collapse same-character alternatives.** `(a|aa|aaa)+` becomes `a+`. When
  all alternatives are sequences of the same character, a single quantifier
  covers all of them.

Every suggested fix is verified to be safe before being returned. If no safe
fix can be generated, `fixed` is `null`.

Note: auto-fix preserves matching behavior but may change capture group
semantics. Verify the fix against your intended behavior.

## CLI

```sh
npx @rezalabs/safe-regex2 '(x+x+)+y'
```

## Options

Both `safeRegex()`, `analyze()`, and `fix()` accept an optional `limit` parameter:

```js
safe(pattern, { limit: 50 })
analyze(pattern, { limit: 50 })
fix(pattern, { limit: 50 })
```

`limit` controls the maximum number of repetitions allowed across the entire
regex. Default is `25`. Patterns exceeding this limit are flagged.

## API

```js
const safe = require('@rezalabs/safe-regex2')
```

### `safe(re, opts?)` -> `boolean`

Returns `true` if the regex is safe, `false` if it is potentially catastrophic
or syntactically invalid.

### `safe.analyze(re, opts?)` -> `object`

Returns a detailed risk assessment. See the Analyze section above.

### `safe.fix(re, opts?)` -> `object`

Returns `{ safe, fixed, original }`. See the Auto-fix section above.

## How it works

The regex pattern is parsed into an AST using `@rezalabs/ret`. The walker then
traverses the tree and checks:

1. **Star height.** Each `REPETITION` node increments the star height counter.
   When it exceeds 1, the regex has nested quantifiers and exponential
   backtracking paths.

2. **Repetition count.** The total number of `REPETITION` nodes is compared
   against the limit. Too many quantifiers in one pattern is a risk indicator.

3. **Alternation overlap.** For each quantifier containing alternatives,
   the literal prefixes of each alternative are compared. If one prefix is
   a prefix of another, the engine can partition matching input in
   combinatorially many ways.

## Limitations

This is a heuristic analyzer, not a formal verification tool. It has both
false positives (flagging safe patterns) and false negatives (missing unsafe
ones). Known gaps:

- Alternation overlap is only detected for literal character prefixes.
  Patterns like `(\\d|\\w)+` where character classes overlap are not caught.
- The auto-fix cannot safely rewrite general alternation overlap like
  `(ab|abc)+`. Such patterns require a non-regex parser.
- Some patterns with star height 2 are flagged but are actually safe in
  practice due to their structure.

## Credits

- **James Halliday** (substack) wrote the original `safe-regex` package.
- The **Fastify** team maintained it as `safe-regex2` with TypeScript types,
  modern tooling, and updated dependencies.
- **RezaLabs** added alternation-based detection, risk analysis, auto-fix,
  and continues maintenance.

## License

[MIT](./LICENSE)
