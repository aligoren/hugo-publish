// @vitest-environment jsdom
import { act, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createHash } from 'node:crypto'

import type { ConfigOp, GitSubmodule, GoModTexts, HugoModule, ModGetResult, SubmoduleStatus } from '../../../lib/api'
import i18n from '../../../i18n'
import type { ConfigFileData } from '../../config-edit'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const BASEOF_OLD = '<html>\n<head></head>\n<body>\n<main>\n</main>\n</body>\n</html>\n'
const BASEOF_SITE = '<html>\n<head></head>\n<body>\n<main>\n{{ partial "banner.html" . }}\n</main>\n</body>\n</html>\n'
const BASEOF_NEW = '<html lang="en">\n<head></head>\n<body>\n<main>\n</main>\n</body>\n</html>\n'

let files: Record<string, string> = {}
/** Answers of themeRepoInfo in order; 'fail' = offline. */
let repoAnswers: ({ defaultBranch: string; commit: string; tags: string[] } | 'fail')[] = []
const calls: { fn: string; args: unknown[] }[] = []
/** Files of module folders outside the site, by absolute folder. */
let moduleDirs: Record<string, Record<string, string>> = {}
let modules: HugoModule[] = []
let submodules: GitSubmodule[] = []
let submoduleStatus: SubmoduleStatus | null = null
let modGetAnswer: ModGetResult | null = null

/** Like the Rust side: SHA-256 with line endings normalised in text. */
function sha(text: string): string {
  return createHash('sha256').update(text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')).digest('hex')
}

function resetFiles() {
  files = {
    'hugo.toml': 'theme = "T"\n',
    'themes/T/theme.toml': 'name = "T"\nhomepage = "https://github.com/acme/t-theme"\n',
    'themes/T/layouts/baseof.html': BASEOF_OLD,
    'themes/T/layouts/rss.xml': '<rss version="2.0">\n',
    'themes/T/layouts/single.html': '{{ site.Params.oldParam }}{{ site.Params.kept }}',
    'themes/T/layouts/_partials/extend_head.html': '',
    'themes/T/images/tn.png': 'PNG',
    'layouts/baseof.html': BASEOF_SITE,
    'layouts/rss.xml': '<rss version="2.0" xmlns:atom="x">\n',
    'layouts/_partials/extend_head.html': '<meta name="x">\n',
    'layouts/same.html': 'same\n',
    'themes/T/layouts/same.html': 'same\n',
  }
}

function stage() {
  const root = '.hugo-publisher/theme-update/T'
  Object.assign(files, {
    [`${root}/theme.toml`]: 'name = "T"\nmin_version = "0.150.0"\n',
    [`${root}/layouts/baseof.html`]: BASEOF_NEW,
    [`${root}/layouts/rss.xml`]: '<rss version="2.0" xmlns:atom="x">\n',
    [`${root}/layouts/single.html`]: '{{ site.Params.newParam }}{{ site.Params.kept }}',
    [`${root}/layouts/same.html`]: 'same\n',
    [`${root}/images/tn.png`]: 'PNG2',
  })
  return { name: 'T', path: root, files: 6 }
}

vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn() }))

