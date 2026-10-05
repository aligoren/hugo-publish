// Curated theme profiles shipped with the app. PaperMod is the reference; the rest cover each
// theme's main settings. Any other theme still works through scanning and its own defaults.
import type { ThemeSchema } from '../schema'
import { ananke } from './ananke'
import { blowfish } from './blowfish'
import { hugoBook } from './hugoBook'
import { papermod } from './papermod'
import { stack } from './stack'

export const curatedSchemas: ThemeSchema[] = [papermod, blowfish, stack, hugoBook, ananke]
