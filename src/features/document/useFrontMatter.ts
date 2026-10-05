// The front matter form's view of a document: parsed values and edits. YAML edits apply at once;
// TOML edits go through the Rust side, so they are queued, shown right away (optimistically) and
// applied in order. `flush()` waits for them, e.g. before saving.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { api } from '../../lib/api'
import {
  ensureYamlFrontMatter,
  readFrontMatter,
  splitFrontMatter,
  type FrontMatterFormat,
  type FrontMatterParts,
  type FrontMatterValue,
} from '../../lib/frontmatter'
import {
  applyFrontMatterOps,
  applyOpsToValues,
  applyYamlOps,
  canEditFrontMatter,
  coalesceOps,
  type FieldPath,
  type FrontMatterOp,
} from './frontMatterOps'
import { locateTomlScalar, type TomlScalar } from './tomlText'

export interface FrontMatterController {
  format: FrontMatterFormat | null
  /** YAML, TOML, or no front matter yet (a YAML block is added on the first edit). */
  editable: boolean
  /** Current values; null while TOML is parsed or when the front matter does not parse. */
  values: Record<string, unknown> | null
  /** Values of the file as loaded, to tell new keys from existing ones. */
  original: Record<string, unknown> | null
  /** Parse error of the front matter, or the last failed edit. */
  error: unknown
  pending: boolean
  apply(ops: readonly FrontMatterOp[]): void
  set(path: FieldPath, value: FrontMatterValue, options?: { datetime?: boolean }): void
  remove(path: FieldPath): void
  /** Replaces the front matter text (source and snippet editing). */
  setText(frontMatterText: string): void
  /** Resolves once queued edits are applied. */
  flush(): Promise<void>
  /** TOML: how a scalar is written (for keeping date-times bare). */
  raw(path: readonly string[]): TomlScalar | null
}

interface Source {
  parts: FrontMatterParts | null
  getParts(): FrontMatterParts | null
  setParts(next: FrontMatterParts): void
  /** The file as loaded or last saved. */
  original: string | null
  generation: number
}

interface TomlState {
  text: string | null
  values: Record<string, unknown> | null
  error: unknown
}

function parseSync(parts: FrontMatterParts): { values: Record<string, unknown> | null; error: unknown } {
  try {
    return { values: readFrontMatter(parts) ?? {}, error: null }
  } catch (error) {
    return { values: null, error }
  }
}

