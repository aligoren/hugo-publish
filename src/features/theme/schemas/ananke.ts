// Ananke (github.com/gohugo-ananke/ananke, formerly theNewDynamic/gohugo-theme-ananke), Hugo's
// starter theme. Newer settings live under params.ananke.*; older top-level keys still work.
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
const NETWORKS = [
  'bluesky',
  'email',
  'facebook',
  'github',
  'gitlab',
  'hackernews',
  'instagram',
  'keybase',
  'linkedin',
  'mastodon',
  'medium',
  'pinterest',
  'reddit',
  'rss',
  'slack',
  'stackoverflow',
  'telegram',
  'tiktok',
  'tumblr',
  'twitter',
  'whatsapp',
  'x-twitter',
  'xing',
  'youtube',
]

export const ananke: ThemeSchema = {
  'x-theme': {
    id: 'ananke',
    name: 'Ananke',
    repos: ['github.com/gohugo-ananke/ananke', 'github.com/theNewDynamic/gohugo-theme-ananke'],
    themeTomlNames: ['Ananke Theme for Hugo', 'Ananke Gohugo Theme', 'Ananke'],
    folderNames: ['ananke', 'gohugo-theme-ananke'],
    fingerprint: ['layouts/_partials/site-navigation.html', 'layouts/_partials/func/GetFeaturedImage.html'],
    docs: 'https://github.com/gohugo-ananke/ananke',
  },
  'x-groups': [
    { id: 'general', label: L('General', 'Genel') },
    { id: 'appearance', label: L('Appearance (Tachyons classes)', 'Görünüm (Tachyons sınıfları)') },
    { id: 'home', label: L('Home page', 'Ana sayfa') },
    { id: 'social', label: L('Social networks', 'Sosyal ağlar') },
    { id: 'advanced', label: L('Advanced', 'Gelişmiş') },
  ],
  type: 'object',
  properties: {
    description: text('general', 'Site description', 'Site açıklaması', { 'x-widget': 'textarea' }),
    author: text('general', 'Author', 'Yazar'),
    mainSections: { type: 'array', items: { type: 'string' }, 'x-group': 'general', 'x-label': L('Main sections', 'Ana bölümler') },
    favicon: text('general', 'Favicon', 'Favicon', { format: 'image', 'x-widget': 'image' }),
    site_logo: text('general', 'Logo', 'Logo', { format: 'image', 'x-widget': 'image' }),
    featured_image: text('home', 'Home page header image', 'Ana sayfa başlık görseli', { format: 'image', 'x-widget': 'image', 'x-scope': 'both' }),
    date_format: text('general', 'Date format', 'Tarih biçimi', { default: 'January 2, 2006', 'x-widget': 'dateFormat' }),
    reading_speed: { type: 'integer', default: 212, minimum: 1, 'x-group': 'general', 'x-label': L('Reading speed (words/minute)', 'Okuma hızı (kelime/dakika)') },
    read_more_copy: text('general', '"Read more" text', '"Devamını oku" metni', { 'x-scope': 'both' }),
    recent_posts_number: { type: 'integer', default: 3, minimum: 0, 'x-group': 'home', 'x-scope': 'both', 'x-label': L('Number of recent posts', 'Son yazı sayısı') },
    background_color_class: text('appearance', 'Header background class', 'Başlık arka plan sınıfı', { default: 'bg-black' }),
    body_classes: text('appearance', 'Body classes', 'Gövde sınıfları', { default: 'avenir bg-near-white', 'x-scope': 'both' }),
    text_color: text('appearance', 'Text colour class', 'Metin rengi sınıfı', { 'x-scope': 'both' }),
    cover_dimming_class: text('appearance', 'Cover dimming class', 'Kapak karartma sınıfı', { default: 'bg-black-60', 'x-scope': 'both' }),
    featured_image_class: text('appearance', 'Featured image class', 'Öne çıkan görsel sınıfı', { 'x-scope': 'both' }),
    header_section_class: text('appearance', 'Header section class', 'Başlık bölümü sınıfı', { 'x-scope': 'both' }),
    post_content_classes: text('appearance', 'Post content classes', 'Yazı içeriği sınıfları', { 'x-scope': 'both' }),
    ananke: {
      type: 'object',
      'x-group': 'home',
      properties: {
        show_recent_posts: bool('home', 'Recent posts on the home page', 'Ana sayfada son yazılar', true),
        show_categories: bool('general', 'Categories on posts', 'Yazılarda kategoriler', true),
        copy_code: bool('general', 'Copy buttons on code blocks', 'Kod bloklarında kopyala düğmesi', true),
        custom_css: {
          type: 'array',
          items: { type: 'string' },
          'x-group': 'appearance',
          'x-label': L('Extra CSS files (in assets/)', 'Ek CSS dosyaları (assets/ içinde)'),
        },
        home: {
          type: 'object',
          properties: {
            content_alignment: {
              type: 'string',
              enum: ['left', 'center', 'right'],
              default: 'center',
              'x-group': 'home',
              'x-label': L('Home content alignment', 'Ana sayfa içerik hizası'),
            },
          },
        },
        social: {
          type: 'object',
          'x-group': 'social',
          properties: {
            follow: {
              type: 'object',
              properties: {
                networks: {
                  type: 'array',
                  items: { type: 'string', enum: NETWORKS },
                  'x-widget': 'multiselect',
                  'x-group': 'social',
                  'x-label': L('Follow links', 'Takip bağlantıları'),
                },
                new_window_icon: bool('social', '"Opens in a new window" icon', '"Yeni pencerede açılır" ikonu', false),
              },
            },
            share: {
              type: 'object',
              properties: {
                networks: {
                  type: 'array',
                  items: { type: 'string', enum: NETWORKS },
                  'x-widget': 'multiselect',
                  'x-group': 'social',
                  'x-label': L('Share links', 'Paylaşım bağlantıları'),
                },
                icons: bool('social', 'Share icons', 'Paylaşım ikonları', true),
                sharetext: bool('social', 'Share text', 'Paylaşım metni', true),
                disable_share: bool('social', 'Turn sharing off', 'Paylaşımı kapat', false),
              },
            },
            networks: {
              type: 'object',
              'x-flatten': false,
              'x-group': 'social',
              'x-label': L('Network definitions', 'Ağ tanımları'),
              'x-description': L('Built-in definitions; change only to add a network.', 'Hazır tanımlar; yalnızca yeni ağ eklemek için değiştir.'),
            },
          },
        },
        hooks: {
          type: 'object',
          properties: {
            verbosity: {
              type: 'string',
              enum: ['debug', 'info', 'warning', 'error'],
              default: 'error',
              'x-group': 'advanced',
              'x-label': L('Hook log level', 'Kanca günlük seviyesi'),
            },
          },
        },
      },
    },
    commentoEnable: bool('advanced', 'Commento comments', 'Commento yorumları', false),
    commentoPath: text('advanced', 'Commento script address', 'Commento betik adresi', { 'x-widget': 'url' }),
  },
  'x-pageParams': {
    featured_image: { type: 'string', format: 'image', 'x-label': L('Header image', 'Başlık görseli') },
    omit_header_text: { type: 'boolean', 'x-label': L('No text over the header image', 'Başlık görselinde metin olmasın') },
    toc: { type: 'boolean', 'x-label': L('Table of contents', 'İçindekiler') },
    disable_share: { type: 'boolean', 'x-label': L('No share links', 'Paylaşım bağlantısı olmasın') },
    show_reading_time: { type: 'boolean', 'x-label': L('Reading time', 'Okuma süresi') },
    private: { type: 'boolean', 'x-label': L('Private (noindex)', 'Gizli (noindex)') },
  },
}
