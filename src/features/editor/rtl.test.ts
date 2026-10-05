import { describe, expect, it } from 'vitest'
import { splitFrontMatter } from '../../lib/frontmatter'
import { buildRtlDecorations, findRtlBlocksInText, rtlLineKinds } from './rtl'
import { createMarkdownState } from './syntax'
import { fixture } from './testing/fixtures'
import { stateFor } from './testing/harness'

describe('findRtlBlocks', () => {
  const body = splitFrontMatter(fixture('rtl-block.md')).body
  const lines = body.split('\n')
  const blocks = findRtlBlocksInText(body)

  it('finds RTL divs (any quote style) and skips LTR and commented-out ones', () => {
    expect(blocks).toHaveLength(2)
    expect(blocks.map((b) => lines[b.openLine - 1])).toEqual([
      '<div dir="rtl" style="text-align: center;">',
      "<div dir='rtl'>",
    ])
    expect(blocks.map((b) => b.centered)).toEqual([true, false])
  })

  it('matches the closing tag across blank lines (Markdown inside)', () => {
    const [centered] = blocks
    expect(lines[centered.closeLine - 1]).toBe('</div>')
    expect(lines.slice(centered.innerFromLine - 1, centered.innerToLine)).toEqual([
      '',
      'مرحبا بالعالم',
      '',
      '**مرحبا** بالعالم',
      '',
    ])
  })

  it('counts nested divs to find the matching close', () => {
    const nested = blocks[1]
    expect(nested.closeLine - nested.openLine).toBe(4)
    expect(lines[nested.closeLine - 1]).toBe('</div>')
    expect(lines[nested.closeLine - 2]).toBe('</div>')
  })

  it('shows tag lines inside the block as source, the rest right to left', () => {
    const state = createMarkdownState(body)
    const kinds = rtlLineKinds(state, blocks)
    const nested = blocks[1]
    expect([...Array(nested.closeLine - nested.openLine + 1)].map((_, i) => kinds.get(nested.openLine + i))).toEqual([
      'tag',
      'tag',
      'rtl',
      'tag',
      'tag',
    ])
    expect(kinds.get(blocks[0].innerFromLine + 1)).toBe('rtl-center')
  })

  it('ignores code, unclosed divs and other dir values', () => {
    expect(findRtlBlocksInText('```html\n<div dir="rtl">\nx\n</div>\n```\n')).toHaveLength(0)
    expect(findRtlBlocksInText('<div dir="rtl">\n\nمرحبا\n')).toHaveLength(0)
    expect(findRtlBlocksInText('<div data-dir="rtl">\nx\n</div>\n')).toHaveLength(0)
    expect(findRtlBlocksInText('<div dir=rtl class="x">\nx\n</div>\n')).toHaveLength(1)
    expect(findRtlBlocksInText('<DIV DIR="RTL">\nx\n</DIV>\n')).toHaveLength(1)
  })

  it('finds an RTL div whose content has no blank lines (one HTML block)', () => {
    const [block] = findRtlBlocksInText('Metin\n\n<div dir="rtl">\nمرحبا\nبالعالم\n</div>\n')
    expect([block.openLine, block.innerFromLine, block.innerToLine, block.closeLine]).toEqual([3, 4, 5, 6])
  })
})

describe('RTL decorations', () => {
  it('sets dir=rtl and the font class on inner lines, and subdues tag lines', () => {
    const state = stateFor('<div dir="rtl" style="text-align: center;">\n\nمرحبا بالعالم\n\n</div>\n|', 'crlf')
    const result: string[] = []
    buildRtlDecorations(state).between(0, state.doc.length, (from, _to, deco) => {
      const spec = deco.spec as { class: string; attributes?: { dir: string } }
      result.push(`${state.doc.lineAt(from).number} ${spec.class}${spec.attributes ? ' dir=' + spec.attributes.dir : ''}`)
    })
    expect(result).toEqual([
      '1 cm-rtl-tag',
      '2 cm-rtl-line cm-rtl-center dir=rtl',
      '3 cm-rtl-line cm-rtl-center dir=rtl',
      '4 cm-rtl-line cm-rtl-center dir=rtl',
      '5 cm-rtl-tag',
    ])
  })
})
