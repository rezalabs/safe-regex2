'use strict'

const parse = require('@rezalabs/ret')
const { types } = require('@rezalabs/ret')
const { reconstruct } = require('@rezalabs/ret')

/**
 * Extracts the leading literal character code points from a token stack.
 * Stops at the first non-CHAR token (e.g., SET, GROUP, REPETITION).
 * Used by fixAlternationReDoS to collect chars for same-char detection.
 *
 * @param {Array} stack - Array of AST tokens forming one alternative
 * @returns {number[]} Array of character code points
 */
function getLiteralPrefix (stack) {
  const chars = []
  for (let i = 0; i < stack.length; i++) {
    if (stack[i].type === types.CHAR) {
      chars.push(stack[i].value)
    } else {
      break
    }
  }
  return chars
}

/**
 * Extracts the leading leaf tokens (CHAR and SET nodes) from a token stack.
 * Stops at the first non-leaf token (GROUP, REPETITION, POSITION, etc.).
 * Generalizes getLiteralPrefix to include character classes and predefined sets.
 *
 * @param {Array} stack - Array of AST tokens forming one alternative
 * @returns {Array} Array of CHAR or SET AST nodes
 */
function getPrefixTokens (stack) {
  const tokens = []
  for (let i = 0; i < stack.length; i++) {
    const node = stack[i]
    if (node.type === types.CHAR || node.type === types.SET) {
      tokens.push(node)
    } else {
      break
    }
  }
  return tokens
}

/**
 * Checks whether a code point matches any entry in a SET node's internal
 * set array. Each entry is either a CHAR (exact code point) or RANGE
 * (inclusive interval).
 *
 * @param {number} codePoint - Unicode code point to test
 * @param {Array} entries - Array of CHAR or RANGE tokens from a SET node
 * @returns {boolean} true if codePoint matches any entry
 */
function codeInSetEntries (codePoint, entries) {
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]
    if (entry.type === types.CHAR && entry.value === codePoint) return true
    if (entry.type === types.RANGE && codePoint >= entry.from && codePoint <= entry.to) return true
  }
  return false
}

/**
 * Checks whether a code point is matched by a SET node, considering negation.
 *
 * @param {number} codePoint - Unicode code point to test
 * @param {object} setNode - SET AST node with set[] and not properties
 * @returns {boolean} true if the SET node matches this code point
 */
function codeMatchesSet (codePoint, setNode) {
  const inEntries = codeInSetEntries(codePoint, setNode.set)
  return setNode.not ? !inEntries : inEntries
}

/**
 * Checks whether two SET entry tokens (CHAR or RANGE) have overlapping
 * character ranges.
 *
 * @param {object} a - CHAR or RANGE token
 * @param {object} b - CHAR or RANGE token
 * @returns {boolean} true if the entries share at least one code point
 */
function setEntriesOverlap (a, b) {
  if (a.type === types.RANGE && b.type === types.RANGE) {
    return a.from <= b.to && b.from <= a.to
  }
  if (a.type === types.CHAR && b.type === types.CHAR) {
    return a.value === b.value
  }
  // CHAR vs RANGE
  const charVal = a.type === types.CHAR ? a.value : b.value
  const range = a.type === types.RANGE ? a : b
  return charVal >= range.from && charVal <= range.to
}

/**
 * Checks whether two SET nodes can match at least one common character.
 *
 * For two non-negated sets, checks pairwise overlap between their entries.
 * For two negated sets, always returns true (complements share characters).
 * For mixed negation, checks whether the positive set contains any character
 * not excluded by the negated set.
 *
 * @param {object} a - SET AST node
 * @param {object} b - SET AST node
 * @returns {boolean} true if there exists at least one character matched by both
 */
