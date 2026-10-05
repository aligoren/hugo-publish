import type { ParityWarning } from './parity'
import { SITE_TOML } from './siteToml'

type Translate = (key: string, options?: Record<string, unknown>) => string

/** The user-facing sentence for a parity warning. */
export function warningText(t: Translate, warning: ParityWarning): string {
  switch (warning.kind) {
    case 'noActive':
      return t('hugo.warnings.noActive')
    case 'invalidPin':
      return t('hugo.warnings.invalidPin', { value: warning.value, file: SITE_TOML })
    case 'activeNotPinned':
      return t('hugo.warnings.activeNotPinned', { ...warning })
    case 'themeTooNew':
      return t(`hugo.warnings.themeTooNew.${warning.assumed ? 'hostingAssumed' : warning.target}`, { ...warning })
    case 'themeNeedsExtended':
      return t('hugo.warnings.themeNeedsExtended', { ...warning })
    case 'featureTooNew':
      return t(`hugo.warnings.featureTooNew.${warning.assumed ? 'hostingAssumed' : warning.target}`, { ...warning })
    case 'hostingMissing':
      return t('hugo.warnings.hostingMissing', { ...warning })
    case 'hostingDiffers':
      return t(`hugo.warnings.hostingDiffers.${warning.localKind}`, { ...warning })
  }
}
