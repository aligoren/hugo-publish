// Hugo Book (github.com/alex-shpak/hugo-book). Its exampleSite/hugo.toml documents every
// parameter with "(Optional, default X)" comments; this profile adds labels and groups.
import { L, type SchemaField, type ThemeSchema } from '../schema'

const bool = (group: string, en: string, tr: string, def: boolean, extra: SchemaField = {}): SchemaField => ({
  type: 'boolean',
  default: def,
  'x-group': group,
  'x-label': L(en, tr),
  ...extra,
})

export const hugoBook: ThemeSchema = {
  'x-theme': {
    id: 'hugo-book',
    name: 'Hugo Book',
    repos: ['github.com/alex-shpak/hugo-book', 'codeberg.org/alex-shpak/hugo-book'],
    themeTomlNames: ['Book', 'Hugo Book'],
    folderNames: ['hugo-book', 'book'],
    fingerprint: ['assets/book.scss'],
    docs: 'https://github.com/alex-shpak/hugo-book#configuration',
  },
  'x-groups': [
    { id: 'appearance', label: L('Appearance', 'Görünüm') },
    { id: 'navigation', label: L('Navigation', 'Gezinme') },
    { id: 'links', label: L('Repository links', 'Depo bağlantıları') },
    { id: 'features', label: L('Features', 'Özellikler') },
  ],
  type: 'object',
  properties: {
    BookTheme: {
      type: 'string',
      enum: ['light', 'dark', 'auto'],
      default: 'light',
      'x-group': 'appearance',
      'x-label': L('Colour theme', 'Renk teması'),
      'x-optionLabels': { light: L('Light', 'Açık'), dark: L('Dark', 'Koyu'), auto: L('Follow the system', 'Sisteme uy') },
    },
    BookLogo: { type: 'string', format: 'image', 'x-widget': 'image', 'x-group': 'appearance', 'x-label': L('Logo', 'Logo') },
    BookFavicon: { type: 'string', format: 'image', 'x-widget': 'image', 'x-group': 'appearance', 'x-label': L('Favicon', 'Favicon') },
    BookDateFormat: {
      type: 'string',
      default: 'January 2, 2006',
      'x-widget': 'dateFormat',
      'x-group': 'appearance',
      'x-label': L('Date format', 'Tarih biçimi'),
    },
    BookToC: bool('navigation', 'Table of contents on the right', 'Sağda içindekiler', true, { 'x-scope': 'both' }),
    BookBreadcrumbs: bool('navigation', 'Breadcrumbs', 'Sayfa yolu', false, { 'x-scope': 'both' }),
    BookPageLinks: bool('navigation', 'Incoming and outgoing links', 'Gelen ve giden bağlantılar', false, { 'x-scope': 'both' }),
    BookSection: {
      type: 'string',
      default: 'docs',
      'x-group': 'navigation',
      'x-label': L('Section shown as the menu', 'Menü olarak gösterilen bölüm'),
      'x-description': L('"*" or "/" renders all sections.', '"*" ya da "/" tüm bölümleri gösterir.'),
    },
    BookTranslatedOnly: bool('navigation', 'Language menu only for translated pages', 'Dil menüsü yalnızca çevrilmiş sayfalarda', false),
    BookRepo: { type: 'string', format: 'uri', 'x-widget': 'url', 'x-group': 'links', 'x-label': L('Repository address', 'Depo adresi') },
    BookLastChangeLink: {
      type: 'string',
      'x-group': 'links',
      'x-label': L('Last change link template', 'Son değişiklik bağlantısı şablonu'),
      'x-description': L('Needs enableGitInfo. Executed as a template.', 'enableGitInfo gerekir. Şablon olarak çalıştırılır.'),
    },
    BookEditLink: {
      type: 'string',
      'x-group': 'links',
      'x-label': L('Edit link template', 'Düzenleme bağlantısı şablonu'),
      'x-description': L('Executed as a template with .Site, .Page and .Path.', '.Site, .Page ve .Path ile şablon olarak çalıştırılır.'),
    },
    BookSearch: bool('features', 'Search', 'Arama', true),
    BookComments: bool('features', 'Comments', 'Yorumlar', false, { 'x-scope': 'both' }),
    BookPortableLinks: {
      enum: [false, 'warning', 'error'],
      default: false,
      'x-group': 'features',
      'x-label': L('Portable links (experimental)', 'Taşınabilir bağlantılar (deneysel)'),
    },
    BookServiceWorker: {
      enum: [false, true, 'precache'],
      default: false,
      'x-group': 'features',
      'x-label': L('Offline service worker (experimental)', 'Çevrimdışı service worker (deneysel)'),
    },
  },
  'x-pageParams': {
    bookToC: { type: 'boolean', 'x-label': L('Table of contents', 'İçindekiler') },
    bookFlatSection: { type: 'boolean', 'x-label': L('Flat section in the menu', 'Menüde düz bölüm') },
    bookCollapseSection: { type: 'boolean', 'x-label': L('Collapsed section', 'Kapalı bölüm') },
    bookHidden: { type: 'boolean', 'x-label': L('Hidden from the menu', 'Menüde gizli') },
    bookComments: { type: 'boolean', 'x-label': L('Comments', 'Yorumlar') },
    bookSearchExclude: { type: 'boolean', 'x-label': L('Leave out of search', 'Aramada gösterme') },
    bookHref: { type: 'string', 'x-label': L('Menu link override', 'Menü bağlantısı') },
    bookIcon: { type: 'string', 'x-label': L('Menu icon', 'Menü ikonu') },
  },
}
