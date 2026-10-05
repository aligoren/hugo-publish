// Typed wrappers around the Rust commands in src-tauri/src/commands.rs.
import { invoke as tauriInvoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

// `hugo config` takes a moment and several views ask for it at the same time (opening a site or
// a document): callers asking while a request is running share it. A command that may change
// files or the open site ends the sharing, so nobody gets values from before the change.
const MAY_CHANGE_CONFIG = /write|rename|delete|create|install|apply|import|strip|mod_get|mod_restore|mod_vendor|checkout|site_open|site_refresh|pull|discard/
const pendingConfig = new Map<string, Promise<unknown>>()

function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (command === 'config_effective') {
    const key = String(args?.environment ?? '')
    const shared = pendingConfig.get(key)
    if (shared) return shared as Promise<T>
    const request = tauriInvoke<T>(command, args).finally(() => {
      if (pendingConfig.get(key) === request) pendingConfig.delete(key)
    })
    pendingConfig.set(key, request)
    return request
  }
  if (MAY_CHANGE_CONFIG.test(command)) pendingConfig.clear()
  return tauriInvoke<T>(command, args)
}

/** Error shape produced by `AppError` on the Rust side. */
export interface AppErrorPayload {
  code: string
  message: string
}

export function isAppError(value: unknown): value is AppErrorPayload {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as AppErrorPayload).code === 'string' &&
    typeof (value as AppErrorPayload).message === 'string'
  )
}

export interface HugoVersion {
  major: number
  minor: number
  patch: number
  extended: boolean
  withDeploy: boolean
  os: string
  arch: string
}

export interface HugoInfo {
  path: string
  version: HugoVersion
  raw: string
}

export interface SiteInfo {
  root: string
  name: string
  configFiles: string[]
  contentDir: string
  isGitRepo: boolean
}

export interface ContentFile {
  path: string
  title: string | null
  modifiedMs: number
}

export interface TextFile {
  text: string
  version: string
}

export interface PageEntry {
  path: string
  slug: string
  title: string
  date: string
  expiryDate: string
  publishDate: string
  draft: boolean
  permalink: string
  kind: string
  section: string
}

export interface ServerOptions {
  drafts?: boolean
  future?: boolean
  expired?: boolean
  environment?: string
}

export interface ServerStatus {
  serverId: number
  url: string
  port: number
}

export interface SourceLocation {
  file: string
  line: number
  column: number | null
}

export type ServerEvent = { serverId: number } & (
  | {
      type: 'log'
      stream: 'stdout' | 'stderr'
      level: 'error' | 'warn' | 'info'
      text: string
      location: SourceLocation | null
    }
  | { type: 'ready'; url: string }
  | { type: 'exited' }
)

export interface ConfigEdit {
  path: string
  before: string
  after: string
  version: string
}

/** A path into a config document: table keys, and array indexes for arrays of tables / lists. */
export type KeyPath = (string | number)[]

/** One change to a config file. A batch of ops becomes one diff and one write. */
export type ConfigOp =
  /** Set a value. Missing parent tables are created; an existing value keeps its spacing and comment. */
  | { op: 'set'; path: KeyPath; value: unknown }
  /** Delete a key, a table, or one entry of an array of tables (path ends with its index). */
  | { op: 'remove'; path: KeyPath }
  /** Append an entry such as `[[menus.main]]`, formatted like its siblings. */
  | { op: 'appendTable'; path: string[]; entries: Record<string, unknown> }

export interface TomlReadResult {
  /** Parsed values, with the key casing used in the file. Dates become strings as written. */
  values: Record<string, unknown>
  /**
   * Comments next to keys and tables, by dotted path (`params.ShowToc`, `menu.main.0.weight`):
   * the comment lines directly above plus a trailing comment on the same line, `#` removed,
   * joined with `\n`. Useful as help text, e.g. for a theme's commented defaults.
   */
  comments: Record<string, string>
}

export interface HugoMessage {
  level: 'error' | 'warn' | 'info'
  text: string
}

export interface EffectiveConfig {
  /** `hugo config --format json --printZero`. Hugo lower-cases every key, including params. */
  values: Record<string, unknown>
  /** What Hugo printed while loading the config (deprecations, errors). */
  messages: HugoMessage[]
}

export interface ConfigValidation {
  /** False when Hugo could not load the site with the proposed config. */
  ok: boolean
  messages: HugoMessage[]
}

export interface SiteFile {
  /** Site-relative path with forward slashes. */
  path: string
  size: number
}

