// Where a theme's colour variables live and where the app writes its overrides.
import { lookupCi } from './discovery'
import type { ThemeData } from './loadTheme'
import type { CssHookDir, CssHookFile, ThemeMeta } from './schema'

const SKIP = /(^|\/)(vendor|vendors|lib|libs|node_modules|compiled)\/|\.min\.css$/i
const MAX_FILES = 60

/** CSS files with the variables: the curated list (with `{params.x|fallback}` filled in) or all theme CSS. */
export function cssVarFiles(theme: ThemeData, meta: ThemeMeta | null, siteParams: Record<string, unknown>): string[] {
  if (meta?.cssVarsFiles) {
    return meta.cssVarsFiles
      .map((pattern) =>
        pattern.replace(/\{params\.([\w.]+)\|([^}]*)\}/g, (_, key: string, fallback: string) => {
          const value = lookupCi(siteParams, key.split('.'))?.value
          return typeof value === 'string' && /^[\w.-]+$/.test(value) ? value : fallback
        }),
      )
      .filter((p) => theme.files.includes(p))
  }
  return theme.files
    .filter((f) => f.startsWith('assets/') && /\.(css|scss)$/i.test(f) && !SKIP.test(f) && (theme.sizes[f] ?? 0) < 300_000)
    .slice(0, MAX_FILES)
}

/** Where the theme takes extra CSS: from the profile, else a recognised hook folder or file. */
export function cssHookFor(theme: ThemeData, meta: ThemeMeta | null): CssHookDir | CssHookFile | null {
  if (meta?.cssHook) return meta.cssHook
  if (theme.files.some((f) => f.startsWith('assets/css/extended/'))) return { kind: 'dir', path: 'assets/css/extended/', fileName: 'hugo-publisher.css' }
  for (const path of ['assets/css/custom.css', 'assets/scss/custom.scss', 'assets/css/_custom.scss', 'assets/_custom.scss']) {
    if (theme.files.includes(path)) return { kind: 'file', path }
  }
  return null
}

export function hookTarget(hook: CssHookDir | CssHookFile): string {
  return hook.kind === 'dir' ? `${hook.path}${hook.fileName}` : hook.path
}
