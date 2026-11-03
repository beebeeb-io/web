// Ordering for `file.starred` frames (task 1577, PR #115 review).
//
// Stars are realtime events, not sequenced ops, so they have no seq_id to
// order by. Two rules make them eventually correct:
// - a frame whose server timestamp is older than the newest applied for this
//   file is dropped (publishes from different API nodes reach the stream via
//   the bridge and are not guaranteed to be in commit order);
// - every frame consumes one outstanding local echo (the oldest), and is
//   applied only when no newer local write is still waiting for its echo.

/** How long a local star write waits for its echo before other frames stop being held. */
const STAR_ECHO_TTL_MS = 15_000

export class StarOrder {
  /** Server `timestamp` (ms) of the newest applied frame per file. */
  private frameAt = new Map<string, number>()
  /** Local-clock times of this client's own star PATCHes awaiting their echo. */
  private echoes = new Map<string, number[]>()

  /** A stream reconnect loses echoes published while it was down. */
  clear(): void {
    this.echoes.clear()
  }

  /** Record this client's own star write. */
  noteLocalWrite(id: string, now = Date.now()): void {
    const echoes = this.live(id, now)
    echoes.push(now)
    this.echoes.set(id, echoes)
  }

  /**
   * Consume one echo for `id` and apply the frame's timestamp ordering.
   * Returns true when the frame should be written to the tree.
   */
  applyFrame(id: string, at: number | undefined, now = Date.now()): boolean {
    const echoes = this.live(id, now)
    if (echoes.length > 0) echoes.shift()
    if (echoes.length > 0) this.echoes.set(id, echoes)
    else this.echoes.delete(id)

    if (at !== undefined) {
      const newest = this.frameAt.get(id)
      if (newest !== undefined && at < newest) return false
      this.frameAt.set(id, at)
    }
    return echoes.length === 0
  }

  /** Outstanding local echoes for `id`, minus any too old to still arrive. */
  private live(id: string, now: number): number[] {
    return (this.echoes.get(id) ?? []).filter((t) => now - t < STAR_ECHO_TTL_MS)
  }
}