export type GitFileKind = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflicted' | 'typechange'

export interface GitFile {
  path: string
  /** For renames: the old path. */
  origPath: string | null
  /** Porcelain v2 status letters, e.g. `M`, `A`, `D`, `.` for unchanged. */
  index: string
  worktree: string
  kind: GitFileKind
}

export interface GitStatus {
  isRepo: boolean
  branch: string | null
  upstream: string | null
  ahead: number
  behind: number
  files: GitFile[]
  userName: string | null
  userEmail: string | null
  remoteUrl: string | null
}

export interface GitResult {
  /** Combined git output, for showing to the user. */
  output: string
}

export interface Archetype {
  /** The `--kind` name, e.g. `post` for archetypes/post.md. */
  name: string
  /** Site-relative path of the archetype file or directory. */
  path: string
  source: 'site' | 'theme'
}

// ---- New sites and themes ---------------------------------------------------------------

export interface ThemeSource {
  owner: string
  repo: string
  /** Branch, tag or commit; the default branch when omitted. */
  reference?: string
  /** Folder under `themes/` and the config `theme` value. */
  name: string
}

export interface NewSiteOptions {
  /** Existing folder the site folder is created in. */
  parentDir: string
  /** Folder name of the new site. */
  name: string
  title: string
  language: string
  theme?: ThemeSource | null
  gitInit: boolean
}

export interface InstalledTheme {
  name: string
  path: string
  files: number
}

// ---- Local history -------------------------------------------------------------------------

export interface Snapshot {
  id: string
  path: string
  createdMs: number
  size: number
  reason: 'save' | 'manual' | 'restore'
}

// ---- Media ---------------------------------------------------------------------------------

export interface MediaFile {
  path: string
  size: number
  width: number | null
  height: number | null
  format: 'jpeg' | 'png' | 'webp' | 'gif' | 'svg' | 'avif' | 'other' | null
  hasGps: boolean
  /** Metadata that cleaning would remove (EXIF, XMP, IPTC, comments…); an ICC profile or an orientation-only EXIF block does not count. */
  hasMetadata: boolean
  modifiedMs: number
}

export interface MediaDetails {
  file: MediaFile
  entries: { group: string; key: string; value: string }[]
  camera: string | null
  takenAt: string | null
  gps: { lat: number; lon: number } | null
}

export interface ImportOptions {
  /** Site-relative folder, e.g. `static/images` or a page bundle folder. */
  targetDir: string
  stripMetadata: boolean
  /** Downscale wider images to this width. */
  maxWidth?: number | null
  /** Name to use instead of the source file name. */
  fileName?: string | null
  overwrite?: boolean
}

// ---- Hugo versions -------------------------------------------------------------------------

export interface HugoRelease {
  /** Without the leading `v`. */
  version: string
  publishedAt: string
  prerelease: boolean
}

export interface ManagedHugo {
  version: string
  extended: boolean
  path: string
}

export interface HugoInstallProgress {
  version: string
  received: number
  total: number | null
  stage: 'download' | 'verify' | 'extract' | 'done'
}

// ---- Build & health ------------------------------------------------------------------------

export interface BuildOptions {
  drafts?: boolean
  future?: boolean
  environment?: string
  /** Build this git revision (e.g. `HEAD`) instead of the files on disk. */
  revision?: string
}

export interface BuildFile {
  path: string
  size: number
  hash: string
}

export interface BuildResult {
  ok: boolean
  /** Absolute temp folder; pass to `readBuildFile` / `discardBuild`. */
  outputDir: string
  files: BuildFile[]
  messages: HugoMessage[]
  durationMs: number
}

export interface LinkCheck {
  url: string
  ok: boolean
  status: number | null
  finalUrl: string | null
  error: string | null
}

export interface FetchedPage {
  status: number
  finalUrl: string
  body: string
}

export interface AiStatus {
  enabled: boolean
  hasKey: boolean
  model: string
}

