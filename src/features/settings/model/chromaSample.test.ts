import { describe, expect, it } from 'vitest'

import { CHROMA_STYLE_NAMES } from '../schema'
import { chromaPalette, hasPalette, SAMPLE_CODE, tokenize } from './chromaSample'

describe('chroma sample', () => {
  it('tokenizes keywords, strings, comments, numbers and calls', () => {
    const tokens = tokenize('// hi\nfunc f(a int) { return "x\\"y" + g(42) }')
    const of = (kind: string) => tokens.filter((t) => t.kind === kind).map((t) => t.text)
    expect(of('comment')).toEqual(['// hi'])
    expect(of('keyword')).toEqual(['func', 'int', 'return'])
    expect(of('string')).toEqual(['"x\\"y"'])
    expect(of('number')).toEqual(['42'])
    expect(of('function')).toEqual(['f', 'g'])
  })

  it('keeps every character of the sample', () => {
    expect(
      tokenize(SAMPLE_CODE)
        .map((t) => t.text)
        .join(''),
    ).toBe(SAMPLE_CODE)
  })

  it('has colors for the well-known styles, all of them real Chroma styles', () => {
    for (const style of ['monokai', 'github', 'github-dark', 'dracula', 'nord', 'solarized-dark', 'solarized-light', 'catppuccin-mocha', 'catppuccin-latte', 'onedark', 'gruvbox', 'vs', 'xcode', 'emacs', 'friendly', 'paraiso-dark', 'rrt', 'native', 'pygments', 'tango']) {
      expect(hasPalette(style), style).toBe(true)
      expect(CHROMA_STYLE_NAMES, style).toContain(style)
    }
    expect(chromaPalette('Monokai')?.background).toBe('#272822')
    expect(chromaPalette('no-such-style')).toBeNull()
  })
})
