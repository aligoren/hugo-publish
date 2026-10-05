import { useTranslation } from 'react-i18next'

import { chromaPalette, SAMPLE_CODE, tokenize } from '../model/chromaSample'

const TOKENS = tokenize(SAMPLE_CODE)

/** A code sample in the colors of a Chroma style (an offline approximation). */
export function ChromaSample({ style }: { style: string }) {
  const { t } = useTranslation()
  const palette = chromaPalette(style)
  if (!palette) {
    return <p className="text-xs text-zinc-500">{style ? t('settings.chroma.unknown', { style }) : t('settings.chroma.none')}</p>
  }
  return (
    <figure className="space-y-1">
      <pre
        aria-label={t('settings.chroma.sample', { style })}
        className="overflow-auto rounded-md border border-zinc-200 p-3 font-mono text-xs leading-relaxed dark:border-zinc-700"
        style={{ background: palette.background, color: palette.text, tabSize: 4 }}
      >
        {TOKENS.map((token, i) =>
          token.kind === 'text' ? (
            token.text
          ) : (
            <span
              key={i}
              data-token={token.kind}
              style={{
                color: palette[token.kind],
                fontStyle: token.kind === 'comment' && palette.italicComments ? 'italic' : undefined,
                fontWeight: token.kind === 'keyword' && palette.boldKeywords ? 600 : undefined,
              }}
            >
              {token.text}
            </span>
          ),
        )}
      </pre>
      <figcaption className="text-[11px] text-zinc-500">{t('settings.chroma.approximate')}</figcaption>
    </figure>
  )
}
