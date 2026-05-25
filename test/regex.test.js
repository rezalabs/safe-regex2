'use strict'

const safe = require('../')
const { test } = require('node:test')

// ── safeRegex() ─────────────────────────────────────────────────────

const good = [
  /\bOakland\b/,
  /\b(Oakland|San Francisco)\b/i,
  /^\d+1337\d+$/i,
  /^\d+(1337|404)\d+$/i,
  /^\d+(1337|404)*\d+$/i,
  RegExp(Array(26).join('a?') + Array(26).join('a')),
  /(a|b|c)+/,
  /(abc|def)+/,
  /(abc|abd)+/
]

test('safe regex', t => {
  good.forEach(function (re) {
    t.assert.strictEqual(safe(re), true, `Expected ${re} to be safe`)
  })
})

const bad = [
  /^(a?){25}(a){25}$/,
  RegExp(Array(27).join('a?') + Array(27).join('a')),
  /(x+x+)+y/,
  /foo|(x+x+)+y/,
  /(a+){10}y/,
  /(a+){2}y/,
  /(.*){1,32000}[bc]/,
  /(a+|b+)+/,
  /(a|aa|aaa)+/,
  /(a|aa|aaa)+y/,
  /(ab|abc)+/,
  /(x|xx|xxx)+/,
  // SET-prefix alternation overlap (character classes, dot, shorthand sets)
  /([a-z]|[a-z][a-z])+/,
  /(.|..)+/,
  /([ab]|[ab][ab])+/,
  /([0-9]|[0-9][0-9])+/,
  /(\d|\d\d)+/,
  /([a]b|[a]bc)+/
]

test('unsafe regex', t => {
  bad.forEach(function (re) {
    t.assert.strictEqual(safe(re), false)
  })
})

test('limit option', t => {
  t.assert.strictEqual(safe(RegExp(Array(27).join('a?') + Array(27).join('a')), { limit: 50 }), true, 'Should be safe with limit of 50')
  t.assert.strictEqual(safe(RegExp(Array(27).join('a?') + Array(27).join('a')), { limit: 24 }), false, 'Should be unsafe with limit of 24')
})

test('limit option at exact boundary', t => {
  // 26 a? groups = 26 REPETITION nodes. walk rejects when reps > limit.
  const re = RegExp(Array(27).join('a?') + Array(27).join('a'))
  t.assert.strictEqual(safe(re, { limit: 26 }), true, 'Should be safe when reps equal limit')
  t.assert.strictEqual(safe(re, { limit: 25 }), false, 'Should be unsafe when reps exceed limit by 1')
})

test('limit option defaults to 25', t => {
  // Pattern with 26 reps each = 52 total, which exceeds default limit of 25
  const re = RegExp(Array(27).join('a?') + Array(27).join('a'))
  t.assert.strictEqual(safe(re), false, 'Default limit of 25 should reject 52 reps')
})

const invalid = [
  '*Oakland*',
  'hey(yoo))',
  'abcde(?>hellow)',
  '[abc',
  { toString: () => '[abc' }
]

test('invalid regex', t => {
  invalid.forEach(function (re) {
    t.assert.strictEqual(safe(re), false)
  })
})

test('safeRegex accepts RegExp objects', t => {
  t.assert.strictEqual(safe(/abc/), true, 'Literal RegExp should be safe')
  // Use a stored RegExp to verify the function works with RegExp instances
  const unsafeRegExp = bad[2] // /(x+x+)+y/
  t.assert.strictEqual(safe(unsafeRegExp), false, 'Unsafe RegExp from bad array should be unsafe')
})

test('safeRegex accepts string patterns', t => {
  t.assert.strictEqual(safe('abc'), true, 'Literal string pattern should be safe')
  t.assert.strictEqual(safe('(a+)+'), false, 'Unsafe string pattern should be unsafe')
})

