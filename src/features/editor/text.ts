// Text helpers shared by the menus, statistics and spelling: Turkish-aware
// case folding and forgiving search matching.

/**
 * Folds text for searching: Turkish lower case (İ→i, I→ı), then without
 * diacritics and dotless ı as i, so "baslik", "BAŞLIK" and "Başlık" match.
 */
export function foldForSearch(text: string): string {
  return text
    .toLocaleLowerCase('tr')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/ı/g, 'i')
}

/**
 * How well `query` matches `texts` (higher is better, 0 = no match): a
 * prefix of the first text beats a word prefix, which beats a substring,
 * which beats the letters appearing in order.
 */
export function matchScore(query: string, ...texts: string[]): number {
  const q = foldForSearch(query.trim())
  if (q === '') return 1
  let best = 0
  texts.forEach((text, index) => {
    const t = foldForSearch(text)
    const weight = index === 0 ? 1 : 0.9
    let score = 0
    if (t.startsWith(q)) score = 4
    else if (new RegExp(`(?:^|[\\s/_.-])${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(t)) score = 3
    else if (t.includes(q)) score = 2
    else if (isSubsequence(q, t)) score = 1
    best = Math.max(best, score * weight)
  })
  return best
}

function isSubsequence(query: string, text: string): boolean {
  let i = 0
  for (const ch of text) if (ch === query[i] && ++i === query.length) return true
  return i === query.length
}