function setsOverlap (a, b) {
  // Both negated: complements of finite sets always share characters
  if (a.not && b.not) return true

  // One negated, one not
  if (a.not !== b.not) {
    const positive = a.not ? b : a
    const negative = a.not ? a : b
    // Check if the positive set has any char not in the negated set's exclusion list
    for (let i = 0; i < positive.set.length; i++) {
      const entry = positive.set[i]
      if (entry.type === types.CHAR) {
        if (!codeInSetEntries(entry.value, negative.set)) return true
      } else if (entry.type === types.RANGE) {
        // If the range's start is not excluded, there is overlap
        if (!codeInSetEntries(entry.from, negative.set)) return true
        // Also check the end of the range
        if (entry.from !== entry.to && !codeInSetEntries(entry.to, negative.set)) return true
      }
    }
    return false
  }

  // Both non-negated: check pairwise overlap between entries
  for (let i = 0; i < a.set.length; i++) {
    for (let j = 0; j < b.set.length; j++) {
      if (setEntriesOverlap(a.set[i], b.set[j])) return true
    }
  }
  return false
}

/**
 * Checks whether two AST tokens (CHAR or SET) can match at least one
 * common character. This is the foundation of the generalized prefix-overlap
 * detection: two alternatives cause ReDoS when their leading tokens can match
 * the same character and one is a prefix of the other.
 *
 * @param {object} a - CHAR or SET AST node
 * @param {object} b - CHAR or SET AST node
 * @returns {boolean} true if both tokens can match the same character
 */
function tokensOverlap (a, b) {
  if (a.type === types.CHAR && b.type === types.CHAR) return a.value === b.value
  if (a.type === types.CHAR && b.type === types.SET) return codeMatchesSet(a.value, b)
  if (a.type === types.SET && b.type === types.CHAR) return codeMatchesSet(b.value, a)
  if (a.type === types.SET && b.type === types.SET) return setsOverlap(a, b)
  return false
}

/**
 * Checks whether alternatives inside a quantifier have overlapping prefixes,
 * which causes catastrophic backtracking.
 *
 * When one alternative's prefix matches the same characters as the start of
 * another (e.g., `a` vs `aa`, `[a-z]` vs `[a-z][a-z]`, `\d` vs `\d\d`),
 * the regex engine can partition the same input in exponentially many ways.
 *
 * Detects overlap for literal characters (CHAR), character classes (SET),
 * predefined shorthand sets (`\d`, `\w`, `\s`), and the dot metacharacter.
 *
 * @param {Array} options - Array of alternative token stacks
 * @returns {boolean} true if any pair has a prefix-overlap problem
 */
function hasAlternationReDoS (options) {
  if (!Array.isArray(options) || options.length < 2) return false

  const prefixes = options.map(function (opt) {
    return getPrefixTokens(opt)
  }).filter(function (p) {
    return p.length > 0
  })

  // Need at least two alternatives with prefix tokens to have overlap
  if (prefixes.length < 2) return false

  for (let i = 0; i < prefixes.length; i++) {
    for (let j = i + 1; j < prefixes.length; j++) {
      const a = prefixes[i]
      const b = prefixes[j]

      const shorter = a.length <= b.length ? a : b
      const longer = a.length <= b.length ? b : a

      let prefixMatch = true
      for (let k = 0; k < shorter.length; k++) {
        if (!tokensOverlap(shorter[k], longer[k])) {
          prefixMatch = false
          break
        }
      }

      if (prefixMatch) return true
    }
  }

  return false
}

/**
 * Recursively searches a subtree for alternatives with overlapping literal
 * prefixes. Used to detect alternation-based ReDoS that may be nested
 * inside groups within a quantifier (e.g., `(?:(a|aa|aaa))+` where the
 * alternatives are one level deeper than the REPETITION node).
 *
 * @param {*} node - AST node to search
 * @returns {boolean} true if overlapping alternatives are found
 */
function findOverlappingAlternatives (node) {
  if (!node || typeof node !== 'object') return false

  // If this node has alternatives (options), check for prefix overlap
  if (node.options && hasAlternationReDoS(node.options)) return true

  // Recurse into linear children (stack)
  if (node.stack) {
    for (let i = 0; i < node.stack.length; i++) {
      if (findOverlappingAlternatives(node.stack[i])) return true
    }
  }

  // Recurse into value (REPETITION's inner node, or any other value child)
  if (node.value) {
    if (findOverlappingAlternatives(node.value)) return true
  }

  return false
}

