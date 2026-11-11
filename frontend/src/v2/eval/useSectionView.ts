import { useEffect } from 'react'
import { track } from './track'

/** Emit screen_view{route, section} whenever the section (settings section / kid tab) changes. */
export function useSectionView(route: string, section: string, kid = false): void {
  useEffect(() => {
    track('screen_view', { route, section }, { kid })
  }, [route, section, kid])
}
