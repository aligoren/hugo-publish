import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls: string[] = []
const resolvers: ((value: unknown) => void)[] = []

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn((command: string) => {
    calls.push(command)
    return new Promise((resolve) => resolvers.push(resolve))
  }),
}))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }))

const { api } = await import('./api')

beforeEach(() => {
  calls.length = 0
  resolvers.length = 0
})

describe('configEffective', () => {
  it('shares a running request and asks again once it is done', async () => {
    const first = api.configEffective()
    const second = api.configEffective()
    expect(calls).toEqual(['config_effective'])
    resolvers[0]({ values: { title: 'A' }, messages: [] })
    expect(await first).toBe(await second)

    const third = api.configEffective()
    expect(calls).toEqual(['config_effective', 'config_effective'])
    resolvers[1]({ values: {}, messages: [] })
    await third
  })

  it('does not share across environments or across a write', async () => {
    void api.configEffective()
    void api.configEffective('development')
    expect(calls).toEqual(['config_effective', 'config_effective'])
    void api.writeText('hugo.toml', 'title = "B"', 'v1')
    void api.configEffective()
    expect(calls).toEqual(['config_effective', 'config_effective', 'site_write_text', 'config_effective'])
  })
})
