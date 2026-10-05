// @vitest-environment jsdom
import { EditorView } from '@codemirror/view'
import { afterEach, describe, expect, it } from 'vitest'
import { editorHost } from './host'
import { convertPastedHtml, escapeMarkdownText, htmlToMarkdown } from './pasteHtml'
import { createEditorState } from './setup'

const WORD = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">
<head><meta name=Generator content="Microsoft Word 15"><style><!-- p.MsoNormal {mso-style-parent:""; margin:0cm;} --></style>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Normal</w:View></w:WordDocument></xml><![endif]--></head>
<body lang=TR style='tab-interval:35.4pt'>
<!--StartFragment-->
<h1 style='mso-margin-top-alt:auto'><span style='mso-fareast-font-family:"Times New Roman"'>İstanbul’un Tarihi<o:p></o:p></span></h1>
<p class=MsoNormal>Bu <b><span style='mso-bidi-font-weight:normal'>kalın</span></b> ve <i>eğik</i> bir “alıntı” içeren&nbsp;paragraf.<o:p></o:p></p>
<p class=MsoListParagraphCxSpFirst style='text-indent:-18.0pt;mso-list:l0 level1 lfo1'><![if !supportLists]><span style='font-family:Symbol'><span style='mso-list:Ignore'>·<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;&nbsp;&nbsp; </span></span></span><![endif]>Birinci madde<o:p></o:p></p>
<p class=MsoListParagraphCxSpMiddle style='margin-left:72.0pt;text-indent:-18.0pt;mso-list:l0 level2 lfo1'><![if !supportLists]><span style='font-family:"Courier New"'><span style='mso-list:Ignore'>o<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp; </span></span></span><![endif]>İç madde<o:p></o:p></p>
<p class=MsoListParagraphCxSpLast style='text-indent:-18.0pt;mso-list:l0 level1 lfo1'><![if !supportLists]><span style='font-family:Symbol'><span style='mso-list:Ignore'>·<span>&nbsp; </span></span></span><![endif]>İkinci madde<o:p></o:p></p>
<p class=MsoListParagraph style='mso-list:l1 level1 lfo2'><![if !supportLists]><span style='mso-list:Ignore'>1.<span>&nbsp; </span></span><![endif]>Sıralı<o:p></o:p></p>
<p class=MsoNormal><a href="https://example.com/a b">bağlantı</a> ve <img src="file:///C:/Users/x/AppData/Local/Temp/msohtmlclip1/01/clip_image001.png" alt="Resim"></p>
<!--EndFragment-->
</body></html>`

const GOOGLE_DOCS = `<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1a2b3c4d-7fff-1234-5678-9abcdef01234"><h2 dir="ltr" style="line-height:1.38;margin-top:18pt;margin-bottom:6pt;"><span style="font-size:16pt;font-family:Arial,sans-serif;color:#000000;font-weight:700;">Başlık</span></h2><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;"><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;">Normal </span><span style="font-size:11pt;font-family:Arial,sans-serif;font-weight:700;">kalın</span><span style="font-size:11pt;font-weight:700;"> devam</span><span style="font-size:11pt;font-weight:400;">, </span><span style="font-size:11pt;font-style:italic;">eğik</span><span style="font-size:11pt;text-decoration:line-through;">silik</span></p><ul style="margin-top:0;margin-bottom:0;padding-inline-start:48px;"><li dir="ltr" style="list-style-type:disc;" aria-level="1"><p dir="ltr" role="presentation"><span style="font-size:11pt;">Bir</span></p></li><ul><li dir="ltr" style="list-style-type:circle;" aria-level="2"><p dir="ltr" role="presentation"><span>İç</span></p></li></ul><li dir="ltr" aria-level="1"><p dir="ltr" role="presentation"><span>İki</span></p></li></ul><br><div dir="ltr" style="margin-left:0pt;" align="left"><table style="border:none;border-collapse:collapse;"><colgroup><col width="100"><col width="100"></colgroup><tbody><tr style="height:0pt"><td><p dir="ltr"><span style="font-weight:700;">Şehir</span></p></td><td><p dir="ltr"><span>Nüfus | yaklaşık</span></p></td></tr><tr><td><p dir="ltr"><span>İzmir</span></p></td><td><p dir="ltr"><span>4</span></p></td></tr></tbody></table></div></b>`

