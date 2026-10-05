import type { StateCommand } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import {
  cycleHeading,
  headingLevel,
  insertAlert,
  insertHorizontalRule,
  insertLink,
  insertRtlBlock,
  setAlertType,
  setHeading,
  toggleBlockquote,
  toggleBold,
  toggleItalic,
} from './commands'
import { crlf, runCommand } from './testing/harness'

/** Runs the command on LF and CRLF versions of `input`; both must give `expected`. */
function check(command: StateCommand, input: string, expected: string | null) {
  expect(runCommand(command, input, 'lf')).toBe(expected)
  expect(runCommand(command, input, 'crlf')).toBe(expected === null ? null : crlf(expected))
}

describe('toggleBold / toggleItalic', () => {
  it('wraps a selection', () => {
    check(toggleBold, 'Merhaba «dünya» ve', 'Merhaba **«dünya»** ve')
    check(toggleItalic, 'Merhaba «dünya» ve', 'Merhaba *«dünya»* ve')
  })

  it('keeps surrounding spaces outside the markers', () => {
    check(toggleBold, 'Merhaba« dünya »ve', 'Merhaba **«dünya»** ve')
  })

  it('unwraps when the markers are right around the selection', () => {
    check(toggleBold, 'Merhaba **«dünya»** ve', 'Merhaba «dünya» ve')
    check(toggleItalic, 'Merhaba _«dünya»_ ve', 'Merhaba «dünya» ve')
  })

  it('unwraps when the selection includes the markers', () => {
    check(toggleBold, 'Merhaba «**dünya**» ve', 'Merhaba «dünya» ve')
  })

  it('tells bold and italic apart', () => {
    check(toggleItalic, '**«kalın»**', '***«kalın»***')
    check(toggleBold, '*«italik»*', '***«italik»***')
    check(toggleItalic, '***«ikisi»***', '**«ikisi»**')
    check(toggleBold, '***«ikisi»***', '*«ikisi»*')
  })

  it('wraps the word under the cursor', () => {
    check(toggleBold, 'Merhaba dü|nya', 'Merhaba **dü|nya**')
  })

  it('inserts an empty pair at a word boundary and removes it again', () => {
    check(toggleBold, 'Merhaba |', 'Merhaba **|**')
    check(toggleBold, 'Merhaba **|**', 'Merhaba |')
    check(toggleItalic, 'a |b', 'a *|*b')
  })

  it('removes the markers of the emphasis around the cursor', () => {
    check(toggleBold, 'Bir **kalın| kelime** var', 'Bir kalın| kelime var')
    check(toggleItalic, 'Bir *eğik |yazı* var', 'Bir eğik |yazı var')
  })

  it('works on every selection range', () => {
    expect(runCommand(toggleBold, 'a «b» c')).toBe('a **«b»** c')
  })
})

describe('headings', () => {
  it('sets, changes and removes a heading', () => {
    check(setHeading(2), 'Başlık|', '## Başlık|')
    check(setHeading(3), '## Baş|lık', '### Baş|lık')
    check(setHeading(0), '### |Başlık', '|Başlık')
    check(setHeading(2), '## Başlık|', null)
  })

  it('puts the cursor after a new prefix', () => {
    check(setHeading(1), '|Başlık', '# |Başlık')
  })

  it('keeps blockquote markers', () => {
    check(setHeading(2), '> Alıntı başlığı|', '> ## Alıntı başlığı|')
    check(setHeading(0), '> ## Alıntı|', '> Alıntı|')
  })

  it('skips blank lines in a multi-line selection', () => {
    check(setHeading(2), '«Bir\n\nİki»', '## «Bir\n\n## İki»')
  })

  it('cycles paragraph → H1 … H6 → paragraph', () => {
    check(cycleHeading, 'Metin|', '# Metin|')
    check(cycleHeading, '# Metin|', '## Metin|')
    check(cycleHeading, '###### Metin|', 'Metin|')
  })

  it('reads heading levels', () => {
    expect(headingLevel('### Üç')).toBe(3)
    expect(headingLevel('> # Bir')).toBe(1)
    expect(headingLevel('#Etiket')).toBe(0)
    expect(headingLevel('Düz')).toBe(0)
  })
})