/**
 * Recursively traverses the parsed regex AST, tracking repetition nesting depth
 * and detecting alternation-based catastrophic backtracking.
 *
 * Detects two classes of ReDoS vulnerability:
 * 1. Nested repetition (star height > 1) — e.g., (a+)+, (x+x+)+y
 * 2. Alternation prefix overlap — e.g., (a|aa|aaa)+, where one alternative
 *    is a literal prefix of another, causing O(2^n) partitioning paths
 *
 * @param {*} node - Current node in the regex AST
 * @param {object} opts - Accumulator and limit configuration
 * @param {number} opts.reps - Count of repetition nodes visited so far in traversal
 * @param {number} opts.limit - Maximum allowed repetitions across the entire regex
 * @param {number} starHeight - Current nesting depth of repetition operators in the AST
 * @returns {boolean} true if the regex subtree is safe, false if catastrophic
 */
function walk (node, opts, starHeight) {
  let i
  let ok
  let len

  if (node.type === types.REPETITION) {
    starHeight++
    opts.reps++

    // Star height > 1 indicates nested repetition (e.g., (a+)+), which creates
    // exponential backtracking paths — a hallmark of catastrophic regexes
    if (starHeight > 1) return false
    if (opts.reps > opts.limit) return false

    // Check for alternation-based ReDoS: alternatives inside this quantifier
    // where one literal prefix is a prefix of another (e.g., (a|aa|aaa)+)
    // Recursively searches through the value subtree for nested alternatives
    if (findOverlappingAlternatives(node.value)) return false
  }

  const options = node.options || node.value?.options
  if (options) {
    for (i = 0, len = options.length; i < len; i++) {
      ok = walk({ stack: options[i] }, opts, starHeight)
      if (!ok) return false
    }
  }
  const stack = node.stack || node.value?.stack
  if (!stack) return true

  for (i = 0, len = stack.length; i < len; i++) {
    ok = walk(stack[i], opts, starHeight)
    if (!ok) return false
  }

  return true
}

/**
 * Checks whether a regular expression is safe from catastrophic backtracking
 * by parsing it and walking the AST for excessive repetition nesting.
 *
 * @param {string|RegExp} re - Regular expression to validate, as a string or RegExp instance
 * @param {object} [options]
 * @param {number} [options.limit=25] - Maximum number of repetitions allowed across the regex
 * @returns {boolean} true if the regex is safe, false if catastrophic or invalid
 */
function safeRegex (re, options) {
  const opts = {
    reps: 0,
    limit: options?.limit ?? 25
  }

  if (isRegExp(re)) re = re.source
  else if (typeof re !== 'string') re = String(re)

  try {
    return walk(parse(re), opts, 0)
  } catch {
    return false
  }
}

/**
 * Cross-realm-safe check for whether a value is a RegExp instance.
 * Uses Object.prototype.toString instead of instanceof to work across
 * different JavaScript realms (e.g., iframes, vm contexts).
 *
 * @param {*} x - Value to check
 * @returns {x is RegExp} true if x is a RegExp object
 */
function isRegExp (x) {
  return Object.prototype.toString.call(x) === '[object RegExp]'
}

// ── Auto-fix ────────────────────────────────────────────────────────

/**
 * Attempts to produce a safe version of an unsafe regex by modifying the
 * parsed AST and reconstructing the pattern string.
 *
 * Current fix strategies:
 * 1. Strip redundant outer quantifiers — (a+)+ → a+, (x+x+)+y → (x+x+)y
 * 2. Replace overlapping alternatives with canonical covering — (a|aa|aaa)+ → a+
 *
 * @param {string|RegExp} re - Regular expression to fix
 * @param {object} [options]
 * @param {number} [options.limit=25] - Repetition limit (passed to walk)
 * @returns {{ safe: boolean, fixed: string|null, original: string, semanticChange: boolean }}
 *     Returns { safe: true, fixed: null, semanticChange: false } if already safe.
 *     Returns { safe: false, fixed: '...', semanticChange: true|false } with a suggested fix.
 *     Returns { safe: false, fixed: null, semanticChange: false } if cannot auto-fix.
 *     semanticChange is true when the fixed regex may not match the same set of strings.
 */
