import { describe, expect, it } from 'vitest'
import { splitFrontMatter } from '../../lib/frontmatter'
import { buildShortcodeDecorations, insideShortcode, scanShortcodes } from './shortcodes'
import { fixture } from './testing/fixtures'
import { stateFor } from './testing/harness'

const summary = (text: string, includeEscaped = false) =>
  scanShortcodes(text, { includeEscaped }).map((t) => `${t.escaped ? 'escaped ' : ''}${t.kind} ${t.delimiter} ${t.name}`)

describe('scanShortcodes', () => {
  const body = splitFrontMatter(fixture('shortcodes.md')).body

  it('finds every shortcode in the fixture and skips escaped ones by default', () => {
    expect(summary(body)).toEqual([
      'opening < param',
      'opening < relref',
      'opening < figure',
      'opening % details',
      'closing % details',
      'opening < highlight',
      'closing < highlight',
      'selfClosing < ornek-kod',
      'opening < bilinmeyen',
      'opening < figure',
    ])
  })

  it('reports escaped ones on request, including inside code blocks', () => {
    expect(summary(body, true).filter((s) => s.startsWith('escaped'))).toEqual([
      'escaped opening < figure',
      'escaped opening % details',
      'escaped opening < youtube',
    ])
  })

  it('gives exact ranges, also for multi-line tags with >}} inside quotes', () => {
    const tokens = scanShortcodes(body)
    const texts = tokens.map((t) => body.slice(t.from, t.to))
    expect(texts[0]).toBe('{{< param "title" >}}')
    expect(texts[7]).toBe('{{< ornek-kod baslik="Deneme" />}}')
    expect(texts[9]).toBe('{{< figure\n  src="/img/uzun.jpg"\n  caption="İçinde >}} geçen tırnak"\n>}}')
    expect(body.slice(tokens[2].nameFrom, tokens[2].nameTo)).toBe('figure')
  })

  it('handles syntax variants', () => {
    expect(summary('{{<figure src="a">}}')).toEqual(['opening < figure'])
    expect(summary('{{< x/>}} {{</ x >}} {{% / y %}}')).toEqual(['selfClosing < x', 'closing < x', 'closing % y'])
    expect(summary('{{< dir/name.inline >}}')).toEqual(['opening < dir/name.inline'])
    expect(summary('{{< raw `a >}} b` >}}')).toEqual(['opening < raw'])
  })

  it('ignores Go templates, unterminated tags and escaped tags', () => {
    expect(summary('{{ .Title }} {{- .Date -}}')).toEqual([])
    expect(summary('{{< figure src="a" ')).toEqual([])
    expect(summary('{{< a {{< b >}}')).toEqual(['opening < b'])
    expect(summary('{{</* figure */>}}')).toEqual([])
    expect(summary('{{</* figure >}}')).toEqual([])
  })

  it('finds ranges inside a tag', () => {
    const tokens = scanShortcodes('a {{< x "*b*" >}} *c*', { includeEscaped: true })
    expect(insideShortcode(tokens, 9, 10)).toBe(true)
    expect(insideShortcode(tokens, 18, 19)).toBe(false)
    expect(insideShortcode(tokens, 0, 1)).toBe(false)
  })
})

describe('shortcode decorations', () => {
  it('marks known, unknown, closing and escaped tags', () => {
    const state = stateFor('{{< figure >}} {{< kendi >}} {{< /kendi >}} {{</* x */>}}|', 'lf', {
      knownShortcodes: ['kendi'],
    })
    const unknownState = stateFor('{{< kendi >}}|')
    const list = (s: typeof state) => {
      const out: { from: number; to: number; text: string }[] = []
      buildShortcodeDecorations(s).between(0, s.doc.length, (from, to, deco) => {
        out.push({ from, to, text: `${s.sliceDoc(from, to)}: ${(deco.spec as { class: string }).class}` })
      })
      return out.sort((a, b) => a.from - b.from || b.to - a.to).map((d) => d.text)
    }
    expect(list(state)).toEqual([
      '{{< figure >}}: cm-sc cm-sc-known',
      'figure: cm-sc-name',
      '{{< kendi >}}: cm-sc cm-sc-known',
      'kendi: cm-sc-name',
      '{{< /kendi >}}: cm-sc cm-sc-known cm-sc-closing',
      'kendi: cm-sc-name',
      '{{</* x */>}}: cm-sc-escaped',
    ])
    expect(list(unknownState)[0]).toBe('{{< kendi >}}: cm-sc cm-sc-unknown')
  })
})
