// Static scan of a theme's templates for the parameters it reads (layer (b) of the theme
// settings design). The scan follows `with`/`range` context rebinding, variables and simple
// partial contexts, so `{{ with site.Params.social }}{{ .twitter }}` yields `social.twitter`
// and `{{ range site.Params.socialIcons }}{{ .url }}` yields `socialIcons[].url`.
import { extractActions, parseAction, type Command, type Operand, type Pipeline } from './lexer'

export type ParamScope = 'site' | 'page' | 'both' | 'language'

/** Usage evidence; turned into a type by `inferType`. */
export type UsageHint =
  | 'bool'
  /** An argument of `and` (or of `or` in a condition): probably a boolean. */
  | 'maybeBool'
  | 'printed'
  | 'list'
  | 'object'
  | 'integer'
  | 'number'
  | 'markdown'
  | 'url'
  | 'asset'
  | 'html'
  | 'dateFormat'

export interface ParamLocation {
  file: string
  line: number
}

export interface WhereCompare {
  op: string
  value: string | number | boolean | null
  file: string
  line: number
}

export interface ScannedParam {
  /** Dotted key as written in the templates; `[]` marks list items (`socialIcons[].url`). */
  key: string
  path: string[]
  scopes: ParamScope[]
  locations: ParamLocation[]
  /** Literal defaults (`| default "x"`, `default "x" …`, `?? x` in JS). */
  defaults: unknown[]
  /** Literals the value is compared with (`eq X "light"`). */
  compared: (string | number | boolean | null)[]
  /** Literals checked with `in X "lit"`: X is a list of these. */
  members: string[]
  hints: Partial<Record<UsageHint, number>>
  /** `where … "Params.x" "!=" "true"` style comparisons (page params). */
  whereCompares: WhereCompare[]
  /** Compared with a boolean literal (`ne X true`): a quoted "true" would not work. */
  boolCompare: boolean
  /** Every usage is inside a `hugo.IsProduction` / `env == "production"` branch. */
  productionOnly: boolean
  /** Found in JavaScript built with `js.Build` params. */
  fromJs: boolean
}

export interface TemplateFile {
  /** Path relative to the theme root, e.g. `layouts/_partials/head.html`. */
  path: string
  text: string
}

export interface ScanResult {
  /** By lower-cased key. */
  params: Map<string, ScannedParam>
  /** i18n ids used (`i18n "key"`, `T "key"`). */
  i18nKeys: Map<string, ParamLocation[]>
  /** Layout names compared with `.Layout` (`eq .Layout "search"`). */
  layouts: Map<string, ParamLocation[]>
  /** Partials called by name. */
  partials: Set<string>
  /** JS files built with params: asset path → JS name → value. */
  jsBuilds: JsBuild[]
}

export interface JsBuild {
  /** Asset path passed to `resources.Get`, when known (e.g. `js/fastsearch.js`). */
  asset: string | null
  /** How `params.<name>` in the JS maps to theme params. */
  params: { jsPath: string[]; ref: ParamRef }[]
}

export interface ParamRef {
  scope: ParamScope
  path: string[]
}

type Val =
  | { k: 'page' }
  | { k: 'param'; ref: ParamRef }
  | { k: 'dict'; members: Record<string, Val> }
  | { k: 'lit'; value: string | number | boolean | null }
  | { k: 'asset'; name: string }
  | { k: 'prod' }
  | { k: 'other' }

const PAGE: Val = { k: 'page' }
const OTHER: Val = { k: 'other' }

/** Hugo objects whose fields are not page params. */
const NOT_PAGE_FIELDS = new Set(['Menus', 'Menu', 'Resources', 'Children', 'Sites', 'Data', 'File', 'OutputFormats'])
/** Field names that cannot continue a param path (Hugo API, not user keys). */
const API_FIELDS = new Set(['Params', 'Site', 'Page', 'Param', 'Language'])

