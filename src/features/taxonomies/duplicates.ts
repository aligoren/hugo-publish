// Finds terms that are probably the same term written differently, to suggest merges:
//
// - sameUrl:  Hugo already puts them on one page (same path segment), e.g. `Kitap` / `kitap`
// - case:     equal ignoring case, with Turkish rules (`İstanbul` / `istanbul`, `ISIK` / `ışık`)
//             and, for English words, without them (`Ideas` / `ideas`)
// - accents:  equal after slugifying (`Çocuk` / `cocuk`, `Kitap'ta` / `kitapta`)
// - plural:   Turkish -ler/-lar or English -s/-es (`etiket` / `etiketler`, `book` / `books`)
// - typo:     small edit distance for longer terms (1 from 5 letters, 2 from 7)

import { slugify } from '../../lib/slug'

export type DuplicateReason = 'sameUrl' | 'case' | 'accents' | 'plural' | 'typo'

export interface TermCount {
  name: string
  count: number
  /** Hugo path segment (see `termSegment`); enables the `sameUrl` reason. */
  segment?: string
}

export interface DuplicateGroup {
  /** The terms, most used first. */
  terms: string[]
  /** The term to merge into: the most used one. */
  suggested: string
  reasons: DuplicateReason[]
}

export interface DuplicateOptions {
  /** Above this many terms the (quadratic) typo check is skipped. Default 4000. */
  maxTermsForTypos?: number
}

const REASON_ORDER: readonly DuplicateReason[] = ['sameUrl', 'case', 'accents', 'plural', 'typo']

const collator = new Intl.Collator('tr')

export function turkishLower(text: string): string {
  return text.trim().toLocaleLowerCase('tr')
}

/** Edit distance allowed between two slugs, by the length of the shorter one. */
export function typoThreshold(length: number): number {
  if (length >= 7) return 2
  if (length >= 5) return 1
  return 0
}

/**
 * Optimal string alignment distance (Levenshtein plus adjacent swaps), or `max + 1` as soon
 * as the distance is known to exceed `max`.
 */
export function editDistance(a: string, b: string, max = Infinity): number {
  if (a === b) return 0
  if (Math.abs(a.length - b.length) > max) return max + 1
  let prevPrev: number[] = []
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    let rowMin = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let value = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) value = Math.min(value, prevPrev[j - 2] + 1)
      row.push(value)
      if (value < rowMin) rowMin = value
    }
    if (rowMin > max) return max + 1
    prevPrev = prev
    prev = row
  }
  return prev[b.length]
}

const PLURAL_SUFFIXES: readonly { suffix: string; minStem: number }[] = [
  { suffix: 'ler', minStem: 2 },
  { suffix: 'lar', minStem: 2 },
  { suffix: 'es', minStem: 3 },
  { suffix: 's', minStem: 3 },
]

/** Stems a slug could be the plural of (`etiketler` → `etiket`, `books` → `book`). */
export function pluralStems(slug: string): string[] {
  const stems: string[] = []
  for (const { suffix, minStem } of PLURAL_SUFFIXES) {
    if (slug.endsWith(suffix) && slug.length - suffix.length >= minStem) stems.push(slug.slice(0, -suffix.length))
  }
  return stems
}

class UnionFind {
  private readonly parent: number[]
  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, i) => i)
  }
  find(i: number): number {
    while (this.parent[i] !== i) {
      this.parent[i] = this.parent[this.parent[i]]
      i = this.parent[i]
    }
    return i
  }
  union(a: number, b: number): void {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra !== rb) this.parent[rb] = ra
  }
}

function byCountThenName(a: TermCount, b: TermCount): number {
  if (b.count !== a.count) return b.count - a.count
  // On a tie prefer the spelling that is already lower case.
  const aLower = a.name === turkishLower(a.name) ? 0 : 1
  const bLower = b.name === turkishLower(b.name) ? 0 : 1
  return aLower - bLower || collator.compare(a.name, b.name)
}

