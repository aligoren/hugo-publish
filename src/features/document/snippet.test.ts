import { describe, expect, it } from 'vitest'

import { joinFrontMatter, splitFrontMatter } from '../../lib/frontmatter'
import { applySnippet, extractSnippet, replaceSnippet, yamlKeyLines } from './snippet'
import { fakeTomlParse } from './testing/fakeToml'

const YAML = [
  '---',
  'title: "Başlık"',
  '# Tema parametreleri',
  'params:',
  '  toc: true',
  '  # iç yorum',
  '  nested:',
  '    deep: 1',
  'list:',
  '- bir',
  '- iki',
  '',
  'description: "x"',
  '---',
  'Gövde',
  '',
].join('\r\n')

const parsers = { parseToml: async (text: string) => fakeTomlParse(text) }

describe('yamlKeyLines / extractSnippet', () => {
  it('cuts out a nested map with the comment above it', () => {
    const parts = splitFrontMatter(YAML)
    expect(extractSnippet(parts, 'params')).toBe('# Tema parametreleri\nparams:\n  toc: true\n  # iç yorum\n  nested:\n    deep: 1')
  })

  it('handles block lists at column 0 and leaves trailing blank lines out', () => {
    const parts = splitFrontMatter(YAML)
    expect(extractSnippet(parts, 'list')).toBe('list:\n- bir\n- iki')
  })

  it('handles quoted keys', () => {
    expect(yamlKeyLines('"a b":\n  x: 1\nc: 2\n', 'a b')).toEqual({ start: 0, end: 2 })
    expect(yamlKeyLines('a: 1\n', 'zzz')).toBeNull()
  })
})

describe('replaceSnippet / applySnippet', () => {
  it('puts the edited text back, keeping every other byte and the file’s CRLF', async () => {
    const parts = splitFrontMatter(YAML)
    const result = await applySnippet(parts, 'params', 'params:\n  toc: false\n  nested:\n    deep: 2', parsers)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toEqual({ toc: false, nested: { deep: 2 } })
    expect(joinFrontMatter({ ...parts, frontMatterText: result.frontMatterText })).toBe(
      YAML.replace('# Tema parametreleri\r\nparams:\r\n  toc: true\r\n  # iç yorum\r\n  nested:\r\n    deep: 1', 'params:\r\n  toc: false\r\n  nested:\r\n    deep: 2'),
    )
  })

  it('removes the key when the snippet is emptied', () => {
    const parts = splitFrontMatter(YAML)
    expect(replaceSnippet(parts, 'list', '')).toBe(parts.frontMatterText.replace('list:\r\n- bir\r\n- iki\r\n', ''))
  })

  it('rejects invalid text and changes to other keys', async () => {
    const parts = splitFrontMatter(YAML)
    expect(await applySnippet(parts, 'params', 'params:\n  toc: [', parsers)).toMatchObject({ ok: false, reason: 'syntax' })
    // A second `title` makes the mapping invalid.
    expect(await applySnippet(parts, 'params', 'params:\n  toc: true\ntitle: "Başka"', parsers)).toMatchObject({
      ok: false,
      reason: 'syntax',
    })
    expect(await applySnippet(parts, 'params', 'params:\n  toc: true\nextra: 1', parsers)).toMatchObject({ ok: false, reason: 'otherKeys' })
  })

  it('works on TOML tables', async () => {
    const text = ['+++', 'title = "x"', '', '[params]', '  toc = true', '', '[other]', '  a = 1', '+++', 'Gövde', ''].join('\n')
    const parts = splitFrontMatter(text)
    expect(extractSnippet(parts, 'params')).toBe('[params]\n  toc = true')
    const result = await applySnippet(parts, 'params', '[params]\n  toc = false\n  math = true', parsers)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.frontMatterText).toBe('title = "x"\n\n[params]\n  toc = false\n  math = true\n\n[other]\n  a = 1\n')
    expect(await applySnippet(parts, 'params', '[params]\n  toc = false\n\n[extra]\n  b = 1', parsers)).toMatchObject({
      ok: false,
      reason: 'otherKeys',
    })
  })
})