const PASS_THROUGH = new Set([
  'default',
  'trim',
  'lower',
  'upper',
  'title',
  'strings.TrimSpace',
  'strings.Trim',
  'strings.ToLower',
  'strings.ToUpper',
  'strings.Title',
  'first',
  'last',
  'after',
  'sort',
  'uniq',
  'shuffle',
  'collections.Sort',
  'collections.Uniq',
  'where',
  'collections.Where',
  'compact',
])
const STRING_FUNCS = new Set([
  'plainify',
  'htmlUnescape',
  'htmlEscape',
  'truncate',
  'emojify',
  'replace',
  'replaceRE',
  'strings.Replace',
  'urlize',
  'jsonify',
  'print',
  'println',
  'string',
  'chomp',
  'humanize',
  'trim',
  'lower',
  'upper',
  'title',
  'strings.TrimSpace',
  'strings.ToLower',
  'strings.Title',
  'safeJS',
  'safeCSS',
])
const MARKDOWN_FUNCS = new Set(['markdownify', 'RenderString', 'page.RenderString', 'transform.Markdownify'])
const URL_FUNCS = new Set(['absURL', 'relURL', 'absLangURL', 'relLangURL', 'safeURL', 'urls.Parse', 'urls.AbsURL', 'urls.RelURL'])
const ASSET_FUNCS = new Set(['resources.Get', 'resources.GetMatch', 'resources.Match', 'GetMatch', 'Get'])
const LIST_FUNCS = new Set(['delimit', 'collections.Delimit', 'range', 'reverse', 'collections.Reverse', 'seq', 'apply'])
const NUMBER_FUNCS = new Set(['add', 'sub', 'mul', 'div', 'mod', 'math.Add', 'math.Sub', 'math.Mul', 'math.Div', 'math.Mod', 'int'])
const I18N_FUNCS = new Set(['i18n', 'T', 'lang.Translate'])

interface Frame {
  kind: 'if' | 'with' | 'range' | 'define' | 'block' | 'root'
  outerDot: Val
  dot: Val
  outerRoot: Val
  vars: Map<string, Val>
  gated: boolean
  parentGated: boolean
}

class Scanner {
  readonly params = new Map<string, ScannedParam>()
  readonly i18nKeys = new Map<string, ParamLocation[]>()
  readonly layouts = new Map<string, ParamLocation[]>()
  readonly partials = new Set<string>()
  readonly jsBuilds: JsBuild[] = []
  /** Partial calls whose context carries params; rescanned with that context. */
  readonly contextCalls: { name: string; ctx: Val }[] = []
  private readonly seen = new Set<string>()
  private readonly casings = new Map<string, Map<string, number>>()

  private file = ''
  private line = 0
  private stack: Frame[] = []
  private prodSeen = false

  scanFile(path: string, text: string, rootDot: Val = PAGE) {
    this.file = path
    this.stack = [
      { kind: 'root', outerDot: rootDot, dot: rootDot, outerRoot: rootDot, vars: new Map(), gated: false, parentGated: false },
    ]
    let root = rootDot
    for (const action of extractActions(text)) {
      this.line = action.line
      const node = parseAction(action.text)
      const top = this.stack[this.stack.length - 1]
      const env = { dot: top.dot, root }
      switch (node.kind) {
        case 'output': {
          const val = this.evalPipeline(node.pipe, env, 'output')
          if (!node.pipe.decl) this.hint(val, 'printed')
          break
        }
        case 'if': {
          this.prodSeen = false
          this.evalPipeline(node.pipe, env, 'condition')
          this.push('if', top.dot, top.dot, root, this.prodSeen)
          break
        }
        case 'with': {
          this.prodSeen = false
          const val = this.evalPipeline(node.pipe, env, 'value')
          this.push('with', top.dot, asContext(val), root, this.prodSeen)
          break
        }
        case 'range': {
          const frame = this.push('range', top.dot, top.dot, root, false)
          const val = this.evalPipeline({ cmds: node.pipe.cmds }, env, 'value')
          this.hint(val, 'list')
          const elem = elementOf(val)
          frame.dot = elem
          const vars = node.pipe.decl?.vars ?? []
          if (vars.length === 1) frame.vars.set(vars[0], elem)
          if (vars.length >= 2) {
            frame.vars.set(vars[0], OTHER)
            frame.vars.set(vars[1], elem)
          }
          break
        }
        case 'elseIf':
        case 'elseWith': {
          const frame = this.stack.length > 1 ? top : null
          if (!frame) break
          this.prodSeen = false
          const outerEnv = { dot: frame.outerDot, root }
          const val = this.evalPipeline(node.pipe, outerEnv, node.kind === 'elseIf' ? 'condition' : 'value')
          frame.dot = node.kind === 'elseWith' ? asContext(val) : frame.outerDot
          frame.gated = frame.parentGated || this.prodSeen
          break
        }
        case 'else': {
          if (this.stack.length > 1) {
            top.dot = top.outerDot
            top.gated = top.parentGated
          }
          break
        }
        case 'end': {
          if (this.stack.length > 1) {
            const frame = this.stack.pop()!
            if (frame.kind === 'define' || frame.kind === 'block') root = frame.outerRoot
          }
          break
        }
        case 'define': {
          this.push('define', top.dot, PAGE, root, false)
          root = PAGE
          break
        }
        case 'block': {
          const val = this.evalPipeline(node.pipe, env, 'value')
          const dot = asContext(val)
          this.push('block', top.dot, dot, root, false)
          root = dot
          break
        }
        case 'template': {
          if (node.pipe) this.evalPipeline(node.pipe, env, 'value')
          break
        }
        default:
          break
      }
    }
  }

