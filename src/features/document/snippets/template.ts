// User snippet templates: a small, Markdown-friendly subset of Mustache.
//
//   {{key}}              the field's value (nothing is escaped: the output is Markdown)
//   {{key|filter}}       slug, upper, lower, trim, attr (for a "quoted" shortcode argument),
//                        blockquote (continues a multi-line value inside `> `), title and url
//                        (a page field's title and address)
//   {{#key}}…{{/key}}    shown only when the field is not empty (or a yes/no field is yes)
//   {{^key}}…{{/key}}    shown only when the field is empty
//
// Only names of the snippet's own fields are replaced. Everything else, including Hugo's
// `{{< shortcode >}}` / `{{% shortcode %}}` delimiters and unknown `{{names}}`, stays as written.
// A section tag alone on its line takes the line with it, so optional lines leave no blank line.

import { slugify } from '../../../lib/slug'

export type TemplateValue = string | number | boolean | null | undefined

export interface TemplatePage {
  title: string
  permalink: string
}

export interface TemplateContext {
  /** Keys of the snippet's fields: only these are replaced. */
  keys: readonly string[]
  values: Readonly<Record<string, TemplateValue>>
  /** Page fields hold a content path; `title` / `url` look the page up here. */
  pages?: ReadonlyMap<string, TemplatePage>
}

export const FILTERS = ['slug', 'upper', 'lower', 'trim', 'attr', 'blockquote', 'title', 'url'] as const
export type TemplateFilter = (typeof FILTERS)[number]

const NAME = '[A-Za-z_][A-Za-z0-9_-]*'
const STANDALONE = new RegExp(`^[ \\t]*(\\{\\{[#^/]\\s*(${NAME})\\s*\\}\\})[ \\t]*(?:\\r?\\n|$)`, 'gm')
const VARIABLE = new RegExp(`\\{\\{\\s*(${NAME})\\s*(?:\\|\\s*([a-z]+)\\s*)?\\}\\}`, 'g')

export function isFilled(value: TemplateValue): boolean {
  if (value === undefined || value === null || value === false) return false
  return typeof value !== 'string' || value.trim() !== ''
}

function text(value: TemplateValue): string {
  if (value === undefined || value === null) return ''
  return String(value)
}

function applyFilter(value: TemplateValue, filter: TemplateFilter, pages?: ReadonlyMap<string, TemplatePage>): string {
  const s = text(value)
  switch (filter) {
    case 'slug':
      return slugify(s)
    case 'upper':
      return s.toLocaleUpperCase()
    case 'lower':
      return s.toLocaleLowerCase()
    case 'trim':
      return s.trim()
    case 'attr':
      return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, ' ')
    case 'blockquote':
      return s.replace(/\r?\n/g, '\n> ')
    case 'title':
      return pages?.get(s)?.title ?? s
    case 'url':
      return pages?.get(s)?.permalink ?? s
  }
}

/** Renders a template with the given field values. */
export function renderTemplate(template: string, context: TemplateContext): string {
  const known = new Set(context.keys)
  const { values } = context
  // Tags alone on their line take the line (indentation and line break) with them.
  let out = template.replace(STANDALONE, (match, tag: string, key: string) => (known.has(key) ? tag : match))
  // Sections, innermost first.
  for (let pass = 0; pass < 50; pass++) {
    let changed = false
    out = out.replace(
      new RegExp(`\\{\\{([#^])\\s*(${NAME})\\s*\\}\\}((?:(?!\\{\\{[#^]\\s*\\2\\s*\\}\\})[\\s\\S])*?)\\{\\{/\\s*\\2\\s*\\}\\}`, 'g'),
      (match, kind: string, key: string, inner: string) => {
        if (!known.has(key)) return match
        changed = true
        return isFilled(values[key]) === (kind === '#') ? inner : ''
      },
    )
    if (!changed) break
  }
  return out.replace(VARIABLE, (match, key: string, filter: string | undefined) => {
    if (!known.has(key)) return match
    if (filter === undefined) return text(values[key])
    return (FILTERS as readonly string[]).includes(filter) ? applyFilter(values[key], filter as TemplateFilter, context.pages) : match
  })
}

/** Field names a template uses (in `{{key}}`, `{{#key}}`, `{{^key}}` and `{{/key}}`). */
export function templateKeys(template: string): string[] {
  const keys = new Set<string>()
  for (const m of template.matchAll(new RegExp(`\\{\\{[#^/]?\\s*(${NAME})\\s*(?:\\|[^}]*)?\\}\\}`, 'g'))) keys.add(m[1])
  return [...keys]
}
