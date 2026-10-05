import { describe, expect, it } from 'vitest'

import type { FileHash, HugoModule, SiteFile, TextFile } from './api'
import {
  componentFor,
  folderCandidates,
  listThemeComponents,
  moduleComponent,
  realPath,
  siteComponent,
  themeSettingsFromConfigs,
  virtualPath,
  type ThemeSourcesIo,
} from './themeSources'

function module(partial: Partial<HugoModule> & { path: string; dir: string }): HugoModule {
  return { version: '', time: '', owner: 'project', mounts: [], siteDir: null, vendored: false, modulePath: null, ...partial }
}

/** Site files and module folders in memory; `modules` answers `hugo config mounts` (or fails). */
function fakeIo(site: Record<string, string>, dirs: Record<string, Record<string, string>> = {}, modules: HugoModule[] | Error = new Error('no hugo')) {
  const calls: string[] = []
  const list = (files: Record<string, string>, prefix: string): SiteFile[] =>
    Object.keys(files)
      .filter((p) => prefix === '' || p.startsWith(prefix + '/'))
      .sort()
      .map((path) => ({ path, size: files[path].length }))
  const read = (files: Record<string, string>, path: string): Promise<TextFile> =>
    path in files ? Promise.resolve({ text: files[path], version: 'v' }) : Promise.reject(new Error(`missing ${path}`))
  const hash = (files: Record<string, string>, paths: string[]): FileHash[] => paths.filter((p) => p in files).map((p) => ({ path: p, sha256: `h(${files[p]})`, size: files[p].length }))
  const io: ThemeSourcesIo = {
    listFiles: async (dir) => list(site, dir),
    readText: (path) => read(site, path),
    siteHashFiles: async (paths) => hash(site, paths),
    moduleList: async () => {
      calls.push('moduleList')
      if (modules instanceof Error) throw modules
      return modules
    },
    moduleListFiles: async (dir, sub) => list(dirs[dir] ?? {}, sub === '.' ? '' : sub),
    moduleReadText: (dir, path) => read(dirs[dir] ?? {}, path),
    moduleHashFiles: async (dir, paths) => hash(dirs[dir] ?? {}, paths),
  }
  return { io, calls }
}

describe('mount paths', () => {
  const mounts = [
    { source: 'layouts', target: 'layouts' },
    { source: 'dist', target: 'assets/js' },
    { source: 'dist/css', target: 'assets/css' },
  ]

  it('maps module files to the paths Hugo sees and back', () => {
    expect(virtualPath('layouts/a.html', mounts)).toBe('layouts/a.html')
    expect(virtualPath('dist/app.js', mounts)).toBe('assets/js/app.js')
    expect(virtualPath('dist/css/main.css', mounts)).toBe('assets/css/main.css')
    expect(virtualPath('theme.toml', mounts)).toBe('theme.toml')
    expect(realPath('assets/js/app.js', mounts)).toBe('dist/app.js')
    expect(realPath('assets/css/main.css', mounts)).toBe('dist/css/main.css')
    expect(realPath('i18n/en.yaml', mounts)).toBe('i18n/en.yaml')
  })
})

describe('themeSettingsFromConfigs', () => {
  it('reads theme names, themesDir and module imports by precedence', () => {
    expect(
      themeSettingsFromConfigs([
        { path: 'hugo.toml', values: { theme: 'root', themesDir: '../shared/' } },
        { path: 'config/_default/hugo.toml', values: { Theme: ['a', 'b'], module: { imports: [{ path: 'github.com/x/y' }] } } },
        { path: 'config/_default/module.yaml', values: { imports: [{ path: 'github.com/z/w' }, 'github.com/x/y'] } },
        { path: 'config/_default/params.toml', values: { theme: 'not-this', module: { imports: [{ path: 'nope' }] } } },
      ]),
    ).toEqual({ themes: ['a', 'b'], themesDir: '../shared', imports: ['github.com/x/y', 'github.com/z/w'] })
    expect(themeSettingsFromConfigs([])).toEqual({ themes: [], themesDir: 'themes', imports: [] })
    expect(folderCandidates('github.com/acme/theme', 'themes')).toEqual(['themes/github.com/acme/theme', '_vendor/github.com/acme/theme', 'themes/theme'])
  })
})

