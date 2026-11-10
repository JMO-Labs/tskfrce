/** Mantine transition props that turn animation off under prefers-reduced-motion. */
export function motionProps(): { duration?: number } {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? { duration: 0 } : {}
}
