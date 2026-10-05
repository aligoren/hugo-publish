import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { ErrorNote } from '../../components/ErrorNote'
import type { PageEntry } from '../../lib/api'
import type { FrontMatterParts, FrontMatterValue } from '../../lib/frontmatter'
import { templateFormat } from './dates'
import { imageFieldKeys, otherKeys } from './fieldKinds'
import { AiSuggestButton } from './fields/AiSuggest'
import { ChipInput } from './fields/ChipInput'
import { DateField } from './fields/DateField'
import { FieldControl, type FieldEnv } from './fields/FieldControl'
import { ListField } from './fields/ListField'
import { OtherFields } from './fields/OtherFields'
import { SlugField } from './fields/SlugField'
import { CheckboxField, TextField } from './fields/TextField'
import { asList, asText, fieldAccess, isDraftValue, taxonomyLabel } from './frontMatterFields'
import { FrontMatterSource } from './FrontMatterSource'
import { findKey, isRecord } from './frontMatterOps'
import { imageTargetDir, siteImagePath } from './imagePaths'
import { imageReference } from './mediaBridge'
import { docLocation } from './rename'
import { DEFAULT_TAXONOMIES, type SiteSettings } from './siteSettings'
import type { TermCount } from './termIndex'
import type { ThemeImageParam } from './themeImages'
import type { AiHelper } from './useAi'
import type { FrontMatterController } from './useFrontMatter'

export const DESCRIPTION_LIMIT = 160

interface Props {
  fm: FrontMatterController
  parts: FrontMatterParts
  getParts(): FrontMatterParts | null
  docPath: string
  settings: SiteSettings | null
  terms: Record<string, TermCount[]>
  themeImages: readonly ThemeImageParam[]
  /** This page in `hugo list` output. */
  page: PageEntry | undefined
  pickImage(defaultDir: string): Promise<string | null>
  previewImage(src: string): Promise<string | null>
  /** The AI assistant, when the user turned it on. */
  ai?: AiHelper | null
  /** Shows the front matter as text; the form keeps its own choice when this is not given. */
  sourceMode?: boolean
  onSourceModeChange?: (source: boolean) => void
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-3 border-t border-zinc-100 pt-4 first:border-t-0 first:pt-0 dark:border-zinc-800/70">
      <h3 className="text-[11px] font-semibold tracking-wider text-zinc-500 uppercase dark:text-zinc-400">{title}</h3>
      {children}
    </section>
  )
}

/**
 * The post settings: every front matter field but the title, which is edited above the text
 * (YAML and TOML; JSON is shown read-only). Fields carry `data-field` so they can be focused.
 */