test('safeRegex coerces non-string, non-RegExp to string', t => {
  t.assert.strictEqual(safe(42), true, 'Number coerced to "42" is a valid safe regex')
  t.assert.strictEqual(safe(true), true, 'Boolean coerced to "true" is a valid safe regex')
  t.assert.strictEqual(safe(null), true, 'null coerced to "null" is a valid safe regex')
  t.assert.strictEqual(safe(undefined), true, 'undefined coerced to "undefined" is a valid safe regex')
})

test('safeRegex handles empty string', t => {
  t.assert.strictEqual(safe(''), true, 'Empty string regex should be safe')
})

test('safeRegex handles single character', t => {
  t.assert.strictEqual(safe('a'), true, 'Single char should be safe')
})

// ── analyze() ────────────────────────────────────────────────────────

test('analyze — safe patterns', t => {
  const patterns = [
    '^[a-z]+$',
    '(a|b|c)+',
    '(abc|def)+',
    'a+b+'
  ]
  for (const re of patterns) {
    const result = safe.analyze(re)
    t.assert.strictEqual(result.safe, true, `Expected ${re} to be safe`)
    t.assert.strictEqual(result.severity, 'none', `Expected ${re} severity to be none`)
  }
})

test('analyze — safe patterns return no reasons', t => {
  const patterns = ['^[a-z]+$', '(a|b|c)+']
  for (const re of patterns) {
    const result = safe.analyze(re)
    t.assert.deepStrictEqual(result.reasons, [], `Expected ${re} to have no reasons`)
  }
})

test('analyze — nested repetition severity', t => {
  const cases = [
    { re: '(a+)+', severity: 'high' },
    { re: '(a+)+y', severity: 'low', note: 'static suffix y mitigates' },
    { re: '((a+)+)+', severity: 'critical' },
    { re: '(((a+)+)+)+', severity: 'critical' }
  ]
  for (const { re, severity } of cases) {
    const result = safe.analyze(re)
    t.assert.strictEqual(result.safe, false, `Expected ${re} to be unsafe`)
    t.assert.strictEqual(result.severity, severity, `Expected ${re} severity to be ${severity}`)
    t.assert.ok(result.reasons.length > 0, `Expected ${re} to have reasons`)
  }
})

test('analyze — nested repetition reports correct star height', t => {
  t.assert.strictEqual(safe.analyze('(a+)+').starHeight, 2, '(a+)+ has star height 2')
  t.assert.strictEqual(safe.analyze('((a+)+)+').starHeight, 3, '((a+)+)+ has star height 3')
  t.assert.strictEqual(safe.analyze('(((a+)+)+)+').starHeight, 4, '(((a+)+)+)+ has star height 4')
})

test('analyze — nested repetition reports reason string', t => {
  const result = safe.analyze('(a+)+')
  t.assert.ok(result.reasons[0].includes('star height 2'), 'Reason should mention star height')
})

test('analyze — alternation ReDoS', t => {
  const patterns = [
    '(a|aa|aaa)+',
    '(?:a|aa|aaa)+',
    '(?:(a|aa|aaa))+',
    '(x|xx|xxx)+'
  ]
  for (const re of patterns) {
    const result = safe.analyze(re)
    t.assert.strictEqual(result.safe, false, `Expected ${re} to be unsafe`)
    t.assert.strictEqual(result.hasAlternationReDoS, true, `Expected ${re} alternation flag`)
    t.assert.strictEqual(result.severity, 'high', `Expected ${re} severity high`)
  }
})

test('analyze — alternation ReDoS reports reason', t => {
  const result = safe.analyze('(a|aa|aaa)+')
  const hasOverlapReason = result.reasons.some(r => r.includes('verlapping'))
  t.assert.strictEqual(hasOverlapReason, true, 'Should mention overlapping prefixes in reasons')
})

test('analyze — SET-prefix alternation ReDoS', t => {
  const patterns = [
    '([a-z]|[a-z][a-z])+',
    '(.|..)+',
    '([ab]|[ab][ab])+',
    '([0-9]|[0-9][0-9])+',
    '(\\d|\\d\\d)+',
    '([a]b|[a]bc)+'
  ]
  for (const re of patterns) {
    const result = safe.analyze(re)
    t.assert.strictEqual(result.safe, false, `Expected ${re} to be unsafe`)
    t.assert.strictEqual(result.hasAlternationReDoS, true, `Expected ${re} alternation flag`)
    t.assert.strictEqual(result.severity, 'high', `Expected ${re} severity high`)
  }
})

