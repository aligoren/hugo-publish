// @vitest-environment jsdom
import { act, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ConfigOp, SiteInfo } from '../../lib/api'
import i18n from '../../i18n'
import { SiteContext, type SiteContextValue } from '../site/SiteContext'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// --- A PaperMod-like site in memory -------------------------------------------------------------

const HUGO_TOML = `baseURL = "https://example.org/"
title = "My Blog"
theme = "PaperMod"

[params]
  ShowReadingTime = true
  ShowReadTime = true
  defaultTheme = "light"

  [[params.socialIcons]]
    name = "github"
    url = "https://github.com/example"
`

interface Fixture {
  text: string
  values?: Record<string, unknown>
}

const files: Record<string, Fixture> = {
  'hugo.toml': {
    text: HUGO_TOML,
    values: {
      baseURL: 'https://example.org/',
      title: 'My Blog',
      theme: 'PaperMod',
      params: {
        ShowReadingTime: true,
        ShowReadTime: true,
        defaultTheme: 'light',
        socialIcons: [{ name: 'github', url: 'https://github.com/example' }],
      },
    },
  },
  'themes/PaperMod/theme.toml': {
    text: 'name = "PaperMod"\nlicense = "MIT"\nmin_version = "0.146.0"\n',
    values: { name: 'PaperMod', license: 'MIT', min_version: '0.146.0', features: ['search', 'profile-mode'] },
  },
  'themes/PaperMod/layouts/single.html': {
    text: '{{ define "main" }}{{ if (.Param "ShowToc") }}{{ partial "toc.html" . }}{{ end }}{{ if (.Param "ShowReadingTime") }}{{ end }}{{ end }}',
  },
  'themes/PaperMod/layouts/list.html': {
    text: '{{ $pages := where site.RegularPages "Params.hiddenInHomeList" "!=" "true" }}{{ if eq .Layout "search" }}{{ end }}',
  },
  'themes/PaperMod/layouts/_partials/social_icons.html': {
    text: '{{ range site.Params.socialIcons }}<a href="{{ .url }}">{{ partial "svg.html" . }}</a>{{ end }}',
  },
  'themes/PaperMod/layouts/_partials/svg.html': {
    text: '{{ $icon_name := (trim .name " " | lower) }}{{ if eq $icon_name "github" }}<svg/>{{ else if eq $icon_name "mastodon" }}<svg/>{{ end }}',
  },
  'themes/PaperMod/layouts/_partials/extend_head.html': { text: '{{- /* Head custom content area start */ -}}\n' },
  'themes/PaperMod/assets/css/core/theme-vars.css': { text: ':root { --primary: rgb(30, 30, 30); }\n:root[data-theme="dark"] { --primary: rgb(218, 218, 219); }\n' },
  'themes/PaperMod/assets/css/extended/blank.css': { text: '' },
  'themes/PaperMod/i18n/en.yaml': { text: '- id: toc\n  translation: "Table of Contents"\n' },
  'layouts/_partials/extend_head.html': { text: '<meta name="x">\n' },
}

const previewed: { path: string; ops: ConfigOp[] }[] = []
const written: { path: string; text: string; version?: string }[] = []

vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn() }))

vi.mock('../../lib/api', () => {
  const notFound = (path: string) => Promise.reject({ code: 'io', message: `not found: ${path}` })
  return {
    isAppError: (v: unknown) => typeof v === 'object' && v !== null && 'code' in v,
    api: {
      readText: (path: string) => (files[path] ? Promise.resolve({ text: files[path].text, version: `v-${path}` }) : notFound(path)),
      tomlRead: (path: string) => (files[path] ? Promise.resolve({ values: files[path].values ?? {}, comments: {} }) : notFound(path)),
      listFiles: (dir: string, extensions: string[] = []) =>
        Promise.resolve(
          Object.keys(files)
            .filter((p) => p.startsWith(dir + '/'))
            .filter((p) => extensions.length === 0 || extensions.some((e) => p.endsWith('.' + e)))
            .sort()
            .map((path) => ({ path, size: files[path].text.length })),
        ),
      configPreviewOps: (path: string, ops: ConfigOp[]) => {
        previewed.push({ path, ops })
        return Promise.resolve({ path, before: files[path]?.text ?? '', after: (files[path]?.text ?? '') + '# changed\n', version: `v-${path}` })
      },
      configValidate: () => Promise.resolve({ ok: true, messages: [] }),
      writeText: (path: string, text: string, version?: string) => {
        written.push({ path, text, version })
        return Promise.resolve('v2')
      },
    },
  }
})

