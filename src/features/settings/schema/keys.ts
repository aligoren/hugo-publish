// The settings catalog for Hugo 0.167.
// `params` is not here: the Theme screen owns it. Menus have their own editor.

import { CHROMA_STYLE_NAMES } from './chroma'
import { PAGE_KINDS } from './options'
import type { Control, GroupId, Level, SettingDef, ValueType } from './types'

const DOCS = 'https://gohugo.io/configuration/'

function doc(page: string, anchor?: string): string {
  return `${DOCS}${page}/${anchor ? `#${anchor}` : ''}`
}

type Extra = Partial<Pick<SettingDef, 'requiresConfirm' | 'deprecated' | 'since'>>

function key(
  path: string,
  group: GroupId,
  level: Level,
  type: ValueType,
  control: Control,
  dflt: unknown,
  docs: string,
  extra: Extra = {},
): SettingDef {
  return { path: path.split('.'), group, level, type, control, default: dflt, docs, ...extra }
}

const TOGGLE: Control = { kind: 'toggle' }

function bool(path: string, group: GroupId, level: Level, dflt: boolean, docs: string, extra?: Extra) {
  return key(path, group, level, 'boolean', TOGGLE, dflt, docs, extra)
}

function text(
  path: string,
  group: GroupId,
  level: Level,
  dflt: string | undefined,
  docs: string,
  control: Control = { kind: 'text' },
  extra?: Extra,
) {
  return key(path, group, level, 'string', control, dflt, docs, extra)
}

function int(
  path: string,
  group: GroupId,
  level: Level,
  dflt: number,
  docs: string,
  range: { min?: number; max?: number } = {},
  extra?: Extra,
) {
  return key(path, group, level, 'integer', { kind: 'number', step: 1, ...range }, dflt, docs, extra)
}

function choice(
  path: string,
  group: GroupId,
  level: Level,
  options: readonly string[],
  dflt: string,
  docs: string,
  extra?: Extra,
) {
  return key(path, group, level, 'string', { kind: 'select', options }, dflt, docs, extra)
}

function lines(path: string, group: GroupId, level: Level, dflt: string[] | undefined, docs: string, extra?: Extra) {
  return key(path, group, level, 'stringList', { kind: 'lines' }, dflt, docs, extra)
}

function list(
  path: string,
  group: GroupId,
  level: Level,
  dflt: string[] | undefined,
  docs: string,
  suggestions?: Extract<Control, { kind: 'list' }>['suggestions'],
  extra?: Extra,
) {
  return key(path, group, level, 'stringList', { kind: 'list', suggestions }, dflt, docs, extra)
}

const all = (k: string) => doc('all', k.toLowerCase())

// ---- Site identity ----------------------------------------------------------------------------

const identity: SettingDef[] = [
  text('title', 'identity', 'basic', '', all('title')),
  key('baseURL', 'identity', 'basic', 'string', { kind: 'url', trailingSlash: true }, 'https://example.org/', all('baseURL'), {
    since: '0.167.0',
  }),
  text('locale', 'identity', 'basic', '', all('locale'), { kind: 'text', suggestions: 'locales' }, { since: '0.158.0' }),
  text('copyright', 'identity', 'basic', '', all('copyright')),
  key('theme', 'identity', 'basic', 'stringOrList', { kind: 'list' }, undefined, all('theme')),
  text('timeZone', 'identity', 'basic', '', all('timeZone'), { kind: 'text', suggestions: 'timeZones' }),
]

// ---- URLs and permalinks ----------------------------------------------------------------------

const PERMALINK_KV: Control = { kind: 'kv', keyPlaceholder: 'posts', valuePlaceholder: '/:year/:month/:slug/' }

const urls: SettingDef[] = [
  key('permalinks', 'urls', 'basic', 'stringMap', PERMALINK_KV, undefined, doc('permalinks')),
  key('permalinks.page', 'urls', 'advanced', 'stringMap', PERMALINK_KV, undefined, doc('permalinks')),
  key('permalinks.section', 'urls', 'advanced', 'stringMap', PERMALINK_KV, undefined, doc('permalinks')),
  key('permalinks.taxonomy', 'urls', 'advanced', 'stringMap', PERMALINK_KV, undefined, doc('permalinks')),
  key('permalinks.term', 'urls', 'advanced', 'stringMap', PERMALINK_KV, undefined, doc('permalinks')),
  bool('removePathAccents', 'urls', 'basic', false, all('removePathAccents')),
  bool('uglyURLs', 'urls', 'advanced', false, doc('ugly-urls')),
  bool('disablePathToLower', 'urls', 'advanced', false, all('disablePathToLower')),
  bool('disableAliases', 'urls', 'advanced', false, all('disableAliases')),
  bool('relativeURLs', 'urls', 'advanced', false, all('relativeURLs'), { requiresConfirm: true }),
  bool('canonifyURLs', 'urls', 'advanced', false, all('canonifyURLs'), { requiresConfirm: true }),
  choice('refLinksErrorLevel', 'urls', 'advanced', ['ERROR', 'WARNING'], 'ERROR', all('refLinksErrorLevel')),
  text('refLinksNotFoundURL', 'urls', 'advanced', '', all('refLinksNotFoundURL')),
]

