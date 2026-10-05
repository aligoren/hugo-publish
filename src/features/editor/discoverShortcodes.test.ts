import { describe, expect, it } from 'vitest'
import { discoverShortcodes, parseShortcodeTemplate, shortcodeNameFromPath, type DiscoverIo } from './discoverShortcodes'
import type { HugoModule } from '../../lib/api'

describe('parseShortcodeTemplate', () => {
  it('finds named and positional parameters', () => {
    const def = parseShortcodeTemplate(
      'video',
      `{{ $src := .Get "src" }}
{{ with .Get "poster" }}<img src="{{ . }}">{{ end }}
{{ $w := index .Params "width" }}{{ .Params.height }}
<video src="{{ $src }}" {{ with .Get 1 }}title="{{ . }}"{{ end }}></video>`,
      'site',
    )
    expect(def).toEqual({
      name: 'video',
      source: 'site',
      paired: false,
      params: [{ name: '1', positional: 1, positionalOnly: true }, { name: 'src' }, { name: 'poster' }, { name: 'width' }, { name: 'height' }],
    })
  })

  it('merges a named parameter with a positional fallback in one action', () => {
    const def = parseShortcodeTemplate('yt', '{{ $id := .Get "id" | default (.Get 0) }}{{ $t := or (.Get `title`) "" }}', 'theme')
    expect(def.params).toEqual([{ name: 'id', positional: 0 }, { name: 'title' }])
  })

  it('names a positional parameter after the variable it is assigned to', () => {
    expect(parseShortcodeTemplate('kod', '{{- $lang := .Get 0 -}}{{ $opts := .Get 1 }}', 'site').params).toEqual([
      { name: 'lang', positional: 0, positionalOnly: true },
      { name: 'opts', positional: 1, positionalOnly: true },
    ])
  })

  it('detects paired and Markdown inner content, and a leading description', () => {
    const md = parseShortcodeTemplate(
      'not',
      '{{/* Bir not kutusu.\n   Kullanım: {{< not >}}…{{< /not >}} */}}\n<aside>{{ .Inner | .Page.RenderString }}</aside>',
      'site',
    )
    expect(md).toMatchObject({ paired: true, markdown: true, description: 'Bir not kutusu.' })
    expect(parseShortcodeTemplate('raw', '<pre>{{ .InnerDeindent }}</pre>', 'site')).toMatchObject({ paired: true })
    expect(parseShortcodeTemplate('raw', '<pre>{{ .InnerDeindent }}</pre>', 'site').markdown).toBeUndefined()
    expect(parseShortcodeTemplate('md', '{{ markdownify .Inner }}', 'site').markdown).toBe(true)
  })

  it('ignores parameters mentioned only in comments', () => {
    expect(parseShortcodeTemplate('c', '{{/* .Get "old" */}}{{ .Get "new" }}', 'site').params).toEqual([{ name: 'new' }])
  })
})

describe('shortcodeNameFromPath', () => {
  it('derives names, including folders and suffixes', () => {
    expect(shortcodeNameFromPath('layouts/_shortcodes/note.html', 'layouts/_shortcodes')).toBe('note')
    expect(shortcodeNameFromPath('layouts/_shortcodes/dir/card.en.amp.html', 'layouts/_shortcodes')).toBe('dir/card')
    expect(shortcodeNameFromPath('layouts/_shortcodes/x.json', 'layouts/_shortcodes')).toBe(null)
    expect(shortcodeNameFromPath('layouts/partials/x.html', 'layouts/_shortcodes')).toBe(null)
  })
})

