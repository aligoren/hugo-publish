// Third-party requests in built pages, grouped by host, with known services named.

import { bareHost } from './content'
import { extractCssUrls, extractResources, type PageResource, type ResourceKind } from './html'

/** What to suggest for a kind of service (`health.privacy.tips.<tip>`). */
export type PrivacyTip =
  | 'fonts'
  | 'analytics'
  | 'youtube'
  | 'vimeo'
  | 'x'
  | 'instagram'
  | 'disqus'
  | 'comments'
  | 'cdn'
  | 'gravatar'
  | 'social'
  | 'ads'
  | 'maps'
  | 'compromised'

export interface KnownService {
  name: string
  tip: PrivacyTip
  /** The host and its subdomains. */
  domains: string[]
}

export const KNOWN_SERVICES: KnownService[] = [
  { name: 'Google Fonts', tip: 'fonts', domains: ['fonts.googleapis.com', 'fonts.gstatic.com'] },
  { name: 'Adobe Fonts', tip: 'fonts', domains: ['use.typekit.net', 'p.typekit.net'] },
  { name: 'Font Awesome', tip: 'cdn', domains: ['use.fontawesome.com', 'kit.fontawesome.com', 'ka-f.fontawesome.com', 'ka-p.fontawesome.com'] },
  {
    name: 'Google Analytics / Tag Manager',
    tip: 'analytics',
    domains: ['google-analytics.com', 'googletagmanager.com', 'analytics.google.com', 'region1.google-analytics.com'],
  },
  { name: 'Google AdSense', tip: 'ads', domains: ['googlesyndication.com', 'googleadservices.com', 'doubleclick.net', 'adservice.google.com'] },
  { name: 'Google Maps', tip: 'maps', domains: ['maps.googleapis.com', 'maps.gstatic.com', 'maps.google.com'] },
  { name: 'Google Hosted Libraries', tip: 'cdn', domains: ['ajax.googleapis.com'] },
  { name: 'YouTube', tip: 'youtube', domains: ['youtube.com', 'youtube-nocookie.com', 'ytimg.com', 'youtu.be', 'googlevideo.com'] },
  { name: 'Vimeo', tip: 'vimeo', domains: ['vimeo.com', 'vimeocdn.com'] },
  { name: 'X (Twitter)', tip: 'x', domains: ['twitter.com', 'x.com', 'twimg.com', 'twttr.com'] },
  { name: 'Instagram', tip: 'instagram', domains: ['instagram.com', 'cdninstagram.com'] },
  { name: 'Facebook', tip: 'social', domains: ['facebook.com', 'facebook.net', 'fbcdn.net'] },
  { name: 'LinkedIn', tip: 'social', domains: ['linkedin.com', 'licdn.com'] },
  { name: 'AddThis / ShareThis', tip: 'social', domains: ['addthis.com', 'sharethis.com'] },
  { name: 'Disqus', tip: 'disqus', domains: ['disqus.com', 'disquscdn.com'] },
  { name: 'giscus', tip: 'comments', domains: ['giscus.app'] },
  { name: 'utterances', tip: 'comments', domains: ['utteranc.es'] },
  { name: 'cdnjs', tip: 'cdn', domains: ['cdnjs.cloudflare.com'] },
  { name: 'jsDelivr', tip: 'cdn', domains: ['jsdelivr.net'] },
  { name: 'unpkg', tip: 'cdn', domains: ['unpkg.com'] },
  { name: 'jQuery CDN', tip: 'cdn', domains: ['code.jquery.com'] },
  { name: 'Bootstrap CDN', tip: 'cdn', domains: ['stackpath.bootstrapcdn.com', 'maxcdn.bootstrapcdn.com', 'bootstrapcdn.com'] },
  { name: 'polyfill.io', tip: 'compromised', domains: ['polyfill.io', 'cdn.polyfill.io'] },
  { name: 'Gravatar', tip: 'gravatar', domains: ['gravatar.com', 'gravatar.wp.com'] },
  { name: 'Cloudflare Web Analytics', tip: 'analytics', domains: ['cloudflareinsights.com'] },
  { name: 'Plausible', tip: 'analytics', domains: ['plausible.io'] },
  { name: 'Fathom', tip: 'analytics', domains: ['usefathom.com'] },
  { name: 'Matomo Cloud', tip: 'analytics', domains: ['matomo.cloud'] },
  { name: 'Hotjar', tip: 'analytics', domains: ['hotjar.com', 'hotjar.io'] },
  { name: 'Microsoft Clarity', tip: 'analytics', domains: ['clarity.ms'] },
  { name: 'Yandex Metrica', tip: 'analytics', domains: ['mc.yandex.ru', 'mc.yandex.com'] },
  { name: 'MathJax CDN', tip: 'cdn', domains: ['cdn.mathjax.org'] },
]

