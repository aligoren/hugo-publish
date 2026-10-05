// A small, offline preview of Chroma styles: the main colors of well-known styles (taken from
// Chroma's style files, rounded to the token classes the sample uses) and a tiny tokenizer for a
// fixed Go snippet. Hugo renders with the real style; this is only a hint of how it will look.

export type TokenKind = 'keyword' | 'string' | 'comment' | 'number' | 'function' | 'text'

export interface StylePalette {
  background: string
  text: string
  keyword: string
  string: string
  comment: string
  number: string
  function: string
  /** Chroma marks these italic or bold in the style file. */
  italicComments?: boolean
  boldKeywords?: boolean
}

type Row = [bg: string, text: string, keyword: string, str: string, comment: string, num: string, fn: string, flags?: string]

// flags: i = italic comments, b = bold keywords.
const ROWS: Record<string, Row> = {
  monokai: ['#272822', '#f8f8f2', '#66d9ef', '#e6db74', '#75715e', '#ae81ff', '#a6e22e'],
  monokailight: ['#fafafa', '#272822', '#00a8c8', '#d88200', '#75715e', '#ae81ff', '#75af00'],
  github: ['#ffffff', '#1f2328', '#cf222e', '#0a3069', '#57606a', '#0550ae', '#6639ba'],
  'github-dark': ['#0d1117', '#e6edf3', '#ff7b72', '#a5d6ff', '#8b949e', '#a5d6ff', '#d2a8ff', 'i'],
  dracula: ['#282a36', '#f8f8f2', '#ff79c6', '#f1fa8c', '#6272a4', '#bd93f9', '#50fa7b'],
  nord: ['#2e3440', '#d8dee9', '#81a1c1', '#a3be8c', '#616e87', '#b48ead', '#88c0d0', 'ib'],
  'solarized-dark': ['#002b36', '#93a1a1', '#719e07', '#2aa198', '#586e75', '#2aa198', '#268bd2'],
  'solarized-dark256': ['#1c1c1c', '#8a8a8a', '#5f8700', '#00afaf', '#4e4e4e', '#00afaf', '#0087ff'],
  'solarized-light': ['#eee8d5', '#586e75', '#859900', '#2aa198', '#93a1a1', '#2aa198', '#268bd2'],
  'catppuccin-latte': ['#eff1f5', '#4c4f69', '#8839ef', '#40a02b', '#9ca0b0', '#fe640b', '#1e66f5', 'i'],
  'catppuccin-frappe': ['#303446', '#c6d0f5', '#ca9ee6', '#a6d189', '#737994', '#ef9f76', '#8caaee', 'i'],
  'catppuccin-macchiato': ['#24273a', '#cad3f5', '#c6a0f6', '#a6da95', '#6e738d', '#f5a97f', '#8aadf4', 'i'],
  'catppuccin-mocha': ['#1e1e2e', '#cdd6f4', '#cba6f7', '#a6e3a1', '#6c7086', '#fab387', '#89b4fa', 'i'],
  onedark: ['#282c34', '#abb2bf', '#c678dd', '#98c379', '#7f848e', '#d19a66', '#61afef', 'i'],
  'doom-one': ['#282c34', '#bbc2cf', '#c678dd', '#98be65', '#5b6268', '#da8548', '#c678dd'],
  gruvbox: ['#282828', '#ebdbb2', '#fb4934', '#b8bb26', '#928374', '#d3869b', '#fabd2f', 'i'],
  'gruvbox-light': ['#fbf1c7', '#3c3836', '#9d0006', '#79740e', '#928374', '#8f3f71', '#b57614', 'i'],
  darcula: ['#2b2b2b', '#a9b7c6', '#cc7832', '#6a8759', '#808080', '#6897bb', '#ffc66d', 'i'],
  vs: ['#ffffff', '#000000', '#0000ff', '#a31515', '#008000', '#000000', '#000000'],
  xcode: ['#ffffff', '#000000', '#a90d91', '#c41a16', '#177500', '#1c01ce', '#000000'],
  'xcode-dark': ['#1f1f24', '#ffffff', '#fc5fa3', '#fc6a5d', '#6c7986', '#d0bf69', '#ffffff'],
  emacs: ['#f8f8f8', '#000000', '#aa22ff', '#bb4444', '#008800', '#666666', '#00a000', 'ib'],
  friendly: ['#f0f0f0', '#000000', '#007020', '#4070a0', '#60a0b0', '#40a070', '#06287e', 'ib'],
  'paraiso-dark': ['#2f1e2e', '#e7e9db', '#815ba4', '#48b685', '#776e71', '#f99b15', '#06b6ef'],
  'paraiso-light': ['#e7e9db', '#2f1e2e', '#815ba4', '#48b685', '#8d8687', '#f99b15', '#06b6ef'],
  rrt: ['#000000', '#dddddd', '#ff0000', '#87ceeb', '#00ff00', '#ff00ff', '#ffff00'],
  native: ['#202020', '#d0d0d0', '#6ab825', '#ed9d13', '#999999', '#3677a9', '#447fcf', 'ib'],
  pygments: ['#f8f8f8', '#000000', '#008000', '#ba2121', '#3d7b7b', '#666666', '#0000ff', 'ib'],
  tango: ['#f8f8f8', '#000000', '#204a87', '#4e9a06', '#8f5902', '#0000cf', '#000000', 'ib'],
  'tokyonight-night': ['#1a1b26', '#c0caf5', '#bb9af7', '#9ece6a', '#565f89', '#ff9e64', '#7aa2f7', 'i'],
  'tokyonight-storm': ['#24283b', '#c0caf5', '#bb9af7', '#9ece6a', '#565f89', '#ff9e64', '#7aa2f7', 'i'],
  'tokyonight-moon': ['#222436', '#c8d3f5', '#c099ff', '#c3e88d', '#636da6', '#ff966c', '#82aaff', 'i'],
  'tokyonight-day': ['#e1e2e7', '#3760bf', '#9854f1', '#587539', '#848cb5', '#b15c00', '#2e7de9', 'i'],
  'rose-pine': ['#191724', '#e0def4', '#31748f', '#f6c177', '#6e6a86', '#ebbcba', '#ebbcba', 'i'],
  'rose-pine-moon': ['#232136', '#e0def4', '#3e8fb0', '#f6c177', '#6e6a86', '#ea9a97', '#ea9a97', 'i'],
  'rose-pine-dawn': ['#faf4ed', '#575279', '#286983', '#ea9d34', '#9893a5', '#d7827e', '#d7827e', 'i'],
  vim: ['#000000', '#cccccc', '#cdcd00', '#cd0000', '#000080', '#cd00cd', '#cccccc'],
  'modus-operandi': ['#ffffff', '#000000', '#5317ac', '#2544bb', '#505050', '#0000c0', '#721045'],
  'modus-vivendi': ['#000000', '#ffffff', '#b6a0ff', '#79a8ff', '#a8a8a8', '#00bcff', '#feacd0'],
  'kanagawa-wave': ['#1f1f28', '#dcd7ba', '#957fb8', '#98bb6c', '#727169', '#d27e99', '#7e9cd8', 'i'],
  'kanagawa-dragon': ['#181616', '#c5c9c5', '#8992a7', '#8a9a7b', '#737c73', '#a292a3', '#8ba4b0', 'i'],
  'kanagawa-lotus': ['#f2ecbc', '#545464', '#624c83', '#6f894e', '#8a8980', '#b35b79', '#4d699b', 'i'],
  witchhazel: ['#433e56', '#f8f8f2', '#c2ffdf', '#1bc5e0', '#b0bec5', '#c5a3ff', '#ceb1ff', 'i'],
  autumn: ['#ffffff', '#000000', '#0000aa', '#aa5500', '#aaaaaa', '#009999', '#00aa00', 'i'],
  borland: ['#ffffff', '#000000', '#000080', '#0000ff', '#008800', '#0000ff', '#000000', 'ib'],
  colorful: ['#ffffff', '#000000', '#008800', '#dd2200', '#888888', '#0000dd', '#0066bb', 'b'],
  manni: ['#f0f3f3', '#000000', '#006699', '#cc3300', '#0099ff', '#ff6600', '#cc00ff', 'ib'],
  murphy: ['#ffffff', '#000000', '#228899', '#dd2200', '#666666', '#6600ee', '#55eedd', 'ib'],
  perldoc: ['#eeeedd', '#000000', '#8b008b', '#cd5555', '#228b22', '#b452cd', '#008b45', 'b'],
  trac: ['#ffffff', '#000000', '#000000', '#bb8844', '#999988', '#009999', '#990000', 'ib'],
  bw: ['#ffffff', '#000000', '#000000', '#000000', '#000000', '#000000', '#000000', 'ib'],
  fruity: ['#111111', '#ffffff', '#fb660a', '#0086d2', '#008800', '#0086f7', '#ff0086', 'ib'],
  vulcan: ['#282c34', '#c9c9c9', '#7fbaf5', '#cf5967', '#3e4460', '#56b6c2', '#bc74c4', 'i'],
}