vi.mock('../../../lib/api', () => {
  const notFound = (path: string) => Promise.reject({ code: 'io', message: `not found: ${path}` })
  const record = <T,>(fn: string, args: unknown[], value: T) => {
    calls.push({ fn, args })
    return Promise.resolve(value)
  }
  const tomlValues = (text: string) =>
    Object.fromEntries([...text.matchAll(/^(\w+) = "([^"]*)"$/gm)].map((m) => [m[1], m[2]]))
  return {
    isAppError: (v: unknown) => typeof v === 'object' && v !== null && 'code' in v,
    api: {
      readText: (path: string) => (path in files ? Promise.resolve({ text: files[path], version: `v-${path}` }) : notFound(path)),
      tomlRead: (path: string) => (path in files ? Promise.resolve({ values: tomlValues(files[path]), comments: {} }) : notFound(path)),
      listFiles: (dir: string) =>
        Promise.resolve(
          Object.keys(files)
            .filter((p) => p.startsWith(dir + '/'))
            .sort()
            .map((path) => ({ path, size: files[path].length })),
        ),
      configPreviewOps: (path: string, ops: ConfigOp[]) => record('configPreviewOps', [path, ops], { path, before: files[path], after: files[path] + '# x\n', version: 'v' }),
      configValidate: () => Promise.resolve({ ok: true, messages: [] }),
      writeText: (path: string, text: string, version?: string) => record('writeText', [path, text, version], 'v2'),
      themeStageUpdate: (source: unknown) => record('themeStageUpdate', [source], stage()),
      themeRepoInfo: () => {
        const answer = repoAnswers.length > 1 ? repoAnswers.shift()! : (repoAnswers[0] ?? 'fail')
        return answer === 'fail' ? Promise.reject({ code: 'network', message: 'offline' }) : Promise.resolve(answer)
      },
      themeApplyUpdate: (name: string) => record('themeApplyUpdate', [name], undefined),
      themeDiscardUpdate: (name: string) => record('themeDiscardUpdate', [name], undefined),
      themeInstall: (source: { name: string }) => {
        files[`themes/${source.name}/theme.toml`] = `name = "${source.name}"\n`
        files[`themes/${source.name}/layouts/single.html`] = '{{ site.Params.kept }}'
        return record('themeInstall', [source], { name: source.name, path: `themes/${source.name}`, files: 2 })
      },
      siteDeleteOverride: (path: string) => record('siteDeleteOverride', [path], undefined),
      tomlParseText: (text: string) => Promise.resolve({ values: tomlValues(text), comments: {} }),
    },
    moduleApi: {
      siteHashFiles: (paths: string[]) => Promise.resolve(paths.filter((p) => p in files).map((p) => ({ path: p, sha256: sha(files[p]), size: files[p].length }))),
      moduleList: (ignoreVendor: boolean) => record('moduleList', [ignoreVendor], modules),
      moduleListFiles: (dir: string, sub: string) =>
        Promise.resolve(
          Object.keys(moduleDirs[dir] ?? {})
            .filter((p) => sub === '.' || p.startsWith(sub + '/'))
            .sort()
            .map((path) => ({ path, size: moduleDirs[dir][path].length })),
        ),
      moduleReadText: (dir: string, path: string) =>
        moduleDirs[dir] && path in moduleDirs[dir] ? Promise.resolve({ text: moduleDirs[dir][path], version: 'm' }) : notFound(`${dir}/${path}`),
      moduleHashFiles: (dir: string, paths: string[]) =>
        Promise.resolve(paths.filter((p) => p in (moduleDirs[dir] ?? {})).map((p) => ({ path: p, sha256: sha(moduleDirs[dir][p]), size: moduleDirs[dir][p].length }))),
      modGet: (module: string, version: string) => record('modGet', [module, version], modGetAnswer!),
      modRestore: (texts: GoModTexts) => record('modRestore', [texts], undefined),
      modVendor: () => record('modVendor', [], 'ok'),
      submodules: () => Promise.resolve(submodules),
      submoduleStatus: () => Promise.resolve(submoduleStatus),
      submoduleCheckout: (path: string, reference: string) => {
        const status = { path, initialized: true, head: reference, describe: 'v2.0', changes: [] }
        return record('submoduleCheckout', [path, reference], status)
      },
    },
  }
})

const { loadTheme } = await import('../loadTheme')
const { moduleComponent } = await import('../../../lib/themeSources')
const { UpdatePanel } = await import('./UpdatePanel')
const { GalleryPanel } = await import('./GalleryPanel')
const { OverridesPanel } = await import('../OverridesPanel')

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

async function waitFor<T>(find: () => T | null | undefined | false, timeout = 3000): Promise<T> {
  const start = Date.now()
  for (;;) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5))
    })
    const found = find()
    if (found) return found
    if (Date.now() - start > timeout) throw new Error('timed out: ' + document.body.textContent?.slice(0, 1500))
  }
}

function button(root: ParentNode, text: string): HTMLButtonElement | null {
  return ([...root.querySelectorAll('button')] as HTMLButtonElement[]).find((b) => b.textContent?.trim() === text && !b.disabled) ?? null
}

function click(element: Element) {
  act(() => (element as HTMLElement).click())
}

const writes = () => calls.filter((c) => c.fn === 'writeText').map((c) => c.args)

beforeEach(async () => {
  resetFiles()
  calls.length = 0
  repoAnswers = []
  moduleDirs = {}
  modules = []
  submodules = []
  submoduleStatus = null
  modGetAnswer = null
  await i18n.changeLanguage('en')
})

