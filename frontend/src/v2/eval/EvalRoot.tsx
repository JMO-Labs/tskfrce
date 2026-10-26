import { useScreenViews } from './useScreenViews'

/** Mounted once in _app. The feedback drawer joins it later. */
export function EvalRoot(): null {
  useScreenViews()
  return null
}
