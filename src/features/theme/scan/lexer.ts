// A small, tolerant parser for Go/Hugo template actions (`{{ … }}`). It does not need Hugo's
// function list: it only splits actions into pipelines, commands and operands, which is enough
// to follow how a theme reads its parameters. Anything it cannot parse becomes an empty action
// instead of an error, because a theme with one odd line must still be scannable.

export interface RawAction {
  /** Text between the delimiters, trim markers removed. */
  text: string
  /** 1-based line of the opening `{{`. */
  line: number
}

/** All non-comment actions of a template, in order. */
export function extractActions(source: string): RawAction[] {
  const actions: RawAction[] = []
  let pos = 0
  let line = 1
  let counted = 0
  const lineAt = (index: number) => {
    for (let i = counted; i < index; i++) if (source.charCodeAt(i) === 10) line++
    counted = Math.max(counted, index)
    return line
  }
  while (pos < source.length) {
    const open = source.indexOf('{{', pos)
    if (open === -1) break
    const startLine = lineAt(open)
    let i = open + 2
    if (source[i] === '-' && /\s/.test(source[i + 1] ?? '')) i += 1
    const afterTrim = i
    while (i < source.length && /\s/.test(source[i])) i++
    if (source.startsWith('/*', i)) {
      const close = source.indexOf('*/', i + 2)
      if (close === -1) break
      const end = source.indexOf('}}', close + 2)
      if (end === -1) break
      pos = end + 2
      continue
    }
    const end = findActionEnd(source, afterTrim)
    if (end === -1) break
    let text = source.slice(afterTrim, end)
    if (/\s-$/.test(text)) text = text.slice(0, -1)
    actions.push({ text: text.trim(), line: startLine })
    pos = end + 2
  }
  return actions
}

/** Index of the `}}` that closes an action starting at `from`, skipping string literals. */
function findActionEnd(source: string, from: number): number {
  let i = from
  while (i < source.length) {
    const ch = source[i]
    if (ch === '"') {
      i++
      while (i < source.length && source[i] !== '"') {
        if (source[i] === '\\') i++
        if (source[i] === '\n') break
        i++
      }
      i++
    } else if (ch === '`') {
      const close = source.indexOf('`', i + 1)
      if (close === -1) return -1
      i = close + 1
    } else if (ch === "'") {
      const close = source.indexOf("'", i + 1)
      i = close === -1 || close - i > 4 ? i + 1 : close + 1
    } else if (ch === '}' && source[i + 1] === '}') {
      return i
    } else {
      i++
    }
  }
  return -1
}

// --- Tokens -----------------------------------------------------------------------------------

export type Token =
  | { t: 'str'; value: string }
  | { t: 'num'; value: number }
  | { t: 'bool'; value: boolean }
  | { t: 'nil' }
  /** `.a.b`, `$.a`, `$x.a`, `site.Params.a`, `.` and `$`. `head` is `.`, `$`, `$name` or an identifier. */
  | { t: 'chain'; head: string; fields: string[] }
  /** Fields directly after a closing parenthesis: `(…).a.b`. */
  | { t: 'fields'; fields: string[] }
  | { t: 'op'; value: '|' | '(' | ')' | ':=' | '=' | ',' }

const IDENT = /[A-Za-z_][A-Za-z0-9_]*/y
const FIELD = /\.([A-Za-z_][A-Za-z0-9_]*)/y
const NUMBER = /[-+]?(?:0[xX][0-9a-fA-F_]+|(?:\d[\d_]*)?\.?\d[\d_]*(?:[eE][-+]?\d+)?)/y