const hugoVersion = { major: 0, minor: 167, patch: 0, extended: true, withDeploy: false, os: 'windows', arch: 'amd64' }

describe('UpdatePanel', () => {
  it('creates the lock file from the current theme files', async () => {
    const theme = await loadTheme('T', 'themes/T')
    const view = mount(<UpdatePanel theme={theme} siteParams={{}} siteTemplateKeys={new Set()} hugoVersion={hugoVersion} ignore={[]} onUpdated={() => undefined} />)
    const repo = await waitFor(() => view.querySelector<HTMLInputElement>('input[placeholder="https://github.com/owner/repo"]'))
    expect(repo.value).toBe('https://github.com/acme/t-theme')
    click(await waitFor(() => button(view, 'Create lock file…')))
    click(await waitFor(() => button(document.body, 'Write to files')))
    await waitFor(() => writes().length > 0)
    const [path, text, version] = writes()[0] as [string, string, string]
    expect(path).toBe('.hugo-publisher/theme.lock.json')
    expect(version).toBe('')
    const lock = JSON.parse(text)
    expect(lock).toMatchObject({ theme: 'T', source: { owner: 'acme', repo: 't-theme' } })
    expect(lock.files['layouts/baseof.html']).toMatch(/^sha256:/)
    expect(lock.files['images/tn.png']).toBe(`sha256:${sha('PNG')}`)
  })

  it('stages an update, merges drifted overrides, deletes redundant copies and applies', async () => {
    const theme = await loadTheme('T', 'themes/T')
    const onUpdated = vi.fn()
    const view = mount(
      <UpdatePanel theme={theme} siteParams={{ oldParam: 1, kept: 2 }} siteTemplateKeys={new Set()} hugoVersion={hugoVersion} ignore={[]} onUpdated={onUpdated} />,
    )
    click(await waitFor(() => button(view, 'Check for updates')))
    await waitFor(() => view.querySelector('#update-review'))
    expect(calls.find((c) => c.fn === 'themeStageUpdate')?.args[0]).toEqual({ owner: 'acme', repo: 't-theme', name: 'T' })
    const text = view.textContent ?? ''
    expect(text).toContain('Theme files (6 changes)')
    expect(text).toContain('New settings (1)')
    expect(text).toContain('newParam')
    expect(text).toContain('Settings no longer read (1)')
    expect(text).toContain('These settings of your site will no longer be used: oldParam')
    expect(text).toContain('extend_head.html')
    expect(text).toContain('The new version needs Hugo 0.150.0 or newer; yours is fine.')

    const baseof = view.querySelector('[data-override="layouts/baseof.html"]')!
    expect(baseof.textContent).toContain('merge cleanly')
    expect(baseof.querySelector<HTMLInputElement>('input[type="radio"]:checked')!.parentElement!.textContent).toBe('Use the merged file')
    const rss = view.querySelector('[data-override="layouts/rss.xml"]')!
    expect(rss.textContent).toContain('can be deleted')
    expect(view.querySelector('[data-override="layouts/same.html"]')).toBeNull()

    click(button(view, 'Apply the update')!)
    await waitFor(() => onUpdated.mock.calls.length > 0)
    expect(calls.map((c) => c.fn)).toEqual(['themeStageUpdate', 'themeApplyUpdate', 'writeText', 'siteDeleteOverride', 'writeText'])
    expect(writes()[0]).toEqual(['layouts/baseof.html', BASEOF_SITE.replace('<html>', '<html lang="en">'), 'v-layouts/baseof.html'])
    expect(calls.find((c) => c.fn === 'siteDeleteOverride')?.args).toEqual(['layouts/rss.xml'])
    const lock = JSON.parse((writes()[1] as string[])[1])
    expect(lock.files['images/tn.png']).toBe(`sha256:${sha('PNG2')}`)
  })

  it('lets the user resolve a conflict by editing the merged text', async () => {
    files['layouts/baseof.html'] = BASEOF_SITE.replace('<html>', '<html class="site">')
    const theme = await loadTheme('T', 'themes/T')
    const view = mount(<UpdatePanel theme={theme} siteParams={{}} siteTemplateKeys={new Set()} hugoVersion={hugoVersion} ignore={[]} onUpdated={() => undefined} />)
    click(await waitFor(() => button(view, 'Check for updates')))
    const row = await waitFor(() => view.querySelector('[data-override="layouts/baseof.html"]'))
    expect(row.textContent).toContain('changed the same lines (1 places)')
    const edit = [...row.querySelectorAll('label')].find((l) => l.textContent === 'Edit the merged file')!.querySelector('input')!
    click(edit)
    expect(view.textContent).toContain('still have conflict markers')
    expect(button(view, 'Apply the update')).toBeNull()
    click(button(view, 'Cancel')!)
    await waitFor(() => calls.some((c) => c.fn === 'themeDiscardUpdate'))
  })
})