test('analyze — disjoint SET-prefix alternation is safe', t => {
  const patterns = [
    '([a-z]|[0-9])+',
    '([a-z]|[A-Z])+'
  ]
  for (const re of patterns) {
    const result = safe.analyze(re)
    t.assert.strictEqual(result.safe, true, `Expected ${re} to be safe`)
    t.assert.strictEqual(result.hasAlternationReDoS, false, `Expected ${re} no alternation flag`)
  }
})

test('analyze — SET-prefix alternation has no auto-fix', t => {
  const patterns = [
    '([a-z]|[a-z][a-z])+',
    '(.|..)+',
    '([ab]|[ab][ab])+'
  ]
  for (const re of patterns) {
    const result = safe.analyze(re)
    t.assert.strictEqual(result.fix, null, `Expected ${re} to have no fix`)
  }
})

test('analyze — CHAR vs SET prefix overlap', t => {
  const patterns = [
    '(a|[a-z])+',
    '(a|[a-z][a-z])+'
  ]
  for (const re of patterns) {
    const result = safe.analyze(re)
    t.assert.strictEqual(result.safe, false, `Expected ${re} to be unsafe`)
    t.assert.strictEqual(result.hasAlternationReDoS, true, `Expected ${re} alternation flag`)
    t.assert.strictEqual(result.severity, 'high', `Expected ${re} severity high`)
  }
})

test('analyze — disjoint CHAR vs SET prefix', t => {
  const patterns = [
    '(A|[a-z])+',
    '(0|[a-z])+'
  ]
  for (const re of patterns) {
    const result = safe.analyze(re)
    t.assert.strictEqual(result.safe, true, `Expected ${re} to be safe`)
    t.assert.strictEqual(result.hasAlternationReDoS, false, `Expected ${re} no alternation flag`)
  }
})

test('analyze — SET with mixed CHAR and RANGE entries', t => {
  const result = safe.analyze('([ab]|[a-z])+')
  t.assert.strictEqual(result.safe, false, 'Expected ([ab]|[a-z])+ to be unsafe')
  t.assert.strictEqual(result.hasAlternationReDoS, true, 'Expected alternation flag')
  t.assert.strictEqual(result.severity, 'high', 'Expected severity high')
})

test('analyze — negated SET prefix overlap', t => {
  const result = safe.analyze('([^a-z]|[0-9])+')
  t.assert.strictEqual(result.safe, false, 'Expected ([^a-z]|[0-9])+ to be unsafe')
  t.assert.strictEqual(result.hasAlternationReDoS, true, 'Expected alternation flag')
  t.assert.strictEqual(result.severity, 'high', 'Expected severity high')
})

test('analyze — negated SET disjoint from positive SET', t => {
  const result = safe.analyze('([^a-z]|[a-z])+')
  t.assert.strictEqual(result.safe, true, 'Expected ([^a-z]|[a-z])+ to be safe')
  t.assert.strictEqual(result.hasAlternationReDoS, false, 'Expected no alternation flag')
})

test('analyze — negated SET overlap via CHAR entry', t => {
  const result = safe.analyze('([^a-z]|[0])+')
  t.assert.strictEqual(result.safe, false, 'Expected ([^a-z]|[0])+ to be unsafe')
  t.assert.strictEqual(result.hasAlternationReDoS, true, 'Expected alternation flag')
  t.assert.strictEqual(result.severity, 'high', 'Expected severity high')
})

test('analyze — low severity (rep count)', t => {
  const re = RegExp(Array(27).join('a?') + Array(27).join('a'))
  const result = safe.analyze(re, { limit: 25 })
  t.assert.strictEqual(result.safe, false)
  t.assert.strictEqual(result.severity, 'low')
  t.assert.ok(result.repCount > 25, 'Expected rep count > limit')
})