export const api = {
  hugoDetect: (customPath?: string) => invoke<HugoInfo>('hugo_detect', { customPath }),
  serverStart: (options: ServerOptions) => invoke<ServerStatus>('hugo_server_start', { options }),
  serverStop: () => invoke<void>('hugo_server_stop'),
  serverStatus: () => invoke<ServerStatus | null>('hugo_server_status'),
  listPages: () => invoke<PageEntry[]>('hugo_list_pages'),
  /** The site folder passed on the command line, once. */
  startupSite: () => invoke<string | null>('startup_site'),
  /** Which of the folders still exist, in the same order. */
  pathsExist: (paths: string[]) => invoke<boolean[]>('paths_exist', { paths }),
  siteOpen: (path: string) => invoke<SiteInfo>('site_open', { path }),
  /** Re-reads the open site's info (e.g. after its config files changed); the preview keeps running. */
  siteRefresh: () => invoke<SiteInfo>('site_refresh'),
  listContent: () => invoke<ContentFile[]>('site_list_content'),
  readText: (path: string) => invoke<TextFile>('site_read_text', { path }),
  writeText: (path: string, text: string, expectedVersion?: string) =>
    invoke<string>('site_write_text', { path, text, expectedVersion }),
  previewSetValue: (path: string, keyPath: string[], value: unknown) =>
    invoke<ConfigEdit>('config_preview_set_value', { path, keyPath, value }),
  previewAddMenuEntry: (path: string, menu: string, entry: Record<string, unknown>) =>
    invoke<ConfigEdit>('config_preview_add_menu_entry', { path, menu, entry }),

  /** Recursive file list under a site-relative folder; `extensions` without dots, empty = all. */
  listFiles: (dir: string, extensions: string[] = []) => invoke<SiteFile[]>('site_list_files', { dir, extensions }),
  /** Reads a TOML file inside the site (config or a theme's defaults) with its comments. */
  tomlRead: (path: string) => invoke<TomlReadResult>('toml_read', { path }),
  /** Applies config ops to a TOML file in memory and returns the diff; nothing is written. */
  configPreviewOps: (path: string, ops: ConfigOp[]) => invoke<ConfigEdit>('config_preview_ops', { path, ops }),
  /** Loads the site with `text` in place of the config file at `path`, without writing it. */
  configValidate: (path: string, text: string) => invoke<ConfigValidation>('config_validate', { path, text }),
  /** Checks several config files at once (`text: null` = file removed), from temporary copies. */
  configValidateFiles: (files: { path: string; text: string | null }[]) =>
    invoke<ConfigValidation>('config_validate_files', { files }),
  configEffective: (environment?: string) => invoke<EffectiveConfig>('config_effective', { environment }),

  gitStatus: () => invoke<GitStatus>('git_status'),
  /** Unified diff of one file against HEAD (untracked files: the whole file). */
  gitDiff: (path: string) => invoke<string>('git_diff', { path }),
  /** Stages `paths` (all changes when empty) and commits. Returns the new commit's short hash. */
  gitCommit: (message: string, paths: string[] = []) => invoke<string>('git_commit', { message, paths }),
  /** `git pull --rebase --autostash` from the upstream branch. */
  gitPull: () => invoke<GitResult>('git_pull'),
  gitPush: () => invoke<GitResult>('git_push'),
  /** `git fetch`, so ahead/behind are current. */
  gitFetch: () => invoke<GitResult>('git_fetch'),

  listArchetypes: () => invoke<Archetype[]>('hugo_list_archetypes'),
  /** `hugo new content <path> [--kind kind]`; `path` is site-relative, e.g. `content/posts/x.md`. */
  newContent: (path: string, kind?: string) => invoke<string>('hugo_new_content', { path, kind }),

  /** Creates a new Hugo site (and installs a theme); returns its folder for `siteOpen`. */
  siteCreate: (options: NewSiteOptions) => invoke<string>('site_create', { options }),
  /** Downloads a theme from GitHub into the open site's `themes/` folder. */
  themeInstall: (source: ThemeSource) => invoke<InstalledTheme>('theme_install', { source }),
  /** Zips the site (without public/, resources/, .git) to an absolute path outside the site. */
  siteBackup: (destination: string) => invoke<{ path: string; files: number; bytes: number }>('site_backup', { destination }),
  /** Downloads a new version of an installed theme into `.hugo-publisher/theme-update/<name>` for review. */
  themeStageUpdate: (source: ThemeSource) => invoke<InstalledTheme>('theme_stage_update', { source }),
  /** Replaces `themes/<name>` with the staged update (old copy restored if the swap fails). */
  themeApplyUpdate: (name: string) => invoke<void>('theme_apply_update', { name }),
  themeDiscardUpdate: (name: string) => invoke<void>('theme_discard_update', { name }),
  /** Default branch, the commit `reference` (or the default branch) points to, and tags (GitHub API). */
  themeRepoInfo: (owner: string, repo: string, reference?: string | null) =>
    invoke<{ defaultBranch: string; commit: string; tags: string[] }>('theme_repo_info', {
      owner,
      repo,
      reference: reference ?? null,
    }),
  /** Deletes one site file that overrides a theme file (layouts/, assets/, i18n/, archetypes/). */
  siteDeleteOverride: (path: string) => invoke<void>('site_delete_override', { path }),
  /** Deletes a content file or page bundle (only under `content/`). */
  siteDelete: (path: string) => invoke<void>('site_delete', { path }),
  /** Renames/moves a file or folder inside the site; never overwrites. Returns the new path. */
  renameFile: (from: string, to: string) => invoke<string>('site_rename', { from, to }),
  /** Applies config ops to a TOML text (e.g. TOML front matter). */
  tomlEditText: (text: string, ops: ConfigOp[]) => invoke<string>('toml_edit_text', { text, ops }),
  tomlParseText: (text: string) => invoke<TomlReadResult>('toml_parse_text', { text }),

  /** Snapshot of a file's text, kept in the app data folder (not in the site). */
  historySave: (path: string, text: string, reason: Snapshot['reason']) =>
    invoke<Snapshot>('history_save', { path, text, reason }),
  /** Snapshots of a file, newest first. */
  historyList: (path: string) => invoke<Snapshot[]>('history_list', { path }),
  historyRead: (path: string, id: string) => invoke<string>('history_read', { path, id }),

  mediaList: () => invoke<MediaFile[]>('media_list'),
  mediaDetails: (path: string) => invoke<MediaDetails>('media_details', { path }),
  /** Copies image files from anywhere on disk (absolute paths) into the site. */
  mediaImportFiles: (sources: string[], options: ImportOptions) =>
    invoke<string[]>('media_import_files', { sources, options }),
  /** Imports pasted image bytes (base64). */
  mediaImportBytes: (fileName: string, dataBase64: string, options: ImportOptions) =>
    invoke<string>('media_import_bytes', { fileName, dataBase64, options }),
  /** Removes EXIF/XMP/IPTC (GPS included) without re-encoding the image. */
  mediaStripMetadata: (path: string) => invoke<MediaFile>('media_strip_metadata', { path }),
  mediaDelete: (path: string) => invoke<void>('media_delete', { path }),
  /** A small preview as a `data:` URL. */
  mediaThumbnail: (path: string, maxSize = 256) => invoke<string>('media_thumbnail', { path, maxSize }),

  hugoReleases: () => invoke<HugoRelease[]>('hugo_releases'),
  hugoInstalled: () => invoke<ManagedHugo[]>('hugo_installed'),
  hugoInstall: (version: string, extended: boolean) => invoke<ManagedHugo>('hugo_install', { version, extended }),
  hugoUninstall: (version: string, extended: boolean) => invoke<void>('hugo_uninstall', { version, extended }),
  /** Persists the Hugo binary to use (`null` = automatic detection); returns the active Hugo. */
  hugoSetPreferred: (path: string | null) => invoke<HugoInfo | null>('hugo_set_preferred', { path }),
  hugoPreferred: () => invoke<string | null>('hugo_preferred'),
  onHugoInstallProgress: (handler: (progress: HugoInstallProgress) => void): Promise<UnlistenFn> =>
    listen<HugoInstallProgress>('hugo-install', (event) => handler(event.payload)),

  /** Builds the site into a temporary folder (or a git revision via a temporary worktree). */
  buildSite: (options: BuildOptions = {}) => invoke<BuildResult>('build_site', { options }),
  readBuildFile: (outputDir: string, path: string) => invoke<string>('read_build_file', { outputDir, path }),
  discardBuild: (outputDir: string) => invoke<void>('discard_build', { outputDir }),
  /** Checks external http(s) links. */
  checkLinks: (urls: string[]) => invoke<LinkCheck[]>('check_links', { urls }),
  /** GET from the local preview server (localhost / 127.0.0.1 only). */
  fetchPreview: (url: string) => invoke<string>('fetch_preview', { url }),
  /** GET of a public http(s) page (e.g. the live site after publishing). */
  fetchPage: (url: string) => invoke<FetchedPage>('fetch_page', { url }),

  /** The opt-in AI assistant (Anthropic API, the user's own key kept in the OS credential store). */
  aiStatus: () => invoke<AiStatus>('ai_status'),
  aiConfigure: (enabled: boolean) => invoke<AiStatus>('ai_configure', { enabled }),
  /** Stores the API key in the OS credential store; `null` deletes it. */
  aiSetKey: (key: string | null) => invoke<AiStatus>('ai_set_key', { key }),
  aiDescribe: (title: string, body: string, language: string) => invoke<string>('ai_describe', { title, body, language }),
  aiTitles: (title: string, body: string, language: string) => invoke<string[]>('ai_titles', { title, body, language }),
  /** Alt text for an image inside the site (`path` is site-relative). */
  aiAltText: (path: string, context: string, language: string) => invoke<string>('ai_alt_text', { path, context, language }),
  aiTranslate: (markdown: string, from: string, to: string) => invoke<string>('ai_translate', { markdown, from, to }),

  onServerEvent: (handler: (event: ServerEvent) => void): Promise<UnlistenFn> =>
    listen<ServerEvent>('hugo-server', (event) => handler(event.payload)),
}

