import { describe, expect, it } from 'vitest'

import type { HugoModule } from '../../lib/api'
import { moduleComponent, type ThemeSourcesIo } from '../../lib/themeSources'
import { scanThemeImageParams, type ThemeScanDeps } from './themeImages'

function deps(files: Record<string, string>, extra: Partial<ThemeScanDeps> = {}): ThemeScanDeps {
  return {
    listFiles: async (dir) => Object.keys(files).filter((p) => p.startsWith(dir + '/')).map((path) => ({ path })),
    readText: async (path) => {
      if (!(path in files)) throw new Error(path)
      return { text: files[path] }
    },
    ...extra,
  }
}

describe('scanThemeImageParams', () => {
  it('reads the named themes under themes/ and the site templates', async () => {
    const found = await scanThemeImageParams(
      ['t'],
      deps({
        'themes/t/layouts/single.html': '{{ with .Params.cover.image }}<img src="{{ . }}">{{ end }}{{ .Params.title }}',
        'layouts/list.html': '{{ range .Params.images }}<img src="{{ . }}">{{ end }}',
      }),
    )
    expect(found).toEqual([
      { path: ['cover', 'image'], list: false },
      { path: ['images'], list: true },
    ])
  })

  it('reads theme components that are Hugo Modules outside the site', async () => {
    const dir = 'C:/cache/github.com/acme/theme@v1.0.0'
    const module: HugoModule = {
      path: 'github.com/acme/theme',
      version: 'v1.0.0',
      time: '',
      owner: 'project',
      dir,
      mounts: [{ source: 'templates', target: 'layouts' }],
      siteDir: null,
      vendored: false,
      modulePath: null,
    }
    const cache: Record<string, string> = { 'templates/single.html': '<img src="{{ .Params.featuredImage }}">' }
    const io: ThemeSourcesIo = {
      listFiles: async () => [],
      readText: () => Promise.reject(new Error('no site file')),
      siteHashFiles: async () => [],
      moduleList: async () => [module],
      moduleListFiles: async () => Object.keys(cache).map((path) => ({ path, size: cache[path].length })),
      moduleReadText: async (_, path) => ({ text: cache[path], version: '' }),
      moduleHashFiles: async () => [],
    }
    const found = await scanThemeImageParams(['github.com/acme/theme'], deps({}, { components: async () => [moduleComponent(module, io)] }))
    expect(found).toEqual([{ path: ['featuredImage'], list: false }])
  })
})
