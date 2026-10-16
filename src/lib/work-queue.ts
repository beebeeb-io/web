/** Session-wide admission. Queued cancellation never starts work; running jobs
 * retain their slot until they settle. A key also serializes writes to one page. */
export class WorkQueue {
  #active = 0
  #keys = new Set<string>()
  #waiting: { key?: string; signal?: AbortSignal; abort: () => void; start: () => Promise<void> }[] = []

  constructor(private readonly limit: number) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error('Invalid queue limit')
  }

  run<T>(work: () => Promise<T>, signal?: AbortSignal, key?: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const cancelled = () => new DOMException('Work cancelled', 'AbortError')
      if (signal?.aborted) { reject(cancelled()); return }
      const entry = {
        key, signal,
        abort: () => {
          const i = this.#waiting.indexOf(entry)
          if (i >= 0) { this.#waiting.splice(i, 1); reject(cancelled()); this.#drain() }
        },
        start: () => Promise.resolve().then(() => {
          signal?.throwIfAborted()
          return work()
        }).then(resolve, reject),
      }
      this.#waiting.push(entry)
      signal?.addEventListener('abort', entry.abort, { once: true })
      this.#drain()
    })
  }

  #drain(): void {
    while (this.#active < this.limit) {
      const i = this.#waiting.findIndex(e => !e.key || !this.#keys.has(e.key))
      if (i < 0) return
      const [entry] = this.#waiting.splice(i, 1)
      entry.signal?.removeEventListener('abort', entry.abort)
      this.#active++
      if (entry.key) this.#keys.add(entry.key)
      void entry.start().finally(() => {
        this.#active--
        if (entry.key) this.#keys.delete(entry.key)
        this.#drain()
      })
    }
  }
}
