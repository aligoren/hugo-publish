import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { api } from '../../../lib/api'
import type { FrontMatterParts } from '../../../lib/frontmatter'
import { applySnippet, extractSnippet } from '../snippet'
import type { FrontMatterController } from '../useFrontMatter'

interface Props {
  fieldKey: string
  fm: FrontMatterController
  getParts(): FrontMatterParts | null
  disabled?: boolean
  onDone?: () => void
}

/**
 * Edits a nested value as the YAML/TOML text it is written as. The edit is checked before it is
 * used: it must parse and must not change any other field.
 */
export function SnippetEditor({ fieldKey, fm, getParts, disabled, onDone }: Props) {
  const { t } = useTranslation()
  const [initial] = useState(() => {
    const parts = getParts()
    return parts ? extractSnippet(parts, fieldKey) : null
  })
  const [draft, setDraft] = useState(initial ?? '')
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (initial === null) {
    return <p className="text-xs text-zinc-500">{t('document.snippetUnavailable')}</p>
  }

  async function apply() {
    setBusy(true)
    setProblem(null)
    try {
      await fm.flush()
      const parts = getParts()
      if (!parts) return
      const result = await applySnippet(parts, fieldKey, draft, {
        parseToml: async (text) => (await api.tomlParseText(text)).values,
      })
      if (result.ok) {
        fm.setText(result.frontMatterText)
        onDone?.()
      } else if (result.reason === 'otherKeys') {
        setProblem(t('document.snippetOtherKeys', { field: fieldKey }))
      } else if (result.reason === 'notFound') {
        setProblem(t('document.snippetUnavailable'))
      } else {
        setProblem(t('document.snippetSyntax', { detail: result.detail ?? '' }))
      }
    } finally {
      setBusy(false)
    }
  }

  const label = t('document.snippetLabel', { field: fieldKey, format: (fm.format ?? 'yaml').toUpperCase() })
  return (
    <div className="space-y-2">
      <textarea
        aria-label={label}
        className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 font-mono text-xs dark:border-zinc-700 dark:bg-zinc-900"
        rows={Math.min(14, Math.max(3, draft.split('\n').length + 1))}
        spellCheck={false}
        value={draft}
        disabled={disabled || busy}
        onChange={(e) => setDraft(e.target.value)}
      />
      {problem && (
        <p role="alert" className="text-xs whitespace-pre-wrap text-red-700 dark:text-red-400">
          {problem}
        </p>
      )}
      <div className="flex gap-2">
        <button type="button" className="btn px-2 py-1 text-xs" disabled={disabled || busy || draft === initial} onClick={() => void apply()}>
          {t('document.snippetApply')}
        </button>
        <button
          type="button"
          className="btn px-2 py-1 text-xs"
          disabled={disabled || busy || draft === initial}
          onClick={() => {
            setDraft(initial)
            setProblem(null)
          }}
        >
          {t('document.snippetReset')}
        </button>
        {onDone && (
          <button type="button" className="btn px-2 py-1 text-xs" disabled={busy} onClick={onDone}>
            {t('common.close')}
          </button>
        )}
      </div>
    </div>
  )
}