describe('listThemeComponents', () => {
  it('uses the themes folder alone when every theme is there (fast path)', async () => {
    const { io, calls } = fakeIo({ 'tema/a/layouts/x.html': 'A', 'tema/a/theme.toml': 'name = "a"', 'tema/b/layouts/y.html': 'B' })
    const result = await listThemeComponents({ themes: ['a', 'b'], themesDir: 'tema', imports: [] }, io)
    expect(calls).toEqual([])
    expect(result.components.map((c) => [c.name, c.location, c.root, c.label])).toEqual([
      ['a', 'site', 'tema/a', 'tema/a'],
      ['b', 'site', 'tema/b', 'tema/b'],
    ])
    const a = result.components[0]
    expect((await a.list('layouts')).map((f) => f.path)).toEqual(['layouts/x.html'])
    expect((await a.read('layouts/x.html')).text).toBe('A')
    expect(await a.hash(['layouts/x.html', 'gone.html'])).toEqual([{ path: 'layouts/x.html', sha256: 'h(A)', size: 1 }])
  })

  it('asks Hugo for modules, themes that import more, and missing folders', async () => {
    const cache = 'C:/cache/github.com/acme/theme@v1.2.0'
    const modules = [
      module({ path: 'github.com/acme/theme', version: 'v1.2.0', dir: cache, mounts: [{ source: 'layouts', target: 'layouts' }, { source: 'dist', target: 'assets/js' }] }),
      module({ path: 'github.com/acme/vendored', version: 'v2.0.0', dir: 'C:/site/_vendor/github.com/acme/vendored', siteDir: '_vendor/github.com/acme/vendored', vendored: true }),
      module({ path: '../../local', dir: 'C:/local', modulePath: 'example.org/local' }),
    ]
    const { io, calls } = fakeIo(
      { '_vendor/github.com/acme/vendored/layouts/v.html': 'V' },
      { [cache]: { 'layouts/t.html': 'T', 'dist/app.js': 'JS', 'go.mod': 'module github.com/acme/theme' } },
      modules,
    )
    const result = await listThemeComponents({ themes: [], themesDir: 'themes', imports: ['github.com/acme/theme'] }, io)
    expect(calls).toEqual(['moduleList'])
    expect(result.fromHugo).toBe(true)
    const [cached, vendored, local] = result.components
    expect([cached.name, cached.location, cached.label]).toEqual(['github.com/acme/theme', 'module', 'github.com/acme/theme@v1.2.0'])
    expect((await cached.list('.')).map((f) => f.path)).toEqual(['assets/js/app.js', 'go.mod', 'layouts/t.html'])
    expect((await cached.list('assets')).map((f) => f.path)).toEqual(['assets/js/app.js'])
    expect((await cached.read('assets/js/app.js')).text).toBe('JS')
    expect(await cached.hash(['assets/js/app.js'])).toEqual([{ path: 'assets/js/app.js', sha256: 'h(JS)', size: 2 }])
    expect([vendored.location, vendored.root]).toEqual(['site', '_vendor/github.com/acme/vendored'])
    expect((await vendored.list('layouts')).map((f) => f.path)).toEqual(['layouts/v.html'])
    expect([local.name, local.location, local.label]).toEqual(['example.org/local', 'module', 'example.org/local'])
    expect(componentFor(result.components, 'example.org/local')).toBe(local)
    expect(componentFor(result.components, 'nothing')).toBeNull()

    // A theme in themes/ whose own config imports further components also needs Hugo.
    const nested = fakeIo({ 'themes/t/layouts/a.html': '', 'themes/t/hugo.toml': '[module]\n[[module.imports]]\npath = "x"\n' }, {}, [module({ path: 't', dir: 'C:/site/themes/t', siteDir: 'themes/t' })])
    const viaHugo = await listThemeComponents({ themes: ['t'], themesDir: 'themes', imports: [] }, nested.io)
    expect(nested.calls).toEqual(['moduleList'])
    expect(viaHugo.components.map((c) => [c.name, c.location, c.root, c.label])).toEqual([['t', 'site', 'themes/t', 'themes/t']])
  })

  it('falls back to folders inside the site when Hugo cannot be asked', async () => {
    const { io } = fakeIo({ '_vendor/github.com/acme/theme/layouts/a.html': '' })
    const result = await listThemeComponents({ themes: [], themesDir: 'themes', imports: ['github.com/acme/theme', 'github.com/acme/gone'] }, io)
    expect(result.fromHugo).toBe(false)
    expect(result.error).toBeInstanceOf(Error)
    expect(result.components.map((c) => c.root)).toEqual(['_vendor/github.com/acme/theme'])
    expect(result.missing).toEqual(['github.com/acme/gone'])
    expect(await listThemeComponents({ themes: [], themesDir: 'themes', imports: [] }, io)).toMatchObject({ components: [], missing: [] })
  })

  it('builds components directly', async () => {
    const { io } = fakeIo({ 'themes/x/a.css': 'body{}' })
    const site = siteComponent('x', './themes/x/', io)
    expect(site.root).toBe('themes/x')
    expect((await site.list()).map((f) => f.path)).toEqual(['a.css'])
    const vendored = moduleComponent(module({ path: 'github.com/a/b', version: 'v1.0.0', dir: 'C:/s/_vendor/github.com/a/b', siteDir: '_vendor/github.com/a/b', vendored: true }), io)
    expect([vendored.location, vendored.label]).toEqual(['site', 'github.com/a/b@v1.0.0'])
  })
})
