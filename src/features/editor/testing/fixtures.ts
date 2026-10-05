// Test-only: the synthetic Markdown corpus in fixtures/markdown, loaded byte for
// byte (BOM, CRLF and missing trailing newlines survive Vite's `?raw` import).

const modules = import.meta.glob('../../../../fixtures/markdown/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

/** File name → exact file content. */
export const markdownFixtures: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(modules).map(([path, content]) => [path.slice(path.lastIndexOf('/') + 1), content]),
)

export function fixture(name: string): string {
  const content = markdownFixtures[name]
  if (content === undefined) throw new Error(`Unknown fixture: ${name}`)
  return content
}