function fixRegex (re, options) {
  const limit = options?.limit ?? 25

  let source
  if (isRegExp(re)) source = re.source
  else if (typeof re !== 'string') source = String(re)
  else source = re

  let ast
  try {
    ast = parse(source)
  } catch {
    return { safe: false, fixed: null, original: source, semanticChange: false }
  }

  // Check if already safe
  if (walk(ast, { reps: 0, limit }, 0)) {
    return { safe: true, fixed: null, original: source, semanticChange: false }
  }

  // Try to fix: clone the AST and apply transforms
  const fixedAst = fixNode(ast, limit)

  let fixed
  try {
    fixed = reconstruct(fixedAst)
  } catch {
    return { safe: false, fixed: null, original: source, semanticChange: false }
  }

  // Verify the fix is actually safe
  const stillUnsafe = !walk(parse(fixed), { reps: 0, limit }, 0)
  if (stillUnsafe) {
    return { safe: false, fixed: null, original: source, semanticChange: false }
  }

  return { safe: false, fixed, original: source, semanticChange: true }
}

/**
 * Checks whether a node's subtree contains a REPETITION that would
 * cause starHeight > maxDepth, indicating nested repetition ReDoS.
 *
 * @param {*} node - AST node to check
 * @param {number} depth - Current star height depth
 * @param {number} maxDepth - Maximum allowed star height (typically 1)
 * @returns {boolean} true if any descendant exceeds maxDepth
 */
function hasDeepRepetition (node, depth, maxDepth) {
  if (!node || typeof node !== 'object') return false

  if (node.type === types.REPETITION) {
    depth++
    if (depth > maxDepth) return true
  }

  // Check options (alternatives)
  const options = node.options || node.value?.options
  if (options) {
    for (let i = 0; i < options.length; i++) {
      if (hasDeepRepetition({ stack: options[i] }, depth, maxDepth)) return true
    }
  }

  // Check stack (linear children)
  const stack = node.stack || node.value?.stack
  if (stack) {
    for (let i = 0; i < stack.length; i++) {
      if (hasDeepRepetition(stack[i], depth, maxDepth)) return true
    }
  }

  return false
}

/**
 * Attempts to transform a (sub)tree to eliminate ReDoS vulnerabilities.
 * Works top-down: if a REPETITION's descendants would exceed star height,
 * the outer REPETITION is stripped instead of inner quantifiers.
 *
 * @param {*} node - AST node to fix
 * @param {number} limit - Repetition limit
 * @returns {*|null} Fixed node, or null if unfixable
 */
function fixNode (node, limit) {
  if (!node || typeof node !== 'object') return node

  if (node.type === types.REPETITION) {
    // Strategy 1: Strip outer quantifier if descendants have nested repetition.
    // Top-down check: if any descendant causes starHeight > 1, remove THIS
    // quantifier rather than inner ones (which preserves semantics better).
    if (hasDeepRepetition(node.value, 1, 1)) {
      const inner = node.value
      if (!inner) return null
      // Return the inner value as-is. Inner quantifiers preserved.
      return fixNode(inner, limit)
    }

    // Strategy 2: Fix alternation prefix overlap inside this quantifier
    if (findOverlappingAlternatives(node.value)) {
      return fixAlternationReDoS(node, limit)
    }
  }

  // Recursively fix children (preserve current structure, just clean children)
  const result = { ...node }

  if (result.options) {
    result.options = result.options.map(function (opt) {
      return fixNode({ stack: opt }, limit)
    }).map(function (n) {
      return n.stack || []
    })
  }

  if (result.stack) {
    result.stack = result.stack.map(function (child) {
      return fixNode(child, limit)
    })
  }

  if (result.value) {
    result.value = fixNode(result.value, limit)
  }

  return result
}

/**
 * Finds the first GROUP node with alternatives (options) in a subtree.
 * Used to locate overlapping alternatives nested inside other groups.
 *
 * @param {*} node - AST node to search
 * @returns {{ group: object, options: Array }|null}
 */
function findGroupWithOptions (node) {
  if (!node || typeof node !== 'object') return null
  if (node.options && node.options.length >= 2) {
    return { group: node, options: node.options }
  }
  const stack = node.stack || node.value?.stack
  if (stack) {
    for (let i = 0; i < stack.length; i++) {
      const found = findGroupWithOptions(stack[i])
      if (found) return found
    }
  }
  return null
}