// ---- Content ----------------------------------------------------------------------------------

const content: SettingDef[] = [
  int('summaryLength', 'content', 'basic', 70, all('summaryLength'), { min: 0 }),
  key('mainSections', 'content', 'basic', 'stringOrList', { kind: 'list', suggestions: 'sections' }, undefined, all('mainSections')),
  bool('buildDrafts', 'content', 'basic', false, all('buildDrafts')),
  bool('buildFuture', 'content', 'basic', false, all('buildFuture')),
  bool('buildExpired', 'content', 'basic', false, all('buildExpired')),
  bool('enableEmoji', 'content', 'basic', false, all('enableEmoji')),
  key('disableKinds', 'content', 'advanced', 'stringList', { kind: 'multi', options: PAGE_KINDS }, [], all('disableKinds')),
  bool('enableGitInfo', 'content', 'advanced', false, all('enableGitInfo')),
  bool('hasCJKLanguage', 'content', 'advanced', false, all('hasCJKLanguage')),
  bool('pluralizeListTitles', 'content', 'advanced', true, all('pluralizeListTitles')),
  bool('capitalizeListTitles', 'content', 'advanced', true, all('capitalizeListTitles')),
  choice('titleCaseStyle', 'content', 'advanced', ['ap', 'chicago', 'go', 'firstupper', 'none'], 'ap', all('titleCaseStyle')),
  text('defaultOutputFormat', 'content', 'advanced', 'html', all('defaultOutputFormat'), {
    kind: 'text',
    suggestions: 'outputFormats',
  }),
  text('newContentEditor', 'content', 'advanced', '', all('newContentEditor')),
  list('frontmatter.date', 'content', 'advanced', ['date', 'publishdate', 'pubdate', 'published', 'lastmod', 'modified'], doc('front-matter'), [
    ':default',
    ':filename',
    ':fileModTime',
    ':git',
  ]),
  list('frontmatter.publishDate', 'content', 'advanced', ['publishdate', 'pubdate', 'published', 'date'], doc('front-matter'), [
    ':default',
    ':filename',
    ':fileModTime',
    ':git',
  ]),
  list(
    'frontmatter.lastmod',
    'content',
    'advanced',
    [':git', 'lastmod', 'modified', 'date', 'publishdate', 'pubdate', 'published'],
    doc('front-matter'),
    [':default', ':fileModTime', ':git'],
  ),
  list('frontmatter.expiryDate', 'content', 'advanced', ['expirydate', 'unpublishdate'], doc('front-matter'), [':default']),
  choice('page.nextPrevSortOrder', 'content', 'advanced', ['asc', 'desc'], 'desc', doc('page')),
  choice('page.nextPrevInSectionSortOrder', 'content', 'advanced', ['asc', 'desc'], 'desc', doc('page')),
  int('related.threshold', 'content', 'advanced', 80, doc('related-content'), { min: 0, max: 100 }),
  bool('related.includeNewer', 'content', 'advanced', false, doc('related-content')),
  bool('related.toLower', 'content', 'advanced', false, doc('related-content')),
  key(
    'related.indices',
    'content',
    'advanced',
    'objectList',
    {
      kind: 'table',
      columns: [
        { key: 'name', type: 'text' },
        { key: 'type', type: 'select', options: ['basic', 'fragments'] },
        { key: 'weight', type: 'number' },
        { key: 'pattern', type: 'text' },
        { key: 'toLower', type: 'toggle' },
        { key: 'applyFilter', type: 'toggle' },
        { key: 'cardinalityThreshold', type: 'number' },
        { key: 'tokenize', type: 'toggle' },
        { key: 'minTokenLength', type: 'number' },
      ],
    },
    [
      { name: 'keywords', type: 'basic', weight: 100 },
      { name: 'date', type: 'basic', weight: 10 },
      { name: 'tags', type: 'basic', weight: 80 },
    ],
    doc('related-content'),
  ),
]

// ---- Taxonomies -------------------------------------------------------------------------------