describe('htmlToMarkdown', () => {
  it('converts Word HTML and drops its markup', () => {
    expect(htmlToMarkdown(WORD)).toBe(
      [
        '# İstanbul’un Tarihi',
        '',
        'Bu **kalın** ve *eğik* bir “alıntı” içeren paragraf.',
        '',
        '-   Birinci madde',
        '    -   İç madde',
        '-   İkinci madde',
        '',
        '1.  Sıralı',
        '',
        '[bağlantı](<https://example.com/a b>) ve Resim',
      ].join('\n'),
    )
  })

  it('converts Google Docs HTML: styled spans, nested lists, tables', () => {
    expect(htmlToMarkdown(GOOGLE_DOCS)).toBe(
      [
        '## Başlık',
        '',
        'Normal **kalın devam**, *eğik*~~silik~~',
        '',
        '-   Bir',
        '    -   İç',
        '-   İki',
        '',
        '| **Şehir** | Nüfus \\| yaklaşık |',
        '| --- | --- |',
        '| İzmir | 4 |',
      ].join('\n'),
    )
  })

  it('converts web HTML: links, quotes, code, images', () => {
    const html =
      '<h3>Not</h3><blockquote><p>Bir <a href="/yazi/" title="Yazı">alıntı</a></p></blockquote><pre><code>x := 1\n</code></pre><p><img src="/img/a.png" alt="A [1]"><br>Satır</p>'
    expect(htmlToMarkdown(html)).toBe('### Not\n\n> Bir [alıntı](/yazi/ "Yazı")\n\n```\nx := 1\n```\n\n![A \\[1\\]](/img/a.png)\\\nSatır')
  })

  it('returns null for HTML without formatting (code editors, plain paragraphs)', () => {
    const vscode = '<meta charset="utf-8"><div style="color: #d4d4d4;background-color: #1e1e1e;white-space: pre;"><div><span style="color: #569cd6;">const</span> x = 1</div></div>'
    expect(htmlToMarkdown(vscode)).toBe(null)
    expect(htmlToMarkdown('<p>Sadece metin</p><p>ikinci</p>')).toBe(null)
    expect(htmlToMarkdown('')).toBe(null)
  })

  it('keeps Turkish quotes, apostrophes and placeholders untouched', () => {
    expect(htmlToMarkdown('<p><strong>Ankara’nın</strong> “başkent” [buraya yaz] ve snake_case</p>')).toBe(
      '**Ankara’nın** “başkent” [buraya yaz] ve snake_case',
    )
  })
})

describe('escapeMarkdownText', () => {
  it('escapes only what Markdown would read as syntax', () => {
    expect(escapeMarkdownText('a*b `c` _d_ e_f [g](h) {{< x >}}')).toBe('a\\*b \\`c\\` \\_d\\_ e_f [g\\](h) {{\\< x >}}')
    expect(escapeMarkdownText('# başlık değil')).toBe('\\# başlık değil')
    expect(escapeMarkdownText('1. madde değil')).toBe('1\\. madde değil')
    expect(escapeMarkdownText('C:\\Users ve \\*')).toBe('C:\\Users ve \\\\\\*')
  })
})