export function tokenize(text: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  const readFields = (): string[] => {
    const fields: string[] = []
    for (;;) {
      FIELD.lastIndex = i
      const m = FIELD.exec(text)
      if (!m) break
      fields.push(m[1])
      i = FIELD.lastIndex
    }
    return fields
  }
  while (i < text.length) {
    const ch = text[i]
    if (/\s/.test(ch)) {
      i++
      continue
    }
    if (ch === '"') {
      let j = i + 1
      let value = ''
      while (j < text.length && text[j] !== '"') {
        if (text[j] === '\\' && j + 1 < text.length) {
          const next = text[j + 1]
          value += next === 'n' ? '\n' : next === 't' ? '\t' : next
          j += 2
        } else {
          value += text[j]
          j++
        }
      }
      tokens.push({ t: 'str', value })
      i = j + 1
      continue
    }
    if (ch === '`') {
      const close = text.indexOf('`', i + 1)
      const end = close === -1 ? text.length : close
      tokens.push({ t: 'str', value: text.slice(i + 1, end) })
      i = end + 1
      continue
    }
    if (ch === "'") {
      const close = text.indexOf("'", i + 1)
      const end = close === -1 ? text.length : close
      tokens.push({ t: 'str', value: text.slice(i + 1, end) })
      i = end + 1
      continue
    }
    if (ch === ':' && text[i + 1] === '=') {
      tokens.push({ t: 'op', value: ':=' })
      i += 2
      continue
    }
    if (ch === '|' || ch === '(' || ch === '=' || ch === ',') {
      tokens.push({ t: 'op', value: ch })
      i++
      continue
    }
    if (ch === ')') {
      tokens.push({ t: 'op', value: ')' })
      i++
      if (text[i] === '.') {
        const fields = readFields()
        if (fields.length > 0) tokens.push({ t: 'fields', fields })
      }
      continue
    }
    if (ch === '.') {
      FIELD.lastIndex = i
      if (FIELD.exec(text)) {
        tokens.push({ t: 'chain', head: '.', fields: readFields() })
      } else {
        NUMBER.lastIndex = i
        const num = NUMBER.exec(text)
        if (num && num[0].length > 1) {
          tokens.push({ t: 'num', value: Number(num[0].replace(/_/g, '')) })
          i = NUMBER.lastIndex
        } else {
          tokens.push({ t: 'chain', head: '.', fields: [] })
          i++
        }
      }
      continue
    }
    if (ch === '$') {
      IDENT.lastIndex = i + 1
      const m = IDENT.exec(text)
      const head = m ? '$' + m[0] : '$'
      i = m ? IDENT.lastIndex : i + 1
      tokens.push({ t: 'chain', head, fields: readFields() })
      continue
    }
    if (/[0-9]/.test(ch) || ((ch === '-' || ch === '+') && /[0-9.]/.test(text[i + 1] ?? ''))) {
      NUMBER.lastIndex = i
      const num = NUMBER.exec(text)
      if (num) {
        tokens.push({ t: 'num', value: Number(num[0].replace(/_/g, '')) })
        i = NUMBER.lastIndex
        continue
      }
    }
    IDENT.lastIndex = i
    const ident = IDENT.exec(text)
    if (ident) {
      i = IDENT.lastIndex
      const name = ident[0]
      if (name === 'true' || name === 'false') tokens.push({ t: 'bool', value: name === 'true' })
      else if (name === 'nil') tokens.push({ t: 'nil' })
      else tokens.push({ t: 'chain', head: name, fields: readFields() })
      continue
    }
    // Anything else (stray characters inside odd templates) is skipped.
    i++
  }
  return tokens
}

// --- Syntax tree ------------------------------------------------------------------------------

export type Operand =
  | { t: 'lit'; value: string | number | boolean | null }
  | { t: 'chain'; head: string; fields: string[] }
  | { t: 'pipe'; pipe: Pipeline; fields: string[] }

export type Command = Operand[]

export interface Pipeline {
  /** `$a := …`, `$i, $e := …` or `$a = …`. */
  decl?: { vars: string[]; assign: boolean }
  cmds: Command[]
}

export type ActionNode =
  | { kind: 'output'; pipe: Pipeline }
  | { kind: 'if' | 'with' | 'range' | 'elseIf' | 'elseWith'; pipe: Pipeline }
  | { kind: 'else' | 'end' | 'break' | 'continue' }
  | { kind: 'define'; name: string }
  | { kind: 'block'; name: string; pipe: Pipeline }
  | { kind: 'template'; name: string; pipe: Pipeline | null }
  | { kind: 'empty' }