const taxonomies: SettingDef[] = [
  key(
    'taxonomies',
    'taxonomies',
    'basic',
    'stringMap',
    { kind: 'kv', keyPlaceholder: 'tag', valuePlaceholder: 'tags' },
    { category: 'categories', tag: 'tags' },
    doc('taxonomies'),
  ),
  text('sectionPagesMenu', 'taxonomies', 'advanced', '', all('sectionPagesMenu'), { kind: 'text', suggestions: 'menus' }),
]

// ---- Markdown (Goldmark) ----------------------------------------------------------------------

const GM = 'markup.goldmark'
const goldmark = doc('markup', 'goldmark')
const USE_EMBEDDED = ['auto', 'never', 'always', 'fallback'] as const

function typographer(name: string, dflt: string): SettingDef {
  return text(`${GM}.extensions.typographer.${name}`, 'markdown', 'advanced', dflt, goldmark, { kind: 'text', monospace: true })
}

const markdown: SettingDef[] = [
  bool(`${GM}.renderer.unsafe`, 'markdown', 'basic', false, goldmark, { requiresConfirm: true }),
  bool(`${GM}.renderer.hardWraps`, 'markdown', 'basic', false, goldmark),
  bool(`${GM}.extensions.typographer.disable`, 'markdown', 'basic', false, goldmark),
  bool(`${GM}.extensions.passthrough.enable`, 'markdown', 'basic', false, goldmark),
  key(`${GM}.extensions.passthrough.delimiters.block`, 'markdown', 'advanced', 'pairList', { kind: 'pairs' }, [], goldmark),
  key(`${GM}.extensions.passthrough.delimiters.inline`, 'markdown', 'advanced', 'pairList', { kind: 'pairs' }, [], goldmark),
  bool(`${GM}.parser.attribute.title`, 'markdown', 'advanced', true, goldmark),
  bool(`${GM}.parser.attribute.block`, 'markdown', 'advanced', false, goldmark),
  bool(`${GM}.parser.autoHeadingID`, 'markdown', 'advanced', true, goldmark),
  choice(`${GM}.parser.autoIDType`, 'markdown', 'advanced', ['github', 'github-ascii', 'blackfriday'], 'github', goldmark),
  bool(`${GM}.parser.autoDefinitionTermID`, 'markdown', 'advanced', false, goldmark, { since: '0.144.0' }),
  bool(`${GM}.parser.wrapStandAloneImageWithinParagraph`, 'markdown', 'advanced', true, goldmark),
  choice(`${GM}.renderHooks.image.useEmbedded`, 'markdown', 'advanced', USE_EMBEDDED, 'auto', goldmark, { since: '0.148.0' }),
  choice(`${GM}.renderHooks.link.useEmbedded`, 'markdown', 'advanced', USE_EMBEDDED, 'auto', goldmark, { since: '0.148.0' }),
  bool(`${GM}.renderer.xhtml`, 'markdown', 'advanced', false, goldmark),
  bool(`${GM}.duplicateResourceFiles`, 'markdown', 'advanced', false, goldmark),
  bool(`${GM}.extensions.table`, 'markdown', 'advanced', true, goldmark),
  bool(`${GM}.extensions.strikethrough`, 'markdown', 'advanced', true, goldmark),
  bool(`${GM}.extensions.taskList`, 'markdown', 'advanced', true, goldmark),
  bool(`${GM}.extensions.definitionList`, 'markdown', 'advanced', true, goldmark),
  bool(`${GM}.extensions.linkify`, 'markdown', 'advanced', true, goldmark),
  choice(`${GM}.extensions.linkifyProtocol`, 'markdown', 'advanced', ['http', 'https'], 'https', goldmark),
  bool(`${GM}.extensions.footnote.enable`, 'markdown', 'advanced', true, goldmark, { since: '0.151.0' }),
  text(`${GM}.extensions.footnote.backlinkHTML`, 'markdown', 'advanced', '&#x21a9;&#xfe0e;', goldmark, {
    kind: 'text',
    monospace: true,
  }),
  bool(`${GM}.extensions.footnote.enableAutoIDPrefix`, 'markdown', 'advanced', false, goldmark),
  typographer('leftDoubleQuote', '&ldquo;'),
  typographer('rightDoubleQuote', '&rdquo;'),
  typographer('leftSingleQuote', '&lsquo;'),
  typographer('rightSingleQuote', '&rsquo;'),
  typographer('leftAngleQuote', '&laquo;'),
  typographer('rightAngleQuote', '&raquo;'),
  typographer('apostrophe', '&rsquo;'),
  typographer('enDash', '&ndash;'),
  typographer('emDash', '&mdash;'),
  typographer('ellipsis', '&hellip;'),
  bool(`${GM}.extensions.extras.delete.enable`, 'markdown', 'advanced', false, goldmark),
  bool(`${GM}.extensions.extras.insert.enable`, 'markdown', 'advanced', false, goldmark),
  bool(`${GM}.extensions.extras.mark.enable`, 'markdown', 'advanced', false, goldmark),
  bool(`${GM}.extensions.extras.subscript.enable`, 'markdown', 'advanced', false, goldmark),
  bool(`${GM}.extensions.extras.superscript.enable`, 'markdown', 'advanced', false, goldmark),
  bool(`${GM}.extensions.cjk.enable`, 'markdown', 'advanced', false, goldmark),
  bool(`${GM}.extensions.cjk.eastAsianLineBreaks`, 'markdown', 'advanced', false, goldmark),
  choice(`${GM}.extensions.cjk.eastAsianLineBreaksStyle`, 'markdown', 'advanced', ['simple', 'css3draft'], 'simple', goldmark),
  bool(`${GM}.extensions.cjk.escapedSpace`, 'markdown', 'advanced', false, goldmark),
  choice('markup.defaultMarkdownHandler', 'markdown', 'advanced', ['goldmark', 'asciidocext', 'org', 'pandoc', 'rst'], 'goldmark', doc('markup')),
]

