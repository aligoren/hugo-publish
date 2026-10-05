// A commit message that says what changed, in the UI language.

import { displayName, isImage, type ChangeAction, type ChangeItem } from './groups'

export type Translate = (key: string, options?: Record<string, unknown>) => string

const ACTIONS: readonly ChangeAction[] = ['added', 'updated', 'deleted']
const ACTION_KEY: Record<ChangeAction, string> = { added: 'Added', updated: 'Updated', deleted: 'Deleted' }

/**
 * Suggests a commit message for the selected changes, e.g. "Yazı eklendi: Başlık" or
 * "Add post: Title; update site settings". Several posts get a count in the subject and one line
 * each in the body. `language` decides how later parts are lowercased.
 */
export function suggestCommitMessage(items: ChangeItem[], t: Translate, language = 'en'): string {
  const parts: string[] = []
  const content = items.filter((i) => i.group === 'content')

  for (const isPage of [false, true]) {
    const noun = isPage ? 'page' : 'post'
    for (const action of ACTIONS) {
      const matching = content.filter((i) => i.isPage === isPage && i.action === action)
      if (matching.length === 1) {
        parts.push(t(`publish.commitMsg.${noun}${ACTION_KEY[action]}`, { title: titleOf(matching[0]) }))
      } else if (matching.length > 1) {
        parts.push(t(`publish.commitMsg.${noun}s${ACTION_KEY[action]}`, { count: matching.length }))
      }
    }
  }

  // Media right after the posts: images usually come with them.
  const media = items.filter((i) => i.group === 'media')
  if (media.length > 0) {
    const allAdded = media.every((i) => i.action === 'added')
    const allDeleted = media.every((i) => i.action === 'deleted')
    const images = media.every((i) => isImage(i.file.path))
    const count = media.length
    if (allAdded) parts.push(t(images ? 'publish.commitMsg.imagesAdded' : 'publish.commitMsg.mediaAdded', { count }))
    else if (allDeleted) parts.push(t(images ? 'publish.commitMsg.imagesDeleted' : 'publish.commitMsg.mediaDeleted', { count }))
    else parts.push(t('publish.commitMsg.mediaUpdated', { count }))
  }

  if (items.some((i) => i.group === 'settings')) parts.push(t('publish.commitMsg.settings'))
  if (items.some((i) => i.group === 'theme')) parts.push(t('publish.commitMsg.theme'))
  if (items.some((i) => i.group === 'other')) parts.push(t('publish.commitMsg.other'))

  const subject = parts.map((part, index) => (index === 0 ? part : lowerFirst(part, language))).join('; ')
  if (content.length < 2) return subject

  const body = ACTIONS.flatMap((action) =>
    content
      .filter((i) => i.action === action)
      .map((i) => `- ${t(`publish.commitMsg.line${ACTION_KEY[action]}`, { title: titleOf(i) })}`),
  )
  return `${subject}\n\n${body.join('\n')}`
}

function titleOf(item: ChangeItem): string {
  return item.title ?? displayName(item.file.path)
}

function lowerFirst(text: string, language: string): string {
  const [first = '', ...rest] = text
  return first.toLocaleLowerCase(language) + rest.join('')
}
