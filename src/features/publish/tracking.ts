// What the deploy tracker follows, and how patiently.

export interface TrackTarget {
  /** Commit to follow: a full id, or a ref such as `refs/heads/gh-pages`. */
  rev: string
  /** `push`: the sources were pushed; `gh-pages`: the built site was. */
  kind: 'push' | 'gh-pages'
}

export interface TrackerTimings {
  pollMs: number
  maxMs: number
  /** Polls without any checks before deciding the host reports none. */
  emptyPolls: number
  /** Waits before each live attempt (CDNs lag behind the build). */
  retryDelays: number[]
}

export const DEFAULT_TIMINGS: TrackerTimings = {
  pollMs: 10_000,
  maxMs: 10 * 60_000,
  emptyPolls: 3,
  retryDelays: [0, 15_000, 30_000, 60_000, 120_000],
}