describe('OverridesPanel', () => {
  it('deletes a redundant copy after confirming', async () => {
    const theme = await loadTheme('T', 'themes/T')
    const view = mount(<OverridesPanel theme={theme} ignore={[]} />)
    click(await waitFor(() => button(view, 'Delete this copy…')))
    expect(view.textContent).toContain('Delete layouts/same.html?')
    click(button(view, 'Delete')!)
    await waitFor(() => calls.some((c) => c.fn === 'siteDeleteOverride'))
    expect(calls.find((c) => c.fn === 'siteDeleteOverride')?.args).toEqual(['layouts/same.html'])
  })
})

describe('GalleryPanel', () => {
  it('installs a catalog theme, shows unused params and switches the config', async () => {
    repoAnswers = [{ defaultBranch: 'master', commit: 'd'.repeat(40), tags: ['v8.0'] }]
    const configs: ConfigFileData[] = [{ path: 'hugo.toml', format: 'toml', text: files['hugo.toml'], version: 'v', values: { theme: 'T' }, comments: {} }]
    const onChanged = vi.fn()
    const view = mount(<GalleryPanel configs={configs} current="T" siteParams={{ kept: 1, oldParam: 2 }} siteTemplateKeys={new Set()} hugo={null} onChanged={onChanged} />)
    const card = await waitFor(() => [...view.querySelectorAll('li')].find((li) => li.querySelector('h3')?.textContent === 'PaperMod' && button(li, 'Install')))
    click(button(card, 'Install')!)
    await waitFor(() => view.querySelector('#gallery-switch'))
    expect(calls[0]).toEqual({ fn: 'themeInstall', args: [{ owner: 'adityatelange', repo: 'hugo-PaperMod', name: 'PaperMod', homepage: expect.any(String), description: expect.any(Object) }] })
    expect(view.textContent).toContain('Settings of your site this theme does not read: oldParam')
    click(button(view, 'Use this theme…')!)
    await waitFor(() => calls.some((c) => c.fn === 'configPreviewOps'))
    expect(calls.find((c) => c.fn === 'configPreviewOps')?.args).toEqual(['hugo.toml', [{ op: 'set', path: ['theme'], value: 'PaperMod' }]])
    click(await waitFor(() => button(document.body, 'Write to files')))
    await waitFor(() => onChanged.mock.calls.length >= 2)
    expect(writes().map((w) => w[0])).toEqual(['hugo.toml', '.hugo-publisher/theme.lock.json'])
    expect(JSON.parse(writes()[1][1] as string).commit).toBe('d'.repeat(40))
  })
})

const SHA_A = 'a'.repeat(40)
const SHA_B = 'b'.repeat(40)
const SHA_C = 'c'.repeat(40)

