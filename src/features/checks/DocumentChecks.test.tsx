// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '../../i18n'
import { SiteContext } from '../site/SiteContext'
import { clearCheckContextCache } from './context'
import { ChecksPanel, DocumentChecks } from './DocumentChecks'
import type { CheckIssue } from './runChecks'
import { testSiteContext } from './testing'

const api = vi.hoisted(() => ({ listArchetypes: vi.fn(), readText: vi.fn() }))
vi.mock('../../lib/api', async (importOriginal) => ({ ...(await importOriginal<object>()), api }))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const context = testSiteContext()

const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})

beforeEach(async () => {
  await i18n.changeLanguage('en')
  clearCheckContextCache()
  api.listArchetypes.mockResolvedValue([{ name: 'galeri', path: 'archetypes/galeri', source: 'site' }])
  api.readText.mockImplementation(async (path: string) => {
    if (path === 'archetypes/galeri/index.md') return { text: '---\ntitle: x\n---\nDescribe the gallery in a few sentences here.\n', version: 'v' }
    throw { code: 'io', message: 'missing' }
  })
})

describe('DocumentChecks', () => {
  it('lists issues, including text left from a bundle archetype', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const text = '---\r\ntitle: ""\r\n---\r\nDescribe the gallery in a few sentences here.\r\n'
    await act(async () =>
      root.render(
        <SiteContext.Provider value={context}>
          <DocumentChecks path="content/posts/a/index.md" text={text} />
        </SiteContext.Provider>,
      ),
    )
    await act(async () => {})
    cleanups.push(() => {
      act(() => root.unmount())
      container.remove()
    })
    const items = [...container.querySelectorAll('li')].map((li) => li.textContent)
    expect(items).toEqual([
      'The title is missing.',
      'Left over from the template: “Describe the gallery in a few sentences here.”line 4',
    ])
    expect(container.querySelector('details')!.open).toBe(true)
  })
})

describe('ChecksPanel', () => {
  it('makes every issue a button that leads to it, and says when there is nothing to fix', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    cleanups.push(() => {
      act(() => root.unmount())
      container.remove()
    })
    const onSelect = vi.fn()
    const issues: CheckIssue[] = [
      { rule: 'description-empty', severity: 'warn', messageKey: 'rules.descriptionEmpty' },
      { rule: 'placeholder', severity: 'warn', messageKey: 'rules.placeholder', params: { text: '[TODO]' }, line: 7 },
    ]
    await act(async () => root.render(<ChecksPanel issues={issues} onSelect={onSelect} />))
    const buttons = [...container.querySelectorAll('li > button')] as HTMLButtonElement[]
    expect(buttons.map((b) => b.title)).toEqual(['Show this setting', 'Go to line 7'])
    act(() => buttons[1].click())
    expect(onSelect).toHaveBeenCalledWith(issues[1])

    await act(async () => root.render(<ChecksPanel issues={[]} onSelect={onSelect} />))
    expect(container.textContent).toContain('Nothing to fix. The post is ready.')
  })
})
