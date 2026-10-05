/** Same keys as `T`, any string values: the type a translation of `T` must have. */
export type Strings<T> = { [K in keyof T]: T[K] extends string ? string : Strings<T[K]> }

/** Strings of one feature, registered in src/i18n/index.ts under its namespace key. */
export interface FeatureMessages<T> {
  en: T
  tr: Strings<T>
}