test('analyze — high severity from rep count', t => {
  const result = safe.analyze('a{1,2}a{1,2}a{1,2}', { limit: 1 })
  t.assert.strictEqual(result.safe, false, 'Should be unsafe')
  t.assert.strictEqual(result.severity, 'high', 'Should be high severity from rep count')
  t.assert.strictEqual(result.starHeight, 1, 'Star height should be 1')
})

test('analyze — mitigation (anchored + suffix)', t => {
  const result = safe.analyze('^(a+)+y$')
  t.assert.strictEqual(result.safe, false)
  t.assert.strictEqual(result.severity, 'low', 'High severity mitigated to low')
  t.assert.strictEqual(result.anchored, true)
  t.assert.strictEqual(result.hasStaticSuffix, true)
})

test('analyze — anchored detection', t => {
  t.assert.strictEqual(safe.analyze('^a$').anchored, true, '^a$ is anchored')
  t.assert.strictEqual(safe.analyze('^a').anchored, false, '^a is not fully anchored')
  t.assert.strictEqual(safe.analyze('a$').anchored, false, 'a$ is not fully anchored')
  t.assert.strictEqual(safe.analyze('a').anchored, false, 'a is not anchored')
  t.assert.strictEqual(safe.analyze('^$').anchored, true, '^$ is anchored')
})

test('analyze — static suffix detection', t => {
  // detectStaticSuffix only checks the root node's top-level stack for a
  // trailing CHAR or SET (skipping POSITION nodes). A bare 'a+' is a
  // REPETITION wrapping a CHAR — the REPETITION itself is not a literal.
  t.assert.strictEqual(safe.analyze('a+').hasStaticSuffix, false, 'a+ is a bare REPETITION, not a trailing literal')
  t.assert.strictEqual(safe.analyze('(a+)+').hasStaticSuffix, false, '(a+)+ has no static suffix')
  t.assert.strictEqual(safe.analyze('(a+)+y').hasStaticSuffix, true, '(a+)+y has static suffix y')
  t.assert.strictEqual(safe.analyze('^(a+)+y$').hasStaticSuffix, true, '^(a+)+y$ has static suffix (y before $)')
  t.assert.strictEqual(safe.analyze('^$').hasStaticSuffix, false, '^$ has no static suffix')
  // [a-z]+ is a REPETITION wrapping a SET at root level — not a trailing literal
  t.assert.strictEqual(safe.analyze('[a-z]+').hasStaticSuffix, false, '[a-z]+ is a bare REPETITION, not a trailing literal')
  // A trailing literal char after a REPETITION does give a static suffix
  t.assert.strictEqual(safe.analyze('a+b').hasStaticSuffix, true, 'a+b ends with literal char b')
  // But ^[a-z]+$ does NOT have a static suffix — the [a-z]+ is a REPETITION
  // wrapping a SET, not a bare SET at the end of the stack
  t.assert.strictEqual(safe.analyze('^[a-z]+$').hasStaticSuffix, false, '^[a-z]+$ has no bare trailing literal')
  // A bare SET at end of stack is detected
  t.assert.strictEqual(safe.analyze('a[b-z]').hasStaticSuffix, true, 'a[b-z] ends with SET')
})

test('analyze — critical severity is not mitigated by anchoring', t => {
  const result = safe.analyze('^((a+)+)+y$')
  t.assert.strictEqual(result.severity, 'critical', 'Critical severity should not be mitigated')
  t.assert.strictEqual(result.anchored, true)
  t.assert.strictEqual(result.hasStaticSuffix, true)
})

test('analyze — invalid regex', t => {
  const result = safe.analyze('[abc')
  t.assert.strictEqual(result.safe, false)
  t.assert.strictEqual(result.severity, 'high')
  t.assert.ok(result.reasons[0].includes('Invalid'))
})

