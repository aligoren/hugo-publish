import { useEffect, useRef, useState } from 'react'

import { api } from '../../lib/api'

const MAX_PARALLEL = 4
const MAX_CACHED = 600

const cache = new Map<string, Promise<string>>()
let running = 0
const waiting: (() => void)[] = []

function schedule<T>(task: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const run = () => {
      running++
      task()
        .then(resolve, reject)
        .finally(() => {
          running--
          waiting.shift()?.()
        })
    }
    if (running < MAX_PARALLEL) run()
    else waiting.push(run)
  })
}

/** A `data:` URL preview, cached per file version and size, at most a few requests at once. */
function loadThumbnail(path: string, modifiedMs: number, size: number): Promise<string> {
  const key = `${path}|${modifiedMs}|${size}`
  let pending = cache.get(key)
  if (!pending) {
    pending = schedule(() => api.mediaThumbnail(path, size))
    cache.set(key, pending)
    pending.catch(() => cache.delete(key))
    if (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value!)
  }
  return pending
}

interface Props {
  path: string
  modifiedMs: number
  /** Requested preview size in pixels (the longer side). */
  size?: number
  /** Shown when there is no preview, e.g. the format. */
  fallback?: string
  className?: string
}

/** An image preview that loads when it scrolls into view. Give it `key={path + modifiedMs}`. */
export function Thumbnail({ path, modifiedMs, size = 320, fallback, className = '' }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined')
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (visible || !box.current) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { rootMargin: '200px' },
    )
    observer.observe(box.current)
    return () => observer.disconnect()
  }, [visible])

  useEffect(() => {
    if (!visible) return
    let cancelled = false
    loadThumbnail(path, modifiedMs, size).then(
      (url) => !cancelled && setSrc(url),
      () => !cancelled && setFailed(true),
    )
    return () => {
      cancelled = true
    }
  }, [visible, path, modifiedMs, size])

  return (
    <div
      ref={box}
      className={`flex items-center justify-center overflow-hidden bg-[repeating-conic-gradient(#e4e4e7_0_25%,#fafafa_0_50%)] bg-[length:16px_16px] dark:bg-[repeating-conic-gradient(#27272a_0_25%,#18181b_0_50%)] ${className}`}
    >
      {src ? (
        <img src={src} alt="" className="max-h-full max-w-full object-contain" draggable={false} />
      ) : failed ? (
        <span className="font-mono text-xs text-zinc-500 uppercase">{fallback ?? '?'}</span>
      ) : (
        <span className="h-full w-full animate-pulse bg-zinc-200/60 dark:bg-zinc-800/60" />
      )}
    </div>
  )
}
