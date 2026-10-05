import { api } from '../../lib/api'

export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'avif', 'bmp', 'tif', 'tiff']

export interface SiteAsset {
  /** The value to write: the path inside static/ or assets/. */
  value: string
  root: 'static' | 'assets'
}

let cache: { images: boolean; list: Promise<SiteAsset[]> }[] = []

/** Files under static/ and assets/ (images only for image fields), loaded once per screen visit. */
export function loadSiteAssets(images: boolean): Promise<SiteAsset[]> {
  const cached = cache.find((c) => c.images === images)
  if (cached) return cached.list
  const ext = images ? IMAGE_EXTENSIONS : []
  const list = Promise.all(
    (['static', 'assets'] as const).map(async (root) =>
      (await api.listFiles(root, ext).catch(() => [])).map((f) => ({ value: f.path.slice(root.length + 1), root })),
    ),
  ).then((lists) => lists.flat())
  cache = [...cache, { images, list }]
  return list
}

export function resetAssetCache() {
  cache = []
}