const { ThemeView } = await import('./ThemeView')

// --- Helpers ------------------------------------------------------------------------------------

const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})

function mount(element: ReactElement) {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  act(() => root.render(element))
  cleanups.push(() => {
    act(() => root.unmount())
    container.remove()
  })
  return container
}

async function waitFor<T>(find: () => T | null | undefined, timeout = 3000): Promise<T> {
  const start = Date.now()
  for (;;) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5))
    })
    const found = find()
    if (found) return found
    if (Date.now() - start > timeout) throw new Error('timed out: ' + document.body.innerHTML.slice(0, 2000))
  }
}

function setValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  act(() => {
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function click(element: Element) {
  act(() => {
    ;(element as HTMLElement).click()
  })
}

function buttonByText(root: ParentNode, text: string | RegExp): HTMLButtonElement | null {
  return ([...root.querySelectorAll('button')] as HTMLButtonElement[]).find((b) => (typeof text === 'string' ? b.textContent?.trim() === text : text.test(b.textContent ?? ''))) ?? null
}

const site: SiteInfo = { root: 'C:/sites/my-blog', name: 'my-blog', configFiles: ['hugo.toml'], contentDir: 'content', isGitRepo: true }

function context(overrides: Partial<SiteContextValue> = {}): SiteContextValue {
  return {
    site,
    hugo: { path: 'hugo', raw: '', version: { major: 0, minor: 167, patch: 0, extended: true, withDeploy: false, os: 'windows', arch: 'amd64' } },
    files: [],
    pagesAt: '2026-01-01T00:00:00.000Z',
    pages: [],
    reloadFiles: () => Promise.resolve(),
    reloadPages: () => Promise.resolve(),
    refreshHugo: () => Promise.resolve(),
    openFile: () => undefined,
    showView: () => undefined,
    configVersion: 0,
    notifyConfigChanged: vi.fn(),
    ...overrides,
  }
}

beforeEach(async () => {
  previewed.length = 0
  written.length = 0
  await i18n.changeLanguage('en')
})

// --- Tests --------------------------------------------------------------------------------------

describe('ThemeView', () => {
  it('shows the PaperMod profile and writes a toggle, a list-of-objects edit and a reset', async () => {
    const ctx = context()
    const view = mount(
      <SiteContext.Provider value={ctx}>
        <ThemeView />
      </SiteContext.Provider>,
    )

    const toc = await waitFor(() => view.querySelector<HTMLInputElement>('[data-field="ShowToc"] input[role="switch"]'))
    expect(view.textContent).toContain('Settings profile: PaperMod (matched by theme.toml)')
    expect(view.textContent).toContain('your Hugo 0.167.0 is fine')
    // The site's typo is reported with the near match.
    expect(view.textContent).toContain('Settings the theme does not use (1)')
    expect(view.textContent).toContain('Did you mean ShowReadingTime?')
    // Page-only settings are documentation, with the string-compare gotcha.
    expect(view.textContent).toContain('Page settings (front matter)')
    expect(view.querySelector('[data-field="hiddenInHomeList"]')).toBeNull()

    // 1. Toggle: ShowToc is not set in the site, so it is added under [params].
    expect(toc.checked).toBe(false)
    click(toc)
    expect(toc.checked).toBe(true)

    // 2. List of objects: the icon picker offers the names found in svg.html.
    const icons = view.querySelector('[data-field="socialIcons"]')!
    const options = [...view.querySelectorAll('datalist option')].map((o) => o.getAttribute('value'))
    expect(options).toEqual(expect.arrayContaining(['github', 'mastodon']))
    const url = icons.querySelector<HTMLInputElement>('input[aria-label="Address (#1)"]')!
    expect(url.value).toBe('https://github.com/example')
    setValue(url, 'https://github.com/new')

    // 3. Reset removes the key so the theme default applies.
    click(buttonByText(view.querySelector('[data-field="ShowReadingTime"]')!, 'Reset')!)
    expect(view.querySelector('[data-field="ShowReadingTime"]')!.textContent).toContain('Will be removed from hugo.toml')

    click(buttonByText(view, 'Review and write (3)')!)
    await waitFor(() => (previewed.length > 0 ? previewed : null))
    expect(previewed).toEqual([
      {
        path: 'hugo.toml',
        ops: [
          { op: 'set', path: ['params', 'ShowToc'], value: true },
          // The [[params.socialIcons]] table is edited entry by entry, not replaced.
          { op: 'set', path: ['params', 'socialIcons', 0, 'url'], value: 'https://github.com/new' },
          { op: 'remove', path: ['params', 'ShowReadingTime'] },
        ],
      },
    ])

    const write = await waitFor(() => {
      const button = buttonByText(document.body, 'Write to files')
      return button && !button.disabled ? button : null
    })
    click(write)
    await waitFor(() => (written.length > 0 ? written : null))
    expect(written[0].path).toBe('hugo.toml')
    await waitFor(() => ((ctx.notifyConfigChanged as ReturnType<typeof vi.fn>).mock.calls.length > 0 ? true : null))
  })

  it('leaves nothing pending when a toggle goes back to the theme default', async () => {
    const view = mount(
      <SiteContext.Provider value={context()}>
        <ThemeView />
      </SiteContext.Provider>,
    )
    const toggle = await waitFor(() => view.querySelector<HTMLInputElement>('[data-field="disableThemeToggle"] input[role="switch"]'))
    click(toggle)
    click(toggle)
    // Back to the original state: nothing pending.
    expect(buttonByText(view, /Review and write/)).toBeNull()
  })

  it('lists overridden theme files and recognises a filled hook', async () => {
    const view = mount(
      <SiteContext.Provider value={context()}>
        <ThemeView />
      </SiteContext.Provider>,
    )
    const tab = await waitFor(() => buttonByText(view, 'Overridden files'))
    click(tab)
    await waitFor(() => (view.textContent?.includes('Fills an empty hook') ? true : null))
    expect(view.textContent).toContain('layouts/_partials/extend_head.html')
    expect(view.textContent).toContain('Theme file: themes/PaperMod/layouts/_partials/extend_head.html')
  })

  it('sets up search, and writes new files for a text override and a colour override', async () => {
    const view = mount(
      <SiteContext.Provider value={context()}>
        <ThemeView />
      </SiteContext.Provider>,
    )

    // Feature action: JSON output, the search page and a menu entry, shown before writing.
    click(await waitFor(() => buttonByText(view, 'Features')))
    const card = await waitFor(() => view.querySelector('[aria-labelledby="feature-search"]'))
    expect(card.textContent).toContain('Create content/search.md (layout "search")')
    click(card.querySelector('input[type="checkbox"]')!)
    click(buttonByText(card, 'Set up…')!)
    await waitFor(() => (previewed.length > 0 ? true : null))
    expect(previewed[0]).toEqual({
      path: 'hugo.toml',
      ops: [
        { op: 'set', path: ['outputs', 'home'], value: ['HTML', 'RSS', 'JSON'] },
        { op: 'appendTable', path: ['menus', 'main'], entries: { name: 'Search', url: '/search/', weight: 90 } },
      ],
    })
    click(await waitFor(() => buttonByText(document.body, 'Write to files')))
    await waitFor(() => (written.length === 2 ? true : null))
    expect(written[1]).toEqual({
      path: 'content/search.md',
      text: ['---', 'title: Search', 'layout: search', 'placeholder: ""', 'summary: search', '---', ''].join('\n'),
      version: '',
    })

    // Text override: a new i18n file with only the changed key.
    written.length = 0
    click(buttonByText(view, 'Texts')!)
    const input = await waitFor(() => view.querySelector<HTMLInputElement>('input[aria-label="Your text for toc"]'))
    expect(input.placeholder).toBe('Table of Contents')
    setValue(input, 'Contents')
    click(buttonByText(view, 'Review and write (1)')!)
    click(await waitFor(() => buttonByText(document.body, 'Write to files')))
    await waitFor(() => (written.length === 1 ? true : null))
    expect(written[0]).toEqual({ path: 'i18n/en.yaml', text: 'toc: Contents\n', version: '' })

    // Colour override: the app's own file in PaperMod's css/extended hook.
    written.length = 0
    click(buttonByText(view, 'Colours')!)
    const primary = await waitFor(() => view.querySelector<HTMLInputElement>('input[aria-label="--primary (light)"]'))
    setValue(primary, 'rgb(1, 2, 3)')
    click(buttonByText(view, 'Review and write (1)')!)
    click(await waitFor(() => buttonByText(document.body, 'Write to files')))
    await waitFor(() => (written.length === 1 ? true : null))
    expect(written[0].path).toBe('assets/css/extended/hugo-publisher.css')
    expect(written[0].text).toContain(':root {\n  --primary: rgb(1, 2, 3);\n}')
    expect(written[0].text.startsWith('/* Generated by Hugo Publisher')).toBe(true)
  })
})
