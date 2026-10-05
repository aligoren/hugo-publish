import { describe, expect, it } from 'vitest'
import {
  BOM,
  countLineEndings,
  detectEol,
  dominantEol,
  fromLf,
  hasBom,
  lineSeparatorOf,
  restoreBom,
  splitLinesKeepEol,
  stripBom,
  toLf,
} from './eol'

describe('detectEol', () => {
  it('classifies line ending styles', () => {
    expect(detectEol('')).toBe('none')
    expect(detectEol('one line')).toBe('none')
    expect(detectEol('a\nb\n')).toBe('lf')
    expect(detectEol('a\r\nb\r\n')).toBe('crlf')
    expect(detectEol('a\r\nb\n')).toBe('mixed')
    expect(detectEol('a\rb')).toBe('mixed')
  })

  it('counts each kind', () => {
    expect(countLineEndings('a\r\nb\nc\rd\r\n')).toEqual({ lf: 1, crlf: 2, cr: 1 })
  })

  it('picks the dominant style for new lines', () => {
    expect(dominantEol('a\r\nb\r\nc\n')).toBe('crlf')
    expect(dominantEol('a\r\nb\nc\n')).toBe('lf')
    expect(dominantEol('a\r\nb\n')).toBe('lf')
    expect(dominantEol('none', 'crlf')).toBe('crlf')
    expect(lineSeparatorOf('x\r\n')).toBe('\r\n')
  })
})

describe('BOM', () => {
  it('detects, strips and restores', () => {
    const text = BOM + 'merhaba'
    expect(hasBom(text)).toBe(true)
    expect(hasBom('merhaba')).toBe(false)
    expect(stripBom(text)).toEqual({ bom: true, text: 'merhaba' })
    expect(stripBom('merhaba')).toEqual({ bom: false, text: 'merhaba' })
    expect(restoreBom('merhaba', true)).toBe(text)
    expect(restoreBom(text, true)).toBe(text)
    expect(restoreBom('merhaba', false)).toBe('merhaba')
  })
})

describe('conversion', () => {
  it('normalizes to LF and back', () => {
    expect(toLf('a\r\nb\r\n')).toBe('a\nb\n')
    expect(toLf('a\rb')).toBe('a\rb')
    expect(fromLf('a\nb\n', 'crlf')).toBe('a\r\nb\r\n')
    expect(fromLf('a\r\nb\n', 'crlf')).toBe('a\r\nb\r\n')
    expect(fromLf('a\r\nb\n', 'lf')).toBe('a\nb\n')
    expect(fromLf('a\nb', '\r\n')).toBe('a\r\nb')
  })

  it('splits lines keeping each line break', () => {
    const text = 'a\r\nb\n\r\nc'
    const lines = splitLinesKeepEol(text)
    expect(lines).toEqual([
      { text: 'a', eol: '\r\n' },
      { text: 'b', eol: '\n' },
      { text: '', eol: '\r\n' },
      { text: 'c', eol: '' },
    ])
    expect(lines.map((l) => l.text + l.eol).join('')).toBe(text)
    expect(splitLinesKeepEol('x\n')).toEqual([{ text: 'x', eol: '\n' }])
    expect(splitLinesKeepEol('')).toEqual([])
  })
})
