import { describe, expect, it } from 'vitest'

import { messages } from './messages'
import {
  archetypeFor,
  archetypeForDocument,
  findPlaceholders,
  isTrivialLine,
  runChecks,
  summarizeChecks,
  type CheckIssue,
} from './runChecks'

const rules = (issues: CheckIssue[]) => issues.map((i) => i.rule)
const post = (frontMatter: string, body = '\nBir paragraf metin, yeterince uzun.\n') => `---\n${frontMatter}---\n${body}`

const ARCHETYPE = [
  '---',
  'title: "{{ replace .File.ContentBaseName "-" " " | title }}"',
  'date: {{ .Date }}',
  'draft: true',
  'description: "Kısa bir açıklama yaz"',
  '---',
  '',
  '## Giriş',
  '',
  'Buraya giriş paragrafı yazılacak.',
  '',
  '> [!NOTE]',
  '> Bu kısım {{ .Name }} için not alanıdır.',
  '',
  '---',
  '',
  'Kaynak:',
  '',
].join('\n')

describe('runChecks', () => {
  it('passes a complete post', () => {
    expect(runChecks({ path: 'content/posts/a.md', text: post('title: Merhaba\ndescription: Kısa bir özet.\n') })).toEqual([])
  })

  it('reports a missing or empty title as an error, and only as a hint on list pages', () => {
    for (const fm of ['draft: false\n', 'title: ""\n', 'title: "   "\n', 'title:\n']) {
      const issues = runChecks({ path: 'content/posts/a.md', text: post(fm) })
      expect(issues[0]).toMatchObject({ rule: 'title-missing', severity: 'error', messageKey: 'rules.titleMissing' })
    }
    const list = runChecks({ path: 'content/posts/_index.md', text: '---\ndraft: false\n---\n' })
    expect(list).toEqual([expect.objectContaining({ rule: 'title-missing', severity: 'info' })])
  })

  it('reports invalid front matter', () => {
    const issues = runChecks({ path: 'content/a.md', text: post('title: [unclosed\n') })
    expect(issues[0]).toMatchObject({ rule: 'front-matter-invalid', severity: 'error' })
    expect(issues[0].params?.detail).toBeTruthy()
  })

  it('wants a description when the key exists, the site uses them, or the archetype has one', () => {
    const empty = runChecks({ path: 'content/a.md', text: post('title: A\ndescription: ""\n') })
    expect(rules(empty)).toEqual(['description-empty'])
    expect(rules(runChecks({ path: 'content/a.md', text: post('title: A\n') }))).toEqual([])
    expect(rules(runChecks({ path: 'content/a.md', text: post('title: A\n'), siteUsesDescription: true }))).toEqual([
      'description-empty',
    ])
    expect(
      rules(runChecks({ path: 'content/a.md', text: post('title: A\n'), archetypeText: '---\ndescription: ""\n---\n' })),
    ).toEqual(['description-empty'])
  })

  it('warns about descriptions longer than search engines show', () => {
    const long = 'ğ'.repeat(161)
    const issues = runChecks({ path: 'content/a.md', text: post(`title: A\ndescription: "${long}"\n`) })
    expect(issues).toEqual([
      { rule: 'description-long', severity: 'warn', messageKey: 'rules.descriptionLong', params: { count: 161, max: 160 } },
    ])
    expect(runChecks({ path: 'content/a.md', text: post(`title: A\ndescription: "${'ğ'.repeat(160)}"\n`) })).toEqual([])
  })

  it('notes drafts', () => {
    const issues = runChecks({ path: 'content/a.md', text: post('title: A\ndraft: true\n') })
    expect(issues).toEqual([{ rule: 'draft', severity: 'info', messageKey: 'rules.draft' }])
  })

  it('reads TOML and JSON front matter too', () => {
    const toml = "+++\ntitle = 'Merhaba'\ndraft = true\ndescription = \"\"\n[params]\ntitle = 'x'\n+++\nMetin burada duruyor.\n"
    expect(rules(runChecks({ path: 'content/a.md', text: toml }))).toEqual(['description-empty', 'draft'])
    const json = '{\n  "title": "",\n  "draft": false\n}\nMetin burada duruyor.\n'
    expect(rules(runChecks({ path: 'content/a.md', text: json }))).toEqual(['title-missing'])
  })

  it('finds empty bodies, ignoring comments, but not on list pages', () => {
    expect(rules(runChecks({ path: 'content/a.md', text: post('title: A\n', '\n<!-- sonra -->\n\n') }))).toEqual(['body-empty'])
    expect(rules(runChecks({ path: 'content/a.md', text: 'title only, no front matter' }))).toEqual(['title-missing'])
    expect(rules(runChecks({ path: 'content/posts/_index.md', text: post('title: A\n', '') }))).toEqual([])
  })

  it('finds images without alt text, with line numbers in the whole file', () => {
    const body = [
      '',
      '![](a.jpg)',
      '![Kedi](b.jpg)',
      '<img src="c.jpg">',
      '<img src="d.jpg" alt="Köpek">',
      '{{< figure src="e.jpg" >}}',
      '{{< figure src="f.jpg" alt="Kuş" >}}',
      '`![](kod.jpg)`',
      '```',
      '![](fenced.jpg)',
      '```',
    ].join('\n')
    const issues = runChecks({ path: 'content/a.md', text: post('title: A\n', body) })
    expect(issues.filter((i) => i.rule === 'image-alt').map((i) => i.line)).toEqual([5, 7, 9])
  })

  it('notes a top-level heading in the body once', () => {
    const issues = runChecks({ path: 'content/a.md', text: post('title: A\n', '\n# Başlık\n\nMetin.\n\n# İkinci\n') })
    expect(issues).toEqual([{ rule: 'body-h1', severity: 'info', messageKey: 'rules.bodyH1', line: 5 }])
    expect(rules(runChecks({ path: 'content/a.md', text: post('title: A\n', '\n## Alt başlık\n\nMetin.\n') }))).toEqual([])
  })

  it('finds bracket and word placeholders outside code and links', () => {
    const body = '\nGiriş [buraya bir alıntı ekle] ve TK.\nUçuş TK 1234 ile gidildi.\n`TODO` ve [TODO: kaynak](https://x.org/TODO).\n'
    const issues = runChecks({ path: 'content/a.md', text: post('title: A\n', body) })
    expect(issues.filter((i) => i.rule === 'placeholder').map((i) => [i.line, i.params?.text])).toEqual([
      [5, '[buraya bir alıntı ekle]'],
      [5, 'TK'],
    ])
  })

  it('sorts errors first and caps line issues per rule', () => {
    const body = '\n' + Array.from({ length: 15 }, () => '![](x.png)').join('\n') + '\n'
    const issues = runChecks({ path: 'content/a.md', text: post('draft: true\n', body) })
    expect(issues[0].rule).toBe('title-missing')
    expect(issues.filter((i) => i.rule === 'image-alt')).toHaveLength(10)
    expect(issues.at(-1)!.rule).toBe('draft')
  })

  describe('archetype leftovers', () => {
    it('flags body lines left exactly as in the archetype, with CRLF text', () => {
      const text = [
        '---',
        'title: "Gerçek Başlık"',
        'description: "Kısa bir açıklama yaz"',
        'draft: false',
        '---',
        '',
        '## Giriş',
        '',
        '  Buraya giriş paragrafı yazılacak.  ',
        '',
        'Kendi yazdığım ilk paragraf burada.',
        '',
        '> [!NOTE]',
        '> Bu kısım yazi-adi için not alanıdır.',
        '',
        '---',
        '',
        'Kaynak:',
      ].join('\r\n')
      const issues = runChecks({ path: 'content/posts/a.md', text, archetypeText: ARCHETYPE.replace(/\n/g, '\r\n') })
      const leftovers = issues.filter((i) => i.rule === 'archetype-leftover')
      expect(leftovers).toEqual([
        {
          rule: 'archetype-leftover',
          severity: 'warn',
          messageKey: 'rules.archetypeLeftoverField',
          params: { field: 'description', text: 'Kısa bir açıklama yaz' },
        },
        {
          rule: 'archetype-leftover',
          severity: 'warn',
          messageKey: 'rules.archetypeLeftover',
          params: { text: 'Buraya giriş paragrafı yazılacak.' },
          line: 9,
        },
        {
          rule: 'archetype-leftover',
          severity: 'warn',
          messageKey: 'rules.archetypeLeftover',
          params: { text: '> Bu kısım yazi-adi için not alanıdır.' },
          line: 14,
        },
      ])
    })

    it('ignores headings, rules, markers and short lines', () => {
      for (const line of ['## Giriş', '---', '> [!NOTE]', 'Kaynak:', '{{< youtube id >}}', '<div dir="rtl">', '| --- | :-: |', '']) {
        expect(isTrivialLine(line)).toBe(true)
      }
      expect(isTrivialLine('Buraya giriş paragrafı yazılacak.')).toBe(false)
    })

    it('does nothing without an archetype', () => {
      const text = post('title: A\n', '\nBuraya giriş paragrafı yazılacak.\n')
      expect(runChecks({ path: 'content/posts/a.md', text })).toEqual([])
    })

    it('picks the archetype by section, else default', () => {
      const archetypes = [
        { name: 'default', text: 'D' },
        { name: 'posts', text: 'P' },
        { name: 'notlar', text: 'N' },
      ]
      expect(archetypeFor('content/posts/a.md', archetypes)).toBe('P')
      expect(archetypeFor('content/posts/a/index.md', archetypes)).toBe('P')
      expect(archetypeFor(String.raw`content\notlar\b.md`, archetypes)).toBe('N')
      expect(archetypeFor('content/about.md', archetypes)).toBe('D')
      expect(archetypeFor('content/projeler/x.md', archetypes)).toBe('D')
      expect(archetypeFor('content/projeler/x.md', [{ name: 'posts', text: 'P' }])).toBeNull()
    })

    it('prefers the archetype whose lines the document still contains', () => {
      const archetypes = [
        { name: 'default', text: '---\n---\nVarsayılan şablonun uzun satırı.\n' },
        { name: 'kitap', text: '---\n---\nKitabın künyesini buraya ekleyin lütfen.\n' },
      ]
      const text = post('title: A\n', '\nKitabın künyesini buraya ekleyin lütfen.\n')
      expect(archetypeForDocument('content/posts/a.md', text, archetypes)).toBe(archetypes[1].text)
      expect(archetypeForDocument('content/posts/a.md', post('title: A\n'), archetypes)).toBe(archetypes[0].text)
    })
  })
})

