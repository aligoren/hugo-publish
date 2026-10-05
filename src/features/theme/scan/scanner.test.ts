import { describe, expect, it } from 'vitest'

import { inferType, typeFromName } from './infer'
import { extractActions, parseAction, tokenize } from './lexer'
import { scanTemplates, type ScanResult } from './scanner'

function scan(files: Record<string, string>): ScanResult {
  return scanTemplates(Object.entries(files).map(([path, text]) => ({ path, text })))
}

function param(result: ScanResult, key: string) {
  const p = result.params.get(key.toLowerCase())
  if (!p) throw new Error(`no param ${key}; have ${[...result.params.keys()].join(', ')}`)
  return p
}

function typeOf(result: ScanResult, key: string) {
  const p = param(result, key)
  const lower = key.toLowerCase()
  const keys = [...result.params.keys()]
  return inferType(p, {
    hasChildren: keys.some((k) => k.startsWith(lower + '.')),
    hasItemChildren: keys.some((k) => k.startsWith(lower + '[].')),
  })
}

describe('lexer', () => {
  it('extracts actions with lines, skipping comments and trim markers', () => {
    const actions = extractActions('a\n{{- if .x -}}\n{{/* skip {{ me }} */}}\n{{- /* also */ -}}{{ "}}" }}\n')
    expect(actions).toEqual([
      { text: 'if .x', line: 2 },
      { text: '"}}"', line: 4 },
    ])
  })

  it('tokenizes chains, literals and parenthesized fields', () => {
    const tokens = tokenize('(index $x 0).name | default `raw` 1.5 true $.Site.Params.a')
    expect(tokens.map((t) => t.t)).toEqual(['op', 'chain', 'chain', 'num', 'op', 'fields', 'op', 'chain', 'str', 'num', 'bool', 'chain'])
  })

  it('parses control actions and declarations', () => {
    expect(parseAction('else if eq .a "b"').kind).toBe('elseIf')
    const range = parseAction('range $i, $e := site.Params.list')
    expect(range.kind === 'range' && range.pipe.decl).toEqual({ vars: ['$i', '$e'], assign: false })
    const assign = parseAction('$x = .y')
    expect(assign.kind === 'output' && assign.pipe.decl?.assign).toBe(true)
  })
})