/**
 * Fixes alternation-based ReDoS inside a quantifier by replacing
 * overlapping alternatives with a canonical covering pattern.
 *
 * For (a|aa|aaa)+ — all alternatives are sequences of the same char,
 * so the fix is just char+ (e.g., a+).
 *
 * @param {*} repNode - The REPETITION node containing alternation
 * @param {number} limit - Repetition limit
 * @returns {*|null} Fixed AST node, or null if unfixable
 */
function fixAlternationReDoS (repNode, limit) {
  const found = findGroupWithOptions(repNode.value)
  if (!found) return null

  const { options } = found

  // Collect all literal chars from all alternatives
  let allSameChar = true
  let firstChar = null

  for (let i = 0; i < options.length; i++) {
    const opt = options[i]
    const prefix = getLiteralPrefix(opt)
    for (let j = 0; j < prefix.length; j++) {
      if (firstChar === null) firstChar = prefix[j]
      if (prefix[j] !== firstChar) allSameChar = false
    }
  }

  // If all alternatives are sequences of the same character, replace with char+
  if (allSameChar && firstChar !== null) {
    const newRep = {
      type: types.REPETITION,
      min: repNode.min,
      max: repNode.max === null ? Infinity : repNode.max,
      value: { type: types.CHAR, value: firstChar }
    }
    return newRep
  }

  // General prefix overlap (e.g., ab|abc) cannot be safely rewritten as a
  // regex. Optional groups like (?:ab(?:c)?)+ still create the same
  // exponential partitioning paths. These patterns require a non-regex
  // parser or a fundamentally different approach.
  return null
}

/**
 * Checks whether a pattern's AST ends with one or more literal characters,
 * possibly preceded by anchor positions ($). A static suffix constrains
 * backtracking because the engine must match those exact characters at the end.
 *
 * E.g., `(a+)+y` has static suffix 'y'; `(a+)+y$` also has suffix 'y'.
 *
 * @param {*} node - Root AST node
 * @returns {boolean}
 */
function detectStaticSuffix (node) {
  const stack = node.stack || node.value?.stack
  if (!stack || stack.length === 0) return false

  // Walk backwards from the end, skipping anchor positions
  for (let i = stack.length - 1; i >= 0; i--) {
    const child = stack[i]
    if (child.type === types.POSITION) continue // skip $ ^ \b \B
    if (child.type === types.CHAR || child.type === types.SET) return true
    break
  }
  return false
}

/**
 * Checks whether a pattern is anchored (starts with ^ and ends with $).
 *
 * @param {*} node - Root AST node
 * @returns {boolean}
 */
function detectAnchored (node) {
  const stack = node.stack || node.value?.stack
  if (!stack || stack.length === 0) return false

  let start = false
  let end = false

  if (stack[0].type === types.POSITION && stack[0].value === '^') start = true
  const last = stack[stack.length - 1]
  if (last.type === types.POSITION && last.value === '$') end = true

  return start && end
}

// ── Analyze / risk scoring ───────────────────────────────────────────

/**
 * Maps diagnostic data to a severity level.
 *
 * Severity levels:
 * - none:     No issues detected
 * - low:      Minor issues (e.g., many repetitions but no nesting)
 * - high:     Significant risk (nested repetition or alternation overlap)
 * - critical: Extreme risk (deeply nested repetition, multiple factors)
 *
 * Mitigating factors (anchoring, static suffix) reduce severity by one level.
 *
 * @param {object} info - Diagnostic information from walkAnalyze
 * @returns {string} Severity level
 */
function assessSeverity (info) {
  const { starHeight, repCount, limit, hasAlternation, anchored, hasStaticSuffix } = info

  let severity = 'none'
  let canMitigate = false

  // Determine base severity from issues found
  if (starHeight >= 3) {
    severity = 'critical'
  } else if (starHeight >= 2) {
    severity = 'high'
    canMitigate = true
  } else if (hasAlternation) {
    severity = 'high'
    canMitigate = true
  } else if (repCount > limit * 2) {
    severity = 'high'
  } else if (repCount > limit) {
    severity = 'low'
  }

  // Mitigating factors (anchoring, static suffix) only reduce severity
  // for structural ReDoS (nested rep, alternation), not rep-count issues
  if (canMitigate && severity !== 'critical') {
    const mitigations = (anchored ? 1 : 0) + (hasStaticSuffix ? 1 : 0)
    if (mitigations >= 1) {
      if (severity === 'high') severity = 'low'
    }
  }

  return severity
}