describe('findPlaceholders', () => {
  it('skips links, footnotes, task boxes, alerts and images', () => {
    expect(findPlaceholders('[metin](https://x.org) [^1] [x] [ ] > [!NOTE] ![buraya](a.png) [ref][1] \\[buraya\\]')).toEqual([])
    expect(findPlaceholders('[here] [Insert quote] [xxx] lorem ipsum FIXME')).toEqual([
      '[here]',
      '[Insert quote]',
      '[xxx]',
      'FIXME',
      'lorem ipsum',
    ])
  })
})

describe('summarizeChecks', () => {
  it('counts by severity and files with problems', () => {
    const summary = summarizeChecks([
      { path: 'a', issues: [{ rule: 'x', severity: 'error', messageKey: 'x' }, { rule: 'y', severity: 'info', messageKey: 'y' }] },
      { path: 'b', issues: [{ rule: 'y', severity: 'info', messageKey: 'y' }] },
      { path: 'c', issues: [{ rule: 'z', severity: 'warn', messageKey: 'z' }] },
    ])
    expect(summary).toEqual({ errors: 1, warnings: 1, infos: 2, filesWithProblems: 2 })
  })
})

describe('messages', () => {
  it('has a translation for every rule message', () => {
    const keys = Object.keys(messages.en.rules)
    expect(Object.keys(messages.tr.rules)).toEqual(keys)
    for (const key of keys) expect(messages.tr.rules[key as keyof typeof messages.tr.rules]).not.toBe('')
  })
})

describe('raw HTML', () => {
  const body = [
    '',
    'Satır<br>devamı',
    '<div dir="rtl">',
    'Metin <https://example.org> ve <ad@example.org>',
    '{{< figure src="a.png" alt="A" >}}',
    'Kod: `<span>`',
    '```html',
    '<p>örnek</p>',
    '```',
    '',
  ].join('\n')
  const text = post('title: A\ndescription: B\n', body)
  const rawHtml = (rawHtmlAllowed?: boolean) =>
    runChecks({ path: 'content/a.md', text, rawHtmlAllowed }).filter((i) => i.rule === 'raw-html')

  it('warns about tags Hugo drops when raw HTML is off', () => {
    expect(rawHtml(false).map((i) => [i.params?.tag, i.line])).toEqual([
      ['br', 6],
      ['div', 7],
    ])
  })

  it('is silent when raw HTML is allowed or the setting is unknown', () => {
    expect(rawHtml(true)).toEqual([])
    expect(rawHtml(undefined)).toEqual([])
  })
})