// ---- Syntax highlighting ----------------------------------------------------------------------

const HL = 'markup.highlight'
const highlightDoc = doc('markup', 'highlight')

const highlight: SettingDef[] = [
  key(`${HL}.style`, 'highlight', 'basic', 'string', { kind: 'select', options: CHROMA_STYLE_NAMES }, 'monokai', highlightDoc),
  key(`${HL}.lineNos`, 'highlight', 'basic', 'boolOrString', { kind: 'select', options: [false, true, 'inline', 'table'] }, false, highlightDoc),
  bool(`${HL}.noClasses`, 'highlight', 'advanced', true, highlightDoc),
  bool(`${HL}.codeFences`, 'highlight', 'advanced', true, highlightDoc),
  bool(`${HL}.guessSyntax`, 'highlight', 'advanced', false, highlightDoc),
  bool(`${HL}.lineNumbersInTable`, 'highlight', 'advanced', true, highlightDoc),
  int(`${HL}.lineNoStart`, 'highlight', 'advanced', 1, highlightDoc, { min: 0 }),
  bool(`${HL}.anchorLineNos`, 'highlight', 'advanced', false, highlightDoc),
  text(`${HL}.lineAnchors`, 'highlight', 'advanced', '', highlightDoc),
  text(`${HL}.hl_Lines`, 'highlight', 'advanced', '', highlightDoc, { kind: 'text', monospace: true, placeholder: '2-4 7' }),
  bool(`${HL}.hl_inline`, 'highlight', 'advanced', false, highlightDoc),
  int(`${HL}.tabWidth`, 'highlight', 'advanced', 4, highlightDoc, { min: 1 }),
  text(`${HL}.wrapperClass`, 'highlight', 'advanced', 'highlight', highlightDoc),
]

// ---- Table of contents ------------------------------------------------------------------------

const tocDoc = doc('markup', 'table-of-contents')

const toc: SettingDef[] = [
  int('markup.tableOfContents.startLevel', 'toc', 'basic', 2, tocDoc, { min: 1, max: 6 }),
  int('markup.tableOfContents.endLevel', 'toc', 'basic', 3, tocDoc, { min: 1, max: 6 }),
  bool('markup.tableOfContents.ordered', 'toc', 'basic', false, tocDoc),
]

// ---- SEO --------------------------------------------------------------------------------------

const seo: SettingDef[] = [
  bool('enableRobotsTXT', 'seo', 'basic', false, all('enableRobotsTXT')),
  choice('sitemap.changeFreq', 'seo', 'basic', ['', 'always', 'hourly', 'daily', 'weekly', 'monthly', 'yearly', 'never'], '', doc('sitemap')),
  key('sitemap.priority', 'seo', 'basic', 'number', { kind: 'number', min: -1, max: 1, step: 0.1 }, -1, doc('sitemap')),
  text('sitemap.filename', 'seo', 'advanced', 'sitemap.xml', doc('sitemap')),
  bool('sitemap.disable', 'seo', 'advanced', false, doc('sitemap')),
  bool('disableHugoGeneratorInject', 'seo', 'advanced', false, all('disableHugoGeneratorInject')),
]

// ---- Outputs ----------------------------------------------------------------------------------

function outputs(kind: string, dflt: string[]): SettingDef {
  return key(`outputs.${kind}`, 'outputs', kind === 'home' ? 'basic' : 'advanced', 'stringList', {
    kind: 'multi',
    options: 'outputFormats',
    ordered: true,
  }, dflt, doc('outputs'))
}