  private push(kind: Frame['kind'], outerDot: Val, dot: Val, outerRoot: Val, prod: boolean): Frame {
    const parentGated = this.stack[this.stack.length - 1]?.gated ?? false
    const frame: Frame = { kind, outerDot, dot, outerRoot, vars: new Map(), gated: parentGated || prod, parentGated }
    this.stack.push(frame)
    return frame
  }

  private lookupVar(name: string): Val | undefined {
    for (let i = this.stack.length - 1; i >= 0; i--) {
      const v = this.stack[i].vars.get(name)
      if (v) return v
    }
    return undefined
  }

  private assignVar(name: string, val: Val, declare: boolean) {
    if (!declare) {
      for (let i = this.stack.length - 1; i >= 0; i--) {
        if (this.stack[i].vars.has(name)) {
          this.stack[i].vars.set(name, val)
          return
        }
      }
    }
    this.stack[this.stack.length - 1].vars.set(name, val)
  }

  private get gated(): boolean {
    return this.stack[this.stack.length - 1]?.gated ?? false
  }

  // --- Evaluation -------------------------------------------------------------------------------

  private evalPipeline(pipe: Pipeline, env: Env, mode: 'output' | 'condition' | 'value'): Val {
    let val: Val | undefined
    pipe.cmds.forEach((cmd, i) => {
      val = this.evalCommand(cmd, val, env, mode === 'condition' && i === pipe.cmds.length - 1)
    })
    const result = val ?? OTHER
    if (mode === 'condition') this.hint(result, 'bool')
    if (pipe.decl) {
      for (const name of pipe.decl.vars) this.assignVar(name, result, !pipe.decl.assign)
    }
    return result
  }

  private evalOperand(op: Operand, env: Env): Val {
    if (op.t === 'lit') return { k: 'lit', value: op.value }
    if (op.t === 'pipe') {
      const inner = this.evalPipeline(op.pipe, env, 'value')
      return op.fields.length > 0 ? this.walk(inner, op.fields) : inner
    }
    return this.evalChain(op.head, op.fields, env)
  }

  private evalChain(head: string, fields: string[], env: Env): Val {
    let base: Val
    if (head === '.') base = env.dot
    else if (head === '$') base = env.root
    else if (head.startsWith('$')) base = this.lookupVar(head) ?? PAGE
    else if (head === 'site') {
      if (fields[0] === 'Params') return this.useRef({ scope: 'site', path: fields.slice(1) })
      if (fields[0] === 'Language' && fields[1] === 'Params') return this.useRef({ scope: 'language', path: fields.slice(2) })
      return OTHER
    } else if (head === 'hugo' && fields[0] === 'IsProduction') {
      this.prodSeen = true
      return { k: 'prod' }
    } else return OTHER
    return this.walk(base, fields)
  }