describe('scanTemplates', () => {
  it('recognizes the site, page and both scopes', () => {
    const result = scan({
      'layouts/single.html': [
        '{{ site.Params.a }}{{ .Site.Params.b }}{{ $.Site.Params.c }}',
        '{{ .Params.d }}{{ $.Params.e }}',
        '{{ if .Param "f" }}{{ end }}{{ with (.Param "g.h") }}{{ . }}{{ end }}',
        '{{ .Language.Params.i }}{{ site.Language.Params.j }}',
      ].join('\n'),
    })
    expect(param(result, 'a').scopes).toEqual(['site'])
    expect(param(result, 'b').scopes).toEqual(['site'])
    expect(param(result, 'c').scopes).toEqual(['site'])
    expect(param(result, 'd').scopes).toEqual(['page'])
    expect(param(result, 'e').scopes).toEqual(['page'])
    expect(param(result, 'f').scopes).toEqual(['both'])
    expect(param(result, 'g.h').scopes).toEqual(['both'])
    expect(param(result, 'i').scopes).toEqual(['language'])
    expect(param(result, 'j').scopes).toEqual(['language'])
    expect(param(result, 'd').locations).toEqual([{ file: 'layouts/single.html', line: 2 }])
  })

  it('follows with and range rebinding, including nesting and else', () => {
    const result = scan({
      'layouts/_partials/x.html': [
        '{{ with site.Params.social }}',
        '  {{ .twitter }}',
        '  {{ with .facebook_app_id }}{{ . }}{{ else }}{{ .fallback }}{{ end }}',
        '{{ else }}{{ .Params.other }}{{ end }}',
        '{{ range site.Params.socialIcons }}<a href="{{ .url }}" title="{{ .title | default .name }}">{{ end }}',
        '{{ with site.Params.profileMode }}{{ with .buttons }}{{ range . }}{{ .name }}{{ .url }}{{ end }}{{ end }}{{ end }}',
        '{{ range $i, $e := site.Params.SocialIcons }}{{ $e.url }}{{ end }}',
      ].join('\n'),
    })
    expect(param(result, 'social.twitter').scopes).toEqual(['site'])
    expect(param(result, 'social.facebook_app_id').scopes).toEqual(['site'])
    // In the else branch of `with`, the dot is the outer one again.
    expect(param(result, 'social.fallback').scopes).toEqual(['site'])
    expect(param(result, 'other').scopes).toEqual(['page'])
    expect(param(result, 'socialIcons[].url').locations.map((l) => l.line)).toEqual([5, 7])
    expect(param(result, 'socialIcons[].title').scopes).toEqual(['site'])
    expect(param(result, 'profileMode.buttons[].name').scopes).toEqual(['site'])
    expect(param(result, 'profileMode.buttons[].url').key).toBe('profileMode.buttons[].url')
    expect(typeOf(result, 'socialIcons').type).toBe('objectList')
    expect(typeOf(result, 'profileMode').type).toBe('object')
    // The casing used most often wins: socialIcons (2×) over SocialIcons (1×).
    expect(param(result, 'socialIcons').key).toBe('socialIcons')
  })

  it('collects literal defaults in both forms and coerces them by type', () => {
    const result = scan({
      'layouts/head.html': [
        '{{ site.Params.assets.favicon | default "favicon.ico" | absURL }}',
        '{{ .Date | time.Format (default ":date_long" site.Params.DateFormat) }}',
        '{{ $img = $img.Resize (printf "x%d" site.Params.label.iconHeight) }}',
        '<img height="{{- site.Params.label.iconHeight | default "30" -}}">',
        '{{ $x := .Param "editPost.appendFilePath" | default false }}',
      ].join('\n'),
    })
    expect(param(result, 'assets.favicon').defaults).toEqual(['favicon.ico'])
    expect(typeOf(result, 'assets.favicon').type).toBe('image')
    expect(param(result, 'DateFormat').defaults).toEqual([':date_long'])
    expect(typeOf(result, 'DateFormat').type).toBe('dateFormat')
    expect(typeOf(result, 'label.iconHeight')).toMatchObject({ type: 'integer', default: 30 })
    expect(typeOf(result, 'editPost.appendFilePath')).toMatchObject({ type: 'boolean', default: false })
  })

  it('turns eq comparisons into enum candidates, keeping the default as an option', () => {
    const result = scan({
      'layouts/baseof.html': [
        '{{- $theme := site.Params.defaultTheme | default "auto" }}',
        '{{ if eq site.Params.defaultTheme "light" }}{{ else if (eq site.Params.defaultTheme "dark") }}{{ end }}',
        '{{ if (eq site.Params.schema.publisherType "Person") }}{{ end }}',
      ].join('\n'),
    })
    expect(typeOf(result, 'defaultTheme')).toMatchObject({ type: 'enum', options: ['light', 'dark', 'auto'], default: 'auto' })
    // A single compared literal is not enough for a select.
    expect(typeOf(result, 'schema.publisherType').type).toBe('string')
  })

  it('records where comparisons on page params and the string-compare gotcha', () => {
    const result = scan({
      'layouts/list.html': [
        '{{- $pages = where site.RegularPages "Type" "in" site.Params.mainSections }}',
        '{{- $pages = where $pages "Params.hiddenInHomeList" "!=" "true" }}',
        '{{- $pages = where $pages "Params.hiddenInRss" "!=" true -}}',
        '{{ if (ne .Params.disableShare true) }}{{ end }}',
      ].join('\n'),
    })
    const hidden = param(result, 'hiddenInHomeList')
    expect(hidden.scopes).toEqual(['page'])
    expect(hidden.whereCompares).toEqual([{ op: '!=', value: 'true', file: 'layouts/list.html', line: 2 }])
    expect(typeOf(result, 'hiddenInHomeList').type).toBe('boolean')
    expect(param(result, 'hiddenInRss').whereCompares[0].value).toBe(true)
    expect(param(result, 'disableShare').boolCompare).toBe(true)
    expect(typeOf(result, 'mainSections').type).toBe('stringList')
  })

  it('infers types from usage: if/not, range/index, printf %d, markdownify, absURL, resources.Get, in', () => {
    const result = scan({
      'layouts/x.html': [
        '{{ if not site.Params.disableThemeToggle }}{{ end }}',
        '{{ if site.Params.ShowAllPagesInArchive }}{{ end }}',
        '{{ range site.Params.keywords }}{{ . }}{{ end }}',
        '{{ index site.Params.images 0 }}',
        '{{ site.Params.homeInfoParams.Content | markdownify }}',
        '{{ .Params.canonicalURL | absURL }}',
        '{{ $img := resources.Get site.Params.label.icon }}',
        '{{ $b := .Param "ShareButtons" }}{{ if in $b "x" }}{{ end }}{{ if (in $b "linkedin") }}{{ end }}',
        '{{ add site.Params.offset 1 }}',
        '{{ site.Params.label.iconSVG | safeHTML }}{{ if hasPrefix site.Params.label.iconSVG "<svg" }}{{ end }}',
        '{{ site.Params.footer.text }}',
      ].join('\n'),
    })
    expect(typeOf(result, 'disableThemeToggle').type).toBe('boolean')
    expect(typeOf(result, 'ShowAllPagesInArchive').type).toBe('boolean')
    expect(typeOf(result, 'keywords').type).toBe('stringList')
    expect(typeOf(result, 'images').type).toBe('stringList')
    expect(typeOf(result, 'homeInfoParams.Content').type).toBe('markdown')
    expect(typeOf(result, 'canonicalURL').type).toBe('url')
    expect(typeOf(result, 'label.icon').type).toBe('image')
    expect(typeOf(result, 'ShareButtons')).toMatchObject({ type: 'enumList', options: ['x', 'linkedin'] })
    expect(typeOf(result, 'offset').type).toBe('integer')
    expect(typeOf(result, 'label.iconSVG').type).toBe('html')
    expect(typeOf(result, 'footer.text').type).toBe('string')
  })

  it('handles $ and . inside define, partial dict contexts and variables', () => {
    const result = scan({
      'layouts/single.html': [
        '{{ define "main" }}',
        '{{ range .Pages }}{{ $.Params.rootOnly }}{{ .Params.inner }}{{ end }}',
        '{{ partial "cover.html" (dict "cxt" . "IsSingle" true) }}',
        '{{ end }}',
      ].join('\n'),
      'layouts/_partials/cover.html': '{{ with .cxt }}{{ if .Params.cover.image }}{{ .Params.cover.image | absURL }}{{ end }}{{ end }}',
      'layouts/_partials/menu.html': '{{ range site.Menus.main }}{{ .Params.icon }}{{ end }}',
    })
    expect(param(result, 'rootOnly').scopes).toEqual(['page'])
    expect(param(result, 'inner').scopes).toEqual(['page'])
    expect(param(result, 'cover.image').scopes).toEqual(['page'])
    // Menu entry params are not page params.
    expect(result.params.has('icon')).toBe(false)
  })

  it('rescans partials called with a param as context (icon names from svg.html)', () => {
    const result = scan({
      'layouts/_partials/social_icons.html':
        '{{ range site.Params.socialIcons }}<a href="{{ .url }}">{{ partial "svg.html" . }}</a>{{ end }}',
      'layouts/_partials/svg.html': [
        '{{- $icon_name := ( trim .name " " | lower )}}',
        '{{- if (eq $icon_name "github") -}}<svg/>',
        '{{- else if or (eq $icon_name "x") (eq $icon_name "twitter") -}}<svg/>',
        '{{- end -}}',
      ].join('\n'),
      'layouts/_partials/home_info.html':
        '{{ partial "social_icons.html" (dict "align" site.Params.homeInfoParams.AlignSocialIconsTo) }}',
      'layouts/_partials/align.html': '{{ with .align }}{{ . }}{{ end }}',
    })
    expect(param(result, 'socialIcons[].name').compared).toEqual(['github', 'x', 'twitter'])
    expect(param(result, 'socialIcons[].name').locations[0].file).toBe('layouts/_partials/svg.html')
  })

  it('collects i18n keys, special layouts and production gating', () => {
    const result = scan({
      'layouts/footer.html': [
        '{{ i18n "code_copy" | default "copy" }}{{ T "toc" }}',
        '{{- if (and (eq .Kind "page") (ne .Layout "archives") (ne .Layout "search")) }}{{ end }}',
        '{{- if hugo.IsProduction | or (eq site.Params.env "production") }}',
        '  {{ site.Params.analytics.only }}',
        '{{- else }}{{ site.Params.notGated }}',
        '{{- end }}',
        '{{ site.Params.both }}{{ if hugo.IsProduction }}{{ site.Params.both }}{{ end }}',
      ].join('\n'),
    })
    expect([...result.i18nKeys.keys()]).toEqual(['code_copy', 'toc'])
    expect([...result.layouts.keys()].sort()).toEqual(['archives', 'search'])
    expect(param(result, 'analytics.only').productionOnly).toBe(true)
    expect(param(result, 'notGated').productionOnly).toBe(false)
    expect(param(result, 'both').productionOnly).toBe(false)
    expect(param(result, 'env').productionOnly).toBe(false)
  })

  it('reads params passed to js.Build and their defaults in the JS', () => {
    const result = scan({
      'layouts/_partials/head.html':
        '{{ $s := resources.Get "js/fastsearch.js" | js.Build (dict "params" (dict "fuseOpts" site.Params.fuseOpts)) }}',
      'assets/js/fastsearch.js': [
        "import * as params from '@params';",
        'if (!params.fuseOpts) {}',
        'const o = { isCaseSensitive: params.fuseOpts.iscasesensitive ?? false,',
        '  distance: params.fuseOpts.distance ?? 100, keys: params.fuseOpts.keys ?? defaults.keys }',
        'const limit = params.fuseOpts?.limit ? 1 : 0',
      ].join('\n'),
    })
    expect(param(result, 'fuseOpts.iscasesensitive')).toMatchObject({ defaults: [false], fromJs: true, scopes: ['site'] })
    expect(param(result, 'fuseOpts.distance').defaults).toEqual([100])
    expect(param(result, 'fuseOpts.keys').defaults).toEqual([])
    expect(param(result, 'fuseOpts.limit').locations).toEqual([{ file: 'assets/js/fastsearch.js', line: 5 }])
  })

  it('reads index and isset lookups', () => {
    const result = scan({
      'layouts/x.html': '{{ index site.Params "my-key" }}{{ if isset .Params "flag" }}{{ end }}{{ index site.Params.obj "sub" }}',
    })
    expect(param(result, 'my-key').scopes).toEqual(['site'])
    expect(param(result, 'flag').scopes).toEqual(['page'])
    expect(param(result, 'obj.sub').scopes).toEqual(['site'])
  })
})

describe('typeFromName', () => {
  it('follows the CloudCannon-style naming rules', () => {
    expect(typeFromName('ShowReadingTime')).toBe('boolean')
    expect(typeFromName('disableShare')).toBe('boolean')
    expect(typeFromName('useHugoToc')).toBe('boolean')
    expect(typeFromName('username')).toBeNull()
    expect(typeFromName('assets.theme_color', '#2e2e33')).toBe('color')
    expect(typeFromName('colorScheme', 'blowfish')).toBeNull()
    expect(typeFromName('editPost.URL')).toBe('url')
    expect(typeFromName('label.iconHeight')).toBe('integer')
    expect(typeFromName('profileMode.imageUrl')).toBe('url')
    expect(typeFromName('cover.image')).toBe('image')
  })
})
