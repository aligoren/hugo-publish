import { describe, expect, it } from 'vitest'
import {
  formatShortcodeValue,
  parseShortcodeTag,
  resolveShortcodeValues,
  shortcodeArgEdits,
  shortcodeFieldValues,
  shortcodeSkeleton,
  type ShortcodeValues,
} from './shortcodeArgs'
import { BUILTIN_SHORTCODES } from './shortcodeDefs'

const def = (name: string) => BUILTIN_SHORTCODES.find((d) => d.name === name)!

function args(text: string) {
  const tag = parseShortcodeTag(text)!
  return tag.args.map((a) => (a.name === null ? '' : a.name + '=') + `${a.quote ?? ''}${a.value}${a.quote ?? ''}`)
}

/** Applies the edits for `target` to `text`. */
function edit(text: string, target: ShortcodeValues, name?: string) {
  const tag = parseShortcodeTag(text)!
  const edits = shortcodeArgEdits(text, tag, target, name ? def(name) : null)
  let out = text
  for (const e of [...edits].reverse()) out = out.slice(0, e.from) + e.insert + out.slice(e.to)
  return out
}

describe('parseShortcodeTag', () => {
  it('reads positional, named, quoted and raw values', () => {
    expect(args('{{< youtube 0RKpf3rK57I >}}')).toEqual(['0RKpf3rK57I'])
    expect(args('{{< highlight go "linenos=table,hl_lines=2" >}}')).toEqual(['go', '"linenos=table,hl_lines=2"'])
    expect(args('{{< figure src="/a b.jpg" alt=`x "y"` width=300 >}}')).toEqual(['src="/a b.jpg"', 'alt=`x "y"`', 'width=300'])
    expect(args('{{% details summary = "Ayrıntı" open=true %}}')).toEqual(['summary="Ayrıntı"', 'open=true'])
  })

  it('unescapes quotes and keeps >}} inside quotes', () => {
    const tag = parseShortcodeTag('{{< figure caption="Bir \\"alıntı\\" >}} burada" >}}')!
    expect(tag.args[0].value).toBe('Bir "alıntı" >}} burada')
  })

  it('reports kind, style and positions with an offset', () => {
    const text = '{{< figure\n  src="/img/uzun.jpg"\n  alt="x"\n/>}}'
    const tag = parseShortcodeTag(text, 100)!
    expect(tag.kind).toBe('selfClosing')
    expect(tag.style).toBe('named')
    expect([tag.nameFrom, tag.nameTo]).toEqual([104, 110])
    expect(text.slice(tag.args[1].valueFrom - 100, tag.args[1].valueTo - 100)).toBe('"x"')
    expect(tag.argsEnd).toBe(100 + text.indexOf('"x"') + 3)
    expect(parseShortcodeTag('{{< /details >}}')!.kind).toBe('closing')
    expect(parseShortcodeTag('{{< x a b=c >}}')!.style).toBe('mixed')
    expect(parseShortcodeTag('{{< x >}}')!.style).toBe('none')
    expect(parseShortcodeTag('{{< x/>}}')!.kind).toBe('selfClosing')
  })

  it('keeps slashes in bare values apart from the self-closing marker', () => {
    expect(args('{{< ref /posts/a.md />}}')).toEqual(['/posts/a.md'])
  })

  it('rejects incomplete tags', () => {
    expect(parseShortcodeTag('{{< x "a >}}')).toBe(null)
    expect(parseShortcodeTag('{{ x }}')).toBe(null)
    expect(parseShortcodeTag('{{< >}}')).toBe(null)
  })
})

describe('formatShortcodeValue', () => {
  it('quotes new values and keeps the previous style when possible', () => {
    expect(formatShortcodeValue('a "b"', undefined, 'none')).toBe('"a \\"b\\""')
    expect(formatShortcodeValue('go', undefined, null)).toBe('go')
    expect(formatShortcodeValue('a b', undefined, null)).toBe('"a b"')
    expect(formatShortcodeValue('x', undefined, '`')).toBe('`x`')
    expect(formatShortcodeValue('true', 'boolean', 'none')).toBe('true')
    expect(formatShortcodeValue('12', 'number', '"')).toBe('12')
    expect(formatShortcodeValue('yes', 'boolean', 'none')).toBe('"yes"')
  })
})

