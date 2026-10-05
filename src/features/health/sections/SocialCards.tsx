// Mock share cards and a search result, drawn from a page's own <head>. Remote images cannot be
// shown (the app's content security policy blocks them), so images appear as placeholders, or
// from the local preview server when it runs.

import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { previewUrl } from '../../../lib/api'
import { bareHost } from '../lib/content'
import type { PageMeta } from '../lib/html'
import { LIMITS, truncate, xCard, type CardInfo } from '../lib/socialCard'

export interface ImageContext {
  /** Host of the site's baseURL. */
  siteHost: string | null
  /** URL of the running preview server, if any. */
  serverUrl: string | null
}

/** An image slot: the real image from the preview server when possible, else its address. */
function CardImage({ url, alt, context, className }: { url: string | null; alt: string | null; context: ImageContext; className: string }) {
  const { t } = useTranslation()
  const [failed, setFailed] = useState(false)
  let local: string | null = null
  let shown = url
  if (url) {
    try {
      const parsed = new URL(url, 'https://site.invalid/')
      const onSite = parsed.hostname === 'site.invalid' || (context.siteHost !== null && bareHost(parsed.hostname) === bareHost(context.siteHost))
      if (onSite) {
        shown = parsed.pathname
        if (context.serverUrl) local = previewUrl(context.serverUrl, parsed.toString())
      }
    } catch {
      // Shown as written.
    }
  }
  if (local && !failed) {
    return <img src={local} alt={alt ?? ''} className={`object-cover ${className}`} onError={() => setFailed(true)} />
  }
  return (
    <div
      className={`flex items-center justify-center bg-zinc-200 p-2 text-center text-[11px] text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400 ${className}`}
    >
      {shown ? (
        <span className="break-all">
          {t('health.social.image')}
          <br />
          <span className="font-mono">{shown}</span>
        </span>
      ) : (
        t('health.social.noImage')
      )}
    </div>
  )
}

function Frame({ label, children }: { label: string; children: ReactNode }) {
  return (
    <figure className="space-y-1">
      <figcaption className="text-xs font-medium text-zinc-500">{label}</figcaption>
      {children}
    </figure>
  )
}

export function XCardMock({ meta, info, context }: { meta: PageMeta; info: CardInfo; context: ImageContext }) {
  const card = xCard(meta, info)
  if (card.large) {
    return (
      <Frame label="X">
        <div className="relative overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-700">
          <CardImage url={card.image} alt={info.imageAlt} context={context} className="aspect-[1.91/1] w-full" />
          <span className="absolute bottom-2 left-2 max-w-[90%] truncate rounded bg-black/60 px-1.5 py-0.5 text-xs text-white">
            {truncate(card.title, LIMITS.cardTitle)}
          </span>
        </div>
        <p className="text-xs text-zinc-500">{info.domain}</p>
      </Frame>
    )
  }
  return (
    <Frame label="X">
      <div className="flex overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-700">
        <CardImage url={card.image} alt={info.imageAlt} context={context} className="size-24 shrink-0" />
        <div className="min-w-0 space-y-0.5 p-3 text-sm">
          <p className="text-xs text-zinc-500">{info.domain}</p>
          <p className="truncate">{card.title}</p>
          <p className="line-clamp-2 text-xs text-zinc-500">{card.description}</p>
        </div>
      </div>
    </Frame>
  )
}

export function FacebookCardMock({ info, context }: { info: CardInfo; context: ImageContext }) {
  return (
    <Frame label="Facebook">
      <div className="overflow-hidden border border-zinc-300 bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800">
        <CardImage url={info.image} alt={info.imageAlt} context={context} className="aspect-[1.91/1] w-full" />
        <div className="space-y-0.5 px-3 py-2">
          <p className="text-[11px] uppercase text-zinc-500">{info.domain}</p>
          <p className="line-clamp-2 font-semibold">{info.title}</p>
          <p className="truncate text-sm text-zinc-500">{info.description}</p>
        </div>
      </div>
    </Frame>
  )
}

export function LinkedInCardMock({ info, context }: { info: CardInfo; context: ImageContext }) {
  return (
    <Frame label="LinkedIn">
      <div className="overflow-hidden rounded-md border border-zinc-200 dark:border-zinc-700">
        <CardImage url={info.image} alt={info.imageAlt} context={context} className="aspect-[1.91/1] w-full" />
        <div className="space-y-0.5 bg-zinc-50 px-3 py-2 dark:bg-zinc-900">
          <p className="line-clamp-2 text-sm font-semibold">{info.title}</p>
          <p className="text-xs text-zinc-500">{info.domain}</p>
        </div>
      </div>
    </Frame>
  )
}

export function WhatsAppCardMock({ info, context }: { info: CardInfo; context: ImageContext }) {
  return (
    <Frame label="WhatsApp">
      <div className="rounded-lg bg-emerald-100 p-1.5 dark:bg-emerald-950">
        <div className="flex overflow-hidden rounded-md bg-emerald-50 dark:bg-emerald-900/60">
          <CardImage url={info.image} alt={info.imageAlt} context={context} className="size-20 shrink-0" />
          <div className="min-w-0 space-y-0.5 p-2 text-sm">
            <p className="line-clamp-2 font-semibold">{info.title}</p>
            <p className="line-clamp-2 text-xs text-zinc-600 dark:text-zinc-300">{info.description}</p>
            <p className="text-[11px] text-zinc-500">{info.domain}</p>
          </div>
        </div>
      </div>
    </Frame>
  )
}

export function TelegramCardMock({ info, context }: { info: CardInfo; context: ImageContext }) {
  return (
    <Frame label="Telegram">
      <div className="space-y-1 border-l-2 border-sky-500 pl-2 text-sm">
        <p className="font-semibold text-sky-700 dark:text-sky-400">{info.siteName ?? info.domain}</p>
        <p className="font-semibold">{info.title}</p>
        <p className="line-clamp-3 text-zinc-600 dark:text-zinc-300">{info.description}</p>
        <CardImage url={info.image} alt={info.imageAlt} context={context} className="aspect-[1.91/1] w-full rounded" />
      </div>
    </Frame>
  )
}

export function SearchResultMock({ meta, info }: { meta: PageMeta; info: CardInfo }) {
  const title = meta.title || info.title
  const description = meta.description || ''
  let crumbs = info.url
  try {
    const parsed = new URL(info.url)
    crumbs = [parsed.hostname, ...parsed.pathname.split('/').filter(Boolean)].join(' › ')
  } catch {
    // Shown as written.
  }
  return (
    <Frame label="Google">
      <div className="space-y-0.5 text-sm">
        <p className="text-xs text-zinc-600 dark:text-zinc-400">
          {info.siteName && <span className="mr-1 text-zinc-800 dark:text-zinc-200">{info.siteName}</span>}
          {crumbs}
        </p>
        <p className="text-lg text-[#1a0dab] dark:text-sky-300">{truncate(title, LIMITS.searchTitle)}</p>
        <p className="text-zinc-600 dark:text-zinc-400">{truncate(description, LIMITS.searchDescription)}</p>
      </div>
    </Frame>
  )
}
