import Link from 'next/link'
import { useDevices } from '../hooks/useDevices'
import { useIntegrationWidgets } from '../hooks/useIntegrationWidgets'
import { useToday } from '../hooks/useToday'
import { IntegrationWidgets } from '../integrations/WidgetFrame'
import { Chip } from '../parent/Chip'
import { Icon } from '../parent/Icon'
import { SummaryRow } from '../parent/SummaryRow'
import type { Focus } from '../parent/useFocusParam'

/** "Devices · N online": who is on the network now, tucked into one row. */
export function DevicesRow({ focus }: { focus: Focus }) {
  const devices = useDevices().data
  const kids = useToday().data?.kids ?? []
  if (!devices?.length) return null
  const online = devices.filter((d) => d.seen_now).length
  return (
    <SummaryRow id="devices" icon={<Icon name="devices" size={18} />} title="Devices" summary={`${online} online`} focus={focus}>
      {kids.map((k) => {
        const mine = devices.filter((d) => d.owner_ids.includes(k.id))
        return mine.length ? (
          <div key={k.id}>
            <div className="p-sec-h">{k.name}</div>
            <div className="pt-dlist">
              {mine.map((d) => (
                <div key={d.id} className="pt-drow">
                  <b className="p-kn">{d.name}</b>
                  {d.exempt ? <Chip tone="lav" icon="verified_user">Exempt</Chip> : d.online ? <Chip tone="acc" icon="lock_open">Open</Chip> : <Chip tone="grey" icon="lock">Locked</Chip>}
                </div>
              ))}
            </div>
          </div>
        ) : null
      })}
      <Link href="/devices" className="pt-klink">
        Open Devices
        <Icon name="chevron_right" size={16} />
      </Link>
    </SummaryRow>
  )
}

/** "Add-ons": integration widgets, one row; hidden when there are none. */
export function AddonsRow({ focus }: { focus: Focus }) {
  const n = useIntegrationWidgets('parent').data?.length ?? 0
  if (!n) return null
  return (
    <SummaryRow id="addons" icon={<Icon name="extension" size={18} />} title="Add-ons" summary={`${n} add-on${n === 1 ? '' : 's'}`} focus={focus}>
      <IntegrationWidgets surface="parent" />
    </SummaryRow>
  )
}