/** The preview URL of a page: the permalink's path on the local server. */
export function previewUrl(serverUrl: string, permalink: string): string {
  try {
    const server = new URL(serverUrl)
    const page = new URL(permalink)
    return `${server.origin}${page.pathname}${page.search}`
  } catch {
    return serverUrl
  }
}

// ---- Theme components: Hugo Modules, git submodules, file hashes --------------------------

export interface ModuleMount {
  /** Folder inside the module. */
  source: string
  /** Where it appears for Hugo (`layouts`, `assets/x`…). */
  target: string
  lang?: string
}

/** One theme component from `hugo config mounts` (the site itself is left out). */
export interface HugoModule {
  /** Module path (`github.com/user/theme`), a theme folder name, or a replacement path. */
  path: string
  /** go.mod version (`v1.2.0`, a pseudo-version); empty for theme folders and replacements. */
  version: string
  time: string
  /** The importing module (`project` for the site's own imports). */
  owner: string
  /** Absolute folder of the module. */
  dir: string
  mounts: ModuleMount[]
  /** Site-relative folder when the module lives inside the site (themes/, _vendor/). */
  siteDir: string | null
  /** Read from the site's `_vendor/` folder. */
  vendored: boolean
  /** `module` line of the module's own go.mod. */
  modulePath: string | null
}

