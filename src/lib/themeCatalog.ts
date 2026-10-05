// Popular Hugo themes that work as a plain folder under themes/ (no Hugo modules or npm needed).
import type { ThemeSource } from './api'

export interface CatalogTheme extends ThemeSource {
  homepage: string
  description: { en: string; tr: string }
  /** Needs the extended edition of Hugo (Sass). */
  needsExtended?: boolean
}

export const THEME_CATALOG: CatalogTheme[] = [
  {
    owner: 'adityatelange',
    repo: 'hugo-PaperMod',
    name: 'PaperMod',
    homepage: 'https://github.com/adityatelange/hugo-PaperMod',
    description: {
      en: 'Fast, clean blog theme with search, archives, dark mode and table of contents.',
      tr: 'Arama, arşiv, karanlık mod ve içindekiler tablosu olan hızlı, sade bir blog teması.',
    },
  },
  {
    owner: 'theNewDynamic',
    repo: 'gohugo-theme-ananke',
    name: 'ananke',
    homepage: 'https://github.com/theNewDynamic/gohugo-theme-ananke',
    description: {
      en: 'Hugo’s official starter theme: simple, with cover images.',
      tr: 'Hugo’nun resmi başlangıç teması: sade, kapak görselli.',
    },
  },
  {
    owner: 'nunocoracao',
    repo: 'blowfish',
    name: 'blowfish',
    homepage: 'https://blowfish.page',
    description: {
      en: 'Feature-rich theme for blogs and personal sites, many layouts and colour schemes.',
      tr: 'Bloglar ve kişisel siteler için çok özellikli tema; birçok düzen ve renk şeması.',
    },
  },
  {
    owner: 'jpanther',
    repo: 'congo',
    reference: 'stable',
    name: 'congo',
    homepage: 'https://jpanther.github.io/congo/',
    description: {
      en: 'Lightweight theme built with Tailwind, good typography and dark mode.',
      tr: 'Tailwind ile yapılmış hafif tema; iyi tipografi ve karanlık mod.',
    },
  },
  {
    owner: 'CaiJimmy',
    repo: 'hugo-theme-stack',
    name: 'hugo-theme-stack',
    homepage: 'https://stack.jimmycai.com',
    description: {
      en: 'Card-style blog theme with a sidebar and widgets.',
      tr: 'Kenar çubuğu ve bileşenleri olan, kart görünümlü blog teması.',
    },
    needsExtended: true,
  },
  {
    owner: 'alex-shpak',
    repo: 'hugo-book',
    name: 'hugo-book',
    homepage: 'https://github.com/alex-shpak/hugo-book',
    description: {
      en: 'Documentation or book style: a menu on the side, pages in order.',
      tr: 'Belge ya da kitap düzeni: yanda menü, sıralı sayfalar.',
    },
  },
  {
    owner: 'vimux',
    repo: 'mainroad',
    name: 'mainroad',
    homepage: 'https://github.com/vimux/mainroad',
    description: {
      en: 'Classic magazine-style blog theme with a sidebar.',
      tr: 'Kenar çubuklu, klasik dergi görünümlü blog teması.',
    },
  },
  {
    owner: 'panr',
    repo: 'hugo-theme-terminal',
    name: 'terminal',
    homepage: 'https://github.com/panr/hugo-theme-terminal',
    description: {
      en: 'Retro terminal look, monospaced and minimal.',
      tr: 'Eski terminal görünümü; eş aralıklı yazı, minimal.',
    },
  },
]
