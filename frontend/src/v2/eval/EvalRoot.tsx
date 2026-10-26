import { FeedbackDrawer } from './FeedbackDrawer'
import { useScreenViews } from './useScreenViews'

/** Mounted once in _app. */
export function EvalRoot() {
  useScreenViews()
  return <FeedbackDrawer />
}