const outputSettings: SettingDef[] = [
  outputs('home', ['html', 'rss']),
  outputs('page', ['html']),
  outputs('section', ['html', 'rss']),
  outputs('taxonomy', ['html', 'rss']),
  outputs('term', ['html', 'rss']),
  key(
    'outputFormats',
    'outputs',
    'advanced',
    'objectMap',
    {
      kind: 'table',
      keyColumn: 'name',
      columns: [
        { key: 'mediaType', type: 'text' },
        { key: 'baseName', type: 'text' },
        { key: 'path', type: 'text' },
        { key: 'rel', type: 'text' },
        { key: 'protocol', type: 'text' },
        { key: 'weight', type: 'number' },
        { key: 'isHTML', type: 'toggle' },
        { key: 'isPlainText', type: 'toggle' },
        { key: 'notAlternative', type: 'toggle' },
        { key: 'permalinkable', type: 'toggle' },
        { key: 'noUgly', type: 'toggle' },
        { key: 'ugly', type: 'toggle' },
        { key: 'root', type: 'toggle' },
      ],
    },
    undefined,
    doc('output-formats'),
  ),
  key(
    'mediaTypes',
    'outputs',
    'advanced',
    'objectMap',
    {
      kind: 'table',
      keyColumn: 'type',
      columns: [
        { key: 'suffixes', type: 'list' },
        { key: 'delimiter', type: 'text' },
      ],
    },
    undefined,
    doc('media-types'),
  ),
]

// ---- Pagination -------------------------------------------------------------------------------

const pagination: SettingDef[] = [
  int('pagination.pagerSize', 'pagination', 'basic', 10, doc('pagination'), { min: 1 }),
  text('pagination.path', 'pagination', 'basic', 'page', doc('pagination')),
  bool('pagination.disableAliases', 'pagination', 'advanced', false, doc('pagination')),
]

// ---- Images -----------------------------------------------------------------------------------

const imagingDoc = doc('imaging')
const HINTS = ['drawing', 'icon', 'photo', 'picture', 'text']

const images: SettingDef[] = [
  int('imaging.jpeg.quality', 'images', 'basic', 75, imagingDoc, { min: 1, max: 100 }, { since: '0.163.0' }),
  int('imaging.webp.quality', 'images', 'basic', 75, imagingDoc, { min: 1, max: 100 }, { since: '0.163.0' }),
  int('imaging.avif.quality', 'images', 'basic', 60, imagingDoc, { min: 1, max: 100 }, { since: '0.163.0' }),
  choice(
    'imaging.anchor',
    'images',
    'advanced',
    ['Smart', 'Center', 'TopLeft', 'Top', 'TopRight', 'Left', 'Right', 'BottomLeft', 'Bottom', 'BottomRight'],
    'Smart',
    imagingDoc,
  ),
  choice(
    'imaging.resampleFilter',
    'images',
    'advanced',
    [
      'box',
      'lanczos',
      'catmullRom',
      'mitchellNetravali',
      'linear',
      'nearestNeighbor',
      'hermite',
      'bSpline',
      'gaussian',
      'hann',
      'hamming',
      'blackman',
      'bartlett',
      'welch',
      'cosine',
    ],
    'box',
    imagingDoc,
  ),
  key('imaging.bgColor', 'images', 'advanced', 'string', { kind: 'color' }, '#ffffff', imagingDoc),
  choice('imaging.webp.compression', 'images', 'advanced', ['lossy', 'lossless'], 'lossy', imagingDoc),
  choice('imaging.webp.hint', 'images', 'advanced', HINTS, 'photo', imagingDoc),
  int('imaging.webp.method', 'images', 'advanced', 2, imagingDoc, { min: 0, max: 6 }),
  bool('imaging.webp.useSharpYuv', 'images', 'advanced', false, imagingDoc),
  choice('imaging.avif.compression', 'images', 'advanced', ['lossy', 'lossless'], 'lossy', imagingDoc),
  choice('imaging.avif.hint', 'images', 'advanced', HINTS, 'photo', imagingDoc),
  int('imaging.avif.encoderSpeed', 'images', 'advanced', 10, imagingDoc, { min: 1, max: 10 }),
  key('imaging.meta.sources', 'images', 'advanced', 'stringList', { kind: 'multi', options: ['exif', 'iptc', 'xmp'] }, ['exif', 'iptc'], imagingDoc, {
    since: '0.155.0',
  }),
  lines(
    'imaging.meta.fields',
    'images',
    'advanced',
    ['! *{GPS,Exif,Exposure[MPB],Contrast,Resolution,Sharp,JPEG,Metering,Sensing,Saturation,ColorSpace,Flash,WhiteBalance}*'],
    imagingDoc,
    { since: '0.155.0' },
  ),
]

// ---- Privacy ----------------------------------------------------------------------------------

