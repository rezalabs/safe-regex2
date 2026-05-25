import safeRegex, { safeRegex as safeRegexNamed } from '..'
import { expect } from 'tstyche'

// ── safeRegex() — boolean check ──

expect(safeRegex('regex')).type.toBe<boolean>()
expect(safeRegex(/regex/)).type.toBe<boolean>()
expect(safeRegex('^[a-zA-Z0-9]+(?:\\s[a-zA-Z0-9]+)*$')).type.toBe<boolean>()
expect(safeRegex(/^[a-zA-Z0-9]+(?:\s[a-zA-Z0-9]+)*$/g)).type.toBe<boolean>()
expect(safeRegex('(a+)+y')).type.toBe<boolean>()
expect(safeRegex('(a+)+y', { limit: 10 })).type.toBe<boolean>()

expect(safeRegexNamed('regex')).type.toBe<boolean>()
expect(safeRegexNamed(/regex/)).type.toBe<boolean>()
expect(safeRegexNamed('^[a-zA-Z0-9]+(?:\\s[a-zA-Z0-9]+)*$')).type.toBe<boolean>()
expect(safeRegexNamed(/^[a-zA-Z0-9]+(?:\s[a-zA-Z0-9]+)*$/g)).type.toBe<boolean>()

// ── .fix() — auto-fix suggestion ──

expect(safeRegex.fix('(a+)+y')).type.toBe<FixResult>()
expect(safeRegex.fix(/regex/)).type.toBe<FixResult>()
expect(safeRegex.fix('(a+)+y', { limit: 10 })).type.toBe<FixResult>()

type FixResult = {
  safe: boolean
  fixed: string | null
  original: string
  semanticChange: boolean
}

// ── .analyze() — detailed risk assessment ──

expect(safeRegex.analyze('(a+)+y')).type.toBe<AnalyzeResult>()
expect(safeRegex.analyze(/regex/)).type.toBe<AnalyzeResult>()
expect(safeRegex.analyze('(a+)+y', { limit: 10 })).type.toBe<AnalyzeResult>()

type AnalyzeResult = {
  safe: boolean
  severity: 'none' | 'low' | 'high' | 'critical'
  reasons: string[]
  starHeight: number
  repCount: number
  hasAlternationReDoS: boolean
  anchored: boolean
  hasStaticSuffix: boolean
  fix: string | null
}
