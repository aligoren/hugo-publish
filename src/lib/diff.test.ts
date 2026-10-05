import { describe, expect, it } from 'vitest'

import { diffLines, withContext } from './diff'

describe('diffLines', () => {
  it('marks only inserted lines as added', () => {
    const before = 'a\nb\nc\n'
    const after = 'a\nb\nx\ny\nc\n'
    const kinds = diffLines(before, after).map((l) => `${l.kind}:${l.text}`)
    expect(kinds).toEqual(['same:a', 'same:b', 'added:x', 'added:y', 'same:c'])
  })

  it('pairs a replaced line as removed then added', () => {
    const lines = diffLines('title = "a"\nx = 1\n', 'title = "b"\nx = 1\n')
    expect(lines.map((l) => l.kind)).toEqual(['removed', 'added', 'same'])
  })

  it('treats CRLF and LF the same and ignores the final newline', () => {
    expect(diffLines('a\r\nb\r\n', 'a\nb').every((l) => l.kind === 'same')).toBe(true)
  })

  it('numbers lines on both sides', () => {
    const [, added, same] = diffLines('a\nc', 'a\nb\nc')
    expect(added).toMatchObject({ kind: 'added', newNumber: 2 })
    expect(same).toMatchObject({ kind: 'same', oldNumber: 2, newNumber: 3 })
  })
})

describe('withContext', () => {
  it('collapses long unchanged runs into gaps', () => {
    const before = Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n')
    const after = before.replace('line 10', 'changed')
    const view = withContext(diffLines(before, after), 2)
    expect(view[0]).toBeNull()
    expect(view.filter((l) => l !== null).map((l) => l!.text)).toEqual([
      'line 8',
      'line 9',
      'line 10',
      'changed',
      'line 11',
      'line 12',
    ])
    expect(view[view.length - 1]).toBeNull()
  })

  it('returns nothing for identical input', () => {
    expect(withContext(diffLines('a\nb', 'a\nb'))).toEqual([])
  })
})
