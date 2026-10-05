// Theme colours as CSS custom properties: reading `:root { --x: … }` and dark variants from the
// theme's CSS/SCSS, and writing the app's own override file into the theme's CSS hook.

export type CssVarKind = 'color' | 'triplet' | 'length' | 'other'

export interface CssVar {
  name: string
  light?: string
  dark?: string
  /** Values inside other media queries (e.g. a smaller --gap on phones). */
  responsive: { media: string; value: string }[]
  file: string
  kind: CssVarKind
}

export interface CssFile {
  path: string
  text: string
}

const DARK_SELECTOR =
  /(\[data-(?:theme|scheme|mode|color-scheme|bs-theme|color-mode)\s*=\s*["']?dark["']?\s*\]|(^|[\s,>+~(])(?:html|body|:root)?\.(?:dark|dark-mode|theme-dark|dark-theme)\b|^\.dark\b)/i
const LIGHT_ROOT = /^(?::root|html|:host|body)(?:\[data-(?:theme|scheme|mode|color-scheme)\s*=\s*["']?light["']?\s*\]|\.light)?$/i

type Context = 'light' | 'dark' | { media: string } | null

/** Strips comments; keeps string contents. */
function stripComments(text: string): string {
  // `//` line comments only exist in SCSS; requiring whitespace before them keeps `url(//cdn…)` intact.
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[\s;{}])\/\/[^\n]*/g, '$1')
}

function classify(selector: string, media: string[]): Context {
  const parts = selector.split(',').map((s) => s.trim()).filter(Boolean)
  const darkMedia = media.some((m) => /prefers-color-scheme\s*:\s*dark/i.test(m))
  const lightMedia = media.some((m) => /prefers-color-scheme\s*:\s*light/i.test(m))
  const otherMedia = media.filter((m) => !/prefers-color-scheme/i.test(m))
  if (parts.length === 0) return null
  if (parts.some((p) => DARK_SELECTOR.test(p)) && !parts.some((p) => /\blight\b/i.test(p) && !DARK_SELECTOR.test(p))) {
    return otherMedia.length > 0 ? null : 'dark'
  }
  if (parts.every((p) => LIGHT_ROOT.test(p))) {
    if (otherMedia.length > 0) return { media: otherMedia.join(' and ') }
    if (darkMedia) return 'dark'
    if (lightMedia) return 'light'
    return 'light'
  }
  return null
}

/** Visits every block with its selector and enclosing at-rules. */
function walk(text: string, visit: (selector: string, media: string[], decls: [string, string][]) => void) {
  const src = stripComments(text)
  let pos = 0
  const parseBlock = (media: string[], end: number) => {
    let start = pos
    while (pos < end) {
      const ch = src[pos]
      if (ch === '{') {
        const prelude = src.slice(start, pos).trim()
        pos++
        const close = matchingBrace(src, pos - 1)
        const blockEnd = close === -1 ? end : close
        if (/^@media|^@supports|^@layer|^@container/i.test(prelude)) {
          const inner = /^@media/i.test(prelude) ? [...media, prelude.replace(/^@media\s*/i, '')] : media
          parseBlock(inner, blockEnd)
        } else if (/^@mixin\s+([\w-]+)/i.test(prelude)) {
          const name = /^@mixin\s+([\w-]+)/i.exec(prelude)![1]
          const selector = /dark/i.test(name) ? '.dark' : /light/i.test(name) ? ':root' : '@mixin'
          parseRule(selector, media, blockEnd)
        } else if (prelude.startsWith('@')) {
          pos = blockEnd
        } else {
          parseRule(prelude, media, blockEnd)
        }
        pos = blockEnd + 1
        start = pos
      } else if (ch === ';') {
        start = pos + 1
        pos++
      } else if (ch === '"' || ch === "'") {
        const close = src.indexOf(ch, pos + 1)
        pos = close === -1 ? end : close + 1
      } else {
        pos++
      }
    }
  }
  const parseRule = (selector: string, media: string[], end: number) => {
    const decls: [string, string][] = []
    let start = pos
    while (pos < end) {
      const ch = src[pos]
      if (ch === '{') {
        // Nested rule (SCSS): `&.dark { … }` and the like.
        const prelude = src.slice(start, pos).trim()
        const close = matchingBrace(src, pos)
        const blockEnd = close === -1 ? end : close
        pos++
        const nested = prelude.includes('&') ? prelude.replace(/&/g, selector) : `${selector} ${prelude}`
        parseRule(nested, media, blockEnd)
        pos = blockEnd + 1
        start = pos
      } else if (ch === ';') {
        addDecl(src.slice(start, pos), decls)
        pos++
        start = pos
      } else if (ch === '"' || ch === "'") {
        const close = src.indexOf(ch, pos + 1)
        pos = close === -1 ? end : close + 1
      } else if (ch === '(') {
        const close = src.indexOf(')', pos)
        pos = close === -1 || close > end ? pos + 1 : close + 1
      } else {
        pos++
      }
    }
    addDecl(src.slice(start, end), decls)
    if (decls.length > 0) visit(selector, media, decls)
  }
  pos = 0
  parseBlock([], src.length)
}

function addDecl(text: string, decls: [string, string][]) {
  const m = /^\s*(--[\w-]+)\s*:\s*([\s\S]*?)\s*(!important)?\s*$/.exec(text)
  if (m && m[2] !== '') decls.push([m[1], m[2].replace(/\s+/g, ' ')])
}

function matchingBrace(text: string, open: number): number {
  let depth = 0
  for (let i = open; i < text.length; i++) {
    const ch = text[i]
    if (ch === '"' || ch === "'") {
      const close = text.indexOf(ch, i + 1)
      if (close === -1) return -1
      i = close
    } else if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

/** Custom properties of the theme, merged across files (first definition of a context wins). */
export function parseCssVariables(files: CssFile[]): CssVar[] {
  const vars = new Map<string, CssVar>()
  for (const file of files) {
    walk(file.text, (selector, media, decls) => {
      const context = classify(selector, media)
      if (!context) return
      for (const [name, value] of decls) {
        if (/#\{|\$[\w-]/.test(value)) continue
        let v = vars.get(name)
        if (!v) {
          v = { name, responsive: [], file: file.path, kind: 'other' }
          vars.set(name, v)
        }
        if (context === 'light') v.light ??= value
        else if (context === 'dark') v.dark ??= value
        else if (!v.responsive.some((r) => r.media === context.media)) v.responsive.push({ media: context.media, value })
      }
    })
  }
  for (const v of vars.values()) v.kind = kindOf(v.light ?? v.dark ?? '')
  return [...vars.values()].filter((v) => v.light !== undefined || v.dark !== undefined)
}

// --- Colours -----------------------------------------------------------------------------------

const NAMED: Record<string, string> = {
  white: '#ffffff',
  black: '#000000',
  red: '#ff0000',
  green: '#008000',
  blue: '#0000ff',
  yellow: '#ffff00',
  orange: '#ffa500',
  purple: '#800080',
  gray: '#808080',
  grey: '#808080',
  silver: '#c0c0c0',
  navy: '#000080',
  teal: '#008080',
  maroon: '#800000',
  olive: '#808000',
}

export function kindOf(value: string): CssVarKind {
  const v = value.trim()
  if (/^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v)) return 'color'
  if (/^(rgba?|hsla?)\(\s*[\d.%\s,/-]+\)$/i.test(v)) return 'color'
  if (v.toLowerCase() in NAMED) return 'color'
  if (/^\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}$/.test(v) || /^\d{1,3}\s+\d{1,3}\s+\d{1,3}$/.test(v)) return 'triplet'
  if (/^-?(\d+(\.\d+)?|\.\d+)(px|rem|em|%|vh|vw|ch|ex|pt)?$/.test(v)) return 'length'
  return 'other'
}

const hex2 = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  s /= 100
  l /= 100
  const k = (n: number) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return [f(0) * 255, f(8) * 255, f(4) * 255]
}

/** `#rrggbb` for a colour picker, or null when the value is not a plain colour. */
export function toHex(value: string): string | null {
  const v = value.trim().toLowerCase()
  if (v in NAMED) return NAMED[v]
  let m = /^#([0-9a-f]{3,8})$/.exec(v)
  if (m) {
    const h = m[1]
    if (h.length === 3 || h.length === 4) return '#' + h.slice(0, 3).split('').map((c) => c + c).join('')
    if (h.length === 6 || h.length === 8) return '#' + h.slice(0, 6)
    return null
  }
  m = /^rgba?\(\s*([\d.]+)%?[\s,]+([\d.]+)%?[\s,]+([\d.]+)%?/.exec(v)
  if (m) return '#' + [m[1], m[2], m[3]].map((n) => hex2(Number(n))).join('')
  m = /^hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%/.exec(v)
  if (m) return '#' + hslToRgb(Number(m[1]), Number(m[2]), Number(m[3])).map(hex2).join('')
  m = /^(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})$/.exec(v)
  if (m) return '#' + [m[1], m[2], m[3]].map((n) => hex2(Number(n))).join('')
  return null
}

/** Writes a picked `#rrggbb` in the style of the original value (rgb(), triplet or hex). */
export function fromHex(hex: string, original: string): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  const o = original.trim()
  const alpha = /^rgba\(.*?,\s*([\d.]+%?)\s*\)$/i.exec(o) ?? /^rgba?\(.*\/\s*([\d.]+%?)\s*\)$/i.exec(o)
  if (/^rgba?\(/i.test(o)) {
    if (o.includes(',')) return alpha ? `rgba(${r}, ${g}, ${b}, ${alpha[1]})` : `rgb(${r}, ${g}, ${b})`
    return alpha ? `rgb(${r} ${g} ${b} / ${alpha[1]})` : `rgb(${r} ${g} ${b})`
  }
  if (/^\d{1,3}\s*,/.test(o)) return `${r}, ${g}, ${b}`
  if (/^\d{1,3}\s+\d/.test(o)) return `${r} ${g} ${b}`
  return hex
}

// --- Override file -----------------------------------------------------------------------------

export interface CssOverrides {
  light: Record<string, string>
  dark: Record<string, string>
}

export const GENERATED_HEADER =
  '/* Generated by Hugo Publisher (Theme > Colours). Edit these values in the app; manual changes may be overwritten. */'
export const BLOCK_START = '/* hugo-publisher:start - generated by Hugo Publisher (Theme > Colours); edits inside this block may be overwritten */'
export const BLOCK_END = '/* hugo-publisher:end */'

function ruleText(selector: string, values: Record<string, string>, indent = ''): string[] {
  const names = Object.keys(values)
  if (names.length === 0) return []
  return [`${indent}${selector} {`, ...names.map((n) => `${indent}  ${n}: ${values[n]};`), `${indent}}`]
}

/**
 * CSS for the overrides. Light values go under `:root`, dark values under the theme's dark
 * selector (or a prefers-color-scheme media query). A changed variable that the theme also
 * redefines in another media query gets that rule repeated, because a later `:root` rule would
 * otherwise win over it (PaperMod's mobile --gap).
 */
export function overrideCss(overrides: CssOverrides, darkSelector: string, themeVars: CssVar[] = []): string[] {
  const lines: string[] = []
  lines.push(...ruleText(':root', overrides.light))
  if (Object.keys(overrides.dark).length > 0) {
    if (/^@media/i.test(darkSelector)) {
      lines.push(`${darkSelector} {`, ...ruleText(':root', overrides.dark, '  '), '}')
    } else {
      lines.push(...ruleText(darkSelector, overrides.dark))
    }
  }
  const byMedia = new Map<string, Record<string, string>>()
  for (const name of Object.keys(overrides.light)) {
    const theme = themeVars.find((v) => v.name === name)
    for (const r of theme?.responsive ?? []) {
      const values = byMedia.get(r.media) ?? {}
      values[name] = r.value
      byMedia.set(r.media, values)
    }
  }
  for (const [media, values] of byMedia) {
    lines.push(`/* Repeats the theme's value for this screen size, which the rule above would otherwise replace. */`)
    lines.push(`@media ${media} {`, ...ruleText(':root', values, '  '), '}')
  }
  return lines
}

function joinLines(lines: string[], eol: string): string {
  return lines.join(eol) + eol
}

/** The whole file for a folder hook (PaperMod's assets/css/extended/hugo-publisher.css). */
export function generateOverrideFile(overrides: CssOverrides, darkSelector: string, themeVars: CssVar[] = [], eol = '\n'): string {
  return joinLines([GENERATED_HEADER, ...overrideCss(overrides, darkSelector, themeVars)], eol)
}

/** Puts the generated rules into a marked block of an existing file (single-file hooks such as custom.css). */
export function applyManagedBlock(existing: string | null, overrides: CssOverrides, darkSelector: string, themeVars: CssVar[] = []): string {
  const eol = existing && existing.includes('\r\n') ? '\r\n' : '\n'
  const rules = overrideCss(overrides, darkSelector, themeVars)
  const block = rules.length > 0 ? [BLOCK_START, ...rules, BLOCK_END].join(eol) : ''
  const text = existing ?? ''
  const start = text.indexOf(BLOCK_START)
  const end = text.indexOf(BLOCK_END)
  if (start !== -1 && end > start) {
    let before = text.slice(0, start)
    let after = text.slice(end + BLOCK_END.length)
    if (block === '') {
      // Also drop the line break after the block and the blank line added before it.
      after = after.replace(/^\r?\n/, '')
      before = before.replace(/(\r?\n)\r?\n$/, '$1')
    }
    return before + block + after
  }
  if (block === '') return text
  if (text === '') return block + eol
  const sep = text.endsWith('\n') ? eol : eol + eol
  return text + sep + block + eol
}

/** The overrides already written by the app (whole file, or only the marked block). */
export function readOverrides(text: string, darkSelector: string): CssOverrides {
  const start = text.indexOf(BLOCK_START)
  const end = text.indexOf(BLOCK_END)
  const body = start !== -1 && end > start ? text.slice(start + BLOCK_START.length, end) : text.includes(GENERATED_HEADER) ? text : ''
  const out: CssOverrides = { light: {}, dark: {} }
  if (!body) return out
  walk(body, (selector, media, decls) => {
    const isDark = selector.trim() === darkSelector.trim() || classify(selector, media) === 'dark'
    const isLight = !isDark && media.length === 0 && LIGHT_ROOT.test(selector.trim())
    for (const [name, value] of decls) {
      if (isDark) out.dark[name] = value
      else if (isLight) out.light[name] = value
    }
  })
  return out
}

/** The first dark selector used in the theme's CSS, for themes without a curated schema. */
export function detectDarkSelector(files: CssFile[]): string {
  let found: string | null = null
  for (const file of files) {
    walk(file.text, (selector, media) => {
      if (found) return
      if (media.some((m) => /prefers-color-scheme\s*:\s*dark/i.test(m)) && LIGHT_ROOT.test(selector.trim())) {
        found = '@media (prefers-color-scheme: dark)'
      } else if (selector.split(',').some((p) => DARK_SELECTOR.test(p.trim()))) {
        found = selector.split(',').map((p) => p.trim()).find((p) => DARK_SELECTOR.test(p)) ?? null
      }
    })
    if (found) break
  }
  return found ?? '@media (prefers-color-scheme: dark)'
}