/** The known service a host belongs to (the host itself or a subdomain of a listed domain). */
export function knownService(host: string): KnownService | null {
  const h = host.toLowerCase()
  return KNOWN_SERVICES.find((service) => service.domains.some((d) => h === d || h.endsWith(`.${d}`))) ?? null
}

/** The absolute http(s) URL of a resource on a page, or null when it is not a web URL. */
export function absoluteUrl(url: string, pageUrl: string): URL | null {
  try {
    const parsed = new URL(url, pageUrl)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed : null
  } catch {
    return null
  }
}

/** True when `host` is not the site's own host (`www.` ignored). */
export function isThirdParty(host: string, siteHost: string | null): boolean {
  if (!siteHost) return true
  return bareHost(host) !== bareHost(siteHost)
}

export interface ThirdPartyHost {
  host: string
  service: KnownService | null
  kinds: ResourceKind[]
  /** Output files (pages or stylesheets) that load something from this host. */
  files: string[]
  /** A few distinct URLs, for showing. */
  urls: string[]
  /** Total number of references. */
  count: number
}

const MAX_URLS = 5

/** Collects third-party requests file by file. */
export class PrivacyAudit {
  private readonly hosts = new Map<string, ThirdPartyHost>()
  private readonly siteUrl: string
  private readonly siteHost: string | null

  constructor(siteUrl: string, siteHost: string | null) {
    this.siteUrl = siteUrl
    this.siteHost = siteHost
  }

  /** Adds one built file (`.html` or `.css`). */
  add(path: string, text: string): void {
    const fileUrl = new URL(path, this.siteUrl.endsWith('/') ? this.siteUrl : `${this.siteUrl}/`).toString()
    const resources: PageResource[] = path.toLowerCase().endsWith('.css')
      ? extractCssUrls(text)
      : extractResources(text, (host) => knownService(host) !== null && isThirdParty(host, this.siteHost))
    for (const resource of resources) {
      const url = absoluteUrl(resource.url, fileUrl)
      if (!url || !isThirdParty(url.hostname, this.siteHost)) continue
      const host = url.hostname.toLowerCase()
      let entry = this.hosts.get(host)
      if (!entry) {
        entry = { host, service: knownService(host), kinds: [], files: [], urls: [], count: 0 }
        this.hosts.set(host, entry)
      }
      entry.count++
      if (!entry.kinds.includes(resource.kind)) entry.kinds.push(resource.kind)
      if (!entry.files.includes(path)) entry.files.push(path)
      const shown = url.toString()
      if (entry.urls.length < MAX_URLS && !entry.urls.includes(shown)) entry.urls.push(shown)
    }
  }

  /** Hosts, known services first, then by how many files use them. */
  result(): ThirdPartyHost[] {
    return [...this.hosts.values()].sort(
      (a, b) =>
        Number(b.service !== null) - Number(a.service !== null) || b.files.length - a.files.length || a.host.localeCompare(b.host),
    )
  }
}

/** Hosts grouped under their service (unknown hosts on their own). */
export function groupByService(hosts: ThirdPartyHost[]): { key: string; service: KnownService | null; hosts: ThirdPartyHost[] }[] {
  const groups = new Map<string, { key: string; service: KnownService | null; hosts: ThirdPartyHost[] }>()
  for (const host of hosts) {
    const key = host.service?.name ?? host.host
    const group = groups.get(key) ?? { key, service: host.service, hosts: [] }
    group.hosts.push(host)
    groups.set(key, group)
  }
  return [...groups.values()]
}

/** Whether a git email hides the address (GitHub's noreply addresses). */
export function isNoreplyEmail(email: string): boolean {
  return /@users\.noreply\.github\.com$/i.test(email.trim()) || /^noreply@/i.test(email.trim())
}

export interface PrivacySetting {
  /** Service key as Hugo prints it (lower-case), e.g. `youtube`. */
  service: string
  disabled: boolean
  /** Other boolean options of the service and their values, e.g. `privacyenhanced: true`. */
  options: Record<string, boolean>
}

/** Hugo's `[privacy]` settings from the effective config (keys are lower-case there). */
export function privacySettings(values: Record<string, unknown> | null | undefined): PrivacySetting[] {
  const privacy = values?.privacy
  if (!privacy || typeof privacy !== 'object') return []
  return Object.entries(privacy as Record<string, unknown>)
    .filter(([, v]) => v && typeof v === 'object')
    .map(([service, v]) => {
      const entries = Object.entries(v as Record<string, unknown>).filter(([, x]) => typeof x === 'boolean') as [string, boolean][]
      const options = Object.fromEntries(entries.filter(([k]) => k !== 'disable'))
      return { service, disabled: entries.some(([k, x]) => k === 'disable' && x), options }
    })
    .sort((a, b) => a.service.localeCompare(b.service))
}