describe('discoverShortcodes', () => {
  function fakeIo(files: Record<string, string>, configs: Record<string, Record<string, unknown>>): DiscoverIo & { reads: string[] } {
    const reads: string[] = []
    return {
      reads,
      async listFiles(dir) {
        return Object.keys(files)
          .filter((p) => p.startsWith(dir + '/'))
          .map((path) => ({ path }))
      },
      async readText(path) {
        reads.push(path)
        if (!(path in files)) throw new Error('missing')
        return { text: files[path] }
      },
      async readConfig(path) {
        if (!(path in configs)) throw new Error('missing')
        return configs[path]
      },
    }
  }

  it('reads the site and its theme, the site overriding the theme', async () => {
    const io = fakeIo(
      {
        'layouts/_shortcodes/note.html': '{{ .Get "type" }}{{ .Inner | markdownify }}',
        'layouts/shortcodes/legacy.html': '{{ .Get 0 }}',
        'themes/papermod/layouts/_shortcodes/note.html': '{{ .Get "theme-only" }}',
        'themes/papermod/layouts/shortcodes/collapse.html': '{{ .Get "summary" }}{{ .Inner }}',
        'themes/other/layouts/_shortcodes/unused.html': '',
      },
      { 'hugo.toml': { Theme: 'papermod', title: 'x' } },
    )
    const defs = await discoverShortcodes({ configFiles: ['hugo.toml', 'config/_default/params.toml'], io })
    expect(defs.map((d) => [d.name, d.source])).toEqual([
      ['collapse', 'theme'],
      ['legacy', 'site'],
      ['note', 'site'],
    ])
    expect(defs.find((d) => d.name === 'note')).toMatchObject({ paired: true, markdown: true, params: [{ name: 'type' }] })
  })

  it('handles theme lists, themesDir and missing config files', async () => {
    const io = fakeIo(
      {
        'tema/a/layouts/_shortcodes/x.html': '{{ .Get "from-a" }}',
        'tema/b/layouts/_shortcodes/x.html': '{{ .Get "from-b" }}',
        'tema/b/layouts/_shortcodes/y.html': '',
      },
      { 'config/_default/hugo.yaml': { theme: ['a', 'b'], themesDir: 'tema/' } },
    )
    const defs = await discoverShortcodes({ io })
    // The first theme in the list wins.
    expect(defs.map((d) => [d.name, d.params.map((p) => p.name)])).toEqual([
      ['x', ['from-a']],
      ['y', []],
    ])
  })

  it('returns nothing for a site without shortcodes or theme', async () => {
    expect(await discoverShortcodes({ io: fakeIo({}, {}) })).toEqual([])
  })
})

describe('discoverShortcodes with Hugo Modules', () => {
  it('reads theme components from the module cache and _vendor/ in Hugo’s order', async () => {
    const site: Record<string, string> = {
      'layouts/_shortcodes/site.html': '{{ .Get "s" }}',
      '_vendor/github.com/acme/second/layouts/_shortcodes/both.html': '{{ .Get "from-second" }}',
      '_vendor/github.com/acme/second/layouts/_shortcodes/second.html': '',
    }
    const cache: Record<string, string> = {
      'layouts/_shortcodes/both.html': '{{ .Get "from-first" }}',
      'src/shortcodes/mounted.html': '{{ .Inner }}',
    }
    const dir = 'C:/cache/github.com/acme/first@v1.0.0'
    const modules: HugoModule[] = [
      {
        path: 'github.com/acme/first',
        version: 'v1.0.0',
        time: '',
        owner: 'project',
        dir,
        mounts: [
          { source: 'layouts', target: 'layouts' },
          { source: 'src/shortcodes', target: 'layouts/_shortcodes' },
        ],
        siteDir: null,
        vendored: false,
        modulePath: 'github.com/acme/first',
      },
      {
        path: 'github.com/acme/second',
        version: 'v2.0.0',
        time: '',
        owner: 'github.com/acme/first',
        dir: 'C:/site/_vendor/github.com/acme/second',
        mounts: [],
        siteDir: '_vendor/github.com/acme/second',
        vendored: true,
        modulePath: null,
      },
    ]
    const listed = (files: Record<string, string>, dir: string) =>
      Object.keys(files)
        .filter((p) => dir === '.' || p.startsWith(dir + '/'))
        .map((path) => ({ path, size: files[path].length }))
    const read = (files: Record<string, string>, path: string) => (path in files ? Promise.resolve({ text: files[path], version: '' }) : Promise.reject(new Error(path)))
    const io: DiscoverIo = {
      listFiles: async (d) => listed(site, d),
      readText: (p) => read(site, p),
      readConfig: async (p) => {
        if (p === 'hugo.toml') return { module: { imports: [{ path: 'github.com/acme/first' }] } }
        throw new Error('missing')
      },
      sources: {
        listFiles: async (d) => listed(site, d),
        readText: (p) => read(site, p),
        siteHashFiles: async () => [],
        moduleList: async () => modules,
        moduleListFiles: async (d, sub) => (d === dir ? listed(cache, sub) : []),
        moduleReadText: (d, p) => (d === dir ? read(cache, p) : Promise.reject(new Error(p))),
        moduleHashFiles: async () => [],
      },
    }
    const defs = await discoverShortcodes({ io })
    expect(defs.map((d) => [d.name, d.source, d.params.map((p) => p.name)])).toEqual([
      ['both', 'theme', ['from-first']],
      ['mounted', 'theme', []],
      ['second', 'theme', []],
      ['site', 'site', ['s']],
    ])
    expect(defs.find((d) => d.name === 'mounted')?.paired).toBe(true)
  })
})