export function chromaPalette(style: string): StylePalette | null {
  const row = ROWS[style.toLowerCase()]
  if (!row) return null
  const [background, text, keyword, string, comment, number, fn, flags = ''] = row
  return { background, text, keyword, string, comment, number, function: fn, italicComments: flags.includes('i'), boldKeywords: flags.includes('b') }
}

export function hasPalette(style: string): boolean {
  return style.toLowerCase() in ROWS
}

export const SAMPLE_CODE = `// greet returns a friendly message.
func greet(name string, times int) string {
\tif times > 3 {
\t\treturn "Hello, " + name + "!"
\t}
\treturn fmt.Sprintf("Hi %s", name)
}
`

const KEYWORDS = new Set([
  'break',
  'case',
  'const',
  'continue',
  'default',
  'else',
  'for',
  'func',
  'go',
  'if',
  'import',
  'int',
  'nil',
  'package',
  'range',
  'return',
  'string',
  'struct',
  'switch',
  'true',
  'false',
  'type',
  'var',
])

export interface Token {
  kind: TokenKind
  text: string
}

/** Splits Go-like code into colored tokens; whitespace and punctuation are plain text. */
export function tokenize(code: string): Token[] {
  const out: Token[] = []
  const push = (kind: TokenKind, text: string) => {
    const last = out[out.length - 1]
    if (last && last.kind === kind && kind === 'text') last.text += text
    else out.push({ kind, text })
  }
  let i = 0
  while (i < code.length) {
    const rest = code.slice(i)
    const comment = /^\/\/[^\n]*/.exec(rest)
    const string = /^"(?:\\.|[^"\\\n])*"?|^`[^`]*`?/.exec(rest)
    const number = /^\d+(?:\.\d+)?/.exec(rest)
    const word = /^[A-Za-z_]\w*/.exec(rest)
    if (comment) {
      push('comment', comment[0])
      i += comment[0].length
    } else if (string) {
      push('string', string[0])
      i += string[0].length
    } else if (number) {
      push('number', number[0])
      i += number[0].length
    } else if (word) {
      const after = code.slice(i + word[0].length)
      const kind: TokenKind = KEYWORDS.has(word[0]) ? 'keyword' : /^\s*\(/.test(after) ? 'function' : 'text'
      push(kind, word[0])
      i += word[0].length
    } else {
      push('text', code[i])
      i += 1
    }
  }
  return out
}