test('analyze — invalid regex sets diagnostic defaults', t => {
  const result = safe.analyze('[abc')
  t.assert.strictEqual(result.starHeight, 0, 'Star height should be 0 for invalid regex')
  t.assert.strictEqual(result.repCount, 0, 'Rep count should be 0 for invalid regex')
  t.assert.strictEqual(result.hasAlternationReDoS, false, 'No alternation detected for invalid regex')
  t.assert.strictEqual(result.anchored, false, 'No anchoring for invalid regex')
  t.assert.strictEqual(result.hasStaticSuffix, false, 'No suffix for invalid regex')
  t.assert.strictEqual(result.fix, null, 'No fix for invalid regex')
})

test('analyze — coerces non-string, non-RegExp input', t => {
  const result = safe.analyze(42)
  t.assert.strictEqual(result.safe, true, 'Number 42 coerced to string is safe')
  t.assert.strictEqual(result.severity, 'none')
})

test('analyze — returns fix suggestion for fixable unsafe patterns', t => {
  const result = safe.analyze('(a+)+')
  t.assert.strictEqual(result.safe, false)
  t.assert.strictEqual(result.fix, '(a+)', 'Should suggest fix')
})

test('analyze — returns null fix for unfixable patterns', t => {
  const result = safe.analyze('(ab|abc)+')
  t.assert.strictEqual(result.fix, null, 'General prefix overlap is not auto-fixable')
})

test('analyze — accepts RegExp input', t => {
  const result = safe.analyze(/(a+)+/)
  t.assert.strictEqual(result.safe, false, 'RegExp input should work')
  t.assert.strictEqual(result.fix, '(a+)', 'Should suggest fix for RegExp input')
})

test('analyze — general prefix overlap', t => {
  const cases = [
    '(ab|abc)+',
    '(12|123)+',
    '(?:(ab|abc))+'
  ]
  for (const re of cases) {
    const result = safe.analyze(re)
    t.assert.strictEqual(result.hasAlternationReDoS, true, re + ' should detect alternation overlap')
    t.assert.strictEqual(result.severity, 'high', re + ' should be high severity')
    t.assert.strictEqual(result.fix, null, re + ' should have no fix')
  }
})

test('analyze — empty string pattern', t => {
  const result = safe.analyze('')
  t.assert.strictEqual(result.safe, true, 'Empty string should be safe')
  t.assert.strictEqual(result.severity, 'none')
  t.assert.strictEqual(result.repCount, 0)
  t.assert.strictEqual(result.starHeight, 0)
})

// ── fix() ────────────────────────────────────────────────────────────

test('fix — nested repetition', t => {
  const cases = [
    { re: '(a+)+', expect: '(a+)' },
    { re: '(a+)+y', expect: '(a+)y' },
    { re: '(x+x+)+y', expect: '(x+x+)y' },
    { re: '(a+){10}y', expect: '(a+)y' },
    { re: '(.*){1,32000}[bc]', expect: '(.*)[bc]' },
    { re: '(a+|b+)+', expect: '(a+|b+)' },
    { re: 'foo|(x+x+)+y', expect: 'foo|(x+x+)y' }
  ]
  for (const { re, expect: expected } of cases) {
    const result = safe.fix(re)
    t.assert.strictEqual(result.fixed, expected, `Expected ${re} → ${expected}, got ${result.fixed}`)
    t.assert.strictEqual(safe(result.fixed), true, `Expected fixed ${result.fixed} to be safe`)
  }
})

test('fix — alternation overlap', t => {
  const cases = [
    { re: '(a|aa|aaa)+', expect: 'a+' },
    { re: '(a|aa|aaa)+y', expect: 'a+y' },
    { re: '(?:a|aa|aaa)+', expect: 'a+' },
    { re: '(?:(a|aa|aaa))+', expect: 'a+' },
    { re: '(x|xx|xxx)+', expect: 'x+' },
    { re: '(?:a(?:(a|aa|aaa)))+', expect: 'a+' }
  ]
  for (const { re, expect: expected } of cases) {
    const result = safe.fix(re)
    t.assert.strictEqual(result.fixed, expected, `Expected ${re} → ${expected}, got ${result.fixed}`)
    t.assert.strictEqual(safe(result.fixed), true, `Expected fixed ${result.fixed} to be safe`)
  }
})

