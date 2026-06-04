/**
 * Utility: class name merger.
 * Joins class strings, filtering out falsy values.
 * Lightweight alternative to clsx/classnames — no extra dependency needed.
 */
export function cn(...classes: (string | undefined | null | false)[]): string {
  return classes.filter(Boolean).join(" ");
}