describe('commits and tags', () => {
  function lockWith(commit: string) {
    files['.hugo-publisher/theme.lock.json'] = JSON.stringify({ theme: 'T', source: { owner: 'acme', repo: 't-theme' }, commit, installedAt: '2026-01-01T00:00:00Z', files: {} })
  }

  it('says when the installed commit is already the newest, and can download anyway', async () => {
    lockWith(SHA_A)
    repoAnswers = [{ defaultBranch: 'main', commit: SHA_A, tags: ['v1.2', 'v1.10', 'v1.10-rc1', 'nightly'] }]
    const theme = await loadTheme('T', 'themes/T')
    const view = mount(<UpdatePanel theme={theme} siteParams={{}} siteTemplateKeys={new Set()} hugoVersion={hugoVersion} ignore={[]} onUpdated={() => undefined} />)
    await waitFor(() => view.querySelectorAll('#theme-update-tags option').length === 4)
    expect([...view.querySelectorAll('#theme-update-tags option')].map((o) => o.getAttribute('value'))).toEqual(['v1.10', 'v1.10-rc1', 'v1.2', 'nightly'])
    expect(view.textContent).toContain('Installed commit: aaaaaaa')
    click(button(view, 'Check for updates')!)
    await waitFor(() => view.textContent?.includes('Already up to date (aaaaaaa).'))
    expect(calls.some((c) => c.fn === 'themeStageUpdate')).toBe(false)
    click(button(view, 'Download anyway')!)
    await waitFor(() => view.querySelector('#update-review'))
    expect(view.textContent).toContain('current: aaaaaaa → new: aaaaaaa')
  })

  it('records the new commit in the lock, approximate when the branch moved during the download', async () => {
    lockWith(SHA_A)
    repoAnswers = [{ defaultBranch: 'main', commit: SHA_B, tags: [] }, { defaultBranch: 'main', commit: SHA_B, tags: [] }, { defaultBranch: 'main', commit: SHA_C, tags: [] }]
    const theme = await loadTheme('T', 'themes/T')
    const onUpdated = vi.fn()
    const view = mount(<UpdatePanel theme={theme} siteParams={{}} siteTemplateKeys={new Set()} hugoVersion={hugoVersion} ignore={[]} onUpdated={onUpdated} />)
    // The tag lookup answers first (placeholder becomes the default branch).
    await waitFor(() => view.querySelector('input[placeholder="main"]'))
    click(await waitFor(() => button(view, 'Check for updates')))
    await waitFor(() => view.querySelector('#update-review'))
    expect(view.textContent).toContain('current: aaaaaaa → new: ccccccc')
    expect(view.textContent).toContain('(approximate: the branch moved while downloading)')
    click(button(view, 'Apply the update')!)
    await waitFor(() => onUpdated.mock.calls.length > 0)
    const lockWrite = writes().find((w) => w[0] === '.hugo-publisher/theme.lock.json') as string[]
    expect(JSON.parse(lockWrite[1]).commit).toBe(SHA_C)
    expect(lockWrite[2]).toBe('v-.hugo-publisher/theme.lock.json')
  })

  it('works offline with a note and no commit', async () => {
    const theme = await loadTheme('T', 'themes/T')
    const view = mount(<UpdatePanel theme={theme} siteParams={{}} siteTemplateKeys={new Set()} hugoVersion={hugoVersion} ignore={[]} onUpdated={() => undefined} />)
    await waitFor(() => view.textContent?.includes('GitHub could not be reached'))
    click(button(view, 'Check for updates')!)
    await waitFor(() => view.querySelector('#update-review'))
    expect(view.textContent).toContain('current: unknown → new: unknown')
  })
})


const OLD_DIR = 'C:/cache/github.com/acme/t-theme@v1.0.0'
const NEW_DIR = 'C:/cache/github.com/acme/t-theme@v1.1.0'
const GO_MOD_OLD = 'module example.org/site\n\nrequire github.com/acme/t-theme v1.0.0\n'
const GO_MOD_NEW = 'module example.org/site\n\nrequire github.com/acme/t-theme v1.1.0\n'

function themeModule(dir: string, version: string, vendored = false): HugoModule {
  return {
    path: 'github.com/acme/t-theme',
    version,
    time: '',
    owner: 'project',
    dir,
    mounts: [{ source: 'layouts', target: 'layouts' }, { source: 'i18n', target: 'i18n' }],
    siteDir: null,
    vendored,
    modulePath: 'github.com/acme/t-theme',
  }
}