describe('paste handler', () => {
  const views: EditorView[] = []
  afterEach(() => views.splice(0).forEach((v) => v.destroy()))

  function paste(view: EditorView, data: Record<string, string>) {
    const event = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'clipboardData', { value: { getData: (type: string) => data[type] ?? '', files: [], types: Object.keys(data) } })
    view.contentDOM.dispatchEvent(event)
    return event.defaultPrevented
  }

  it('inserts converted Markdown with the document line ending', () => {
    const view = new EditorView({ state: createEditorState('Önce\r\n', { eol: 'crlf' }), parent: document.body })
    views.push(view)
    view.dispatch({ selection: { anchor: view.state.doc.length } })
    expect(paste(view, { 'text/html': '<h2>Başlık</h2><p><b>kalın</b></p>', 'text/plain': 'Başlık\nkalın' })).toBe(true)
    expect(view.state.sliceDoc()).toBe('Önce\r\n## Başlık\r\n\r\n**kalın**')
  })

  it('leaves plain HTML, code blocks and the disabled option to the normal paste', () => {
    const view = new EditorView({
      state: createEditorState('```\n\n```', { eol: 'lf' }, undefined, editorHost.of({ pasteHtmlAsMarkdown: true })),
      parent: document.body,
    })
    views.push(view)
    view.dispatch({ selection: { anchor: 4 } })
    // CodeMirror's own paste handler then inserts the plain text.
    paste(view, { 'text/html': '<b>x</b>', 'text/plain': 'x' })
    expect(view.state.sliceDoc()).toBe('```\nx\n```')
    const off = new EditorView({ state: createEditorState('', {}, undefined, editorHost.of({ pasteHtmlAsMarkdown: false })), parent: document.body })
    views.push(off)
    paste(off, { 'text/html': '<b>x</b>', 'text/plain': 'x' })
    expect(off.state.sliceDoc()).toBe('x')
    const plain = new EditorView({ state: createEditorState(''), parent: document.body })
    views.push(plain)
    paste(plain, { 'text/html': '<div style="white-space: pre"><span>const x = 1</span></div>', 'text/plain': 'const x = 1' })
    expect(plain.state.sliceDoc()).toBe('const x = 1')
  })
})

describe('pasted tables', () => {
  it('joins multi-line cells with <br>, escapes pipes and takes an all-bold first row as the header', () => {
    const html = '<table><tr><td><b>Ad</b></td><td><strong>Not</strong></td></tr><tr><td><p>Bir</p><p>iki</p></td><td>a<br>b | c</td></tr></table>'
    expect(htmlToMarkdown(html)).toBe(['| Ad | Not |', '| --- | --- |', '| Bir<br>iki | a<br>b \\| c |'].join('\n'))
  })

  it('uses the first row as the header without <th>, and keeps bold that is not the whole row', () => {
    expect(htmlToMarkdown('<table><tr><td>a</td><td>b</td></tr><tr><td>1</td><td>2</td></tr></table>')).toBe('| a | b |\n| --- | --- |\n| 1 | 2 |')
    expect(htmlToMarkdown('<table><tr><td><b>a</b></td><td>b</td></tr><tr><td>1</td><td>2</td></tr></table>')).toBe(
      '| **a** | b |\n| --- | --- |\n| 1 | 2 |',
    )
  })

  it('expands colspan and rowspan and keeps column alignment', () => {
    const html =
      '<table><thead><tr><th align="center">A</th><th style="text-align: right">B</th><th>C</th></tr></thead>' +
      '<tbody><tr><td colspan="2">geniş</td><td rowspan="2">uzun</td></tr><tr><td>x</td><td>y</td></tr></tbody></table>'
    expect(htmlToMarkdown(html)).toBe(['| A | B | C |', '| :-: | --: | --- |', '| geniş |  | uzun |', '| x | y |  |'].join('\n'))
  })
})

describe('pasted images', () => {
  const PNG = 'data:image/png;base64,iVBORw0KGgo='
  const HTML =
    `<p>Önce <img src="${PNG}" alt="Kedi [1]"> sonra</p>` +
    '<p><img src="data:image/gif;base64,R0lGODlh" title="Logo"><img src="file:///C:/x/clip_image001.png" alt="Klip">' +
    '<img src="https://example.com/a.png" alt="Uzak"></p>'

  it('marks embedded images with their alt text, counts local ones and keeps remote ones as links', () => {
    const pasted = convertPastedHtml(HTML)!
    expect(pasted.markdown).toBe('Önce Kedi [1] sonra\n\nKlip![Uzak](https://example.com/a.png)')
    expect(pasted.images.map(({ offset, placeholder, alt, title }) => ({ offset, placeholder, alt, title }))).toEqual([
      { offset: 5, placeholder: 'Kedi [1]', alt: 'Kedi [1]', title: '' },
      { offset: 21, placeholder: '', alt: '', title: 'Logo' },
    ])
    expect(pasted.images[0].src).toBe(PNG)
    expect(pasted.localImages).toBe(1)
    expect(htmlToMarkdown(HTML)).toBe(pasted.markdown)
    // An image alone is still worth converting (it can be imported).
    expect(convertPastedHtml(`<img src="${PNG}">`)).toMatchObject({ markdown: '', images: [{ offset: 0 }] })
    expect(htmlToMarkdown(`<img src="${PNG}">`)).toBe(null)
  })
})