/**
 * Walks the AST collecting diagnostics for severity assessment.
 * Unlike walk() which short-circuits on first problem, this function
 * continues traversal to collect full diagnostic data.
 *
 * @param {*} node - Current AST node
 * @param {object} info - Diagnostic accumulator
 * @param {number} info.starHeight - Current repetition nesting depth
 * @param {number} info.maxStarHeight - Maximum star height seen
 * @param {number} info.repCount - Total repetition count
 * @param {number} info.limit - Repetition limit
 */
function walkAnalyze (node, info) {
  if (!node || typeof node !== 'object') return

  if (node.type === types.REPETITION) {
    info.starHeight++
    if (info.starHeight > info.maxStarHeight) {
      info.maxStarHeight = info.starHeight
    }
    info.repCount++
    walkAnalyze(node.value, info)
    info.starHeight--
    return
  }

  // Check options (alternatives)
  const options = node.options || node.value?.options
  if (options) {
    for (let i = 0; i < options.length; i++) {
      walkAnalyze({ stack: options[i] }, info)
    }
  }

  // Check stack (linear children)
  const stack = node.stack || node.value?.stack
  if (stack) {
    for (let i = 0; i < stack.length; i++) {
      walkAnalyze(stack[i], info)
    }
  }
}

/**
 * Analyzes a regular expression and returns a detailed risk assessment
 * including severity level, diagnostic data, and suggested fix.
 *
 * @param {string|RegExp} re - Regular expression to analyze
 * @param {object} [options]
 * @param {number} [options.limit=25] - Maximum repetitions allowed
 * @returns {{
 *   safe: boolean,
 *   severity: string,
 *   reasons: string[],
 *   starHeight: number,
 *   repCount: number,
 *   hasAlternationReDoS: boolean,
 *   anchored: boolean,
 *   hasStaticSuffix: boolean,
 *   fix: string|null
 * }}
 */
function analyze (re, options) {
  const limit = options?.limit ?? 25

  let source
  if (isRegExp(re)) source = re.source
  else if (typeof re !== 'string') source = String(re)
  else source = re

  let ast
  try {
    ast = parse(source)
  } catch (err) {
    return {
      safe: false,
      severity: 'high',
      reasons: ['Invalid regex syntax: ' + err.message],
      starHeight: 0,
      repCount: 0,
      hasAlternationReDoS: false,
      anchored: false,
      hasStaticSuffix: false,
      fix: null
    }
  }

  // Collect diagnostics
  const info = {
    starHeight: 0,
    maxStarHeight: 0,
    repCount: 0,
    limit
  }

  walkAnalyze(ast, info)

  // Check alternation ReDoS separately (uses existing functions)
  const hasAlternation = findOverlappingAlternatives(ast)

  // Check anchoring and suffix directly on the AST
  const anchored = detectAnchored(ast)
  const hasStaticSuffix = detectStaticSuffix(ast)

  // Build severity
  const severity = assessSeverity({
    starHeight: info.maxStarHeight,
    repCount: info.repCount,
    limit,
    hasAlternation,
    anchored,
    hasStaticSuffix
  })

  // Build reasons
  const reasons = []
  if (info.maxStarHeight >= 2) {
    reasons.push('Nested repetition detected (star height ' + info.maxStarHeight + ')')
  }
  if (hasAlternation) {
    reasons.push('Alternatives with overlapping prefixes inside quantifier')
  }
  if (info.repCount > limit) {
    reasons.push('Exceeded repetition limit: ' + info.repCount + ' > ' + limit)
  }

  const safe = severity === 'none'

  // Try to fix if unsafe
  let fix = null
  if (!safe) {
    const fixResult = fixRegex(source, { limit })
    if (fixResult.fixed) fix = fixResult.fixed
  }

  return {
    safe,
    severity,
    reasons,
    starHeight: info.maxStarHeight,
    repCount: info.repCount,
    hasAlternationReDoS: hasAlternation,
    anchored,
    hasStaticSuffix,
    fix
  }
}

module.exports = safeRegex
module.exports.default = safeRegex
module.exports.safeRegex = safeRegex
module.exports.fix = fixRegex
module.exports.analyze = analyze