describe('Hugo Module themes', () => {
  beforeEach(() => {
    moduleDirs = {
      [OLD_DIR]: { 'layouts/baseof.html': BASEOF_OLD, 'layouts/single.html': '{{ site.Params.kept }}', 'i18n/en.yaml': 'readMore: Read more\ntoc: Contents\n' },
      [NEW_DIR]: { 'layouts/baseof.html': BASEOF_NEW, 'layouts/single.html': '{{ site.Params.kept }}{{ site.Params.added }}', 'i18n/en.yaml': 'readMore: Continue reading\n' },
    }
    files['i18n/en.yaml'] = 'readMore: More\ntoc: Index\n'
    delete files['layouts/rss.xml']
    modGetAnswer = { before: { goMod: GO_MOD_OLD, goSum: null }, after: { goMod: GO_MOD_NEW, goSum: 'github.com/acme/t-theme v1.1.0 h1:x\n' }, output: '' }
    modules = [themeModule(NEW_DIR, 'v1.1.0')]
  })

  it('updates with hugo mod get, reviews drift and i18n keys, and can undo', async () => {
    repoAnswers = [{ defaultBranch: 'main', commit: SHA_A, tags: ['v2.0.0', 'v1.1.0', 'v1.0.0', 'nightly'] }]
    const theme = await loadTheme('github.com/acme/t-theme', moduleComponent(themeModule(OLD_DIR, 'v1.0.0')))
    const onUpdated = vi.fn()
    const view = mount(<UpdatePanel theme={theme} siteParams={{ kept: 1 }} siteTemplateKeys={new Set()} hugoVersion={hugoVersion} ignore={[]} onUpdated={onUpdated} />)
    await waitFor(() => view.textContent?.includes('This theme is the Hugo module github.com/acme/t-theme, version v1.0.0.'))
    // Only tags of the module's major version (v0/v1 without a /vN suffix).
    await waitFor(() => view.querySelectorAll('#theme-module-tags option').length === 3)
    expect([...view.querySelectorAll('#theme-module-tags option')].map((o) => o.getAttribute('value'))).toEqual(['latest', 'v1.1.0', 'v1.0.0'])
    click(await waitFor(() => button(view, 'Get v1.1.0')))
    await waitFor(() => view.querySelector('#update-review'))
    expect(calls.find((c) => c.fn === 'modGet')?.args).toEqual(['github.com/acme/t-theme', 'v1.1.0'])
    expect(calls.find((c) => c.fn === 'moduleList')?.args).toEqual([false])
    const text = view.textContent ?? ''
    expect(text).toContain('Update github.com/acme/t-theme from v1.0.0 to v1.1.0')
    expect(text).toContain('go.mod and go.sum were changed')
    expect(text).toContain('github.com/acme/t-theme v1.1.0 h1:x')
    expect(text).toContain('New settings (1)')
    expect(view.querySelector('[data-override="layouts/baseof.html"]')?.textContent).toContain('merge cleanly')
    // The module cache is never edited: the old version is a reliable merge base.
    expect(text).not.toContain('without a lock file it cannot be checked')
    const i18n = view.querySelector('[data-i18n="i18n/en.yaml"]')!
    expect(i18n.textContent).toContain('readMore')
    expect(i18n.textContent).toContain('theme: “Read more” → “Continue reading”')
    expect(i18n.textContent).toContain('yours: “More”')
    expect(i18n.textContent).toContain('toc')

    click(button(view, 'Apply the update')!)
    await waitFor(() => onUpdated.mock.calls.length > 0)
    expect(calls.map((c) => c.fn)).toEqual(['modGet', 'moduleList', 'writeText'])
    expect(writes()[0]).toEqual(['layouts/baseof.html', BASEOF_SITE.replace('<html>', '<html lang="en">'), 'v-layouts/baseof.html'])
    expect(view.textContent).toContain('The theme now uses v1.1.0. Commit go.mod and go.sum')
    click(button(view, 'Undo the version change')!)
    await waitFor(() => calls.some((c) => c.fn === 'modRestore'))
    expect(calls.find((c) => c.fn === 'modRestore')?.args).toEqual([{ goMod: GO_MOD_OLD, goSum: null }])
    await waitFor(() => view.textContent?.includes('go.mod and go.sum are back to v1.0.0.'))
  })

  it('puts go.mod back on cancel and refreshes _vendor/ when the site vendors', async () => {
    const vendored = { ...themeModule('C:/site/_vendor/github.com/acme/t-theme', 'v1.0.0', true), siteDir: '_vendor/github.com/acme/t-theme' }
    for (const [path, text] of Object.entries(moduleDirs[OLD_DIR])) files[`_vendor/github.com/acme/t-theme/${path}`] = text
    const theme = await loadTheme('github.com/acme/t-theme', moduleComponent(vendored))
    const view = mount(<UpdatePanel theme={theme} siteParams={{}} siteTemplateKeys={new Set()} hugoVersion={hugoVersion} ignore={[]} onUpdated={() => undefined} />)
    await waitFor(() => view.textContent?.includes('(vendored)'))
    const input = view.querySelector<HTMLInputElement>('input[list="theme-module-tags"]')!
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'v1.1.0')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    click(await waitFor(() => button(view, 'Get v1.1.0')))
    await waitFor(() => view.querySelector('#update-review'))
    // The new version is read from the module cache, not from the old _vendor/ copy.
    expect(calls.find((c) => c.fn === 'moduleList')?.args).toEqual([true])
    expect(view.textContent).toContain('Run `hugo mod vendor` after applying')
    click(button(view, 'Cancel')!)
    await waitFor(() => calls.some((c) => c.fn === 'modRestore'))
    expect(calls.find((c) => c.fn === 'modRestore')?.args).toEqual([{ goMod: GO_MOD_OLD, goSum: null }])

    click(await waitFor(() => button(view, 'Get v1.1.0')))
    await waitFor(() => view.querySelector('#update-review'))
    click(button(view, 'Apply the update')!)
    await waitFor(() => calls.some((c) => c.fn === 'modVendor'))
  })

  it('says when go.mod already has the version', async () => {
    modGetAnswer = { before: { goMod: GO_MOD_OLD, goSum: null }, after: { goMod: GO_MOD_OLD, goSum: null }, output: '' }
    const theme = await loadTheme('github.com/acme/t-theme', moduleComponent(themeModule(OLD_DIR, 'v1.0.0')))
    const view = mount(<UpdatePanel theme={theme} siteParams={{}} siteTemplateKeys={new Set()} hugoVersion={hugoVersion} ignore={[]} onUpdated={() => undefined} />)
    click(await waitFor(() => button(view, 'Get latest')))
    await waitFor(() => view.textContent?.includes('go.mod already uses latest; nothing changed.'))
    expect(calls.some((c) => c.fn === 'moduleList')).toBe(false)
  })
})

