import { useHours } from '@/v2/hooks/useHours'
import { usePlaces } from '@/v2/hooks/useNotify'
import { useParents } from '@/v2/hooks/useFamily'
import { countLine } from './settingsMeta'

type Id = 'family' | 'hours' | 'notifications' | 'parents'

/** Live sub-lines for the settings lists (/settings and the phone More page); undefined = keep the static one. */
export function useSettingsLines(): Record<Id, string | undefined> {
  const parents = useParents().data
  const places = usePlaces().data
  const rules = useHours().data?.rules
  const count = (a: unknown[] | undefined) => (Array.isArray(a) ? a.length : undefined)
  return {
    family: undefined, // the home box line moved to Devices with the Network row
    hours: countLine(count(rules), 'rule'),
    notifications: count(places) ? `${countLine(count(places), 'place')} connected` : undefined,
    parents: countLine(count(parents), 'parent'),
  }
}