test('fix — already safe returns null fixed', t => {
  const cases = [
    '^[a-z]+$',
    '(a|b|c)+',
    '(abc|def)+',
    'a+b+'
  ]
  for (const re of cases) {
    const result = safe.fix(re)
    t.assert.strictEqual(result.safe, true, `Expected ${re} to be safe`)
    t.assert.strictEqual(result.fixed, null, `Expected ${re} fixed to be null`)
  }
})

test('fix — already safe preserves original', t => {
  const result = safe.fix('[a-z]+')
  t.assert.strictEqual(result.original, '[a-z]+', 'Original should be preserved')
})

test('fix — invalid/unfixable returns null', t => {
  const cases = [
    '*Oakland*',
    '[abc',
    'abcde(?>hellow)'
  ]
  for (const re of cases) {
    const result = safe.fix(re)
    t.assert.strictEqual(result.fixed, null, `Expected ${re} fixed to be null`)
  }
})

test('fix — invalid regex sets safe to false', t => {
  const result = safe.fix('[abc')
  t.assert.strictEqual(result.safe, false, 'Invalid regex should report safe: false')
  t.assert.strictEqual(result.original, '[abc', 'Original should be preserved')
})

test('fix — limit option', t => {
  const result = safe.fix(RegExp(Array(27).join('a?') + Array(27).join('a')), { limit: 24 })
  t.assert.strictEqual(result.fixed, null, 'Unfixable at limit 24')
})

test('fix — general prefix overlap returns null', t => {
  const cases = [
    '(ab|abc)+',
    '(12|123)+',
    '(cat|cater|caterpillar)+',
    '(?:(ab|abc))+'
  ]
  for (const re of cases) {
    const result = safe.fix(re)
    t.assert.strictEqual(result.fixed, null, 'Expected ' + re + ' fixed to be null')
  }
})

test('fix — accepts RegExp input', t => {
  const result = safe.fix(/(a+)+/)
  t.assert.strictEqual(result.safe, false)
  t.assert.strictEqual(result.fixed, '(a+)', 'Should fix RegExp input')
  t.assert.strictEqual(result.original, '(a+)+', 'Original should be RegExp source')
})

test('fix — coerces non-string, non-RegExp input', t => {
  const result = safe.fix(42)
  t.assert.strictEqual(result.safe, true, 'Number coerced to string is safe')
  t.assert.strictEqual(result.fixed, null, 'No fix needed for safe input')
  t.assert.strictEqual(result.original, '42', 'Original should be coerced string')
})

test('fix — coerces {toString} object', t => {
  const result = safe.fix({ toString: () => '[abc' })
  t.assert.strictEqual(result.safe, false, 'Invalid regex from toString')
  t.assert.strictEqual(result.fixed, null, 'Unfixable')
  t.assert.strictEqual(result.original, '[abc', 'Original from toString')
})

test('fix — semanticChange is true when fix is produced', t => {
  const cases = ['(a+)+', '(a|aa|aaa)+', '(x+x+)+y']
  for (const re of cases) {
    const result = safe.fix(re)
    t.assert.strictEqual(result.semanticChange, true, `Expected ${re} to have semanticChange: true`)
  }
})

test('fix — semanticChange is false for already safe input', t => {
  const result = safe.fix('[a-z]+')
  t.assert.strictEqual(result.semanticChange, false, 'Safe input should have semanticChange: false')
})

test('fix — semanticChange is false for invalid input', t => {
  const result = safe.fix('[abc')
  t.assert.strictEqual(result.semanticChange, false, 'Invalid input should have semanticChange: false')
})

// ── export structure ─────────────────────────────────────────────────

test('exports — safeRegex is the default export', t => {
  t.assert.strictEqual(safe, safe.safeRegex, 'safeRegex should be same function as default')
  t.assert.strictEqual(safe, safe.default, 'default should be same function as default')
})

test('exports — fix and analyze are exposed', t => {
  t.assert.strictEqual(typeof safe.fix, 'function', 'fix should be a function')
  t.assert.strictEqual(typeof safe.analyze, 'function', 'analyze should be a function')
})