const privacyDoc = doc('privacy')

const privacy: SettingDef[] = [
  bool('privacy.disqus.disable', 'privacy', 'basic', false, privacyDoc),
  bool('privacy.googleAnalytics.disable', 'privacy', 'basic', false, privacyDoc),
  bool('privacy.googleAnalytics.respectDoNotTrack', 'privacy', 'basic', true, privacyDoc),
  bool('privacy.instagram.disable', 'privacy', 'basic', false, privacyDoc),
  bool('privacy.instagram.simple', 'privacy', 'basic', false, privacyDoc),
  bool('privacy.vimeo.disable', 'privacy', 'basic', false, privacyDoc),
  bool('privacy.vimeo.enableDNT', 'privacy', 'basic', false, privacyDoc),
  bool('privacy.vimeo.simple', 'privacy', 'basic', false, privacyDoc),
  bool('privacy.x.disable', 'privacy', 'basic', false, privacyDoc),
  bool('privacy.x.enableDNT', 'privacy', 'basic', false, privacyDoc),
  bool('privacy.x.simple', 'privacy', 'basic', false, privacyDoc),
  bool('privacy.youTube.disable', 'privacy', 'basic', false, privacyDoc),
  bool('privacy.youTube.privacyEnhanced', 'privacy', 'basic', false, privacyDoc),
]

// ---- Services ---------------------------------------------------------------------------------

const servicesDoc = doc('services')

const services: SettingDef[] = [
  text('services.googleAnalytics.id', 'services', 'basic', '', servicesDoc, { kind: 'text', placeholder: 'G-XXXXXXXXXX', monospace: true }),
  text('services.disqus.shortname', 'services', 'basic', '', servicesDoc),
  int('services.rss.limit', 'services', 'basic', -1, servicesDoc, { min: -1 }),
  bool('services.x.disableInlineCSS', 'services', 'advanced', false, servicesDoc),
]

// ---- Languages --------------------------------------------------------------------------------

const languagesDoc = doc('languages')

const languages: SettingDef[] = [
  text('defaultContentLanguage', 'languages', 'basic', 'en', all('defaultContentLanguage'), { kind: 'text', suggestions: 'languages' }),
  bool('defaultContentLanguageInSubdir', 'languages', 'advanced', false, all('defaultContentLanguageInSubdir')),
  bool('disableDefaultSiteRedirect', 'languages', 'advanced', false, all('disableDefaultSiteRedirect'), { since: '0.154.5' }),
  bool('disableDefaultLanguageRedirect', 'languages', 'advanced', false, all('disableDefaultLanguageRedirect'), {
    deprecated: { since: '0.154.5', replacement: 'disableDefaultSiteRedirect' },
  }),
  bool('enableMissingTranslationPlaceholders', 'languages', 'advanced', false, all('enableMissingTranslationPlaceholders')),
  list('disableLanguages', 'languages', 'advanced', [], all('disableLanguages'), 'languages', {
    deprecated: { since: '0.153.0', replacement: 'languages.*.disabled' },
  }),
  // Per language: rendered once for every language key.
  text('languages.*.label', 'languages', 'basic', '', languagesDoc, undefined, { since: '0.158.0' }),
  text('languages.*.locale', 'languages', 'basic', '', languagesDoc, { kind: 'text', suggestions: 'locales' }, { since: '0.158.0' }),
  choice('languages.*.direction', 'languages', 'basic', ['ltr', 'rtl'], 'ltr', languagesDoc, { since: '0.158.0' }),
  text('languages.*.title', 'languages', 'basic', '', languagesDoc),
  int('languages.*.weight', 'languages', 'basic', 0, languagesDoc),
  bool('languages.*.disabled', 'languages', 'advanced', false, languagesDoc),
  key('languages.*.baseURL', 'languages', 'advanced', 'string', { kind: 'url', trailingSlash: true }, undefined, languagesDoc),
  text('languages.*.contentDir', 'languages', 'advanced', undefined, languagesDoc),
  text('languages.*.timeZone', 'languages', 'advanced', undefined, languagesDoc, { kind: 'text', suggestions: 'timeZones' }),
]

// ---- Build and performance --------------------------------------------------------------------

const minifyDoc = doc('minify')
const buildDoc = doc('build')