export function useFrontMatter({ parts, getParts, setParts, original, generation }: Source): FrontMatterController {
  const format = parts?.format ?? null
  const fmText = parts?.frontMatterText ?? ''
  const [toml, setToml] = useState<TomlState>({ text: null, values: null, error: null })
  const [editError, setEditError] = useState<unknown>(null)
  const [pending, setPending] = useState(false)
  const queue = useRef<FrontMatterOp[]>([])
  const running = useRef<Promise<void> | null>(null)
  const generationRef = useRef(generation)

  useEffect(() => {
    generationRef.current = generation
    queue.current = []
  }, [generation])

  // YAML and JSON parse synchronously (only the front matter matters, not the body).
  const hasParts = parts !== null
  const syncParsed = useMemo(
    () =>
      format === 'toml' || !hasParts
        ? null
        : parseSync({ bom: false, eol: 'lf', format, open: '', frontMatterText: fmText, close: '', body: '' }),
    [format, fmText, hasParts],
  )

  // TOML text changed from outside the queue (file loaded, version restored, source edited).
  useEffect(() => {
    if (format !== 'toml' || running.current || toml.text === fmText) return
    let cancelled = false
    api.tomlParseText(fmText).then(
      (result) => {
        if (!cancelled && !running.current) setToml({ text: fmText, values: result.values, error: null })
      },
      (error: unknown) => {
        if (!cancelled && !running.current) setToml({ text: fmText, values: null, error })
      },
    )
    return () => {
      cancelled = true
    }
  }, [format, fmText, toml.text])

  // Values of the loaded file.
  const originalFm = useMemo(() => (original === null ? null : splitFrontMatter(original)), [original])
  const [originalToml, setOriginalToml] = useState<{ text: string; values: Record<string, unknown> | null } | null>(null)
  useEffect(() => {
    if (originalFm?.format !== 'toml' || originalToml?.text === originalFm.frontMatterText) return
    let cancelled = false
    const text = originalFm.frontMatterText
    api.tomlParseText(text).then(
      (result) => !cancelled && setOriginalToml({ text, values: result.values }),
      () => !cancelled && setOriginalToml({ text, values: null }),
    )
    return () => {
      cancelled = true
    }
  }, [originalFm, originalToml])
  const originalValues = useMemo(() => {
    if (!originalFm) return null
    if (originalFm.format === 'toml') return originalToml?.text === originalFm.frontMatterText ? originalToml.values : null
    return parseSync(originalFm).values
  }, [originalFm, originalToml])

  const runQueue = useCallback(() => {
    if (running.current) return running.current
    const gen = generationRef.current
    setPending(true)
    const run = (async () => {
      try {
        for (;;) {
          while (queue.current.length > 0) {
            const ops = coalesceOps(queue.current.splice(0))
            const base = getParts()
            if (!base) return
            const next = await applyFrontMatterOps(base, ops)
            if (generationRef.current !== gen) return
            const latest = getParts()
            // The front matter was replaced meanwhile (source edit): drop the stale edit.
            if (!latest || latest.frontMatterText !== base.frontMatterText) break
            if (next.frontMatterText !== base.frontMatterText) setParts({ ...latest, frontMatterText: next.frontMatterText })
          }
          const settled = getParts()
          if (!settled || settled.format !== 'toml' || generationRef.current !== gen) return
          const result = await api.tomlParseText(settled.frontMatterText)
          if (generationRef.current !== gen) return
          if (queue.current.length === 0 && getParts()?.frontMatterText === settled.frontMatterText) {
            setToml({ text: settled.frontMatterText, values: result.values, error: null })
            return
          }
          if (queue.current.length === 0) {
            setToml((s) => ({ ...s, text: null }))
            return
          }
        }
      } catch (error) {
        queue.current = []
        setEditError(error)
        // Show the values of the text as it is.
        setToml((s) => ({ ...s, text: null }))
      } finally {
        running.current = null
        setPending(false)
        // Parse again unless the values already belong to the current text.
        const text = getParts()?.frontMatterText
        setToml((s) => (s.text === text ? s : { ...s, text: null }))
      }
    })()
    running.current = run
    return run
  }, [getParts, setParts])

  const apply = useCallback(
    (ops: readonly FrontMatterOp[]) => {
      const current = getParts()
      if (!current || !canEditFrontMatter(current) || ops.length === 0) return
      setEditError(null)
      if (current.format === 'toml') {
        setToml((s) => ({ ...s, values: applyOpsToValues(s.values ?? {}, ops) }))
        queue.current.push(...ops)
        void runQueue()
        return
      }
      try {
        setParts(applyYamlOps(current, ops))
      } catch (error) {
        setEditError(error)
      }
    },
    [getParts, runQueue, setParts],
  )

  const set = useCallback(
    (path: FieldPath, value: FrontMatterValue, options?: { datetime?: boolean }) =>
      apply([{ op: 'set', path, value, datetime: options?.datetime }]),
    [apply],
  )
  const remove = useCallback((path: FieldPath) => apply([{ op: 'remove', path }]), [apply])

  const setText = useCallback(
    (text: string) => {
      const current = getParts()
      if (!current) return
      const base = current.format === null ? ensureYamlFrontMatter(current) : current
      setEditError(null)
      setParts({ ...base, frontMatterText: text })
    },
    [getParts, setParts],
  )

  const flush = useCallback(async () => {
    while (running.current) await running.current
  }, [])

  const raw = useCallback(
    (path: readonly string[]) => (format === 'toml' ? locateTomlScalar(fmText, path) : null),
    [format, fmText],
  )

  const values = format === 'toml' ? toml.values : (syncParsed?.values ?? null)
  const parseError = format === 'toml' ? toml.error : (syncParsed?.error ?? null)

  return {
    format,
    editable: parts !== null && canEditFrontMatter(parts),
    values,
    original: originalValues,
    error: editError ?? parseError,
    pending,
    apply,
    set,
    remove,
    setText,
    flush,
    raw,
  }
}
