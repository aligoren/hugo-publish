// Matching for the command palette: every word of the query must appear in the text,
// ignoring case (Turkish-aware) and diacritics; earlier and word-start matches rank higher.

export function fold(text: string): string {
  return text
    .toLocaleLowerCase('tr')
    .replace(/ı/g, 'i')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
}

/** A score for `text` against `query`, or null when it does not match. Higher is better. */
export function score(text: string, query: string): number | null {
  const haystack = fold(text)
  const words = fold(query).split(/\s+/).filter(Boolean)
  if (words.length === 0) return 0
  let total = 0
  for (const word of words) {
    const index = haystack.indexOf(word)
    if (index < 0) return null
    const atWordStart = index === 0 || /[\s/\-_.:(]/.test(haystack[index - 1])
    total += (atWordStart ? 10 : 2) - Math.min(index, 50) / 50
  }
  return total
}

export function rank<T>(items: T[], query: string, text: (item: T) => string, limit = 50): T[] {
  return items
    .map((item, order) => ({ item, order, score: score(text(item), query) }))
    .filter((entry): entry is { item: T; order: number; score: number } => entry.score !== null)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, limit)
    .map((entry) => entry.item)
}
