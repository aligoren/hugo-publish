import { describe, expect, it, vi } from 'vitest'

import { applyBulk, withTerm, type TomlTools } from './bulk'

const noToml: TomlTools = {
  edit: () => Promise.reject(new Error('not TOML')),
  parse: () => Promise.reject(new Error('not TOML')),
}

describe('withTerm', () => {
  it('appends new terms and ignores Turkish-case duplicates', () => {
    expect(withTerm(['a'], 'b')).toEqual(['a', 'b'])
    expect(withTerm(['İstanbul'], 'istanbul')).toEqual(['İstanbul'])
    expect(withTerm('tek', 'iki')).toEqual(['tek', 'iki'])
    expect(withTerm(undefined, 'ilk')).toEqual(['ilk'])
  })
})

describe('applyBulk', () => {
  it('sets draft in YAML changing only that line, keeping CRLF', async () => {
    const text = '---\r\ntitle: "A"\r\ndraft: true\r\n# note\r\n---\r\nGövde\r\n'
    const result = await applyBulk(text, { kind: 'draft', draft: false }, noToml)
    expect(result.text).toBe(text.replace('draft: true', 'draft: false'))
  })

  it('adds a term to a flow list in YAML', async () => {
    const text = '---\ntitle: A\ntags: ["bir"]\n---\nx\n'
    const result = await applyBulk(text, { kind: 'addTerm', taxonomy: 'tags', term: 'iki' }, noToml)
    expect(result.text).toBe('---\ntitle: A\ntags: ["bir", "iki"]\n---\nx\n')
  })

  it('reports unchanged files', async () => {
    const text = '---\ndraft: false\n---\n'
    expect((await applyBulk(text, { kind: 'draft', draft: false }, noToml)).skipped).toBe('unchanged')
  })

  it('skips JSON front matter', async () => {
    const text = '{\n  "title": "A"\n}\nbody\n'
    expect((await applyBulk(text, { kind: 'draft', draft: true }, noToml)).skipped).toBe('json')
  })

  it('edits TOML through the injected tools', async () => {
    const edit = vi.fn(async (fm: string) => fm.replace("tags = ['a']", "tags = ['a', 'b']"))
    const parse = vi.fn(async () => ({ tags: ['a'] }))
    const text = "+++\ntitle = 'A'\ntags = ['a']\n+++\nbody\n"
    const result = await applyBulk(text, { kind: 'addTerm', taxonomy: 'tags', term: 'b' }, { edit, parse })
    expect(edit).toHaveBeenCalledWith("title = 'A'\ntags = ['a']\n", [{ op: 'set', path: ['tags'], value: ['a', 'b'] }])
    expect(result.text).toBe("+++\ntitle = 'A'\ntags = ['a', 'b']\n+++\nbody\n")
  })
})
