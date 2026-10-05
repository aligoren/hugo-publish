/** Thrown (and caught by callers) when a run is cancelled. */
export class Cancelled extends Error {
  constructor() {
    super('cancelled')
    this.name = 'Cancelled'
  }
}

/**
 * Maps `items` with at most `limit` calls of `fn` at a time, in input order. `onProgress` gets
 * the number done so far; when `signal` aborts, no new calls start and `Cancelled` is thrown.
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
  options: { onProgress?: (done: number) => void; signal?: AbortSignal } = {},
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  let done = 0
  const worker = async () => {
    while (next < items.length) {
      if (options.signal?.aborted) throw new Cancelled()
      const index = next++
      results[index] = await fn(items[index], index)
      done++
      options.onProgress?.(done)
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker))
  if (options.signal?.aborted) throw new Cancelled()
  return results
}