  /** Follows `fields` from a value, recording any param it reaches. */
  private walk(base: Val, fields: string[]): Val {
    if (fields.length === 0) {
      if (base.k === 'param') this.useRef(base.ref)
      return base
    }
    switch (base.k) {
      case 'param': {
        if (API_FIELDS.has(fields[0])) return OTHER
        return this.useRef({ scope: base.ref.scope, path: [...base.ref.path, ...fields] })
      }
      case 'dict': {
        const member = base.members[fields[0]]
        return member ? this.walk(member, fields.slice(1)) : this.walk(PAGE, fields)
      }
      case 'page': {
        let f = fields
        if (f[0] === 'Page') f = f.slice(1)
        if (f.length === 0) return PAGE
        if (f[0] === 'Params') return this.useRef({ scope: 'page', path: f.slice(1) })
        if (f[0] === 'Site' && f[1] === 'Params') return this.useRef({ scope: 'site', path: f.slice(2) })
        if (f[0] === 'Site' && f[1] === 'Language' && f[2] === 'Params') {
          return this.useRef({ scope: 'language', path: f.slice(3) })
        }
        if (f[0] === 'Language' && f[1] === 'Params') return this.useRef({ scope: 'language', path: f.slice(2) })
        if (f.some((x) => NOT_PAGE_FIELDS.has(x))) return OTHER
        return PAGE
      }
      default:
        return OTHER
    }
  }

  private evalCommand(cmd: Command, piped: Val | undefined, env: Env, condition = false): Val {
    const head = cmd[0]
    // A function call: `name args…` (namespaced names like resources.Get are chains on an identifier).
    if (head.t === 'chain' && head.head !== '.' && !head.head.startsWith('$') && head.head !== 'site') {
      if (head.head === 'hugo' && head.fields[0] === 'IsProduction') {
        this.prodSeen = true
        return { k: 'prod' }
      }
      const name = [head.head, ...head.fields].join('.')
      const args = cmd.slice(1)
      return this.callFunction(name, args, piped, env, condition)
    }
    // A method call on a value: `.Param "x"`, `$.Page.RenderString $opts`.
    if (head.t === 'chain' && head.fields.length > 0 && (cmd.length > 1 || piped)) {
      const method = head.fields[head.fields.length - 1]
      const receiver = this.evalChain(head.head, head.fields.slice(0, -1), env)
      const args = cmd.slice(1).map((a) => this.evalOperand(a, env))
      if (piped) args.push(piped)
      return this.callMethod(method, receiver, args)
    }
    if (cmd.length === 1 && !piped) return this.evalOperand(head, env)
    // `site.Params.x arg` and other odd forms: evaluate everything for its params.
    const vals = cmd.map((op) => this.evalOperand(op, env))
    return vals[0] ?? OTHER
  }

  private callMethod(method: string, receiver: Val, args: Val[]): Val {
    if ((method === 'Param' || method === 'GetParam') && receiver.k !== 'param' && receiver.k !== 'other') {
      const key = args[0]
      if (key?.k === 'lit' && typeof key.value === 'string' && key.value) {
        return this.useRef({ scope: method === 'Param' ? 'both' : 'page', path: key.value.split('.') })
      }
      return OTHER
    }
    if (method === 'RenderString' || method === 'Markdownify') {
      for (const a of args) this.hint(a, 'markdown')
      return OTHER
    }
    if (method === 'GetMatch' || method === 'Get') {
      for (const a of args) this.hint(a, 'asset')
      return OTHER
    }
    // Unknown methods (`.Paginate`, `.GetPage` …) usually return pages or page collections.
    return PAGE
  }

