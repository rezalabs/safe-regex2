type SafeRegexOptions = { limit?: number }

type FixResult = {
  safe: boolean
  fixed: string | null
  original: string
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