const CONTROL = new Set(['if', 'with', 'range', 'else', 'end', 'define', 'block', 'template', 'break', 'continue'])

export function parseAction(text: string): ActionNode {
  const tokens = tokenize(text)
  if (tokens.length === 0) return { kind: 'empty' }
  const first = tokens[0]
  const keyword = first.t === 'chain' && first.fields.length === 0 && CONTROL.has(first.head) ? first.head : null
  const rest = keyword ? tokens.slice(1) : tokens
  switch (keyword) {
    case null:
      return { kind: 'output', pipe: parsePipeline(rest) }
    case 'if':
    case 'with':
    case 'range':
      return { kind: keyword, pipe: parsePipeline(rest) }
    case 'else': {
      const next = rest[0]
      if (next && next.t === 'chain' && next.fields.length === 0 && (next.head === 'if' || next.head === 'with')) {
        return { kind: next.head === 'if' ? 'elseIf' : 'elseWith', pipe: parsePipeline(rest.slice(1)) }
      }
      return { kind: 'else' }
    }
    case 'end':
    case 'break':
    case 'continue':
      return { kind: keyword }
    case 'define': {
      const name = rest[0]?.t === 'str' ? rest[0].value : ''
      return { kind: 'define', name }
    }
    case 'block': {
      const name = rest[0]?.t === 'str' ? rest[0].value : ''
      return { kind: 'block', name, pipe: parsePipeline(rest.slice(1)) }
    }
    case 'template': {
      const name = rest[0]?.t === 'str' ? rest[0].value : ''
      return { kind: 'template', name, pipe: rest.length > 1 ? parsePipeline(rest.slice(1)) : null }
    }
    default:
      return { kind: 'empty' }
  }
}

/** Parses `[decl] cmd | cmd …`. Unbalanced parentheses are tolerated. */
export function parsePipeline(tokens: Token[]): Pipeline {
  let pos = 0
  let decl: Pipeline['decl']
  // Declaration: $a :=, $a, $b :=, $a =
  const vars: string[] = []
  let j = 0
  while (j < tokens.length) {
    const tok = tokens[j]
    if (tok.t === 'chain' && tok.head.startsWith('$') && tok.fields.length === 0) {
      vars.push(tok.head)
      const next = tokens[j + 1]
      if (next?.t === 'op' && next.value === ',') {
        j += 2
        continue
      }
      if (next?.t === 'op' && (next.value === ':=' || next.value === '=')) {
        decl = { vars, assign: next.value === '=' }
        pos = j + 2
      }
    }
    break
  }

  const parseCommands = (): Command[] => {
    const cmds: Command[] = []
    let current: Command = []
    while (pos < tokens.length) {
      const tok = tokens[pos]
      if (tok.t === 'op' && tok.value === ')') break
      pos++
      if (tok.t === 'op') {
        if (tok.value === '|') {
          cmds.push(current)
          current = []
        } else if (tok.value === '(') {
          const inner = parseCommands()
          if (tokens[pos]?.t === 'op' && (tokens[pos] as { value: string }).value === ')') pos++
          let fields: string[] = []
          const after = tokens[pos]
          if (after?.t === 'fields') {
            fields = after.fields
            pos++
          }
          current.push({ t: 'pipe', pipe: { cmds: inner }, fields })
        }
        continue
      }
      if (tok.t === 'str' || tok.t === 'num' || tok.t === 'bool') current.push({ t: 'lit', value: tok.value })
      else if (tok.t === 'nil') current.push({ t: 'lit', value: null })
      else if (tok.t === 'chain') current.push({ t: 'chain', head: tok.head, fields: tok.fields })
      else if (tok.t === 'fields' && current.length > 0) {
        const last = current[current.length - 1]
        if (last.t === 'chain') last.fields = [...last.fields, ...tok.fields]
      }
    }
    if (current.length > 0) cmds.push(current)
    return cmds.filter((c) => c.length > 0)
  }
  const cmds: Command[] = []
  while (pos < tokens.length) {
    cmds.push(...parseCommands())
    // A stray `)` at the top level: skip it and keep going.
    if (pos < tokens.length) pos++
  }
  return { decl, cmds }
}
