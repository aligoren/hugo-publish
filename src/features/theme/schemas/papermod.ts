// PaperMod (github.com/adityatelange/hugo-PaperMod, master d3768854, 2026-08).
// Built from the theme's templates, CSS, JS and i18n files.
import { L, type SchemaField, type ThemeSchema } from '../schema'

const bool = (group: string, en: string, tr: string, extra: SchemaField = {}): SchemaField => ({
  type: 'boolean',
  default: false,
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
const verification = (en: string): SchemaField => ({
  type: 'object',
  properties: {
    SiteVerificationTag: text('analytics', `${en} verification code`, `${en} doğrulama kodu`, {
      'x-description': L(`Content of the ${en} site-verification meta tag.`, `${en} site doğrulama meta etiketinin değeri.`),
    }),
  },
})

const BOOLEAN_ONLY = L(
  'The theme compares this with a real boolean: write true, never the text "true".',
  'Tema bunu gerçek bir mantıksal değerle karşılaştırır: tırnaksız true yazılmalı, "true" metni çalışmaz.',
)

export const papermod: ThemeSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  'x-theme': {
    id: 'papermod',
    name: 'PaperMod',
    repos: ['github.com/adityatelange/hugo-PaperMod'],
    themeTomlNames: ['PaperMod'],
    folderNames: ['PaperMod', 'hugo-PaperMod'],
    fingerprint: ['layouts/_partials/index_profile.html', 'layouts/_partials/home_info.html', 'assets/css/core/theme-vars.css'],
    docs: 'https://github.com/adityatelange/hugo-PaperMod/wiki',
    cssHook: { kind: 'dir', path: 'assets/css/extended/', fileName: 'hugo-publisher.css' },
    cssVarsFiles: ['assets/css/core/theme-vars.css', 'assets/css/core/zmedia.css'],
    darkSelector: ':root[data-theme="dark"]',
  },
  'x-groups': [
    { id: 'general', label: L('General and SEO', 'Genel ve SEO') },
    { id: 'appearance', label: L('Appearance', 'Görünüm') },
    { id: 'home', label: L('Home page', 'Ana sayfa') },
    { id: 'social', label: L('Social icons', 'Sosyal ikonlar') },
    { id: 'meta', label: L('Post details', 'Yazı bilgileri') },
    { id: 'list', label: L('Lists and navigation', 'Listeler ve gezinme') },
    { id: 'toc', label: L('Table of contents', 'İçindekiler') },
    { id: 'cover', label: L('Cover images', 'Kapak görselleri') },
    { id: 'share', label: L('Share buttons', 'Paylaşım butonları') },
    { id: 'code', label: L('Code blocks', 'Kod blokları') },
    { id: 'comments', label: L('Comments', 'Yorumlar') },
    { id: 'editPost', label: L('Edit link', 'Düzenleme bağlantısı') },
    { id: 'header', label: L('Header and logo', 'Üst bölüm ve logo') },
    { id: 'footer', label: L('Footer', 'Alt bilgi') },
    { id: 'search', label: L('Search', 'Arama') },
    { id: 'archive', label: L('Archive', 'Arşiv') },
    { id: 'assets', label: L('Favicons and assets', 'Favicon ve dosyalar') },
    { id: 'analytics', label: L('Search engine verification', 'Arama motoru doğrulama') },
    { id: 'seo', label: L('Social sharing metadata', 'Sosyal paylaşım bilgileri') },
    { id: 'rss', label: L('RSS feed', 'RSS beslemesi') },
    { id: 'language', label: L('Languages', 'Diller') },
  ],
  type: 'object',
  properties: {
    // --- General / SEO
    env: {
      type: 'string',
      enum: ['production'],
      'x-group': 'general',
      'x-label': L('Always behave like production', 'Her zaman yayın ortamı gibi davran'),
      'x-description': L(
        'Set to "production" so robots meta, Open Graph, schema.org and image resizing work in every build, including previews.',
        '"production" yapılırsa robots etiketi, Open Graph, schema.org ve görsel boyutlandırma her derlemede (önizleme dahil) çalışır.',
      ),
      'x-gotcha': L(
        'Without it, `hugo server` previews show noindex and leave out social metadata, unlike the live site.',
        'Bu ayar yoksa `hugo server` önizlemesi noindex gösterir ve sosyal meta bilgilerini atlar; canlı site farklı görünür.',
      ),
    },
    title: text('general', 'Fallback site title for social cards', 'Sosyal kartlar için yedek site başlığı', {
      'x-description': L('Used only when the site title is empty.', 'Yalnızca site başlığı boşsa kullanılır.'),
    }),
    description: text('general', 'Site description', 'Site açıklaması', {
      'x-widget': 'textarea',
      'x-description': L(
        'Meta description of the home and list pages, and the fallback for social cards.',
        'Ana sayfa ve liste sayfalarının meta açıklaması; sosyal kartlarda yedek olarak da kullanılır.',
      ),
    }),
    keywords: {
      type: 'array',
      items: { type: 'string' },
      'x-group': 'general',
      'x-label': L('Keywords (home page)', 'Anahtar kelimeler (ana sayfa)'),
    },
    author: {
      type: ['string', 'array'],
      items: { type: 'string' },
      'x-stringOrList': true,
      'x-group': 'general',
      'x-scope': 'both',
      'x-label': L('Author(s)', 'Yazar(lar)'),
      'x-description': L('Default author, or several authors. A page can set its own.', 'Varsayılan yazar ya da yazarlar. Sayfa kendi yazarını belirleyebilir.'),
      'x-gotcha': L(
        'Write a name or a list of names. The {name, email} form breaks the author meta tag.',
        'Bir ad ya da ad listesi yaz. {name, email} biçimi yazar meta etiketini bozar.',
      ),
    },
    images: {
      type: 'array',
      items: { type: 'string', format: 'image' },
      'x-group': 'general',
      'x-label': L('Default share image', 'Varsayılan paylaşım görseli'),
      'x-description': L(
        'The first image is used for social cards when a page has none, and as the RSS channel image.',
        'Sayfanın görseli yoksa sosyal kartlarda ilk görsel kullanılır; RSS kanal görseli de budur.',
      ),
    },
    mainSections: {
      type: 'array',
      items: { type: 'string' },
      'x-group': 'general',
      'x-label': L('Main sections', 'Ana bölümler'),
      'x-description': L(
        'Sections listed on the home page and in the archive, and used for previous/next links.',
        'Ana sayfada ve arşivde listelenen, önceki/sonraki bağlantılarında kullanılan bölümler.',
      ),
    },
    DateFormat: {
      type: 'string',
      default: ':date_long',
      'x-widget': 'dateFormat',
      'x-group': 'meta',
      'x-label': L('Date format', 'Tarih biçimi'),
      'x-description': L('A Go layout such as "2 January 2006" or :date_long, :date_medium.', 'Go biçimi ("2 January 2006") ya da :date_long, :date_medium.'),
    },

    // --- Appearance
    defaultTheme: {
      type: 'string',
      enum: ['auto', 'light', 'dark'],
      default: 'auto',
      'x-group': 'appearance',
      'x-label': L('Colour scheme', 'Renk düzeni'),
      'x-optionLabels': {
        auto: L("Follow the visitor's system", 'Ziyaretçinin sistemine uy'),
        light: L('Light', 'Açık'),
        dark: L('Dark', 'Koyu'),
      },
    },
    disableThemeToggle: bool('appearance', 'Hide the light/dark switch', 'Açık/koyu düğmesini gizle', {
      'x-description': L('With a fixed colour scheme, the scheme is then forced.', 'Renk düzeni sabitse o düzen zorunlu olur.'),
    }),
    disableLangToggle: bool('appearance', 'Hide the language switch', 'Dil seçiciyi gizle'),
    displayFullLangName: bool('appearance', 'Show full language names', 'Dil adlarını tam göster'),
    disableScrollToTop: bool('appearance', 'Hide the "back to top" button', '"Başa dön" düğmesini gizle'),

    // --- Home
    profileMode: {
      type: 'object',
      'x-group': 'home',
      'x-conflictsWith': ['homeInfoParams'],
      properties: {
        enabled: bool('home', 'Profile mode (no post list on the home page)', 'Profil modu (ana sayfada yazı listesi yok)'),
        title: text('home', 'Profile title', 'Profil başlığı', { 'x-widget': 'markdown' }),
        subtitle: text('home', 'Profile subtitle', 'Profil alt başlığı', { 'x-widget': 'markdown' }),
        imageUrl: text('home', 'Profile image', 'Profil görseli', { format: 'image', 'x-widget': 'image', 'x-productionOnly': true }),
        imageWidth: { type: 'integer', default: 150, minimum: 1, 'x-group': 'home', 'x-label': L('Image width', 'Görsel genişliği') },
        imageHeight: { type: 'integer', default: 150, minimum: 1, 'x-group': 'home', 'x-label': L('Image height', 'Görsel yüksekliği') },
        imageTitle: text('home', 'Image alt text', 'Görselin alternatif metni'),
        buttons: {
          type: 'array',
          'x-group': 'home',
          'x-label': L('Profile buttons', 'Profil düğmeleri'),
          'x-widget': 'objectList',
          items: {
            type: 'object',
            required: ['name', 'url'],
            properties: {
              name: text('home', 'Label', 'Etiket'),
              url: text('home', 'Address', 'Adres', { format: 'uri-reference', 'x-widget': 'url' }),
            },
          },
        },
      },
    },
    homeInfoParams: {
      type: 'object',
      'x-group': 'home',
      properties: {
        Title: text('home', 'Welcome card title', 'Karşılama kartı başlığı', {
          'x-widget': 'markdown',
          'x-description': L(
            'Setting the card shows it above the first page of posts and turns off the large first-post card.',
            'Kart ayarlanınca ilk sayfadaki yazıların üstünde görünür ve büyük ilk yazı kartı kapanır.',
          ),
        }),
        Content: text('home', 'Welcome card text', 'Karşılama kartı metni', { 'x-widget': 'markdown' }),
        AlignSocialIconsTo: {
          type: 'string',
          enum: ['left', 'center', 'right'],
          'x-group': 'home',
          'x-label': L('Social icon alignment in the card', 'Karttaki sosyal ikonların hizası'),
        },
      },
    },
    disableSpecial1stPost: bool('home', 'No large card for the newest post', 'En yeni yazı için büyük kart kullanma'),

    // --- Social icons
    socialIcons: {
      type: 'array',
      'x-group': 'social',
      'x-widget': 'objectList',
      'x-label': L('Social icons', 'Sosyal ikonlar'),
      'x-description': L(
        'Shown in profile mode and in the welcome card only. The links also feed schema.org sameAs.',
        'Yalnızca profil modunda ve karşılama kartında görünür. Bağlantılar schema.org sameAs bilgisine de girer.',
      ),
      items: {
        type: 'object',
        required: ['name', 'url'],
        properties: {
          name: {
            type: 'string',
            'x-label': L('Icon', 'İkon'),
            'x-widget': 'iconSelect',
            'x-optionsFrom': 'socialIcons[].name',
            'x-allowCustom': true,
          },
          url: text('social', 'Address', 'Adres', { format: 'uri', 'x-widget': 'url' }),
          title: text('social', 'Tooltip', 'İpucu metni'),
        },
      },
    },

    // --- Post meta
    ShowReadingTime: bool('meta', 'Show reading time', 'Okuma süresini göster', { 'x-scope': 'both' }),
    ShowWordCount: bool('meta', 'Show word count', 'Kelime sayısını göster', { 'x-scope': 'both' }),
    hideAuthor: bool('meta', 'Hide the author in post details', 'Yazı bilgilerinde yazarı gizle', { 'x-scope': 'both' }),
    hideMeta: bool('meta', 'Hide post details (date, reading time…)', 'Yazı bilgilerini gizle (tarih, okuma süresi…)', { 'x-scope': 'both' }),
    hideSummary: bool('list', 'Hide summaries in lists', 'Listelerde özetleri gizle', { 'x-scope': 'both', 'x-gotcha': BOOLEAN_ONLY }),
    CanonicalLinkText: text('meta', 'Text before the original address', 'Asıl adresin önündeki metin', {
      default: 'Originally published at',
      'x-scope': 'both',
      'x-precedence': 'site-over-page',
      'x-gotcha': L('The site value wins over a page value.', 'Site değeri sayfadaki değerin önüne geçer.'),
    }),

    // --- Lists
    ShowBreadCrumbs: bool('list', 'Show breadcrumbs', 'Sayfa yolunu (breadcrumb) göster', { 'x-scope': 'both' }),
    ShowPostNavLinks: bool('list', 'Show previous/next post links', 'Önceki/sonraki yazı bağlantılarını göster', { 'x-scope': 'both' }),
    ShowPageNums: bool('list', 'Show page numbers in pagination', 'Sayfalamada sayfa numaralarını göster', { 'x-scope': 'both' }),
    ShowRssButtonInSectionTermList: bool('list', 'RSS button on section and tag pages', 'Bölüm ve etiket sayfalarında RSS düğmesi', { 'x-scope': 'both' }),
    disableAnchoredHeadings: bool('list', 'No # links on headings', 'Başlıklarda # bağlantısı olmasın', { 'x-scope': 'both' }),
    hideFooter: bool('footer', 'Hide the footer text', 'Alt bilgi metnini gizle', { 'x-scope': 'both' }),

    // --- ToC
    ShowToc: bool('toc', 'Show table of contents', 'İçindekileri göster', { 'x-scope': 'both' }),
    TocOpen: bool('toc', 'Open the table of contents by default', 'İçindekiler açık başlasın', { 'x-scope': 'both' }),
    UseHugoToc: bool('toc', "Use Hugo's table of contents", 'Hugo’nun içindekiler tablosunu kullan', {
      'x-scope': 'both',
      'x-description': L(
        'Respects markup.tableOfContents start and end levels.',
        'markup.tableOfContents başlangıç ve bitiş seviyelerine uyar.',
      ),
    }),

    // --- Cover
    cover: {
      type: 'object',
      'x-group': 'cover',
      properties: {
        linkFullImages: bool('cover', 'Link covers to the full-size image', 'Kapak tam boy görsele bağlansın'),
        responsiveImages: bool('cover', 'Responsive cover sizes', 'Duyarlı kapak boyutları', { default: true, 'x-productionOnly': true }),
        hidden: bool('cover', 'Hide covers everywhere', 'Kapakları her yerde gizle', { 'x-scope': 'both' }),
        hiddenInList: bool('cover', 'Hide covers in lists', 'Listelerde kapakları gizle', { 'x-scope': 'both' }),
        hiddenInSingle: bool('cover', 'Hide covers on post pages', 'Yazı sayfalarında kapakları gizle', { 'x-scope': 'both' }),
      },
    },

    // --- Share
    ShowShareButtons: bool('share', 'Show share buttons under posts', 'Yazıların altında paylaşım butonlarını göster', {
      'x-description': L('Plain links; nothing is loaded from other sites.', 'Düz bağlantılardır; başka sitelerden bir şey yüklenmez.'),
    }),
    ShareButtons: {
      type: 'array',
      items: { type: 'string', enum: ['x', 'twitter', 'linkedin', 'reddit', 'facebook', 'whatsapp', 'telegram', 'ycombinator'] },
      'x-widget': 'multiselect',
      'x-group': 'share',
      'x-scope': 'both',
      'x-label': L('Which share buttons', 'Hangi paylaşım butonları'),
      'x-description': L('Leave empty for all buttons.', 'Hepsi için boş bırak.'),
    },

    // --- Code
    ShowCodeCopyButtons: bool('code', 'Copy buttons on code blocks', 'Kod bloklarında kopyala düğmesi', {
      'x-scope': 'both',
      'x-requiresConfig': {
        path: 'markup.highlight.noClasses',
        value: false,
        note: L(
          "PaperMod's code colours need markup.highlight.noClasses = false.",
          'PaperMod’un kod renkleri için markup.highlight.noClasses = false gerekir.',
        ),
      },
    }),

    // --- Comments
    comments: bool('comments', 'Show comments', 'Yorumları göster', {
      'x-scope': 'both',
      'x-gotcha': L(
        "The theme's comments.html is empty: create layouts/_partials/comments.html with your provider's code.",
        'Temanın comments.html dosyası boştur: sağlayıcının koduyla layouts/_partials/comments.html oluşturmalısın.',
      ),
    }),

    // --- Edit link
    editPost: {
      type: 'object',
      'x-group': 'editPost',
      'x-scope': 'both',
      properties: {
        URL: text('editPost', 'Edit address', 'Düzenleme adresi', { format: 'uri', 'x-widget': 'url' }),
        Text: text('editPost', 'Link text', 'Bağlantı metni', { 'x-description': L('Default: the "edit_post" text.', 'Varsayılan: "edit_post" metni.') }),
        appendFilePath: bool('editPost', 'Append the file path', 'Dosya yolunu ekle'),
        disabled: bool('editPost', 'Turn the link off', 'Bağlantıyı kapat'),
      },
    },

    // --- Header
    label: {
      type: 'object',
      'x-group': 'header',
      properties: {
        text: text('header', 'Logo text', 'Logo metni', { 'x-description': L('Default: the site title.', 'Varsayılan: site başlığı.') }),
        icon: text('header', 'Logo image', 'Logo görseli', { format: 'image', 'x-widget': 'image' }),
        iconHeight: { type: 'integer', default: 30, minimum: 1, 'x-group': 'header', 'x-label': L('Logo height', 'Logo yüksekliği') },
        iconSVG: text('header', 'Inline SVG logo', 'Satır içi SVG logo', {
          'x-widget': 'html',
          'x-description': L('Used when no logo image is set; must start with <svg.', 'Logo görseli yoksa kullanılır; <svg ile başlamalı.'),
        }),
      },
    },

    // --- Footer
    footer: {
      type: 'object',
      'x-group': 'footer',
      properties: {
        text: text('footer', 'Extra footer text', 'Ek alt bilgi metni', { 'x-widget': 'markdown' }),
        hideCopyright: bool('footer', 'Hide the copyright', 'Telif satırını gizle'),
      },
    },

    // --- Search
    fuseOpts: {
      type: 'object',
      'x-group': 'search',
      properties: {
        isCaseSensitive: bool('search', 'Case-sensitive search', 'Büyük/küçük harfe duyarlı arama'),
        includeScore: bool('search', 'Include scores', 'Puanları ekle'),
        includeMatches: bool('search', 'Include matches', 'Eşleşmeleri ekle'),
        minMatchCharLength: { type: 'integer', default: 1, minimum: 1, 'x-group': 'search', 'x-label': L('Minimum match length', 'En kısa eşleşme') },
        shouldSort: bool('search', 'Sort by score', 'Puana göre sırala', { default: true }),
        findAllMatches: bool('search', 'Find all matches', 'Tüm eşleşmeleri bul'),
        keys: {
          type: 'array',
          items: { type: 'string', enum: ['title', 'permalink', 'summary', 'content'] },
          'x-widget': 'multiselect',
          'x-group': 'search',
          'x-label': L('Fields to search', 'Aranacak alanlar'),
          'x-description': L('Default: all four.', 'Varsayılan: dördü de.'),
        },
        location: { type: 'integer', default: 0, 'x-group': 'search', 'x-label': L('Expected match position', 'Beklenen eşleşme konumu') },
        threshold: { type: 'number', default: 0.4, minimum: 0, maximum: 1, 'x-group': 'search', 'x-label': L('Fuzziness (0–1)', 'Bulanıklık (0–1)') },
        distance: { type: 'integer', default: 100, 'x-group': 'search', 'x-label': L('Match distance', 'Eşleşme mesafesi') },
        ignoreLocation: bool('search', 'Ignore position', 'Konumu yok say', { default: true }),
        limit: { type: 'integer', minimum: 1, 'x-group': 'search', 'x-label': L('Maximum results', 'En fazla sonuç') },
      },
    },

    // --- Archive
    ShowAllPagesInArchive: bool('archive', 'All pages in the archive', 'Arşivde tüm sayfalar', {
      'x-description': L('Instead of only the main sections.', 'Yalnızca ana bölümler yerine.'),
    }),

    // --- Assets
    assets: {
      type: 'object',
      'x-group': 'assets',
      properties: {
        favicon: text('assets', 'Favicon', 'Favicon', { default: 'favicon.ico', format: 'image', 'x-widget': 'image' }),
        favicon16x16: text('assets', 'Favicon 16×16', 'Favicon 16×16', { default: 'favicon-16x16.png', format: 'image', 'x-widget': 'image' }),
        favicon32x32: text('assets', 'Favicon 32×32', 'Favicon 32×32', { default: 'favicon-32x32.png', format: 'image', 'x-widget': 'image' }),
        apple_touch_icon: text('assets', 'Apple touch icon', 'Apple dokunmatik ikonu', {
          default: 'apple-touch-icon.png',
          format: 'image',
          'x-widget': 'image',
        }),
        safari_pinned_tab: text('assets', 'Safari pinned tab icon', 'Safari sabit sekme ikonu', {
          default: 'safari-pinned-tab.svg',
          format: 'image',
          'x-widget': 'image',
        }),
        theme_color: text('assets', 'Browser theme colour', 'Tarayıcı tema rengi', { default: '#2e2e33', format: 'color', 'x-widget': 'color' }),
        msapplication_TileColor: text('assets', 'Windows tile colour', 'Windows kutucuk rengi', {
          default: '#2e2e33',
          format: 'color',
          'x-widget': 'color',
        }),
        disableFingerprinting: bool('assets', 'Turn off fingerprinting', 'Parmak izini kapat', {
          'x-description': L(
            'Fixes "Failed to find a valid digest" behind some proxies and CDNs.',
            'Bazı proxy ve CDN arkasında görülen "Failed to find a valid digest" hatasını giderir.',
          ),
        }),
        disableHLJS: bool('assets', 'Turn off highlight.js (obsolete)', 'highlight.js’i kapat (eski)', {
          'x-deprecated': L('PaperMod no longer reads this; highlight.js was removed.', 'PaperMod bunu artık okumuyor; highlight.js kaldırıldı.'),
        }),
        disableScrollBarStyle: bool('assets', 'Native scroll bars (obsolete)', 'Yerel kaydırma çubukları (eski)', {
          'x-deprecated': L('Removed after PaperMod v8.0.', 'PaperMod v8.0’dan sonra kaldırıldı.'),
        }),
      },
    },

    // --- Verification
    analytics: {
      type: 'object',
      'x-group': 'analytics',
      properties: {
        google: verification('Google'),
        bing: verification('Bing'),
        yandex: verification('Yandex'),
        naver: verification('Naver'),
      },
    },

    // --- Social metadata
    schema: {
      type: 'object',
      'x-group': 'seo',
      properties: {
        publisherType: {
          type: 'string',
          enum: ['Organization', 'Person'],
          default: 'Organization',
          'x-group': 'seo',
          'x-productionOnly': true,
          'x-label': L('Publisher type (schema.org)', 'Yayıncı türü (schema.org)'),
          'x-optionLabels': { Organization: L('Organization', 'Kurum'), Person: L('Person', 'Kişi') },
        },
        sameAs: {
          type: 'array',
          items: { type: 'string', format: 'uri' },
          'x-group': 'seo',
          'x-productionOnly': true,
          'x-label': L('Profile links (sameAs)', 'Profil bağlantıları (sameAs)'),
          'x-description': L('Default: the social icon links.', 'Varsayılan: sosyal ikon bağlantıları.'),
        },
      },
    },
    social: {
      type: 'object',
      'x-group': 'seo',
      properties: {
        twitter: text('seo', 'X/Twitter account', 'X/Twitter hesabı', {
          'x-productionOnly': true,
          'x-description': L('Without @; it is added for you.', '@ olmadan; otomatik eklenir.'),
        }),
        facebook_app_id: text('seo', 'Facebook app id', 'Facebook uygulama kimliği', { 'x-productionOnly': true }),
        facebook_admin: text('seo', 'Facebook admin id', 'Facebook yönetici kimliği', { 'x-productionOnly': true }),
        fediverse_creator: text('seo', 'Fediverse creator (@user@instance)', 'Fediverse yazarı (@kullanici@sunucu)', {
          'x-scope': 'both',
          'x-productionOnly': true,
        }),
      },
    },

    // --- RSS
    ShowFullTextinRSS: bool('rss', 'Full text in RSS', 'RSS’te tam metin'),

    // --- Language
    languageAltTitle: text('language', 'Language switch tooltip', 'Dil bağlantısı ipucu', {
      'x-scope': 'language',
      'x-description': L('Set per language under languages.<code>.params.', 'Dil başına languages.<kod>.params altında ayarlanır.'),
    }),
    taxonomies: {
      type: 'object',
      'x-group': 'language',
      properties: {
        tag: text('language', 'Taxonomy shown under posts', 'Yazıların altında gösterilen sınıflandırma', {
          default: 'tags',
          'x-scope': 'language',
          'x-description': L('For example "categories" to list categories instead of tags.', 'Örneğin etiketler yerine kategoriler için "categories".'),
        }),
      },
    },
  },
  'x-pageParams': {
    description: { type: 'string', 'x-label': L('Description', 'Açıklama') },
    keywords: { type: 'array', items: { type: 'string' }, 'x-label': L('Keywords', 'Anahtar kelimeler') },
    author: { type: ['string', 'array'], 'x-label': L('Author(s)', 'Yazar(lar)') },
    images: { type: 'array', items: { type: 'string' }, 'x-label': L('Share images', 'Paylaşım görselleri') },
    audio: { type: 'array', items: { type: 'string' }, 'x-label': L('Audio for social cards', 'Sosyal kartlar için ses') },
    videos: { type: 'array', items: { type: 'string' }, 'x-label': L('Videos for social cards', 'Sosyal kartlar için video') },
    locale: { type: 'string', 'x-label': L('og:locale override', 'og:locale değeri') },
    layout: { type: 'string', enum: ['search', 'archives'], 'x-label': L('Special layout', 'Özel sayfa düzeni') },
    canonicalURL: { type: 'string', format: 'uri', 'x-label': L('Canonical address', 'Asıl (canonical) adres') },
    ShowCanonicalLink: {
      type: 'boolean',
      'x-label': L('Show "Originally published at"', '"İlk yayınlandığı yer" satırını göster'),
      'x-requires': ['canonicalURL'],
    },
    robotsNoIndex: { type: 'boolean', 'x-label': L('Hide from search engines', 'Arama motorlarından gizle'), 'x-gotcha': BOOLEAN_ONLY },
    searchHidden: { type: 'boolean', 'x-label': L('Leave out of site search', 'Site içi aramada gösterme') },
    hiddenInHomeList: {
      type: 'boolean',
      'x-writeFalse': 'omit',
      'x-label': L('Hide from the home page list', 'Ana sayfa listesinde gösterme'),
      'x-gotcha': L(
        'The theme compares this as text: false also hides the post. Write true, or delete the key to show the post.',
        'Tema bunu metin olarak karşılaştırır: false da yazıyı gizler. Gizlemek için true yaz, göstermek için anahtarı sil.',
      ),
    },
    hiddenInRss: {
      type: 'boolean',
      'x-writeFalse': 'omit',
      'x-label': L('Leave out of RSS', 'RSS’e koyma'),
      'x-gotcha': L('Only a real boolean works; "false" in quotes hides the post.', 'Yalnızca gerçek mantıksal değer çalışır; tırnaklı "false" yazıyı gizler.'),
    },
    disableShare: { type: 'boolean', 'x-label': L('No share buttons on this page', 'Bu sayfada paylaşım butonu olmasın'), 'x-gotcha': BOOLEAN_ONLY },
    placeholder: { type: 'string', 'x-label': L('Search box placeholder (search page)', 'Arama kutusu yer tutucusu (arama sayfası)') },
    'cover.image': { type: 'string', format: 'image', 'x-label': L('Cover image', 'Kapak görseli') },
    'cover.alt': { type: 'string', 'x-label': L('Cover alt text', 'Kapak alternatif metni') },
    'cover.caption': { type: 'string', format: 'markdown', 'x-label': L('Cover caption', 'Kapak açıklaması') },
    'cover.relative': { type: 'boolean', 'x-label': L('Cover path is relative to the page', 'Kapak yolu sayfaya göre') },
    'cover.responsiveImages': { type: 'boolean', 'x-label': L('Responsive cover sizes', 'Duyarlı kapak boyutları') },
    'cover.hidden': { type: 'boolean', 'x-label': L('Hide cover', 'Kapağı gizle') },
    'cover.hiddenInList': { type: 'boolean', 'x-label': L('Hide cover in lists', 'Listelerde kapağı gizle') },
    'cover.hiddenInSingle': { type: 'boolean', 'x-label': L('Hide cover on the page', 'Sayfada kapağı gizle') },
    ShowToc: { type: 'boolean', 'x-label': L('Table of contents', 'İçindekiler') },
    TocOpen: { type: 'boolean', 'x-label': L('Table of contents open', 'İçindekiler açık') },
    UseHugoToc: { type: 'boolean', 'x-label': L("Hugo's table of contents", 'Hugo’nun içindekiler tablosu') },
    ShowReadingTime: { type: 'boolean', 'x-label': L('Reading time', 'Okuma süresi') },
    ShowWordCount: { type: 'boolean', 'x-label': L('Word count', 'Kelime sayısı') },
    ShowBreadCrumbs: { type: 'boolean', 'x-label': L('Breadcrumbs', 'Sayfa yolu') },
    ShowPostNavLinks: { type: 'boolean', 'x-label': L('Previous/next links', 'Önceki/sonraki bağlantıları') },
    ShowCodeCopyButtons: { type: 'boolean', 'x-label': L('Code copy buttons', 'Kod kopyalama düğmeleri') },
    ShowRssButtonInSectionTermList: { type: 'boolean', 'x-label': L('RSS button (section _index.md)', 'RSS düğmesi (bölüm _index.md)') },
    ShowPageNums: { type: 'boolean', 'x-label': L('Page numbers (_index.md)', 'Sayfa numaraları (_index.md)') },
    ShareButtons: { type: 'array', items: { type: 'string' }, 'x-label': L('Share buttons', 'Paylaşım butonları') },
    hideMeta: { type: 'boolean', 'x-label': L('Hide post details', 'Yazı bilgilerini gizle') },
    hideSummary: { type: 'boolean', 'x-label': L('Hide summary in lists', 'Listelerde özeti gizle'), 'x-gotcha': BOOLEAN_ONLY },
    hideAuthor: { type: 'boolean', 'x-label': L('Hide author', 'Yazarı gizle') },
    hideFooter: { type: 'boolean', 'x-label': L('Hide footer text', 'Alt bilgi metnini gizle') },
    disableAnchoredHeadings: { type: 'boolean', 'x-label': L('No heading anchors', 'Başlık bağlantıları olmasın') },
    comments: { type: 'boolean', 'x-label': L('Comments', 'Yorumlar') },
    'editPost.URL': { type: 'string', 'x-label': L('Edit address', 'Düzenleme adresi') },
    'editPost.Text': { type: 'string', 'x-label': L('Edit link text', 'Düzenleme bağlantı metni') },
    'editPost.appendFilePath': { type: 'boolean', 'x-label': L('Append file path', 'Dosya yolunu ekle') },
    'editPost.disabled': { type: 'boolean', 'x-label': L('No edit link', 'Düzenleme bağlantısı olmasın') },
    CanonicalLinkText: {
      type: 'string',
      'x-label': L('Original address text', 'Asıl adres metni'),
      'x-precedence': 'site-over-page',
      'x-gotcha': L('Used only when the site value is empty.', 'Yalnızca site değeri boşsa kullanılır.'),
    },
    'social.fediverse_creator': { type: 'string', 'x-label': L('Fediverse creator', 'Fediverse yazarı') },
  },
  'x-features': {
    search: {
      label: L('Site search', 'Site içi arama'),
      description: L(
        'Adds the JSON search index to the home page outputs and creates the search page (layout "search"). It must stay at /search/.',
        'Ana sayfa çıktılarına JSON arama dizinini ekler ve arama sayfasını ("search" düzeni) oluşturur. Sayfa /search/ adresinde kalmalı.',
      ),
      steps: [
        { op: 'ensureListContains', path: ['outputs', 'home'], value: 'JSON', defaultList: ['HTML', 'RSS'] },
        {
          op: 'ensureContentFile',
          path: 'content/search.md',
          title: L('Search', 'Ara'),
          frontMatter: { layout: 'search', placeholder: '', summary: 'search' },
          layout: 'search',
        },
        { op: 'menuItem', menu: 'main', name: L('Search', 'Ara'), url: '/search/', weight: 90 },
      ],
    },
    archives: {
      label: L('Archive page', 'Arşiv sayfası'),
      description: L('Creates a page listing posts by year and month (layout "archives").', 'Yazıları yıl ve aya göre listeleyen bir sayfa oluşturur ("archives" düzeni).'),
      steps: [
        {
          op: 'ensureContentFile',
          path: 'content/archives.md',
          title: L('Archive', 'Arşiv'),
          frontMatter: { layout: 'archives', url: '/archives/', summary: 'archives' },
          layout: 'archives',
        },
        { op: 'menuItem', menu: 'main', name: L('Archive', 'Arşiv'), url: '/archives/', weight: 80 },
      ],
    },
  },
  'x-i18n': ['prev_page', 'next_page', 'read_time', 'words', 'toc', 'translations', 'home', 'edit_post', 'code_copy', 'code_copied'],
}
