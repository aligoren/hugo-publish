// A change to a whole file, reviewed as a diff before it is written.

export interface FileChange {
  path: string
  before: string
  after: string
  /** Version read with `before` (conflict check); '' creates the file and fails if it exists. */
  version: string
  /** Renames the file to this path after every write succeeded (`api.renameFile`, never overwrites). */
  moveTo?: string
  /** Load the site with this text through `hugo config` before writing (config files only). */
  validate?: boolean
}
