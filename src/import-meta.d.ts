export type ImportMetaGlob = ImportMeta["glob"];

declare global {
  interface ImportMeta {
    glob<T = unknown>(pattern: string): Record<string, () => Promise<T>>;
    glob<T = unknown>(patterns: string[]): Record<string, () => Promise<T>>;
  }
}
