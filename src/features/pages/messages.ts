import type { FeatureMessages, Strings } from '../../i18n/types'

// Strings of the Pages view, registered in src/i18n/index.ts as `pages`: t('pages.title').

const en = {
  title: 'Pages',
  intro: 'Pages that are not posts: the home page, pages at the top of the content folder such as About, section pages (_index) and pages with their own type or layout.',
  loading: 'Reading pages…',
  search: 'Search pages',
  none: 'No standalone pages were found.',
  noMatch: 'No page matches the search.',
  columns: {
    page: 'Page',
    menus: 'Menus',
    actions: 'Actions',
  },
  reason: {
    home: 'home page',
    section: 'section',
    root: 'page',
    type: 'own layout',
  },
  draft: 'draft',
  typeLayout: 'type: {{type}}, layout: {{layout}}',
  notInMenu: 'not in a menu',
  fromPage: 'in the page’s front matter',
  fromConfig: 'linked from the config',
  open: 'Open',
  openPage: 'Open {{title}} in the editor',
  menuFor: 'Menu for {{title}}',
  addToMenu: 'Add to menu',
  addTitle: 'Add “{{title}}” to the {{menu}} menu',
  addIntro: 'The page gets a menus entry in its front matter, placed after the last entry of the menu. You can reorder it in Site settings → Menus.',
  alreadyIn: 'Already in this menu',
}

const tr: Strings<typeof en> = {
  title: 'Sayfalar',
  intro: 'Yazı olmayan sayfalar: ana sayfa, içerik klasörünün en üstündeki Hakkında gibi sayfalar, bölüm sayfaları (_index) ve kendi türünü ya da şablonunu seçen sayfalar.',
  loading: 'Sayfalar okunuyor…',
  search: 'Sayfalarda ara',
  none: 'Bağımsız sayfa bulunamadı.',
  noMatch: 'Aramaya uyan sayfa yok.',
  columns: {
    page: 'Sayfa',
    menus: 'Menüler',
    actions: 'İşlemler',
  },
  reason: {
    home: 'ana sayfa',
    section: 'bölüm',
    root: 'sayfa',
    type: 'kendi şablonu',
  },
  draft: 'taslak',
  typeLayout: 'tür: {{type}}, şablon: {{layout}}',
  notInMenu: 'menüde değil',
  fromPage: 'sayfanın front matter’ında',
  fromConfig: 'config’ten bağlantılı',
  open: 'Aç',
  openPage: '{{title}} sayfasını editörde aç',
  menuFor: '{{title}} için menü',
  addToMenu: 'Menüye ekle',
  addTitle: '“{{title}}” sayfasını {{menu}} menüsüne ekle',
  addIntro: 'Sayfanın front matter’ına bir menus girdisi eklenir ve menünün son girdisinin arkasına yerleşir. Sırasını Site ayarları → Menüler’den değiştirebilirsin.',
  alreadyIn: 'Zaten bu menüde',
}

export const messages: FeatureMessages<typeof en> = { en, tr }
