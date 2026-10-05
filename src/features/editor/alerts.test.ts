import { describe, expect, it } from 'vitest'
import { splitFrontMatter } from '../../lib/frontmatter'
import { alertField, buildAlertDecorations, findAlertsInText } from './alerts'
import { TURKISH_ALERT_LABELS } from './config'
import { fixture } from './testing/fixtures'
import { stateFor } from './testing/harness'

describe('findAlerts', () => {
  const body = splitFrontMatter(fixture('alerts.md')).body
  const alerts = findAlertsInText(body)
  const lineText = (n: number) => body.split('\n')[n - 1]

  it('finds the five types, any case, and nothing else', () => {
    expect(alerts.map((a) => [a.type, a.rawType])).toEqual([
      ['note', 'NOTE'],
      ['tip', 'TIP'],
      ['important', 'IMPORTANT'],
      ['warning', 'WARNING'],
      ['caution', 'CAUTION'],
      ['note', 'note'],
    ])
  })

  it('covers every line of the blockquote', () => {
    const caution = alerts.find((a) => a.type === 'caution')!
    expect(lineText(caution.fromLine)).toBe('> [!CAUTION]')
    expect(lineText(caution.toLine)).toBe('> Ayrı bir paragraf, ***kalın ve italik***.')
    expect(caution.toLine - caution.fromLine).toBe(3)
    const important = alerts.find((a) => a.type === 'important')!
    expect(important.toLine - important.fromLine).toBe(2)
  })

  it('reads a custom title and the marker position', () => {
    const warning = alerts.find((a) => a.type === 'warning')!
    expect(warning.title).toBe('Özel başlık')
    expect(body.slice(warning.markerFrom, warning.markerTo)).toBe('[!WARNING]')
    expect(alerts.find((a) => a.type === 'note')!.title).toBe(null)
  })

  it('handles fold signs, nesting in lists and lazy continuation lines', () => {
    const [folded] = findAlertsInText('> [!TIP]- Kapalı\n> İçerik\n')
    expect(folded.foldSign).toBe('-')
    expect(folded.title).toBe('Kapalı')
    expect(findAlertsInText('- madde\n\n  > [!NOTE]\n  > Liste içinde\n')).toHaveLength(1)
    const [lazy] = findAlertsInText('> [!NOTE]\n> bir\niki\n\nsonra')
    expect(lazy.toLine).toBe(3)
  })

  it('ignores markers that are not on the first line or not alone', () => {
    expect(findAlertsInText('> Metin\n> [!NOTE]\n')).toHaveLength(0)
    expect(findAlertsInText('> [!NOTE]metin\n')).toHaveLength(0)
    expect(findAlertsInText('<!--\n> [!NOTE]\n-->\n')).toHaveLength(0)
    expect(findAlertsInText('    > [!NOTE]\n')).toHaveLength(0)
  })
})

describe('alert decorations', () => {
  const doc = 'Önce.\n\n> [!WARNING]\n> Dikkatli ol.\n\nSonra.|'

  function describeDecorations(state: ReturnType<typeof stateFor>, active?: Set<number>) {
    const result: string[] = []
    buildAlertDecorations(state, active ? { active } : {}).between(0, state.doc.length, (from, to, deco) => {
      const spec = deco.spec as { class?: string; widget?: { label: string } }
      if (spec.widget) result.push(`widget ${state.sliceDoc(from, to)} -> ${spec.widget.label}`)
      else if (from === to) result.push(`line ${state.doc.lineAt(from).number}: ${spec.class}`)
      else result.push(`mark ${state.sliceDoc(from, to)}: ${spec.class}`)
    })
    return result
  }

  it('colours the lines and replaces the marker with the host label off the cursor line', () => {
    const state = stateFor(doc, 'lf', { alertLabels: TURKISH_ALERT_LABELS })
    expect(state.field(alertField)).toHaveLength(1)
    expect(describeDecorations(state)).toEqual([
      'line 3: cm-alert cm-alert-warning cm-alert-first',
      'widget [!WARNING] -> Uyarı',
      'line 4: cm-alert cm-alert-warning cm-alert-last',
    ])
  })

  it('shows the raw marker on the cursor line and in raw mode', () => {
    const state = stateFor(doc, 'lf', { alertLabels: TURKISH_ALERT_LABELS })
    expect(describeDecorations(state, new Set([3]))[1]).toBe('mark [!WARNING]: cm-alert-marker')
    const raw = stateFor(doc, 'lf', { livePreview: false })
    expect(describeDecorations(raw)[1]).toBe('mark [!WARNING]: cm-alert-marker')
  })

  it('uses the default English labels', () => {
    const state = stateFor(doc)
    expect(describeDecorations(state)[1]).toBe('widget [!WARNING] -> Warning')
  })
})