describe('toggleBlockquote', () => {
  it('quotes and unquotes lines', () => {
    check(toggleBlockquote, 'Alıntı|', '> Alıntı|')
    check(toggleBlockquote, '> Alıntı|', 'Alıntı|')
    check(toggleBlockquote, '«Bir\n\nİki»', '> «Bir\n>\n> İki»')
    check(toggleBlockquote, '«> Bir\n>\n> İki»', '«Bir\n\nİki»')
  })

  it('gives an empty line a marker and a space', () => {
    check(toggleBlockquote, 'a\n\n|', 'a\n\n> |')
  })
})

describe('insertAlert', () => {
  it('inserts after the current paragraph with blank lines around', () => {
    check(insertAlert('note'), 'Bir| paragraf\nikinci satır.\n\nSonraki.', 'Bir paragraf\nikinci satır.\n\n> [!NOTE]\n> |\n\nSonraki.')
  })

  it('replaces an empty line between paragraphs', () => {
    check(insertAlert('warning'), 'Önce.\n|\nSonra.', 'Önce.\n\n> [!WARNING]\n> |\n\nSonra.')
    check(insertAlert('tip'), 'Önce.\n\n|\n\nSonra.', 'Önce.\n\n> [!TIP]\n> |\n\nSonra.')
  })

  it('inserts at the end and into an empty document', () => {
    check(insertAlert('caution'), 'Son satır.|', 'Son satır.\n\n> [!CAUTION]\n> |')
    check(insertAlert('important'), '|', '> [!IMPORTANT]\n> |')
  })

  it('wraps selected lines', () => {
    check(insertAlert('note'), 'Önce.\n«Bir\n\nİki»\nSonra.', 'Önce.\n\n> [!NOTE]\n> «Bir\n>\n> İki»\n\nSonra.')
  })

  it('turns a selected blockquote into an alert', () => {
    check(insertAlert('tip'), '«> Alıntı»', '> [!TIP]\n«> Alıntı»')
  })

  it('changes the type of the alert at the cursor', () => {
    check(insertAlert('warning'), '> [!NOTE]\n> Met|in', '> [!WARNING]\n> Met|in')
    check(setAlertType('caution'), '> [!note] Başlık\n> Met|in', '> [!CAUTION] Başlık\n> Met|in')
    check(setAlertType('tip'), 'Alert değil|', null)
  })
})

describe('insertRtlBlock', () => {
  it('inserts the block with blank lines inside and puts the cursor on the content line', () => {
    check(
      insertRtlBlock,
      'Merhaba dünya.|',
      'Merhaba dünya.\n\n<div dir="rtl" style="text-align: center;">\n\n|\n\n</div>',
    )
    check(
      insertRtlBlock,
      'Önce.\n|\nSonra.',
      'Önce.\n\n<div dir="rtl" style="text-align: center;">\n\n|\n\n</div>\n\nSonra.',
    )
  })

  it('wraps selected lines', () => {
    check(
      insertRtlBlock,
      'Önce.\n\n«مرحبا بالعالم»\n\nSonra.',
      'Önce.\n\n<div dir="rtl" style="text-align: center;">\n\n«مرحبا بالعالم»\n\n</div>\n\nSonra.',
    )
  })
})

describe('insertLink', () => {
  it('wraps the selection and waits for the URL', () => {
    check(insertLink(), 'Bir «bağlantı» var', 'Bir [bağlantı](|) var')
    check(insertLink({ url: 'https://example.com' }), 'Bir «bağlantı» var', 'Bir [bağlantı](https://example.com)| var')
  })

  it('inserts an empty link', () => {
    check(insertLink(), 'Metin |', 'Metin [|]()')
    check(insertLink({ text: 'örnek' }), 'Metin |', 'Metin [örnek](|)')
    check(insertLink({ text: 'örnek', url: '/yazilar/' }), 'Metin |', 'Metin [örnek](/yazilar/)|')
  })
})

describe('insertHorizontalRule', () => {
  it('inserts a rule as its own block', () => {
    check(insertHorizontalRule, 'Paragraf|\n\nSonraki.', 'Paragraf\n\n---|\n\nSonraki.')
    check(insertHorizontalRule, 'Paragraf\n|\nSonraki.', 'Paragraf\n\n---|\n\nSonraki.')
  })

  it('never starts the body with ---', () => {
    check(insertHorizontalRule, '|\nMetin.', '***|\n\nMetin.')
  })
})