  private callFunction(name: string, ops: Operand[], piped: Val | undefined, env: Env, condition: boolean): Val {
    // In a condition, `and`/`or` operands are conditions too: `if or (and A B) C`.
    const nested = condition && (name === 'and' || name === 'or')
    const args = ops.map((op) =>
      nested && op.t === 'pipe' && op.fields.length === 0 ? this.evalPipeline(op.pipe, env, 'condition') : this.evalOperand(op, env),
    )
    if (piped) args.push(piped)
    const lits = args.filter((a): a is Extract<Val, { k: 'lit' }> => a.k === 'lit')
    const refs = args.filter((a): a is Extract<Val, { k: 'param' }> => a.k === 'param')

    if (name === 'default') {
      const [def, value] = args
      if (value?.k === 'param' && def?.k === 'lit') this.param(value.ref).defaults.push(def.value)
      if (value?.k === 'param') return value
      return def ?? OTHER
    }
    if (name === 'eq' || name === 'ne') {
      // `.Layout` comparisons: the layout names that need content files (search, archives…).
      const layoutOp = ops.find((o) => o.t === 'chain' && o.fields[o.fields.length - 1] === 'Layout')
      if (layoutOp) {
        for (const lit of lits) {
          if (typeof lit.value === 'string') {
            const list = this.layouts.get(lit.value) ?? []
            list.push({ file: this.file, line: this.line })
            this.layouts.set(lit.value, list)
          }
        }
      }
      for (const ref of refs) {
        const p = this.param(ref.ref)
        for (const lit of lits) {
          if (!p.compared.includes(lit.value)) p.compared.push(lit.value)
          if (typeof lit.value === 'boolean') p.boolCompare = true
          if (lit.value === 'production' && ref.ref.path.join('.').toLowerCase() === 'env') this.prodSeen = true
        }
      }
      return OTHER
    }
    if (name === 'lt' || name === 'le' || name === 'gt' || name === 'ge') {
      for (const ref of refs) this.hint(ref, 'number')
      return OTHER
    }
    if (name === 'not') {
      for (const a of args) this.hint(a, 'bool')
      return OTHER
    }
    if (name === 'and' || name === 'or') {
      // `or` outside a condition is mostly a fallback chain of values (`or .Params.x site.Params.x`).
      if (condition) for (const a of args) this.hint(a, 'bool')
      else if (name === 'and') for (const a of args) this.hint(a, 'maybeBool')
      return OTHER
    }
    if (name === 'cond') {
      this.hint(args[0], 'bool')
      return OTHER
    }
    if (name === 'in' || name === 'collections.In') {
      const [list, item] = args
      if (list?.k === 'param') {
        const p = this.param(list.ref)
        this.bump(p, 'list')
        if (item?.k === 'lit' && typeof item.value === 'string' && !p.members.includes(item.value)) p.members.push(item.value)
      }
      return OTHER
    }
    if (name === 'index') {
      let base = args[0]
      for (const key of args.slice(1)) {
        if (base?.k === 'param' || base?.k === 'page' || base?.k === 'dict') {
          if (key.k === 'lit' && typeof key.value === 'string') base = this.walk(base, [key.value])
          else if (key.k === 'lit' && typeof key.value === 'number' && base.k === 'param') {
            this.hint(base, 'list')
            base = { k: 'param', ref: { ...base.ref, path: [...base.ref.path, '[]'] } }
            this.useRef(base.ref)
          } else base = OTHER
        } else base = OTHER
      }
      return base ?? OTHER
    }
    if (name === 'isset') {
      const [base, key] = args
      if (base && key?.k === 'lit' && typeof key.value === 'string') {
        if (base.k === 'page') return this.useRef({ scope: 'page', path: [key.value] })
        if (base.k === 'param') return this.walk(base, [key.value])
      }
      return OTHER
    }
    if (name === 'where' || name === 'collections.Where') {
      const [collection, keyArg] = args
      if (keyArg?.k === 'lit' && typeof keyArg.value === 'string' && /^\.?Params\./.test(keyArg.value)) {
        const path = keyArg.value.replace(/^\.?Params\./, '').split('.')
        const p = this.param({ scope: 'page', path })
        this.addLocation(p)
        const op = args.length >= 4 && args[2].k === 'lit' ? String(args[2].value) : '='
        const value = args[args.length - 1]
        if (args.length >= 3 && value.k === 'lit') {
          p.whereCompares.push({ op, value: value.value, file: this.file, line: this.line })
          if (!p.compared.includes(value.value)) p.compared.push(value.value)
        }
      }
      const last = args[args.length - 1]
      if (args.length >= 3 && last.k === 'param') {
        const op = args.length >= 4 && args[2].k === 'lit' ? String(args[2].value) : '='
        if (/in|intersect/i.test(op)) this.hint(last, 'list')
      }
      return collection ?? OTHER
    }
    if (name === 'printf' || name === 'fmt.Printf') {
      const format = args[0]?.k === 'lit' && typeof args[0].value === 'string' ? args[0].value : ''
      const verbs = [...format.matchAll(/%[-+# 0-9.]*([a-zA-Z%])/g)].map((m) => m[1]).filter((v) => v !== '%')
      args.slice(1).forEach((a, i) => {
        const verb = verbs[i]
        if (verb === 'd') this.hint(a, 'integer')
        else if (verb === 's' || verb === 'v' || verb === 'q') this.hint(a, 'printed')
      })
      return OTHER
    }
    if (NUMBER_FUNCS.has(name)) {
      for (const ref of refs) this.hint(ref, 'integer')
      return OTHER
    }
    if (MARKDOWN_FUNCS.has(name)) {
      for (const ref of refs) this.hint(ref, 'markdown')
      return OTHER
    }
    if (name === 'safeHTML' || name === 'safeHTMLAttr') {
      for (const ref of refs) this.hint(ref, 'html')
      return OTHER
    }
    if (name === 'hasPrefix' || name === 'strings.HasPrefix') {
      if (args[1]?.k === 'lit' && args[1].value === '<svg') this.hint(args[0], 'html')
      else for (const ref of refs) this.hint(ref, 'printed')
      return OTHER
    }
    if (URL_FUNCS.has(name)) {
      for (const ref of refs) this.hint(ref, 'url')
      return OTHER
    }
    if (ASSET_FUNCS.has(name)) {
      for (const ref of refs) this.hint(ref, 'asset')
      if (args[0]?.k === 'lit' && typeof args[0].value === 'string') return { k: 'asset', name: args[0].value }
      return OTHER
    }
    if (name === 'time.Format' || name === 'dateFormat') {
      this.hint(args[0], 'dateFormat')
      return OTHER
    }
    if (LIST_FUNCS.has(name)) {
      this.hint(args[0], 'list')
      return OTHER
    }
    if (name === 'reflect.IsMap') {
      this.hint(args[0], 'object')
      return OTHER
    }
    if (name === 'reflect.IsSlice') {
      this.hint(args[0], 'list')
      return OTHER
    }
    if (I18N_FUNCS.has(name)) {
      const key = args[0]
      if (key?.k === 'lit' && typeof key.value === 'string') {
        const list = this.i18nKeys.get(key.value) ?? []
        list.push({ file: this.file, line: this.line })
        this.i18nKeys.set(key.value, list)
      }
      return OTHER
    }
    if (name === 'partial' || name === 'partialCached' || name === 'partials.Include' || name === 'partials.IncludeCached') {
      const partialName = args[0]
      if (partialName?.k === 'lit' && typeof partialName.value === 'string') {
        this.partials.add(partialName.value)
        const ctx = args[1]
        if (ctx && carriesParams(ctx)) this.contextCalls.push({ name: partialName.value, ctx })
      }
      return OTHER
    }
    if (name === 'dict' || name === 'collections.Dictionary') {
      const members: Record<string, Val> = {}
      for (let i = 0; i + 1 < args.length; i += 2) {
        const key = args[i]
        if (key.k === 'lit' && typeof key.value === 'string') members[key.value] = args[i + 1]
      }
      return { k: 'dict', members }
    }
    if (name === 'js.Build' || name === 'js.Batch' || name === 'babel') {
      const options = args.find((a) => a.k === 'dict')
      const asset = args.find((a): a is Extract<Val, { k: 'asset' }> => a.k === 'asset')
      const params = options?.k === 'dict' ? options.members.params : undefined
      if (params) {
        const mapped: JsBuild['params'] = []
        collectJsParams(params, [], mapped)
        if (mapped.length > 0) this.jsBuilds.push({ asset: asset?.name ?? null, params: mapped })
      }
      return OTHER
    }
    if (PASS_THROUGH.has(name)) {
      if (STRING_FUNCS.has(name)) for (const ref of refs) this.hint(ref, 'printed')
      if (name === 'first' || name === 'last' || name === 'after') {
        const coll = args[1]
        this.hint(coll, 'list')
        return coll ?? OTHER
      }
      if (name === 'where' || name === 'sort' || name === 'uniq' || name === 'shuffle' || name.startsWith('collections.')) {
        this.hint(args[0], 'list')
        return args[0] ?? OTHER
      }
      return refs[refs.length - 1] ?? args[args.length - 1] ?? OTHER
    }
    if (STRING_FUNCS.has(name)) {
      for (const ref of refs) this.hint(ref, 'printed')
      return OTHER
    }
    // Unknown functions (`union`, `slice` …): treat the result as page-like, so `.Params`
    // inside a `range` over it is still read as page params.
    return PAGE
  }

  // --- Recording --------------------------------------------------------------------------------

  private param(ref: ParamRef): ScannedParam {
    // A list element itself (`X[]`) is recorded on the list.
    const path = ref.path[ref.path.length - 1] === '[]' ? ref.path.slice(0, -1) : ref.path
    const key = keyOf(path)
    const lower = key.toLowerCase()
    const casings = this.casings.get(lower) ?? new Map<string, number>()
    casings.set(key, (casings.get(key) ?? 0) + 1)
    this.casings.set(lower, casings)
    let p = this.params.get(lower)
    if (!p) {
      p = {
        key,
        path: [...path],
        scopes: [],
        locations: [],
        defaults: [],
        compared: [],
        members: [],
        hints: {},
        whereCompares: [],
        boolCompare: false,
        productionOnly: true,
        fromJs: false,
      }
      this.params.set(lower, p)
    }
    if (!p.scopes.includes(ref.scope)) p.scopes.push(ref.scope)
    return p
  }

  private addLocation(p: ScannedParam) {
    const id = `${p.key.toLowerCase()}|${this.file}|${this.line}`
    if (!this.gated) p.productionOnly = false
    if (this.seen.has(id)) return
    this.seen.add(id)
    p.locations.push({ file: this.file, line: this.line })
  }

  /** Uses the casing seen most often for each key. */
  finishCasing() {
    for (const [lower, p] of this.params) {
      const casings = this.casings.get(lower)
      if (!casings) continue
      const best = [...casings.entries()].sort((a, b) => b[1] - a[1])[0]
      if (best && best[0] !== p.key) {
        p.key = best[0]
        p.path = best[0].replace(/\[\]/g, '.[]').split('.')
      }
    }
  }

  private useRef(ref: ParamRef): Val {
    if (ref.path.length === 0 || (ref.path.length === 1 && ref.path[0] === '[]')) return { k: 'param', ref }
    this.addLocation(this.param(ref))
    return { k: 'param', ref }
  }

  private hint(val: Val | undefined, hint: UsageHint) {
    if (val?.k === 'param' && val.ref.path.length > 0) this.bump(this.param(val.ref), hint)
  }

  private bump(p: ScannedParam, hint: UsageHint) {
    p.hints[hint] = (p.hints[hint] ?? 0) + 1
  }
}

interface Env {
  dot: Val
  root: Val
}

function keyOf(path: string[]): string {
  return path.join('.').replace(/\.\[\]/g, '[]')
}

function asContext(val: Val): Val {
  if (val.k === 'param' || val.k === 'page' || val.k === 'dict') return val
  return OTHER
}

function elementOf(val: Val): Val {
  if (val.k === 'param') return { k: 'param', ref: { ...val.ref, path: [...val.ref.path, '[]'] } }
  if (val.k === 'page' || val.k === 'dict') return PAGE
  return OTHER
}

function carriesParams(val: Val): boolean {
  if (val.k === 'param') return val.ref.path.length > 0
  if (val.k === 'dict') return Object.values(val.members).some(carriesParams)
  return false
}

function collectJsParams(val: Val, prefix: string[], out: JsBuild['params']) {
  if (val.k === 'param') out.push({ jsPath: prefix, ref: val.ref })
  else if (val.k === 'dict') for (const [key, member] of Object.entries(val.members)) collectJsParams(member, [...prefix, key], out)
}

function ctxKey(val: Val): string {
  return JSON.stringify(val)
}

/** Template-relative path of a partial name (`svg.html` → `layouts/_partials/svg.html`). */
export function partialCandidates(name: string): string[] {
  const file = /\.[a-z0-9]+$/i.test(name) ? name : `${name}.html`
  return [`layouts/_partials/${file}`, `layouts/partials/${file}`]
}

/** Scans templates (paths relative to the theme root). JS files referenced by `js.Build` may be included. */
export function scanTemplates(files: TemplateFile[]): ScanResult {
  const scanner = new Scanner()
  const templates = files.filter((f) => f.path.startsWith('layouts/'))
  const byPath = new Map(files.map((f) => [f.path, f]))
  for (const file of templates) scanner.scanFile(file.path, file.text)

  // Partials called with a param (or a dict holding params) as context: scan again with it,
  // so `.name` inside `svg.html` called from `range site.Params.socialIcons` is understood.
  const done = new Set<string>()
  for (let i = 0; i < scanner.contextCalls.length && i < 200; i++) {
    const call = scanner.contextCalls[i]
    const id = `${call.name}|${ctxKey(call.ctx)}`
    if (done.has(id)) continue
    done.add(id)
    const target = partialCandidates(call.name)
      .map((p) => byPath.get(p))
      .find((f) => f !== undefined)
    if (target) scanner.scanFile(target.path, target.text, call.ctx)
  }

  scanner.finishCasing()
  for (const build of scanner.jsBuilds) {
    if (!build.asset) continue
    const js = byPath.get(`assets/${build.asset}`)
    if (js) scanJs(js, build, scanner.params)
  }

  return {
    params: scanner.params,
    i18nKeys: scanner.i18nKeys,
    layouts: scanner.layouts,
    partials: scanner.partials,
    jsBuilds: scanner.jsBuilds,
  }
}

const JS_PARAM = /\bparams((?:\??\.[A-Za-z_$][\w$]*)+)(\s*(?:\?\?|\|\|)\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|-?\d+(?:\.\d+)?|true|false))?/g

/** `params.fuseOpts.threshold ?? 0.4` in JS built with `js.Build (dict "params" …)`. */
export function scanJs(file: TemplateFile, build: JsBuild, params: Map<string, ScannedParam>) {
  const lines = file.text.split('\n')
  lines.forEach((text, index) => {
    for (const m of text.matchAll(JS_PARAM)) {
      const segments = m[1].split('.').map((s) => s.replace(/\?$/, '')).filter(Boolean)
      const mapping = build.params
        .filter((p) => p.jsPath.every((seg, i) => segments[i]?.toLowerCase() === seg.toLowerCase()))
        .sort((a, b) => b.jsPath.length - a.jsPath.length)[0]
      if (!mapping) continue
      const rest = segments.slice(mapping.jsPath.length)
      const path = [...mapping.ref.path, ...rest]
      if (path.length === 0) continue
      const key = keyOf(path)
      const lower = key.toLowerCase()
      let p = params.get(lower)
      if (!p) {
        p = {
          key,
          path,
          scopes: [mapping.ref.scope],
          locations: [],
          defaults: [],
          compared: [],
          members: [],
          hints: {},
          whereCompares: [],
          boolCompare: false,
          productionOnly: false,
          fromJs: true,
        }
        params.set(lower, p)
      }
      if (!p.locations.some((l) => l.file === file.path && l.line === index + 1)) {
        p.locations.push({ file: file.path, line: index + 1 })
      }
      if (m[3] !== undefined) {
        const literal = parseJsLiteral(m[3])
        if (!p.defaults.some((d) => d === literal)) p.defaults.push(literal)
      }
    }
  })
}

function parseJsLiteral(text: string): unknown {
  if (text === 'true') return true
  if (text === 'false') return false
  if (/^-?\d/.test(text)) return Number(text)
  return text.slice(1, -1)
}