export function FrontMatterForm({
  fm,
  parts,
  getParts,
  docPath,
  settings,
  terms,
  themeImages,
  page,
  pickImage,
  previewImage,
  ai = null,
  sourceMode: sourceModeProp,
  onSourceModeChange,
}: Props) {
  const { t } = useTranslation()
  const [ownSourceMode, setOwnSourceMode] = useState(false)
  const sourceMode = sourceModeProp ?? ownSourceMode
  const setSourceMode = (source: boolean) => {
    setOwnSourceMode(source)
    onSourceModeChange?.(source)
  }
  const values = fm.values
  const disabled = !fm.editable
  const showSource = sourceMode || (values === null && fm.error !== null)

  const { get: v, keyOf, setOrDrop } = fieldAccess(fm)
  const [moreOpen, setMoreOpen] = useState(() => ['lastmod', 'weight', 'aliases', 'summary'].some((name) => v(name) !== undefined))

  const isToml = fm.format === 'toml'
  const dateRaw = isToml ? fm.raw([keyOf('date')]) : null
  const bareDates = isToml && (dateRaw === null || dateRaw.style === 'datetime')
  const dateTemplate = templateFormat([dateRaw?.raw, v('date'), v('lastmod'), v('publishDate'), v('expiryDate')])
  const datetimeFor = (name: string) => {
    if (!isToml) return undefined
    const raw = fm.raw([keyOf(name)])
    return raw ? raw.style === 'datetime' : bareDates
  }

  const imageDir = imageTargetDir(docPath, v('slug'))
  const env: FieldEnv = {
    fm,
    parts,
    getParts,
    disabled,
    bareDates,
    pickImage: () => pickImage(imageDir).then((picked) => (picked ? imageReference(picked, docPath) : null)),
    previewImage,
    suggestAlt: ai
      ? (src: string) => {
          const file = siteImagePath(src, docPath)
          if (!file) return Promise.reject(new Error(t('document.aiNoImage')))
          return ai.altText(file, asText(v('title')))
        }
      : undefined,
  }

  const taxonomies = settings?.taxonomies ?? DEFAULT_TAXONOMIES
  const imageKeys = values ? imageFieldKeys(values) : []
  const other = values ? otherKeys(values, taxonomies, imageKeys) : []
  const suggestedImages = values
    ? themeImages.filter((param) => {
        const top = findKey(values, param.path[0])
        if (top === undefined) return true
        if (param.path.length === 1) return false
        const parent = values[top]
        return isRecord(parent) && findKey(parent, param.path[1]) === undefined
      })
    : []

  const description = asText(v('description'))
  const draft = isDraftValue(v('draft'))
  const build = v('build')
  const hideFromLists = isRecord(build) && asText(build.list).toLowerCase() === 'never'
  const sitemap = v('sitemap')
  const sitemapDisabled = isRecord(sitemap) && (sitemap.disable === true || sitemap.disable === 'true')
  const loc = docLocation(docPath)

  /** Turns a `build.list` / `sitemap.disable` style switch on or off. */
  function toggleSub(name: string, sub: string, on: boolean, value: FrontMatterValue) {
    const key = keyOf(name)
    if (on) {
      fm.set([key, sub], value)
      return
    }
    const current = v(name)
    if (!isRecord(current)) return
    const subKey = findKey(current, sub) ?? sub
    if (Object.keys(current).every((k) => k.toLowerCase() === sub.toLowerCase())) fm.remove([key])
    else fm.remove([key, subKey])
  }

  return (
    <div className="space-y-4 px-4 py-4">
      <div className="flex items-center gap-2 text-xs">
        {fm.format && (
          <span className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[10px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400" title={t('document.frontMatter')}>
            {fm.format.toUpperCase()}
          </span>
        )}
        {fm.pending && <span className="text-zinc-500">{t('common.saving')}</span>}
        <div className="ml-auto flex items-center gap-1" role="group" aria-label={t('document.frontMatterView')}>
          <button
            type="button"
            className="btn px-2 py-0.5 text-xs"
            aria-pressed={!showSource}
            disabled={values === null}
            onClick={() => setSourceMode(false)}
          >
            {t('document.viewForm')}
          </button>
          <button type="button" className="btn px-2 py-0.5 text-xs" aria-pressed={showSource} onClick={() => setSourceMode(true)}>
            {t('document.viewSource')}
          </button>
        </div>
      </div>

      {fm.error !== null && <ErrorNote error={fm.error} />}
      {fm.format === 'json' && (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{t('document.frontMatterReadOnly', { format: 'JSON' })}</p>
      )}
      {fm.format === null && <p className="text-xs text-zinc-500">{t('document.noFrontMatter')}</p>}

      {showSource ? (
        <div data-field="source">
          <FrontMatterSource parts={parts} onChange={fm.setText} disabled={fm.pending} />
        </div>
      ) : values === null ? (
        <p className="text-sm text-zinc-500">{t('common.loading')}</p>
      ) : (
        <div className="grid gap-5 text-sm">
          <Section title={t('document.sectionAbout')}>
            <div data-field="description">
              <TextField
                label={t('document.fieldDescription')}
                value={description}
                multiline
                rows={3}
                disabled={disabled}
                hint={t('document.descriptionHint', { count: description.length, limit: DESCRIPTION_LIMIT })}
                warn={description.length > DESCRIPTION_LIMIT}
                onChange={(text) => setOrDrop('description', text, text === '')}
              >
                {ai && !disabled && (
                  <AiSuggestButton
                    label={t('document.aiSuggestDescription')}
                    run={() => ai.describe(asText(v('title')), parts.body)}
                    onResult={(text) => text.trim() && setOrDrop('description', text.trim(), false)}
                  />
                )}
              </TextField>
            </div>
          </Section>

          <Section title={t('document.sectionPublishing')}>
            <div data-field="draft">
              <CheckboxField
                label={t('document.fieldDraft')}
                checked={draft}
                disabled={disabled}
                onChange={(checked) => setOrDrop('draft', checked, !checked)}
              />
            </div>
            <div data-field="date">
              <DateField
                label={t('document.fieldDate')}
                value={v('date')}
                raw={dateRaw?.raw ?? null}
                template={dateTemplate}
                disabled={disabled}
                onChange={(text) => fm.set([keyOf('date')], text, { datetime: datetimeFor('date') })}
              />
            </div>
            {(['publishDate', 'expiryDate'] as const).map((name) => {
              const key = findKey(values, name)
              return (
                <div key={name} data-field={name}>
                  <DateField
                    label={t(`document.field_${name}`)}
                    value={v(name)}
                    raw={key && isToml ? (fm.raw([key])?.raw ?? null) : null}
                    template={dateTemplate}
                    disabled={disabled}
                    onChange={(text) => fm.set([keyOf(name)], text, { datetime: datetimeFor(name) })}
                    onClear={() => key !== undefined && fm.remove([key])}
                  />
                </div>
              )
            })}
          </Section>

          {loc.kind !== 'section' && (
            <Section title={t('document.sectionAddress')}>
              <div data-field="slug">
                <SlugField
                  value={asText(v('slug'))}
                  originalSlug={asText(fm.original ? fm.original[findKey(fm.original, 'slug') ?? 'slug'] : '')}
                  title={asText(v('title'))}
                  page={page}
                  fileName={loc.name}
                  aliases={asList(v('aliases'))}
                  baseURL={settings?.baseURL ?? null}
                  disabled={disabled}
                  onChange={(slug) => setOrDrop('slug', slug, slug === '')}
                  onAliasesChange={(aliases) => setOrDrop('aliases', aliases, aliases.length === 0)}
                />
              </div>
            </Section>
          )}

          <Section title={t('document.sectionTaxonomies')}>
            {taxonomies.map((taxonomy) => (
              <div key={taxonomy} data-field={taxonomy}>
                <ChipInput
                  label={taxonomyLabel(taxonomy, t)}
                  values={asList(v(taxonomy))}
                  suggestions={terms[taxonomy] ?? []}
                  disabled={disabled}
                  onChange={(list) => setOrDrop(taxonomy, list, list.length === 0)}
                />
              </div>
            ))}
          </Section>

          {(imageKeys.length > 0 || suggestedImages.length > 0) && (
            <Section title={t('document.sectionImages')}>
              {imageKeys.map((key) => (
                <div key={key} data-field={key}>
                  <FieldControl env={env} path={[key]} label={key} value={values[key]} />
                </div>
              ))}
              {!disabled && suggestedImages.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                  <span>{t('document.themeImages')}</span>
                  {suggestedImages.map((param) => (
                    <button
                      key={param.path.join('.')}
                      type="button"
                      className="btn px-2 py-0.5 font-mono text-xs"
                      onClick={() => fm.set(param.path.map((p, i) => (i === 0 ? keyOf(p) : p)), param.list ? [] : '')}
                    >
                      + {param.path.join('.')}
                    </button>
                  ))}
                </div>
              )}
            </Section>
          )}

          <details open={moreOpen} onToggle={(e) => setMoreOpen(e.currentTarget.open)} className="rounded-md border border-zinc-200 px-3 py-2 dark:border-zinc-800">
            <summary className="cursor-pointer text-xs font-medium text-zinc-600 dark:text-zinc-400">{t('document.more')}</summary>
            <div className="mt-3 grid gap-3">
              {(['lastmod'] as const).map((name) => {
                const key = findKey(values, name)
                return (
                  <DateField
                    key={name}
                    label={t(`document.field_${name}`)}
                    value={v(name)}
                    raw={key && isToml ? (fm.raw([key])?.raw ?? null) : null}
                    template={dateTemplate}
                    disabled={disabled}
                    onChange={(text) => fm.set([keyOf(name)], text, { datetime: datetimeFor(name) })}
                    onClear={() => key !== undefined && fm.remove([key])}
                  />
                )
              })}
              <TextField
                label={t('document.fieldWeight')}
                type="number"
                value={asText(v('weight'))}
                disabled={disabled}
                hint={t('document.weightHint')}
                onChange={(text) => {
                  const n = Number(text)
                  if (text.trim() === '') {
                    const key = findKey(values, 'weight')
                    if (key !== undefined) fm.remove([key])
                  } else if (Number.isFinite(n)) {
                    fm.set([keyOf('weight')], n)
                  }
                }}
              />
              <ListField
                label={t('document.fieldAliases')}
                values={asList(v('aliases'))}
                mono
                placeholder="/old/address/"
                hint={t('document.aliasesHint')}
                disabled={disabled}
                onChange={(list) => setOrDrop('aliases', list, list.length === 0)}
              />
              <div data-field="summary">
              <TextField
                label={t('document.fieldSummary')}
                value={asText(v('summary'))}
                multiline
                rows={3}
                disabled={disabled}
                onChange={(text) => setOrDrop('summary', text, text === '')}
              />
              </div>
              <CheckboxField
                label={t('document.hideFromLists')}
                hint={t('document.hideFromListsHint')}
                checked={hideFromLists}
                disabled={disabled}
                onChange={(on) => toggleSub('build', 'list', on, 'never')}
              />
              <CheckboxField
                label={t('document.sitemapDisable')}
                checked={sitemapDisabled}
                disabled={disabled}
                onChange={(on) => toggleSub('sitemap', 'disable', on, true)}
              />
            </div>
          </details>

          <details className="rounded-md border border-zinc-200 px-3 py-2 dark:border-zinc-800">
            <summary className="cursor-pointer text-xs font-medium text-zinc-600 dark:text-zinc-400">
              {t('document.otherFields', { count: other.length })}
            </summary>
            <div className="mt-3">
              <OtherFields env={env} keys={other} values={values} dateTemplate={dateTemplate} />
            </div>
          </details>
        </div>
      )}
    </div>
  )
}
