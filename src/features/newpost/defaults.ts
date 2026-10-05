// The folder and type last used for a new post, per site, so the next one needs only a title.

export interface NewPostDefaults {
  section?: string
  kind?: string
}

export const NEW_POST_DEFAULTS_KEY = 'hugo-publisher.newPost'

function readAll(): Record<string, NewPostDefaults> {
  try {
    const raw = localStorage.getItem(NEW_POST_DEFAULTS_KEY)
    const data = raw ? (JSON.parse(raw) as unknown) : null
    return data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, NewPostDefaults>) : {}
  } catch {
    return {}
  }
}

export function loadNewPostDefaults(siteRoot: string): NewPostDefaults {
  const entry = readAll()[siteRoot]
  if (!entry || typeof entry !== 'object') return {}
  return {
    section: typeof entry.section === 'string' ? entry.section : undefined,
    kind: typeof entry.kind === 'string' ? entry.kind : undefined,
  }
}

export function saveNewPostDefaults(siteRoot: string, defaults: NewPostDefaults) {
  try {
    localStorage.setItem(NEW_POST_DEFAULTS_KEY, JSON.stringify({ ...readAll(), [siteRoot]: defaults }))
  } catch {
    // Not remembered; the dialog falls back to the busiest folder next time.
  }
}