const build: SettingDef[] = [
  bool('minify.minifyOutput', 'build', 'basic', false, minifyDoc),
  bool('minify.disableHTML', 'build', 'advanced', false, minifyDoc),
  bool('minify.disableCSS', 'build', 'advanced', false, minifyDoc),
  bool('minify.disableJS', 'build', 'advanced', false, minifyDoc),
  bool('minify.disableJSON', 'build', 'advanced', false, minifyDoc),
  bool('minify.disableSVG', 'build', 'advanced', false, minifyDoc),
  bool('minify.disableXML', 'build', 'advanced', false, minifyDoc),
  bool('minify.tdewolff.html.keepComments', 'build', 'advanced', false, minifyDoc),
  bool('minify.tdewolff.html.keepWhitespace', 'build', 'advanced', false, minifyDoc),
  key('timeout', 'build', 'basic', 'duration', { kind: 'duration' }, '60s', all('timeout')),
  text('publishDir', 'build', 'advanced', 'public', all('publishDir')),
  bool('build.buildStats.enable', 'build', 'advanced', false, buildDoc),
  bool('build.buildStats.disableClasses', 'build', 'advanced', false, buildDoc),
  bool('build.buildStats.disableIDs', 'build', 'advanced', false, buildDoc),
  bool('build.buildStats.disableTags', 'build', 'advanced', false, buildDoc),
  bool('build.cleanDestinationDir.enable', 'build', 'advanced', false, buildDoc, { requiresConfirm: true, since: '0.167.0' }),
  lines('build.cleanDestinationDir.keepFiles', 'build', 'advanced', ['{**/,}.{git,gitignore,gitattributes}'], buildDoc, { since: '0.167.0' }),
  lines('build.cleanDestinationDir.keepDirs', 'build', 'advanced', ['{**/,}.*'], buildDoc, { since: '0.167.0' }),
  choice('build.useResourceCacheWhen', 'build', 'advanced', ['never', 'fallback', 'always'], 'fallback', buildDoc),
  bool('build.noJSConfigInAssets', 'build', 'advanced', false, buildDoc),
  key(
    'build.cacheBusters',
    'build',
    'advanced',
    'objectList',
    {
      kind: 'table',
      columns: [
        { key: 'source', type: 'text' },
        { key: 'target', type: 'text' },
      ],
    },
    [{ source: '(postcss|tailwind)\\.config\\.(js|mjs|cjs)', target: '(css|styles|scss|sass)' }],
    buildDoc,
  ),
  bool('ignoreCache', 'build', 'advanced', false, all('ignoreCache')),
  list('ignoreLogs', 'build', 'advanced', [], all('ignoreLogs')),
  lines('ignoreFiles', 'build', 'advanced', [], all('ignoreFiles')),
  list('renderSegments', 'build', 'advanced', [], all('renderSegments')),
  bool('noChmod', 'build', 'advanced', false, all('noChmod')),
  bool('noTimes', 'build', 'advanced', false, all('noTimes')),
  bool('panicOnWarning', 'build', 'advanced', false, all('panicOnWarning')),
  bool('printI18nWarnings', 'build', 'advanced', false, all('printI18nWarnings')),
  bool('printPathWarnings', 'build', 'advanced', false, all('printPathWarnings')),
  bool('printUnusedTemplates', 'build', 'advanced', false, all('printUnusedTemplates')),
  bool('templateMetrics', 'build', 'advanced', false, all('templateMetrics')),
  bool('templateMetricsHints', 'build', 'advanced', false, all('templateMetricsHints')),
]

// ---- Development server -----------------------------------------------------------------------

const serverDoc = doc('server')

const server: SettingDef[] = [
  key(
    'server.headers',
    'server',
    'advanced',
    'objectList',
    {
      kind: 'table',
      columns: [
        { key: 'for', type: 'text' },
        { key: 'values', type: 'map' },
      ],
    },
    [],
    serverDoc,
  ),
  key(
    'server.redirects',
    'server',
    'advanced',
    'objectList',
    {
      kind: 'table',
      columns: [
        { key: 'from', type: 'text' },
        { key: 'fromRe', type: 'text' },
        { key: 'to', type: 'text' },
        { key: 'status', type: 'number' },
        { key: 'force', type: 'toggle' },
      ],
    },
    [{ from: '/**', to: '/404.html', status: 404, force: false }],
    serverDoc,
  ),
  bool('disableLiveReload', 'server', 'advanced', false, all('disableLiveReload')),
]

// ---- Security ---------------------------------------------------------------------------------

const securityDoc = doc('security')
const RISKY: Extra = { requiresConfirm: true }

