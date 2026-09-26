/**
 * Minimal line-level diff for the editor's conflict dialog (task 1563).
 *
 * Classic LCS-based diff — good enough for a "what changed" view on
 * reasonably sized text files. Bounded by MAX_DIFF_LINES so a pathological
 * input (near the 2 MB editable ceiling, thousands of one-line changes)
 * can't blow up the O(n*m) DP table's memory; callers get `null` back and
 * show a "too large to diff" fallback instead.
 */

export type DiffLineType = 'same' | 'add' | 'del'

export interface DiffLine {
  type: DiffLineType
  text: string
}

/** ~1500 lines each side keeps the DP table under ~10 MB (Uint32Array). */
export const MAX_DIFF_LINES = 1500

export function diffLines(a: string, b: string): DiffLine[] | null {
  const linesA = a.split('\n')
  const linesB = b.split('\n')
  const n = linesA.length
  const m = linesB.length
  if (n > MAX_DIFF_LINES || m > MAX_DIFF_LINES) return null

  const dp: Uint32Array[] = new Array(n + 1)
  for (let i = 0; i <= n; i++) dp[i] = new Uint32Array(m + 1)
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        linesA[i] === linesB[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }

  const result: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (linesA[i] === linesB[j]) {
      result.push({ type: 'same', text: linesA[i] })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      result.push({ type: 'del', text: linesA[i] })
      i++
    } else {
      result.push({ type: 'add', text: linesB[j] })
      j++
    }
  }
  while (i < n) {
    result.push({ type: 'del', text: linesA[i] })
    i++
  }
  while (j < m) {
    result.push({ type: 'add', text: linesB[j] })
    j++
  }
  return result
}

/** True when the diff contains at least one add/del line. */
export function hasChanges(diff: DiffLine[]): boolean {
  return diff.some((l) => l.type !== 'same')
}
