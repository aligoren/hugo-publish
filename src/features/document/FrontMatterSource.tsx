import { useTranslation } from 'react-i18next'

import { fileLineSeparator, type FrontMatterParts } from '../../lib/frontmatter'

interface Props {
  parts: FrontMatterParts
  onChange(frontMatterText: string): void
  disabled?: boolean
}

/** The front matter as text, for anything the form does not cover (or a syntax error to fix). */
export function FrontMatterSource({ parts, onChange, disabled }: Props) {
  const { t } = useTranslation()
  const shown = parts.frontMatterText.replace(/\r\n/g, '\n')
  const sep = fileLineSeparator(parts)
  return (
    <label className="field">
      <span>{t('document.sourceLabel', { format: (parts.format ?? 'yaml').toUpperCase() })}</span>
      <textarea
        className="font-mono text-xs"
        spellCheck={false}
        rows={Math.min(24, Math.max(6, shown.split('\n').length + 1))}
        value={shown}
        disabled={disabled}
        onChange={(e) => {
          let text = e.target.value
          // YAML and TOML need a line break before the closing `---` / `+++`.
          if (parts.format !== 'json' && text !== '' && !text.endsWith('\n')) text += '\n'
          onChange(sep === '\r\n' ? text.replace(/\r?\n/g, '\r\n') : text)
        }}
      />
      <small className="text-zinc-500">{t('document.sourceHint')}</small>
    </label>
  )
}
