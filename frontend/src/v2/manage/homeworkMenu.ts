import type { MenuItem } from '@/v2/parent/MoreMenu'

export const HOMEWORK_MINUTES = [30, 60, 90, 120]
export const minutesText = (m: number) => (m % 60 ? `${m} min` : m === 60 ? '1 hour' : `${m / 60} hours`)

/** "…" menu entries that start homework mode (homework sites stay on; may take a minute to start).
 *  Hidden while the target is open: homework mode only loosens a lock. */
export function homeworkItems(o: { hidden: boolean; disabled?: boolean; onStart: (minutes: number) => void }): MenuItem[] {
  return HOMEWORK_MINUTES.map((m, i) => ({
    label: `Homework ${minutesText(m)}`,
    icon: 'menu_book',
    divider: i === 0,
    hidden: o.hidden,
    disabled: o.disabled,
    onClick: () => o.onStart(m),
  }))
}
