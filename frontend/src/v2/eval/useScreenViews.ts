import { useEffect } from 'react'
import { useRouter } from 'next/router'
import { track } from './track'

export const routePattern = (pathname: string): string => (pathname === '/[...slug]' ? '/404' : pathname)

export function useScreenViews(): void {
  const router = useRouter()
  useEffect(() => {
    const view = () => {
      const route = routePattern(router.pathname)
      track('screen_view', { route }, { kid: route === '/kid' })
    }
    view()
    router.events.on('routeChangeComplete', view)
    return () => router.events.off('routeChangeComplete', view)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