export interface FileHash {
  path: string
  /** Hex SHA-256 (line endings normalised in text files). */
  sha256: string
  size: number
}

export interface GoModTexts {
  /** null when the file does not exist. */
  goMod: string | null
  goSum: string | null
}

export interface ModGetResult {
  before: GoModTexts
  after: GoModTexts
  output: string
}

export interface GitSubmodule {
  name: string
  /** Site-relative path. */
  path: string
  url: string
  branch: string | null
}

export interface SubmoduleStatus {
  path: string
  initialized: boolean
  head: string | null
  /** `git describe --tags --always`. */
  describe: string | null
  /** Tracked files with local changes. */
  changes: string[]
}

export const moduleApi = {
  /** `hugo config mounts`: the site's theme components in Hugo's order. */
  moduleList: (ignoreVendor = false) => invoke<HugoModule[]>('hugo_module_list', { ignoreVendor }),
  /** Files of a module folder from `moduleList`; paths relative to the folder. */
  moduleListFiles: (dir: string, sub = '.', extensions: string[] = []) =>
    invoke<SiteFile[]>('hugo_module_list_files', { dir, sub, extensions }),
  moduleReadText: (dir: string, path: string) => invoke<TextFile>('hugo_module_read_text', { dir, path }),
  moduleHashFiles: (dir: string, paths: string[]) => invoke<FileHash[]>('hugo_module_hash_files', { dir, paths }),
  /** Content hashes of site files (site-relative); missing files are left out. */
  siteHashFiles: (paths: string[]) => invoke<FileHash[]>('site_hash_files', { paths }),
  /** `hugo mod get <module>@<version>` in the site folder; go.mod/go.sum before and after. */
  modGet: (module: string, version: string) => invoke<ModGetResult>('hugo_mod_get', { module, version }),
  /** Writes go.mod and go.sum back (null removes the file). */
  modRestore: (texts: GoModTexts) => invoke<void>('hugo_mod_restore', { texts }),
  /** `hugo mod vendor`. */
  modVendor: () => invoke<string>('hugo_mod_vendor'),
  submodules: () => invoke<GitSubmodule[]>('theme_submodules'),
  submoduleStatus: (path: string) => invoke<SubmoduleStatus>('theme_submodule_status', { path }),
  /** `git fetch --tags origin` + `git checkout <reference>` in the submodule (refused with local changes). */
  submoduleCheckout: (path: string, reference: string) =>
    invoke<SubmoduleStatus>('theme_submodule_checkout', { path, reference }),
}