describe('git submodule themes', () => {
  beforeEach(() => {
    submodules = [{ name: 'themes/T', path: 'themes/T', url: 'https://github.com/acme/t-theme.git', branch: null }]
    submoduleStatus = { path: 'themes/T', initialized: true, head: SHA_A, describe: 'v1.0', changes: [] }
  })

  it('reviews the staged version and applies it with git checkout', async () => {
    repoAnswers = [{ defaultBranch: 'main', commit: SHA_B, tags: ['v2.0'] }]
    const theme = await loadTheme('T', 'themes/T')
    const onUpdated = vi.fn()
    const view = mount(<UpdatePanel theme={theme} siteParams={{}} siteTemplateKeys={new Set()} hugoVersion={hugoVersion} ignore={[]} onUpdated={onUpdated} />)
    await waitFor(() => view.textContent?.includes('This theme is the git submodule themes/T, currently at v1.0.'))
    expect(view.querySelector<HTMLInputElement>('input[placeholder="https://github.com/owner/repo"]')!.value).toBe('https://github.com/acme/t-theme')
    expect(view.textContent).not.toContain('Create lock file')
    click(await waitFor(() => button(view, 'Check for updates')))
    await waitFor(() => view.querySelector('#update-review'))
    expect(view.textContent).toContain('current: aaaaaaa → new: bbbbbbb')
    // A clean checkout is a reliable merge base.
    expect(view.textContent).not.toContain('without a lock file it cannot be checked')
    click(button(view, 'Apply the update')!)
    await waitFor(() => onUpdated.mock.calls.length > 0)
    expect(calls.map((c) => c.fn).slice(0, 3)).toEqual(['themeStageUpdate', 'submoduleCheckout', 'themeDiscardUpdate'])
    expect(calls.find((c) => c.fn === 'submoduleCheckout')?.args).toEqual(['themes/T', SHA_B])
    expect(calls.some((c) => c.fn === 'themeApplyUpdate')).toBe(false)
    await waitFor(() => view.textContent?.includes('commit it to record the new theme version'))
  })

  it('refuses to update a submodule with local changes', async () => {
    submoduleStatus = { path: 'themes/T', initialized: true, head: SHA_A, describe: 'v1.0', changes: ['layouts/baseof.html'] }
    const theme = await loadTheme('T', 'themes/T')
    const view = mount(<UpdatePanel theme={theme} siteParams={{}} siteTemplateKeys={new Set()} hugoVersion={hugoVersion} ignore={[]} onUpdated={() => undefined} />)
    await waitFor(() => view.textContent?.includes('has local changes (layouts/baseof.html)'))
    expect(button(view, 'Check for updates')).toBeNull()
  })
})
