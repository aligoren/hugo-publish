import { describe, expect, it } from 'vitest'

import { renderTemplate, templateKeys } from './template'

const render = (template: string, values: Record<string, string | number | boolean | undefined>, keys = Object.keys(values)) =>
  renderTemplate(template, { keys, values })

describe('renderTemplate', () => {
  it('replaces fields and leaves everything else alone', () => {
    expect(render('**{{title}}** by {{ author }}', { title: 'Suç ve Ceza', author: 'Dostoyevski' })).toBe('**Suç ve Ceza** by Dostoyevski')
    // Unknown names, Hugo shortcodes and Go template actions stay as written.
    expect(render('{{< figure src="{{src}}" >}} {{% note %}} {{ .Title }} {{other}}', { src: 'a.png' })).toBe(
      '{{< figure src="a.png" >}} {{% note %}} {{ .Title }} {{other}}',
    )
    // No escaping: the output is Markdown.
    expect(render('{{x}}', { x: '*a* <b>&' })).toBe('*a* <b>&')
  })

  it('shows sections only for filled fields', () => {
    const template = '{{title}}{{#author}} · {{author}}{{/author}}{{^author}} (anonim){{/author}}'
    expect(render(template, { title: 'A', author: 'B' })).toBe('A · B')
    expect(render(template, { title: 'A', author: '  ' })).toBe('A (anonim)')
    expect(render('{{#on}}yes{{/on}}{{^on}}no{{/on}}', { on: false })).toBe('no')
    expect(render('{{#n}}[{{n}}]{{/n}}', { n: 0 })).toBe('[0]')
  })

  it('drops the lines of standalone section tags', () => {
    const template = ['> **{{title}}**', '{{#isbn}}', '> ISBN {{isbn}}', '{{/isbn}}', '> end', ''].join('\n')
    expect(render(template, { title: 'T', isbn: '978' })).toBe('> **T**\n> ISBN 978\n> end\n')
    expect(render(template, { title: 'T', isbn: '' })).toBe('> **T**\n> end\n')
    expect(render(template.replace(/\n/g, '\r\n'), { title: 'T', isbn: '' })).toBe('> **T**\r\n> end\r\n')
  })

  it('handles nested sections', () => {
    const template = '{{#a}}A{{#b}}B{{/b}}{{/a}}'
    expect(render(template, { a: 'x', b: 'y' })).toBe('AB')
    expect(render(template, { a: 'x', b: '' })).toBe('A')
    expect(render(template, { a: '', b: 'y' })).toBe('')
  })

  it('applies filters', () => {
    const values = { t: 'Çağdaş Şiir', q: 'say "hi"\\now', m: 'bir\niki' }
    expect(render('{{t|slug}} {{t|upper}} {{t|lower}}', values)).toBe('cagdas-siir ÇAĞDAŞ ŞIIR çağdaş şiir')
    expect(render('x="{{q|attr}}"', values)).toBe('x="say \\"hi\\"\\\\now"')
    expect(render('> {{m|blockquote}}', values)).toBe('> bir\n> iki')
    expect(render('{{t|nope}}', values)).toBe('{{t|nope}}')
    const pages = new Map([['posts/a.md', { title: 'A yazısı', permalink: 'https://x.org/posts/a/' }]])
    expect(renderTemplate('[{{p|title}}]({{p|url}}) {{< ref "{{p}}" >}}', { keys: ['p'], values: { p: 'posts/a.md' }, pages })).toBe(
      '[A yazısı](https://x.org/posts/a/) {{< ref "posts/a.md" >}}',
    )
  })

  it('lists the names a template uses', () => {
    expect(templateKeys('{{a}} {{#b}}{{c|slug}}{{/b}} {{< x >}} {{ .Title }}')).toEqual(['a', 'b', 'c'])
  })
})
