import type { FeatureMessages } from '../../i18n/types'

// Strings for this feature, used as t('checks.<key>').
const en = {
  title: 'Checks',
  allGood: 'nothing to fix',
  count_one: '{{count}} note',
  count_other: '{{count}} notes',
  line: 'line {{line}}',
  severity: {
    error: 'Error',
    warn: 'Warning',
    info: 'Note',
  },
  rules: {
    frontMatterInvalid: 'The front matter cannot be read: {{detail}}',
    titleMissing: 'The title is missing.',
    descriptionEmpty: 'The description is empty. Search engines and link previews show it under the title.',
    descriptionLong: 'The description has {{count}} characters; search engines cut it after about {{max}}.',
    draft: 'This is a draft: it will not appear on the site until “draft” is turned off.',
    archetypeLeftover: 'Left over from the template: “{{text}}”',
    archetypeLeftoverField: 'The {{field}} is still the template’s: “{{text}}”',
    placeholder: 'Placeholder left in the text: {{text}}',
    imageAlt: 'An image has no description (alt text) for screen readers and search engines.',
    rawHtml: 'Hugo leaves out raw HTML such as <{{tag}}> unless “Allow raw HTML” (markup.goldmark.renderer.unsafe) is on in the site settings.',
    bodyEmpty: 'The post has no text yet.',
    bodyH1: 'The text starts a top-level heading (#). Most themes already show the title as one, so it may appear twice.',
  },
}

const tr: FeatureMessages<typeof en>['tr'] = {
  title: 'Kontroller',
  allGood: 'düzeltilecek bir şey yok',
  count_one: '{{count}} not',
  count_other: '{{count}} not',
  line: 'satır {{line}}',
  severity: {
    error: 'Hata',
    warn: 'Uyarı',
    info: 'Not',
  },
  rules: {
    frontMatterInvalid: 'Ön bilgi (front matter) okunamıyor: {{detail}}',
    titleMissing: 'Başlık yok.',
    descriptionEmpty: 'Açıklama boş. Arama motorları ve bağlantı önizlemeleri bunu başlığın altında gösterir.',
    descriptionLong: 'Açıklama {{count}} karakter; arama motorları yaklaşık {{max}} karakterden sonrasını keser.',
    draft: 'Bu bir taslak: “taslak” kapatılana kadar sitede görünmez.',
    archetypeLeftover: 'Şablondan kalmış: “{{text}}”',
    archetypeLeftoverField: '{{field}} alanı hâlâ şablondaki gibi: “{{text}}”',
    placeholder: 'Metinde yer tutucu kalmış: {{text}}',
    imageAlt: 'Bir görselin açıklaması (alt metni) yok; ekran okuyucular ve arama motorları bunu kullanır.',
    rawHtml: 'Site ayarlarında “Ham HTML’e izin ver” (markup.goldmark.renderer.unsafe) açık değilse Hugo <{{tag}}> gibi ham HTML’i yayına koymaz.',
    bodyEmpty: 'Yazının henüz metni yok.',
    bodyH1: 'Metin birinci düzey bir başlıkla (#) başlıyor. Çoğu tema başlığı zaten böyle gösterir; iki kez görünebilir.',
  },
}

export const messages: FeatureMessages<typeof en> = { en, tr }
