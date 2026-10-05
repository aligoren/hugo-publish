// Fixtures for the settings model tests.
import { configFormat } from '../../config-edit'
import { classifyConfigPath, discoverSources, loadedSource, type LoadedSource } from './sources'
import type { Tree } from './values'

/** Values plus the file text, where `[[array.of.tables]]` detection matters. */
export interface FileFixture {
  values: Tree
  text: string
}

function isFixture(entry: Tree | FileFixture): entry is FileFixture {
  const keys = Object.keys(entry)
  return keys.length === 2 && keys.includes('values') && keys.includes('text') && typeof entry.text === 'string'
}

/** Loaded sources from a map of site-relative path → values, in Hugo's precedence order. */
export function sourcesOf(files: Record<string, Tree | FileFixture>): LoadedSource[] {
  const paths = Object.keys(files)
  const roots = paths.filter((p) => !p.includes('/'))
  const dir = paths.filter((p) => p.includes('/'))
  return discoverSources(roots, dir).map((source) => {
    const entry = files[source.path]
    const fixture: FileFixture = isFixture(entry) ? entry : { values: entry, text: '' }
    return loadedSource(source, {
      path: source.path,
      format: configFormat(source.path)!,
      text: fixture.text,
      version: `v-${source.path}`,
      values: fixture.values,
      comments: {},
    })
  })
}

export function sourceOf(path: string, values: Tree, text = ''): LoadedSource {
  const source = classifyConfigPath(path)
  if (!source) throw new Error(`not a config path: ${path}`)
  return loadedSource({ ...source, active: true }, { path, format: source.format, text, version: 'v1', values, comments: {} })
}
