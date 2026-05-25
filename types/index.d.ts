type SafeRegexOptions = { limit?: number }

type FixResult = {
  safe: boolean
  fixed: string | null
  original: string
  /**
   * When true, the fixed regex may not match the same set of strings
   * as the original. Do not apply automatically without verifying that
   * the behavior change is acceptable.
   */
  semanticChange: boolean
}

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

type SafeFn = {
  (re: string | RegExp, opts?: SafeRegexOptions): boolean
  safeRegex: SafeFn
  fix: (re: string | RegExp, opts?: SafeRegexOptions) => FixResult
  analyze: (re: string | RegExp, opts?: SafeRegexOptions) => AnalyzeResult
  default: SafeFn
}

declare const _: SafeFn
export = _
