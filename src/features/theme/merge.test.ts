import { describe, expect, it } from 'vitest'

import { buildDefaultsLayer, type ThemeConfigSource } from './defaults'
import { mergeLayers, type MergedModel } from './merge'
import { scanTemplates } from './scan/scanner'
import { L, type ThemeSchema } from './schema'
import { papermod } from './schemas/papermod'
import { suggestKeys, unknownParams, editDistance } from './unknown'

const emptyDefaults = buildDefaultsLayer([])

function field(model: MergedModel, key: string) {
  const f = model.fields.find((x) => x.key.toLowerCase() === key.toLowerCase())
  if (!f) throw new Error(`no field ${key}: ${model.fields.map((x) => x.key).join(', ')}`)
  return f
}

const tomlSource = (text: string, values: Record<string, unknown>, comments: Record<string, string> = {}, role: 'defaults' | 'example' = 'defaults'): ThemeConfigSource => ({
  path: role === 'defaults' ? 'config/_default/params.toml' : 'exampleSite/hugo.toml',
  role,
  prefix: role === 'defaults' ? [] : ['params'],
  values,
  comments,
  text,
  format: 'toml',
})

describe('mergeLayers', () => {
  it('takes each attribute from the most trusted layer and records provenance', () => {
    const scan = scanTemplates([
      {
        path: 'layouts/baseof.html',
        text: [
          '{{ if eq site.Params.defaultTheme "dark" }}{{ end }}{{ if eq site.Params.defaultTheme "light" }}{{ end }}',
          '{{ if site.Params.ShowToc }}{{ end }}',
          '{{ site.Params.footer.text | markdownify }}',
          '{{ site.Params.newThing }}',
        ].join('\n'),
      },
    ])
    const defaults = buildDefaultsLayer([
      tomlSource(
        'defaultTheme = "auto" # valid options: auto, light, dark\nnewThing = "x"\n# hidden = true # (defaults to false)\n',
        { defaultTheme: 'auto', newThing: 'x' },
        { defaultTheme: 'valid options: auto, light, dark' },
      ),
    ])
    const schema: ThemeSchema = {
      'x-theme': { id: 't', name: 'T', repos: [], themeTomlNames: [], folderNames: [], fingerprint: [] },
      'x-groups': [{ id: 'g', label: L('G', 'G') }],
      type: 'object',
      properties: { ShowToc: { type: 'boolean', default: false, 'x-group': 'g', 'x-label': L('ToC', 'İçindekiler') } },
    }
    const model = mergeLayers({ schema, scan, defaults, siteParams: {} })

    const toc = field(model, 'ShowToc')
    expect(toc).toMatchObject({ badge: 'documented', type: 'boolean', default: false, group: 'g' })
    expect(toc.provenance).toMatchObject({ type: 'curated', default: 'curated', label: 'curated' })
    expect(toc.sources).toEqual(['curated', 'scan'])

    const theme = field(model, 'defaultTheme')
    expect(theme).toMatchObject({ badge: 'defaults', type: 'enum', default: 'auto', options: ['auto', 'light', 'dark'], group: 'other' })
    expect(theme.provenance).toMatchObject({ default: 'defaults', options: 'defaults' })
    expect(theme.locations).toHaveLength(1)

    expect(field(model, 'footer.text')).toMatchObject({ badge: 'scanned', type: 'markdown', provenance: { type: 'scan' } })
    // A commented-out key is a known optional setting with its documented default.
    expect(field(model, 'hidden')).toMatchObject({ type: 'boolean', default: false, provenance: { default: 'comment' }, sources: ['comment'] })
  })

  it('builds the PaperMod model: curated fields, list items with scanned icon names, page docs', () => {
    const scan = scanTemplates([
      { path: 'layouts/_partials/social_icons.html', text: '{{ range site.Params.socialIcons }}{{ .url }}{{ partial "svg.html" . }}{{ end }}' },
      { path: 'layouts/_partials/svg.html', text: '{{ $n := trim .name " " | lower }}{{ if eq $n "github" }}{{ else if eq $n "x" }}{{ end }}' },
      { path: 'layouts/list.html', text: '{{ $p := where .Pages "Params.hiddenInHomeList" "!=" "true" }}{{ .Params.myPageOnly }}' },
      { path: 'layouts/_partials/extra.html', text: '{{ site.Params.notInSchema }}' },
    ])
    const model = mergeLayers({ schema: papermod, scan, defaults: emptyDefaults, siteParams: { ShowReadTime: true, mainsections: ['posts'] } })
    const icons = field(model, 'socialIcons')
    expect(icons.type).toBe('objectList')
    expect(icons.itemFields?.find((i) => i.name === 'name')).toMatchObject({ widget: 'iconSelect', options: ['github', 'x'], allowCustom: true })
    expect(field(model, 'notInSchema')).toMatchObject({ group: 'other', badge: 'scanned' })
    // Case-insensitive: the site's `mainsections` is the curated `mainSections`.
    expect(model.unknown).toEqual(['ShowReadTime'])
    expect(field(model, 'ShowReadTime')).toMatchObject({ badge: 'unused', group: 'other', type: 'boolean' })
    const hidden = model.pageParams.find((p) => p.key === 'hiddenInHomeList')
    expect(hidden).toMatchObject({ writeFalse: 'omit', source: 'curated' })
    expect(hidden?.whereCompares[0]).toMatchObject({ op: '!=', value: 'true' })
    expect(model.pageParams.find((p) => p.key === 'myPageOnly')?.source).toBe('scan')
    expect(model.groups[0].id).toBe('general')
    expect(model.groups[model.groups.length - 1].id).toBe('other')
    expect(Object.keys(model.features)).toEqual(['search', 'archives'])
  })

  it('works for an unknown theme from its commented params.toml and an exampleSite (Hugo Book style)', () => {
    const defaults = buildDefaultsLayer([
      tomlSource(
        '[header]\n  layout = "basic" # valid options: basic, fixed\n[footer]\n  showMenu = true\n',
        { header: { layout: 'basic' }, footer: { showMenu: true } },
        { 'header.layout': 'valid options: basic, fixed' },
      ),
      tomlSource(
        "[params]\n  # (Optional, default light) Sets color theme: light, dark or auto.\n  # You can also specify this parameter per page in front matter.\n  BookTheme = 'dark'\n",
        { params: { BookTheme: 'dark' } },
        { 'params.BookTheme': '(Optional, default light) Sets color theme: light, dark or auto.\nYou can also specify this parameter per page in front matter.' },
        'example',
      ),
    ])
    const model = mergeLayers({ schema: null, scan: null, defaults, siteParams: { custom: { a: 1 } } })
    expect(field(model, 'header.layout')).toMatchObject({ type: 'enum', options: ['basic', 'fixed'], group: 'params.header', badge: 'defaults' })
    expect(field(model, 'footer.showMenu')).toMatchObject({ type: 'boolean', default: true })
    expect(field(model, 'BookTheme')).toMatchObject({
      type: 'enum',
      default: 'light',
      example: 'dark',
      scope: 'both',
      optional: true,
      provenance: { default: 'example' },
    })
    expect(model.groups.map((g) => g.id)).toEqual(['general', 'params.footer', 'params.header', 'other'])
    expect(model.unknown).toEqual(['custom.a'])
  })

  it('does not report keys the site templates read, or children of objects passed around whole', () => {
    const scan = scanTemplates([{ path: 'layouts/x.html', text: '{{ with site.Params.giscus }}{{ partial "g.html" . }}{{ end }}' }])
    const model = mergeLayers({
      schema: null,
      scan,
      defaults: emptyDefaults,
      siteParams: { giscus: { repo: 'a/b' }, banner: 'hi' },
      siteTemplateKeys: new Set(['banner']),
    })
    expect(model.unknown).toEqual([])
    expect(field(model, 'banner').badge).toBe('siteTemplates')
    expect(field(model, 'giscus').type).toBe('object')
  })
})

describe('unknown params', () => {
  it('suggests near matches by edit distance and case', () => {
    expect(editDistance('ShowReadTime', 'ShowReadingTime')).toBe(3)
    expect(suggestKeys('ShowReadTime', ['ShowReadingTime', 'ShowToc', 'ShowWordCount'])).toEqual(['ShowReadingTime'])
    expect(suggestKeys('defaulttheme2', ['defaultTheme'])).toEqual(['defaultTheme'])
    expect(suggestKeys('article.ShowToc', ['ShowToc', 'ShowTocx'])).toEqual(['ShowToc'])
    expect(suggestKeys('foo', ['bar', 'description'])).toEqual([])
    expect(suggestKeys('label.icn', ['label.icon', 'label.text', 'icon'])).toEqual(['label.icon'])
  })

  it('marks page settings put into [params]', () => {
    expect(unknownParams(['hiddenInHomeList', 'ShowReadTime'], ['ShowReadingTime'], ['hiddenInHomeList'])).toEqual([
      { key: 'hiddenInHomeList', pageOnly: true, suggestions: [] },
      { key: 'ShowReadTime', pageOnly: false, suggestions: ['ShowReadingTime'] },
    ])
  })
})