/** Groups of terms that look like duplicates, most used groups first. */
export function findNearDuplicates(input: readonly TermCount[], options: DuplicateOptions = {}): DuplicateGroup[] {
  const terms = [...new Map(input.map((t) => [t.name, t])).values()]
  const sets = new UnionFind(terms.length)
  const edges: { a: number; b: number; reason: DuplicateReason }[] = []
  const link = (a: number, b: number, reason: DuplicateReason) => {
    if (a === b) return
    edges.push({ a, b, reason })
    sets.union(a, b)
  }

  // Equal keys: link every term to the first one with that key. Weaker reasons are only
  // recorded for terms that the stronger ones did not already connect.
  const byKey = (reason: DuplicateReason, keyOf: (term: TermCount) => string | null | undefined, onlyNew = true) => {
    const first = new Map<string, number>()
    terms.forEach((term, index) => {
      const key = keyOf(term)
      if (!key) return
      const existing = first.get(key)
      if (existing === undefined) first.set(key, index)
      else if (!onlyNew || sets.find(existing) !== sets.find(index)) link(existing, index, reason)
    })
  }
  byKey('sameUrl', (t) => t.segment)
  // Case differences are worth naming even when Hugo already merges the terms.
  byKey('case', (t) => turkishLower(t.name), false)
  byKey('case', (t) => t.name.trim().toLowerCase())

  const slugs = terms.map((t) => slugify(t.name))
  byKey('accents', (t) => slugify(t.name))

  const bySlug = new Map<string, number[]>()
  slugs.forEach((slug, index) => {
    if (!slug) return
    const list = bySlug.get(slug)
    if (list) list.push(index)
    else bySlug.set(slug, [index])
  })
  slugs.forEach((slug, index) => {
    if (!slug) return
    for (const stem of pluralStems(slug)) {
      for (const other of bySlug.get(stem) ?? []) if (sets.find(other) !== sets.find(index)) link(other, index, 'plural')
    }
  })

  if (terms.length <= (options.maxTermsForTypos ?? 4000)) {
    const order = slugs
      .map((slug, index) => ({ slug, index }))
      .filter((s) => s.slug.length >= 5)
      .sort((x, y) => x.slug.length - y.slug.length)
    for (let i = 0; i < order.length; i++) {
      const a = order[i]
      for (let j = i + 1; j < order.length; j++) {
        const b = order[j]
        const max = typoThreshold(a.slug.length)
        if (b.slug.length - a.slug.length > max) break
        if (a.slug === b.slug || sets.find(a.index) === sets.find(b.index)) continue
        // `python2` / `python3`, `2023-ozet` / `2024-ozet`: numbered terms are not typos.
        if (a.slug.replace(/\d/g, '') === b.slug.replace(/\d/g, '')) continue
        if (editDistance(a.slug, b.slug, max) <= max) link(a.index, b.index, 'typo')
      }
    }
  }

  const groups = new Map<number, { members: Set<number>; reasons: Set<DuplicateReason> }>()
  for (const { a, b, reason } of edges) {
    const root = sets.find(a)
    let group = groups.get(root)
    if (!group) {
      group = { members: new Set(), reasons: new Set() }
      groups.set(root, group)
    }
    group.members.add(a).add(b)
    group.reasons.add(reason)
  }

  return [...groups.values()]
    .map(({ members, reasons }) => {
      const sorted = [...members].map((i) => terms[i]).sort(byCountThenName)
      return {
        terms: sorted.map((t) => t.name),
        suggested: sorted[0].name,
        reasons: REASON_ORDER.filter((r) => reasons.has(r)),
        total: sorted.reduce((sum, t) => sum + t.count, 0),
      }
    })
    .sort((x, y) => y.total - x.total || collator.compare(x.suggested, y.suggested))
    .map(({ terms: names, suggested, reasons }) => ({ terms: names, suggested, reasons }))
}
