// Stack (github.com/CaiJimmy/hugo-theme-stack). Defaults and comments come from the theme's own
// config/_default/params.toml at run time. Docs: https://stack.jimmycai.com/config/
import { L, type SchemaField, type ThemeSchema } from '../schema'

const bool = (group: string, en: string, tr: string, def: boolean, extra: SchemaField = {}): SchemaField => ({
  type: 'boolean',
  default: def,
  'x-group': group,
  'x-label': L(en, tr),
  ...extra,
})
const text = (group: string, en: string, tr: string, extra: SchemaField = {}): SchemaField => ({
  type: 'string',
  'x-group': group,
  'x-label': L(en, tr),
  ...extra,
})

const WIDGETS = ['search', 'archives', 'categories', 'tag-cloud', 'toc']
const widgetList = (en: string, tr: string): SchemaField => ({
  type: 'array',
  'x-widget': 'objectList',
  'x-group': 'widgets',
  'x-label': L(en, tr),
  items: {
    type: 'object',
    required: ['type'],
    properties: {
      type: { type: 'string', enum: WIDGETS, 'x-allowCustom': true, 'x-label': L('Widget', 'Bileşen') },
    },
  },
})

export const stack: ThemeSchema = {
  'x-theme': {
    id: 'stack',
    name: 'Stack',
    repos: ['github.com/CaiJimmy/hugo-theme-stack'],
    themeTomlNames: ['Stack'],
    folderNames: ['hugo-theme-stack', 'stack'],
    fingerprint: ['assets/scss/custom.scss', 'config/_default/params.toml'],
    docs: 'https://stack.jimmycai.com/config/',
    cssHook: { kind: 'file', path: 'assets/scss/custom.scss' },
    darkSelector: '[data-scheme="dark"]',
  },
  'x-groups': [
    { id: 'general', label: L('General', 'Genel') },
    { id: 'appearance', label: L('Appearance', 'Görünüm') },
    { id: 'sidebar', label: L('Sidebar', 'Kenar çubuğu') },
    { id: 'article', label: L('Articles', 'Yazılar') },
    { id: 'widgets', label: L('Widgets', 'Bileşenler') },
    { id: 'footer', label: L('Footer', 'Alt bilgi') },
    { id: 'comments', label: L('Comments', 'Yorumlar') },
    { id: 'seo', label: L('Social sharing metadata', 'Sosyal paylaşım bilgileri') },
    { id: 'images', label: L('Images', 'Görseller') },
  ],
  type: 'object',
  properties: {
    mainSections: { type: 'array', items: { type: 'string' }, 'x-group': 'general', 'x-label': L('Main sections', 'Ana bölümler') },
    rssFullContent: bool('general', 'Full text in RSS', 'RSS’te tam metin', true),
    SortBy: {
      type: 'string',
      enum: ['default', 'lastmod'],
      default: 'default',
      'x-group': 'general',
      'x-label': L('Post order', 'Yazı sırası'),
      'x-optionLabels': { default: L("Hugo's default order", 'Hugo’nun varsayılan sırası'), lastmod: L('Last modified first', 'Son değiştirilen önce') },
    },
    favicon: text('general', 'Favicon', 'Favicon', { format: 'image', 'x-widget': 'image' }),
    dateFormat: {
      type: 'object',
      'x-group': 'general',
      properties: {
        published: text('general', 'Date format (published)', 'Tarih biçimi (yayın)', { default: ':date_full', 'x-widget': 'dateFormat' }),
        lastUpdated: text('general', 'Date format (last updated)', 'Tarih biçimi (güncelleme)', { default: ':date_full', 'x-widget': 'dateFormat' }),
      },
    },
    colorScheme: {
      type: 'object',
      'x-group': 'appearance',
      properties: {
        toggle: bool('appearance', 'Light/dark switch', 'Açık/koyu düğmesi', true),
        default: {
          type: 'string',
          enum: ['auto', 'light', 'dark'],
          default: 'auto',
          'x-group': 'appearance',
          'x-label': L('Default colour scheme', 'Varsayılan renk düzeni'),
        },
      },
    },
    sidebar: {
      type: 'object',
      'x-group': 'sidebar',
      properties: {
        compact: bool('sidebar', 'Compact sidebar', 'Sıkışık kenar çubuğu', false),
        emoji: text('sidebar', 'Emoji next to the avatar', 'Avatarın yanındaki emoji'),
        subtitle: text('sidebar', 'Subtitle', 'Alt başlık'),
        avatar: text('sidebar', 'Avatar', 'Avatar', { format: 'image', 'x-widget': 'image' }),
      },
    },
    article: {
      type: 'object',
      'x-group': 'article',
      properties: {
        headingAnchor: bool('article', 'Heading anchors', 'Başlık bağlantıları', false),
        math: bool('article', 'Math (KaTeX)', 'Matematik (KaTeX)', false, { 'x-scope': 'both' }),
        toc: bool('article', 'Table of contents', 'İçindekiler', true, { 'x-scope': 'both' }),
        readingTime: bool('article', 'Reading time', 'Okuma süresi', true, { 'x-scope': 'both' }),
        list: {
          type: 'object',
          properties: { showTags: bool('article', 'Tags in lists', 'Listelerde etiketler', false) },
        },
        license: {
          type: 'object',
          properties: {
            enabled: bool('article', 'License note', 'Lisans notu', false),
            default: text('article', 'License text', 'Lisans metni', { default: 'Licensed under CC BY-NC-SA 4.0', 'x-widget': 'markdown' }),
          },
        },
      },
    },
    widgets: {
      type: 'object',
      'x-group': 'widgets',
      properties: {
        homepage: widgetList('Home page widgets', 'Ana sayfa bileşenleri'),
        page: widgetList('Page widgets', 'Sayfa bileşenleri'),
      },
    },
    footer: {
      type: 'object',
      'x-group': 'footer',
      properties: {
        since: { type: 'integer', 'x-group': 'footer', 'x-label': L('Copyright start year', 'Telif başlangıç yılı') },
        customText: text('footer', 'Custom footer text', 'Özel alt bilgi metni', { 'x-widget': 'markdown' }),
      },
    },
    opengraph: {
      type: 'object',
      'x-group': 'seo',
      properties: {
        twitter: {
          type: 'object',
          properties: {
            site: text('seo', 'X/Twitter account', 'X/Twitter hesabı'),
            card: {
              type: 'string',
              enum: ['summary', 'summary_large_image'],
              default: 'summary_large_image',
              'x-group': 'seo',
              'x-label': L('Card type', 'Kart türü'),
            },
          },
        },
      },
    },
    imageProcessing: {
      type: 'object',
      'x-group': 'images',
      properties: {
        autoOrient: bool('images', 'Auto-orient images', 'Görselleri otomatik döndür', false),
        content: { type: 'object', properties: { enabled: bool('images', 'Process content images', 'İçerik görsellerini işle', true) } },
        thumbnail: { type: 'object', properties: { enabled: bool('images', 'Process thumbnails', 'Küçük resimleri işle', true) } },
      },
    },
    comments: {
      type: 'object',
      'x-group': 'comments',
      properties: {
        enabled: bool('comments', 'Comments', 'Yorumlar', true, { 'x-scope': 'both' }),
        provider: {
          type: 'string',
          enum: ['disqus', 'disqusjs', 'utterances', 'beaudar', 'remark42', 'vssue', 'waline', 'twikoo', 'cactus', 'giscus', 'gitalk', 'cusdis', 'artalk', 'comentario'],
          default: 'disqus',
          'x-group': 'comments',
          'x-label': L('Comment provider', 'Yorum sağlayıcısı'),
        },
        giscus: {
          type: 'object',
          properties: {
            repo: text('comments', 'giscus repository', 'giscus deposu'),
            repoID: text('comments', 'giscus repository id', 'giscus depo kimliği'),
            category: text('comments', 'giscus category', 'giscus kategorisi'),
            categoryID: text('comments', 'giscus category id', 'giscus kategori kimliği'),
            mapping: text('comments', 'giscus mapping', 'giscus eşleme', { default: 'title' }),
            lang: text('comments', 'giscus language', 'giscus dili', { default: 'en' }),
          },
        },
        utterances: {
          type: 'object',
          properties: {
            repo: text('comments', 'utterances repository', 'utterances deposu'),
            issueTerm: text('comments', 'utterances issue term', 'utterances konu terimi', { default: 'pathname' }),
          },
        },
      },
    },
  },
  'x-pageParams': {
    image: { type: 'string', format: 'image', 'x-label': L('Cover image', 'Kapak görseli') },
    toc: { type: 'boolean', 'x-label': L('Table of contents', 'İçindekiler') },
    math: { type: 'boolean', 'x-label': L('Math', 'Matematik') },
    readingTime: { type: 'boolean', 'x-label': L('Reading time', 'Okuma süresi') },
    comments: { type: 'boolean', 'x-label': L('Comments', 'Yorumlar') },
    license: { type: 'string', 'x-label': L('License text', 'Lisans metni') },
    links: { type: 'array', 'x-label': L('Links', 'Bağlantılar') },
  },
  'x-features': {
    search: {
      label: L('Search page', 'Arama sayfası'),
      description: L('Creates the search page with the HTML and JSON outputs.', 'HTML ve JSON çıktılı arama sayfasını oluşturur.'),
      steps: [
        {
          op: 'ensureContentFile',
          path: 'content/page/search/index.md',
          title: L('Search', 'Ara'),
          frontMatter: { slug: 'search', layout: 'search', outputs: ['html', 'json'] },
          layout: 'search',
        },
        { op: 'menuItem', menu: 'main', name: L('Search', 'Ara'), url: '/search/', weight: -60 },
      ],
    },
    archives: {
      label: L('Archive page', 'Arşiv sayfası'),
      description: L('Creates the archive page.', 'Arşiv sayfasını oluşturur.'),
      steps: [
        {
          op: 'ensureContentFile',
          path: 'content/page/archives/index.md',
          title: L('Archives', 'Arşiv'),
          frontMatter: { slug: 'archives', layout: 'archives' },
          layout: 'archives',
        },
        { op: 'menuItem', menu: 'main', name: L('Archives', 'Arşiv'), url: '/archives/', weight: -70 },
      ],
    },
  },
}
