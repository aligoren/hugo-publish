import type { FeatureMessages } from '../../i18n/types'

// Strings for the translations view, used as t('translations.<key>').
const en = {
  title: 'Translations',
  intro: 'Each row is one page in all of the site’s languages. A missing translation is created as a draft copy you can then translate.',
  singleLanguage: 'This site has one language. Add languages in Site settings → Languages to manage translations here.',
  addLanguage: 'Open Site settings',
  onlyMissing: 'Only pages with missing translations',
  page: 'Page',
  open: 'Open',
  create: 'Create',
  none: 'No pages yet.',
  exists: '{{path}} already exists.',
  useAi: 'Translate the draft with the AI assistant',
}

export const messages: FeatureMessages<typeof en> = {
  en,
  tr: {
    title: 'Çeviriler',
    intro: 'Her satır, sitenin bütün dillerinde tek bir sayfadır. Eksik bir çeviri, sonra çevirebileceğin taslak bir kopya olarak oluşturulur.',
    singleLanguage: 'Bu site tek dilli. Çevirileri burada yönetmek için Site ayarları → Diller bölümünden dil ekle.',
    addLanguage: 'Site ayarlarını aç',
    onlyMissing: 'Yalnızca çevirisi eksik sayfalar',
    page: 'Sayfa',
    open: 'Aç',
    create: 'Oluştur',
    none: 'Henüz sayfa yok.',
    exists: '{{path}} zaten var.',
    useAi: 'Taslağı yapay zekâ ile çevir',
  },
}
