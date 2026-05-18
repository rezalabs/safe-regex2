'use strict'

const safe = require('../')
const { test } = require('node:test')

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
  /(x|xx|xxx)+/
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

// ── analyze() tests ──

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

test('analyze — alternation ReDoS', t => {
  // Patterns without static suffix → severity stays high
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

test('analyze — low severity (rep count)', t => {
  const re = RegExp(Array(27).join('a?') + Array(27).join('a'))
  const result = safe.analyze(re, { limit: 25 })
  t.assert.strictEqual(result.safe, false)
  t.assert.strictEqual(result.severity, 'low')
  t.assert.ok(result.repCount > 25, 'Expected rep count > limit')
})

test('analyze — mitigation (anchored + suffix)', t => {
  const result = safe.analyze('^(a+)+y$')
  t.assert.strictEqual(result.safe, false)
  t.assert.strictEqual(result.severity, 'low', 'High severity mitigated to low')
  t.assert.strictEqual(result.anchored, true)
  t.assert.strictEqual(result.hasStaticSuffix, true)
})

test('analyze — invalid regex', t => {
  const result = safe.analyze('[abc')
  t.assert.strictEqual(result.safe, false)
  t.assert.strictEqual(result.severity, 'high')
  t.assert.ok(result.reasons[0].includes('Invalid'))
})

// ── fix() tests ──

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
    { re: '(x|xx|xxx)+', expect: 'x+' }
  ]
  for (const { re, expect: expected } of cases) {
    const result = safe.fix(re)
    t.assert.strictEqual(result.fixed, expected, `Expected ${re} → ${expected}, got ${result.fixed}`)
    t.assert.strictEqual(safe(result.fixed), true, `Expected fixed ${result.fixed} to be safe`)
  }
})

test('fix — already safe returns null', t => {
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

test('fix — limit option', t => {
  const result = safe.fix(RegExp(Array(27).join('a?') + Array(27).join('a')), { limit: 24 })
  t.assert.strictEqual(result.fixed, null, 'Unfixable at limit 24')
})

test('fix — general prefix overlap returns null', t => {
  const cases = [
    '(ab|abc)+',
    '(12|123)+',
    '(cat|cater|caterpillar)+',
    '(?:(ab|abc))+'  // nested group requires recursive findGroupWithOptions
  ]
  for (const re of cases) {
    const result = safe.fix(re)
    t.assert.strictEqual(result.fixed, null, 'Expected ' + re + ' fixed to be null')
  }
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

test('analyze — high severity from rep count', t => {
  const result = safe.analyze('a{1,2}a{1,2}a{1,2}', { limit: 1 })
  t.assert.strictEqual(result.safe, false, 'Should be unsafe')
  t.assert.strictEqual(result.severity, 'high', 'Should be high severity from rep count')
  t.assert.strictEqual(result.starHeight, 1, 'Star height should be 1')
})