const security: SettingDef[] = [
  bool('security.enableInlineShortcodes', 'security', 'advanced', false, securityDoc, RISKY),
  lines('security.allowContent', 'security', 'advanced', ['! ^text/html$', '! ^text/org$'], securityDoc, { ...RISKY, since: '0.162.0' }),
  lines('security.exec.allow', 'security', 'advanced', ['^(dart-)?sass$', '^go$', '^git$', '^node$', '^postcss$'], securityDoc, RISKY),
  lines(
    'security.exec.osEnv',
    'security',
    'advanced',
    ['(?i)^((HTTPS?|NO)_PROXY|PATH(EXT)?|APPDATA|TE?MP|TERM|GO\\w+|(XDG_CONFIG_)?HOME|USERPROFILE|SSH_AUTH_SOCK|DISPLAY|LANG|SYSTEMDRIVE|PROGRAMDATA)$'],
    securityDoc,
    RISKY,
  ),
  lines('security.funcs.getenv', 'security', 'advanced', ['^HUGO_', '^CI$'], securityDoc, RISKY),
  lines(
    'security.http.urls',
    'security',
    'advanced',
    ['(?i)^https?://[a-z0-9]', '! (?i)^https?://\\d+\\.', '! (?i)localhost', '! (?i)^https?://[^/?#]*@'],
    securityDoc,
    RISKY,
  ),
  lines('security.http.methods', 'security', 'advanced', ['(?i)GET|POST'], securityDoc, RISKY),
  lines('security.http.mediaTypes', 'security', 'advanced', undefined, securityDoc, RISKY),
  bool('security.http.proxyFromEnvironment', 'security', 'advanced', false, securityDoc, { ...RISKY, since: '0.166.0' }),
  bool('security.node.permissions.disable', 'security', 'advanced', false, securityDoc, { ...RISKY, since: '0.161.0' }),
  list('security.node.permissions.allowRead', 'security', 'advanced', ['.'], securityDoc, undefined, RISKY),
  list('security.node.permissions.allowWrite', 'security', 'advanced', [], securityDoc, undefined, RISKY),
  list('security.node.permissions.allowAddons', 'security', 'advanced', ['tailwindcss'], securityDoc, undefined, RISKY),
  list('security.node.permissions.allowWorker', 'security', 'advanced', ['tailwindcss'], securityDoc, undefined, RISKY),
  list('security.node.permissions.allowChildProcess', 'security', 'advanced', ['tailwindcss'], securityDoc, undefined, RISKY),
]

// ---- Caches and modules -----------------------------------------------------------------------

const cachesDoc = doc('caches')
const moduleDoc = doc('module')

function cache(name: string, dir: string, maxAge: number | string): SettingDef[] {
  return [
    text(`caches.${name}.dir`, 'caches', 'advanced', dir, cachesDoc, { kind: 'text', monospace: true }),
    key(`caches.${name}.maxAge`, 'caches', 'advanced', 'duration', { kind: 'duration' }, maxAge, cachesDoc),
  ]
}

const caches: SettingDef[] = [
  text('cacheDir', 'caches', 'advanced', undefined, all('cacheDir'), { kind: 'text', monospace: true }),
  ...cache('assets', ':resourceDir/_gen', -1),
  ...cache('images', ':resourceDir/_gen', -1),
  ...cache('getresource', ':cacheDir/:project', -1),
  ...cache('misc', ':cacheDir/:project', -1),
  ...cache('modules', ':cacheDir/modules', -1),
  ...cache('modulegitinfo', ':cacheDir/modules', '24h'),
  ...cache('modulequeries', ':cacheDir/modules', '24h'),
  bool('HTTPCache.respectCacheControlNoStoreInRequest', 'caches', 'advanced', true, doc('http-cache')),
  bool('HTTPCache.respectCacheControlNoStoreInResponse', 'caches', 'advanced', false, doc('http-cache')),
  text('module.proxy', 'caches', 'advanced', 'direct', moduleDoc),
  text('module.noProxy', 'caches', 'advanced', 'none', moduleDoc),
  text('module.private', 'caches', 'advanced', '*.*', moduleDoc),
  text('module.workspace', 'caches', 'advanced', 'off', moduleDoc),
  text('module.replacements', 'caches', 'advanced', '', moduleDoc, { kind: 'text', monospace: true }),
  bool('module.vendorClosest', 'caches', 'advanced', false, moduleDoc),
  text('module.hugoVersion.min', 'caches', 'advanced', '', moduleDoc),
  text('module.hugoVersion.max', 'caches', 'advanced', '', moduleDoc),
  key('module.imports', 'caches', 'advanced', 'any', { kind: 'readonly' }, undefined, moduleDoc),
  key('module.mounts', 'caches', 'advanced', 'any', { kind: 'readonly' }, undefined, moduleDoc),
]

export const SETTINGS: readonly SettingDef[] = [
  ...identity,
  ...urls,
  ...content,
  ...taxonomies,
  ...markdown,
  ...highlight,
  ...toc,
  ...seo,
  ...outputSettings,
  ...pagination,
  ...images,
  ...privacy,
  ...services,
  ...languages,
  ...build,
  ...server,
  ...security,
  ...caches,
]
