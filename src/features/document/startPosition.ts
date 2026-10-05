// Where writing starts in a post that was just created from an archetype: the first bracketed
// placeholder (`[Write the introduction here]`), else the first line of template text, else the
// end of the body. Positions are line and column, so they hold for CRLF files too.

import { isTrivialLine } from '../checks/runChecks'

export interface StartPosition {
  /** 1-based line of the body. */
  line: number
  /** Selected columns of that line (equal when nothing is selected). */
  from: number
  to: number
}

/** Bracketed text that is not a link, image, footnote, task box, alert marker or shortcode. */
const BRACKETED = /(?<![!\]\\])\[([^\]\n]{1,200})\](?![([:])/g

export function startPosition(body: string): StartPosition {
  const lines = body.split('\n').map((line) => line.replace(/\r$/, ''))
  let fence: string | null = null
  let firstText: StartPosition | null = null
  for (let index = 0; index < lines.length; index++) {
    const raw = lines[index]
    const trimmed = raw.trim()
    const fenceMatch = /^(`{3,}|~{3,})/.exec(trimmed)
    if (fenceMatch) {
      if (fence === null) fence = fenceMatch[1][0]
      else if (fenceMatch[1][0] === fence) fence = null
      continue
    }
    if (fence !== null || trimmed === '' || /^<!--.*-->$/.test(trimmed)) continue
    // Shortcodes keep their brackets: `{{< figure src="[x]" >}}` is not a placeholder.
    const prose = raw.replace(/\{\{[<%][\s\S]*?[%>]\}\}/g, (m) => ' '.repeat(m.length)).replace(/(`+)[^`]*?\1/g, (m) => ' '.repeat(m.length))
    for (const match of prose.matchAll(BRACKETED)) {
      const inner = match[1].trim()
      if (inner === '' || /^[!^]/.test(inner) || /^[xX ]$/.test(match[1])) continue
      const from = match.index ?? 0
      return { line: index + 1, from, to: from + match[0].length }
    }
    if (firstText === null && !isTrivialLine(trimmed.replace(/\s+/g, ' '))) {
      const from = raw.length - raw.trimStart().length
      firstText = { line: index + 1, from, to: raw.trimEnd().length }
    }
  }
  if (firstText) return firstText
  // The end of the text, before trailing blank lines.
  let last = lines.length
  while (last > 1 && lines[last - 1].trim() === '') last--
  const end = lines[last - 1] ?? ''
  return { line: last, from: end.length, to: end.length }
}
