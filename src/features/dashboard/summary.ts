// Counting pages by publication state for the dashboard.
import type { ContentFile, PageEntry } from '../../lib/api'

const ZERO_DATE = '0001-01-01'

export interface PageCounts {
  published: number
  drafts: number
  scheduled: number
  expired: number
}

const isSet = (date: string) => !!date && !date.startsWith(ZERO_DATE)

/** Regular pages (not sections or taxonomy pages) by state, at the moment `now` (ISO string). */
export function countPages(pages: PageEntry[], now: string): PageCounts {
  const counts: PageCounts = { published: 0, drafts: 0, scheduled: 0, expired: 0 }
  for (const page of pages) {
    if (page.kind !== 'page') continue
    if (page.draft) counts.drafts++
    else if (isSet(page.publishDate) && toTime(page.publishDate) > toTime(now)) counts.scheduled++
    else if (isSet(page.expiryDate) && toTime(page.expiryDate) < toTime(now)) counts.expired++
    else counts.published++
  }
  return counts
}

function toTime(date: string): number {
  const time = Date.parse(date)
  return Number.isNaN(time) ? 0 : time
}

/** The most recently modified content files. */
export function recentlyEdited(files: ContentFile[], limit = 8): ContentFile[] {
  return [...files].sort((a, b) => b.modifiedMs - a.modifiedMs).slice(0, limit)
}

/** Suggested backup file name: `<site>-backup-YYYY-MM-DD.zip`. */
export function backupFileName(siteName: string, date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  return `${siteName || 'site'}-backup-${day}.zip`
}
