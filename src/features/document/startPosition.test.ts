import { describe, expect, it } from 'vitest'

import { startPosition } from './startPosition'

const selected = (body: string) => {
  const position = startPosition(body)
  const line = body.split('\n')[position.line - 1].replace(/\r$/, '')
  return { ...position, text: line.slice(position.from, position.to) }
}

describe('startPosition', () => {
  it('selects the first bracketed placeholder', () => {
    expect(selected('\n## Giriş\n\nBurada [buraya giriş yaz] ve [ikinci].\n')).toEqual({ line: 4, from: 7, to: 25, text: '[buraya giriş yaz]' })
  })

  it('skips links, images, footnotes, task boxes, alerts, code and shortcodes', () => {
    const body = [
      '> [!NOTE]',
      '- [ ] yapılacak',
      '[bağlantı](https://example.org) ![görsel](a.png) [^1]',
      '`[kod]` {{< figure src="[x]" >}}',
      '```',
      '[kod bloğu]',
      '```',
      '[Asıl yer tutucu]',
      '',
    ].join('\n')
    expect(selected(body).text).toBe('[Asıl yer tutucu]')
  })

  it('selects the first line of template text when there is no placeholder', () => {
    expect(selected('\n## Introduction\n\n  Write a few sentences about the book here.\n\n## Notes\n')).toEqual({
      line: 4,
      from: 2,
      to: 44,
      text: 'Write a few sentences about the book here.',
    })
  })

  it('puts the cursor at the end of the text otherwise, before trailing blank lines', () => {
    expect(startPosition('\nİlk.\n\n\n')).toEqual({ line: 2, from: 4, to: 4 })
    expect(startPosition('')).toEqual({ line: 1, from: 0, to: 0 })
    expect(startPosition('\n')).toEqual({ line: 1, from: 0, to: 0 })
  })

  it('counts columns without the CR of CRLF lines', () => {
    expect(selected('\r\nMetin [TODO burada]\r\n')).toEqual({ line: 2, from: 6, to: 19, text: '[TODO burada]' })
  })
})