describe('shortcodeArgEdits', () => {
  it('changes only the edited value, keeping quote style and spacing', () => {
    expect(
      edit('{{< figure  src="/a.jpg"   alt=`eski` >}}', { style: 'named', values: [['src', '/a.jpg'], ['alt', 'yeni']] }, 'figure'),
    ).toBe('{{< figure  src="/a.jpg"   alt=`yeni` >}}')
  })

  it('removes emptied parameters with the space before them', () => {
    expect(edit('{{< figure src="a" alt="b" caption="c" >}}', { style: 'named', values: [['alt', '']] })).toBe(
      '{{< figure src="a" caption="c" >}}',
    )
  })

  it('appends new parameters after the last one, on its own line in multi-line tags', () => {
    expect(edit('{{< figure src="a" >}}', { style: 'named', values: [['src', 'a'], ['alt', 'Türkçe “metin”']] })).toBe(
      '{{< figure src="a" alt="Türkçe “metin”" >}}',
    )
    expect(edit('{{< figure >}}', { style: 'named', values: [['src', 'a']] })).toBe('{{< figure src="a" >}}')
    expect(edit('{{< figure\n  src="a"\n>}}', { style: 'named', values: [['src', 'a'], ['alt', 'b']] })).toBe(
      '{{< figure\n  src="a"\n  alt="b"\n>}}',
    )
  })

  it('writes typed values bare', () => {
    expect(edit('{{< youtube id="x" >}}', { style: 'named', values: [['id', 'x'], ['autoplay', 'true'], ['start', '30']] }, 'youtube')).toBe(
      '{{< youtube id="x" autoplay=true start=30 >}}',
    )
  })

  it('edits positional values and drops trailing empty ones', () => {
    expect(edit('{{< highlight go "linenos=table" >}}', { style: 'positional', values: ['python', 'linenos=table'] })).toBe(
      '{{< highlight python "linenos=table" >}}',
    )
    expect(edit('{{< highlight go "linenos=table" >}}', { style: 'positional', values: ['go', ''] })).toBe('{{< highlight go >}}')
    expect(edit('{{< highlight go >}}', { style: 'positional', values: ['go', 'hl_lines=2'] })).toBe('{{< highlight go "hl_lines=2" >}}')
    expect(edit('{{< x a b c >}}', { style: 'positional', values: ['a', '', 'c'] })).toBe('{{< x a "" c >}}')
  })

  it('rewrites the arguments when the style changes, keeping delimiters and self-closing', () => {
    expect(edit('{{% youtube abc /%}}', { style: 'named', values: [['id', 'abc'], ['title', 'Video']] }, 'youtube')).toBe(
      '{{% youtube id="abc" title="Video" /%}}',
    )
    expect(edit('{{< youtube id="abc" >}}', { style: 'positional', values: ['abc'] }, 'youtube')).toBe('{{< youtube abc >}}')
  })

  it('returns no edits when nothing changed', () => {
    const text = '{{< figure src="a" alt="b" >}}'
    const tag = parseShortcodeTag(text)!
    expect(shortcodeArgEdits(text, tag, { style: 'named', values: [['src', 'a'], ['alt', 'b']] })).toEqual([])
  })
})

describe('form values', () => {
  it('maps arguments to parameters, positional or named, and keeps unlisted ones', () => {
    const tag = parseShortcodeTag('{{< youtube abc >}}')!
    const fields = shortcodeFieldValues(tag, def('youtube'))
    expect(fields.find((f) => f.param?.name === 'id')!.value).toBe('abc')
    const extra = shortcodeFieldValues(parseShortcodeTag('{{< figure src="a" data="z" >}}')!, def('figure'))
    expect(extra.at(-1)).toEqual({ param: null, name: 'data', index: null, value: 'z' })
  })

  it('chooses the style to write', () => {
    const youtube = def('youtube')
    const positionalTag = parseShortcodeTag('{{< youtube abc >}}')!
    const fields = shortcodeFieldValues(positionalTag, youtube)
    expect(resolveShortcodeValues(fields, positionalTag, youtube).values).toEqual({ style: 'positional', values: ['abc'] })
    // A named-only parameter forces named style.
    const withStart = fields.map((f) => (f.param?.name === 'start' ? { ...f, value: '10' } : f))
    const resolved = resolveShortcodeValues(withStart, positionalTag, youtube).values!
    expect(resolved.style).toBe('named')
    expect(resolved.values).toContainEqual(['start', '10'])
    // Positional-only plus named-only cannot be combined.
    const mixed = [
      { param: null, name: null, index: 0, value: 'a' },
      { param: null, name: 'k', index: null, value: 'b' },
    ]
    expect(resolveShortcodeValues(mixed, positionalTag, null).error).toBe('mixed')
    // An empty highlight tag is positional; an empty figure tag is named.
    const highlight = def('highlight')
    expect(resolveShortcodeValues(shortcodeFieldValues(parseShortcodeTag('{{< highlight >}}')!, highlight), parseShortcodeTag('{{< highlight >}}')!, highlight).values!.style).toBe('positional')
  })
})

describe('shortcodeSkeleton', () => {
  it('builds tags with required parameters and closing tags', () => {
    expect(shortcodeSkeleton(def('figure'))).toEqual({ lines: ['{{< figure src="" >}}'], cursorLine: 0, cursorColumn: 16 })
    expect(shortcodeSkeleton(def('youtube')).lines).toEqual(['{{< youtube "" >}}'])
    expect(shortcodeSkeleton(def('x')).lines).toEqual(['{{< x user="" id="" >}}'])
    expect(shortcodeSkeleton(def('details'))).toEqual({ lines: ['{{< details >}}', '', '{{< /details >}}'], cursorLine: 1, cursorColumn: 0 })
    expect(shortcodeSkeleton(def('highlight'), '%').lines).toEqual(['{{% highlight "" %}}', '', '{{% /highlight %}}'])
  })
})
